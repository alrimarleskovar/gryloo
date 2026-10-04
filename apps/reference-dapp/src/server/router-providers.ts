// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 routing providers: LI.FI (primary route discovery, executed through the LI.FI Diamond) and Across
 * (direct SpokePool deposit). Both normalize into the provider-neutral canonical route. The calldata is the source of
 * truth: it is decoded independently and every API field that matters must agree with it, or the quote is refused.
 * Server-side and read-only: no provider endpoint can sign or send anything, and redirects are refused.
 */
import { createHash } from 'node:crypto';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as MAINNET, type RouterProfile } from '@defi-workflow-engine/action-registry';
import { canonicalizeRoute, type CanonicalRoute, type RouteFee, type RoutingProvider } from '@defi-workflow-engine/workflow-contracts';
import { decodeAcrossDeposit, decodeLifiAcrossV4, decodeLifiFeeForward, lifiAcrossOutput } from '@defi-workflow-engine/reference-compiler';

/** JSON GET used by both adapters; replaced by a loopback/in-process provider in tests. */
export type RouterHttp = (url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>;
export type RouteRequest = { readonly owner: string; readonly recipient: string; readonly amount: string; readonly slippageBps: number; readonly nowMs: number;
  /** Observed on chain at Review: the origin SpokePool's quote-time buffer (seconds). */ readonly depositQuoteTimeBuffer: number };
export type TransferHint = { readonly source: 'lifi.status' | 'across.deposit-status'; readonly status: 'PENDING' | 'FILLED' | 'EXPIRED' | 'REFUNDED' | 'NOT_FOUND' | 'FAILED' | 'UNKNOWN';
  readonly destinationTxHash: string | null; readonly refundTxHash: string | null; readonly rawHash: string };
export type RouteProvider = { readonly id: RoutingProvider; readonly quote: (request: RouteRequest) => Promise<CanonicalRoute>;
  readonly status: (sourceTxHash: string) => Promise<TransferHint> };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/, UNITS = /^(0|[1-9][0-9]{0,77})$/, HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const fail = (code: string): never => { throw new Error(code); };
const rec = (value: unknown, code: string): Record<string, unknown> => !value || typeof value !== 'object' || Array.isArray(value) ? fail(code) : value as Record<string, unknown>;
const addr = (value: unknown, code: string): string => typeof value === 'string' && ADDRESS.test(value) ? value.toLowerCase() : fail(code);
const units = (value: unknown, code: string): string => typeof value === 'string' && UNITS.test(value) ? value : fail(code);
const rawHash = (raw: unknown) => '0x' + createHash('sha256').update(JSON.stringify(raw)).digest('hex');
const iso = (ms: number) => new Date(ms).toISOString();
/** Provider quotes carry no usable expiry for LI.FI; both routes stop well before the SpokePool would reject the deposit. */
function depositExpiry(quoteTimestamp: number, fillDeadline: number, buffer: number, profile: RouterProfile): number {
  return Math.min((quoteTimestamp + buffer - profile.depositSafetyMarginSeconds) * 1000, (fillDeadline - profile.depositSafetyMarginSeconds) * 1000);
}
const token = (side: 'source' | 'destination', profile: RouterProfile) => side === 'source'
  ? { chainId: profile.source.chain, address: profile.source.usdc, decimals: 6, symbol: 'USDC' }
  : { chainId: profile.destination.chain, address: profile.destination.usdc, decimals: 6, symbol: 'USDC' };

/** Default transport: bounded JSON over HTTPS, no redirects, no caching. */
export function createRouterHttp(fetcher: typeof fetch = fetch): RouterHttp {
  return async (url, headers = {}) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(target.hostname)) fail('ROUTER_PROVIDER_URL_INVALID');
    let response: Response;
    try { response = await fetcher(target, { headers: { Accept: 'application/json', 'User-Agent': 'Flofi/BUILD-ROUTER-001', ...headers }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
    catch { return fail('ROUTER_PROVIDER_UNAVAILABLE'); }
    if (response.status === 429) fail('ROUTER_PROVIDER_RATE_LIMITED');
    if (!response.ok) fail('ROUTER_PROVIDER_HTTP_' + response.status);
    if (Number(response.headers.get('content-length') ?? '0') > 2_000_000) fail('ROUTER_PROVIDER_RESPONSE_TOO_LARGE');
    const text = await response.text();
    if (text.length > 2_000_000) fail('ROUTER_PROVIDER_RESPONSE_TOO_LARGE');
    try { return JSON.parse(text) as unknown; } catch { return fail('ROUTER_PROVIDER_RESPONSE_INVALID'); }
  };
}

// --- LI.FI --------------------------------------------------------------------------------------------------------
/** LI.FI fee lines that are LI.FI/integrator fees (collected on the source chain before bridging). */
const INTEGRATOR_FEE = /lifi|integrator/i;
function lifiBridgeFeeKind(name: string): RouteFee['kind'] {
  return /gas/i.test(name) ? 'BRIDGE_DESTINATION_GAS' : /lp/i.test(name) ? 'BRIDGE_LP' : /relayer/i.test(name) ? 'BRIDGE_RELAYER_CAPITAL' : 'BRIDGE_OTHER';
}
export function normalizeLifiRoute(raw: unknown, request: RouteRequest, profile: RouterProfile = MAINNET): CanonicalRoute {
  const SRC = profile.source, DST = profile.destination;
  const owner = addr(request.owner, 'ROUTER_OWNER_INVALID'), recipient = addr(request.recipient, 'ROUTER_RECIPIENT_INVALID');
  const q = rec(raw, 'LIFI_RESPONSE_INVALID'), action = rec(q.action, 'LIFI_RESPONSE_INVALID'), estimate = rec(q.estimate, 'LIFI_RESPONSE_INVALID');
  const tx = rec(q.transactionRequest, 'LIFI_TRANSACTION_UNSUPPORTED'), from = rec(action.fromToken, 'LIFI_RESPONSE_INVALID'), to = rec(action.toToken, 'LIFI_RESPONSE_INVALID');
  // The router asks LI.FI only for bridges it can reconcile. Anything else (e.g. a later fallback to another bridge) is refused.
  if (q.tool !== profile.underlyingProtocol) fail('LIFI_UNDERLYING_PROTOCOL_NOT_RECONCILABLE');
  if (q.type !== 'lifi' || typeof q.id !== 'string' || q.id.length < 1 || q.id.length > 160 || action.fromChainId !== SRC.chainId || action.toChainId !== DST.chainId ||
      action.fromAmount !== request.amount || addr(action.fromAddress, 'LIFI_ROUTE_UNSUPPORTED') !== owner || addr(action.toAddress, 'LIFI_ROUTE_UNSUPPORTED') !== recipient ||
      addr(from.address, 'LIFI_ROUTE_UNSUPPORTED') !== SRC.usdc || addr(to.address, 'LIFI_ROUTE_UNSUPPORTED') !== DST.usdc || from.decimals !== 6 || to.decimals !== 6 ||
      typeof action.slippage !== 'number' || Math.abs(action.slippage - request.slippageBps / 10_000) > 1e-9) fail('LIFI_ROUTE_UNSUPPORTED');
  const steps = Array.isArray(q.includedSteps) ? q.includedSteps.map(s => rec(s, 'LIFI_ROUTE_UNSUPPORTED')) : fail('LIFI_ROUTE_UNSUPPORTED');
  const kinds = steps.map(s => `${String(s.type)}:${String(s.tool)}`);
  if (!(kinds.length === 1 && kinds[0] === 'cross:across' || kinds.length === 2 && kinds[0] === 'protocol:feeCollection' && kinds[1] === 'cross:across'))
    fail('LIFI_ROUTE_STEPS_UNSUPPORTED');
  if (addr(estimate.approvalAddress, 'LIFI_ROUTE_UNSUPPORTED') !== SRC.lifiDiamond) fail('LIFI_SPENDER_UNEXPECTED');
  if (tx.chainId !== SRC.chainId || addr(tx.to, 'LIFI_TRANSACTION_UNSUPPORTED') !== SRC.lifiDiamond || addr(tx.from, 'LIFI_TRANSACTION_UNSUPPORTED') !== owner ||
      (tx.value !== '0x0' && tx.value !== '0x00' && tx.value !== '0')) fail('LIFI_TRANSACTION_UNSUPPORTED');
  const data = typeof tx.data === 'string' ? tx.data.toLowerCase() : fail('LIFI_TRANSACTION_UNSUPPORTED'), call = decodeLifiAcrossV4(data), bd = call.bridgeData, ac = call.across;
  // Calldata is authoritative; the API summary must agree with it.
  if (bd.bridge !== profile.underlyingProtocol || bd.receiver !== recipient || bd.sendingAssetId !== SRC.usdc || bd.destinationChainId !== BigInt(DST.chainId) ||
      bd.hasDestinationCall || bd.integrator !== profile.providers.lifi.integrator || (typeof q.transactionId === 'string' && q.transactionId.toLowerCase() !== bd.transactionId) ||
      ac.receiverAddress !== recipient || ac.refundAddress !== owner || ac.sendingAssetId !== SRC.usdc || ac.receivingAssetId !== DST.usdc || ac.message !== '0x')
    fail('LIFI_CALLDATA_MISMATCH');
  let integratorFees: { recipient: string; amount: bigint }[] = [];
  if (call.kind === 'SWAP_AND_START') {
    const s = call.swaps.length === 1 ? call.swaps[0]! : fail('LIFI_CALLDATA_MISMATCH');
    if (call.swaps.length !== 1 || !bd.hasSourceSwaps || s.callTo !== SRC.lifiFeeForwarder || s.approveTo !== SRC.lifiFeeForwarder ||
        s.sendingAssetId !== SRC.usdc || s.receivingAssetId !== SRC.usdc || s.fromAmount !== BigInt(request.amount) || !s.requiresDeposit) fail('LIFI_CALLDATA_MISMATCH');
    const forward = decodeLifiFeeForward(s.callData);
    if (forward.token !== SRC.usdc || forward.fees.some(f => f.recipient === ZERO || f.amount === 0n)) fail('LIFI_CALLDATA_MISMATCH');
    integratorFees = forward.fees;
    if (BigInt(request.amount) - integratorFees.reduce((sum, f) => sum + f.amount, 0n) !== bd.minAmount ||
        lifiAcrossOutput(bd.minAmount, ac.outputAmountMultiplier) !== ac.outputAmount) fail('LIFI_CALLDATA_MISMATCH');
  } else if (bd.hasSourceSwaps || bd.minAmount !== BigInt(request.amount)) fail('LIFI_CALLDATA_MISMATCH');
  const output = ac.outputAmount.toString();
  if (units(estimate.toAmountMin, 'LIFI_ROUTE_UNSUPPORTED') !== output || units(estimate.toAmount, 'LIFI_ROUTE_UNSUPPORTED') !== output) fail('LIFI_OUTPUT_MISMATCH');
  const feeLines = Array.isArray(estimate.feeCosts) && estimate.feeCosts.length <= 12 ? estimate.feeCosts.map(f => rec(f, 'LIFI_FEES_INVALID')) : fail('LIFI_FEES_INVALID');
  const lines = feeLines.map(f => {
    const t = rec(f.token, 'LIFI_FEES_INVALID');
    if (t.chainId !== SRC.chainId || addr(t.address, 'LIFI_FEES_INVALID') !== SRC.usdc || f.included !== true || typeof f.name !== 'string') fail('LIFI_FEE_ASSET_UNSUPPORTED');
    return { name: (f.name as string).slice(0, 80), amount: BigInt(units(f.amount, 'LIFI_FEES_INVALID')) };
  });
  const integratorQuoted = lines.filter(l => INTEGRATOR_FEE.test(l.name)).reduce((sum, l) => sum + l.amount, 0n);
  const bridgeLines = lines.filter(l => !INTEGRATOR_FEE.test(l.name) && l.amount > 0n);
  if (integratorQuoted !== integratorFees.reduce((sum, f) => sum + f.amount, 0n) ||
      bridgeLines.reduce((sum, l) => sum + l.amount, 0n) !== bd.minAmount - ac.outputAmount) fail('LIFI_FEES_INCONSISTENT');
  const fees: RouteFee[] = [...integratorFees.map(f => ({ kind: 'INTEGRATOR' as const, label: 'LI.FI fee', chainId: SRC.chain, token: SRC.usdc, amount: f.amount.toString(),
    recipient: f.recipient })), ...bridgeLines.map(l => ({ kind: lifiBridgeFeeKind(l.name), label: l.name, chainId: SRC.chain, token: SRC.usdc, amount: l.amount.toString(), recipient: null }))];
  const expiresMs = depositExpiry(ac.quoteTimestamp, ac.fillDeadline, request.depositQuoteTimeBuffer, profile);
  if (expiresMs <= request.nowMs) fail('LIFI_QUOTE_EXPIRED');
  const gas = Array.isArray(estimate.gasCosts) ? estimate.gasCosts.map(g => rec(g, 'LIFI_GAS_INVALID')) : [];
  const gasTotal = gas.every(g => rec(g.token, 'LIFI_GAS_INVALID').chainId === SRC.chainId && typeof g.amount === 'string' && UNITS.test(g.amount))
    ? gas.reduce((sum, g) => sum + BigInt(g.amount as string), 0n).toString() : null;
  const duration = typeof estimate.executionDuration === 'number' && Number.isFinite(estimate.executionDuration) ? Math.max(0, Math.round(estimate.executionDuration)) : 0;
  const quoteId = typeof q.id === 'string' ? q.id : fail('LIFI_ROUTE_UNSUPPORTED');
  return canonicalizeRoute({ format: 'flofi.route.v1', sourceChain: SRC.chain, destinationChain: DST.chain, inputToken: token('source', profile), outputToken: token('destination', profile),
    inputAmount: request.amount, expectedOutput: output, minimumOutput: output, recipient, depositor: owner, refundAddress: owner, routingProvider: 'lifi',
    underlyingProtocol: 'across',
    steps: [...call.kind === 'SWAP_AND_START' ? [{ kind: 'FEE_COLLECTION' as const, protocol: 'lifi-fee', fromChain: SRC.chain, toChain: SRC.chain, fromToken: SRC.usdc,
      toToken: SRC.usdc, amountIn: request.amount, amountOut: bd.minAmount.toString() }] : [],
      { kind: 'BRIDGE' as const, protocol: 'across', fromChain: SRC.chain, toChain: DST.chain, fromToken: SRC.usdc, toToken: DST.usdc, amountIn: bd.minAmount.toString(), amountOut: output }],
    fees, feeTotal: (BigInt(request.amount) - ac.outputAmount).toString(), slippageBps: request.slippageBps,
    approval: { token: SRC.usdc, spender: SRC.lifiDiamond, amount: request.amount },
    deposit: { purpose: 'BRIDGE_DEPOSIT', chainId: SRC.chain, to: SRC.lifiDiamond, data, value: '0x0' },
    bridge: { protocol: 'across', originSpokePool: SRC.spokePool, destinationSpokePool: DST.spokePool, depositor: ac.refundAddress, recipient, inputToken: SRC.usdc,
      outputToken: DST.usdc, inputAmount: bd.minAmount.toString(), outputAmount: output, destinationChainId: DST.chainId, exclusiveRelayer: ac.exclusiveRelayer,
      quoteTimestamp: ac.quoteTimestamp, fillDeadline: ac.fillDeadline, exclusivityParameter: ac.exclusivityParameter, message: '0x' },
    quote: { id: quoteId, rawHash: rawHash(raw), quotedAt: iso(request.nowMs), expiresAt: iso(expiresMs), estimatedDurationSeconds: duration, providerGasEstimate: gasTotal } });
}
export function lifiQuoteUrl(request: RouteRequest, api?: string, profile: RouterProfile = MAINNET): string {
  const SRC = profile.source, DST = profile.destination;
  const params = new URLSearchParams({ fromChain: String(SRC.chainId), toChain: String(DST.chainId), fromToken: SRC.usdc, toToken: DST.usdc, fromAmount: request.amount,
    fromAddress: request.owner, toAddress: request.recipient, slippage: String(request.slippageBps / 10_000), integrator: profile.providers.lifi.integrator,
    allowBridges: profile.underlyingProtocol, allowDestinationCall: 'false' });
  return `${api ?? profile.providers.lifi.api}/quote?${params}`;
}
export function normalizeLifiStatus(raw: unknown, sourceTxHash: string, profile: RouterProfile = MAINNET): TransferHint {
  const SRC = profile.source, DST = profile.destination;
  const v = rec(raw, 'LIFI_STATUS_INVALID'), sending = v.sending && typeof v.sending === 'object' ? v.sending as Record<string, unknown> : null;
  const receiving = v.receiving && typeof v.receiving === 'object' ? v.receiving as Record<string, unknown> : null;
  if (sending?.txHash !== undefined && String(sending.txHash).toLowerCase() !== sourceTxHash) fail('LIFI_STATUS_MISMATCH');
  const substatus = String(v.substatus ?? '');
  const status: TransferHint['status'] = v.status === 'DONE' ? (substatus === 'REFUNDED' ? 'REFUNDED' : substatus === 'COMPLETED' ? 'FILLED' : 'UNKNOWN')
    : v.status === 'PENDING' ? 'PENDING' : v.status === 'NOT_FOUND' ? 'NOT_FOUND' : v.status === 'FAILED' ? 'FAILED' : 'UNKNOWN';
  const destination = status === 'FILLED' && receiving && receiving.chainId === DST.chainId && typeof receiving.txHash === 'string' && HASH.test(receiving.txHash)
    ? receiving.txHash.toLowerCase() : null;
  const refund = status === 'REFUNDED' && receiving && receiving.chainId === SRC.chainId && typeof receiving.txHash === 'string' && HASH.test(receiving.txHash)
    ? receiving.txHash.toLowerCase() : null;
  return { source: 'lifi.status', status, destinationTxHash: destination, refundTxHash: refund, rawHash: rawHash(raw) };
}

// --- Across -------------------------------------------------------------------------------------------------------
export function normalizeAcrossRoute(raw: unknown, request: RouteRequest, profile: RouterProfile = MAINNET): CanonicalRoute {
  const SRC = profile.source, DST = profile.destination;
  const owner = addr(request.owner, 'ROUTER_OWNER_INVALID'), recipient = addr(request.recipient, 'ROUTER_RECIPIENT_INVALID');
  const q = rec(raw, 'ACROSS_RESPONSE_INVALID'), steps = rec(q.steps, 'ACROSS_RESPONSE_INVALID'), bridge = rec(steps.bridge, 'ACROSS_ROUTE_UNSUPPORTED');
  const tx = rec(q.swapTx, 'ACROSS_TRANSACTION_UNSUPPORTED'), checks = rec(q.checks, 'ACROSS_RESPONSE_INVALID'), allowance = rec(checks.allowance, 'ACROSS_RESPONSE_INVALID');
  const tok = (v: unknown, chainId: number, address: string) => { const t = rec(v, 'ACROSS_ROUTE_UNSUPPORTED'); return t.chainId === chainId && addr(t.address, 'ACROSS_ROUTE_UNSUPPORTED') === address && t.decimals === 6; };
  if (q.crossSwapType !== 'bridgeableToBridgeable' || q.amountType !== 'exactInput' || steps.originSwap != null || steps.destinationSwap != null ||
      bridge.provider !== 'across' || units(q.inputAmount, 'ACROSS_ROUTE_UNSUPPORTED') !== request.amount ||
      (q.maxInputAmount !== undefined && q.maxInputAmount !== request.amount) || units(bridge.inputAmount, 'ACROSS_ROUTE_UNSUPPORTED') !== request.amount ||
      !tok(q.inputToken, SRC.chainId, SRC.usdc) || !tok(q.outputToken, DST.chainId, DST.usdc) || !tok(q.refundToken, SRC.chainId, SRC.usdc) ||
      !tok(bridge.tokenIn, SRC.chainId, SRC.usdc) || !tok(bridge.tokenOut, DST.chainId, DST.usdc)) fail('ACROSS_ROUTE_UNSUPPORTED');
  if (addr(allowance.spender, 'ACROSS_ROUTE_UNSUPPORTED') !== SRC.spokePool || addr(allowance.token, 'ACROSS_ROUTE_UNSUPPORTED') !== SRC.usdc) fail('ACROSS_SPENDER_UNEXPECTED');
  if (tx.chainId !== SRC.chainId || addr(tx.to, 'ACROSS_TRANSACTION_UNSUPPORTED') !== SRC.spokePool || (tx.value != null && tx.value !== '0' && tx.value !== '0x0') ||
      (tx.ecosystem !== undefined && tx.ecosystem !== 'evm')) fail('ACROSS_TRANSACTION_UNSUPPORTED');
  const data = typeof tx.data === 'string' ? tx.data.toLowerCase() : fail('ACROSS_TRANSACTION_UNSUPPORTED'), call = decodeAcrossDeposit(data);
  if (call.depositor !== owner || call.recipient !== recipient || call.inputToken !== SRC.usdc || call.outputToken !== DST.usdc || call.inputAmount !== BigInt(request.amount) ||
      call.destinationChainId !== BigInt(DST.chainId) || call.message !== '0x') fail('ACROSS_CALLDATA_MISMATCH');
  const output = call.outputAmount.toString();
  if (units(q.minOutputAmount, 'ACROSS_ROUTE_UNSUPPORTED') !== output || units(q.expectedOutputAmount, 'ACROSS_ROUTE_UNSUPPORTED') !== output ||
      units(bridge.outputAmount, 'ACROSS_ROUTE_UNSUPPORTED') !== output) fail('ACROSS_OUTPUT_MISMATCH');
  const fees = rec(bridge.fees, 'ACROSS_FEES_INVALID'), details = rec(fees.details, 'ACROSS_FEES_INVALID'), feeToken = rec(fees.token, 'ACROSS_FEES_INVALID');
  if (feeToken.chainId !== SRC.chainId || addr(feeToken.address, 'ACROSS_FEES_INVALID') !== SRC.usdc) fail('ACROSS_FEE_ASSET_UNSUPPORTED');
  const part = (key: string, kind: RouteFee['kind'], label: string): RouteFee[] => {
    const v = details[key]; if (v === undefined) return [];
    const amount = typeof v === 'object' && v !== null ? units((v as Record<string, unknown>).amount, 'ACROSS_FEES_INVALID') : units(v, 'ACROSS_FEES_INVALID');
    return amount === '0' ? [] : [{ kind, label, chainId: SRC.chain, token: SRC.usdc, amount, recipient: null }];
  };
  const lines = [...part('relayerCapital', 'BRIDGE_RELAYER_CAPITAL', 'Across relayer capital fee'), ...part('destinationGas', 'BRIDGE_DESTINATION_GAS', 'Across destination gas fee'),
    ...part('lp', 'BRIDGE_LP', 'Across LP fee')];
  const feeTotal = (BigInt(request.amount) - call.outputAmount).toString();
  if (units(fees.amount, 'ACROSS_FEES_INVALID') !== feeTotal || lines.reduce((sum, f) => sum + BigInt(f.amount), 0n) !== BigInt(feeTotal)) fail('ACROSS_FEES_INCONSISTENT');
  const quoteExpiry = typeof q.quoteExpiryTimestamp === 'number' && Number.isSafeInteger(q.quoteExpiryTimestamp) ? q.quoteExpiryTimestamp : fail('ACROSS_ROUTE_UNSUPPORTED');
  const quoteId = typeof q.id === 'string' && q.id.length >= 1 && q.id.length <= 160 ? q.id : fail('ACROSS_ROUTE_UNSUPPORTED');
  const expiresMs = Math.min(quoteExpiry * 1000, depositExpiry(call.quoteTimestamp, call.fillDeadline, request.depositQuoteTimeBuffer, profile));
  if (expiresMs <= request.nowMs) fail('ACROSS_QUOTE_EXPIRED');
  const duration = typeof q.expectedFillTime === 'number' && Number.isFinite(q.expectedFillTime) ? Math.max(0, Math.round(q.expectedFillTime)) : 0;
  return canonicalizeRoute({ format: 'flofi.route.v1', sourceChain: SRC.chain, destinationChain: DST.chain, inputToken: token('source', profile), outputToken: token('destination', profile),
    inputAmount: request.amount, expectedOutput: output, minimumOutput: output, recipient, depositor: owner, refundAddress: owner, routingProvider: 'across',
    underlyingProtocol: 'across', steps: [{ kind: 'BRIDGE', protocol: 'across', fromChain: SRC.chain, toChain: DST.chain, fromToken: SRC.usdc, toToken: DST.usdc,
      amountIn: request.amount, amountOut: output }],
    fees: lines, feeTotal, slippageBps: request.slippageBps, approval: { token: SRC.usdc, spender: SRC.spokePool, amount: request.amount },
    deposit: { purpose: 'BRIDGE_DEPOSIT', chainId: SRC.chain, to: SRC.spokePool, data, value: '0x0' },
    bridge: { protocol: 'across', originSpokePool: SRC.spokePool, destinationSpokePool: DST.spokePool, depositor: owner, recipient, inputToken: SRC.usdc, outputToken: DST.usdc,
      inputAmount: request.amount, outputAmount: output, destinationChainId: DST.chainId, exclusiveRelayer: call.exclusiveRelayer, quoteTimestamp: call.quoteTimestamp,
      fillDeadline: call.fillDeadline, exclusivityParameter: call.exclusivityParameter, message: '0x' },
    quote: { id: quoteId, rawHash: rawHash(raw), quotedAt: iso(request.nowMs), expiresAt: iso(expiresMs), estimatedDurationSeconds: duration, providerGasEstimate: null } });
}
export function acrossQuoteUrl(request: RouteRequest, integratorId?: string, api?: string, profile: RouterProfile = MAINNET): string {
  const SRC = profile.source, DST = profile.destination;
  const params = new URLSearchParams({ tradeType: 'exactInput', strictTradeType: 'true', amount: request.amount, inputToken: SRC.usdc, outputToken: DST.usdc,
    originChainId: String(SRC.chainId), destinationChainId: String(DST.chainId), depositor: request.owner, recipient: request.recipient, refundAddress: request.owner,
    refundOnOrigin: 'true', slippage: String(request.slippageBps / 10_000), ...integratorId ? { integratorId } : {} });
  return `${api ?? profile.providers.across.api}/swap/approval?${params}`;
}
export function normalizeAcrossStatus(raw: unknown, sourceTxHash: string, profile: RouterProfile = MAINNET): TransferHint {
  const SRC = profile.source, DST = profile.destination;
  const v = rec(raw, 'ACROSS_STATUS_INVALID');
  const deposit = v.depositTxnRef ?? v.depositTxHash;
  if (deposit !== undefined && String(deposit).toLowerCase() !== sourceTxHash) fail('ACROSS_STATUS_MISMATCH');
  if ((v.originChainId !== undefined && v.originChainId !== SRC.chainId) || (v.destinationChainId !== undefined && v.destinationChainId !== DST.chainId)) fail('ACROSS_STATUS_MISMATCH');
  const hash = (x: unknown) => typeof x === 'string' && HASH.test(x) ? x.toLowerCase() : null;
  const status: TransferHint['status'] = v.status === 'filled' ? 'FILLED' : v.status === 'expired' ? 'EXPIRED' : v.status === 'refunded' ? 'REFUNDED'
    : v.status === 'pending' || v.status === 'slowFillRequested' ? 'PENDING' : 'UNKNOWN';
  return { source: 'across.deposit-status', status, destinationTxHash: status === 'FILLED' ? hash(v.fillTxnRef ?? v.fillTx) : null,
    refundTxHash: status === 'REFUNDED' ? hash(v.depositRefundTxnRef ?? v.depositRefundTxHash) : null, rawHash: rawHash(raw) };
}

// --- Provider set -------------------------------------------------------------------------------------------------
export type RouterProviderConfig = { readonly http: RouterHttp; readonly lifiApi?: string; readonly acrossApi?: string;
  /** BUILD-JOURNEY-001: the pair/network profile (default: Base → Arbitrum One mainnet). */ readonly profile?: RouterProfile;
  /** Optional server-side credentials; never sent to the browser. */ readonly acrossApiKey?: string; readonly acrossIntegratorId?: string; readonly lifiApiKey?: string };
export function createRouteProviders(config: RouterProviderConfig): Readonly<Record<RoutingProvider, RouteProvider>> {
  const profile = config.profile ?? MAINNET;
  const lifiApi = config.lifiApi ?? profile.providers.lifi.api, acrossApi = config.acrossApi ?? profile.providers.across.api;
  if (config.acrossIntegratorId !== undefined && !/^0x[0-9a-fA-F]{4}$/.test(config.acrossIntegratorId)) fail('ROUTER_CONFIGURATION_INVALID');
  const acrossHeaders = config.acrossApiKey ? { Authorization: `Bearer ${config.acrossApiKey}` } : undefined;
  const lifiHeaders = config.lifiApiKey ? { 'x-lifi-api-key': config.lifiApiKey } : undefined;
  return Object.freeze({
    lifi: { id: 'lifi', quote: async request => normalizeLifiRoute(await config.http(lifiQuoteUrl(request, lifiApi, profile), lifiHeaders), request, profile),
      status: async hash => normalizeLifiStatus(await config.http(`${lifiApi}/status?${new URLSearchParams({ txHash: hash, fromChain: String(profile.source.chainId),
        toChain: String(profile.destination.chainId), bridge: profile.underlyingProtocol })}`, lifiHeaders), hash, profile) },
    across: { id: 'across', quote: async request => normalizeAcrossRoute(await config.http(acrossQuoteUrl(request, config.acrossIntegratorId, acrossApi, profile), acrossHeaders),
      request, profile),
      status: async hash => normalizeAcrossStatus(await config.http(`${acrossApi}/deposit/status?${new URLSearchParams({ depositTxnRef: hash })}`, acrossHeaders), hash, profile) },
  });
}

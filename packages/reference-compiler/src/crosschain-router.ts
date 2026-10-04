// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001: strict codecs for the Cross-chain Router's Base transactions and Across events, and the pure
 * compilation of one reviewed route into the existing artifact chain (Quote/State → Artifact Set → Simulation Bundle →
 * AuthorizationPolicy → StrategyManifest → ExecutionPlan). The route commitment is a normalized value of the quote
 * artifact, so the Manifest hash binds the exact reviewed route.
 *
 * Every decoder re-encodes what it decoded and requires byte equality with the input (one canonical encoding, no
 * hidden bytes). The only tolerated extra bytes are a short trailer after the Across `deposit` arguments, which Across
 * appends as an integrator marker; it is reviewed as part of the exact calldata.
 */
import { hashArtifactBytes, hashRawBytes, type SemanticWorkflow, type QuoteStateArtifact, type ArtifactSet, type SimulationBundle,
  type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan, type CanonicalRoute } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';

export const ROUTER_SELECTORS = Object.freeze({
  approve: '0x095ea7b3', balanceOf: '0x70a08231', allowance: '0xdd62ed3e', decimals: '0x313ce567',
  acrossDeposit: '0xad5425c6', lifiSwapAndStartAcrossV4: '0x1794958f', lifiStartAcrossV4: '0xa1f1ce43', lifiForwardErc20Fees: '0x332d746b',
  depositQuoteTimeBuffer: '0x57f6dcb8', fillDeadlineBuffer: '0x079bd2c7', chainId: '0x9a8a0592', pausedDeposits: '0x6068d6cb', pausedFills: '0xdda52113',
});
export const ROUTER_TOPICS = Object.freeze({
  fundsDeposited: '0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3',
  filledRelay: '0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208',
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
});
/** EIP-1967 implementation slot of an upgradeable proxy. */
export const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

const fail = (code: string): never => { throw new Error(code); };
const MAX256 = (1n << 256n) - 1n;
const w = (n: bigint) => { if (n < 0n || n > MAX256) fail('ROUTER_ABI_VALUE_INVALID'); return n.toString(16).padStart(64, '0'); };
const aw = (a: string) => { if (!/^0x[0-9a-f]{40}$/.test(a)) fail('ROUTER_ABI_ADDRESS_INVALID'); return a.slice(2).padStart(64, '0'); };
const b32 = (h: string) => { if (!/^0x[0-9a-f]{64}$/.test(h)) fail('ROUTER_ABI_BYTES32_INVALID'); return h.slice(2); };
const pad = (hex: string) => hex + '0'.repeat((64 - hex.length % 64) % 64);
const encBytes = (hex: string) => { if (!/^0x(?:[0-9a-f]{2})*$/.test(hex)) fail('ROUTER_ABI_BYTES_INVALID'); const body = hex.slice(2); return w(BigInt(body.length / 2)) + pad(body); };
const encString = (s: string) => encBytes('0x' + Buffer.from(s, 'utf8').toString('hex'));
const u32 = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) fail('ROUTER_ABI_VALUE_INVALID'); return w(BigInt(n)); };
const bool = (v: boolean) => w(v ? 1n : 0n);

/** Bounded reader over ABI-encoded bytes (hex without 0x). Positions are byte offsets. */
class Reader {
  constructor(private readonly hex: string) {}
  get size() { return this.hex.length / 2; }
  word(at: number): bigint { if (!Number.isSafeInteger(at) || at < 0 || at + 32 > this.size) fail('ROUTER_ABI_OUT_OF_BOUNDS'); return BigInt('0x' + this.hex.slice(at * 2, at * 2 + 64)); }
  offset(at: number, base: number): number { const v = this.word(at); if (v > BigInt(this.size) || v % 32n) fail('ROUTER_ABI_OFFSET_INVALID'); return base + Number(v); }
  address(at: number): string { const v = this.word(at); if (v >> 160n) fail('ROUTER_ABI_ADDRESS_INVALID'); return '0x' + v.toString(16).padStart(40, '0'); }
  bytes32(at: number): string { this.word(at); return '0x' + this.hex.slice(at * 2, at * 2 + 64); }
  bool(at: number): boolean { const v = this.word(at); if (v > 1n) fail('ROUTER_ABI_BOOL_INVALID'); return v === 1n; }
  uint(at: number, bits = 256): bigint { const v = this.word(at); if (v >> BigInt(bits)) fail('ROUTER_ABI_VALUE_INVALID'); return v; }
  u32(at: number): number { return Number(this.uint(at, 32)); }
  bytes(at: number): string { const length = this.word(at); if (length > 100_000n || at + 32 + Number(length) > this.size) fail('ROUTER_ABI_OUT_OF_BOUNDS'); return '0x' + this.hex.slice((at + 32) * 2, (at + 32 + Number(length)) * 2); }
  string(at: number): string { const raw = this.bytes(at); const text = Buffer.from(raw.slice(2), 'hex').toString('utf8'); if (Buffer.from(text, 'utf8').toString('hex') !== raw.slice(2)) fail('ROUTER_ABI_STRING_INVALID'); return text; }
}
const body = (data: string, selector: string) => {
  if (typeof data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(data) || data.length > 200_000) fail('ROUTER_CALLDATA_INVALID');
  if (data.slice(0, 10) !== selector) fail('ROUTER_CALLDATA_FUNCTION_INVALID');
  return data.slice(10);
};
/** bytes32 that holds an EVM address (top 12 bytes zero), as Across V3.5+ encodes EVM depositors, recipients and tokens. */
export function evmAddressFromBytes32(value: string): string {
  if (!/^0x0{24}[0-9a-f]{40}$/.test(value)) fail('ROUTER_NON_EVM_ADDRESS');
  return '0x' + value.slice(26);
}
const toB32 = (address: string) => '0x' + aw(address);

// --- ERC-20 approve --------------------------------------------------------------------------------------------
export function encodeRouterApprove(spender: string, amount: bigint): string { return ROUTER_SELECTORS.approve + aw(spender) + w(amount); }
export function decodeRouterApprove(data: string): { spender: string; amount: bigint } {
  const r = new Reader(body(data, ROUTER_SELECTORS.approve));
  if (r.size !== 64) fail('ROUTER_CALLDATA_INVALID');
  const value = { spender: r.address(0), amount: r.uint(32) };
  if (encodeRouterApprove(value.spender, value.amount) !== data) fail('ROUTER_CALLDATA_NOT_CANONICAL');
  return value;
}

// --- Across SpokePool.deposit (bytes32 variant) ---------------------------------------------------------------
export type AcrossDepositCall = { readonly depositor: string; readonly recipient: string; readonly inputToken: string; readonly outputToken: string;
  readonly inputAmount: bigint; readonly outputAmount: bigint; readonly destinationChainId: bigint; readonly exclusiveRelayer: string;
  readonly quoteTimestamp: number; readonly fillDeadline: number; readonly exclusivityParameter: number; readonly message: string;
  /** Bytes after the ABI arguments (Across integrator marker); at most 32 bytes. */ readonly trailer: string };
export function encodeAcrossDeposit(c: AcrossDepositCall): string {
  if (!/^0x(?:[0-9a-f]{2}){0,32}$/.test(c.trailer)) fail('ROUTER_CALLDATA_TRAILER_INVALID');
  return ROUTER_SELECTORS.acrossDeposit + aw(c.depositor) + aw(c.recipient) + aw(c.inputToken) + aw(c.outputToken) + w(c.inputAmount) + w(c.outputAmount) +
    w(c.destinationChainId) + aw(c.exclusiveRelayer) + u32(c.quoteTimestamp) + u32(c.fillDeadline) + u32(c.exclusivityParameter) + w(384n) + encBytes(c.message) + c.trailer.slice(2);
}
export function decodeAcrossDeposit(data: string): AcrossDepositCall {
  const hex = body(data, ROUTER_SELECTORS.acrossDeposit), r = new Reader(hex);
  if (r.offset(352, 0) !== 384) fail('ROUTER_CALLDATA_NOT_CANONICAL');
  const message = r.bytes(384), end = 384 + 32 + Math.ceil((message.length - 2) / 64) * 32;
  if (end > r.size || r.size - end > 32) fail('ROUTER_CALLDATA_TRAILER_INVALID');
  const call: AcrossDepositCall = { depositor: evmAddressFromBytes32(r.bytes32(0)), recipient: evmAddressFromBytes32(r.bytes32(32)),
    inputToken: evmAddressFromBytes32(r.bytes32(64)), outputToken: evmAddressFromBytes32(r.bytes32(96)), inputAmount: r.uint(128), outputAmount: r.uint(160),
    destinationChainId: r.uint(192), exclusiveRelayer: evmAddressFromBytes32(r.bytes32(224)), quoteTimestamp: r.u32(256), fillDeadline: r.u32(288),
    exclusivityParameter: r.u32(320), message, trailer: '0x' + hex.slice(end * 2) };
  if (encodeAcrossDeposit(call) !== data) fail('ROUTER_CALLDATA_NOT_CANONICAL');
  return call;
}

// --- LI.FI Diamond: (swapAnd)StartBridgeTokensViaAcrossV4 ------------------------------------------------------
export type LifiBridgeData = { readonly transactionId: string; readonly bridge: string; readonly integrator: string; readonly referrer: string;
  readonly sendingAssetId: string; readonly receiver: string; readonly minAmount: bigint; readonly destinationChainId: bigint;
  readonly hasSourceSwaps: boolean; readonly hasDestinationCall: boolean };
export type LifiSwapData = { readonly callTo: string; readonly approveTo: string; readonly sendingAssetId: string; readonly receivingAssetId: string;
  readonly fromAmount: bigint; readonly callData: string; readonly requiresDeposit: boolean };
export type LifiAcrossV4Data = { readonly receiverAddress: string; readonly refundAddress: string; readonly sendingAssetId: string; readonly receivingAssetId: string;
  readonly outputAmount: bigint; readonly outputAmountMultiplier: bigint; readonly exclusiveRelayer: string; readonly quoteTimestamp: number;
  readonly fillDeadline: number; readonly exclusivityParameter: number; readonly message: string };
export type LifiAcrossCall = { readonly kind: 'SWAP_AND_START' | 'START'; readonly bridgeData: LifiBridgeData; readonly swaps: readonly LifiSwapData[];
  readonly across: LifiAcrossV4Data };
function encBridgeData(b: LifiBridgeData): string {
  const bridge = encString(b.bridge), integrator = encString(b.integrator);
  return b32(b.transactionId) + w(320n) + w(BigInt(320 + bridge.length / 2)) + aw(b.referrer) + aw(b.sendingAssetId) + aw(b.receiver) + w(b.minAmount) +
    w(b.destinationChainId) + bool(b.hasSourceSwaps) + bool(b.hasDestinationCall) + bridge + integrator;
}
function encSwaps(swaps: readonly LifiSwapData[]): string {
  const items = swaps.map(s => aw(s.callTo) + aw(s.approveTo) + aw(s.sendingAssetId) + aw(s.receivingAssetId) + w(s.fromAmount) + w(224n) + bool(s.requiresDeposit) + encBytes(s.callData));
  let offset = swaps.length * 32; const heads: string[] = [];
  for (const item of items) { heads.push(w(BigInt(offset))); offset += item.length / 2; }
  return w(BigInt(swaps.length)) + heads.join('') + items.join('');
}
function encAcrossV4(a: LifiAcrossV4Data): string {
  if (a.outputAmountMultiplier >> 128n) fail('ROUTER_ABI_VALUE_INVALID');
  return aw(a.receiverAddress) + aw(a.refundAddress) + aw(a.sendingAssetId) + aw(a.receivingAssetId) + w(a.outputAmount) + w(a.outputAmountMultiplier) +
    aw(a.exclusiveRelayer) + u32(a.quoteTimestamp) + u32(a.fillDeadline) + u32(a.exclusivityParameter) + w(352n) + encBytes(a.message);
}
export function encodeLifiAcrossV4(call: LifiAcrossCall): string {
  const bridge = encBridgeData(call.bridgeData), across = encAcrossV4(call.across);
  if (call.kind === 'START') {
    if (call.swaps.length) fail('ROUTER_ABI_VALUE_INVALID');
    return ROUTER_SELECTORS.lifiStartAcrossV4 + w(64n) + w(BigInt(64 + bridge.length / 2)) + bridge + across;
  }
  const swaps = encSwaps(call.swaps);
  return ROUTER_SELECTORS.lifiSwapAndStartAcrossV4 + w(96n) + w(BigInt(96 + bridge.length / 2)) + w(BigInt(96 + (bridge.length + swaps.length) / 2)) + bridge + swaps + across;
}
export function decodeLifiAcrossV4(data: string): LifiAcrossCall {
  const kind = data.slice(0, 10) === ROUTER_SELECTORS.lifiStartAcrossV4 ? 'START' : 'SWAP_AND_START';
  const r = new Reader(body(data, kind === 'START' ? ROUTER_SELECTORS.lifiStartAcrossV4 : ROUTER_SELECTORS.lifiSwapAndStartAcrossV4));
  const bd = r.offset(0, 0), sw = kind === 'START' ? null : r.offset(32, 0), ac = r.offset(kind === 'START' ? 32 : 64, 0);
  const bridgeData: LifiBridgeData = { transactionId: r.bytes32(bd), bridge: r.string(r.offset(bd + 32, bd)), integrator: r.string(r.offset(bd + 64, bd)),
    referrer: r.address(bd + 96), sendingAssetId: r.address(bd + 128), receiver: r.address(bd + 160), minAmount: r.uint(bd + 192), destinationChainId: r.uint(bd + 224),
    hasSourceSwaps: r.bool(bd + 256), hasDestinationCall: r.bool(bd + 288) };
  const swaps: LifiSwapData[] = [];
  if (sw !== null) {
    const count = r.uint(sw);
    if (count > 4n) fail('ROUTER_CALLDATA_INVALID');
    for (let i = 0; i < Number(count); i++) {
      const at = r.offset(sw + 32 + i * 32, sw + 32);
      swaps.push({ callTo: r.address(at), approveTo: r.address(at + 32), sendingAssetId: r.address(at + 64), receivingAssetId: r.address(at + 96),
        fromAmount: r.uint(at + 128), callData: r.bytes(r.offset(at + 160, at)), requiresDeposit: r.bool(at + 192) });
    }
  }
  const across: LifiAcrossV4Data = { receiverAddress: evmAddressFromBytes32(r.bytes32(ac)), refundAddress: evmAddressFromBytes32(r.bytes32(ac + 32)),
    sendingAssetId: evmAddressFromBytes32(r.bytes32(ac + 64)), receivingAssetId: evmAddressFromBytes32(r.bytes32(ac + 96)), outputAmount: r.uint(ac + 128),
    outputAmountMultiplier: r.uint(ac + 160, 128), exclusiveRelayer: evmAddressFromBytes32(r.bytes32(ac + 192)), quoteTimestamp: r.u32(ac + 224),
    fillDeadline: r.u32(ac + 256), exclusivityParameter: r.u32(ac + 288), message: r.bytes(r.offset(ac + 320, ac)) };
  const call: LifiAcrossCall = { kind, bridgeData, swaps, across };
  if (encodeLifiAcrossV4(call) !== data) fail('ROUTER_CALLDATA_NOT_CANONICAL');
  return call;
}
/** LI.FI fee forwarder: `forwardERC20Fees(address token, (address recipient, uint256 amount)[] fees)`. */
export function encodeLifiFeeForward(token: string, fees: readonly { recipient: string; amount: bigint }[]): string {
  return ROUTER_SELECTORS.lifiForwardErc20Fees + aw(token) + w(64n) + w(BigInt(fees.length)) + fees.map(f => aw(f.recipient) + w(f.amount)).join('');
}
export function decodeLifiFeeForward(data: string): { token: string; fees: { recipient: string; amount: bigint }[] } {
  const r = new Reader(body(data, ROUTER_SELECTORS.lifiForwardErc20Fees));
  const token = r.address(0), at = r.offset(32, 0), count = r.uint(at);
  if (count < 1n || count > 4n) fail('ROUTER_CALLDATA_INVALID');
  const fees = Array.from({ length: Number(count) }, (_, i) => ({ recipient: r.address(at + 32 + i * 64), amount: r.uint(at + 64 + i * 64) }));
  if (encodeLifiFeeForward(token, fees) !== data) fail('ROUTER_CALLDATA_NOT_CANONICAL');
  return { token, fees };
}
/** LI.FI AcrossFacetV4 adjusts the output after source swaps: `minAmount × outputAmountMultiplier / 1e18`. */
export const lifiAcrossOutput = (depositInput: bigint, multiplier: bigint) => depositInput * multiplier / 10n ** 18n;

// --- Events -----------------------------------------------------------------------------------------------------
export type RouterLog = { readonly address: string; readonly topics: readonly string[]; readonly data: string };
const logData = (log: RouterLog, topic: string, topics: number) => {
  if (!log || typeof log.address !== 'string' || !Array.isArray(log.topics) || log.topics.length !== topics || String(log.topics[0]).toLowerCase() !== topic ||
      typeof log.data !== 'string' || !/^0x(?:[0-9a-fA-F]{64})*$/.test(log.data)) fail('ROUTER_LOG_INVALID');
  return new Reader(log.data.slice(2).toLowerCase());
};
const topicWord = (log: RouterLog, i: number) => { const t = String(log.topics[i]).toLowerCase(); if (!/^0x[0-9a-f]{64}$/.test(t)) fail('ROUTER_LOG_INVALID'); return t; };
export type FundsDeposited = { readonly spokePool: string; readonly destinationChainId: bigint; readonly depositId: bigint; readonly depositor: string;
  readonly inputToken: string; readonly outputToken: string; readonly inputAmount: bigint; readonly outputAmount: bigint; readonly quoteTimestamp: number;
  readonly fillDeadline: number; readonly exclusivityDeadline: number; readonly recipient: string; readonly exclusiveRelayer: string; readonly message: string };
export function decodeFundsDeposited(log: RouterLog): FundsDeposited {
  const r = logData(log, ROUTER_TOPICS.fundsDeposited, 4);
  if (r.offset(288, 0) !== 320) fail('ROUTER_LOG_INVALID');
  return { spokePool: log.address.toLowerCase(), destinationChainId: BigInt(topicWord(log, 1)), depositId: BigInt(topicWord(log, 2)),
    depositor: evmAddressFromBytes32(topicWord(log, 3)), inputToken: evmAddressFromBytes32(r.bytes32(0)), outputToken: evmAddressFromBytes32(r.bytes32(32)),
    inputAmount: r.uint(64), outputAmount: r.uint(96), quoteTimestamp: r.u32(128), fillDeadline: r.u32(160), exclusivityDeadline: r.u32(192),
    recipient: evmAddressFromBytes32(r.bytes32(224)), exclusiveRelayer: r.bytes32(256), message: r.bytes(320) };
}
export type FilledRelay = { readonly spokePool: string; readonly originChainId: bigint; readonly depositId: bigint; readonly relayer: string;
  readonly inputToken: string; readonly outputToken: string; readonly inputAmount: bigint; readonly outputAmount: bigint; readonly repaymentChainId: bigint;
  readonly fillDeadline: number; readonly exclusivityDeadline: number; readonly exclusiveRelayer: string; readonly depositor: string; readonly recipient: string;
  readonly messageHash: string; readonly updatedRecipient: string; readonly updatedMessageHash: string; readonly updatedOutputAmount: bigint; readonly fillType: number };
export function decodeFilledRelay(log: RouterLog): FilledRelay {
  const r = logData(log, ROUTER_TOPICS.filledRelay, 4);
  if (r.size !== 15 * 32) fail('ROUTER_LOG_INVALID');
  return { spokePool: log.address.toLowerCase(), originChainId: BigInt(topicWord(log, 1)), depositId: BigInt(topicWord(log, 2)), relayer: topicWord(log, 3),
    inputToken: evmAddressFromBytes32(r.bytes32(0)), outputToken: evmAddressFromBytes32(r.bytes32(32)), inputAmount: r.uint(64), outputAmount: r.uint(96),
    repaymentChainId: r.uint(128), fillDeadline: r.u32(160), exclusivityDeadline: r.u32(192), exclusiveRelayer: r.bytes32(224),
    depositor: evmAddressFromBytes32(r.bytes32(256)), recipient: evmAddressFromBytes32(r.bytes32(288)), messageHash: r.bytes32(320),
    updatedRecipient: evmAddressFromBytes32(r.bytes32(352)), updatedMessageHash: r.bytes32(384), updatedOutputAmount: r.uint(416), fillType: Number(r.uint(448, 8)) };
}
export function decodeErc20Transfer(log: RouterLog): { token: string; from: string; to: string; amount: bigint } {
  const r = logData(log, ROUTER_TOPICS.transfer, 3);
  if (r.size !== 32) fail('ROUTER_LOG_INVALID');
  return { token: log.address.toLowerCase(), from: evmAddressFromBytes32(topicWord(log, 1)), to: evmAddressFromBytes32(topicWord(log, 2)), amount: r.uint(0) };
}
export function decodeErc20Approval(log: RouterLog): { token: string; owner: string; spender: string; amount: bigint } {
  const r = logData(log, ROUTER_TOPICS.approval, 3);
  if (r.size !== 32) fail('ROUTER_LOG_INVALID');
  return { token: log.address.toLowerCase(), owner: evmAddressFromBytes32(topicWord(log, 1)), spender: evmAddressFromBytes32(topicWord(log, 2)), amount: r.uint(0) };
}
/** For harnesses and tests: the event encodings the decoders above accept. */
export function encodeFundsDepositedLog(e: FundsDeposited): RouterLog {
  return { address: e.spokePool, topics: [ROUTER_TOPICS.fundsDeposited, '0x' + w(e.destinationChainId), '0x' + w(e.depositId), toB32(e.depositor)],
    data: '0x' + aw(e.inputToken) + aw(e.outputToken) + w(e.inputAmount) + w(e.outputAmount) + u32(e.quoteTimestamp) + u32(e.fillDeadline) + u32(e.exclusivityDeadline) +
      aw(e.recipient) + b32(e.exclusiveRelayer) + w(320n) + encBytes(e.message) };
}
export function encodeFilledRelayLog(e: FilledRelay): RouterLog {
  return { address: e.spokePool, topics: [ROUTER_TOPICS.filledRelay, '0x' + w(e.originChainId), '0x' + w(e.depositId), e.relayer],
    data: '0x' + aw(e.inputToken) + aw(e.outputToken) + w(e.inputAmount) + w(e.outputAmount) + w(e.repaymentChainId) + u32(e.fillDeadline) + u32(e.exclusivityDeadline) +
      b32(e.exclusiveRelayer) + aw(e.depositor) + aw(e.recipient) + b32(e.messageHash) + aw(e.updatedRecipient) + b32(e.updatedMessageHash) + w(e.updatedOutputAmount) + w(BigInt(e.fillType)) };
}
export function encodeErc20TransferLog(token: string, from: string, to: string, amount: bigint): RouterLog {
  return { address: token, topics: [ROUTER_TOPICS.transfer, toB32(from), toB32(to)], data: '0x' + w(amount) };
}
export function encodeErc20ApprovalLog(token: string, owner: string, spender: string, amount: bigint): RouterLog {
  return { address: token, topics: [ROUTER_TOPICS.approval, toB32(owner), toB32(spender)], data: '0x' + w(amount) };
}

// --- Route-bound artifact chain ---------------------------------------------------------------------------------
const enc = new TextEncoder();
const H = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown) => hashArtifactBytes(kind, enc.encode(JSON.stringify(value)));
export const ROUTER_ARTIFACT_ADAPTER = Object.freeze({ id: 'flofi.router', version: '1.0.0' } as const);
export type RouterArtifactInput = {
  readonly workflow: SemanticWorkflow; readonly nodeId: string; readonly route: CanonicalRoute; readonly routeCommitment: string; readonly owner: string;
  /** Exact Base transactions in order (an approval only when the observed allowance is short, then the deposit). */
  readonly calls: readonly { readonly purpose: 'APPROVAL' | 'BRIDGE_DEPOSIT'; readonly to: string; readonly data: string }[];
  readonly simulation: { readonly block: number; readonly observedAt: string; readonly gasLimitTotal: string; readonly executionFeeUpperBoundWei: string;
    readonly depositId: string | null };
  readonly expiresAt: string;
};
export type RouterArtifacts = { readonly quote: QuoteStateArtifact; readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
  readonly policy: AuthorizationPolicy; readonly manifest: StrategyManifest; readonly plan: ExecutionPlan;
  readonly hashes: { readonly workflow: string; readonly quote: string; readonly artifactSet: string; readonly simulation: string; readonly policy: string;
    readonly manifest: string; readonly plan: string; readonly payloads: readonly string[] } };
/** Provider identity bound by the policy and the Manifest (`FIXED`): routing provider and underlying protocol. */
export const routerProviderId = (route: Pick<CanonicalRoute, 'routingProvider' | 'underlyingProtocol'>) => `${route.routingProvider}:${route.underlyingProtocol}`;
export function compileRouterArtifacts(input: RouterArtifactInput): RouterArtifacts {
  const { workflow, route, owner } = input;
  const src = route.sourceChain, dst = route.destinationChain;
  const inputAsset = { chainId: src, address: route.inputToken.address, decimals: route.inputToken.decimals };
  const outputAsset = { chainId: dst, address: route.outputToken.address, decimals: route.outputToken.decimals };
  const native = { chainId: src, nativeId: 'ETH', decimals: 18 };
  const sourceOwner = { chainId: src, address: owner }, recipient = { chainId: dst, address: route.recipient };
  const workflowHash = H('semantic-workflow', workflow), suffix = input.routeCommitment.slice(2, 26);
  const payloads = input.calls.map(c => hashRawBytes('payload', enc.encode(JSON.stringify({ chainId: src, to: c.to, data: c.data, value: '0x0' }))));
  const ageSeconds = Math.max(1, Math.ceil((Date.parse(input.expiresAt) - Date.parse(input.simulation.observedAt)) / 1000));
  const freshness = { observedAt: input.simulation.observedAt, expiresAt: input.expiresAt, maximumAgeSeconds: ageSeconds };
  const uncertainty = [{ code: 'CROSS_CHAIN_SETTLEMENT_NOT_SIMULATED',
    description: 'Base transactions are simulated with eth_simulateV1; the Across relayer fill on Arbitrum is a provider quote until observed on chain.' }];
  const contracts = [{ chainId: src, address: route.inputToken.address, version: 'pinned' }, { chainId: src, address: route.deposit.to, version: 'pinned' },
    ...route.deposit.to !== route.bridge.originSpokePool ? [{ chainId: src, address: route.bridge.originSpokePool, version: 'pinned' }] : [],
    { chainId: dst, address: route.bridge.destinationSpokePool, version: 'pinned' }];
  const quote = validateArtifact('quote-state-artifact', { schemaVersion: '1.0.0', artifactId: 'router.quote.' + suffix, semanticWorkflowHash: workflowHash,
    nodeId: input.nodeId, sourceId: route.routingProvider === 'lifi' ? 'lifi.live-api' : 'across.swap-api', adapter: ROUTER_ARTIFACT_ADAPTER, chainId: src,
    chainPosition: { kind: 'BLOCK', height: input.simulation.block }, retrievedAt: route.quote.quotedAt,
    freshness: { observedAt: route.quote.quotedAt, expiresAt: route.quote.expiresAt,
      maximumAgeSeconds: Math.max(1, Math.ceil((Date.parse(route.quote.expiresAt) - Date.parse(route.quote.quotedAt)) / 1000)) },
    rawResponseHash: route.quote.rawHash,
    normalizedValues: [{ name: 'route-commitment', kind: 'IDENTIFIER', value: input.routeCommitment },
      { name: 'routing-provider', kind: 'IDENTIFIER', value: route.routingProvider }, { name: 'underlying-protocol', kind: 'IDENTIFIER', value: route.underlyingProtocol },
      { name: 'route-steps', kind: 'IDENTIFIER', value: route.steps.map(s => `${s.kind}:${s.protocol}`).join('.') },
      { name: 'destination-chain', kind: 'IDENTIFIER', value: dst }, { name: 'recipient', kind: 'ACCOUNT', value: recipient },
      { name: 'fill-deadline', kind: 'INTEGER', value: route.bridge.fillDeadline }, { name: 'quote-timestamp', kind: 'INTEGER', value: route.bridge.quoteTimestamp },
      { name: 'deposit-payload-hash', kind: 'IDENTIFIER', value: payloads.at(-1)! }],
    providerReference: { kind: 'ROUTE', id: 'route-' + suffix }, proposedContracts: contracts,
    proposedSpenders: [sourceOwner, { chainId: src, address: route.approval.spender }], proposedRecipients: [recipient],
    fees: [{ asset: inputAsset, amount: route.feeTotal }], gas: [{ asset: native, amount: input.simulation.executionFeeUpperBoundWei }],
    outputBounds: [{ outputId: 'amount-out', expected: { asset: outputAsset, amount: route.expectedOutput }, minimum: { asset: outputAsset, amount: route.minimumOutput },
      adverse: { asset: outputAsset, amount: route.minimumOutput } }],
    uncertainty, registryValidation: { registryVersion: '1.1.0', actionType: 'asset.bridge', result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' } });
  const quoteHash = H('quote-state-artifact', quote);
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: 'router.set.' + suffix, semanticWorkflowHash: workflowHash,
    artifacts: [{ artifactId: quote.artifactId, nodeId: input.nodeId, artifactHash: quoteHash }] });
  const artifactSetHash = H('artifact-set', artifactSet);
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: 'router.simulation.' + suffix,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, adapters: [ROUTER_ARTIFACT_ADAPTER], contracts,
    outputs: [{ nodeId: input.nodeId, outputId: 'amount-out', expected: { asset: outputAsset, amount: route.expectedOutput },
      minimum: { asset: outputAsset, amount: route.minimumOutput }, adverse: { asset: outputAsset, amount: route.minimumOutput } }],
    propagatedOutputs: [], failurePaths: [{ failedNodeId: input.nodeId, blockedNodeIds: [], residualAssets: [{ asset: inputAsset, amount: route.inputAmount }] }],
    uncertainty, unsupportedAssumptions: ['The destination fill is not simulated: it is delivered by an Across relayer and proven only by on-chain observation.',
      'An unfilled deposit is refunded on the source chain after its fill deadline; refund timing depends on Across settlement.'], freshness });
  const simulationHash = H('simulation-bundle', simulation);
  const recovery = { failurePolicy: 'PAUSE_FOR_APPROVAL' as const, residualAssetRecipient: sourceOwner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const spendLimits = [{ asset: inputAsset, maximumAmount: route.inputAmount, maximumPerStepAmount: route.inputAmount, maximumCumulativeAmount: route.inputAmount }];
  const gasBudgets = [{ asset: native, maximumAmount: input.simulation.executionFeeUpperBoundWei }];
  const feeBudgets = [{ asset: inputAsset, maximumAmount: route.feeTotal }];
  const providers = { kind: 'FIXED' as const, providerId: routerProviderId(route) };
  const functions = input.calls.map(c => ({ chainId: src, contract: c.to, functionId: c.data.slice(0, 10) }));
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: 'router.policy.' + suffix, semanticWorkflowHash: workflowHash,
    artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_A',
    allowlists: { owners: [sourceOwner], accounts: [sourceOwner], recipients: [recipient], chains: [src, dst], adapters: [ROUTER_ARTIFACT_ADAPTER],
      protocols: [...new Set<string>([route.routingProvider, route.underlyingProtocol])], contracts, functions },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: route.slippageBps, gasBudgets, feeBudgets, oracleRules: [], accountRiskRules: [], checkpointRules: [], providers, nonce: '0',
    deadline: input.expiresAt, revocationEpoch: 0, recovery, enforcement: 'NOT_ENFORCED' });
  const policyHash = H('authorization-policy', policy);
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: 'router.manifest.' + suffix, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner: sourceOwner, executor: null,
    expiresAt: input.expiresAt, nonce: '0', revocationEpoch: 0, spendLimits, maximumSlippageBps: route.slippageBps, gasBudgets, feeBudgets, providers, recovery,
    enforcement: 'NOT_ENFORCED' });
  const manifestHash = H('strategy-manifest', manifest);
  const steps = input.calls.map((c, i) => ({ stepId: c.purpose === 'APPROVAL' ? 'router.step.approval' : 'router.step.deposit', nodeId: input.nodeId, chainId: src,
    adapter: ROUTER_ARTIFACT_ADAPTER, dependencies: i === 0 ? [] : ['router.step.approval'], requiredAuthorizationClass: 'MODE_A' as const,
    executionKind: 'DIRECT_TRANSACTION' as const, payloadHash: payloads[i]! }));
  const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: 'router.plan.' + suffix, semanticWorkflowHash: workflowHash, manifestHash,
    segments: [{ segmentId: 'router.segment.source', chainId: src, dependencies: [], steps }],
    checkpointIds: ['router.source-confirmation', 'router.destination-fill', 'router.destination-reconciliation'], enforcement: 'NOT_ENFORCED' });
  return { quote, artifactSet, simulation, policy, manifest, plan, hashes: { workflow: workflowHash, quote: quoteHash, artifactSet: artifactSetHash,
    simulation: simulationHash, policy: policyHash, manifest: manifestHash, plan: H('execution-plan', plan), payloads } };
}

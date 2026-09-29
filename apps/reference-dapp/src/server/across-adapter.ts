// SPDX-License-Identifier: AGPL-3.0-only
/** Direct Across Swap API. All HTTP reads stay on the server; financial actions are never sent. */
import { createHash } from 'node:crypto';
import { BRIDGE_SOURCE_USDC } from '@defi-workflow-engine/workflow-contracts';
import { ARBITRUM_USDC } from '../domain/bridge-swap-authoring';
export const BASE_SPOKE_POOL = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64';
export const BASE_PERIPHERY = '0x97ccdbea4632140639ad5ea9b944aa034eb15fd4';
const TARGETS = [BASE_SPOKE_POOL, BASE_PERIPHERY];
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const POSITIVE = /^[1-9][0-9]{0,77}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const rec = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ACROSS_RESPONSE_INVALID');
  return value as Record<string, unknown>;
};
const addr = (value: unknown): string => {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('ACROSS_ADDRESS_INVALID');
  return value.toLowerCase();
};
const units = (value: unknown): string => {
  if (typeof value !== 'string' || !POSITIVE.test(value)) throw new Error('ACROSS_AMOUNT_INVALID');
  return value;
};
const data = (value: unknown): string => {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value) || value.length > 100_000) throw new Error('ACROSS_CALLDATA_INVALID');
  return value.toLowerCase();
};
export type AcrossQuote = {
  readonly provider: 'across.direct'; readonly provenance: 'LIVE_READ_ONLY' | 'DETERMINISTIC_FIXTURE';
  readonly quoteId: string; readonly rawHash: string; readonly owner: string;
  readonly sourceChainId: 8453; readonly destinationChainId: 42161;
  readonly inputToken: typeof BRIDGE_SOURCE_USDC; readonly outputToken: typeof ARBITRUM_USDC;
  readonly inputAmount: string; readonly expectedOutput: string; readonly minimumOutput: string;
  readonly allowance: string; readonly approvalSpender: string;
  readonly approvals: readonly { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0' }[];
  readonly deposit: { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0'; readonly gas: string };
  readonly refundAddress: string; readonly refundOnOrigin: true; readonly feeMaximum: string; readonly maximumGasCostWei: string;
  readonly observedAt: string; readonly quoteExpiresAt: string; readonly expectedFillSeconds: number;
};
export function normalizeAcrossQuote(raw: unknown, ownerInput: string, amountInput: string, nowMs: number,
  provenance: AcrossQuote['provenance']): AcrossQuote {
  const owner = addr(ownerInput), inputAmount = units(amountInput), q = rec(raw);
  const bridge = rec(rec(q.steps).bridge), input = rec(bridge.tokenIn), output = rec(bridge.tokenOut);
  const checks = rec(q.checks), allowance = rec(checks.allowance), tx = rec(q.swapTx);
  const expectedOutput = units(q.expectedOutputAmount), minimumOutput = units(q.minOutputAmount);
  const totalMax = rec(rec(q.fees).totalMax);
  const feeMaximum = units(totalMax.amount);
  const feeToken = rec(totalMax.token);
  const maximumGasCostWei = (BigInt(units(tx.gas)) * BigInt(units(tx.maxFeePerGas))).toString();
  const spender = addr(allowance.spender), target = addr(tx.to);
  const quoteInput = rec(q.inputToken), quoteOutput = rec(q.outputToken), refundToken = rec(q.refundToken);
  if (q.crossSwapType !== 'bridgeableToBridgeable' || q.amountType !== 'exactInput'
    || rec(q.steps).originSwap != null || rec(q.steps).destinationSwap != null
    || bridge.provider !== 'across'
    || units(q.inputAmount) !== inputAmount || units(bridge.inputAmount) !== inputAmount
    || addr(input.address) !== BRIDGE_SOURCE_USDC || input.chainId !== 8453 || input.decimals !== 6
    || addr(output.address) !== ARBITRUM_USDC || output.chainId !== 42161 || output.decimals !== 6
    || addr(quoteInput.address) !== BRIDGE_SOURCE_USDC || quoteInput.chainId !== 8453 || quoteInput.decimals !== 6
    || addr(quoteOutput.address) !== ARBITRUM_USDC || quoteOutput.chainId !== 42161 || quoteOutput.decimals !== 6
    || addr(refundToken.address) !== BRIDGE_SOURCE_USDC || refundToken.chainId !== 8453
    || addr(feeToken.address) !== BRIDGE_SOURCE_USDC || feeToken.chainId !== 8453 || feeToken.decimals !== 6
    || units(bridge.outputAmount) !== minimumOutput || BigInt(minimumOutput) > BigInt(expectedOutput)
    || addr(allowance.token) !== BRIDGE_SOURCE_USDC || units(allowance.expected) !== inputAmount
    || !TARGETS.includes(spender) || !TARGETS.includes(target) || spender !== target
    || tx.chainId !== 8453 || tx.simulationSuccess !== true || tx.value != null && tx.value !== '0' && tx.value !== '0x0'
    || typeof tx.gas !== 'string' || !POSITIVE.test(tx.gas)
    || typeof tx.maxFeePerGas !== 'string' || !POSITIVE.test(tx.maxFeePerGas)
    || tx.maxPriorityFeePerGas != null && BigInt(String(tx.maxPriorityFeePerGas)) > BigInt(tx.maxFeePerGas)
    || typeof q.expectedFillTime !== 'number' || !Number.isFinite(q.expectedFillTime) || q.expectedFillTime < 0
    || typeof q.quoteExpiryTimestamp !== 'number' || !Number.isSafeInteger(q.quoteExpiryTimestamp)
    || q.quoteExpiryTimestamp * 1000 <= nowMs || q.quoteExpiryTimestamp * 1000 - nowMs > 14_400_000
    || typeof q.id !== 'string' || q.id.length < 1 || q.id.length > 128)
    throw new Error('ACROSS_ROUTE_UNSUPPORTED');
  const approvalRaw = q.approvalTxns ?? [];
  if (!Array.isArray(approvalRaw) || approvalRaw.length > 1) throw new Error('ACROSS_APPROVAL_UNSUPPORTED');
  const approvals = approvalRaw.map(item => {
    const a = rec(item), payload = data(a.data), to = addr(a.to);
    if (a.chainId !== 8453 || to !== BRIDGE_SOURCE_USDC || !payload.startsWith('0x095ea7b3')
      || payload.length !== 138 || payload.slice(10, 74) !== spender.slice(2).padStart(64, '0')
      || BigInt('0x' + payload.slice(74)) !== BigInt(inputAmount)) throw new Error('ACROSS_APPROVAL_UNSUPPORTED');
    return { chainId: 8453 as const, to, data: payload, value: '0x0' as const };
  });
  if (approvals.length === 0 && BigInt(String(allowance.actual ?? '0')) < BigInt(inputAmount)) throw new Error('ACROSS_APPROVAL_MISSING');
  const serialized = JSON.stringify(raw);
  if (serialized.length > 200_000) throw new Error('ACROSS_RESPONSE_TOO_LARGE');
  return { provider: 'across.direct', provenance, quoteId: q.id, rawHash: '0x' + createHash('sha256').update(serialized).digest('hex'),
    owner, sourceChainId: 8453, destinationChainId: 42161, inputToken: BRIDGE_SOURCE_USDC,
    outputToken: ARBITRUM_USDC, inputAmount, expectedOutput, minimumOutput, allowance: String(allowance.actual ?? '0'),
    approvalSpender: spender, approvals, deposit: { chainId: 8453, to: target, data: data(tx.data), value: '0x0', gas: tx.gas },
    refundAddress: owner, refundOnOrigin: true, feeMaximum, maximumGasCostWei, observedAt: new Date(nowMs).toISOString(),
    quoteExpiresAt: new Date(q.quoteExpiryTimestamp * 1000).toISOString(), expectedFillSeconds: q.expectedFillTime };
}
export function fixtureAcrossQuote(owner: string, amount: string, nowMs: number): AcrossQuote {
  const output = BigInt(amount) - BigInt(amount) / 1000n;
  const spender = BASE_SPOKE_POOL;
  const raw = { id: 'across-fixture-v1', crossSwapType: 'bridgeableToBridgeable', amountType: 'exactInput',
    inputAmount: amount, expectedOutputAmount: output.toString(), minOutputAmount: output.toString(), expectedFillTime: 120,
    quoteExpiryTimestamp: Math.floor(nowMs / 1000) + 300,
    checks: { allowance: { token: BRIDGE_SOURCE_USDC, spender, actual: '0', expected: amount } },
    steps: { bridge: { inputAmount: amount, outputAmount: output.toString(),
      tokenIn: { address: BRIDGE_SOURCE_USDC, chainId: 8453, decimals: 6 },
      tokenOut: { address: ARBITRUM_USDC, chainId: 42161, decimals: 6 }, provider: 'across' } },
    inputToken: { address: BRIDGE_SOURCE_USDC, chainId: 8453, decimals: 6 },
    outputToken: { address: ARBITRUM_USDC, chainId: 42161, decimals: 6 },
    refundToken: { address: BRIDGE_SOURCE_USDC, chainId: 8453, decimals: 6 },
    fees: { totalMax: { amount: '1000', token: { address: BRIDGE_SOURCE_USDC, chainId: 8453, decimals: 6 } } },
    approvalTxns: [{ chainId: 8453, to: BRIDGE_SOURCE_USDC, data: '0x095ea7b3' + spender.slice(2).padStart(64, '0') + BigInt(amount).toString(16).padStart(64, '0') }],
    swapTx: { chainId: 8453, to: spender, data: '0x110560ad' + '00'.repeat(32), gas: '250000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000', simulationSuccess: true } };
  return normalizeAcrossQuote(raw, owner, amount, nowMs, 'DETERMINISTIC_FIXTURE');
}
export async function requestAcrossQuote(owner: string, amount: string, slippageBps: number, nowMs = Date.now()): Promise<AcrossQuote> {
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 300) throw new Error('ACROSS_SLIPPAGE_INVALID');
  const key = process.env.ACROSS_API_KEY, integratorId = process.env.ACROSS_INTEGRATOR_ID;
  if (!key || !integratorId) return fixtureAcrossQuote(owner, amount, nowMs);
  if (!/^0x[0-9a-fA-F]{4}$/.test(integratorId)) throw new Error('ACROSS_CONFIGURATION_INVALID');
  const params = new URLSearchParams({ tradeType: 'exactInput', strictTradeType: 'true',
    originChainId: '8453', destinationChainId: '42161', inputToken: BRIDGE_SOURCE_USDC,
    outputToken: ARBITRUM_USDC, amount, depositor: owner, recipient: owner,
    refundAddress: owner, refundOnOrigin: 'true', slippage: String(slippageBps / 10_000), integratorId });
  const response = await fetch('https://app.across.to/api/swap/approval?' + params, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('ACROSS_HTTP_' + response.status);
  if (Number(response.headers.get('content-length') ?? '0') > 200_000) throw new Error('ACROSS_RESPONSE_TOO_LARGE');
  const text = await response.text(); if (text.length > 200_000) throw new Error('ACROSS_RESPONSE_TOO_LARGE');
  return normalizeAcrossQuote(JSON.parse(text) as unknown, owner, amount, nowMs, 'LIVE_READ_ONLY');
}
export type AcrossStatus = { readonly status: 'received' | 'pending' | 'filled' | 'expired' | 'refunded'; readonly depositTxHash: string;
  readonly fillTxHash: string | null; readonly refundTxHash: string | null };
export function normalizeAcrossStatus(raw: unknown, depositTxHash: string): AcrossStatus {
  const value = rec(raw);
  if (!['received', 'pending', 'filled', 'expired', 'refunded'].includes(String(value.status)) || !HASH.test(depositTxHash)) throw new Error('ACROSS_STATUS_INVALID');
  const fillTxHash = value.fillTxnRef ?? value.fillTx ?? null;
  const refundTxHash = value.depositRefundTxnRef ?? value.depositRefundTxHash ?? null;
  if (value.depositTxnRef != null && String(value.depositTxnRef).toLowerCase() !== depositTxHash
    || value.originChainId != null && value.originChainId !== 8453
    || value.destinationChainId != null && value.destinationChainId !== 42161) throw new Error('ACROSS_STATUS_INVALID');
  if (fillTxHash !== null && (typeof fillTxHash !== 'string' || !HASH.test(fillTxHash.toLowerCase()))) throw new Error('ACROSS_STATUS_INVALID');
  if (refundTxHash !== null && (typeof refundTxHash !== 'string' || !HASH.test(refundTxHash.toLowerCase()))) throw new Error('ACROSS_STATUS_INVALID');
  return { status: value.status as AcrossStatus['status'], depositTxHash,
    fillTxHash: typeof fillTxHash === 'string' ? fillTxHash.toLowerCase() : null,
    refundTxHash: typeof refundTxHash === 'string' ? refundTxHash.toLowerCase() : null };
}
export async function requestAcrossStatus(depositTxHash: string): Promise<AcrossStatus> {
  if (!HASH.test(depositTxHash)) throw new Error('ACROSS_STATUS_INPUT_INVALID');
  const key = process.env.ACROSS_API_KEY, integratorId = process.env.ACROSS_INTEGRATOR_ID;
  if (!key || !integratorId) throw new Error('ACROSS_LIVE_STATUS_UNAVAILABLE');
  if (!/^0x[0-9a-fA-F]{4}$/.test(integratorId)) throw new Error('ACROSS_CONFIGURATION_INVALID');
  const params = new URLSearchParams({ depositTxnRef: depositTxHash, integratorId });
  const response = await fetch('https://app.across.to/api/deposit/status?' + params,
    { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('ACROSS_STATUS_HTTP_' + response.status);
  if (Number(response.headers.get('content-length') ?? '0') > 200_000) throw new Error('ACROSS_RESPONSE_TOO_LARGE');
  const text = await response.text(); if (text.length > 200_000) throw new Error('ACROSS_RESPONSE_TOO_LARGE');
  return normalizeAcrossStatus(JSON.parse(text) as unknown, depositTxHash);
}

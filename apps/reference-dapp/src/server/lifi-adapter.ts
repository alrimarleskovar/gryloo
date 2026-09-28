// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only LI.FI adapter. It never signs, broadcasts or follows a provider redirect. */
import { createHash } from 'node:crypto';
import { BRIDGE_SOURCE_USDC, BRIDGE_DESTINATION_USDC } from '@defi-workflow-engine/workflow-contracts';

export type LifiFee = { readonly name: string; readonly amount: string; readonly symbol: string; readonly tokenChainId: number; readonly tokenAddress: string; readonly decimals: number; readonly included: boolean };
export type LifiQuote = {
  readonly routeId: string; readonly provider: string; readonly includedSteps: readonly { readonly type: string; readonly tool: string }[];
  readonly owner: string; readonly amountIn: string; readonly expectedOut: string; readonly minimumOut: string;
  readonly slippageBps: number; readonly approvalSpender: string;
  readonly fees: readonly LifiFee[]; readonly gas: readonly LifiFee[];
  readonly transaction: { readonly from: string; readonly to: string; readonly data: string; readonly value: '0x0'; readonly chainId: 8453; readonly gasLimit: string; readonly gasPrice: string };
  readonly observedAt: string; readonly expiresAt: string; readonly rawHash: string; readonly raw: unknown;
};
export type LifiTransport = (url: string) => Promise<unknown>;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
const decimal = (value: unknown) => typeof value === 'string' && /^[0-9]+$/.test(value);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LIFI_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}
function address(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('LIFI_ADDRESS_INVALID');
  return value.toLowerCase();
}
async function liveJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': 'Gryloo/BUILD-008', Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (!response.ok) throw new Error('LIFI_HTTP_' + response.status);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 3_000_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  return JSON.parse(body) as unknown;
}
export function resolveUsdcTokens(input: unknown): { source: string; destination: string } {
  const tokens = record(record(input).tokens);
  function one(chain: string, expected: string): string {
    const list = tokens[chain];
    if (!Array.isArray(list)) throw new Error('LIFI_TOKEN_CATALOG_INVALID');
    const matches = list.filter(item => {
      const t = record(item);
      return t.symbol === 'USDC' && t.coinKey === 'USDC' && t.decimals === 6 && t.chainId === Number(chain)
        && typeof t.address === 'string' && t.address.toLowerCase() === expected;
    });
    if (matches.length !== 1) throw new Error('LIFI_USDC_UNAVAILABLE');
    return address(record(matches[0]).address);
  }
  return { source: one('8453', BRIDGE_SOURCE_USDC), destination: one('10', BRIDGE_DESTINATION_USDC) };
}
function fees(input: unknown): LifiFee[] {
  if (!Array.isArray(input) || input.length > 24) throw new Error('LIFI_FEES_INVALID');
  return input.map(item => {
    const f = record(item), token = record(f.token);
    if (typeof f.name !== 'string' && typeof f.type !== 'string' || !decimal(f.amount)
      || typeof token.symbol !== 'string' || token.symbol.length > 24
      || !Number.isSafeInteger(token.chainId) || !Number.isSafeInteger(token.decimals) || typeof token.address !== 'string') throw new Error('LIFI_FEES_INVALID');
    return { name: String(f.name ?? f.type).slice(0, 80), amount: f.amount as string,
      symbol: token.symbol, tokenChainId: token.chainId as number, tokenAddress: address(token.address),
      decimals: token.decimals as number, included: f.included === true };
  });
}
export function normalizeLifiQuote(input: unknown, ownerInput: string, amountIn: string, slippageBps: number, nowMs: number): LifiQuote {
  const owner = address(ownerInput), q = record(input), action = record(q.action), estimate = record(q.estimate),
    fromToken = record(action.fromToken), toToken = record(action.toToken), tx = record(q.transactionRequest);
  if (!Number.isSafeInteger(nowMs) || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 300
    || !decimal(amountIn) || BigInt(amountIn) < 1n || q.type !== 'lifi'
    || typeof q.id !== 'string' || q.id.length > 128 || typeof q.tool !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(q.tool)
    || action.fromChainId !== 8453 || action.toChainId !== 10 || action.fromAmount !== amountIn
    || address(action.fromAddress) !== owner || address(action.toAddress) !== owner
    || address(fromToken.address) !== BRIDGE_SOURCE_USDC || address(toToken.address) !== BRIDGE_DESTINATION_USDC
    || fromToken.decimals !== 6 || toToken.decimals !== 6
    || typeof action.slippage !== 'number' || Math.abs(action.slippage - slippageBps / 10_000) > 0.0000001
    || !decimal(estimate.toAmount) || !decimal(estimate.toAmountMin)
    || BigInt(estimate.toAmountMin as string) < 1n || BigInt(estimate.toAmountMin as string) > BigInt(estimate.toAmount as string))
    throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const steps = q.includedSteps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const includedSteps = steps.map(item => {
    const s = record(item);
    if (typeof s.type !== 'string' || typeof s.tool !== 'string' || s.type.length > 40 || s.tool.length > 80)
      throw new Error('LIFI_ROUTE_UNSUPPORTED');
    return { type: s.type, tool: s.tool };
  });
  if (includedSteps.filter(s => s.type === 'cross').length !== 1
    || includedSteps.some(s => !['cross', 'protocol'].includes(s.type))) throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const spender = address(estimate.approvalAddress);
  if (tx.chainId !== 8453 || address(tx.from) !== owner || address(tx.to) !== spender
    || tx.value !== '0x0' || typeof tx.data !== 'string' || !HEX.test(tx.data) || tx.data.length > 100_000
    || typeof tx.gasLimit !== 'string' || !/^0x[0-9a-fA-F]+$/.test(tx.gasLimit)
    || typeof tx.gasPrice !== 'string' || !/^0x[0-9a-fA-F]+$/.test(tx.gasPrice)) throw new Error('LIFI_TRANSACTION_UNSUPPORTED');
  const rawText = JSON.stringify(input);
  if (rawText.length > 200_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  const observedAt = new Date(nowMs).toISOString(), expiresAt = new Date(nowMs + 60_000).toISOString();
  return { routeId: q.id, provider: q.tool, includedSteps, owner, amountIn,
    expectedOut: estimate.toAmount as string, minimumOut: estimate.toAmountMin as string, slippageBps,
    approvalSpender: spender, fees: fees(estimate.feeCosts), gas: fees(estimate.gasCosts),
    transaction: { from: owner, to: spender, data: tx.data.toLowerCase(), value: '0x0', chainId: 8453, gasLimit: tx.gasLimit.toLowerCase(), gasPrice: tx.gasPrice.toLowerCase() },
    observedAt, expiresAt, rawHash: '0x' + createHash('sha256').update(rawText).digest('hex'), raw: input };
}
export async function requestLifiQuote(owner: string, amountIn: string, slippageBps: number,
  transport: LifiTransport = liveJson, nowMs = Date.now()): Promise<LifiQuote> {
  address(owner);
  const catalog = resolveUsdcTokens(await transport('https://li.quest/v1/tokens?chains=8453,10'));
  const params = new URLSearchParams({ fromChain: '8453', toChain: '10', fromToken: catalog.source,
    toToken: catalog.destination, fromAmount: amountIn, fromAddress: owner, toAddress: owner,
    slippage: String(slippageBps / 10_000), allowDestinationCall: 'false', integrator: 'gryloo' });
  return normalizeLifiQuote(await transport('https://li.quest/v1/quote?' + params), owner, amountIn, slippageBps, nowMs);
}

// SPDX-License-Identifier: AGPL-3.0-only
/** Strict read-only LI.FI quote profile for BUILD-009. Never broadcasts or signs. */
import { createHash } from 'node:crypto';
import { ARBITRUM_USDC, ARBITRUM_WETH } from '../domain/bridge-swap-authoring';
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export type Stage = 'bridge' | 'swap';
export type Build009Quote = { readonly stage: Stage; readonly routeId: string; readonly provider: string;
  readonly owner: string; readonly fromChainId: number; readonly toChainId: number;
  readonly fromToken: string; readonly toToken: string; readonly amountIn: string;
  readonly expectedOut: string; readonly minimumOut: string; readonly approvalSpender: string;
  readonly transaction: { readonly chainId: number; readonly from: string; readonly to: string;
    readonly data: string; readonly value: '0x0'; readonly gasLimit: string; readonly gasPrice: string };
  readonly observedAt: string; readonly expiresAt: string; readonly rawHash: string };
type Transport = (url: string) => Promise<unknown>;
function rec(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LIFI_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}
function address(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('LIFI_ADDRESS_INVALID');
  return value.toLowerCase();
}
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value)) throw new Error('LIFI_AMOUNT_INVALID');
  return value;
}
async function live(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Gryloo/BUILD-009' },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('LIFI_HTTP_' + response.status);
  if (Number(response.headers.get('content-length') ?? '0') > 3_000_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  const body = await response.text();
  if (body.length > 3_000_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  return JSON.parse(body) as unknown;
}
function catalogToken(data: unknown, chain: string, symbol: string, expected: string, decimals: number): string {
  const list = rec(rec(data).tokens)[chain];
  if (!Array.isArray(list)) throw new Error('LIFI_CATALOG_INVALID');
  const matches = list.filter(item => {
    const token = rec(item);
    return token.symbol === symbol && token.coinKey === symbol && token.chainId === Number(chain)
      && token.decimals === decimals && address(token.address) === expected;
  });
  if (matches.length !== 1) throw new Error('LIFI_TOKEN_UNAVAILABLE');
  return expected;
}
export function normalizeBuild009Quote(input: unknown, stage: Stage, ownerInput: string, amountInput: string,
  slippageBps: number, nowMs: number): Build009Quote {
  const owner = address(ownerInput), inputAmount = amount(amountInput);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 300 || !Number.isSafeInteger(nowMs))
    throw new Error('LIFI_REQUEST_INVALID');
  const fromChainId = stage === 'bridge' ? 8453 : 42161;
  const toChainId = 42161;
  const fromToken = stage === 'bridge' ? BASE_USDC : ARBITRUM_USDC;
  const toToken = stage === 'bridge' ? ARBITRUM_USDC : ARBITRUM_WETH;
  const q = rec(input), action = rec(q.action), estimate = rec(q.estimate), tx = rec(q.transactionRequest);
  const from = rec(action.fromToken), to = rec(action.toToken);
  if (q.type !== 'lifi' || typeof q.id !== 'string' || q.id.length < 1 || q.id.length > 128
    || typeof q.tool !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(q.tool)
    || action.fromChainId !== fromChainId || action.toChainId !== toChainId
    || action.fromAmount !== inputAmount || address(action.fromAddress) !== owner || address(action.toAddress) !== owner
    || address(from.address) !== fromToken || address(to.address) !== toToken
    || from.decimals !== 6 || to.decimals !== (stage === 'bridge' ? 6 : 18)
    || typeof action.slippage !== 'number' || Math.abs(action.slippage - slippageBps / 10000) > 0.0000001)
    throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const expectedOut = amount(estimate.toAmount), minimumOut = amount(estimate.toAmountMin);
  if (BigInt(minimumOut) > BigInt(expectedOut)) throw new Error('LIFI_OUTPUT_INVALID');
  const steps = q.includedSteps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 12) throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const kinds = steps.map(item => rec(item).type);
  if (stage === 'bridge' ? kinds.filter(k => k === 'cross').length !== 1 || kinds.some(k => k !== 'cross' && k !== 'protocol')
    : kinds.filter(k => k === 'swap').length !== 1 || kinds.some(k => k !== 'swap' && k !== 'protocol'))
    throw new Error('LIFI_ROUTE_UNSUPPORTED');
  const approvalSpender = address(estimate.approvalAddress);
  const transaction = { chainId: tx.chainId as number, from: address(tx.from), to: address(tx.to),
    data: tx.data as string, value: tx.value as '0x0', gasLimit: tx.gasLimit as string, gasPrice: tx.gasPrice as string };
  if (transaction.chainId !== fromChainId || transaction.from !== owner || transaction.to !== approvalSpender
    || transaction.value !== '0x0' || typeof transaction.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(transaction.data)
    || transaction.data.length > 100_000 || !/^0x[0-9a-fA-F]+$/.test(transaction.gasLimit)
    || !/^0x[0-9a-fA-F]+$/.test(transaction.gasPrice)) throw new Error('LIFI_TRANSACTION_UNSUPPORTED');
  const raw = JSON.stringify(input);
  if (raw.length > 200_000) throw new Error('LIFI_RESPONSE_TOO_LARGE');
  return { stage, routeId: q.id, provider: q.tool, owner, fromChainId, toChainId, fromToken, toToken,
    amountIn: inputAmount, expectedOut, minimumOut, approvalSpender, transaction: { ...transaction, data: transaction.data.toLowerCase(),
      gasLimit: transaction.gasLimit.toLowerCase(), gasPrice: transaction.gasPrice.toLowerCase() },
    observedAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 60_000).toISOString(),
    rawHash: '0x' + createHash('sha256').update(raw).digest('hex') };
}
export async function requestBuild009Quote(stage: Stage, owner: string, amountIn: string, slippageBps: number,
  transport: Transport = live, nowMs = Date.now()): Promise<Build009Quote> {
  address(owner); amount(amountIn);
  if (stage !== 'bridge' && stage !== 'swap') throw new Error('LIFI_STAGE_INVALID');
  const tokenData = await transport(`https://li.quest/v1/tokens?chains=${stage === 'bridge' ? '8453,42161' : '42161'}`);
  if (stage === 'bridge') catalogToken(tokenData, '8453', 'USDC', BASE_USDC, 6);
  catalogToken(tokenData, '42161', 'USDC', ARBITRUM_USDC, 6);
  if (stage === 'swap') catalogToken(tokenData, '42161', 'WETH', ARBITRUM_WETH, 18);
  const params = new URLSearchParams({ fromChain: stage === 'bridge' ? '8453' : '42161', toChain: '42161',
    fromToken: stage === 'bridge' ? BASE_USDC : ARBITRUM_USDC, toToken: stage === 'bridge' ? ARBITRUM_USDC : ARBITRUM_WETH,
    fromAmount: amountIn, fromAddress: owner, toAddress: owner, slippage: String(slippageBps / 10000),
    integrator: 'gryloo', ...(stage === 'bridge' ? { allowDestinationCall: 'false' } : {}) });
  return normalizeBuild009Quote(await transport('https://li.quest/v1/quote?' + params), stage, owner, amountIn, slippageBps, nowMs);
}

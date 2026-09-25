// SPDX-License-Identifier: AGPL-3.0-only
import { SWAP_ROUTER_02 } from './abi.js';
import { FORK_CHAIN_ID, SOURCE_CHAIN_ID } from './profile.js';

export const FORK_FEE_TIERS = [100, 500, 3000, 10000] as const;
export const BASE_CODE_PINS = Object.freeze({
  usdc: '0x98d785fcb1bf847f287adc2310759fd94cc13e754b974bc72131382e8266f607',
  weth: '0x667c900c2c6da80d452501a9c6332e046384a0c438c3334ce6f71c86dd7b8735',
  factory: '0x8545609892cc8d7d608dd4420ee110ab98448730570824fb029228e33846d28c',
  quoter: '0xa204e355059d9c809bfc026503d49b4ecf8655f482a76040dec4bcb4618047b4',
});
export type ForkTier = { readonly fee: number; readonly pool: string | null;
  readonly status: 'NO_POOL' | 'QUOTED' | 'FULL_INPUT_NOT_PROVEN' | 'ZERO_OUTPUT' | 'QUOTE_REVERTED';
  readonly amountOut: bigint | null; readonly fullInputProven: boolean };
export type ForkQuoteFacts = {
  readonly executionChainId: number; readonly sourceChainId: number;
  readonly sourceBlockHash: string; readonly block: { readonly number: number; readonly hash: string; readonly timestamp: bigint };
  readonly finalBlockHash: string; readonly finalBlockTimestamp: bigint;
  readonly codeHashes: Readonly<Record<keyof typeof BASE_CODE_PINS | 'router', string>>;
  readonly reviewedRouterCodeHash: string; readonly router: string;
  readonly factoryMatches: boolean; readonly weth9Matches: boolean;
  readonly tokenMetadataMatches: boolean; readonly ownerCode: string;
  readonly ownerBalance: bigint; readonly ownerEthBalance: bigint;
  readonly ownerAllowance: bigint; readonly ownerNonce: bigint;
  readonly tiers: readonly ForkTier[]; readonly selectedFee: number | null;
};
export type SelectedForkQuote = { readonly fee: 100 | 500 | 3000 | 10000;
  readonly amountOut: bigint; readonly minimumOut: bigint; readonly blockHash: string; readonly expiresAt: bigint };
export function validateForkQuote(facts: ForkQuoteFacts, nowForkSeconds: bigint,
  amountIn: bigint, slippageBps: number): SelectedForkQuote {
  const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
  if (facts.executionChainId !== FORK_CHAIN_ID || facts.sourceChainId !== SOURCE_CHAIN_ID) throw new Error('FORK_CHAIN_MISMATCH');
  if (!hash(facts.sourceBlockHash) || !hash(facts.block.hash)
    || facts.block.hash !== facts.finalBlockHash || facts.block.timestamp !== facts.finalBlockTimestamp
    || !Number.isSafeInteger(facts.block.number) || facts.block.number < 0) throw new Error('FORK_SOURCE_MISMATCH');
  if (nowForkSeconds < facts.block.timestamp || nowForkSeconds >= facts.block.timestamp + 60n) throw new Error('QUOTE_EXPIRED');
  if (facts.router !== SWAP_ROUTER_02 || !hash(facts.reviewedRouterCodeHash)
    || facts.codeHashes.router !== facts.reviewedRouterCodeHash) throw new Error('CODE_DIGEST_MISMATCH');
  for (const name of Object.keys(BASE_CODE_PINS) as (keyof typeof BASE_CODE_PINS)[]) {
    if (facts.codeHashes[name] !== BASE_CODE_PINS[name]) throw new Error('CODE_DIGEST_MISMATCH');
  }
  if (!facts.factoryMatches || !facts.weth9Matches || !facts.tokenMetadataMatches) throw new Error('DEPLOYMENT_MISMATCH');
  if (facts.ownerCode !== '0x') throw new Error('OWNER_HAS_CODE');
  if (amountIn <= 0n || facts.ownerBalance < amountIn || facts.ownerNonce < 0n) throw new Error('INSUFFICIENT_BALANCE');
  if (facts.ownerEthBalance <= 0n) throw new Error('INSUFFICIENT_GAS_BALANCE');
  if (facts.ownerAllowance !== 0n) throw new Error('PRE_EXISTING_ALLOWANCE');
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 300) throw new Error('SLIPPAGE_INVALID');
  if (facts.tiers.length !== FORK_FEE_TIERS.length || facts.tiers.some((tier, index) => tier.fee !== FORK_FEE_TIERS[index])) {
    throw new Error('TIER_ORDER_INVALID');
  }
  for (const row of facts.tiers) {
    if (row.status === 'QUOTED' && (!row.fullInputProven || row.amountOut === null || row.amountOut <= 0n || row.pool === null)) throw new Error('FULL_INPUT_NOT_PROVEN');
    if (row.status === 'NO_POOL' && (row.pool !== null || row.amountOut !== null)) throw new Error('TIER_STATUS_INVALID');
  }
  const tier = facts.tiers.find(item => item.fee === facts.selectedFee);
  if (facts.selectedFee === null) throw new Error('TIER_NOT_SELECTED');
  if (!tier || tier.status !== 'QUOTED' || !tier.fullInputProven || tier.amountOut === null || tier.amountOut <= 0n
    || !tier.pool || !/^0x[0-9a-f]{40}$/.test(tier.pool)) throw new Error('NO_QUOTED_TIER');
  return { fee: tier.fee as SelectedForkQuote['fee'], amountOut: tier.amountOut,
    minimumOut: tier.amountOut * BigInt(10_000 - slippageBps) / 10_000n,
    blockHash: facts.block.hash, expiresAt: facts.block.timestamp + 60n };
}

export const FORK_CONTRACTS = Object.freeze({
  usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  weth: '0x4200000000000000000000000000000000000006',
  factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
  quoter: '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
  router: SWAP_ROUTER_02,
});
export type ForkQuoteQuery =
  | { readonly kind: 'CHAIN' | 'METADATA' | 'LATEST'; readonly blockHash?: never }
  | { readonly kind: 'CODE'; readonly address: string; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'TOKEN_METADATA'; readonly address: string; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'DEPLOYMENT'; readonly address: string; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'POOL'; readonly fee: number; readonly tokenIn: string; readonly tokenOut: string; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'QUOTE'; readonly fee: number; readonly tokenIn: string; readonly tokenOut: string; readonly amountIn: bigint; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'ACCOUNT'; readonly owner: string; readonly tokenIn: string; readonly tokenOut: string; readonly blockHash: string; readonly requireCanonical: true }
  | { readonly kind: 'TAIL'; readonly blockNumber: number };
export type ForkQuoteTransport = (query: ForkQuoteQuery) => Promise<unknown>;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
const validHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
/** Fixed read order, hash-bound state requests, and a final consistency read. */
export async function collectScriptedForkQuote(transport: ForkQuoteTransport, input: {
  readonly owner: string; readonly tokenIn: string; readonly tokenOut: string;
  readonly amountIn: bigint; readonly selectedFee: number | null; readonly reviewedRouterCodeHash: string;
}): Promise<ForkQuoteFacts> {
  if (!validAddress(input.owner) || !validAddress(input.tokenIn) || !validAddress(input.tokenOut)
    || !([FORK_CONTRACTS.usdc, FORK_CONTRACTS.weth] as readonly string[]).includes(input.tokenIn)
    || !([FORK_CONTRACTS.usdc, FORK_CONTRACTS.weth] as readonly string[]).includes(input.tokenOut)
    || input.tokenIn === input.tokenOut || input.amountIn <= 0n) throw new Error('FORK_INPUT_INVALID');
  const chain = await transport({ kind: 'CHAIN' });
  const metadata = await transport({ kind: 'METADATA' });
  const head = await transport({ kind: 'LATEST' });
  if (chain !== FORK_CHAIN_ID || !isObject(metadata) || metadata.sourceChainId !== SOURCE_CHAIN_ID
    || !validHash(metadata.sourceBlockHash) || !isObject(head) || !validHash(head.hash)
    || !Number.isSafeInteger(head.number) || typeof head.timestamp !== 'bigint') throw new Error('FORK_SOURCE_MISMATCH');
  const at = { blockHash: head.hash, requireCanonical: true } as const;
  const codeHashes = {} as Record<keyof typeof FORK_CONTRACTS, string>;
  for (const name of ['usdc', 'weth', 'factory', 'quoter', 'router'] as const) {
    const result = await transport({ kind: 'CODE', address: FORK_CONTRACTS[name], ...at });
    if (!validHash(result)) throw new Error('CODE_DIGEST_MISMATCH');
    codeHashes[name] = result;
  }
  const usdc = await transport({ kind: 'TOKEN_METADATA', address: FORK_CONTRACTS.usdc, ...at });
  const weth = await transport({ kind: 'TOKEN_METADATA', address: FORK_CONTRACTS.weth, ...at });
  const quoter = await transport({ kind: 'DEPLOYMENT', address: FORK_CONTRACTS.quoter, ...at });
  const router = await transport({ kind: 'DEPLOYMENT', address: FORK_CONTRACTS.router, ...at });
  const metadataMatches = isObject(usdc) && usdc.symbol === 'USDC' && usdc.decimals === 6
    && isObject(weth) && weth.symbol === 'WETH' && weth.decimals === 18;
  const deploymentMatches = (value: unknown): boolean => isObject(value)
    && value.factory === FORK_CONTRACTS.factory && value.weth9 === FORK_CONTRACTS.weth;
  const tiers: ForkTier[] = [];
  for (const fee of FORK_FEE_TIERS) {
    const pool = await transport({ kind: 'POOL', fee, tokenIn: input.tokenIn, tokenOut: input.tokenOut, ...at });
    if (pool === null) { tiers.push({ fee, pool: null, status: 'NO_POOL', amountOut: null, fullInputProven: false }); continue; }
    if (!validAddress(pool)) throw new Error('POOL_INVALID');
    const quote = await transport({ kind: 'QUOTE', fee, tokenIn: input.tokenIn, tokenOut: input.tokenOut, amountIn: input.amountIn, ...at });
    if (quote === null) { tiers.push({ fee, pool, status: 'QUOTE_REVERTED', amountOut: null, fullInputProven: false }); continue; }
    if (!isObject(quote) || typeof quote.amountOut !== 'bigint' || typeof quote.sqrtPriceX96After !== 'bigint') throw new Error('QUOTE_INVALID');
    const limit = input.tokenIn < input.tokenOut ? 4295128740n : 1461446703485210103287273052203988822378723970341n;
    const fullInputProven = quote.sqrtPriceX96After !== limit;
    tiers.push({ fee, pool, status: !fullInputProven ? 'FULL_INPUT_NOT_PROVEN' : quote.amountOut === 0n ? 'ZERO_OUTPUT' : 'QUOTED',
      amountOut: fullInputProven && quote.amountOut > 0n ? quote.amountOut : null, fullInputProven });
  }
  const account = await transport({ kind: 'ACCOUNT', owner: input.owner, tokenIn: input.tokenIn, tokenOut: input.tokenOut, ...at });
  const tail = await transport({ kind: 'TAIL', blockNumber: head.number as number });
  if (!isObject(account) || !isObject(tail) || !validHash(tail.hash)
    || typeof tail.timestamp !== 'bigint' || typeof account.inputBalance !== 'bigint'
    || typeof account.ethBalance !== 'bigint' || typeof account.allowance !== 'bigint'
    || typeof account.nonce !== 'bigint' || typeof account.code !== 'string') throw new Error('FORK_RESPONSE_INVALID');
  return { executionChainId: chain, sourceChainId: metadata.sourceChainId,
    sourceBlockHash: metadata.sourceBlockHash, block: { number: head.number as number, hash: head.hash, timestamp: head.timestamp },
    finalBlockHash: tail.hash, finalBlockTimestamp: tail.timestamp,
    codeHashes, reviewedRouterCodeHash: input.reviewedRouterCodeHash, router: FORK_CONTRACTS.router,
    factoryMatches: deploymentMatches(quoter) && deploymentMatches(router),
    weth9Matches: deploymentMatches(quoter) && deploymentMatches(router), tokenMetadataMatches: metadataMatches,
    ownerCode: account.code, ownerBalance: account.inputBalance, ownerEthBalance: account.ethBalance,
    ownerAllowance: account.allowance, ownerNonce: account.nonce, tiers, selectedFee: input.selectedFee };
}

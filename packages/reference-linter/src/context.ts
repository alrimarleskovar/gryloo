// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@defi-workflow-engine/workflow-contracts';
import { ETHEREUM_SEPOLIA_ASSETS } from '@defi-workflow-engine/action-registry';

export type Symbol = 'USDC' | 'WETH';
export interface AssetRecord {
  readonly symbol: Symbol;
  readonly asset: Asset;
  readonly maximumAmountUnits: string;
  readonly provenance: 'NOT_ONCHAIN_VERIFIED';
}
export interface ReviewContext {
  readonly registryId: 'reference.registry';
  readonly capabilityId: 'swap.direct-transaction';
  readonly actionId: 'asset.swap.exact-input';
  readonly assets: Readonly<Record<Symbol, AssetRecord>>;
}

const MAINNET_EXPECTED = Object.freeze({
  USDC: Object.freeze({ chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, maximumAmountUnits: '1000000000000' }),
  WETH: Object.freeze({ chainId: 'eip155:8453', address: '0x4200000000000000000000000000000000000006', decimals: 18, maximumAmountUnits: '1000000000000000000000' }),
});

const TESTNET_EXPECTED = Object.freeze({
  USDC: Object.freeze({ chainId: 'eip155:84532', address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', decimals: 6, maximumAmountUnits: '1000000000' }),
  WETH: Object.freeze({ chainId: 'eip155:84532', address: '0x4200000000000000000000000000000000000006', decimals: 18, maximumAmountUnits: '1000000000000000000' }),
});

/** BUILD-ETHEREUM-001: Ethereum Sepolia USDC (Aave faucet token) and Uniswap WETH9, from the chain-specific asset registry. */
const ETHEREUM_SEPOLIA_EXPECTED = Object.freeze({
  USDC: Object.freeze({ chainId: ETHEREUM_SEPOLIA_ASSETS.USDC.chain, address: ETHEREUM_SEPOLIA_ASSETS.USDC.address, decimals: ETHEREUM_SEPOLIA_ASSETS.USDC.decimals, maximumAmountUnits: '1000000000' }),
  WETH: Object.freeze({ chainId: ETHEREUM_SEPOLIA_ASSETS.WETH.chain, address: ETHEREUM_SEPOLIA_ASSETS.WETH.address, decimals: ETHEREUM_SEPOLIA_ASSETS.WETH.decimals, maximumAmountUnits: '1000000000000000000' }),
});
type Expected = typeof TESTNET_EXPECTED | typeof ETHEREUM_SEPOLIA_EXPECTED | typeof MAINNET_EXPECTED;
function contextFrom(expected: Expected): ReviewContext {
  const assets = Object.fromEntries((['USDC', 'WETH'] as const).map(symbol => [symbol, {
    symbol, asset: { chainId: expected[symbol].chainId, address: expected[symbol].address,
      decimals: expected[symbol].decimals }, maximumAmountUnits: expected[symbol].maximumAmountUnits,
    provenance: 'NOT_ONCHAIN_VERIFIED' as const,
  }]));
  return validatedContext({ registryId: 'reference.registry', capabilityId: 'swap.direct-transaction',
    actionId: 'asset.swap.exact-input', assets });
}
/** Exact public-testnet asset profile; no caller-supplied token addresses. */
export function createBaseSepoliaReviewContext(): ReviewContext { return contextFrom(TESTNET_EXPECTED); }
/** BUILD-ETHEREUM-001: the exact Ethereum Sepolia asset profile. Base and Ethereum Sepolia USDC never share a context. */
export function createEthereumSepoliaReviewContext(): ReviewContext { return contextFrom(ETHEREUM_SEPOLIA_EXPECTED); }
/** The trusted context for a swap's chain: Base Sepolia or Ethereum Sepolia by CAIP-2 id; any other chain keeps `fallback`. */
export function reviewContextForChain(chain: string, fallback: ReviewContext): ReviewContext {
  return chain === TESTNET_EXPECTED.USDC.chainId ? createBaseSepoliaReviewContext() : chain === ETHEREUM_SEPOLIA_EXPECTED.USDC.chainId ? createEthereumSepoliaReviewContext() : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
export function hasKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('|') === [...expected].sort().join('|');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Reconstruct pinned values; caller references never enter trusted context. */
function validatedContext(input: unknown): ReviewContext {
  if (!isRecord(input) || !hasKeys(input, ['registryId', 'capabilityId', 'actionId', 'assets'])
      || input.registryId !== 'reference.registry' || input.capabilityId !== 'swap.direct-transaction'
      || input.actionId !== 'asset.swap.exact-input' || !isRecord(input.assets)
      || !hasKeys(input.assets, ['USDC', 'WETH'])) throw new Error('INVALID_REVIEW_CONTEXT');
  const usdcChain = isRecord(input.assets.USDC) && isRecord(input.assets.USDC.asset) ? input.assets.USDC.asset.chainId : null;
  const expectedProfile: Expected = usdcChain === 'eip155:84532' ? TESTNET_EXPECTED : usdcChain === ETHEREUM_SEPOLIA_EXPECTED.USDC.chainId ? ETHEREUM_SEPOLIA_EXPECTED : MAINNET_EXPECTED;
  for (const symbol of ['USDC', 'WETH'] as const) {
    const item = input.assets[symbol];
    const expected = expectedProfile[symbol];
    if (!isRecord(item) || !hasKeys(item, ['symbol', 'asset', 'maximumAmountUnits', 'provenance'])
        || item.symbol !== symbol || item.provenance !== 'NOT_ONCHAIN_VERIFIED'
        || item.maximumAmountUnits !== expected.maximumAmountUnits || !isRecord(item.asset)
        || !hasKeys(item.asset, ['chainId', 'address', 'decimals'])
        || item.asset.chainId !== expected.chainId || item.asset.address !== expected.address
        || item.asset.decimals !== expected.decimals) throw new Error('INVALID_REVIEW_CONTEXT');
  }
  return freeze({
    registryId: 'reference.registry', capabilityId: 'swap.direct-transaction',
    actionId: 'asset.swap.exact-input',
    assets: {
      USDC: { symbol: 'USDC', asset: { chainId: expectedProfile.USDC.chainId, address: expectedProfile.USDC.address, decimals: expectedProfile.USDC.decimals }, maximumAmountUnits: expectedProfile.USDC.maximumAmountUnits, provenance: 'NOT_ONCHAIN_VERIFIED' },
      WETH: { symbol: 'WETH', asset: { chainId: expectedProfile.WETH.chainId, address: expectedProfile.WETH.address, decimals: expectedProfile.WETH.decimals }, maximumAmountUnits: expectedProfile.WETH.maximumAmountUnits, provenance: 'NOT_ONCHAIN_VERIFIED' },
    },
  });
}

export function createReviewContext(input: unknown): ReviewContext {
  try { return validatedContext(input); }
  catch { throw new Error('INVALID_REVIEW_CONTEXT'); }
}

export function assetSymbol(value: unknown, context: ReviewContext): Symbol | null {
  if (!isRecord(value) || !hasKeys(value, ['chainId', 'address', 'decimals'])) return null;
  for (const symbol of ['USDC', 'WETH'] as const) {
    const asset = context.assets[symbol].asset;
    if ('address' in asset && value.chainId === asset.chainId && value.address === asset.address && value.decimals === asset.decimals) return symbol;
  }
  return null;
}

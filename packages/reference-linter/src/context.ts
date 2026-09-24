// SPDX-License-Identifier: AGPL-3.0-only
import type { Asset } from '@defi-workflow-engine/workflow-contracts';

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

const EXPECTED = Object.freeze({
  USDC: Object.freeze({ chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, maximumAmountUnits: '1000000000000' }),
  WETH: Object.freeze({ chainId: 'eip155:8453', address: '0x4200000000000000000000000000000000000006', decimals: 18, maximumAmountUnits: '1000000000000000000000' }),
});

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
  for (const symbol of ['USDC', 'WETH'] as const) {
    const item = input.assets[symbol];
    const expected = EXPECTED[symbol];
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
      USDC: { symbol: 'USDC', asset: { chainId: EXPECTED.USDC.chainId, address: EXPECTED.USDC.address, decimals: EXPECTED.USDC.decimals }, maximumAmountUnits: EXPECTED.USDC.maximumAmountUnits, provenance: 'NOT_ONCHAIN_VERIFIED' },
      WETH: { symbol: 'WETH', asset: { chainId: EXPECTED.WETH.chainId, address: EXPECTED.WETH.address, decimals: EXPECTED.WETH.decimals }, maximumAmountUnits: EXPECTED.WETH.maximumAmountUnits, provenance: 'NOT_ONCHAIN_VERIFIED' },
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

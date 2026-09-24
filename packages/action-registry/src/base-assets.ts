// SPDX-License-Identifier: Apache-2.0
import type { Asset } from '@defi-workflow-engine/workflow-contracts';

export interface ReferenceAsset {
  readonly symbol: 'USDC' | 'WETH';
  readonly asset: Asset;
  readonly maximumAmountUnits: string;
  readonly provenance: 'NOT_ONCHAIN_VERIFIED';
}

/** First-party documented identities; this is not a deployed-code attestation. */
export const baseAssetRegistry: Readonly<{ USDC: ReferenceAsset; WETH: ReferenceAsset }> = Object.freeze({
  USDC: Object.freeze({
    symbol: 'USDC',
    asset: Object.freeze({ chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }),
    maximumAmountUnits: '1000000000000', provenance: 'NOT_ONCHAIN_VERIFIED',
  }),
  WETH: Object.freeze({
    symbol: 'WETH',
    asset: Object.freeze({ chainId: 'eip155:8453', address: '0x4200000000000000000000000000000000000006', decimals: 18 }),
    maximumAmountUnits: '1000000000000000000000', provenance: 'NOT_ONCHAIN_VERIFIED',
  }),
});

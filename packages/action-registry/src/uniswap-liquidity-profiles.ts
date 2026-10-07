// SPDX-License-Identifier: Apache-2.0
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY } from './uniswap-v3-base-sepolia.js';
import { UNISWAP_V3_ETHEREUM_SEPOLIA_LIQUIDITY } from './uniswap-v3-ethereum-sepolia.js';
/** The public Uniswap v3 concentrated-liquidity runtimes: Base Sepolia USDC/WETH 0.05% and Ethereum Sepolia USDC/WETH 0.3%. */
export type UniswapLiquidityProfile = typeof UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY | typeof UNISWAP_V3_ETHEREUM_SEPOLIA_LIQUIDITY;
export const UNISWAP_LIQUIDITY_PROFILES: readonly UniswapLiquidityProfile[] = Object.freeze([UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY, UNISWAP_V3_ETHEREUM_SEPOLIA_LIQUIDITY]);
/** The liquidity profile of a CAIP-2 chain or numeric chain id; null for any other chain (Mainnet included). */
export function uniswapLiquidityProfile(chain: string | number | null | undefined): UniswapLiquidityProfile | null {
  return UNISWAP_LIQUIDITY_PROFILES.find(profile => profile.chain === chain || profile.chainId === chain) ?? null;
}

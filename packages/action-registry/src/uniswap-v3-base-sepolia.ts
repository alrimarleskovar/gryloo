// SPDX-License-Identifier: Apache-2.0
/**
 * Uniswap v3 concentrated liquidity on Base Sepolia: the public-testnet EVM runtime of the canonical
 * `asset.liquidity.concentrated` action (protocol constraint `uniswap-v3`).
 *
 * Sources: the official Uniswap v3 Base Sepolia deployment list
 * (https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments). Verified read-only against
 * https://sepolia.base.org on 2026-10-03 (block ≈ 47,614,000): the Position Manager's `factory()` and `WETH9()` equal
 * the factory and WETH below; `factory.getPool(USDC, WETH, 500)` returns the pool; the pool reports token0 = USDC,
 * token1 = WETH, fee 500 and tick spacing 10. The same factory and pool carry the repository's Base Sepolia swap.
 * Every identity is verified again against public chain state before each simulation.
 *
 * Token order differs from Base mainnet (where WETH is token0): here USDC is token0 and WETH is token1, so the pool
 * price token1/token0 is WETH per USDC and a higher tick means a LOWER USDC-per-WETH price.
 */
export const UNISWAP_LIQUIDITY_ACTION = 'asset.liquidity.concentrated';
export const UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY = Object.freeze({
  network: 'Base Sepolia', chain: 'eip155:84532', chainId: 84532, chainHex: '0x14a34',
  protocol: 'uniswap-v3', adapterId: 'uniswap.v3', providerLabel: 'Uniswap v3',
  rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org/',
  officialSource: 'https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments',
  factory: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  positionManager: '0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2',
  pool: '0x94bfc0574ff48e92ce43d495376c477b1d0eeec0',
  /** OP-stack GasPriceOracle predeploy (L1 data fee upper bound). */
  gasPriceOracle: '0x420000000000000000000000000000000000000f',
  token0: Object.freeze({ symbol: 'USDC', address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', decimals: 6, maximumAmount: '1000000000' }),
  token1: Object.freeze({ symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, maximumAmount: '1000000000000000000' }),
  /** SHA-256 of the immutable runtime code read on 2026-10-03; a different deployment fails closed. */
  codeSha256: Object.freeze({
    factory: '2e3c9aa72d26cfbcdc2358f85decb5bbd56331b90175f5da562c687f1a93a164',
    positionManager: '253dd1ca2b371704b3cfb6cef8eea148a72182a491bfdc1b4c69d779b3c51c60',
    pool: '5f45f1a6192232a8ad495ee4dc03eb32071327af0afbf081d3045bebb109cac9',
  }),
  feeTier: 500, tickSpacing: 10,
  maximumSlippageBps: 300, defaultSlippageBps: 100,
  /** A Review authorizes wallet requests for this long; the mint deadline bounds when a sent mint can still land. */
  reviewTtlSeconds: 120, mintDeadlineSeconds: 900,
});
export type UniswapLiquidityProfile = typeof UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY;

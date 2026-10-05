// SPDX-License-Identifier: Apache-2.0
import { ETHEREUM_SEPOLIA, ETHEREUM_SEPOLIA_ASSETS } from './ethereum-sepolia.js';
/**
 * BUILD-ETHEREUM-001: Uniswap v3 on Ethereum Sepolia, USDC/WETH 0.3% only.
 *
 * Source: the official Uniswap deployment registry (https://developers.uniswap.org/deployments.json, Uniswap/contracts
 * a677c0d, chain 11155111). Verified read-only against Ethereum Sepolia on 2026-10-05 (block 11,848,749): the
 * NonfungiblePositionManager, QuoterV2 and SwapRouter02 each report `factory()` = the factory and `WETH9()` = the WETH
 * below; `factory.getPool(USDC, WETH, 3000)` returns the pool; the pool reports token0 = USDC, token1 = WETH, fee 3000,
 * tick spacing 60 and `factory()` = the factory. The USDC is Aave's Sepolia faucet token (the Ethereum Sepolia lending
 * registry's USDC), not Circle's. Pools exist at all four fee tiers; the 0.3% pool has the deepest in-range liquidity
 * (quotes stay linear from 1 to 100 USDC). Testnet prices are arbitrary; every swap and position is bounded by fresh
 * quotes, ranges and minimums, and every identity below is re-verified against chain state before each use.
 *
 * Token order matches Base Sepolia: USDC is token0 and WETH token1, so the pool price token1/token0 is WETH per USDC.
 */
export const UNISWAP_V3_ETHEREUM_SEPOLIA = Object.freeze({
  network: ETHEREUM_SEPOLIA.name, chain: ETHEREUM_SEPOLIA.chain, chainId: ETHEREUM_SEPOLIA.chainId, chainHex: ETHEREUM_SEPOLIA.chainHex,
  rpc: ETHEREUM_SEPOLIA.rpc, explorer: ETHEREUM_SEPOLIA.explorer, officialSource: 'https://developers.uniswap.org/deployments.json',
  factory: '0x0227628f3f023bb0b980b67d528571c95c6dac1c',
  positionManager: '0x1238536071e1c677a632429e3655c799b22cda52',
  quoter: '0xed1f6473345f45b75f8179591dd5ba1888cf2fb3',
  router: '0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e',
  usdc: ETHEREUM_SEPOLIA_ASSETS.USDC.address, weth: ETHEREUM_SEPOLIA_ASSETS.WETH.address,
  pool: '0x9799b5edc1aa7d3fad350309b08df3f64914e244', fee: 3000, tickSpacing: 60,
  /** SHA-256 of the runtime code read on 2026-10-05; a different deployment fails closed where the code is pinned. */
  codeSha256: Object.freeze({
    factory: 'f4e0ac5ddb8b0ed6b47df04645557d13af2a8b7a1bc9583acd08b0788440928b',
    positionManager: '09e92a098f75be4c322a523b5a9ec5d57f898dee34adaff353227eee8ba0951f',
    pool: '755617824919a645475c55213f8a4a58e73b822e2a547e0cb6f834bd90648b76',
    quoter: '41807167ee6769e9848dc88cc44931db2c9d9f3fe320f8c10e5a588722f4496b',
    router: 'e18dacff07368baa9974b34f1039c31726d374cd0838c7969232b9f287590562',
  }),
});

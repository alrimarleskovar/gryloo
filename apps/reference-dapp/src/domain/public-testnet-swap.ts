// SPDX-License-Identifier: AGPL-3.0-only
import { UNISWAP_V3_ETHEREUM_SEPOLIA as ethereum } from '@defi-workflow-engine/action-registry';
/** Pinned Base Sepolia Uniswap v3 profile; verified again against public chain state before use. */
export const BASE_SEPOLIA = Object.freeze({
  chainId: 84532, chainHex: '0x14a34', chainRef: 'eip155:84532', network: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org/tx/',
  factory: '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  router: '0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4',
  quoter: '0xc5290058841028f1614f3a6f0f5816cad0df5e27',
  usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  weth: '0x4200000000000000000000000000000000000006',
  pool: '0x94bfc0574ff48e92ce43d495376c477b1d0eeec0', fee: 500,
  /** OP Stack receipts carry a separate L1 data fee (`l1Fee`) that is part of the owner's cost. */
  l1DataFee: true,
});
/** BUILD-ETHEREUM-001: the Ethereum Sepolia USDC/WETH 0.3% profile; every identity is re-verified against chain state before use. */
export const ETHEREUM_SEPOLIA_SWAP = Object.freeze({
  chainId: ethereum.chainId, chainHex: ethereum.chainHex, chainRef: ethereum.chain, network: ethereum.network,
  rpcUrl: ethereum.rpc, explorer: `${ethereum.explorer}/tx/`,
  factory: ethereum.factory, router: ethereum.router, quoter: ethereum.quoter, usdc: ethereum.usdc, weth: ethereum.weth,
  pool: ethereum.pool, fee: ethereum.fee,
  /** Ethereum L1: the network cost is gasUsed × effectiveGasPrice; a receipt l1Fee would be unexplained. */
  l1DataFee: false,
});
export type PublicSwapProfile = typeof BASE_SEPOLIA | typeof ETHEREUM_SEPOLIA_SWAP;
export const PUBLIC_SWAP_PROFILES: readonly PublicSwapProfile[] = Object.freeze([BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP]);
/** The public swap profile of a CAIP-2 chain or numeric chain id; null for any other chain (Mainnet included). */
export function publicSwapProfile(chain: string | number | null | undefined): PublicSwapProfile | null {
  return PUBLIC_SWAP_PROFILES.find(profile => profile.chainRef === chain || profile.chainId === chain) ?? null;
}

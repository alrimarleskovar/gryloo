// SPDX-License-Identifier: Apache-2.0
/**
 * BUILD-ETHEREUM-001: Ethereum Sepolia network identity and its chain-specific asset registry.
 *
 * Sources (checked 2026-10-05): ethereum-lists/chains `eip155-11155111.json` (chain and network id 11155111, native
 * currency, Etherscan explorer) and the ethereum.org networks page (Sepolia is the recommended application testnet; it
 * defers chain IDs to that registry). The public RPC below is listed there and returned `eth_chainId` 0xaa36a7,
 * `net_version` 11155111 and the genesis hash below. See docs/builds/BUILD-ETHEREUM-001-READONLY.json.
 *
 * Ethereum Mainnet is recognised only so a wallet on it can be named and refused. It is never a switch target and has
 * no execution capability: a public testnet is not Mainnet.
 */
export const ETHEREUM_SEPOLIA = Object.freeze({
  name: 'Ethereum Sepolia', chain: 'eip155:11155111', chainId: 11155111, chainHex: '0xaa36a7', environment: 'PUBLIC_TESTNET',
  nativeCurrency: Object.freeze({ name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }),
  rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io',
  genesisHash: '0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9',
  officialSource: 'https://github.com/ethereum-lists/chains/blob/master/_data/chains/eip155-11155111.json',
});
export const ETHEREUM_MAINNET = Object.freeze({
  name: 'Ethereum Mainnet', chain: 'eip155:1', chainId: 1, chainHex: '0x1', environment: 'MAINNET', executable: false,
});
/** EIP-3085 parameters from the official network record; used only after the wallet reports the chain unknown. */
export function ethereumSepoliaAddChainParameters() {
  return Object.freeze({ chainId: ETHEREUM_SEPOLIA.chainHex, chainName: ETHEREUM_SEPOLIA.name, nativeCurrency: ETHEREUM_SEPOLIA.nativeCurrency,
    rpcUrls: Object.freeze([ETHEREUM_SEPOLIA.rpc]), blockExplorerUrls: Object.freeze([ETHEREUM_SEPOLIA.explorer]) });
}

const AAVE_BOOK = 'https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Sepolia.sol';
const UNISWAP = 'https://developers.uniswap.org/deployments.json';
export type ChainAsset = { readonly symbol: string; readonly chain: string; readonly address: string; readonly decimals: number;
  readonly issuer: string; readonly source: string };
const asset = (symbol: string, address: string, decimals: number, issuer: string, source: string): ChainAsset =>
  Object.freeze({ symbol, chain: ETHEREUM_SEPOLIA.chain, address, decimals, issuer, source });
/**
 * Ethereum Sepolia assets, identified by chain + address + decimals. A symbol alone never selects an asset: Ethereum
 * Sepolia USDC is not Base USDC, and this USDC is Aave's faucet test token, not Circle's Sepolia USDC.
 */
export const ETHEREUM_SEPOLIA_ASSETS = Object.freeze({
  USDC: asset('USDC', '0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8', 6, 'Aave V3 Sepolia faucet test token', AAVE_BOOK),
  WETH: asset('WETH', '0xfff9976782d46cc05630d1f6ebab18b2324d6b14', 18, 'Uniswap v3 Sepolia WETH9 (NonfungiblePositionManager.WETH9())', UNISWAP),
  WBTC: asset('WBTC', '0x29f2d40b0605204364af54ec677bd022da425d03', 8, 'Aave V3 Sepolia faucet test token', AAVE_BOOK),
});
export type EthereumSepoliaAssetSymbol = keyof typeof ETHEREUM_SEPOLIA_ASSETS;

/**
 * The native test-ETH self-transfer on Ethereum Sepolia: the minimal owner-execution smoke path (wallet → Review → sign →
 * send → receipt → reconciliation → evidence). It needs no third-party contract. Sepolia is an L1, so inclusion is a
 * proof-of-stake block; three confirmations are required before reconciliation.
 */
export const ETHEREUM_SEPOLIA_TRANSFER = Object.freeze({
  network: ETHEREUM_SEPOLIA.name, chain: ETHEREUM_SEPOLIA.chain, chainId: ETHEREUM_SEPOLIA.chainId,
  chainHex: ETHEREUM_SEPOLIA.chainHex, rpc: ETHEREUM_SEPOLIA.rpc, explorer: ETHEREUM_SEPOLIA.explorer,
  officialSource: ETHEREUM_SEPOLIA.officialSource, adapterId: 'evm.native-transfer', action: 'asset.transfer',
  /** 0.001 test ETH. The value returns to the owner; only the network fee is spent. */
  maximumValueWei: '1000000000000000', defaultValueWei: '1000000000000',
  reviewTtlSeconds: 120, gasLimitMarginPercent: 150, maxFeeMultiplier: 2, minimumConfirmations: 3,
  settlement: 'L1' as const,
});

// SPDX-License-Identifier: Apache-2.0
/**
 * BUILD-RH-001: Robinhood Chain network identity. This is declarative data only. It grants no
 * execution capability, and no row in the execution capability registry targets these chains.
 *
 * Network sources (checked 2026-10-02): https://docs.robinhood.com/chain/connecting,
 * https://docs.robinhood.com/chain/add-network-to-wallet and https://docs.robinhood.com/chain/protocol-contracts.
 * The public RPCs returned chain IDs 0x1237 and 0xb626, and every contract marked
 * present had code at the checked head (see docs/builds/BUILD-RH-001-DISCOVERY.md).
 */
export type RobinhoodNetworkKey = 'mainnet' | 'testnet';
export type RobinhoodContract = { readonly name: string; readonly address: string; readonly source: string };
export type RobinhoodNetwork = {
  readonly key: RobinhoodNetworkKey; readonly name: string; readonly chain: string; readonly chainId: number;
  readonly chainHex: string; readonly environment: 'MAINNET' | 'PUBLIC_TESTNET';
  readonly nativeCurrency: { readonly name: 'Ether'; readonly symbol: 'ETH'; readonly decimals: 18 };
  readonly rpc: string; readonly explorer: string; readonly officialSource: string;
  /** Official contracts on this L2. Recognized for read-only verification only; none is an execution target. */
  readonly contracts: readonly RobinhoodContract[];
};
const PROTOCOL_CONTRACTS = 'https://docs.robinhood.com/chain/protocol-contracts';
const TOKEN_CONTRACTS = 'https://docs.robinhood.com/chain/contracts';
const ETHER = Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 } as const);
const contract = (name: string, address: string, source: string): RobinhoodContract => Object.freeze({ name, address, source });

export const ROBINHOOD_CHAIN_MAINNET: RobinhoodNetwork = Object.freeze({
  key: 'mainnet', name: 'Robinhood Chain', chain: 'eip155:4663', chainId: 4663, chainHex: '0x1237', environment: 'MAINNET',
  nativeCurrency: ETHER, rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com',
  officialSource: 'https://docs.robinhood.com/chain/connecting',
  contracts: Object.freeze([
    contract('WETH', '0x0bd7d308f8e1639fab988df18a8011f41eacad73', TOKEN_CONTRACTS),
    contract('USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168', TOKEN_CONTRACTS),
    contract('L2 Gateway Router', '0x1e324b9316138ca9a73f960213621ad1aaf01b89', PROTOCOL_CONTRACTS),
    contract('L2 Multicall', '0x2cac2d899ecc914d704feaae33ac1bf36277dad1', PROTOCOL_CONTRACTS),
    contract('Permit2', '0x000000000022d473030f116ddee9f6b43ac78ba3', PROTOCOL_CONTRACTS),
  ]),
});
export const ROBINHOOD_CHAIN_TESTNET: RobinhoodNetwork = Object.freeze({
  key: 'testnet', name: 'Robinhood Chain Testnet', chain: 'eip155:46630', chainId: 46630, chainHex: '0xb626', environment: 'PUBLIC_TESTNET',
  nativeCurrency: ETHER, rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com',
  officialSource: 'https://docs.robinhood.com/chain/connecting',
  contracts: Object.freeze([
    // The canonical L2 WETH of the testnet token bridge. Robinhood documents no testnet stablecoin or stock token.
    contract('WETH', '0x7943e237c7f95da44e0301572d358911207852fa', PROTOCOL_CONTRACTS),
    contract('L2 Gateway Router', '0x77bf00a6a90c600f214b34bafbb7918c0cf113a8', PROTOCOL_CONTRACTS),
    contract('L2 Multicall', '0xa432504b6f04cafe775b09d8aa92e8dbe41ec7a8', PROTOCOL_CONTRACTS),
    contract('Permit2', '0x000000000022d473030f116ddee9f6b43ac78ba3', PROTOCOL_CONTRACTS),
  ]),
});
export const ROBINHOOD_NETWORKS: readonly RobinhoodNetwork[] = Object.freeze([ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET]);

export type RobinhoodDeploymentStatus = 'CANONICAL_DEPLOYMENT' | 'NO_CANONICAL_DEPLOYMENT';
export type RobinhoodProtocolAvailability = {
  readonly protocol: string; readonly adapterIds: readonly string[]; readonly source: string;
  readonly mainnet: RobinhoodDeploymentStatus; readonly testnet: RobinhoodDeploymentStatus;
  /** Canonical mainnet addresses, recorded for read-only verification. Gryloo never targets them. */
  readonly mainnetContracts: readonly RobinhoodContract[];
};
const UNISWAP = 'https://developers.uniswap.org/deployments.json';
const MORPHO = 'https://github.com/morpho-org/sdks/blob/88e3383fb3a305afa8322a1eda792ca80f29f3ec/packages/morpho-ts/src/addresses.ts';
/**
 * The BUILD-RH-001 decision-gate result. A testnet entry becomes CANONICAL_DEPLOYMENT only after the
 * protocol's own registry (or Robinhood's) publishes chain 46630 addresses. The testnet Uniswap v4 and
 * UniversalRouter bytecode is an unattributed CREATE2 replay of mainnet init code and does not qualify.
 */
export const ROBINHOOD_PROTOCOL_AVAILABILITY: readonly RobinhoodProtocolAvailability[] = Object.freeze([
  Object.freeze({ protocol: 'uniswap', adapterIds: Object.freeze(['uniswap.v3']), source: UNISWAP,
    mainnet: 'CANONICAL_DEPLOYMENT', testnet: 'NO_CANONICAL_DEPLOYMENT', mainnetContracts: Object.freeze([
      contract('UniswapV3Factory', '0x1f7d7550b1b028f7571e69a784071f0205fd2efa', UNISWAP),
      contract('SwapRouter02', '0xcaf681a66d020601342297493863e78c959e5cb2', UNISWAP),
      contract('QuoterV2', '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', UNISWAP),
    ]) }),
  Object.freeze({ protocol: 'morpho', adapterIds: Object.freeze([]), source: MORPHO,
    mainnet: 'CANONICAL_DEPLOYMENT', testnet: 'NO_CANONICAL_DEPLOYMENT', mainnetContracts: Object.freeze([
      contract('Morpho Blue', '0x9d53d5e3bd5e8d4cbfa6db1ca238aea02e651010', MORPHO),
    ]) }),
  Object.freeze({ protocol: 'across', adapterIds: Object.freeze(['across.direct']), source: 'https://app.across.to/api/available-routes?destinationChainId=4663',
    mainnet: 'CANONICAL_DEPLOYMENT', testnet: 'NO_CANONICAL_DEPLOYMENT', mainnetContracts: Object.freeze([]) }),
  Object.freeze({ protocol: 'lifi', adapterIds: Object.freeze(['lifi.rest']), source: 'https://li.quest/v1/chains',
    mainnet: 'CANONICAL_DEPLOYMENT', testnet: 'NO_CANONICAL_DEPLOYMENT', mainnetContracts: Object.freeze([]) }),
  Object.freeze({ protocol: 'aave-v3', adapterIds: Object.freeze(['aave-v3']), source: 'https://github.com/aave-dao/aave-address-book',
    mainnet: 'NO_CANONICAL_DEPLOYMENT', testnet: 'NO_CANONICAL_DEPLOYMENT', mainnetContracts: Object.freeze([]) }),
]);

/**
 * RH-DEMO-001: the only executable Robinhood path, a native test-ETH self-transfer on Testnet. It needs no
 * third-party contract, so its trust rests on the chain alone. This is a chain execution proof, not DeFi.
 */
export const ROBINHOOD_TESTNET_TRANSFER = Object.freeze({
  network: ROBINHOOD_CHAIN_TESTNET.name, chain: ROBINHOOD_CHAIN_TESTNET.chain, chainId: ROBINHOOD_CHAIN_TESTNET.chainId,
  chainHex: ROBINHOOD_CHAIN_TESTNET.chainHex, rpc: ROBINHOOD_CHAIN_TESTNET.rpc, explorer: ROBINHOOD_CHAIN_TESTNET.explorer,
  officialSource: ROBINHOOD_CHAIN_TESTNET.officialSource, adapterId: 'evm.native-transfer', action: 'asset.transfer',
  /** 0.001 test ETH. The value returns to the owner; only the network fee is spent. */
  maximumValueWei: '1000000000000000', defaultValueWei: '1000000000000',
  reviewTtlSeconds: 120, gasLimitMarginPercent: 150, maxFeeMultiplier: 2, minimumConfirmations: 2,
});
/** Accepts a CAIP-2 reference or an EIP-155 hex chain ID, in any case. */
export function robinhoodNetwork(chain: string | null | undefined): RobinhoodNetwork | null {
  if (typeof chain !== 'string') return null;
  const value = chain.toLowerCase();
  return ROBINHOOD_NETWORKS.find(network => network.chain === value || network.chainHex === value) ?? null;
}
/** Whether the adapter's protocol is canonically deployed on the Robinhood network; null when not a Robinhood chain or unknown. */
export function robinhoodDeploymentStatus(chain: string, adapterId: string): RobinhoodDeploymentStatus | null {
  const network = robinhoodNetwork(chain);
  const row = network && ROBINHOOD_PROTOCOL_AVAILABILITY.find(item => item.adapterIds.includes(adapterId));
  return network && row ? row[network.key] : null;
}
/**
 * What a read-only verifier should find at the head: official contracts present, and each recorded
 * protocol contract present exactly where the gate records a canonical deployment. On testnet the
 * mainnet addresses must stay empty; code there would be a deployment the gate has not reviewed.
 */
export function robinhoodExpectedCode(network: RobinhoodNetwork): readonly { readonly name: string; readonly address: string; readonly expect: 'PRESENT' | 'ABSENT' }[] {
  return Object.freeze([
    ...network.contracts.map(item => Object.freeze({ name: item.name, address: item.address, expect: 'PRESENT' as const })),
    ...ROBINHOOD_PROTOCOL_AVAILABILITY.flatMap(row => row.mainnetContracts.map(item => Object.freeze({ name: `${row.protocol} ${item.name}`,
      address: item.address, expect: row[network.key] === 'CANONICAL_DEPLOYMENT' ? 'PRESENT' as const : 'ABSENT' as const }))),
  ]);
}
/** EIP-3085 parameters from the official network table. */
export function robinhoodAddChainParameters(network: RobinhoodNetwork) {
  return Object.freeze({ chainId: network.chainHex, chainName: network.name, nativeCurrency: network.nativeCurrency,
    rpcUrls: Object.freeze([network.rpc]), blockExplorerUrls: Object.freeze([network.explorer]) });
}

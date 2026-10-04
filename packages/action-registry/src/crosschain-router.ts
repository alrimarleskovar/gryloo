// SPDX-License-Identifier: Apache-2.0
/**
 * BUILD-ROUTER-001: deployment profile of the Cross-chain Router for its first pair, Base (8453) USDC → Arbitrum One
 * (42161) USDC. Underlying protocol: Across (SpokePool `deposit` on Base, `FilledRelay` on Arbitrum). Routing providers:
 * LI.FI (primary discovery, through the LI.FI Diamond) and Across (direct).
 *
 * Verified read-only on 2026-10-04 against https://mainnet.base.org (block ≈ 52,170,000) and
 * https://arb1.arbitrum.io/rpc (block ≈ 511,658,000): code present at every address; both SpokePools report their chain
 * id, `depositQuoteTimeBuffer` = 3600 and `fillDeadlineBuffer` = 21600; real `FundsDeposited` / `FilledRelay` logs match
 * the topics in the compiler; the LI.FI quote's `approvalAddress` / `transactionRequest.to` is the Diamond below and its
 * fee "swap" calls the fee forwarder below; the Across Swap API's `swapTx.to` and allowance spender is the Base
 * SpokePool. SpokePools and the Diamond are upgradeable proxies: the proxy runtime code is pinned here, and the
 * implementation observed at Review is bound into each Review commitment.
 */
/**
 * A router deployment profile: one supported pair on one network. Code-pin keys keep their BUILD-ROUTER-001 names
 * (`base*` = source chain, `arbitrum*` = destination chain) on every network.
 */
export type RouterProfile = {
  readonly id: string; readonly adapterId: 'flofi.router'; readonly underlyingProtocol: 'across';
  readonly network: 'MAINNET' | 'TESTNET'; readonly environment: 'MAINNET' | 'PUBLIC_TESTNET';
  readonly source: { readonly network: string; readonly chain: string; readonly chainId: number; readonly chainHex: string; readonly rpc: string;
    readonly explorer: string; readonly usdc: string; readonly spokePool: string; readonly lifiDiamond: string; readonly lifiFeeForwarder: string };
  readonly destination: { readonly network: string; readonly chain: string; readonly chainId: number; readonly chainHex: string; readonly rpc: string;
    readonly explorer: string; readonly usdc: string; readonly spokePool: string };
  readonly codeSha256: { readonly baseSpokePool: string; readonly baseLifiDiamond: string; readonly baseLifiFeeForwarder: string; readonly baseUsdc: string;
    readonly arbitrumSpokePool: string; readonly arbitrumUsdc: string };
  readonly providers: { readonly lifi: { readonly api: string; readonly integrator: string; readonly docs: string };
    readonly across: { readonly api: string; readonly docs: string } };
  readonly reviewTtlSeconds: number; readonly depositSafetyMarginSeconds: number; readonly defaultSlippageBps: number; readonly maximumSlippageBps: number;
  readonly finality: 'safe'; readonly destinationScanBlocks: number;
};
export const CROSSCHAIN_ROUTER_BASE_ARBITRUM: RouterProfile = Object.freeze({
  id: 'base-usdc-to-arbitrum-usdc', adapterId: 'flofi.router', underlyingProtocol: 'across', network: 'MAINNET', environment: 'MAINNET',
  source: Object.freeze({ network: 'Base', chain: 'eip155:8453', chainId: 8453, chainHex: '0x2105', rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org/', usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    spokePool: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', lifiDiamond: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
    lifiFeeForwarder: '0xce40449b773a3e6e5e769adb4e567179d4828cbd' }),
  destination: Object.freeze({ network: 'Arbitrum One', chain: 'eip155:42161', chainId: 42161, chainHex: '0xa4b1', rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io/', usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', spokePool: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a' }),
  /** SHA-256 of the runtime code read on 2026-10-04; a different deployment fails closed. */
  codeSha256: Object.freeze({
    baseSpokePool: '3cc5e539eb61133fec38655ae3f55d8e1f944fce2cbc02e151972cf9c9880545',
    baseLifiDiamond: 'a5f481fb142b210db0011bacc8dafa949714aa3a56ab4377efc1a080f987a296',
    baseLifiFeeForwarder: '8e1f9e10378ce2648b2d1cb2c7a4a061058bf202b2e7b8d68a70a17082728981',
    baseUsdc: '98d785fcb1bf847f287adc2310759fd94cc13e754b974bc72131382e8266f607',
    arbitrumSpokePool: '3cc5e539eb61133fec38655ae3f55d8e1f944fce2cbc02e151972cf9c9880545',
    arbitrumUsdc: 'b46445c0c96a50cd0ae6245d2ceb5058fbbcd24afad9cb878974d8f17b4655c8',
  }),
  providers: Object.freeze({
    lifi: Object.freeze({ api: 'https://li.quest/v1', integrator: 'flofi', docs: 'https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer' }),
    across: Object.freeze({ api: 'https://app.across.to/api', docs: 'https://docs.across.to/api-reference/swap/approval/get' }),
  }),
  /** A Review authorizes wallet requests for at most this long (and never past the provider quote's own validity). */
  reviewTtlSeconds: 180,
  /** A bridge deposit is never prepared closer than this to the SpokePool's quote-time limit or the fill deadline. */
  depositSafetyMarginSeconds: 300,
  defaultSlippageBps: 50, maximumSlippageBps: 300,
  /** Source and destination blocks must be at or below their chain's `safe` head before success is final. */
  finality: 'safe',
  /** Destination log scan window per observation (Arbitrum blocks are ≈ 0.25 s). */
  destinationScanBlocks: 2_000,
});
/**
 * BUILD-JOURNEY-001: the same router on public testnets with test USDC, Base Sepolia (84532) → Arbitrum Sepolia (421614),
 * so any external wallet can complete the journey without real funds or an operator opt-in.
 *
 * Verified read-only on 2026-10-04 against https://sepolia.base.org (block ≈ 47,686,000) and
 * https://sepolia-rollup.arbitrum.io/rpc (block ≈ 315,767,000): code present at every address; both SpokePools report
 * their chain id (84532 / 421614), deposits/fills not paused, `depositQuoteTimeBuffer` = 3600, `fillDeadlineBuffer` =
 * 21600; both SpokePool proxies carry the same runtime code as the mainnet Across proxies. The Across testnet Swap API
 * (`https://testnet.across.to/api/swap/approval`) answers with the Base Sepolia SpokePool as `swapTx.to` and allowance
 * spender; LI.FI (`https://li.quest/v1/quote`, `allowBridges=across`) answers with the Diamond and fee forwarder below.
 * Both calldata shapes decode byte-exactly with the router codecs. A real Across `FilledRelay` of Base Sepolia USDC to
 * Arbitrum Sepolia USDC was observed on 2026-10-04 (`0x7fba4c5d…7cb9`). Testnet relayer liquidity is small (the Across
 * API reported a 8.000352 USDC maximum deposit), hence the pair's 5 USDC ceiling.
 */
export const CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA: RouterProfile = Object.freeze({
  id: 'base-sepolia-usdc-to-arbitrum-sepolia-usdc', adapterId: 'flofi.router', underlyingProtocol: 'across', network: 'TESTNET', environment: 'PUBLIC_TESTNET',
  source: Object.freeze({ network: 'Base Sepolia', chain: 'eip155:84532', chainId: 84532, chainHex: '0x14a34', rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org/', usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    spokePool: '0x82b564983ae7274c86695917bbf8c99ecb6f0f8f', lifiDiamond: '0x816fc6eee47e3157a666827a0c06205294c81770',
    lifiFeeForwarder: '0xc7e003943ddae973d7d6455ab54a22e18302abeb' }),
  destination: Object.freeze({ network: 'Arbitrum Sepolia', chain: 'eip155:421614', chainId: 421614, chainHex: '0x66eee',
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io/', usdc: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
    spokePool: '0x7e63a5f1a8f0b4d0934b2f2327daed3f6bb2ee75' }),
  /** SHA-256 of the runtime code read on 2026-10-04; a different deployment fails closed. */
  codeSha256: Object.freeze({
    baseSpokePool: '3cc5e539eb61133fec38655ae3f55d8e1f944fce2cbc02e151972cf9c9880545',
    baseLifiDiamond: '1aa40e468f883ff7a9f061860064d14886dbd983d73cb2bff21df56363ad79e3',
    baseLifiFeeForwarder: '5e2c2193e2f00b726b31634ef323b30cf65cae3d78444403b43e6a5b8cc2e357',
    baseUsdc: 'e878b99fc0c17354c86c7edeb999c70c18cfd925abb0958496f027cbad996d28',
    arbitrumSpokePool: '3cc5e539eb61133fec38655ae3f55d8e1f944fce2cbc02e151972cf9c9880545',
    arbitrumUsdc: '6deb9dc1d51dd7acc0eb359f0bbbc65ae282468d57055aa231b056ca054312d7',
  }),
  providers: Object.freeze({
    lifi: Object.freeze({ api: 'https://li.quest/v1', integrator: 'flofi', docs: 'https://docs.li.fi/api-reference/get-a-quote-for-a-token-transfer' }),
    across: Object.freeze({ api: 'https://testnet.across.to/api', docs: 'https://docs.across.to/reference/testnet-environment' }),
  }),
  reviewTtlSeconds: 180, depositSafetyMarginSeconds: 300, defaultSlippageBps: 50, maximumSlippageBps: 300, finality: 'safe', destinationScanBlocks: 2_000,
});
export type CrossChainRouterProfile = RouterProfile;
export const CROSSCHAIN_ROUTER_PROFILES: readonly RouterProfile[] = Object.freeze([CROSSCHAIN_ROUTER_BASE_ARBITRUM, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA]);
/** The profile serving one canonical pair (source and destination CAIP-2 chains), or null. */
export function routerProfileFor(sourceChain: string, destinationChain: string): RouterProfile | null {
  return CROSSCHAIN_ROUTER_PROFILES.find(p => p.source.chain === sourceChain && p.destination.chain === destinationChain) ?? null;
}

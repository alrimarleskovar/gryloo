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
export const CROSSCHAIN_ROUTER_BASE_ARBITRUM = Object.freeze({
  id: 'base-usdc-to-arbitrum-usdc', adapterId: 'flofi.router', underlyingProtocol: 'across',
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
export type CrossChainRouterProfile = typeof CROSSCHAIN_ROUTER_BASE_ARBITRUM;

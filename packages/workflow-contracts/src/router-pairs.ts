// SPDX-License-Identifier: Apache-2.0
/** BUILD-ROUTER-001: router identities and supported pairs. Dependency-free so schema validation can use it. */
export const ROUTER_ADAPTER = Object.freeze({ id: 'flofi.router', version: '1.0.0' } as const);
export const ROUTER_CAPABILITY = 'bridge.direct-transaction';
/** Routing providers the router can ask for a route. Order in the IR is the owner's preference. */
export const ROUTING_PROVIDERS = Object.freeze(['lifi', 'across'] as const);
export type RoutingProvider = typeof ROUTING_PROVIDERS[number];
/** Underlying bridge protocols whose settlement the router can reconcile independently on chain. */
export const RECONCILABLE_PROTOCOLS = Object.freeze(['across'] as const);
export type UnderlyingProtocol = typeof RECONCILABLE_PROTOCOLS[number];

export type RouterToken = { readonly chainId: string; readonly address: string; readonly decimals: number; readonly symbol: string };
export type RouterPair = { readonly id: string; readonly source: RouterToken; readonly destination: RouterToken;
  readonly minimumAmount: string; readonly maximumAmount: string };
/** Pairs the canonical IR accepts. Deployment details (contracts, RPCs, pins) live in the action registry profile. */
export const ROUTER_PAIRS: readonly RouterPair[] = Object.freeze([Object.freeze({
  id: 'base-usdc-to-arbitrum-usdc',
  source: Object.freeze({ chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC' }),
  destination: Object.freeze({ chainId: 'eip155:42161', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6, symbol: 'USDC' }),
  minimumAmount: '100000', maximumAmount: '100000000',
}), Object.freeze({
  // BUILD-JOURNEY-001: test USDC on public testnets; the ceiling stays below the Across testnet relayer's deposit limit.
  id: 'base-sepolia-usdc-to-arbitrum-sepolia-usdc',
  source: Object.freeze({ chainId: 'eip155:84532', address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', decimals: 6, symbol: 'USDC' }),
  destination: Object.freeze({ chainId: 'eip155:421614', address: '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d', decimals: 6, symbol: 'USDC' }),
  minimumAmount: '500000', maximumAmount: '5000000',
})]);
export const ROUTER_MAXIMUM_SLIPPAGE_BPS = 300;
export function routerPair(sourceChain: string, sourceToken: string, destinationChain: string, destinationToken: string): RouterPair | null {
  return ROUTER_PAIRS.find(p => p.source.chainId === sourceChain && p.source.address === sourceToken &&
    p.destination.chainId === destinationChain && p.destination.address === destinationToken) ?? null;
}

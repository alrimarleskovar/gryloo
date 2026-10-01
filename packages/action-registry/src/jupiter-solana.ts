// SPDX-License-Identifier: Apache-2.0
/**
 * Jupiter Swap API V2 `/build` (Metis router) on Solana mainnet-beta.
 * Sources: https://developers.jup.ag/docs/swap/build and
 * https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml (checked 2026-10-01).
 * The API has no cluster parameter; devnet mints return "No routes found". Execution is mainnet-only.
 * Mint owners/decimals and the executable Jupiter program were read from mainnet-beta at slot 452337813.
 */
export const SOLANA_MAINNET_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export type SolanaTokenSymbol = 'SOL' | 'USDC' | 'USDT';
export type SolanaToken = { readonly symbol: SolanaTokenSymbol; readonly mint: string; readonly decimals: number;
  readonly native: boolean; readonly maximumAmount: string };
export const SOLANA_MAINNET_TOKENS: Readonly<Record<SolanaTokenSymbol, SolanaToken>> = Object.freeze({
  // Jupiter identifies native SOL by the wrapped SOL mint and wraps/unwraps around the swap.
  SOL: Object.freeze({ symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, native: true, maximumAmount: '1000000000000' }),
  USDC: Object.freeze({ symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, native: false, maximumAmount: '1000000000000' }),
  USDT: Object.freeze({ symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, native: false, maximumAmount: '1000000000000' }),
});
export const JUPITER_SOLANA_MAINNET = Object.freeze({
  network: 'Solana', cluster: 'mainnet-beta', chain: SOLANA_MAINNET_CHAIN, walletChain: 'solana:mainnet',
  genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', protocol: 'jupiter', adapterId: 'jupiter.swap-v2',
  api: 'https://api.jup.ag/swap/v2', endpoint: '/build', rpc: 'https://api.mainnet-beta.solana.com',
  explorer: 'https://solscan.io', officialSource: 'https://developers.jup.ag/docs/swap/build',
  programs: Object.freeze({
    jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    jupiterEventAuthority: 'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',
    token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    system: '11111111111111111111111111111111',
    computeBudget: 'ComputeBudget111111111111111111111111111111',
  }),
  /** Anchor discriminators sha256("global:<name>")[0..8]; the only accepted swap instructions (exact input). */
  routeV2Discriminator: 'bb64facc31c4af14', sharedAccountsRouteV2Discriminator: 'd19853937cfed8e9',
  maximumSlippageBps: 300, reviewTtlSeconds: 60, baseFeeLamports: '5000', maximumComputeUnits: 1_400_000,
});
export function solanaTokenByMint(mint: string): SolanaToken | null {
  return Object.values(SOLANA_MAINNET_TOKENS).find(token => token.mint === mint) ?? null;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Orca Whirlpools on Solana Devnet: the verified Devnet runtime for the canonical swap.
 * Sources (checked 2026-10-01): https://docs.orca.so/llms.txt ("Protocol Constants", "Devnet Test Pool") and
 * https://docs.orca.so/developers/architecture/whirlpool-parameters (Devnet WhirlpoolsConfig).
 * Program, config, pool, mints, vaults and tick spacing were read from Devnet (genesis
 * EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG) at slot 506350744. Orca's docs list the pool as tick spacing 8;
 * the on-chain account says 64, and the chain is authoritative. Every simulation re-reads and re-verifies it.
 * Devnet tokens have no value. Jupiter is not involved: Jupiter routing is mainnet-only.
 */
export const SOLANA_DEVNET_CHAIN = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export type SolanaDevnetTokenSymbol = 'SOL' | 'devUSDC';
export type SolanaDevnetToken = { readonly symbol: SolanaDevnetTokenSymbol; readonly label: string; readonly mint: string; readonly decimals: number;
  readonly native: boolean; readonly maximumAmount: string };
export const SOLANA_DEVNET_TOKENS: Readonly<Record<SolanaDevnetTokenSymbol, SolanaDevnetToken>> = Object.freeze({
  // Native Devnet SOL, wrapped around the swap through the owner's own temporary wrapped-SOL account.
  SOL: Object.freeze({ symbol: 'SOL', label: 'Devnet SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, native: true, maximumAmount: '10000000000' }),
  // Orca's documented Devnet test USDC. Valueless; not Circle USDC.
  devUSDC: Object.freeze({ symbol: 'devUSDC', label: 'devUSDC (test)', mint: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6, native: false, maximumAmount: '1000000000' }),
});
export const ORCA_WHIRLPOOLS_DEVNET = Object.freeze({
  network: 'Solana Devnet', cluster: 'devnet', chain: SOLANA_DEVNET_CHAIN, walletChain: 'solana:devnet',
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', protocol: 'orca-whirlpools', adapterId: 'orca.whirlpools-devnet',
  providerLabel: 'Orca Whirlpools', rpc: 'https://api.devnet.solana.com', explorer: 'https://explorer.solana.com',
  officialSource: 'https://docs.orca.so/llms.txt', parametersSource: 'https://docs.orca.so/developers/architecture/whirlpool-parameters',
  faucet: 'https://faucet.solana.com',
  programs: Object.freeze({
    whirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    system: '11111111111111111111111111111111',
    computeBudget: 'ComputeBudget111111111111111111111111111111',
    memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  }),
  whirlpoolsConfig: 'FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR',
  /** Orca's documented Devnet test pool: token A is wrapped SOL, token B is devUSDC. */
  pool: Object.freeze({ address: '3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt', tokenMintA: 'So11111111111111111111111111111111111111112',
    tokenMintB: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', tokenVaultA: 'C9zLV5zWF66j3rZj3uuhDqvfuA8esJyWnruGzDW9qEj2',
    tokenVaultB: '7DM3RMz2yzUB8yPRQM3FMZgdFrwZGMsabsfsKopWktoX', tickSpacing: 64 }),
  /** Anchor sha256("global:swap_v2")[0..8] and sha256("event:Traded")[0..8]. */
  swapV2Discriminator: '2b04ed0b1ac91e62', tradedEventDiscriminator: 'e1ca49af932ba096',
  maximumSlippageBps: 300, reviewTtlSeconds: 60, baseFeeLamports: '5000', maximumComputeUnits: 400_000,
});
export function solanaDevnetTokenByMint(mint: string): SolanaDevnetToken | null {
  return Object.values(SOLANA_DEVNET_TOKENS).find(token => token.mint === mint) ?? null;
}

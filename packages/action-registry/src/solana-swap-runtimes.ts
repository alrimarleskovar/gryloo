// SPDX-License-Identifier: Apache-2.0
import { JUPITER_SOLANA_MAINNET, SOLANA_MAINNET_TOKENS } from './jupiter-solana.js';
import { ORCA_WHIRLPOOLS_DEVNET, SOLANA_DEVNET_TOKENS } from './solana-devnet.js';

/**
 * The canonical swap's Solana runtimes. The semantic action is identical; only the cluster, asset identity and
 * provider differ. Mainnet routes through Jupiter; Devnet executes against Orca Whirlpools with valueless test tokens.
 */
export type SolanaSwapToken = { readonly symbol: string; readonly label?: string; readonly mint: string; readonly decimals: number;
  readonly native: boolean; readonly maximumAmount: string };
export type SolanaSwapRuntime = {
  readonly chain: string; readonly cluster: 'mainnet-beta' | 'devnet'; readonly network: 'Solana' | 'Solana Devnet';
  readonly genesisHash: string; readonly walletChain: 'solana:mainnet' | 'solana:devnet';
  readonly protocol: string; readonly adapterId: string; readonly providerLabel: string; readonly providerProgram: string;
  /** Prefix for errors raised by the shared Solana execution core on this runtime. */
  readonly codePrefix: 'JUPITER' | 'DEVNET_SWAP'; readonly idPrefix: 'jupiter' | 'orca';
  readonly environment: 'MAINNET' | 'PUBLIC_TESTNET'; readonly provenance: 'PUBLIC_MAINNET' | 'PUBLIC_DEVNET';
  /** Evidence class of an owner-initiated, reconciled run, and the frozen v1 Evidence Bundle environment it maps to. */
  readonly executedEvidence: 'PUBLIC_EXECUTED' | 'DEVNET_EXECUTED'; readonly bundleEnvironment: 'MAINNET_EXECUTED' | 'TESTNET_EXECUTED';
  readonly realFunds: boolean; readonly maximumSlippageBps: number; readonly baseFeeLamports: string;
  readonly tokens: Readonly<Record<string, SolanaSwapToken>>; readonly officialSource: string;
  explorerTx(signature: string): string;
};
export const SOLANA_SWAP_RUNTIMES: readonly SolanaSwapRuntime[] = Object.freeze([
  Object.freeze({ chain: JUPITER_SOLANA_MAINNET.chain, cluster: 'mainnet-beta', network: 'Solana', genesisHash: JUPITER_SOLANA_MAINNET.genesisHash,
    walletChain: 'solana:mainnet', protocol: JUPITER_SOLANA_MAINNET.protocol, adapterId: JUPITER_SOLANA_MAINNET.adapterId, providerLabel: 'Jupiter',
    providerProgram: JUPITER_SOLANA_MAINNET.programs.jupiter, codePrefix: 'JUPITER', idPrefix: 'jupiter', environment: 'MAINNET', provenance: 'PUBLIC_MAINNET',
    executedEvidence: 'PUBLIC_EXECUTED', bundleEnvironment: 'MAINNET_EXECUTED', realFunds: true, maximumSlippageBps: JUPITER_SOLANA_MAINNET.maximumSlippageBps,
    baseFeeLamports: JUPITER_SOLANA_MAINNET.baseFeeLamports, tokens: SOLANA_MAINNET_TOKENS, officialSource: JUPITER_SOLANA_MAINNET.officialSource,
    explorerTx: (signature: string) => `${JUPITER_SOLANA_MAINNET.explorer}/tx/${signature}` }),
  Object.freeze({ chain: ORCA_WHIRLPOOLS_DEVNET.chain, cluster: 'devnet', network: 'Solana Devnet', genesisHash: ORCA_WHIRLPOOLS_DEVNET.genesisHash,
    walletChain: 'solana:devnet', protocol: ORCA_WHIRLPOOLS_DEVNET.protocol, adapterId: ORCA_WHIRLPOOLS_DEVNET.adapterId, providerLabel: ORCA_WHIRLPOOLS_DEVNET.providerLabel,
    providerProgram: ORCA_WHIRLPOOLS_DEVNET.programs.whirlpool, codePrefix: 'DEVNET_SWAP', idPrefix: 'orca', environment: 'PUBLIC_TESTNET', provenance: 'PUBLIC_DEVNET',
    executedEvidence: 'DEVNET_EXECUTED', bundleEnvironment: 'TESTNET_EXECUTED', realFunds: false, maximumSlippageBps: ORCA_WHIRLPOOLS_DEVNET.maximumSlippageBps,
    baseFeeLamports: ORCA_WHIRLPOOLS_DEVNET.baseFeeLamports, tokens: SOLANA_DEVNET_TOKENS, officialSource: ORCA_WHIRLPOOLS_DEVNET.officialSource,
    explorerTx: (signature: string) => `${ORCA_WHIRLPOOLS_DEVNET.explorer}/tx/${signature}?cluster=devnet` }),
] as const);
export function solanaSwapRuntime(chain: string): SolanaSwapRuntime | null {
  return SOLANA_SWAP_RUNTIMES.find(runtime => runtime.chain === chain) ?? null;
}
/** Asset identity is cluster + mint + decimals: the same mint string on another cluster is a different asset. */
export function solanaTokenOn(chain: string, mint: string): SolanaSwapToken | null {
  return Object.values(solanaSwapRuntime(chain)?.tokens ?? {}).find(token => token.mint === mint) ?? null;
}

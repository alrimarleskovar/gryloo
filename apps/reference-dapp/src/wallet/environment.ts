// SPDX-License-Identifier: AGPL-3.0-only
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, type ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import { EVM_WALLET_NETWORKS, walletNetwork } from './evm-networks';

export type WalletEnvironment = 'testnet' | 'mainnet' | 'unknown';
/** Wallet Standard aliases resolve only to the two supported, exact Solana chain identities. */
export function solanaWalletChainRef(chain: string | null | undefined): string | null {
  if (chain === JUPITER_SOLANA_MAINNET.walletChain || chain === JUPITER_SOLANA_MAINNET.chain) return JUPITER_SOLANA_MAINNET.chain;
  if (chain === ORCA_WHIRLPOOLS_DEVNET.walletChain || chain === ORCA_WHIRLPOOLS_DEVNET.chain) return ORCA_WHIRLPOOLS_DEVNET.chain;
  return null;
}
/** Classify only a connected wallet's reported chain or explicitly connected Solana session cluster. */
export function classifyWalletEnvironment(chain: string | null | undefined): WalletEnvironment {
  if (!chain) return 'unknown';
  if (chain === 'solana:mainnet' || chain === JUPITER_SOLANA_MAINNET.chain) return 'mainnet';
  if (chain === 'solana:devnet' || chain === ORCA_WHIRLPOOLS_DEVNET.chain) return 'testnet';
  return (walletNetwork(chain) ?? EVM_WALLET_NETWORKS.find(network => network.chain === chain))?.environment ?? 'unknown';
}
export const walletEnvironmentLabel = (environment: WalletEnvironment) => ({ testnet: 'Testnet', mainnet: 'Mainnet', unknown: 'Network' })[environment];
export function walletExecutionEnvironment(environment: WalletEnvironment): ExecutionEnvironment | null {
  return environment === 'mainnet' ? 'MAINNET' : environment === 'testnet' ? 'PUBLIC_TESTNET' : null;
}

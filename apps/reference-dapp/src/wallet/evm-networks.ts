// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The EVM networks the single shared injected wallet recognizes. A network is a switch target
 * only where a Gryloo flow may ask the owner to move there, and is added to the wallet only from
 * official parameters after the wallet reports it unknown (EIP-1193 code 4902). Switching never
 * signs, sends or retries a transaction.
 */
import { ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET, robinhoodAddChainParameters } from '@defi-workflow-engine/action-registry';

export type AddChainParameters = { readonly chainId: string; readonly chainName: string;
  readonly nativeCurrency: { readonly name: string; readonly symbol: string; readonly decimals: number };
  readonly rpcUrls: readonly string[]; readonly blockExplorerUrls: readonly string[] };
export type EvmWalletNetwork = { readonly hex: string; readonly chain: string; readonly label: string;
  readonly switchable: boolean; readonly add: AddChainParameters | null };
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };

export const EVM_WALLET_NETWORKS: readonly EvmWalletNetwork[] = Object.freeze([
  { hex: '0xa5bf', chain: 'eip155:42431', label: 'Tempo Moderato (42431)', switchable: true, add: { chainId: '0xa5bf', chainName: 'Tempo Moderato', nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 }, rpcUrls: ['https://rpc.moderato.tempo.xyz'], blockExplorerUrls: ['https://explore.testnet.tempo.xyz'] } },
  { hex: '0x2105', chain: 'eip155:8453', label: 'Base (8453)', switchable: true, add: null },
  { hex: '0xa4b1', chain: 'eip155:42161', label: 'Arbitrum (42161)', switchable: true, add: null },
  { hex: '0x14a34', chain: 'eip155:84532', label: 'Base Sepolia', switchable: true, add: { chainId: '0x14a34',
    chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] } },
  { hex: ROBINHOOD_CHAIN_TESTNET.chainHex, chain: ROBINHOOD_CHAIN_TESTNET.chain, label: 'Robinhood Chain Testnet (46630)',
    switchable: true, add: robinhoodAddChainParameters(ROBINHOOD_CHAIN_TESTNET) },
  // Recognized for display and wrong-chain detection. No Gryloo flow executes here, so it is never a switch target.
  { hex: ROBINHOOD_CHAIN_MAINNET.chainHex, chain: ROBINHOOD_CHAIN_MAINNET.chain, label: 'Robinhood Chain (4663)',
    switchable: false, add: null },
].map(network => Object.freeze(network)));

export function walletNetwork(hex: string | null | undefined): EvmWalletNetwork | null {
  if (typeof hex !== 'string') return null;
  const value = hex.toLowerCase();
  return EVM_WALLET_NETWORKS.find(network => network.hex === value) ?? null;
}
/** The CAIP-2 reference of the wallet's reported chain, or null when the chain is not recognized. */
export function walletChainRef(hex: string | null | undefined): string | null { return walletNetwork(hex)?.chain ?? null; }
export function walletChainLabel(hex: string | null | undefined): string {
  if (!hex) return 'Unknown';
  return walletNetwork(hex)?.label ?? `Other chain (${hex})`;
}

/**
 * Asks the wallet to switch, adds the network from official parameters only on 4902, switches
 * again, and requires the wallet to report the target chain afterwards. Any other failure throws.
 */
export async function switchWalletNetwork(provider: Provider, hex: string): Promise<void> {
  const target = walletNetwork(hex);
  if (!target || !target.switchable) throw new Error('WALLET_NETWORK_NOT_SWITCHABLE');
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.hex }] }); }
  catch (cause) {
    if (!target.add || !cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 4902) throw cause;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ ...target.add,
      rpcUrls: [...target.add.rpcUrls], blockExplorerUrls: [...target.add.blockExplorerUrls] }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.hex }] });
  }
  const actual = await provider.request({ method: 'eth_chainId' });
  if (typeof actual !== 'string' || actual.toLowerCase() !== target.hex) throw new Error('WALLET_DID_NOT_SWITCH');
}

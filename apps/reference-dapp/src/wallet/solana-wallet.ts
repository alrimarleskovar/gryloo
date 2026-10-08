// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal Wallet Standard client (https://github.com/wallet-standard/wallet-standard) for owner-controlled Solana wallets.
 * Gryloo only asks the owner's wallet to connect and to sign one exact transaction. It never holds keys and never
 * uses sign-and-send: the returned bytes are verified against the Review before any broadcast.
 */
import { safeWalletIcon, safeWalletName, type WalletChoice } from './wallet-registry';

export type SolanaWalletAccount = { readonly address: string; readonly chains: readonly string[]; readonly features: readonly string[] };
export type StandardWallet = { readonly name: string; readonly icon?: string; readonly chains: readonly string[]; readonly accounts: readonly SolanaWalletAccount[];
  readonly features: Readonly<Record<string, unknown>> };
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly SolanaWalletAccount[] }> };
type SignFeature = { signTransaction(...inputs: { account: SolanaWalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]> };
export const SOLANA_WALLET_CHAIN = 'solana:mainnet';
export type SolanaWalletChain = 'solana:mainnet' | 'solana:devnet';

const registered: StandardWallet[] = [];
const registrationListeners = new Set<() => void>();
let listening = false;
function register(...wallets: StandardWallet[]) {
  let added = false;
  for (const wallet of wallets) if (!registered.includes(wallet)) { registered.push(wallet); added = true; }
  if (added) for (const listener of registrationListeners) listener();
  return () => undefined;
}
/** Wallet Standard app-ready / register-wallet handshake without an extra dependency. */
function registeredWallets(): StandardWallet[] {
  if (typeof window === 'undefined') return [];
  if (!listening) {
    listening = true;
    const api = Object.freeze({ register });
    window.addEventListener('wallet-standard:register-wallet', event => {
      const callback = (event as CustomEvent<unknown>).detail;
      if (typeof callback === 'function') callback(api);
    });
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  }
  return registered;
}
export function solanaWallets(chain: SolanaWalletChain = SOLANA_WALLET_CHAIN): StandardWallet[] {
  return registeredWallets().filter(wallet => Array.isArray(wallet.chains) && wallet.chains.includes(chain) &&
    'standard:connect' in wallet.features && 'solana:signTransaction' in wallet.features);
}
/**
 * Selector choices, one per wallet name. Without `chain`: every wallet that can connect on some Solana cluster. With `chain`:
 * only wallets that can connect and sign on that cluster, exactly as the Solana flows require. Multichain wallets (Phantom)
 * appear here for Solana and separately in EVM discovery for Ethereum; the identities never merge.
 */
export function solanaWalletChoices(chain?: SolanaWalletChain): WalletChoice[] {
  const seen = new Set<string>();
  return (chain ? solanaWallets(chain) : registeredWallets()).filter(wallet => typeof wallet.name === 'string' && wallet.name && Array.isArray(wallet.chains) &&
    wallet.chains.some(entry => typeof entry === 'string' && entry.startsWith('solana:')) && 'standard:connect' in (wallet.features ?? {}))
    .flatMap(wallet => {
      if (seen.has(wallet.name)) return [];
      seen.add(wallet.name);
      return [{ id: `solana:${wallet.name}`, ecosystem: 'solana' as const, key: wallet.name, name: safeWalletName(wallet.name, 'Solana wallet'), icon: safeWalletIcon(wallet.icon) }];
    });
}
export function subscribeSolanaDiscovery(listener: () => void): () => void {
  registeredWallets();
  registrationListeners.add(listener);
  return () => { registrationListeners.delete(listener); };
}
/** Names of the registered wallets that advertise `chain` plus connect and signTransaction, in registration order. */
export function solanaWalletNames(chain: SolanaWalletChain = SOLANA_WALLET_CHAIN): string[] {
  return solanaWallets(chain).map(wallet => wallet.name);
}
/** One owner wallet session per cluster. `prefix` names the runtime in error codes (JUPITER on mainnet, DEVNET_SWAP on Devnet). */
export type SolanaSession = { wallet: StandardWallet; account: SolanaWalletAccount; chain: SolanaWalletChain };
/** Connects only the wallet the owner explicitly chose by name; there is no first-registered fallback. */
export async function connectSolanaWallet(name: string, chain: SolanaWalletChain = SOLANA_WALLET_CHAIN, prefix = 'JUPITER'): Promise<SolanaSession> {
  if (typeof name !== 'string' || !name) throw new Error(`${prefix}_SOLANA_WALLET_SELECTION_REQUIRED`);
  const matches = solanaWallets(chain).filter(w => w.name === name);
  if (matches.length > 1) throw new Error(`${prefix}_SOLANA_WALLET_AMBIGUOUS`);
  const wallet = matches[0];
  if (!wallet) throw new Error(`${prefix}_SOLANA_WALLET_REQUIRED`);
  const { accounts } = await (wallet.features['standard:connect'] as ConnectFeature).connect();
  const account = accounts.find(a => a.chains.includes(chain) && a.features.includes('solana:signTransaction')) ?? accounts[0];
  if (!account || typeof account.address !== 'string') throw new Error(`${prefix}_SOLANA_WALLET_REQUIRED`);
  return { wallet, account, chain };
}
type DisconnectFeature = { disconnect(): Promise<void> };
/** Ends FloFi's use of the session. Wallets that implement `standard:disconnect` also forget the connection; it never prompts. */
export async function disconnectSolanaWallet(session: SolanaSession): Promise<void> {
  const feature = session.wallet.features['standard:disconnect'] as DisconnectFeature | undefined;
  try { await feature?.disconnect(); } catch { /* the FloFi session is cleared regardless */ }
}
export const base64ToBytes = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const bytesToBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
/** Owner signature only. Any wallet error means no signed bytes exist in Gryloo and nothing was submitted. */
export async function signWithSolanaWallet(session: SolanaSession, unsignedTransaction: string, prefix = 'JUPITER'): Promise<string> {
  const feature = session.wallet.features['solana:signTransaction'] as SignFeature | undefined;
  if (!feature) throw new Error(`${prefix}_SOLANA_WALLET_REQUIRED`);
  const [result] = await feature.signTransaction({ account: session.account, transaction: base64ToBytes(unsignedTransaction), chain: session.chain });
  // Extension wallets may return a typed array from another realm; copy the exact bytes.
  const signed = result?.signedTransaction as unknown;
  if (!ArrayBuffer.isView(signed) || signed.byteLength > 1232) throw new Error(`${prefix}_WALLET_RESPONSE_INVALID`);
  return bytesToBase64(new Uint8Array(signed.buffer, signed.byteOffset, signed.byteLength).slice());
}

type SignMessageFeature = { signMessage(...inputs: { account: SolanaWalletAccount; message: Uint8Array }[]): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> };
/** BUILD-MCP-002: whether the connected wallet can prove control with Sign-In With Solana (`solana:signMessage`). */
export const canSignSolanaMessage = (session: SolanaSession) => 'solana:signMessage' in session.wallet.features;
/**
 * BUILD-MCP-002: the owner's wallet signs the exact sign-in text (never a transaction). Returns the 64-byte Ed25519 signature
 * in base64; the server verifies it against the account's public key. A wallet that rewrites the message is refused.
 */
export async function signSolanaMessage(session: SolanaSession, text: string, prefix = 'WALLET'): Promise<string> {
  const feature = session.wallet.features['solana:signMessage'] as SignMessageFeature | undefined;
  if (!feature) throw new Error(`${prefix}_SOLANA_SIGN_MESSAGE_UNSUPPORTED`);
  const message = new TextEncoder().encode(text);
  const [result] = await feature.signMessage({ account: session.account, message });
  const signed = result?.signedMessage as unknown, signature = result?.signature as unknown;
  if (!ArrayBuffer.isView(signature) || signature.byteLength !== 64) throw new Error(`${prefix}_WALLET_RESPONSE_INVALID`);
  if (ArrayBuffer.isView(signed)) {
    const echoed = new Uint8Array(signed.buffer, signed.byteOffset, signed.byteLength);
    if (echoed.length !== message.length || echoed.some((byte, i) => byte !== message[i])) throw new Error(`${prefix}_WALLET_RESPONSE_INVALID`);
  }
  return bytesToBase64(new Uint8Array(signature.buffer, signature.byteOffset, signature.byteLength).slice());
}

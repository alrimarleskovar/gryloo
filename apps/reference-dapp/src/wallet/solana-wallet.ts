// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal Wallet Standard client (https://github.com/wallet-standard/wallet-standard) for owner-controlled Solana wallets.
 * Gryloo only asks the owner's wallet to connect and to sign one exact transaction. It never holds keys and never
 * uses sign-and-send: the returned bytes are verified against the Review before any broadcast.
 */
export type SolanaWalletAccount = { readonly address: string; readonly chains: readonly string[]; readonly features: readonly string[] };
export type StandardWallet = { readonly name: string; readonly chains: readonly string[]; readonly accounts: readonly SolanaWalletAccount[];
  readonly features: Readonly<Record<string, unknown>> };
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly SolanaWalletAccount[] }> };
type SignFeature = { signTransaction(...inputs: { account: SolanaWalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]> };
export const SOLANA_WALLET_CHAIN = 'solana:mainnet';

const registered: StandardWallet[] = [];
let listening = false;
function register(...wallets: StandardWallet[]) {
  for (const wallet of wallets) if (!registered.includes(wallet)) registered.push(wallet);
  return () => undefined;
}
/** Wallet Standard app-ready / register-wallet handshake without an extra dependency. */
export function solanaWallets(): StandardWallet[] {
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
  return registered.filter(wallet => Array.isArray(wallet.chains) && wallet.chains.includes(SOLANA_WALLET_CHAIN) &&
    'standard:connect' in wallet.features && 'solana:signTransaction' in wallet.features);
}
export type SolanaSession = { wallet: StandardWallet; account: SolanaWalletAccount };
export async function connectSolanaWallet(name?: string): Promise<SolanaSession> {
  const wallet = solanaWallets().find(w => !name || w.name === name);
  if (!wallet) throw new Error('JUPITER_SOLANA_WALLET_REQUIRED');
  const { accounts } = await (wallet.features['standard:connect'] as ConnectFeature).connect();
  const account = accounts.find(a => a.chains.includes(SOLANA_WALLET_CHAIN) && a.features.includes('solana:signTransaction')) ?? accounts[0];
  if (!account || typeof account.address !== 'string') throw new Error('JUPITER_SOLANA_WALLET_REQUIRED');
  return { wallet, account };
}
export const base64ToBytes = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export const bytesToBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
/** Owner signature only. Any wallet error means no signed bytes exist in Gryloo and nothing was submitted. */
export async function signWithSolanaWallet(session: SolanaSession, unsignedTransaction: string): Promise<string> {
  const feature = session.wallet.features['solana:signTransaction'] as SignFeature | undefined;
  if (!feature) throw new Error('JUPITER_SOLANA_WALLET_REQUIRED');
  const [result] = await feature.signTransaction({ account: session.account, transaction: base64ToBytes(unsignedTransaction), chain: SOLANA_WALLET_CHAIN });
  // Extension wallets may return a typed array from another realm; copy the exact bytes.
  const signed = result?.signedTransaction as unknown;
  if (!ArrayBuffer.isView(signed) || signed.byteLength > 1232) throw new Error('JUPITER_WALLET_RESPONSE_INVALID');
  return bytesToBase64(new Uint8Array(signed.buffer, signed.byteOffset, signed.byteLength).slice());
}

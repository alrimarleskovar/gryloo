// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The single wallet identity model shared by the header, Credentials and execution surfaces. A wallet choice is one
 * provider in one ecosystem: Phantom on Solana and Phantom on Ethereum are two choices with two identities. Nothing here
 * talks to a wallet; discovery lives in `evm-discovery.ts` (EIP-6963 with an EIP-1193 fallback) and `solana-wallet.ts`
 * (Wallet Standard), and a wallet is invoked only after the owner picks it in the selector.
 */
export type WalletEcosystem = 'evm' | 'solana';
export const WALLET_ECOSYSTEMS: readonly WalletEcosystem[] = ['evm', 'solana'];
/** User-facing ecosystem names; protocol names (EIP-6963, Wallet Standard) never reach the interface. */
export const ECOSYSTEM_LABEL: Readonly<Record<WalletEcosystem, string>> = Object.freeze({ evm: 'Ethereum', solana: 'Solana' });

export type WalletChoice = {
  /** Unique on this page: `evm:<announcement uuid | rdns | legacy index>` or `solana:<wallet name>`. */
  readonly id: string;
  readonly ecosystem: WalletEcosystem;
  /** Stable provider identity across page loads: the EIP-6963 rdns, the Wallet Standard name, or `injected` for a legacy provider. */
  readonly key: string;
  readonly name: string;
  /** Provider-supplied metadata image (data URI only), never a FloFi-drawn brand. */
  readonly icon: string | null;
};
export type KnownWallet = { readonly ecosystem: WalletEcosystem; readonly key: string; readonly name: string };
/** Wallets listed as "Not detected" when absent. No logo is drawn for them because FloFi ships no wallet brand assets. */
export const KNOWN_WALLETS: readonly KnownWallet[] = Object.freeze([
  { ecosystem: 'solana', key: 'Phantom', name: 'Phantom' },
  { ecosystem: 'evm', key: 'io.metamask', name: 'MetaMask' },
  { ecosystem: 'evm', key: 'io.rabby', name: 'Rabby Wallet' },
  { ecosystem: 'evm', key: 'app.phantom', name: 'Phantom' },
  { ecosystem: 'evm', key: 'com.coinbase.wallet', name: 'Coinbase Wallet' },
  { ecosystem: 'solana', key: 'Backpack', name: 'Backpack' },
  { ecosystem: 'solana', key: 'Solflare', name: 'Solflare' },
] as const);

const control = (character: string) => { const code = character.charCodeAt(0); return code < 0x20 || code === 0x7f; };
/** Replaces control characters (line breaks, NUL, DEL…) with spaces. */
export function withoutControlCharacters(text: string): string { return Array.from(text, character => control(character) ? ' ' : character).join(''); }
// An <img> never runs script, so an image data URI (EIP-6963 requires one) is safe to show; no remote URL is fetched.
const ICON = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]/i;
/** Accept only bounded image data URIs from wallet metadata; anything else renders the neutral wallet glyph. */
export function safeWalletIcon(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 200_000 && ICON.test(value) && !Array.from(value).some(control) ? value : null;
}
/** Wallet names come from extensions: keep them short, single-line and printable. */
export function safeWalletName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? withoutControlCharacters(value).replace(/\s+/g, ' ').trim().slice(0, 48) : '';
  return name || fallback;
}
const sameKey = (choice: Pick<WalletChoice, 'ecosystem' | 'key' | 'name'>, known: KnownWallet) => choice.ecosystem === known.ecosystem &&
  (choice.key.toLowerCase() === known.key.toLowerCase() || (choice.ecosystem === 'solana' && choice.name.toLowerCase() === known.name.toLowerCase()));
/** Known wallets that no detected choice already covers, in catalogue order. */
export function undetectedWallets(detected: readonly WalletChoice[], ecosystems: readonly WalletEcosystem[]): KnownWallet[] {
  return KNOWN_WALLETS.filter(known => ecosystems.includes(known.ecosystem) && !detected.some(choice => sameKey(choice, known)));
}
/** Detected wallets: the remembered choice first (highlight only, never auto-open), then by name and ecosystem. */
export function orderWalletChoices(choices: readonly WalletChoice[], preference: WalletPreference): WalletChoice[] {
  const remembered = (choice: WalletChoice) => preference[choice.ecosystem] === choice.key ? 0 : 1;
  return [...choices].sort((a, b) => remembered(a) - remembered(b) || a.name.localeCompare(b.name) ||
    ECOSYSTEM_LABEL[a.ecosystem].localeCompare(ECOSYSTEM_LABEL[b.ecosystem]) || a.id.localeCompare(b.id));
}

/** Only the last explicit choice per ecosystem, and whether the owner disconnected the EVM wallet. Never an address. */
export type WalletPreference = { readonly evm: string | null; readonly solana: string | null; readonly evmDisconnected: boolean };
const PREFERENCE_KEY = 'flofi.wallet.preference.v1';
const EMPTY: WalletPreference = Object.freeze({ evm: null, solana: null, evmDisconnected: false });
const KEY = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,63}$/;
function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage ?? null; } catch { return null; }
}
export function walletPreference(): WalletPreference {
  try {
    const value = JSON.parse(storage()?.getItem(PREFERENCE_KEY) ?? 'null') as Partial<Record<keyof WalletPreference, unknown>> | null;
    if (!value || typeof value !== 'object') return EMPTY;
    const key = (input: unknown) => typeof input === 'string' && KEY.test(input) ? input : null;
    return { evm: key(value.evm), solana: key(value.solana), evmDisconnected: value.evmDisconnected === true };
  } catch { return EMPTY; }
}
export function updateWalletPreference(change: Partial<WalletPreference>): void {
  try { storage()?.setItem(PREFERENCE_KEY, JSON.stringify({ ...walletPreference(), ...change })); } catch { /* preference is a convenience only */ }
}

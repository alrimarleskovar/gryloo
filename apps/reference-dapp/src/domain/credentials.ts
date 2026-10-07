// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Credentials are references, never secrets. A saved wallet is a public address with its provider and ecosystem; a saved
 * card is provider-issued tokenized metadata. Neither authorizes anything: Review, the Strategy Manifest and an explicit
 * wallet signature remain the only path to execution. Readers are strict: an entry with any extra field (for example a
 * key, seed phrase, card number or security code) is dropped, never repaired.
 */
import { withoutControlCharacters, type WalletEcosystem } from '../wallet/wallet-registry';

export type SavedWallet = {
  /** `<ecosystem>:<provider key>:<address>`: Phantom on Solana, Phantom on Ethereum, MetaMask and Rabby stay distinct. */
  readonly id: string;
  readonly ecosystem: WalletEcosystem;
  readonly address: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly label: string;
  /** Last network seen when the owner connected (CAIP-2), display only. */
  readonly lastNetwork: string | null;
  readonly addedAt: string;
};
export const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'elo', 'hipercard', 'discover', 'diners', 'jcb', 'unionpay', 'unknown'] as const;
export type CardBrand = typeof CARD_BRANDS[number];
export type SavedCard = {
  /** The provider's payment-method token id. Never a card number. */
  readonly id: string;
  readonly provider: string;
  readonly brand: CardBrand;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly label: string;
  readonly addedAt: string;
};
export type Credentials = { readonly wallets: readonly SavedWallet[]; readonly cards: readonly SavedCard[] };
export const EMPTY_CREDENTIALS: Credentials = Object.freeze({ wallets: Object.freeze([]), cards: Object.freeze([]) });

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PROVIDER_KEY = /^[A-Za-z0-9][A-Za-z0-9 ._:#-]{0,63}$/;
const NETWORK = /^(?:eip155:[1-9][0-9]{0,18}|solana:(?:mainnet|devnet))$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOKEN_ID = /^[A-Za-z][A-Za-z0-9_-]{5,127}$/;
export const LABEL_MAX = 40;

export function validWalletAddress(ecosystem: WalletEcosystem, address: string): boolean {
  return ecosystem === 'evm' ? EVM_ADDRESS.test(address) : SOLANA_ADDRESS.test(address);
}
/** A display name: printable, single line, bounded. Returns null when nothing usable remains. */
export function credentialLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = withoutControlCharacters(value).replace(/\s+/g, ' ').trim();
  return label && label.length <= LABEL_MAX && !containsCardNumber(label) ? label : null;
}
export const walletCredentialId = (ecosystem: WalletEcosystem, providerKey: string, address: string) => `${ecosystem}:${providerKey}:${address}`;
export function shortAddress(address: string): string { return `${address.slice(0, 4)}…${address.slice(-4)}`; }
export function networkLabel(chain: string | null): string {
  if (chain === 'solana:devnet') return 'Solana Devnet';
  if (chain === 'solana:mainnet') return 'Solana';
  return chain ?? 'Network unknown';
}

/** Luhn-valid digit runs of payment-card length, ignoring spaces and dashes between digits. */
export function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/\d(?:[ -]?\d){11,18}/g)) {
    const digits = match[0].replace(/[ -]/g, '');
    for (let length = 19; length >= 12; length--) for (let start = 0; start + length <= digits.length; start++)
      if (luhn(digits.slice(start, start + length))) return true;
  }
  return false;
}
function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
const FORBIDDEN_KEY = /^(?:pan|number|card_?number|cardnumber|cvv|cvc|cvv2|cvc2|cid|csc|security_?code|track[12]?|magnetic_?stripe|pin|private_?key|secret_?key|seed|seed_?phrase|mnemonic)$/i;
/** Fail closed if any key names a raw card/wallet secret with a value, or any string value carries a card number. */
export function assertNoRawSecrets(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error('CREDENTIAL_INPUT_TOO_DEEP');
  if (typeof value === 'string') { if (containsCardNumber(value)) throw new Error('CREDENTIAL_RAW_CARD_DATA'); return; }
  if (typeof value === 'number') { if (containsCardNumber(String(value))) throw new Error('CREDENTIAL_RAW_CARD_DATA'); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) && entry !== null && entry !== undefined && entry !== '') throw new Error('CREDENTIAL_RAW_SECRET_FIELD');
    assertNoRawSecrets(entry, depth + 1);
  }
}

const exactKeys = (value: object, keys: readonly string[]) => {
  const own = Object.keys(value);
  return own.length === keys.length && own.every(key => keys.includes(key));
};
const WALLET_KEYS = ['id', 'ecosystem', 'address', 'providerKey', 'providerName', 'label', 'lastNetwork', 'addedAt'] as const;
const CARD_KEYS = ['id', 'provider', 'brand', 'last4', 'expMonth', 'expYear', 'label', 'addedAt'] as const;

export function readSavedWallet(value: unknown): SavedWallet | null {
  if (!value || typeof value !== 'object' || !exactKeys(value, WALLET_KEYS)) return null;
  const v = value as Record<string, unknown>;
  if ((v.ecosystem !== 'evm' && v.ecosystem !== 'solana') || typeof v.address !== 'string' || !validWalletAddress(v.ecosystem, v.address)) return null;
  if (typeof v.providerKey !== 'string' || !PROVIDER_KEY.test(v.providerKey) || credentialLabel(v.providerName) !== v.providerName
    || credentialLabel(v.label) !== v.label || (v.lastNetwork !== null && (typeof v.lastNetwork !== 'string' || !NETWORK.test(v.lastNetwork)))
    || typeof v.addedAt !== 'string' || !TIMESTAMP.test(v.addedAt) || v.id !== walletCredentialId(v.ecosystem, v.providerKey, v.address)) return null;
  return { id: v.id, ecosystem: v.ecosystem, address: v.address, providerKey: v.providerKey, providerName: v.providerName as string,
    label: v.label as string, lastNetwork: v.lastNetwork as string | null, addedAt: v.addedAt };
}
export function readSavedCard(value: unknown): SavedCard | null {
  if (!value || typeof value !== 'object' || !exactKeys(value, CARD_KEYS)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !TOKEN_ID.test(v.id) || containsCardNumber(v.id) || typeof v.provider !== 'string' || !PROVIDER_KEY.test(v.provider)
    || !CARD_BRANDS.includes(v.brand as CardBrand) || typeof v.last4 !== 'string' || !/^\d{4}$/.test(v.last4)
    || !Number.isInteger(v.expMonth) || (v.expMonth as number) < 1 || (v.expMonth as number) > 12
    || !Number.isInteger(v.expYear) || (v.expYear as number) < 2000 || (v.expYear as number) > 2100
    || credentialLabel(v.label) !== v.label || typeof v.addedAt !== 'string' || !TIMESTAMP.test(v.addedAt)) return null;
  return { id: v.id, provider: v.provider, brand: v.brand as CardBrand, last4: v.last4, expMonth: v.expMonth as number, expYear: v.expYear as number,
    label: v.label as string, addedAt: v.addedAt };
}
/** Reads stored credentials, keeping only valid entries (an invalid entry is dropped, never repaired). */
export function readCredentials(value: unknown): Credentials {
  if (!value || typeof value !== 'object') return EMPTY_CREDENTIALS;
  const v = value as { wallets?: unknown; cards?: unknown };
  const wallets = (Array.isArray(v.wallets) ? v.wallets : []).map(readSavedWallet).filter((entry): entry is SavedWallet => entry !== null);
  const cards = (Array.isArray(v.cards) ? v.cards : []).map(readSavedCard).filter((entry): entry is SavedCard => entry !== null);
  return { wallets: dedupe(wallets), cards: dedupe(cards) };
}
const dedupe = <T extends { readonly id: string }>(entries: T[]): T[] => entries.filter((entry, index) => entries.findIndex(other => other.id === entry.id) === index);

export type WalletReferenceInput = { readonly ecosystem: WalletEcosystem; readonly address: string; readonly providerKey: string;
  readonly providerName: string; readonly network: string | null };
/** Adds (or refreshes the network of) one public wallet reference. Saving authorizes nothing. */
export function addWalletReference(current: Credentials, input: WalletReferenceInput, now: Date): Credentials {
  const address = input.ecosystem === 'evm' ? input.address.toLowerCase() : input.address;
  const providerName = credentialLabel(input.providerName) ?? (input.ecosystem === 'evm' ? 'Ethereum wallet' : 'Solana wallet');
  const id = walletCredentialId(input.ecosystem, input.providerKey, address);
  const existing = current.wallets.find(wallet => wallet.id === id);
  const candidate = { id, ecosystem: input.ecosystem, address, providerKey: input.providerKey, providerName,
    label: existing?.label ?? providerName, lastNetwork: input.network && NETWORK.test(input.network) ? input.network : existing?.lastNetwork ?? null,
    addedAt: existing?.addedAt ?? now.toISOString() };
  const saved = readSavedWallet(candidate);
  if (!saved) throw new Error('WALLET_REFERENCE_INVALID');
  return { ...current, wallets: existing ? current.wallets.map(wallet => wallet.id === id ? saved : wallet) : [...current.wallets, saved] };
}
export function renameCredential(current: Credentials, id: string, label: unknown): Credentials {
  const next = credentialLabel(label);
  if (!next) throw new Error('CREDENTIAL_LABEL_INVALID');
  return { wallets: current.wallets.map(wallet => wallet.id === id ? { ...wallet, label: next } : wallet),
    cards: current.cards.map(card => card.id === id ? { ...card, label: next } : card) };
}
/** Removes FloFi's reference only. Nothing on-chain or at the card provider changes. */
export function removeCredential(current: Credentials, id: string): Credentials {
  return { wallets: current.wallets.filter(wallet => wallet.id !== id), cards: current.cards.filter(card => card.id !== id) };
}

/** Tokenized card metadata as a provider returns it after its hosted entry; raw card data anywhere fails closed. */
export type ProviderCardResult = { readonly provider: string; readonly paymentMethodId: string; readonly brand: string;
  readonly last4: string; readonly expMonth: number; readonly expYear: number };
export function addCardReference(current: Credentials, result: unknown, now: Date): Credentials {
  assertNoRawSecrets(result);
  const r = (result ?? {}) as Partial<Record<keyof ProviderCardResult, unknown>>;
  const brand = typeof r.brand === 'string' && CARD_BRANDS.includes(r.brand.toLowerCase() as CardBrand) ? r.brand.toLowerCase() as CardBrand : 'unknown';
  const label = `${brand === 'unknown' ? 'Card' : brandLabel(brand)} •••• ${typeof r.last4 === 'string' ? r.last4 : ''}`;
  const card = readSavedCard({ id: r.paymentMethodId, provider: r.provider, brand, last4: r.last4, expMonth: r.expMonth, expYear: r.expYear,
    label, addedAt: now.toISOString() });
  if (!card) throw new Error('CARD_METADATA_INVALID');
  return { ...current, cards: [...current.cards.filter(existing => existing.id !== card.id), card] };
}
export function brandLabel(brand: CardBrand): string {
  return ({ visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', elo: 'Elo', hipercard: 'Hipercard', discover: 'Discover',
    diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', unknown: 'Card' } as const)[brand];
}

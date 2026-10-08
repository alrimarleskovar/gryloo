// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addCardReference, addWalletReference, assertNoRawSecrets, containsCardNumber, credentialLabel, EMPTY_CREDENTIALS, readCredentials,
  removeCredential, renameCredential } from './credentials';
import { cardProviderStatus as configuredCardProvider } from '../server/card-provider';
import { cardProviderStatus } from '../app/card-action';

const NOW = new Date('2026-10-07T12:00:00.000Z');
const EVM = '0x12aB34cD56eF7890123456789012345678909aBc';
const SOLANA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA91';
const BINDING = `cb1.${'A'.repeat(40)}.${'B'.repeat(43)}`;
// A provider's saved-card id is numeric: this one is Luhn-valid by chance but is not shaped like the card's own number.
const card = { provider: 'mercado_pago', providerName: 'Mercado Pago', providerCustomerId: '470183340-cpunOI7UsIHlHr', providerCardId: '1562188766859',
  binding: BINDING, paymentMethodId: 'visa', brand: 'visa', last4: '4821', expMonth: 8, expYear: 2029 };
afterEach(() => { vi.unstubAllGlobals(); });

describe('wallet credential references', () => {
  it('keeps Phantom Solana, Phantom Ethereum, MetaMask and Rabby as distinct public references', () => {
    let value = EMPTY_CREDENTIALS;
    value = addWalletReference(value, { ecosystem: 'solana', address: SOLANA, providerKey: 'Phantom', providerName: 'Phantom', network: 'solana:devnet' }, NOW);
    value = addWalletReference(value, { ecosystem: 'evm', address: EVM, providerKey: 'app.phantom', providerName: 'Phantom', network: 'eip155:84532' }, NOW);
    value = addWalletReference(value, { ecosystem: 'evm', address: EVM, providerKey: 'io.metamask', providerName: 'MetaMask', network: 'eip155:84532' }, NOW);
    value = addWalletReference(value, { ecosystem: 'evm', address: EVM, providerKey: 'io.rabby', providerName: 'Rabby Wallet', network: null }, NOW);
    expect(value.wallets.map(wallet => wallet.id)).toEqual([`solana:Phantom:${SOLANA}`, `evm:app.phantom:${EVM.toLowerCase()}`,
      `evm:io.metamask:${EVM.toLowerCase()}`, `evm:io.rabby:${EVM.toLowerCase()}`]);
    expect(value.wallets[0]).toEqual({ id: `solana:Phantom:${SOLANA}`, ecosystem: 'solana', address: SOLANA, providerKey: 'Phantom', providerName: 'Phantom',
      label: 'Phantom', lastNetwork: 'solana:devnet', addedAt: NOW.toISOString() });
    // Re-adding refreshes the network but keeps the owner's name and the original date.
    const renamed = renameCredential(value, value.wallets[2]!.id, 'Trading');
    const again = addWalletReference(renamed, { ecosystem: 'evm', address: EVM, providerKey: 'io.metamask', providerName: 'MetaMask', network: 'eip155:8453' }, new Date('2027-01-01'));
    expect(again.wallets[2]).toMatchObject({ label: 'Trading', lastNetwork: 'eip155:8453', addedAt: NOW.toISOString() });
    expect(again.wallets).toHaveLength(4);
  });
  it('never mixes ecosystems: an EVM address is not a Solana reference and vice versa', () => {
    expect(() => addWalletReference(EMPTY_CREDENTIALS, { ecosystem: 'solana', address: EVM, providerKey: 'Phantom', providerName: 'Phantom', network: null }, NOW)).toThrow('WALLET_REFERENCE_INVALID');
    expect(() => addWalletReference(EMPTY_CREDENTIALS, { ecosystem: 'evm', address: SOLANA, providerKey: 'app.phantom', providerName: 'Phantom', network: null }, NOW)).toThrow('WALLET_REFERENCE_INVALID');
  });
  it('renames with bounded printable labels and removes only FloFi’s reference', () => {
    const value = addWalletReference(EMPTY_CREDENTIALS, { ecosystem: 'evm', address: EVM, providerKey: 'io.metamask', providerName: 'MetaMask', network: null }, NOW);
    const id = value.wallets[0]!.id;
    expect(renameCredential(value, id, '  Main\twallet ').wallets[0]!.label).toBe('Main wallet');
    for (const bad of ['', '   ', 'x'.repeat(41), '4111 1111 1111 1111']) expect(() => renameCredential(value, id, bad)).toThrow('CREDENTIAL_LABEL_INVALID');
    expect(removeCredential(value, id)).toEqual(EMPTY_CREDENTIALS);
  });
  it('drops stored entries carrying any key, seed phrase or unknown field instead of repairing them', () => {
    const wallet = addWalletReference(EMPTY_CREDENTIALS, { ecosystem: 'evm', address: EVM, providerKey: 'io.metamask', providerName: 'MetaMask', network: null }, NOW).wallets[0]!;
    expect(readCredentials({ wallets: [wallet, { ...wallet, privateKey: '0x' + '1'.repeat(64) }, { ...wallet, seedPhrase: 'abandon '.repeat(12) },
      { ...wallet, id: 'evm:io.metamask:0xdead' }], cards: [] }).wallets).toEqual([wallet]);
    expect(readCredentials('nonsense')).toEqual(EMPTY_CREDENTIALS);
  });
});

describe('card credentials hold provider references and safe metadata only', () => {
  it('saves the provider-safe saved-card metadata and nothing else', () => {
    const value = addCardReference(EMPTY_CREDENTIALS, card, NOW);
    expect(value.cards).toEqual([{ id: 'card:mercado_pago:1562188766859', ...card, label: 'Visa •••• 4821', addedAt: NOW.toISOString(), updatedAt: NOW.toISOString() }]);
    expect(Object.keys(value.cards[0]!).sort()).toEqual(['addedAt', 'binding', 'brand', 'expMonth', 'expYear', 'id', 'label', 'last4', 'paymentMethodId', 'provider',
      'providerCardId', 'providerCustomerId', 'providerName', 'updatedAt']);
    // Saving the same provider card again refreshes it, keeping the owner's name and the original date.
    const renamed = renameCredential(value, value.cards[0]!.id, 'Travel card');
    const again = addCardReference(renamed, { ...card, expYear: 2031 }, new Date('2027-01-01T00:00:00.000Z'));
    expect(again.cards).toHaveLength(1);
    expect(again.cards[0]).toMatchObject({ label: 'Travel card', expYear: 2031, addedAt: NOW.toISOString(), updatedAt: '2027-01-01T00:00:00.000Z' });
  });
  it.each([
    ['an extra provider field', { ...card, first_six_digits: '423564' }, 'CARD_METADATA_INVALID'],
    ['a provider card id shaped like this card number', { ...card, providerCardId: '4235647728025682', last4: '5682' }, 'CARD_METADATA_INVALID'],
    ['a malformed binding', { ...card, binding: 'not-a-binding' }, 'CARD_METADATA_INVALID'],
    ['full card number field', { ...card, number: '4111111111111111' }, 'CREDENTIAL_RAW_SECRET_FIELD'],
    ['security code field', { ...card, cvc: '123' }, 'CREDENTIAL_RAW_SECRET_FIELD'],
    ['CVV nested anywhere', { ...card, details: { cvv: '999' } }, 'CREDENTIAL_RAW_SECRET_FIELD'],
    ['PAN hidden in another field', { ...card, description: 'card 4111-1111-1111-1111' }, 'CREDENTIAL_RAW_CARD_DATA'],
    ['PAN as the token id', { ...card, paymentMethodId: '4111111111111111' }, 'CREDENTIAL_RAW_CARD_DATA'],
    ['malformed last four', { ...card, last4: '48211' }, 'CARD_METADATA_INVALID'],
  ])('refuses raw card data: %s', (_label, input, code) => {
    expect(() => addCardReference(EMPTY_CREDENTIALS, input, NOW)).toThrow(code);
  });
  it('detects formatted card numbers by Luhn and ignores ordinary digits', () => {
    expect(containsCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(containsCardNumber('5555-5555-5555-4444')).toBe(true);
    expect(containsCardNumber('order 2029 08 4821')).toBe(false);
    expect(credentialLabel('Visa 4821')).toBe('Visa 4821');
    expect(() => assertNoRawSecrets({ mnemonic: 'seed words' })).toThrow('CREDENTIAL_RAW_SECRET_FIELD');
    expect(() => assertNoRawSecrets({ cvv: null, number: '' })).not.toThrow();
  });
  it('reports the exact external prerequisite when no secure card provider is configured', async () => {
    const status = configuredCardProvider({});
    expect(status).toMatchObject({ available: false, code: 'CARD_TOKENIZATION_PROVIDER_REQUIRED' });
    expect(status.available || status.prerequisite).toMatch(/PCI-DSS compliant card provider[\s\S]*MERCADO_PAGO_ACCESS_TOKEN/);
    await expect(cardProviderStatus()).resolves.toEqual(configuredCardProvider());
  });
});

describe('browser credential store persists only safe shapes', () => {
  it('writes wallet and card references without PAN, CVV or keys and rejects unsafe card input without writing', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } },
      addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const credentials = await import('../state/credentials-store');
    credentials.saveWalletReference({ ecosystem: 'evm', address: EVM, providerKey: 'io.rabby', providerName: 'Rabby Wallet', network: 'eip155:84532' });
    credentials.saveCardReference(card);
    const before = store.get(credentials.CREDENTIALS_STORAGE_KEY);
    expect(() => credentials.saveCardReference({ ...card, providerCardId: '42', cvc: '123' })).toThrow('CREDENTIAL_RAW_SECRET_FIELD');
    expect(() => credentials.saveCardReference({ ...card, providerCardId: '43', number: '4111111111111111' })).toThrow('CREDENTIAL_RAW_SECRET_FIELD');
    expect(store.get(credentials.CREDENTIALS_STORAGE_KEY)).toBe(before);
    expect(before).not.toMatch(/4111|cvc|cvv|number|private|seed|mnemonic/i);
    expect(JSON.parse(before!)).toEqual(credentials.loadCredentials());
    expect(credentials.loadCredentials()).toMatchObject({ wallets: [{ providerName: 'Rabby Wallet', address: EVM.toLowerCase() }], cards: [{ last4: '4821' }] });
  });
});

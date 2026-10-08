// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecondaryProductWorkspace } from './secondary-product-workspace';
import type { SolanaSession } from '../wallet/solana-wallet';

const fixture = vi.hoisted(() => ({ account: null as string | null, chainId: null as string | null, provider: null as { key: string; name: string; icon: string | null } | null,
  busy: false, reset: () => undefined, session: null as SolanaSession | null, disconnect: async () => undefined, connectWith: async () => null,
  credentials: { wallets: [] as unknown[], cards: [] as unknown[] }, connect: vi.fn() }));
vi.mock('../state/build009-wallet-store', async importOriginal => {
  const actual = await importOriginal<typeof import('../state/build009-wallet-store')>();
  return { ...actual, useBuild009Wallet: () => fixture };
});
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => fixture }));
vi.mock('../state/wallet-connection', async importOriginal => ({ ...await importOriginal<typeof import('../state/wallet-connection')>(),
  useWalletConnection: () => ({ connect: fixture.connect, error: null, solanaChain: 'solana:devnet' }) }));
vi.mock('../state/credentials-store', () => ({ useCredentials: () => fixture.credentials, saveWalletReference: vi.fn(), renameSavedCredential: vi.fn(), removeSavedCredential: vi.fn() }));
vi.mock('../app/card-action', () => ({ cardProviderStatus: vi.fn() }));

const EVM = '0x1234567890123456789012345678901234567890', SOLANA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA91';
const saved = (ecosystem: 'evm' | 'solana', providerKey: string, providerName: string, address: string, label = providerName, lastNetwork: string | null = null) =>
  ({ id: `${ecosystem}:${providerKey}:${address}`, ecosystem, address, providerKey, providerName, label, lastNetwork, addedAt: '2026-10-07T12:00:00.000Z' });
beforeEach(() => { Object.assign(fixture, { account: null, chainId: null, provider: null, busy: false, session: null, credentials: { wallets: [], cards: [] } }); fixture.connect.mockClear(); });
const markup = (workspace: 'credentials' | 'agents' | 'passkeys') => renderToStaticMarkup(createElement(SecondaryProductWorkspace, { workspace }));
const wallets = (html: string) => html.match(/class="workspace-wallet-card"/g)?.length ?? 0;

describe('secondary product workspaces', () => {
  it('renders functional Add wallet and Add card with truthful empty states and no secret affordances', () => {
    const html = markup('credentials');
    expect(html).toContain('<h1>Credentials</h1>');
    expect(html).toContain('>Wallets</h2>');
    expect(html).toContain('>Cards</h2>');
    expect(html).toContain('>Payment connections</h2>');
    expect(html.match(/class="workspace-count">0<\/span>/g)).toHaveLength(3);
    for (const text of ['No wallets yet', 'No cards yet', 'No payment provider connected']) expect(html).toContain(text);
    for (const label of ['Add wallet', 'Add card']) expect(html).toMatch(new RegExp(`<button type="button" class="workspace-action">[\\s\\S]*?${label}</button>`));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Add secret<\/button>/);
    expect(html).not.toMatch(/Reveal|private key|seed phrase|balance|MPC|type="password"|cvv|cvc|PixBlock|Connected with|autocomplete="cc-/i);
    expect(html).not.toContain('<input');
    expect(fixture.connect).not.toHaveBeenCalled();
  });

  it('shows an active wallet that is not saved yet, with its provider, ecosystem and Save/Disconnect', () => {
    Object.assign(fixture, { account: EVM, chainId: '0x14a34', provider: { key: 'io.metamask', name: 'MetaMask', icon: null } });
    const html = markup('credentials');
    expect(wallets(html)).toBe(1);
    expect(html).toContain('<h3>MetaMask</h3><p>MetaMask · Ethereum</p>');
    expect(html).toContain('Connected · not saved');
    expect(html).toContain('Base Sepolia');
    expect(html).toContain(`<code title="${EVM}">0x1234…7890</code>`);
    for (const label of ['Copy MetaMask address', 'Save MetaMask', 'Disconnect MetaMask']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toMatch(/aria-label="(Rename|Remove) MetaMask"/);
  });

  it('keeps several saved wallets distinct and marks only the exact active identity as Active', () => {
    Object.assign(fixture, { account: EVM, chainId: '0x14a34', provider: { key: 'io.rabby', name: 'Rabby Wallet', icon: null },
      session: { wallet: { name: 'Phantom', chains: ['solana:devnet'], accounts: [], features: {} }, account: { address: SOLANA, chains: ['solana:devnet'], features: [] }, chain: 'solana:devnet' } });
    fixture.credentials = { cards: [], wallets: [saved('evm', 'io.metamask', 'MetaMask', EVM, 'Main', 'eip155:84532'), saved('evm', 'io.rabby', 'Rabby Wallet', EVM),
      saved('evm', 'app.phantom', 'Phantom', EVM, 'Phantom EVM'), saved('solana', 'Phantom', 'Phantom', SOLANA, 'Phantom Solana', 'solana:devnet')] };
    const html = markup('credentials');
    expect(wallets(html)).toBe(4);
    expect(html).toContain('class="workspace-count">4</span>');
    expect(html.match(/workspace-wallet-status-active">Active</g)).toHaveLength(2);
    expect(html).toContain('aria-label="Rabby Wallet, Ethereum" data-active="true"');
    expect(html).toContain('aria-label="Phantom Solana, Solana" data-active="true"');
    expect(html).toContain('aria-label="Main, Ethereum" data-active="false"');
    expect(html).toContain('aria-label="Phantom EVM, Ethereum" data-active="false"');
    for (const label of ['Connect Main', 'Rename Main', 'Remove Main', 'Disconnect Rabby Wallet', 'Disconnect Phantom Solana', 'Connect Phantom EVM']) expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('Solana Devnet');
    expect(html).not.toMatch(/Connected · not saved|Reveal|private key/i);
  });

  it('shows safe saved-card metadata only, never provider references', () => {
    fixture.credentials = { wallets: [], cards: [{ id: 'card:mercado_pago:1562188766859', provider: 'mercado_pago', providerName: 'Mercado Pago',
      providerCustomerId: '470183340-cpunOI7UsIHlHr', providerCardId: '1562188766859', binding: `cb1.${'A'.repeat(40)}.${'B'.repeat(43)}`, paymentMethodId: 'visa',
      brand: 'visa', last4: '4821', expMonth: 8, expYear: 2029, label: 'Visa •••• 4821', addedAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z' }] };
    const html = markup('credentials');
    expect(html).toContain('<h3>Visa •••• 4821</h3><p>Visa · Mercado Pago</p>');
    expect(html).not.toMatch(/cb1\.|470183340|mercado_pago/);
    expect(html).toContain('•••• 4821</span> · Expires 08/29');
    expect(html).toContain('aria-label="Remove Visa •••• 4821"');
    expect(html).not.toMatch(/\d{12,}|cvv|cvc/i);
  });

  it('offers only Claude and ChatGPT with decorative official assets and disabled connection affordances', () => {
    const html = markup('agents');
    for (const label of ['Connect with Claude', 'Connect with ChatGPT', '0 active', 'No agent clients yet.']) expect(html).toContain(label);
    expect(html).toContain('src="/brand/providers/claude-spark.svg"');
    expect(html).toContain('src="/brand/providers/openai-blossom-black.svg"');
    expect(html).toContain('src="/brand/providers/openai-blossom-white.svg"');
    expect(html.match(/class="workspace-provider-mark" aria-hidden="true"/g)).toHaveLength(2);
    expect(html.match(/width="28" height="28" alt=""/g)).toHaveLength(1);
    expect(html.match(/width="56" height="56" alt=""/g)).toHaveLength(2);
    expect(html.match(/Create client/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).not.toMatch(/>C<|>GPT<|>G<|Grok|<a\b|API key|OAuth|signing key|Connected with/i);
  });

  it('keeps the passkey switch off and disabled with a truthful empty state', () => {
    const html = markup('passkeys');
    expect(html).toContain('<h1>Passkeys</h1>');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]*disabled=""/);
    expect(html).toContain('Unlock with a passkey');
    expect(html).toContain('Turn on to add a passkey.');
    expect(html).toContain('No passkeys yet. Add one to get started.');
    expect(html).not.toMatch(/device name|registered|type="password"/i);
  });
});

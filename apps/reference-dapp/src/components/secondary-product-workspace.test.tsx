// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecondaryProductWorkspace } from './secondary-product-workspace';
import type { SolanaSession } from '../wallet/solana-wallet';

const fixture = vi.hoisted(() => ({ account: null as string | null, chainId: null as string | null, session: null as SolanaSession | null }));
vi.mock('../state/build009-wallet-store', async importOriginal => {
  const actual = await importOriginal<typeof import('../state/build009-wallet-store')>();
  return { ...actual, useBuild009Wallet: () => fixture };
});
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => fixture }));

beforeEach(() => { fixture.account = null; fixture.chainId = null; fixture.session = null; });
const markup = (workspace: 'credentials' | 'agents' | 'passkeys') => renderToStaticMarkup(createElement(SecondaryProductWorkspace, { workspace }));

describe('secondary product workspaces', () => {
  it('renders empty Credentials and disabled future affordances without invented wallet data', () => {
    const html = markup('credentials');
    expect(html).toContain('<h1>Credentials</h1>');
    expect(html).toContain('>Wallets</h2>');
    expect(html).toContain('class="workspace-count">0</span>');
    expect(html).toContain('No connected wallets');
    for (const label of ['Add wallet', 'Add card', 'Add secret']) expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>[\\s\\S]*?${label}</button>`));
    expect(html).not.toMatch(/0x[0-9a-f]|balance|private key|MPC|workspace-wallet-card|type="password"/i);
  });

  it('projects only the actual EVM public session with a technical address and inert card actions', () => {
    fixture.account = '0x1234567890123456789012345678901234567890'; fixture.chainId = '0x14a34';
    const html = markup('credentials');
    expect(html).toContain('Connected wallet');
    expect(html).toContain('EVM · External wallet');
    expect(html).toContain('Base Sepolia');
    expect(html).toContain('<code title="0x1234567890123456789012345678901234567890">0x1234…7890</code>');
    expect(html).toContain('aria-label="Copy Connected wallet address"');
    for (const label of ['Add funds', 'Reveal key', 'Delete']) expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    expect(html).not.toMatch(/0x[0-9a-f]{64}|balance|MPC|type="password"/i);
  });

  it('shows both real ecosystems when both public sessions exist, using the Solana wallet name and cluster', () => {
    fixture.account = '0x1234567890123456789012345678901234567890'; fixture.chainId = '0x2105';
    fixture.session = { wallet: { name: 'Owner wallet', chains: ['solana:devnet'], accounts: [], features: {} }, account: { address: 'PublicSolanaAddressFromTheSession', chains: ['solana:devnet'], features: [] }, chain: 'solana:devnet' };
    const html = markup('credentials');
    expect(html.match(/class="workspace-wallet-card"/g)).toHaveLength(2);
    expect(html).toContain('class="workspace-count">2</span>');
    expect(html).toContain('Owner wallet');
    expect(html).toContain('Solana Devnet');
    expect(html).toContain('title="PublicSolanaAddressFromTheSession"');
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

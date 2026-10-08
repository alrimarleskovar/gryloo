// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseEvmWallet, chosenEvmProvider, clearChosenEvmWallet, evmWalletEntries, evmWalletIdentity, incompatibleWalletMessage, injected } from './evm-discovery';
import { orderWalletChoices, safeWalletIcon, undetectedWallets, updateWalletPreference, walletPreference, type WalletChoice } from './wallet-registry';

const ICON = 'data:image/svg+xml;base64,PHN2Zy8+';
const provider = (flags: Record<string, boolean> = {}) => ({ ...flags, request: vi.fn(async () => []) });
function browser(ethereum?: unknown) {
  const store = new Map<string, string>();
  const target = Object.assign(new EventTarget(), { ethereum, localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } } });
  vi.stubGlobal('window', target);
  return target;
}
function announce(target: EventTarget, wallet: unknown, info: { rdns: string; uuid: string; name: string; icon?: string }) {
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: wallet, info: { icon: ICON, ...info } } }));
}
const metaMask = provider(), rabby = provider({ isRabby: true }), phantomEvm = provider({ isPhantom: true }), brave = provider({ isBraveWallet: true });
beforeEach(() => { for (const wallet of [metaMask, rabby, phantomEvm, brave]) wallet.request.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });
function multiWallet() {
  const target = browser({ ...rabby, isMetaMask: true });
  target.addEventListener('eip6963:requestProvider', () => {
    announce(target, metaMask, { rdns: 'io.metamask', uuid: 'a', name: 'MetaMask' });
    announce(target, rabby, { rdns: 'io.rabby', uuid: 'b', name: 'Rabby Wallet' });
    announce(target, phantomEvm, { rdns: 'app.phantom', uuid: 'c', name: 'Phantom' });
    announce(target, brave, { rdns: 'com.brave.wallet', uuid: 'd', name: 'Brave Wallet' });
  });
  return target;
}

describe('canonical EVM discovery', () => {
  it('lists every announced wallet with its own metadata, never overwriting one with another and never calling a wallet', () => {
    multiWallet();
    expect(evmWalletEntries().map(entry => entry.choice)).toEqual([
      { id: 'evm:a', ecosystem: 'evm', key: 'io.metamask', name: 'MetaMask', icon: ICON },
      { id: 'evm:b', ecosystem: 'evm', key: 'io.rabby', name: 'Rabby Wallet', icon: ICON },
      { id: 'evm:c', ecosystem: 'evm', key: 'app.phantom', name: 'Phantom', icon: ICON },
    ]);
    for (const wallet of [metaMask, rabby, phantomEvm, brave]) expect(wallet.request).not.toHaveBeenCalled();
  });
  it('uses only the explicit choice for the shared provider; a passive default is never a selection', () => {
    multiWallet();
    expect(injected()).toBe(metaMask);
    expect(chosenEvmProvider()).toBeNull();
    expect(chooseEvmWallet('evm:b')).toBe(rabby);
    expect(injected()).toBe(rabby); expect(chosenEvmProvider()).toBe(rabby);
    expect(evmWalletIdentity(injected())).toMatchObject({ key: 'io.rabby', name: 'Rabby Wallet' });
    expect(walletPreference()).toEqual({ evm: 'io.rabby', solana: null, evmDisconnected: false });
    clearChosenEvmWallet();
    // The remembered wallet now drives the passive (silent-read) provider, still without any wallet request.
    expect(injected()).toBe(rabby); expect(chosenEvmProvider()).toBeNull();
    expect(chooseEvmWallet('evm:unknown')).toBeNull();
    for (const wallet of [metaMask, rabby, phantomEvm, brave]) expect(wallet.request).not.toHaveBeenCalled();
  });
  it('offers a legacy window.ethereum as a generic browser wallet only when nothing announces, never as MetaMask', () => {
    browser(provider({ isMetaMask: true }));
    expect(evmWalletEntries().map(entry => entry.choice)).toEqual([{ id: 'evm:injected#0', ecosystem: 'evm', key: 'injected', name: 'Browser wallet', icon: null }]);
  });
  it('excludes Brave Wallet and explains the incompatibility only when nothing else is selectable', () => {
    browser(brave);
    expect(evmWalletEntries()).toEqual([]);
    expect(incompatibleWalletMessage()).toMatch(/Brave Wallet cannot be used/);
    multiWallet();
    expect(incompatibleWalletMessage()).toBeNull();
  });
});

describe('wallet identity model', () => {
  const choice = (id: string, ecosystem: 'evm' | 'solana', key: string, name: string): WalletChoice => ({ id, ecosystem, key, name, icon: null });
  it('orders detected wallets with the remembered one first and keeps Phantom Solana and Phantom Ethereum distinct', () => {
    const choices = [choice('evm:a', 'evm', 'io.metamask', 'MetaMask'), choice('solana:Phantom', 'solana', 'Phantom', 'Phantom'),
      choice('evm:c', 'evm', 'app.phantom', 'Phantom'), choice('evm:b', 'evm', 'io.rabby', 'Rabby Wallet')];
    expect(orderWalletChoices(choices, { evm: null, solana: null, evmDisconnected: false }).map(entry => entry.id)).toEqual(['evm:a', 'evm:c', 'solana:Phantom', 'evm:b']);
    expect(orderWalletChoices(choices, { evm: 'io.rabby', solana: null, evmDisconnected: false })[0]!.id).toBe('evm:b');
    expect(undetectedWallets(choices, ['evm', 'solana']).map(known => `${known.ecosystem}:${known.name}`)).toEqual(['evm:Coinbase Wallet', 'solana:Backpack', 'solana:Solflare']);
    expect(undetectedWallets([], ['solana']).map(known => known.name)).toEqual(['Phantom', 'Backpack', 'Solflare']);
  });
  it('accepts only bounded image data URIs as provider icons', () => {
    expect(safeWalletIcon(ICON)).toBe(ICON);
    for (const bad of ['javascript:alert(1)', 'https://example.com/logo.svg', 'data:text/html,<script>', 'data:image/png;base64,' + 'A'.repeat(200_001), 42])
      expect(safeWalletIcon(bad)).toBeNull();
  });
  it('stores only provider keys and a disconnect flag, never an address', () => {
    browser();
    updateWalletPreference({ evm: 'io.metamask', solana: 'Phantom' });
    updateWalletPreference({ evmDisconnected: true });
    expect(walletPreference()).toEqual({ evm: 'io.metamask', solana: 'Phantom', evmDisconnected: true });
    (window as unknown as { localStorage: Storage }).localStorage.setItem('flofi.wallet.preference.v1', JSON.stringify({ evm: '0x' + '1'.repeat(40) + '\n', solana: 7 }));
    expect(walletPreference()).toEqual({ evm: null, solana: null, evmDisconnected: false });
  });
});

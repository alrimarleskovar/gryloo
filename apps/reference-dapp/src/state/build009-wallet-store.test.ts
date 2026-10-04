// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injected } from './build009-wallet-store';

const provider = (flags: { isMetaMask?: boolean; isBraveWallet?: boolean } = {}) => ({
  ...flags, request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x14a34' : []),
});
function browser(ethereum?: unknown) {
  const target = Object.assign(new EventTarget(), { ethereum });
  vi.stubGlobal('window', target);
  return target;
}
function announce(target: EventTarget, wallet: unknown, rdns: string) {
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: wallet, info: { rdns } } }));
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('shared injected EVM provider selection', () => {
  it('preserves a single usable injected wallet without making wallet requests', () => {
    const wallet = provider(); browser(wallet);
    expect(injected()).toBe(wallet); expect(injected()).toBe(wallet);
    expect(wallet.request).not.toHaveBeenCalled();
  });
  it.each([false, true])('selects real MetaMask regardless of provider-array order (reverse=%s)', reverse => {
    const brave = provider({ isMetaMask: true, isBraveWallet: true }), metaMask = provider({ isMetaMask: true });
    browser({ ...brave, providers: reverse ? [metaMask, brave] : [brave, metaMask] });
    expect(injected()).toBe(metaMask); expect(brave.request).not.toHaveBeenCalled();
  });
  it('prefers EIP-6963 io.metamask over the legacy MetaMask flag and aggregate Brave wallet', async () => {
    const brave = provider({ isMetaMask: true, isBraveWallet: true }), legacy = provider({ isMetaMask: true }), metaMask = provider();
    const target = browser({ ...brave, providers: [brave, legacy] });
    target.addEventListener('eip6963:requestProvider', () => { announce(target, brave, 'com.brave.wallet'); announce(target, metaMask, 'io.metamask'); });
    expect(injected()).toBe(metaMask);
    await expect(injected()!.request({ method: 'eth_chainId' })).resolves.toBe('0x14a34');
    expect(legacy.request).not.toHaveBeenCalled(); expect(brave.request).not.toHaveBeenCalled();
  });
  it('keeps discovery active for late MetaMask announcements and deduplicates reannouncements', () => {
    const brave = provider({ isBraveWallet: true }), metaMask = provider(), target = browser(brave);
    expect(injected()).toBeNull(); expect(brave.request).not.toHaveBeenCalled();
    announce(target, metaMask, 'io.metamask'); announce(target, metaMask, 'io.metamask');
    expect(injected()).toBe(metaMask); expect(injected()).toBe(metaMask);
  });
  it('supports a single announced wallet without window.ethereum', () => {
    const wallet = provider(), target = browser();
    target.addEventListener('eip6963:requestProvider', () => announce(target, wallet, 'com.example.wallet'));
    expect(injected()).toBe(wallet);
  });
  it('fails closed for multiple non-MetaMask providers instead of choosing the aggregate', () => {
    const brave = provider({ isMetaMask: true, isBraveWallet: true }), other = provider();
    browser({ ...brave, providers: [brave, other] });
    expect(injected()).toBeNull(); expect(brave.request).not.toHaveBeenCalled();
  });
  it.each([false, true])('rejects a sole Brave provider even when it claims isMetaMask (claim=%s)', isMetaMask => {
    const brave = provider({ isMetaMask, isBraveWallet: true }); browser(brave);
    expect(injected()).toBeNull(); expect(brave.request).not.toHaveBeenCalled();
  });
  it('rejects the sole EIP-6963 Brave provider without making any wallet requests', () => {
    const brave = provider({ isBraveWallet: true }), target = browser();
    target.addEventListener('eip6963:requestProvider', () => announce(target, brave, 'com.brave.wallet'));
    expect(injected()).toBeNull(); expect(brave.request).not.toHaveBeenCalled();
  });
  it('fails closed for two distinct MetaMask providers', () => {
    browser({ providers: [provider({ isMetaMask: true }), provider({ isMetaMask: true })] });
    expect(injected()).toBeNull();
  });
  it('does not accept a Brave announcement that claims the MetaMask rdns', () => {
    const brave = provider({ isBraveWallet: true }), other = provider(), target = browser({ providers: [brave, other] });
    target.addEventListener('eip6963:requestProvider', () => announce(target, brave, 'io.metamask'));
    expect(injected()).toBeNull();
  });
  it('preserves no-wallet behavior for absent or unusable injected providers', () => {
    browser(); expect(injected()).toBeNull();
    browser({ request: 'invalid' }); expect(injected()).toBeNull();
    browser({ providers: [null, {}] }); expect(injected()).toBeNull();
    vi.unstubAllGlobals(); expect(injected()).toBeNull();
  });
  // Real Rabby: announces io.rabby with its provider object and also injects a different window.ethereum proxy that may
  // claim isMetaMask for compatibility. The announced provider must be selected; the proxy must never be used.
  const rabby = () => ({ announced: { ...provider(), isRabby: true }, proxy: { ...provider({ isMetaMask: true }), isRabby: true } });
  it('selects the announced io.rabby provider, not its separate window.ethereum proxy', () => {
    const { announced, proxy } = rabby(), target = browser(proxy);
    target.addEventListener('eip6963:requestProvider', () => announce(target, announced, 'io.rabby'));
    expect(injected()).toBe(announced); expect(proxy.request).not.toHaveBeenCalled();
  });
  it('rebinds from the legacy proxy to a late io.rabby announcement and deduplicates reannouncements', () => {
    const { announced, proxy } = rabby(), target = browser(proxy);
    expect(injected()).toBe(proxy);
    announce(target, announced, 'io.rabby'); announce(target, announced, 'io.rabby');
    expect(injected()).toBe(announced); expect(proxy.request).not.toHaveBeenCalled();
  });
  it('keeps preferring an announced MetaMask when Rabby is also installed', () => {
    const { announced, proxy } = rabby(), metaMask = provider(), target = browser(proxy);
    target.addEventListener('eip6963:requestProvider', () => { announce(target, announced, 'io.rabby'); announce(target, metaMask, 'io.metamask'); });
    expect(injected()).toBe(metaMask);
  });
  it('fails closed when Rabby and another non-MetaMask wallet both announce', () => {
    const { announced, proxy } = rabby(), other = provider(), target = browser(proxy);
    target.addEventListener('eip6963:requestProvider', () => { announce(target, announced, 'io.rabby'); announce(target, other, 'com.example.wallet'); });
    expect(injected()).toBeNull(); expect(proxy.request).not.toHaveBeenCalled();
  });
  it('selects Rabby over an announced Brave wallet without ever using Brave', () => {
    const { announced, proxy } = rabby(), brave = provider({ isBraveWallet: true }), target = browser(proxy);
    target.addEventListener('eip6963:requestProvider', () => { announce(target, brave, 'com.brave.wallet'); announce(target, announced, 'io.rabby'); });
    expect(injected()).toBe(announced); expect(brave.request).not.toHaveBeenCalled();
  });
  it('ignores unusable announcements without losing the single usable provider', () => {
    const wallet = provider(), target = browser(wallet);
    target.addEventListener('eip6963:requestProvider', () => announce(target, { request: null }, 'io.metamask'));
    expect(injected()).toBe(wallet);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Build009WalletProvider, useBuild009Wallet } from './build009-wallet-store';
import { deferred, HookHarness } from '../test-utils/hook-harness';
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
// Connect goes through the canonical selector (HOTFIX-WALLET-SELECTOR); the owner picks the wallet this browser exposes.
vi.mock('../components/wallet-selector', async () => {
  const { evmWalletEntries } = await import('../wallet/evm-discovery');
  return { useWalletSelector: () => ({ open: false, choose: async () => evmWalletEntries()[0]?.choice ?? null }) };
});
const first = '0x' + 'a'.repeat(40), second = '0x' + 'b'.repeat(40);
function provider() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const state = { account: first as string | null, chain: '0x14a34' };
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? state.chain : state.account ? [state.account] : []);
  return { state, request, on(event: string, callback: (...args: unknown[]) => void) { const set = listeners.get(event) ?? new Set(); set.add(callback); listeners.set(event, set); },
    removeListener(event: string, callback: (...args: unknown[]) => void) { listeners.get(event)?.delete(callback); },
    emit(event: string, ...args: unknown[]) { for (const callback of listeners.get(event) ?? []) callback(...args); },
    count(event: string) { return listeners.get(event)?.size ?? 0; } };
}
let host: HookHarness, wallet: ReturnType<typeof useBuild009Wallet>, source: ReturnType<typeof provider>, target: EventTarget;
function Probe() { wallet = useBuild009Wallet(); return null; }
const read = () => host.render(() => renderToStaticMarkup(<Build009WalletProvider><Probe/></Build009WalletProvider>));
async function settle() { await Promise.resolve(); await Promise.resolve(); read(); }
/** Connect first resolves the owner's selector choice; races are meaningful once the account request is in flight. */
const requested = () => vi.waitFor(() => expect(source.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' }));
beforeEach(() => { host = new HookHarness(); source = provider(); target = Object.assign(new EventTarget(), { ethereum: source, setTimeout, clearTimeout }); vi.stubGlobal('window', target); });
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });
describe('shared wallet synchronization lifecycle', () => {
  it('passively reads account/chain without a wallet prompt', async () => {
    read(); await settle(); expect(wallet).toMatchObject({ account: first, chainId: '0x14a34' });
    expect(source.request.mock.calls.map(([request]) => request.method)).toEqual(['eth_accounts', 'eth_chainId']);
  });
  it('tracks account changes and increments the Review invalidation revision', async () => {
    read(); await settle(); const revision = wallet.revision;
    source.state.account = second; source.emit('accountsChanged', [second.toUpperCase().replace('0X', '0x')]); await settle();
    expect(wallet).toMatchObject({ account: second, chainId: '0x14a34' }); expect(wallet.revision).toBeGreaterThan(revision);
  });
  it('tracks chain changes and rejects unsupported/invalid chain identities', async () => {
    read(); await settle(); const revision = wallet.revision;
    source.state.chain = '0x2105'; source.emit('chainChanged', '0x2105'); read();
    expect(wallet.chainId).toBe('0x2105'); expect(wallet.revision).toBeGreaterThan(revision);
    source.emit('chainChanged', 'invalid'); read(); expect(wallet.chainId).toBeNull();
  });
  it('clears on disconnect and passively synchronizes reconnect', async () => {
    read(); await settle(); source.emit('disconnect'); read(); expect(wallet).toMatchObject({ account: null, chainId: null });
    source.state.account = second; source.state.chain = '0xaa36a7'; source.emit('connect'); await settle();
    expect(wallet).toMatchObject({ account: second, chainId: '0xaa36a7' });
  });
  it('does not let the initial passive read overwrite a later account event', async () => {
    const oldAccounts = deferred<unknown>(), oldChain = deferred<unknown>();
    source.request.mockImplementationOnce(() => oldAccounts.promise as Promise<string[]>).mockImplementationOnce(() => oldChain.promise as Promise<string>);
    read(); source.state.account = second; source.emit('accountsChanged', [second]); await settle();
    oldAccounts.resolve([first]); oldChain.resolve('0x2105'); await settle();
    expect(wallet).toMatchObject({ account: second, chainId: '0x14a34' });
  });
  it('resynchronizes after an account event races with a chain event', async () => {
    read(); await settle(); const pending = deferred<unknown>();
    source.state.account = second; source.request.mockImplementationOnce(() => pending.promise as Promise<string[]>);
    source.emit('accountsChanged', [second]); source.state.chain = '0x2105'; source.emit('chainChanged', '0x2105');
    pending.resolve([second]); await settle(); expect(wallet).toMatchObject({ account: second, chainId: '0x2105' });
  });
  it('rebinds to an announced provider and ignores the old provider pending read and events', async () => {
    const old = deferred<unknown>(); source.request.mockImplementationOnce(() => old.promise as Promise<string[]>); read();
    const replacement = provider(); replacement.state.account = second;
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: replacement, info: { rdns: 'io.metamask' } } })); await settle();
    old.resolve([first]); source.emit('accountsChanged', [first]); await settle();
    expect(wallet.account).toBe(second); expect(source.count('accountsChanged')).toBe(0); expect(replacement.count('accountsChanged')).toBe(1);
  });
  it('keeps explicit reset disconnected despite passive events until Connect', async () => {
    read(); await settle(); wallet.reset(); read(); source.emit('accountsChanged', [first]); source.emit('connect'); await settle();
    expect(wallet).toMatchObject({ account: null, chainId: null });
    await wallet.connect(); read(); expect(wallet.account).toBe(first);
  });
  it('detaches all listeners on unmount', async () => {
    read(); await settle(); host.unmount();
    for (const event of ['connect', 'accountsChanged', 'chainChanged', 'disconnect']) expect(source.count(event)).toBe(0);
  });
  it('does not let an old Connect response overwrite a newer provider account event', async () => {
    read(); await settle(); const pending = deferred<string[]>(); source.request.mockImplementationOnce(() => pending.promise);
    const connecting = wallet.connect(); await requested(); source.state.account = second; source.emit('accountsChanged', [second]); await settle();
    pending.resolve([first]); expect(await connecting).toBeNull(); read(); expect(wallet.account).toBe(second);
  });
  it.each([['0x2105', '0x1'], ['0x14a34', '0xaa36a7'], ['0x2105', '0xa4b1']])('reflects external network changes %s → %s immediately', async (from, to) => {
    source.state.chain = from; read(); await settle(); const revision = wallet.revision;
    source.state.chain = to; source.emit('chainChanged', to); read();
    expect(wallet.chainId).toBe(to); expect(wallet.revision).toBeGreaterThan(revision);
  });
  it.each(['0x1', '0xaa36a7', '0xdeadbeef'])('reloads the actual provider chain %s without inferring a product environment', async chain => {
    source.state.chain = chain; read(); await settle(); expect(wallet.chainId).toBe(chain);
    expect(source.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_switchEthereumChain' }));
  });
  it.each(['chainChanged', 'disconnect', 'providerSelection'])('discards stale Connect after %s', async event => {
    read(); await settle(); const pending = deferred<string[]>(); source.request.mockImplementationOnce(() => pending.promise);
    const connecting = wallet.connect(); await requested();
    if (event === 'chainChanged') { source.state.chain = '0x1'; source.emit(event, '0x1'); }
    else if (event === 'disconnect') source.emit(event);
    else {
      // An explicit choice pins its provider; the owner picking another wallet mid-Connect is the provider-selection race.
      const replacement = provider(); replacement.state.account = second; replacement.state.chain = '0xa4b1';
      target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: replacement, info: { rdns: 'io.metamask' } } }));
      const { evmWalletEntries } = await import('../wallet/evm-discovery');
      await wallet.connectWith(evmWalletEntries().find(entry => entry.provider === replacement)!.choice.id);
    }
    await settle(); pending.resolve([first]); expect(await connecting).toBeNull(); read();
    expect(wallet).toMatchObject(event === 'chainChanged' ? { account: first, chainId: '0x1' } : event === 'disconnect' ? { account: null, chainId: null } : { account: second, chainId: '0xa4b1' });
    expect(wallet.busy).toBe(false);
  });
  it('keeps the provider chain after a rejected switch', async () => {
    read(); await settle(); source.request.mockImplementationOnce(async () => { throw Error('user rejected'); });
    await wallet.switchTo('0x2105'); read(); expect(wallet.chainId).toBe('0x14a34'); expect(wallet.error).toContain('Could not switch');
  });
  it('uses the actual provider chain after switch completion and protects a later chain event', async () => {
    read(); await settle(); const switched = deferred<unknown>();
    source.request.mockImplementationOnce(() => switched.promise as Promise<string>);
    const switching = wallet.switchTo('0x2105'); source.state.chain = '0x1'; source.emit('chainChanged', '0x1');
    switched.resolve(null); await switching; read(); expect(wallet.chainId).toBe('0x1');
    const reading = deferred<unknown>();
    source.request.mockResolvedValueOnce('0x2105').mockImplementationOnce(() => reading.promise as Promise<string>);
    const again = wallet.switchTo('0x2105'); await Promise.resolve();
    source.state.chain = '0xa4b1'; source.emit('chainChanged', '0xa4b1'); reading.resolve('0x2105');
    await again; read(); expect(wallet.chainId).toBe('0xa4b1');
  });

});

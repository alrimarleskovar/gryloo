// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-AUTOMATION-002 × PR #76: delegated browser requests reuse the shared wallet's semantic authority epoch (real shared EVM store).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Build009WalletProvider, useBuild009Wallet } from '../state/build009-wallet-store';
import { HookHarness } from '../test-utils/hook-harness';
import { useWalletAuthorityEpoch } from './wallet-authority-epoch';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const f = vi.hoisted(() => ({ session: null as null | { wallet: { name: string }; account: { address: string }; chain: string } }));
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => ({ session: f.session }) }));
vi.mock('./wallet-selector', async () => {
  const { evmWalletEntries } = await import('../wallet/evm-discovery');
  return { useWalletSelector: () => ({ choose: async () => evmWalletEntries()[0]?.choice ?? null }) };
});
const OWNER = '0x' + '1'.repeat(40), OTHER = '0x' + '2'.repeat(40);
const SOL_A = 'So1aAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', SOL_B = 'So1bBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
function provider() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const state = { account: OWNER, chain: '0x14a34' };
  return { state, request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? state.chain : [state.account]),
    on(event: string, listener: (...args: unknown[]) => void) { const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); },
    removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    emit(event: string, ...args: unknown[]) { for (const listener of listeners.get(event) ?? []) listener(...args); } };
}
let host: HookHarness, source: ReturnType<typeof provider>;
let wallet: ReturnType<typeof useBuild009Wallet>, authority: ReturnType<typeof useWalletAuthorityEpoch>;
function Probe() { wallet = useBuild009Wallet(); authority = useWalletAuthorityEpoch(); return null; }
const read = () => host.render(() => renderToStaticMarkup(<Build009WalletProvider><Probe/></Build009WalletProvider>));
async function settle() { await Promise.resolve(); await Promise.resolve(); read(); }
const solana = (name: string, address: string) => ({ wallet: { name }, account: { address }, chain: 'solana:devnet' });

beforeEach(async () => {
  f.session = null; host = new HookHarness(); source = provider();
  vi.stubGlobal('window', Object.assign(new EventTarget(), { ethereum: source, setTimeout, clearTimeout }));
  read(); await settle();
  expect(wallet.account).toBe(OWNER);
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });

describe('delegated browser requests bind to the shared wallet authority epoch', () => {
  it('keeps the epoch across passive rereads, duplicate events and an equivalent Solana session object', async () => {
    const started = authority.read();
    expect(started).toBe(authority.epoch);
    f.session = solana('Phantom', SOL_A); read(); const withSolana = authority.read();
    expect(withSolana).not.toBe(started);
    for (let i = 0; i < 3; i++) {
      await wallet.session(); read();
      source.emit('connect'); await settle();
      source.emit('accountsChanged', [OWNER]); read();
      source.emit('chainChanged', '0x14a34'); await settle();
      f.session = solana('Phantom', SOL_A); read(); // a new session object for the same wallet and account is not a transition
    }
    expect(authority.read()).toBe(withSolana);
  });
  it.each(['account', 'chain', 'disconnect'] as const)('retires the epoch on an EVM %s transition, even when the round trip is batched', async change => {
    const started = authority.read();
    if (change === 'account') { source.emit('accountsChanged', [OTHER]); source.emit('accountsChanged', [OWNER]); }
    if (change === 'chain') { source.emit('chainChanged', '0x1'); source.emit('chainChanged', '0x14a34'); }
    if (change === 'disconnect') { source.emit('disconnect'); source.emit('connect'); }
    await settle();
    expect(wallet.account).toBe(OWNER);
    expect(authority.read()).not.toBe(started);
    await wallet.session(); await settle();
    expect(authority.read()).not.toBe(started);
  });
  it('retires the epoch when the Solana session changes, and changing back never revives it', () => {
    f.session = solana('Phantom', SOL_A); read(); const started = authority.read();
    f.session = solana('Phantom', SOL_B); read(); const changed = authority.read();
    expect(changed).not.toBe(started);
    f.session = solana('Phantom', SOL_A); read();
    expect(authority.read()).not.toBe(started);
    expect(authority.read()).not.toBe(changed);
    f.session = solana('Backpack', SOL_A); read();
    expect(authority.read()).not.toBe(started);
  });
});

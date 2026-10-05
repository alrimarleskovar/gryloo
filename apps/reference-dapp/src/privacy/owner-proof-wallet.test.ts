// SPDX-License-Identifier: AGPL-3.0-only
/** Wallet Standard test provider; never the installed Phantom extension. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOAK_RUNTIME } from './cloak-adapter';
const owner = '6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy';
const rpc = vi.hoisted(() => ({ genesis: vi.fn() }));
vi.mock('./owner-proof-rpc', () => ({ ownerDepositReadRpc: () => ({ getGenesisHash: () => ({ send: rpc.genesis }) }) }));
async function provider() {
  vi.resetModules(); rpc.genesis.mockReset().mockResolvedValue(CLOAK_RUNTIME.genesisHash);
  const target = Object.assign(new EventTarget(), { phantom: { solana: { isPhantom: true } } }); vi.stubGlobal('window', target);
  const account = { address: owner, chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
  const callbacks = new Set<(e: object) => void>(), sign = vi.fn(), message = vi.fn();
  const wallet = { name: 'Phantom', chains: ['solana:mainnet', 'solana:devnet'], accounts: [account], features: {
    'standard:connect': { connect: vi.fn(async () => ({ accounts: wallet.accounts })) },
    'solana:signTransaction': { signTransaction: sign }, 'solana:signMessage': { signMessage: message },
    'standard:events': { on: (_event: string, cb: (e: object) => void) => { callbacks.add(cb); return () => callbacks.delete(cb); } },
  } };
  target.addEventListener('wallet-standard:app-ready', e => (e as CustomEvent<{ register(w: unknown): void }>).detail.register(wallet));
  const api = await import('./owner-proof-wallet');
  return { ...api, target, account, wallet, sign, message, callbacks, emit: (e: object) => [...callbacks].forEach(cb => cb(e)) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('connection-only owner Phantom/mainnet check', () => {
  it('detects injected/Wallet Standard Phantom and connects the exact owner without requesting any signature', async () => {
    const p = await provider(); expect(p.detectProofPhantom()).toEqual({ walletStandard: 1, injected: true });
    const check = await p.connectProofPhantom(owner, vi.fn()); check.assertCurrent();
    expect(check).toMatchObject({ owner, network: 'solana:mainnet', genesisHash: CLOAK_RUNTIME.genesisHash });
    expect(p.wallet.features['standard:connect'].connect).toHaveBeenCalledTimes(1);
    expect(p.sign).not.toHaveBeenCalled(); expect(p.message).not.toHaveBeenCalled(); check.close(); expect(p.callbacks.size).toBe(0);
  });
  it('refuses a different public owner before any RPC or signing', async () => {
    const p = await provider(); p.account.address = CLOAK_RUNTIME.nativeMint;
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toThrow('CLOAK_DEPOSIT_OWNER_CHANGED');
    expect(rpc.genesis).not.toHaveBeenCalled(); expect(p.sign).not.toHaveBeenCalled();
  });
  it('cannot connect a devnet-only Phantom account or use a different genesis', async () => {
    const p = await provider(); p.account.chains = ['solana:devnet'];
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toThrow('CLOAK_OWNER_WALLET_UNSUPPORTED');
    p.account.chains = ['solana:mainnet']; rpc.genesis.mockResolvedValue('devnet');
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toThrow('CLOAK_RPC_GENESIS_CHANGED'); expect(p.callbacks.size).toBe(0);
    expect(p.sign).not.toHaveBeenCalled();
  });
  it('handles connect rejection without retry or signing', async () => {
    const p = await provider(); p.wallet.features['standard:connect'].connect.mockRejectedValue({ code: 4001 });
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toMatchObject({ code: 4001 });
    expect(p.wallet.features['standard:connect'].connect).toHaveBeenCalledTimes(1); expect(p.sign).not.toHaveBeenCalled();
  });
  it.each(['account', 'disconnect', 'chain', 'features'])('invalidates the session on %s changes, including an owner changing back', async kind => {
    const p = await provider(), invalidate = vi.fn(), check = await p.connectProofPhantom(owner, invalidate);
    if (kind === 'account') { p.emit({ accounts: [{ address: CLOAK_RUNTIME.nativeMint }] }); p.emit({ accounts: [p.account] }); }
    if (kind === 'disconnect') { p.wallet.accounts = []; p.emit({ accounts: [] }); }
    if (kind === 'chain') p.emit({ chains: ['solana:devnet'] });
    if (kind === 'features') p.emit({ features: {} });
    expect(invalidate).toHaveBeenCalled(); expect(() => check.assertCurrent()).toThrow('CLOAK_OWNER_CHANGED'); expect(p.sign).not.toHaveBeenCalled(); check.close();
  });
  it('reconnection cannot carry the old session or silently accept a changed owner', async () => {
    const p = await provider(), check = await p.connectProofPhantom(owner, vi.fn()); check.close();
    p.account.address = CLOAK_RUNTIME.nativeMint;
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toThrow('CLOAK_DEPOSIT_OWNER_CHANGED');
    expect(() => check.assertCurrent()).toThrow('CLOAK_OWNER_CHANGED'); expect(p.sign).not.toHaveBeenCalled();
  });
  it('latches a disconnect during genesis verification', async () => {
    const p = await provider(); rpc.genesis.mockImplementation(async () => { p.wallet.accounts = []; p.emit({ accounts: [] }); return CLOAK_RUNTIME.genesisHash; });
    await expect(p.connectProofPhantom(owner, vi.fn())).rejects.toThrow('CLOAK_OWNER_CHANGED'); expect(p.callbacks.size).toBe(0); expect(p.sign).not.toHaveBeenCalled();
  });
});

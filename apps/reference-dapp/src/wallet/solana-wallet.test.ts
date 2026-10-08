// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';

type Calls = { connect: string[]; sign: { wallet: string; chain: string | undefined }[] };
/** Register Wallet Standard providers the way browser extensions do, in a fresh module instance. */
async function withProviders(defs: { name: string; chains: string[]; features?: string[] }[]) {
  vi.resetModules();
  const target = new EventTarget(), calls: Calls = { connect: [], sign: [] };
  vi.stubGlobal('window', target);
  const wallets = defs.map(def => {
    const account = { address: `${def.name}-account`, chains: def.chains, features: ['solana:signTransaction'] };
    const all: Record<string, unknown> = {
      'standard:connect': { connect: async () => { calls.connect.push(def.name); return { accounts: [account] }; } },
      'solana:signTransaction': { signTransaction: async (input: { transaction: Uint8Array; chain?: string }) => {
        calls.sign.push({ wallet: def.name, chain: input.chain }); return [{ signedTransaction: input.transaction }]; } },
    };
    const features = Object.fromEntries(Object.entries(all).filter(([key]) => (def.features ?? Object.keys(all)).includes(key)));
    return { name: def.name, chains: def.chains, accounts: [account], features, icon: 'data:image/svg+xml;base64,PHN2Zy8+' };
  });
  // Extensions answer app-ready by registering themselves.
  target.addEventListener('wallet-standard:app-ready', event => { for (const wallet of wallets) (event as CustomEvent<{ register(w: unknown): void }>).detail.register(wallet); });
  const module = await import('./solana-wallet');
  return { ...module, calls };
}
const SOLANA = ['solana:mainnet', 'solana:devnet'];
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('explicit Solana Wallet Standard selection', () => {
  it('lists only wallets advertising the cluster and both required features, in registration order', async () => {
    const { solanaWalletNames } = await withProviders([
      { name: 'MetaMask', chains: SOLANA }, { name: 'Brave Wallet', chains: ['eip155:1'] }, { name: 'Solflare', chains: SOLANA },
      { name: 'Mainnet Only', chains: ['solana:mainnet'] }, { name: 'No Signer', chains: SOLANA, features: ['standard:connect'] }, { name: 'Phantom', chains: SOLANA },
    ]);
    expect(solanaWalletNames('solana:devnet')).toEqual(['MetaMask', 'Solflare', 'Phantom']);
    expect(solanaWalletNames('solana:mainnet')).toEqual(['MetaMask', 'Solflare', 'Mainnet Only', 'Phantom']);
  });
  it('connects and signs with the explicitly selected wallet, never the first registered one', async () => {
    const { connectSolanaWallet, signWithSolanaWallet, calls } = await withProviders([{ name: 'MetaMask', chains: SOLANA }, { name: 'Solflare', chains: SOLANA }]);
    const session = await connectSolanaWallet('Solflare', 'solana:devnet', 'DEVNET_SWAP');
    expect(session).toMatchObject({ wallet: { name: 'Solflare' }, account: { address: 'Solflare-account' }, chain: 'solana:devnet' });
    await signWithSolanaWallet(session, btoa('\x01'), 'DEVNET_SWAP');
    expect(calls).toEqual({ connect: ['Solflare'], sign: [{ wallet: 'Solflare', chain: 'solana:devnet' }] });
  });
  it('refuses to connect without a choice, with an unknown or wrong-cluster wallet, or an ambiguous name', async () => {
    const { connectSolanaWallet, calls } = await withProviders([{ name: 'MetaMask', chains: SOLANA }, { name: 'Mainnet Only', chains: ['solana:mainnet'] },
      { name: 'Twin', chains: SOLANA }, { name: 'Twin', chains: SOLANA }]);
    await expect(connectSolanaWallet('', 'solana:devnet', 'DEVNET_SWAP')).rejects.toThrow('DEVNET_SWAP_SOLANA_WALLET_SELECTION_REQUIRED');
    await expect(connectSolanaWallet(undefined as unknown as string, 'solana:devnet', 'DEVNET_SWAP')).rejects.toThrow('DEVNET_SWAP_SOLANA_WALLET_SELECTION_REQUIRED');
    await expect(connectSolanaWallet('Solflare', 'solana:devnet', 'DEVNET_SWAP')).rejects.toThrow('DEVNET_SWAP_SOLANA_WALLET_REQUIRED');
    await expect(connectSolanaWallet('Mainnet Only', 'solana:devnet', 'DEVNET_SWAP')).rejects.toThrow('DEVNET_SWAP_SOLANA_WALLET_REQUIRED');
    await expect(connectSolanaWallet('Twin', 'solana:devnet', 'DEVNET_SWAP')).rejects.toThrow('DEVNET_SWAP_SOLANA_WALLET_AMBIGUOUS');
    expect(calls.connect).toEqual([]);
  });
});

describe('canonical selector entries for Solana wallets', () => {
  it('lists each Solana-capable wallet once, with its own icon, without connecting to any of them', async () => {
    const { solanaWalletChoices, calls } = await withProviders([
      { name: 'Phantom', chains: SOLANA }, { name: 'Brave Wallet', chains: ['eip155:1'] }, { name: 'Backpack', chains: ['solana:mainnet'] },
      { name: 'No Connect', chains: SOLANA, features: ['solana:signTransaction'] }, { name: 'Phantom', chains: SOLANA },
    ]);
    expect(solanaWalletChoices()).toEqual([
      { id: 'solana:Phantom', ecosystem: 'solana', key: 'Phantom', name: 'Phantom', icon: 'data:image/svg+xml;base64,PHN2Zy8+' },
      { id: 'solana:Backpack', ecosystem: 'solana', key: 'Backpack', name: 'Backpack', icon: 'data:image/svg+xml;base64,PHN2Zy8+' },
    ]);
    expect(calls).toEqual({ connect: [], sign: [] });
  });
  it('notifies the selector when a wallet registers late and disconnects through standard:disconnect when offered', async () => {
    const { solanaWalletChoices, subscribeSolanaDiscovery, disconnectSolanaWallet, connectSolanaWallet } = await withProviders([{ name: 'Phantom', chains: SOLANA }]);
    const changed = vi.fn(); subscribeSolanaDiscovery(changed);
    const disconnect = vi.fn(async () => undefined);
    const late = { name: 'Solflare', chains: SOLANA, accounts: [], features: { 'standard:connect': { connect: vi.fn() }, 'standard:disconnect': { disconnect } } };
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: (api: { register(w: unknown): void }) => api.register(late) }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(solanaWalletChoices().map(choice => choice.name)).toEqual(['Phantom', 'Solflare']);
    expect(late.features['standard:connect'].connect).not.toHaveBeenCalled();
    await disconnectSolanaWallet({ wallet: late, account: { address: 'x', chains: SOLANA, features: [] }, chain: 'solana:devnet' });
    expect(disconnect).toHaveBeenCalledTimes(1);
    const session = await connectSolanaWallet('Phantom', 'solana:devnet', 'WALLET');
    await expect(disconnectSolanaWallet(session)).resolves.toBeUndefined();
  });
});

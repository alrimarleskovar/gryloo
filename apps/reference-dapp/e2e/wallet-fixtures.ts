// SPDX-License-Identifier: AGPL-3.0-only
// MOCKED browser wallets for the canonical selector: no extension, no key, no signing, no network. Every call is recorded.
import type { Page } from '@playwright/test';

export const WALLET_ACCOUNTS = Object.freeze({
  metaMask: '0x1111111111111111111111111111111111111111',
  rabby: '0x2222222222222222222222222222222222222222',
  phantomEvm: '0x3333333333333333333333333333333333333333',
  phantomSolana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA91',
});
export type WalletCall = { readonly wallet: string; readonly method: string };

/** Installs MetaMask, Rabby and Phantom (EVM) via EIP-6963 and Phantom (Solana) via Wallet Standard, all on test networks. */
export async function installMultichainWallets(page: Page, options: { evmChain?: string } = {}): Promise<void> {
  await page.addInitScript(({ accounts, evmChain }) => {
    const calls: { wallet: string; method: string }[] = [];
    Object.defineProperty(window, 'walletCalls', { get: () => calls });
    const icon = (color: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${color}"/></svg>`)}`;
    const evm = (wallet: string, account: string) => {
      let connected = false;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      return {
        async request({ method }: { method: string }) {
          calls.push({ wallet, method });
          if (method === 'eth_accounts') return connected ? [account] : [];
          if (method === 'eth_requestAccounts') { connected = true; return [account]; }
          if (method === 'eth_chainId') return evmChain;
          throw Object.assign(new Error('MOCK_WALLET_METHOD_DENIED'), { code: 4200 });
        },
        on(event: string, listener: (...args: unknown[]) => void) { const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group); },
        removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
      };
    };
    const announced = [
      { provider: evm('MetaMask', accounts.metaMask), info: { uuid: '5d1b0a68-1f19-4c55-8b7f-000000000001', name: 'MetaMask', rdns: 'io.metamask', icon: icon('#f6851b') } },
      { provider: evm('Rabby Wallet', accounts.rabby), info: { uuid: '5d1b0a68-1f19-4c55-8b7f-000000000002', name: 'Rabby Wallet', rdns: 'io.rabby', icon: icon('#7084ff') } },
      { provider: evm('Phantom EVM', accounts.phantomEvm), info: { uuid: '5d1b0a68-1f19-4c55-8b7f-000000000003', name: 'Phantom', rdns: 'app.phantom', icon: icon('#ab9ff2') } },
    ];
    const announce = () => { for (const detail of announced) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze(detail) })); };
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
    const chains = ['solana:mainnet', 'solana:devnet'];
    const account = { address: accounts.phantomSolana, publicKey: new Uint8Array(32), chains, features: ['solana:signTransaction', 'solana:signMessage'] };
    const phantom = { version: '1.0.0', name: 'Phantom', icon: icon('#ab9ff2'), chains, accounts: [account], features: {
      'standard:connect': { version: '1.0.0', connect: async () => { calls.push({ wallet: 'Phantom Solana', method: 'standard:connect' }); return { accounts: [account] }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { calls.push({ wallet: 'Phantom Solana', method: 'standard:disconnect' }); } },
      'solana:signTransaction': { version: '1.0.0', signTransaction: async () => { calls.push({ wallet: 'Phantom Solana', method: 'solana:signTransaction' }); throw new Error('MOCK_SIGN_DENIED'); } },
    } };
    const register = (api: { register(...wallets: unknown[]): unknown }) => api.register(phantom);
    window.addEventListener('wallet-standard:app-ready', event => register((event as CustomEvent<{ register(...wallets: unknown[]): unknown }>).detail));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
  }, { accounts: WALLET_ACCOUNTS, evmChain: options.evmChain ?? '0x14a34' });
}
export const walletCalls = (page: Page) => page.evaluate(() => (window as unknown as { walletCalls: WalletCall[] }).walletCalls.map(call => ({ ...call })));
/** Calls that can open a wallet prompt, connect, sign or send (silent reads excluded). */
export const promptingCalls = async (page: Page) => (await walletCalls(page)).filter(call => !['eth_accounts', 'eth_chainId'].includes(call.method));

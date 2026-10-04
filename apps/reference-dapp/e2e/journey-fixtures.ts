// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001 browser fixtures. Arbitrary external wallets are fresh random test wallets (`test-wallet.ts`: in-memory keys,
 * never written). The injected EIP-1193 wallet holds one or more such accounts, signs `personal_sign` in the test process,
 * emits `accountsChanged` / `chainChanged` like a real extension, and "broadcasts" only to the MOCKED loopback testnet chains.
 * Extra browser contexts (another person, another browser) get the same network guard as the shared fixture.
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { routerControl } from './router-fixtures';
import { personalSignText, type TestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';

export const BASE_SEPOLIA_HEX = '0x14a34';
const APP_ORIGIN = 'http://127.0.0.1:3000';
const TESTNET = { network: 'testnet' } as const;

/** Clears the testnet journal and resets the MOCKED testnet chains, funding every given wallet (the first is the harness owner). */
export async function resetJourneyHarness(wallets: readonly TestWallet[], options: Record<string, unknown> = {}) {
  const journal = process.env.GRYLOO_ROUTER_TESTNET_JOURNAL;
  if (process.env.GRYLOO_ROUTER_TESTNET_E2E !== 'MOCKED_LOOPBACK_ONLY' || !journal?.startsWith(join(tmpdir(), 'gryloo-router-testnet-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(journal, { recursive: true, force: true });
  await routerControl('MOCK_reset', [{ network: 'testnet', owner: wallets[0]!.address, wallets: wallets.slice(1).map(w => w.address), ...options }]);
}
export const journeySends = async () => Number(await routerControl('MOCK_sends', [TESTNET]));
export const journeyAdvance = (seconds: number) => routerControl('MOCK_advance', [seconds, TESTNET]);

/** A context with the shared fixture's guard: only the app origin is reachable; anything else is recorded and aborted. */
export async function guardedContext(browser: Browser): Promise<{ context: BrowserContext; unexpected: string[] }> {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US' });
  const unexpected: string[] = [];
  await context.route('**/*', async route => {
    let allowed = false;
    try { allowed = new URL(route.request().url()).origin === APP_ORIGIN; } catch { /* invalid URLs are forbidden */ }
    if (allowed) await route.continue(); else { unexpected.push(route.request().url()); await route.abort('blockedbyclient'); }
  });
  await context.routeWebSocket('**/*', async route => { unexpected.push(`WEBSOCKET:${route.url()}`); await route.close(); });
  return { context, unexpected };
}

/** Installs the injected wallet with `accounts` (the first is selected) on the given chain. */
export async function installJourneyWallet(page: Page, accounts: readonly TestWallet[], options: { chain?: string } = {}) {
  const signers = new Map(accounts.map(a => [a.address, a]));
  await page.exposeFunction('flofiJourneySign', (address: string, message: unknown) => {
    const signer = signers.get(address);
    if (!signer) throw new Error('MOCK_WALLET_ACCOUNT_UNKNOWN');
    return signer.signMessage(personalSignText(message));
  });
  await page.exposeFunction('flofiJourneyControl', (method: string, params: unknown[]) => routerControl(method, [...params, TESTNET]));
  await page.addInitScript(({ accounts, chain }) => {
    type Listener = (...args: unknown[]) => void;
    const listeners = new Map<string, Set<Listener>>();
    const state = { account: accounts[0]!, chain, requests: [] as { method: string; params?: unknown[] }[] };
    const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach(listener => listener(...args));
    const w = window as unknown as { ethereum: unknown; flofiJourneyWallet: unknown; flofiJourneySign: (address: string, message: unknown) => Promise<string>;
      flofiJourneyControl: (method: string, params: unknown[]) => Promise<unknown> };
    w.flofiJourneyWallet = {
      state,
      switchAccount(address: string) { state.account = address; emit('accountsChanged', [address]); },
      setChain(next: string) { state.chain = next; emit('chainChanged', next); },
    };
    w.ethereum = {
      on(event: string, listener: Listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
      removeListener(event: string, listener: Listener) { listeners.get(event)?.delete(listener); },
      request: async (input: { method: string; params?: unknown[] }) => {
        state.requests.push(input);
        const params = input.params ?? [];
        if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts') return [state.account];
        if (input.method === 'eth_chainId') return state.chain;
        if (input.method === 'wallet_switchEthereumChain') { state.chain = (params[0] as { chainId: string }).chainId; emit('chainChanged', state.chain); return null; }
        if (input.method === 'personal_sign') {
          if (String(params[1]).toLowerCase() !== state.account) throw Object.assign(new Error('Unauthorized account'), { code: 4100 });
          return w.flofiJourneySign(state.account, params[0]);
        }
        if (input.method === 'eth_getTransactionCount') return w.flofiJourneyControl('MOCK_nonce', params);
        if (input.method === 'eth_sendTransaction') {
          const tx = params[0] as { from?: string; chainId?: string };
          if (tx.from?.toLowerCase() !== state.account || tx.chainId !== state.chain) throw Object.assign(new Error('Wallet refused the request'), { code: 4100 });
          return w.flofiJourneyControl('MOCK_send', [tx]);
        }
        throw new Error('MOCK_WALLET_METHOD_DENIED');
      },
    };
  }, { accounts: accounts.map(a => a.address), chain: options.chain ?? BASE_SEPOLIA_HEX });
}
export const walletRequests = (page: Page) => page.evaluate(() =>
  (window as unknown as { flofiJourneyWallet: { state: { requests: { method: string; params?: unknown[] }[] } } }).flofiJourneyWallet.state.requests.map(r => r.method));
export const switchAccount = (page: Page, address: string) => page.evaluate(next =>
  (window as unknown as { flofiJourneyWallet: { switchAccount(a: string): void } }).flofiJourneyWallet.switchAccount(next), address);
export const setWalletChain = (page: Page, chain: string) => page.evaluate(next =>
  (window as unknown as { flofiJourneyWallet: { setChain(c: string): void } }).flofiJourneyWallet.setChain(next), chain);

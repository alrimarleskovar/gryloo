// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ROUTER-001 browser fixtures: a scripted EIP-1193 wallet on Base whose only "broadcast" is the MOCKED loopback chain. */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
export const ROUTER_E2E_OWNER = '0x5555555555555555555555555555555555555555';

export async function routerControl(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8557/control', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const value = await response.json() as { result?: unknown; error?: unknown };
  if (value.error) throw new Error('MOCK_HARNESS_ERROR');
  return value.result;
}
export async function resetRouterHarness(options: Record<string, unknown> = {}) {
  const journal = process.env.GRYLOO_ROUTER_JOURNAL;
  if (process.env.GRYLOO_ROUTER_E2E !== 'MOCKED_LOOPBACK_ONLY' || !journal?.startsWith(join(tmpdir(), 'gryloo-router-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(journal, { recursive: true, force: true });
  await routerControl('MOCK_reset', [options]);
}
export const routerWalletSends = async () => Number(await routerControl('MOCK_sends'));
export async function installRouterWallet(page: Page, options: { rejectStep?: number } = {}) {
  await page.exposeFunction('flofiRouterTestControl', routerControl);
  await page.addInitScript(({ owner, options }) => {
    const requests: { method: string; params?: unknown[] }[] = [];
    const state = { chain: '0x2105', sends: 0 };
    const w = window as unknown as { ethereum: unknown; flofiRouterTestControl: (method: string, params: unknown[]) => Promise<unknown>; routerWalletRequests: typeof requests };
    w.routerWalletRequests = requests;
    w.ethereum = { on() { /* no events */ }, removeListener() { /* no events */ }, request: async (input: { method: string; params?: unknown[] }) => {
      requests.push(input);
      if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts') return [owner];
      if (input.method === 'eth_chainId') return state.chain;
      if (input.method === 'wallet_switchEthereumChain') { state.chain = (input.params?.[0] as { chainId: string }).chainId; return null; }
      if (input.method === 'eth_getTransactionCount') return w.flofiRouterTestControl('MOCK_nonce', input.params ?? []);
      if (input.method === 'eth_sendTransaction') {
        state.sends += 1;
        if (options.rejectStep === state.sends) throw Object.assign(new Error('Owner rejected test request'), { code: 4001 });
        return w.flofiRouterTestControl('MOCK_send', [input.params?.[0]]);
      }
      throw new Error('MOCK_WALLET_METHOD_DENIED');
    } };
  }, { owner: ROUTER_E2E_OWNER, options });
}
export const routerSendRequests = (page: Page) => page.evaluate(() => (window as unknown as { routerWalletRequests: { method: string; params?: unknown[] }[] })
  .routerWalletRequests.filter(r => r.method === 'eth_sendTransaction').map(r => r.params?.[0] as Record<string, string>));

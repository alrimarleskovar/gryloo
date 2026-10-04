// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-UNISWAP-LIQUIDITY-PUBLIC browser fixtures: a scripted EIP-1193 wallet whose only "broadcast" is the MOCKED loopback chain. */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
export const UNI_E2E_OWNER = '0x5555555555555555555555555555555555555555';

export async function uniswapHarnessRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8556/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const value = await response.json() as { result?: unknown; error?: unknown };
  if (value.error) throw new Error('MOCK_HARNESS_ERROR');
  return value.result;
}
export async function resetUniswapHarness(options: { delegatedOwner?: boolean } = {}) {
  const journal = process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL;
  if (process.env.GRYLOO_UNISWAP_LIQUIDITY_E2E !== 'MOCKED_LOOPBACK_ONLY' || !journal?.startsWith(join(tmpdir(), 'gryloo-unilp-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(journal, { recursive: true, force: true });
  await uniswapHarnessRpc('MOCK_reset', [options]);
}
export const walletSends = async () => Number(await uniswapHarnessRpc('MOCK_sends'));
/** `delegated`: the wallet fulfils each request as a relayed MetaMask type-2, depth-1 redemption (owner already delegated). */
export type UniswapWalletOptions = { rejectStep?: number; uncertainStep?: number; delegated?: boolean };
export async function installUniswapWallet(page: Page, options: UniswapWalletOptions = {}) {
  await page.exposeFunction('flofiUniswapTestRpc', uniswapHarnessRpc);
  await page.addInitScript(({ owner, options }) => {
    const requests: { method: string; params?: unknown[] }[] = [];
    const state = { chain: '0x14a34', sends: 0 };
    const w = window as unknown as { ethereum: unknown; flofiUniswapTestRpc: (method: string, params: unknown[]) => Promise<unknown>; uniswapWalletRequests: typeof requests };
    w.uniswapWalletRequests = requests;
    w.ethereum = { on() { /* no events */ }, removeListener() { /* no events */ }, request: async (input: { method: string; params?: unknown[] }) => {
      requests.push(input);
      if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts') return [owner];
      if (input.method === 'eth_chainId') return state.chain;
      if (input.method === 'wallet_switchEthereumChain') { state.chain = (input.params?.[0] as { chainId: string }).chainId; return null; }
      if (input.method === 'eth_getTransactionCount') return w.flofiUniswapTestRpc('eth_getTransactionCount', input.params ?? []);
      if (input.method === 'eth_sendTransaction') {
        state.sends += 1;
        if (options.rejectStep === state.sends) throw Object.assign(new Error('Owner rejected test request'), { code: 4001 });
        const hash = await w.flofiUniswapTestRpc(options.delegated ? 'MOCK_sendDelegated' : 'MOCK_send', [input.params?.[0]]);
        if (options.uncertainStep === state.sends) throw new Error('MOCK_RESPONSE_LOST');
        return hash;
      }
      throw new Error('MOCK_WALLET_METHOD_DENIED');
    } };
  }, { owner: UNI_E2E_OWNER, options });
}
export const sendRequests = (page: Page) => page.evaluate(() => (window as unknown as { uniswapWalletRequests: { method: string; params?: unknown[] }[] })
  .uniswapWalletRequests.filter(r => r.method === 'eth_sendTransaction').map(r => r.params?.[0] as Record<string, string>));

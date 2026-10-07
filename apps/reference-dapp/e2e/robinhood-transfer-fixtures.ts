// SPDX-License-Identifier: AGPL-3.0-only
/** RH-DEMO-001 browser fixtures: a scripted EIP-1193 wallet whose only "broadcast" is the MOCKED loopback harness. */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { TRANSFER_OWNER } from './robinhood-transfer-harness.mjs';
export { TRANSFER_OWNER } from './robinhood-transfer-harness.mjs';

/** `route` selects the harness chain: '' is Robinhood Chain Testnet, '/ethereum-sepolia' is Ethereum Sepolia (BUILD-ETHEREUM-001). */
export type TransferRoute = '' | '/ethereum-sepolia';
export async function transferHarnessRpc(method: string, params: unknown[] = [], route: TransferRoute = ''): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:8553' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const value = await response.json() as { result?: unknown; error?: unknown };
  if (value.error) throw new Error('MOCK_HARNESS_ERROR');
  return value.result;
}
export async function resetTransferHarness(options: Record<string, unknown> = {}, route: TransferRoute = '') {
  const journal = process.env.GRYLOO_ROBINHOOD_JOURNAL;
  if (process.env.GRYLOO_ROBINHOOD_E2E !== 'MOCKED_LOOPBACK_ONLY' || !journal?.startsWith(join(tmpdir(), 'gryloo-rh-demo-001-'))) throw new Error('MOCK_RESET_DENIED');
  await rm(journal, { recursive: true, force: true });
  await transferHarnessRpc('MOCK_reset', [options], route);
}
export type TransferWalletOptions = { chain?: string; account?: string; reject?: boolean; uncertain?: boolean; notBroadcast?: boolean; route?: TransferRoute };
export async function installTransferWallet(page: Page, options: TransferWalletOptions = {}) {
  await page.exposeFunction('grylooTransferTestRpc', transferHarnessRpc);
  await page.addInitScript(({ owner, options }) => {
    const requests: { method: string; params?: unknown[] }[] = [];
    const state = { chain: options.chain ?? '0xb626', account: options.account ?? owner };
    const route = options.route ?? '';
    const w = window as unknown as { ethereum: unknown; grylooTransferTestRpc: (method: string, params: unknown[], route: string) => Promise<unknown>;
      transferWalletRequests: typeof requests };
    w.transferWalletRequests = requests;
    w.ethereum = { request: async (input: { method: string; params?: unknown[] }) => {
      requests.push(input);
      if (input.method === 'eth_accounts' || input.method === 'eth_requestAccounts') return [state.account];
      if (input.method === 'eth_chainId') return state.chain;
      if (input.method === 'wallet_switchEthereumChain') { state.chain = (input.params?.[0] as { chainId: string }).chainId; return null; }
      if (input.method === 'eth_getTransactionCount') return w.grylooTransferTestRpc('eth_getTransactionCount', input.params ?? [], route);
      if (input.method === 'eth_sendTransaction') {
        if (options.reject) throw Object.assign(new Error('Owner rejected test request'), { code: 4001 });
        if (options.notBroadcast) throw new Error('MOCK_NOT_BROADCAST');
        const hash = await w.grylooTransferTestRpc('MOCK_submit', [input.params?.[0]], route);
        if (options.uncertain) throw new Error('MOCK_RESPONSE_LOST');
        return hash;
      }
      throw new Error('MOCK_WALLET_METHOD_DENIED');
    } };
  }, { owner: TRANSFER_OWNER, options });
}
export const sendRequests = (page: Page) => page.evaluate(() => (window as unknown as { transferWalletRequests: { method: string; params?: unknown[] }[] })
  .transferWalletRequests.filter(r => r.method === 'eth_sendTransaction').map(r => r.params?.[0] as Record<string, string>));
/** Broadcasts counted on the MOCKED chain itself (owner nonce minus its initial 7), independent of page reloads. */
export async function chainBroadcasts(route: TransferRoute = ''): Promise<number> {
  return Number(BigInt(await transferHarnessRpc('eth_getTransactionCount', [TRANSFER_OWNER, 'latest'], route) as string)) - 7;
}

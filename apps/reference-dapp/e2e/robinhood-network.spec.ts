// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal } from './fixtures';

/** A passive injected wallet already on `chain`. It records every method and refuses anything but reads. */
async function walletOn(page: import('@playwright/test').Page, chain: string) {
  await page.addInitScript((chainId: string) => {
    const methods: string[] = [];
    Object.defineProperty(window, '__robinhoodWalletMethods', { get: () => methods });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: async ({ method }: { method: string }) => {
      methods.push(method);
      if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return chainId;
      throw new Error('unexpected method ' + method);
    } } });
  }, chain);
}
const methods = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as Window & { __robinhoodWalletMethods?: string[] }).__robinhoodWalletMethods ?? []);

test('an injected wallet on Robinhood Chain Testnet is identified by name without any provider egress', async ({ page, networkGuard }) => {
  await walletOn(page, '0xb626');
  await page.goto('/');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Robinhood Chain Testnet (46630)')).toBeVisible();
  expect(new Set(await methods(page))).toEqual(new Set(['eth_accounts', 'eth_chainId']));
  networkGuard.assertClean();
});

test('a wallet on Robinhood mainnet is recognized but never asked to switch, sign or send', async ({ page, networkGuard }) => {
  await walletOn(page, '0x1237');
  await page.goto('/');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Robinhood Chain (4663)')).toBeVisible();
  // Authoring an unrelated Base Sepolia swap does not touch the wallet: no switch, signature or transaction request.
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create swap proposal' });
  await form.getByLabel('Network').selectOption('BASE_SEPOLIA');
  await form.getByLabel('Input amount (required)').fill('2');
  await form.getByLabel('Slippage in bps (required)').fill('50');
  await form.getByRole('button', { name: 'Review swap proposal' }).click();
  await applyPendingProposal(page);
  expect(new Set(await methods(page))).toEqual(new Set(['eth_accounts', 'eth_chainId']));
  networkGuard.assertClean();
});

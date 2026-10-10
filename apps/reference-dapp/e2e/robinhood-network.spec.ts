// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

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
  await page.goto('/app');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Robinhood Chain Testnet (46630)')).toBeVisible();
  expect(new Set(await methods(page))).toEqual(new Set(['eth_accounts', 'eth_chainId']));
  networkGuard.assertClean();
});

test('a wallet on Robinhood mainnet is recognized but never asked to switch, sign or send', async ({ page, networkGuard }) => {
  await walletOn(page, '0x1237');
  await page.goto('/app');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Robinhood Chain (4663)')).toBeVisible();
  // Normal Canvas follows the existing mainnet/testnet environment policy.
  // Authoring a Base swap must not switch the Robinhood wallet or request financial authority.
  await expect(page.getByText('Advanced action setup', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await page.locator('.build-flow-surface .composer-card').getByRole('button', { name: 'Select source token', exact: true }).click();
  const networks = page.getByRole('region', { name: 'Action network picker', exact: true });
  await expect(networks.getByRole('button', { name: 'Base Sepolia', exact: true })).toHaveCount(0);
  await networks.getByRole('button', { name: 'Base', exact: true }).click();
  await page.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await configureCanvasAction(page, '2');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  expect(new Set(await methods(page))).toEqual(new Set(['eth_accounts', 'eth_chainId']));
  networkGuard.assertClean();
});

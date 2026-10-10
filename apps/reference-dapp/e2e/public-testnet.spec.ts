// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, openSimulationDetails, installPassiveWallet, assertPassiveWallet } from './fixtures';
import type { Page } from '@playwright/test';
import { configureCanvasAction } from './composer-authoring-fixtures';

async function authorSwap(page: Page) {
  await expect(page.getByText('Advanced action setup', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await page.locator('.build-flow-surface .composer-card').getByRole('button', { name: 'Select source token', exact: true }).click();
  await page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button', { name: 'Base Sepolia', exact: true }).click();
  await page.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await configureCanvasAction(page, '2');
}

test('public recording remains off in standard browser CI', async ({ page }) => {
  await installPassiveWallet(page, '0x14a34');
  await page.goto('/app');
  await authorSwap(page);
  await page.getByRole('button', { name: 'Simulate', exact: true }).first().click();
  await openSimulationDetails(page);
  await expect(page.getByRole('region', { name: 'Base Sepolia swap simulation' })).toBeVisible();
  await expect(page.getByText('Public testnet recording is not enabled on this app instance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate', exact: true }).last()).toBeDisabled();
  await assertPassiveWallet(page);
});

test('an existing injected session is reused without a new connection prompt', async ({ page }) => {
  await page.addInitScript(() => {
    let prompts = 0;
    Object.defineProperty(window, '__publicWalletPrompts', { get: () => prompts });
    Object.defineProperty(window, 'ethereum', { configurable: true, value: { request: async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0x14a34';
      if (method === 'eth_requestAccounts') { prompts += 1; throw new Error('unexpected wallet prompt'); }
      throw new Error('unexpected method ' + method);
    } } });
  });
  await page.goto('/app');
  await expect(page.getByText('EVM Default: 0x1111…1111 · Base Sepolia')).toBeVisible();
  await authorSwap(page);
  expect(await page.evaluate(() => (window as Window & { __publicWalletPrompts?: number }).__publicWalletPrompts)).toBe(0);
});

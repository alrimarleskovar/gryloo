// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openSimulationDetails } from './fixtures';

test('public recording remains off in standard browser CI', async ({ page }) => {
  await page.goto('/app');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create swap proposal' });
  await form.getByLabel('Network').selectOption('BASE_SEPOLIA');
  await form.getByLabel('Input amount (required)').fill('2');
  await form.getByLabel('Slippage in bps (required)').fill('50');
  await form.getByRole('button', { name: 'Review swap proposal' }).click();
  await applyPendingProposal(page);
  await page.getByRole('button', { name: 'Simulate', exact: true }).first().click();
  await openSimulationDetails(page);
  await expect(page.getByRole('region', { name: 'Base Sepolia swap simulation' })).toBeVisible();
  await expect(page.getByText('Public testnet recording is not enabled on this app instance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simulate', exact: true }).last()).toBeDisabled();
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
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create swap proposal' });
  await form.getByLabel('Network').selectOption('BASE_SEPOLIA');
  await form.getByLabel('Input amount (required)').fill('2');
  await form.getByLabel('Slippage in bps (required)').fill('50');
  await form.getByRole('button', { name: 'Review swap proposal' }).click();
  await applyPendingProposal(page);
  expect(await page.evaluate(() => (window as Window & { __publicWalletPrompts?: number }).__publicWalletPrompts)).toBe(0);
});

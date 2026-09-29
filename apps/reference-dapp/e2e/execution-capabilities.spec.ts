// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('normal Build keeps capability details internal and authoring wallet-free', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Execution environment')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create swap proposal' });
  await form.getByLabel('Network').selectOption('BASE_SEPOLIA');
  await form.getByLabel('Input amount (required)').fill('2');
  await form.getByLabel('Slippage in bps (required)').fill('50');
  await form.getByRole('button', { name: 'Review swap proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
});

test('unsupported workflow stays out of public execution without permanent diagnostics', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add borrow' }).click();
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
});

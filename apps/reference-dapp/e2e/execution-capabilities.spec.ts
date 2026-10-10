// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, installPassiveWallet, assertPassiveWallet } from './fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

test('normal Build keeps capability details internal and authoring requests no financial wallet authority', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByLabel('Execution environment')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  await expect(page.getByText('Advanced action setup', { exact: true })).toHaveCount(0);
  // Asset selection follows the existing connected-wallet environment policy.
  // Reuse a passive testnet identity; authoring must request no connection, signature or transaction.
  await installPassiveWallet(page, '0x14a34');
  await page.reload();
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await page.locator('.build-flow-surface .composer-card').getByRole('button', { name: 'Select source token', exact: true }).click();
  await page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button', { name: 'Base Sepolia', exact: true }).click();
  await page.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await configureCanvasAction(page, '2');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await assertPassiveWallet(page);
});

test('an unprepared liquidity workflow cannot authorize or execute', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toHaveCount(0);
  const stages = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(stages.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled();
  await expect(stages.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simulate workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Workflow workspace' })).toBeVisible();
});

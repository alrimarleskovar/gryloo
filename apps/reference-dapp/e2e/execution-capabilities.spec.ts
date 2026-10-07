// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal } from './fixtures';

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
  await applyPendingProposal(page);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
});

test('an unprepared liquidity workflow cannot authorize or execute', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add pool', exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toHaveCount(0);
  const stages = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(stages.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled();
  await expect(stages.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Workflow workspace' })).toBeVisible();
});

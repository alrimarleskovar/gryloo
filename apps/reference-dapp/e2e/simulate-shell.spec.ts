// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

test('Simulate opens directly on existing content without a workspace introduction', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await nav.getByRole('button', { name: 'Simulate', exact: true }).click();
  const main = page.getByRole('main', { name: 'Simulation workspace', exact: true });
  await expect(main).toBeVisible();
  await expect(main.locator('.workspace-heading, .workflow-context, .page-heading, .stage-current, .stage-guidance, #workspace-title')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Prepare your workflow', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(main).toBeVisible();
  await expect(main.locator('.workspace-heading, .workflow-context, .page-heading, .stage-current, .stage-guidance, #workspace-title')).toHaveCount(0);
  expect(await main.innerText()).not.toMatch(/Draft · Untitled workflow|SIMULATE \/ WORKFLOW|Current stage · Simulate|Understand the outcome|No chain selected/);
  await expect(main.getByRole('button', { name: 'Simulate Supply', exact: true })).toBeVisible();
  await expect(main.locator(':scope > :first-child')).toHaveAttribute('aria-label', 'Aave Supply');
  await expect(page.locator('.summary-bar').getByRole('button', { name: 'Review Supply', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await nav.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Execute', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your Workflow', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeVisible();
  await expect(page.locator('.flow-card.active')).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

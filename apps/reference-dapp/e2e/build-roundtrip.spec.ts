// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('chat and canvas round-trip through the same semantic revision', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.summary-bar[data-workflow-revision="0"]')).toBeVisible();
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByRole('button', { name: /Mock transform/i }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(2);

  await page.locator('.flow-card').nth(1).click();
  await expect(page.getByRole('region', { name: 'Action inspector' })).toContainText('Transform settings');
  await page.getByLabel('Sample amount').fill('2500000');
  await page.getByRole('button', { name: 'Save parameter' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="2"]')).toBeVisible();

  await page.getByLabel('Describe a mock edit').fill('explain');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log')).toContainText('node-002: mock-transform, 2500000 sample units');

  await page.getByLabel('Describe a mock edit').fill('add condition');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="3"]')).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(3);
});

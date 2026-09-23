// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('chat and canvas round-trip through the same semantic revision', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Revision 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Mock transform/i }).click();
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(2);

  await page.locator('.flow-card').nth(1).click();
  await expect(page.getByText('node-002 · mock-transform · mock:local')).toBeVisible();
  await page.getByLabel('Sample amount (integer native units)').fill('2500000');
  await page.getByRole('button', { name: 'Save parameter' }).click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();

  await page.getByLabel('Describe a mock edit').fill('explain');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('log')).toContainText('node-002: mock-transform, 2500000 sample units');

  await page.getByLabel('Describe a mock edit').fill('add condition');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(3);
});

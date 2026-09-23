// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('Build shell visual baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Untitled workflow' })).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(1);
  await expect(page).toHaveScreenshot('build.png', { fullPage: true });
});

test('Simulate unavailable visual baseline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Simulate is not implemented' })).toBeVisible();
  await expect(page).toHaveScreenshot('simulate.png', { fullPage: true });
});

test('Execute unavailable visual baseline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Execute is not implemented' })).toBeVisible();
  await expect(page).toHaveScreenshot('execute.png', { fullPage: true });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { readyForVisualCapture } from './mode-a-fixtures';

test('Build shell visual baseline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Untitled workflow' })).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(1);
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('build.png', { fullPage: true });
});

test('Simulate mocked-chain empty visual baseline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Mocked artifact chain' }).getByText('ARTIFACTS: EMPTY', { exact: true })).toBeVisible();
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('simulate.png', { fullPage: true });
});

test('Execute unavailable visual baseline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Execute is not implemented' })).toBeVisible();
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('execute.png', { fullPage: true });
});

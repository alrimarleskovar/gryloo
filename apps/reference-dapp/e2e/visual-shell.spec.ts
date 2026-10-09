// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { readyForVisualCapture } from './mode-a-fixtures';

test('Build shell visual baseline', async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your Workflow' })).toBeVisible();
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(0);
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('build.png', { fullPage: true });
});

test('Simulate mocked-chain empty visual baseline', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review & Authorization', exact: true })).toContainText('Review unavailable until simulation is ready.');
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('simulate.png', { fullPage: true });
});

test('Execute unavailable visual baseline', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Execution Summary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('execute.png', { fullPage: true });
});

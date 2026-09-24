// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('shows honest authorization and unavailable stage states', async ({ page }) => {
  await page.goto('/');
  for (const status of ['MOCKED', 'NONE', 'NOT_ENFORCED', 'NOT_APPLICABLE']) {
    await expect(page.getByText(status, { exact: true }).last()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Open mocked simulation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByText('Mocked artifact chain: synthetic fixture data, not a live quote or a financial simulation.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mocked artifact chain' })).toContainText('Add a Base swap in Build before generating mocked artifacts.');
  await expect(page.getByRole('region', { name: 'Mocked artifact chain' })).toContainText('USD values: not modeled.');
  await expect(page.getByRole('button', { name: 'Manifest review unavailable in Build 003B' })).toBeDisabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Mocked quote and simulation artifacts cannot authorize execution. There is no live quote, wallet, signature, transaction, execution or outcome here.');
  await expect(page.getByRole('button', { name: 'Execution unavailable in Build 003B' })).toBeDisabled();
});

test('provides semantic landmarks, labelled controls and keyboard access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Untitled workflow' })).toBeVisible();
  await expect(page.getByLabel('Describe a mock edit')).toBeVisible();
  await page.getByLabel('Describe a mock edit').focus();
  await expect(page.getByLabel('Describe a mock edit')).toBeFocused();
  await page.keyboard.type('add read');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

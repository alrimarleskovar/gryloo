// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('shows honest authorization and unavailable stage states', async ({ page }) => {
  await page.goto('/');
  for (const status of ['MOCKED', 'NONE', 'NOT_ENFORCED', 'NOT_APPLICABLE']) {
    await expect(page.getByText(status, { exact: true }).last()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Simulation unavailable in Build 003A' })).toBeDisabled();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Simulate unavailable' })).toContainText('Simulate is not implemented');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('There is no quote, financial simulation, wallet, transaction, execution or outcome here.');
  await expect(page.getByRole('button', { name: 'Simulation unavailable in Build 003A' })).toBeDisabled();
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

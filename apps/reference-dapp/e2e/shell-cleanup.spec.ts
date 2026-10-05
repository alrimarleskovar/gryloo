// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

test('Build opens directly into the workspace with a standalone logo and neutral Dashboard item', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main', { name: 'Workflow workspace' });
  await expect(main.locator(':scope > .build-grid').first()).toBeVisible();
  expect(await main.evaluate(el => el.firstElementChild?.className)).toBe('build-grid');
  await expect(page.locator('.workspace-heading')).toHaveCount(0);
  await expect(page.locator('.brand img')).toHaveAttribute('alt', 'FloFi');
  await expect(page.locator('.brand small')).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(nav.getByRole('button').first()).toHaveText('Dashboard');
  await expect(nav.getByRole('button', { name: 'Dashboard', exact: true }).locator('.stage-number')).toHaveCount(0);
  for (const [index, stage] of ['Build', 'Simulate', 'Execute'].entries()) {
    await expect(nav.getByRole('button', { name: stage, exact: true }).locator('.stage-number')).toHaveText(String(index + 1));
  }
});

test('Dashboard has an intentionally blank content area', async ({ page }) => {
  await page.goto('/');
  const dashboard = page.getByRole('button', { name: 'Dashboard', exact: true });
  await dashboard.click();
  await expect(dashboard).toHaveAttribute('aria-current', 'page');
  const main = page.getByRole('main', { name: 'Dashboard' });
  await expect(main).toHaveText('');
  expect(await main.evaluate(el => el.childElementCount)).toBe(0);
  await expect(page.locator('.summary-bar')).toHaveCount(0);
});

test('switching through Dashboard preserves the canonical draft and supported Build editing', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const form = page.getByRole('form', { name: 'Edit Supply' });
  await form.getByLabel('Supply amount (USDC)').fill('2');
  await form.getByRole('button', { name: 'Review Supply change', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.locator('.flow-card')).toHaveCount(1);
  await expect(form.getByLabel('Supply amount (USDC)')).toHaveValue('2');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  for (const stage of ['Simulate', 'Execute']) {
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: stage, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: stage, exact: true })).toBeVisible();
  }
});

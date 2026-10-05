// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('shows honest authorization and unavailable stage states', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simular Fees' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByText('Technical diagnostics', { exact: true }).click();
  await expect(page.getByText('Mocked artifact chain: synthetic fixture data, not a live quote or a financial simulation. A separate read-only Base observation follows it; neither can authorize execution.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mocked artifact chain' })).toContainText('Add a Base swap in Build before generating mocked artifacts.');
  await expect(page.getByRole('region', { name: 'Mocked artifact chain' })).toContainText('USD values: not modeled.');
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeDisabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await page.getByText('Technical diagnostics', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Mocked quote and simulation artifacts cannot authorize execution. Read-only Base observations cannot authorize execution either. There is no wallet, signature, transaction, execution or outcome here.');
  await expect(page.getByRole('region', { name: 'Execute unavailable' }).getByRole('button', { name: 'Return to Build' })).toBeVisible();
});

test('provides semantic landmarks, labelled controls and keyboard access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(1);
  await expect(page.getByRole('main', { name: 'Workflow workspace' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Untitled workflow' })).toHaveCount(0);
  await expect(page.getByLabel('Describe your flow')).toBeVisible();
  await page.getByLabel('Describe your flow').focus();
  await expect(page.getByLabel('Describe your flow')).toBeFocused();
  await page.keyboard.type('add read');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('labels the local fork honestly and enables no execution without a reviewed fork Manifest', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('banner');
  await banner.getByText('Technical connection details', { exact: true }).click();
  await expect(banner.getByText(/^Local fork · (MOCKED|FORK_REPRODUCED)$/)).toBeVisible();
  await expect(banner).toContainText('Wallet: injected · not connected');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByText('Technical diagnostics', { exact: true }).click();
  await page.getByRole('button', { name: 'Show technical details' }).click();
  const fork = page.getByRole('region', { name: 'Local fork Mode A simulation' });
  await expect(fork).toContainText('Local-fork Mode A needs exactly one USDC/WETH swap in the workflow.');
  await expect(fork.getByRole('button', { name: 'Simulate on local fork for revision 0' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review swap' })).toBeDisabled();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await page.getByText('Technical diagnostics', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Local-fork Mode A is enabled on this server');
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/MAINNET_EXECUTED|TESTNET_EXECUTED|mainnet executed|(?<!not )production certified/i);
});

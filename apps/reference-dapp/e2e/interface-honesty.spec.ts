// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, openSimulationDetails, openProposalReview } from './fixtures';

test('shows honest authorization and unavailable stage states', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simular Fees' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  await expect(page.locator('.simulation-technical > .simulate-head')).toContainText('Mocked artifacts cannot authorize execution.');
  await expect(page.locator('.simulation-technical')).toContainText('Add a Base swap in Build before generating mocked artifacts.');
  await expect(page.locator('.simulation-technical')).toContainText('USD values: not modeled.');
  await expect(page.getByRole('region', { name: 'Review & Authorization' })).toContainText('Review unavailable until simulation is ready.');
  await expect(page.getByRole('button', { name: 'Approve & Continue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Workflow execution workspace' })).toContainText('No workflow ready to execute');
  await expect(page.getByRole('button', { name: 'Back to Build', exact: true })).toBeVisible();
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
  await page.keyboard.type('swap 2 USDC to WETH on Base slippage 50 bps');
  await page.keyboard.press('Enter');
  await openProposalReview(page);
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
  await openSimulationDetails(page);
  const fork = page.getByRole('region', { name: 'Local fork Mode A simulation' });
  await expect(fork).toContainText('Local-fork Mode A needs exactly one USDC/WETH swap in the workflow.');
  await expect(fork.getByRole('button', { name: 'Simulate on local fork for revision 0' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Review & Authorization' })).toContainText('Review unavailable until simulation is ready.');
  await expect(page.getByRole('button', { name: 'Approve & Continue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Workflow execution workspace' })).toContainText('No workflow ready to execute');
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/MAINNET_EXECUTED|TESTNET_EXECUTED|mainnet executed|(?<!not )production certified/i);
});

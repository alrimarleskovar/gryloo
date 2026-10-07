// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, openProposalReview, applyPendingProposal, installPassiveWallet, assertPassiveWallet } from './fixtures';

test.beforeEach(async ({ page }) => { await installPassiveWallet(page, '0x14a34'); await page.goto('/'); });
test.afterEach(async ({ page }) => { await assertPassiveWallet(page); });

test('outside click and Escape close the proposal without applying or dismissing it', async ({ page }) => {
  await page.getByLabel('Describe your flow').fill('swap 2 USDC to WETH on Base Sepolia slippage 50 bps');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  for (const close of ['outside', 'Escape']) {
    await openProposalReview(page);
    if (close === 'outside') await page.getByRole('heading', { name: 'Copilot', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Proposed change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Review proposed change:/ })).toHaveCount(1);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(0);
  }
  await applyPendingProposal(page);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(1);
});

test('the explicit Dismiss control discards the proposal without changing the workflow', async ({ page }) => {
  await page.getByLabel('Describe your flow').fill('swap 2 USDC to WETH on Base Sepolia slippage 50 bps');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Dismiss proposal', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Proposed change' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Review proposed change:/ })).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(0);
});

test('a three-step proposal applies atomically and grants no financial authorization', async ({ page }) => {
  await page.getByLabel('Describe your flow').fill('compose supply 0.1 USDC to Aave then borrow 0.01 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner 0x1111111111111111111111111111111111111111');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page);
  await expect(page.getByRole('dialog', { name: 'Proposed change' })).toContainText('Supply → Borrow → Swap');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.locator('.build-flow-surface .composer-card')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Review proposed change:/ })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
});

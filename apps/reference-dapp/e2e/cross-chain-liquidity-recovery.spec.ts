// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openSimulationDetails, installPassiveWallet, assertPassiveWallet } from './fixtures';

// Partial settlement, failed destination swap, manual recovery and no replay are
// exercised by cross-chain-liquidity-action.test.ts and executor/reconciler suites.
test('a MOCKED destination failure scenario cannot manufacture production completion, recovery or Evidence', async ({ page }) => {
  await installPassiveWallet(page);
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → Uniswap v3 position', { exact: true }).click();
  const inspector = page.getByRole('form', { name: 'Compose cross-chain liquidity' });
  await inspector.getByLabel('Composition source quantity (USDC)').fill('100');
  await inspector.getByRole('button', { name: 'Review cross-chain composition' }).click();
  await applyPendingProposal(page);
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Cross-chain liquidity composition' });
  await panel.getByLabel('Deterministic outcome').selectOption('SWAP_REVERT');
  await panel.getByRole('button', { name: 'Generate MOCKED chained simulation' }).click();
  await expect(panel).toContainText('Stage: SOURCE PREPARED');
  await expect(panel).toContainText('Reconciled destination output: pending MOCKED destination balance read');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Cross-chain recovery' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await assertPassiveWallet(page);
  await page.reload();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await assertPassiveWallet(page);
});

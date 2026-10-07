// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openSimulationDetails, installPassiveWallet, assertPassiveWallet } from './fixtures';

// Direct-demo uncertain deposit/recovery remains covered by server/across-service.test.ts
// and packages/reference-executor/test/across.test.ts; it is not production authorization.
test('a direct Across fixture quote never authorizes production Execute or fabricates Evidence', async ({ page }) => {
  await installPassiveWallet(page);
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('Across amount (USDC)').fill('1');
  await page.getByRole('button', { name: 'Review direct Across bridge' }).click();
  await applyPendingProposal(page);
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await openSimulationDetails(page);
  const panel = page.getByRole('region', { name: 'Direct Across bridge' });
  await panel.getByRole('button', { name: 'Get direct Across quote' }).click();
  await expect(panel.locator('[data-across-state]')).toHaveText('QUOTED');
  await expect(panel).toContainText('Deterministic fixture');
  await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Authorize fixed Across review for demo' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await assertPassiveWallet(page);
  await page.reload();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toHaveCount(0);
  await assertPassiveWallet(page);
});

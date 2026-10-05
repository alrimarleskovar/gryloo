// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('Simulate keeps the workflow visible and reveals technical views on request', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();

  const panel = page.getByRole('region', { name: 'Mocked artifact chain' });
  const details = panel.getByRole('button', { name: 'Show technical details' });
  await expect(panel.locator('.simulate-canvas')).toBeVisible();
  await expect(panel.locator('.simulate-empty')).toBeVisible();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: 'Base read-only observation' })).toBeHidden();
  await expect(page.getByRole('region', { name: 'Local fork Mode A simulation' })).toBeHidden();

  await details.click();
  await expect(page.getByRole('region', { name: 'Base read-only observation' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Local fork Mode A simulation' })).toBeVisible();
  await panel.getByRole('button', { name: 'Hide technical details' }).click();
  await expect(page.getByRole('region', { name: 'Base read-only observation' })).toBeHidden();

  const stages = page.getByRole('navigation', { name: 'Workflow stages' });
  await stages.getByRole('button', { name: 'Build' }).click();
  await page.getByLabel('Describe your flow').fill('swap 2.25 USDC to WETH on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await stages.getByRole('button', { name: 'Simulate' }).click();
  await panel.getByRole('button', { name: /^Generate mocked artifacts for revision \d+$/ }).click();
  await expect(panel.locator('.simulate-swap')).toBeVisible();
  await expect(panel.locator('.chain-strip')).toBeHidden();
  await panel.getByRole('button', { name: 'Show technical details' }).click();
  await expect(panel.locator('.chain-strip')).toBeVisible();
});

// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
const OWNER = '0x1111111111111111111111111111111111111111';
test('direct Across fixture review, uncertain deposit recovery, fill and reconciliation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(owner => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return [owner];
        if (method === 'eth_chainId') return '0x2105';
        throw new Error('Unexpected wallet method');
      }, on() {}, removeListener() {},
    } });
  }, OWNER);
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('Across amount (USDC)').fill('1');
  await page.getByRole('button', { name: 'Review direct Across bridge' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Direct Across bridge' });
  await panel.getByRole('button', { name: 'Get direct Across quote' }).click();
  await expect(panel.locator('[data-across-state]')).toHaveText('QUOTED');
  await expect(panel).toContainText('Deterministic fixture');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await panel.getByRole('button', { name: 'Authorize fixed Across review for demo' }).click();
  await panel.getByRole('button', { name: 'Simulate approval requirements' }).click();
  await panel.getByRole('button', { name: 'Prepare deposit transaction' }).click();
  await panel.getByLabel('Simulate uncertain response').check();
  await panel.getByRole('button', { name: 'Simulate source deposit' }).click();
  await expect(panel.locator('[data-across-state]')).toHaveText('DEPOSIT_UNKNOWN');
  await page.reload();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const recovered = page.getByRole('region', { name: 'Direct Across bridge' });
  await expect(recovered.locator('[data-across-state]')).toHaveText('DEPOSIT_UNKNOWN');
  await expect(recovered.getByRole('button', { name: 'Simulate source deposit' })).toHaveCount(0);
  await recovered.getByRole('button', { name: 'Recheck existing deposit' }).click();
  await recovered.getByRole('button', { name: 'Check source deposit' }).click();
  await recovered.getByRole('button', { name: 'Track destination fill' }).click();
  await recovered.getByRole('button', { name: 'Show delayed fill' }).click();
  await recovered.getByRole('button', { name: 'Confirm destination fill' }).click();
  await recovered.getByRole('button', { name: 'Reconcile destination receipt and balance' }).click();
  await expect(recovered.locator('[data-across-state]')).toHaveText('RECONCILED');
  await expect(recovered.locator('[data-across-received]')).toBeVisible();
});

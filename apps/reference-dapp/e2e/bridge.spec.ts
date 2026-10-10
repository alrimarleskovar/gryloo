// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

const OWNER = '0x1111111111111111111111111111111111111111';

test('chat and canvas share bridge IR; live route drives durable MOCKED recovery and reconciliation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(owner => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x2105';
        if (method === 'eth_requestAccounts') return [owner];
        throw new Error('Unexpected wallet method: ' + method);
      },
    } });
  }, OWNER);
  await page.goto('/__engineering');
  await page.getByLabel('Describe your flow').fill('bridge 1 USDC from Base to Optimism slippage 50 bps');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.locator('.flow-card').first().click();
  const chat = JSON.parse((await page.locator('[data-workflow-ir]').textContent()) ?? '{}') as { nodes: { actionType: string }[] };
  expect(chat.nodes[0]?.actionType).toBe('asset.bridge');

  await page.reload();
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('USDC amount').fill('1');
  await page.getByLabel('Maximum slippage (bps)').fill('50');
  await page.getByRole('button', { name: 'Review bridge proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.locator('.flow-card').first().click();
  const canvas = JSON.parse((await page.locator('[data-workflow-ir]').textContent()) ?? '{}');
  expect(canvas).toEqual(chat);

  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  const review = page.getByRole('region', { name: 'LI.FI bridge quote and review' });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Connect Base wallet address' }).click();
  await expect(review).toContainText(OWNER);
  await review.getByLabel('Rehearsal response').selectOption('uncertain');
  await review.getByRole('button', { name: 'Get live LI.FI route' }).click();
  await expect(review.getByRole('article', { name: 'LI.FI quote' })).toBeVisible({ timeout: 25_000 });
  await expect(review).toContainText('Base (8453) → Optimism (10)');
  await expect(review).toContainText('MOCKED EXECUTION');
  await expect(review.locator('[data-bridge-manifest]')).toHaveText(/^0x[0-9a-f]{64}$/);

  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const execution = page.getByRole('region', { name: 'LI.FI mocked bridge execution' });
  await execution.getByRole('button', { name: 'Authorize reviewed Manifest for MOCKED rehearsal' }).click();
  await execution.getByRole('button', { name: 'Rehearse exact USDC approval' }).click();
  await execution.getByRole('button', { name: 'Rehearse source transaction' }).click();
  await expect(execution.locator('[data-bridge-state]')).toHaveText('UNKNOWN');
  await page.reload();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const recovered = page.getByRole('region', { name: 'LI.FI mocked bridge execution' });
  await expect(recovered).toContainText('Recovered from the durable journal after restart');
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('UNKNOWN');
  await expect(recovered.getByRole('button', { name: 'Rehearse source transaction' })).toHaveCount(0);
  await recovered.getByRole('button', { name: 'Recheck existing source attempt' }).click();
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('SOURCE_SUBMITTED');
  await recovered.getByRole('button', { name: 'Check source confirmation' }).click();
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('SOURCE_CONFIRMED');
  await recovered.getByRole('button', { name: 'Check bridge progress' }).click();
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('BRIDGE_IN_PROGRESS');
  await recovered.getByRole('button', { name: 'Check destination receipt' }).click();
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('DESTINATION_CONFIRMED');
  await recovered.getByRole('button', { name: 'Reconcile destination balance' }).click();
  await expect(recovered.locator('[data-bridge-state]')).toHaveText('RECONCILED');
  await expect(recovered.locator('[data-bridge-evidence]')).toHaveText(/^0x[0-9a-f]{64}$/);
  await expect(recovered).toContainText('MOCKED');
});

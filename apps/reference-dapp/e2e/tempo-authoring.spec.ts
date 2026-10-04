// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('Tempo Canvas proposal uses the shared workflow revision and execution tabs without requesting a signature', async ({ page, networkGuard }) => {
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Tempo payment', exact: true });
  await form.getByLabel('Payment recipient').fill('0x2222222222222222222222222222222222222222');
  await form.getByRole('button', { name: 'Review payment proposal' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(2);
  await expect(page.locator('.flow-card').nth(1)).toContainText('Tempo');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Tempo payment execution' })).toContainText('Tempo Moderato');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Authorize payment in owner wallet' })).toHaveCount(0);
  networkGuard.assertClean();
});

test('Tempo Guided command and bounded Canvas edit use the same proposal pipeline', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe a mock edit').fill('pay 1 pathUSD to 0x2222222222222222222222222222222222222222 on Tempo Moderato memo 0x' + '01'.repeat(32) + ' fee 0.01');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toBeVisible();
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Tempo payment', exact: true });
  await form.getByLabel('Payment recipient').fill('0x2222222222222222222222222222222222222222');
  await form.getByLabel('Payment amount (pathUSD)').fill('10.000001');
  await form.getByRole('button', { name: 'Review payment proposal' }).click();
  await expect(form.getByRole('alert')).toContainText('up to 10 test pathUSD');
  await expect(page.locator('.summary-bar[data-workflow-revision="1"]')).toBeVisible();
  await form.getByLabel('Payment amount (pathUSD)').fill('2');
  await form.getByRole('button', { name: 'Review payment proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="2"]')).toBeVisible();
});

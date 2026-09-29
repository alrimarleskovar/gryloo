// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('environment inspection keeps workflow revision, IR and canvas layout unchanged', async ({ page }) => {
  await page.goto('/');
  const selector = page.getByLabel('Execution environment');
  await expect(selector).toHaveValue('MOCK');
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gryloo:canvas:workflow-local'))).not.toBeNull();
  const before = await page.evaluate(() => localStorage.getItem('gryloo:canvas:workflow-local'));
  await selector.selectOption('PUBLIC_TESTNET');
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toContainText('Testnet unavailable');
  await selector.selectOption('MAINNET');
  await expect(page.getByRole('region', { name: 'Workflow readiness' })).toContainText('Mainnet unavailable');
  await selector.selectOption('LOCAL_FORK');
  await selector.selectOption('MOCK');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
  expect(await page.evaluate(() => localStorage.getItem('gryloo:canvas:workflow-local'))).toBe(before);
});

test('templates remain authorable while public execution is blocked with a named reason', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add borrow' }).click();
  const inspector = page.getByRole('region', { name: 'Selected action capability' });
  await expect(inspector).toContainText('Template only');
  await page.getByLabel('Execution environment').selectOption('PUBLIC_TESTNET');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const unavailable = page.getByRole('region', { name: 'Execute unavailable' });
  await expect(unavailable).toContainText('Borrow · This action is available for workflow authoring only.');
  await expect(page.getByRole('region', { name: 'Mode A execution' })).toHaveCount(0);
});

test('composed Mock capability survives environment inspection; public workflow execution stays blocked', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Base → Arbitrum → Uniswap v3 position', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Compose cross-chain liquidity' });
  await form.getByLabel('Composition source quantity (USDC)').fill('100');
  await form.getByRole('button', { name: 'Review cross-chain composition' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  const review = page.getByRole('region', { name: 'Deterministic review findings' });
  const ir = await review.locator('[data-workflow-ir]').textContent();
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  const readiness = page.getByRole('region', { name: 'Workflow readiness' });
  await expect(readiness).toContainText('Mock only');
  await expect(readiness).toContainText('mocked');
  await page.getByLabel('Execution environment').selectOption('PUBLIC_TESTNET');
  await expect(readiness).toContainText('Testnet unavailable');
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Bridge · Public test execution is not available yet.');
  await expect(page.getByRole('region', { name: 'Cross-chain liquidity composition' })).toHaveCount(0);
  await page.getByLabel('Execution environment').selectOption('MOCK');
  await expect(readiness).toContainText('Mock only');
  await expect(page.getByRole('region', { name: 'Cross-chain liquidity composition' })).toBeVisible();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  expect(await review.locator('[data-workflow-ir]').textContent()).toBe(ir);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
});

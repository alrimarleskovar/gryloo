// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';

test('Execute shows the shared authored workflow without authorizing or inventing execution', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await page.getByRole('button', { name: 'Rename workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill('ESPARTACUS');
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).press('Enter');
  await page.getByLabel('Describe your flow').fill('swap 2.25 USDC to WETH on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(page.locator('.simulate-canvas').getByRole('heading', { name: 'ESPARTACUS', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review swap', exact: true })).toBeDisabled();
  await nav.getByRole('button', { name: 'Execute', exact: true }).click();
  const execution = page.getByRole('main', { name: 'Execution workspace', exact: true });
  const graph = execution.getByRole('region', { name: 'Workflow overview graph', exact: true });
  await expect(execution.locator(':scope > :first-child')).toHaveAttribute('aria-label', 'Workflow overview');
  await expect(execution.getByRole('heading', { name: 'ESPARTACUS', exact: true })).toBeVisible();
  await expect(execution.locator('.stage-empty, .unavailable')).toHaveCount(0);
  await expect(graph.locator('.flow-card')).toHaveCount(1);
  await expect(graph.locator('.flow-card')).toContainText('USDC → WETH');
  await expect(graph.locator('.flow-card')).toContainText('2.25 USDC');
  await expect(graph.locator('.flow-card')).toContainText('Base');
  await expect(execution.locator('form, input:not([type=range]), [data-mocked-value]')).toHaveCount(0);
  await expect(execution.getByRole('button', { name: /^(Return to Build|Execute|Execute swap|Authorize|Accept review)$/ })).toHaveCount(0);
  expect(await execution.innerText()).not.toMatch(/EXECUTE \/ UNAVAILABLE|Prepare for execution|Mocked|Running|Confirmed|Completed/);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(graph).toHaveAttribute('data-viewport', 'fitted');
    await expect(graph.locator('.flow-card')).toBeInViewport();
    const graphBox = (await graph.boundingBox())!, controlsBox = (await graph.locator('.canvas-navigator').boundingBox())!;
    expect(controlsBox.x + controlsBox.width / 2).toBeCloseTo(graphBox.x + graphBox.width / 2, 1);
    expect(graphBox.y + graphBox.height - controlsBox.y - controlsBox.height).toBe(graphBox.width < 800 ? 82 : 24);
    expect((await execution.locator('.technical-workspace').boundingBox())!.y).toBeGreaterThanOrEqual(graphBox.y + graphBox.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await execution.locator('.technical-workspace > summary').click();
  await expect(execution.getByText('A supported workflow, current simulation and explicit wallet authorization are required before execution.', { exact: true })).toBeVisible();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ESPARTACUS', exact: true })).toBeVisible();
  await expect(page.locator('.flow-card')).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

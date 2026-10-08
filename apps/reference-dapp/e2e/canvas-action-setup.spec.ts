// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction, openCanvasSettings } from './composer-authoring-fixtures';
import type { Page } from '@playwright/test';

const card = (page: Page) => page.locator('.build-flow-surface .composer-card');
async function readWorkflow(page: Page) {
  const advanced = page.locator('details.library[aria-label="Advanced action setup"]');
  if (!(await advanced.evaluate(element => element.hasAttribute('open')))) await advanced.locator(':scope > summary').click();
  if (!(await advanced.locator('[data-workflow-ir]').count())) return null;
  if (!(await advanced.locator('[data-workflow-ir]').isVisible())) await advanced.getByText('Workflow IR', { exact: true }).click();
  return JSON.parse(await advanced.locator('[data-workflow-ir]').innerText()) as { revision: number; nodes: { actionType: string; nodeId: string; inputs: { kind: string; value: { amount?: string } }[] }[] };
}
async function expectBlocked(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(nav.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled();
  await expect(nav.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeDisabled();
  await nav.getByRole('button', { name: 'Simulate', exact: true }).dispatchEvent('click');
  await nav.getByRole('button', { name: 'Execute', exact: true }).dispatchEvent('click');
  await expect(nav.getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main', { name: 'Simulation workspace', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main', { name: 'Execution workspace', exact: true })).toHaveCount(0);
}

for (const action of ['swap', 'bridge'] as const) test(`${action} starts unconfigured at zero, blocks later stages and accepts only a validated positive amount`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const source = card(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  await expect(source).toHaveValue('0');
  await expect(card(page).locator('.composer-destination-box .composer-amount-value')).toHaveText('0');
  await expect(card(page).locator('.composer-fiat-value')).toHaveText(['USD value unavailable', 'USD value unavailable']);
  await expect(card(page).locator('.composer-network-badge')).toHaveCount(2);
  expect(await card(page).innerText()).not.toMatch(/pending|unapplied|canonical|committed|draft/i);
  await expectBlocked(page);
  const initial = await readWorkflow(page);
  expect(initial).toBeNull();
  await expect(page.getByRole('form', { name: 'Edit cross-chain bridge', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Input amount (USDC)', exact: true })).toHaveCount(0);
  await openCanvasSettings(page);
  const amountForm = page.getByRole('form', { name: `Configure ${action === 'swap' ? 'Swap' : 'Bridge'}`, exact: true });
  await expect(amountForm.getByLabel('Source amount (USDC)', { exact: true })).toHaveValue('0');
  // Display priority never edits the amount or invents a quote.
  await card(page).locator('.composer-amount').getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
  await expect(card(page).locator('.composer-primary-fiat')).toHaveText(['USD value unavailable', 'USD value unavailable']);
  await expect(card(page).locator('.composer-amount .composer-primary-fiat')).toHaveText('USD value unavailable');
  await expect(source).toHaveValue('0');
  await card(page).locator('.composer-amount').getByRole('button', { name: 'Show token amount first', exact: true }).click();
  const destination = card(page).locator('.composer-destination-box');
  await destination.getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
  await expect(card(page).locator('.composer-primary-fiat')).toHaveText(['USD value unavailable', 'USD value unavailable']);
  await expect(destination.locator('.composer-primary-fiat')).toHaveText('USD value unavailable');
  await expect(destination.locator('.composer-token-subline')).toHaveText(action === 'swap' ? '0 WETH' : '0 USDC');
  await destination.getByRole('button', { name: 'Show token amount first', exact: true }).click();
  await expect(card(page).locator('.composer-primary-fiat')).toHaveCount(0);
  await expect(destination.locator('.composer-amount-value')).toHaveText('0');
  await expect(card(page).locator('.composer-network-badge').first()).toHaveAttribute('aria-label', action === 'swap' ? 'Base (8453) network' : 'Base Sepolia network');
  await expect(card(page).locator('.composer-network-badge').last()).toHaveAttribute('aria-label', action === 'swap' ? 'Base (8453) network' : 'Arbitrum Sepolia network');
  await card(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card(page).getByRole('alert')).toContainText('greater than 0');
  expect(await readWorkflow(page)).toEqual(initial);
  await source.fill(''); await expectBlocked(page);
  await source.fill('2.5');
  await expect(amountForm.getByLabel('Source amount (USDC)', { exact: true })).toHaveValue('2.5');
  await expectBlocked(page);
  await card(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  expect(await readWorkflow(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Apply amount', exact: true }).click();
  if (action === 'swap') {
    const configured = await readWorkflow(page), node = configured!.nodes.find(item => !item.actionType.startsWith('mock-'))!;
    expect(node.actionType).toBe('asset.swap.exact-input');
    expect(node.inputs.find(field => field.kind === 'QUANTITY')?.value.amount).toBe('2500000');
  } else {
    // Router workflows use their existing dedicated diagnostics. Its editor and Simulate are both canonical readers.
    await expect(page.getByRole('form', { name: 'Edit cross-chain bridge', exact: true }).getByLabel('Cross-chain amount (USDC)', { exact: true })).toHaveValue('2.5');
  }
  await expect(source).toHaveValue('2.5');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeEnabled();
  await expect(card(page)).toHaveClass(/active/);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Simulation workspace', exact: true })).toBeVisible();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText('2.5 USDC');
});

test('clearing an existing amount blocks both later stages without sending zero to the IR, and Cancel restores its value', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '2');
  const original = await readWorkflow(page);
  await openCanvasSettings(page);
  const source = card(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  await source.fill('0'); await expectBlocked(page);
  await expect(page.getByRole('region', { name: 'Action inspector' }).locator('.composer-editor-context')).toContainText('0 USDC');
  await expect(page.getByRole('region', { name: 'Action inspector' }).getByLabel('Input amount (USDC)', { exact: true })).toHaveValue('0');
  expect(await readWorkflow(page)).toEqual(original);
  await card(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(card(page).getByRole('alert')).toContainText('greater than 0');
  await card(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(source).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeEnabled();
  expect(await readWorkflow(page)).toEqual(original);
});

test('changing the field after reviewing invalidates acceptance, and delete/history restores an incomplete card safely', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await page.getByRole('button', { name: 'Add bridge', exact: true }).click();
  const source = card(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  await source.fill('2'); await card(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toBeVisible();
  await source.fill('0');
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await source.fill('2'); await card(page).getByRole('button', { name: 'Review amount', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(source).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await source.fill('0');
  await expectBlocked(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(source).toHaveValue('0'); await expectBlocked(page);
  expect(await readWorkflow(page)).toBeNull();
});


test('a new isolated Bridge cannot replace an already-configured workflow through amount acceptance', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '2');
  const original = await readWorkflow(page);
  await page.getByRole('button', { name: 'Add bridge', exact: true }).click();
  await expect(card(page)).toHaveCount(2);
  const bridge = card(page).last();
  await bridge.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill('3');
  await bridge.getByRole('button', { name: 'Review amount', exact: true }).click();
  await expect(bridge.getByRole('alert')).toContainText('use a separate workflow');
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toBeDisabled();
  await expectBlocked(page);
  expect(await readWorkflow(page)).toEqual(original);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card(page)).toHaveCount(1);
  await expect(card(page).getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeEnabled();
  expect(await readWorkflow(page)).toEqual(original);
});

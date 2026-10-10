// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { chooseSolanaWallet, signChains, signRequests } from './jupiter-fixtures';
import { devnetControl, installDevnetWallet, resetDevnetHarness } from './solana-devnet-fixtures';

// BUILD-015 on the MOCKED Devnet loopback only: these runs prove the UX and fail-closed paths, never DEVNET_EXECUTED.
const panel = (page: Page) => page.getByRole('region', { name: 'Solana Devnet liquidity' });
test.afterEach(async ({ page }, info) => { if (info.status !== info.expectedStatus) console.error('Liquidity failure:', await panel(page).locator('pre').textContent().catch(() => 'no panel')); });
async function authorCanvas(page: Page) {
  await page.goto('/app');
  await page.getByText('Advanced action setup').click();
  await page.locator('#liquidity-network').selectOption('SOLANA_DEVNET');
  const form = page.getByRole('form', { name: 'Create Solana Devnet liquidity position' });
  await form.getByLabel('Maximum SOL').fill('0.01'); await form.getByLabel('Maximum devUSDC').fill('0.30');
  await form.getByRole('button', { name: 'Use ±10% around the current Devnet price' }).click();
  await expect(form.getByLabel('Lower bound')).not.toHaveValue('');
  await form.getByRole('button', { name: 'Review position proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
async function authorChat(page: Page) {
  await page.goto('/app');
  await page.locator('#mock-prompt').fill('Add liquidity 0.01 SOL and 0.30 devUSDC ticks -39104 to -36992 on Solana Devnet');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
async function simulateAndReview(page: Page, connect = true) {
  await page.getByRole('button', { name: 'Simulate workflow' }).click();
  if (connect) await chooseSolanaWallet(panel(page));
  await expect(panel(page)).toContainText('Wallet connected · Solana Devnet');
  await panel(page).getByRole('button', { name: 'Simulate position' }).click();
  await expect(panel(page).getByRole('term').filter({ hasText: /^Expected contribution$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Accept liquidity review' }).click();
}
async function step(page: Page, operation: string, execute: string) {
  await page.getByRole('button', { name: 'Back to simulation' }).click();
  await panel(page).locator('#orca-operation').selectOption(operation);
  await panel(page).getByRole('button', { name: 'Simulate removal' }).click();
  await expect(panel(page).getByRole('term').filter({ hasText: /^Expected principal returned$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Accept liquidity review' }).click();
  await panel(page).getByRole('button', { name: execute }).click();
  await expect(panel(page).getByRole('region', { name: 'Liquidity result' }).getByRole('heading', { name: 'Success' })).toBeVisible();
}

test('canvas liquidity on Solana Devnet → Simulate → Review → Execute → Result, then partial removal and exit, each with its own wallet signature', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const wallet = await resetDevnetHarness({ accrueFees: { a: '1000', b: '20' } }); await installDevnetWallet(page, wallet);
  await authorCanvas(page);
  const card = page.locator('.react-flow__node[data-id="node-002"]');
  await expect(card).toContainText('SOL/devUSDC position'); await expect(card).toContainText('SOLANA DEVNET · ORCA');
  await page.getByRole('button', { name: 'Simulate workflow' }).click();
  await chooseSolanaWallet(panel(page));
  await panel(page).getByRole('button', { name: 'Simulate position' }).click();
  for (const term of ['Network', 'Provider', 'Pool', 'Token mints', 'Pool price', 'Range', 'Maximum inputs', 'Expected contribution', 'Expected liquidity', 'Slippage bounds',
    'Expected residual', 'Owner balances', 'Token accounts', 'Position', 'Accounts that may be created', 'Estimated network fee', 'Account deposits', 'Programs', 'Review freshness'])
    await expect(panel(page).getByRole('term').filter({ hasText: new RegExp(`^${term}$`) })).toBeVisible();
  await expect(panel(page)).toContainText('aligned ticks -39104 to -36992 · in range');
  await expect(panel(page)).toContainText('test tokens only');
  expect(await devnetControl({ action: 'sent' })).toBe(0); expect(await signRequests(page)).toBe(0);
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Accept liquidity review' }).click();
  await expect(panel(page)).toContainText('one-time position-mint key created in this browser');
  await panel(page).getByRole('button', { name: 'Execute position' }).click();
  const result = panel(page).getByRole('region', { name: 'Liquidity result' });
  await expect(result.getByRole('heading', { name: 'Success' })).toBeVisible();
  await expect(result).toContainText('Position opened and independently reconciled. Deposited 0.01 Devnet SOL');
  await expect(result.getByRole('link', { name: 'View on Solana Explorer (Devnet)' })).toHaveAttribute('href', /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{64,88}\?cluster=devnet$/);
  await expect(result).toContainText('Evidence: MOCKED');
  const href = await result.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!)) as { bundle: { environment: string }; evidenceClass: string; publicExecution: { operation: string; realFunds: boolean } };
  expect(evidence).toMatchObject({ bundle: { environment: 'MOCKED' }, evidenceClass: 'MOCKED', publicExecution: { operation: 'OPEN', realFunds: false } });
  expect(await signRequests(page)).toBe(1); expect(await signChains(page)).toEqual(['solana:devnet']); expect(await devnetControl({ action: 'sent' })).toBe(1);
  await expect(panel(page).getByRole('region', { name: 'Your Flofi positions' })).toContainText('active');
  await step(page, 'DECREASE_PARTIAL', 'Execute removal');
  await expect(panel(page).getByRole('region', { name: 'Liquidity result' })).toContainText('fees collected 0.000001 Devnet SOL and 0.00002 devUSDC');
  await step(page, 'EXIT', 'Execute removal');
  await expect(panel(page).getByRole('region', { name: 'Liquidity result' })).toContainText('position closed');
  await expect(panel(page).getByRole('region', { name: 'Your Flofi positions' })).toContainText('closed');
  expect(await signRequests(page)).toBe(3); expect(await devnetControl({ action: 'sent' })).toBe(3);
  expect(errors).toEqual([]);
});
test('chat authors the same canonical position and simulates read-only without any wallet request', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet);
  await authorChat(page);
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('devUSDC/SOL · Solana Devnet');
  await page.getByRole('button', { name: 'Simulate workflow' }).click();
  await chooseSolanaWallet(panel(page));
  await panel(page).getByRole('button', { name: 'Simulate position' }).click();
  await expect(panel(page).getByRole('term').filter({ hasText: /^Expected contribution$/ })).toBeVisible();
  expect(await signRequests(page)).toBe(0); expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('a wallet rejection is a pre-submission failure and nothing is sent', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet, { reject: true });
  await authorChat(page); await simulateAndReview(page);
  await panel(page).getByRole('button', { name: 'Execute position' }).click();
  await expect(panel(page).getByRole('status').filter({ hasText: 'You declined' })).toContainText('No transaction was sent.');
  await expect(panel(page)).toContainText('Transaction: not submitted');
  expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('bytes changed by the wallet are never broadcast and the position key never signs them', async ({ page }) => {
  const wallet = await resetDevnetHarness();
  await installDevnetWallet(page, wallet, { modify: 'AQ' + 'A'.repeat(86) });
  await authorChat(page); await simulateAndReview(page);
  await panel(page).getByRole('button', { name: 'Execute position' }).click();
  await expect(panel(page).getByRole('status').filter({ hasText: 'different transaction' })).toBeVisible();
  expect(await devnetControl({ action: 'sent' })).toBe(0);
});
test('after a reload the one-time position key is gone: Execute is refused before any wallet request or broadcast', async ({ page }) => {
  const wallet = await resetDevnetHarness(); await installDevnetWallet(page, wallet);
  await authorChat(page); await simulateAndReview(page);
  await page.reload();
  await page.getByRole('button', { name: 'Simulate workflow' }).click();
  await expect(panel(page)).toBeVisible();
  await chooseSolanaWallet(panel(page));
  await page.getByRole('button', { name: 'Review position', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Execute position' }).click();
  await expect(panel(page).getByRole('status').filter({ hasText: 'one-time position key' })).toBeVisible();
  expect(await signRequests(page)).toBe(0); expect(await devnetControl({ action: 'sent' })).toBe(0);
});

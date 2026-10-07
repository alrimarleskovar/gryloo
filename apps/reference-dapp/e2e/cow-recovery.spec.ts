// SPDX-License-Identifier: AGPL-3.0-only
import { cowPanel, expect, prepareCow, stage, test } from './cow-fixtures';
import { openProposalReview } from './fixtures';

test.skip(process.env.GRYLOO_COW !== 'loopback', 'CoW browser acceptance requires the isolated loopback orderbook');

test('ambiguous post survives browser restart and lookup never posts a second order', async ({ page, cowWallet }) => {
  await page.goto('/');
  await prepareCow(page, 'ambiguous');
  await stage(page, 'Execute');
  let execution = cowPanel(page, 'execution');
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('POST_RESULT_UNKNOWN');
  await page.reload();
  await stage(page, 'Execute');
  execution = cowPanel(page, 'execution');
  await expect(execution).toContainText('Recovered from the local execution journal');
  await expect(execution.locator('[data-cow-state]')).toHaveText('POST_RESULT_UNKNOWN');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('OPEN');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('RECONCILIATION_REQUIRED');
  await execution.getByRole('button', { name: 'Reconcile scripted settlement' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('RECONCILED');
  await expect(execution).toContainText('Posting attempts: 1');
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(1);
});

test('expiry is explicit and never shown as settlement', async ({ page, cowWallet }) => {
  expect(cowWallet.owner).toMatch(/^0x[0-9a-f]{40}$/);
  await page.goto('/');
  await prepareCow(page, 'expire');
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('EXPIRED');
  await expect(execution.getByRole('article', { name: 'CoW evidence' })).toHaveCount(0);
});

test('failed post with no order remains unknown and cannot be retried by the UI', async ({ page, cowWallet }) => {
  expect(cowWallet.owner).toMatch(/^0x[0-9a-f]{40}$/);
  await page.goto('/');
  await prepareCow(page, 'failure');
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('POST_RESULT_UNKNOWN');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('POST_RESULT_UNKNOWN');
  await expect(execution).toContainText('Posting attempts: 1');
  await expect(execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' })).toHaveCount(0);
});

test('semantic edit invalidates a prepared order before wallet signing', async ({ page, cowWallet }) => {
  await page.goto('/');
  await prepareCow(page, 'hold');
  await stage(page, 'Build');
  await page.getByLabel('Describe your flow').fill('set node-002 slippage 50 bps');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  await expect(execution.getByRole('alert')).toContainText('semantic workflow changed');
  await expect(execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' })).toBeDisabled();
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(0);
});

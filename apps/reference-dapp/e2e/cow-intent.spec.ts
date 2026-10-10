// SPDX-License-Identifier: AGPL-3.0-only
import { authorCowSwap, cowPanel, expect, openTechnicalDetails, prepareCow, stage, test } from './cow-fixtures';

test.skip(process.env.GRYLOO_COW !== 'loopback', 'CoW browser acceptance requires the isolated loopback orderbook');

test('user reviews exact CoW order, signs with a disposable injected wallet and reconciles MOCKED settlement', async ({ page, cowWallet }) => {
  await page.goto('/__engineering');
  await prepareCow(page, 'fill');
  const simulation = cowPanel(page, 'simulation');
  await expect(simulation).toContainText('Gnosis Protocol v2 · chain 8453');
  await expect(simulation).toContainText('MOCKED orderbook and settlement');
  await expect(simulation.locator('[data-cow-uid]')).toHaveText(/^0x[0-9a-f]{112}$/);
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(0);
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(0);
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('POSTED');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('OPEN');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('RECONCILIATION_REQUIRED');
  await execution.getByRole('button', { name: 'Reconcile scripted settlement' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('RECONCILED');
  await expect(execution.locator('[data-cow-evidence]')).toHaveText(/^0x[0-9a-f]{64}$/);
  await expect(execution.getByRole('article', { name: 'CoW evidence' })).toContainText('Scripted receipt, trade and balance observations only');
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(1);
  expect(cowWallet.calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  await expect(page.locator('body')).not.toContainText('MAINNET_EXECUTED');
});

test('user signs a separate cancellation and sees confirmation after orderbook lookup', async ({ page, cowWallet }) => {
  await page.goto('/__engineering');
  await prepareCow(page, 'hold');
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('OPEN');
  await execution.getByRole('button', { name: 'Sign supported cancellation' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('CANCEL_REQUESTED');
  await execution.getByRole('button', { name: 'Check order UID and status' }).click();
  await expect(execution.locator('[data-cow-state]')).toHaveText('CANCELLED');
  expect(cowWallet.calls.filter(call => call.method === 'eth_signTypedData_v4')).toHaveLength(2);
});

test('wrong-chain disposable wallet is refused before quote or signing', async ({ page, cowWallet }) => {
  cowWallet.chain = '0x7a69';
  await page.goto('/__engineering');
  await authorCowSwap(page);
  await stage(page, 'Simulate');
  await openTechnicalDetails(page);
  const panel = cowPanel(page, 'simulation');
  await panel.getByRole('button', { name: 'Connect disposable local wallet' }).click();
  await expect(panel.getByRole('alert')).toContainText('COW_WALLET_CHAIN_MISMATCH');
  await expect(panel.getByRole('button', { name: /Prepare CoW quote/ })).toBeDisabled();
  expect(cowWallet.calls.some(call => call.method === 'eth_signTypedData_v4')).toBe(false);
});

test('CoW option is keyboard reachable and review fits a narrow viewport', async ({ page, cowWallet }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/__engineering');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const choice = page.getByLabel('Enable CoW signed intent for this swap');
  await expect(choice).toBeVisible();
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  await authorCowSwap(page);
  await stage(page, 'Simulate');
  await openTechnicalDetails(page);
  const simulation = cowPanel(page, 'simulation');
  await simulation.getByRole('button', { name: 'Connect disposable local wallet' }).click();
  await expect(simulation.locator('.wallet-chip')).toContainText(cowWallet.owner.slice(0, 10));
  await simulation.getByRole('button', { name: /Prepare CoW quote/ }).click();
  await expect(simulation.getByRole('article', { name: 'CoW Manifest review' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('account change after review blocks the signature request', async ({ page, cowWallet }) => {
  await page.goto('/__engineering');
  await prepareCow(page, 'hold');
  cowWallet.account = '0x' + '9'.repeat(40);
  await stage(page, 'Execute');
  const execution = cowPanel(page, 'execution');
  await execution.getByRole('button', { name: 'Sign exact order and post to local orderbook' }).click();
  await expect(execution.getByRole('alert')).toContainText('COW_WALLET_ACCOUNT_MISMATCH');
  expect(cowWallet.calls.some(call => call.method === 'eth_signTypedData_v4')).toBe(false);
  await expect(execution.locator('[data-cow-state]')).toHaveText('REVIEWED');
});

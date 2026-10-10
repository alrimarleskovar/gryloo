// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001: the native test-ETH self-transfer on Ethereum Sepolia through the injected wallet, on the MOCKED
 * loopback harness (`/ethereum-sepolia` chain). The reviewed chain is 0xaa36a7; a wallet on Ethereum Mainnet is stopped
 * before any request, and the only switch offered is to Ethereum Sepolia.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { chainBroadcasts, installTransferWallet, resetTransferHarness, sendRequests, TRANSFER_OWNER as owner, type TransferWalletOptions } from './robinhood-transfer-fixtures';

const ROUTE = '/ethereum-sepolia' as const;
const region = (page: Page) => page.getByRole('region', { name: 'Ethereum Sepolia transfer' });
async function author(page: Page, options: TransferWalletOptions = {}) {
  await installTransferWallet(page, { chain: '0xaa36a7', route: ROUTE, ...options }); await page.goto('/__engineering');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create Robinhood transfer' });
  await form.getByLabel('Transfer network').selectOption('Ethereum Sepolia');
  await form.getByLabel('Transfer amount (test ETH)').fill('0.000001');
  await form.getByRole('button', { name: 'Review transfer proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('button', { name: 'Continue to Simulate' }).click();
  await page.getByRole('button', { name: 'Simulate transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Accept transfer review' }).click();
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toBeVisible();
}
test.beforeEach(async () => { await resetTransferHarness({}, ROUTE); });

test('Ethereum Sepolia self-transfer: one exact request on 0xaa36a7, reconciled after L1 confirmations', async ({ page, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await author(page);
  await expect(region(page)).toContainText('chain ID 11155111 (eip155:11155111)');
  expect(await chainBroadcasts(ROUTE)).toBe(0);
  await region(page).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  const sent = await sendRequests(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ from: owner, to: owner, value: '0xe8d4a51000', data: '0x', chainId: '0xaa36a7' });
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(await chainBroadcasts(ROUTE)).toBe(1);
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});

test('a wallet on Ethereum Mainnet is stopped before any request and offered only Ethereum Sepolia', async ({ page }) => {
  await author(page, { chain: '0x1' });
  await region(page).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(region(page)).toContainText('Switch your wallet to Ethereum Sepolia');
  expect(await sendRequests(page)).toEqual([]);
  expect(await chainBroadcasts(ROUTE)).toBe(0);
  await region(page).getByRole('button', { name: 'Switch to Ethereum Sepolia' }).click();
  const switched = await page.evaluate(() => (window as unknown as { transferWalletRequests: { method: string; params?: unknown[] }[] }).transferWalletRequests
    .filter(r => r.method === 'wallet_switchEthereumChain' || r.method === 'wallet_addEthereumChain').map(r => [r.method, r.params?.[0]]));
  expect(switched).toEqual([['wallet_switchEthereumChain', { chainId: '0xaa36a7' }]]);
  expect(await sendRequests(page)).toEqual([]);
});

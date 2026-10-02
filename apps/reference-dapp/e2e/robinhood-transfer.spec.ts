// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { installTransferWallet, resetTransferHarness, chainBroadcasts, sendRequests, TRANSFER_OWNER as owner, type TransferWalletOptions } from './robinhood-transfer-fixtures';

const region = (page: Page) => page.getByRole('region', { name: 'Robinhood Testnet transfer' });
const stage = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
async function author(page: Page, options: TransferWalletOptions = {}) {
  await installTransferWallet(page, options); await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create Robinhood transfer' });
  await form.getByLabel('Transfer amount (test ETH)').fill('0.000001');
  await form.getByRole('button', { name: 'Review transfer proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('Self-transfer test ETH');
  await page.getByRole('button', { name: 'Continue to Simulate' }).click();
  await page.getByRole('button', { name: 'Simulate transfer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review transfer', exact: true })).toBeEnabled();
}
async function review(page: Page) {
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByRole('button', { name: 'Accept transfer review' }).click();
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toBeVisible();
}
const execute = (page: Page) => region(page).getByRole('button', { name: 'Execute', exact: true }).click();
test.beforeEach(async () => { await resetTransferHarness(); });

test('Build → read-only Simulate → owner Review → one exact self-transfer → reconciled Result', async ({ page, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await author(page);
  for (const text of ['Robinhood Chain Testnet · chain ID 46630 (eip155:46630)', `Owner${owner}`, 'Exact value0.000001 ETH (1000000000000 wei)', 'Calldata0x',
    'Current balance0.01 ETH', 'Expected balance after0.00999976132 ETH', 'Gas estimate23868 gas (limit 35802)', 'Expected network cost0.00000023868 ETH',
    'Maximum fee budget0.00000071604 ETH', 'Nonce7', 'Reviewed stateblock 1000', 'Review expires']) await expect(region(page)).toContainText(text);
  expect(await chainBroadcasts()).toBe(0);
  await review(page);
  await expect(region(page)).toContainText('Evidence state: READY_FOR_OWNER_EXECUTION');
  if (process.env.RH_DEMO_SCREENSHOTS) await page.screenshot({ path: process.env.RH_DEMO_SCREENSHOTS + '/review.png', fullPage: true });
  expect(await chainBroadcasts()).toBe(0);
  await execute(page);
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  await expect(region(page)).toContainText('Evidence state: MOCKED / RECONCILED');
  await expect(region(page)).toContainText('nonce 7 → 8');
  if (process.env.RH_DEMO_SCREENSHOTS) await page.screenshot({ path: process.env.RH_DEMO_SCREENSHOTS + '/result.png', fullPage: true });
  expect(await chainBroadcasts()).toBe(1);
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(evidence.publicExecution).toMatchObject({ account: owner, recipient: owner, value: '1000000000000', submissions: 1, fee: '238680000000' });
  const sent = await sendRequests(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({ from: owner, to: owner, value: '0xe8d4a51000', data: '0x', chainId: '0xb626', gas: '0x8bda', maxFeePerGas: '0x1312d00', maxPriorityFeePerGas: '0x0' });
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});
test('a lost wallet response is recovered after refresh by observation, with no second submission', async ({ page }) => {
  await author(page, { uncertain: true }); await review(page); await execute(page);
  await expect(region(page)).toContainText('The wallet result is uncertain. Flofi will not submit again');
  await expect(region(page).getByRole('button', { name: 'Observe existing transaction' })).toBeVisible();
  expect(await chainBroadcasts()).toBe(1);
  await page.reload(); await stage(page, 'Execute');
  await region(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(page.getByRole('link', { name: 'Download Evidence Bundle' })).toBeVisible();
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
  expect(await chainBroadcasts()).toBe(1);
});
test('an unknown result that never reached the chain stays observation-only across refresh', async ({ page }) => {
  await author(page, { notBroadcast: true }); await review(page); await execute(page);
  await expect(region(page)).toContainText('The wallet result is uncertain. Flofi will not submit again');
  await page.reload(); await stage(page, 'Execute');
  await region(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(region(page)).toContainText('Flofi will not submit again');
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
  await expect(region(page).getByRole('button', { name: 'Prepare fresh review' })).toHaveCount(0);
  expect(await chainBroadcasts()).toBe(0);
});
test('a wallet refusal is not submitted and needs a fresh explicit Review', async ({ page }) => {
  await author(page, { reject: true }); await review(page); await execute(page);
  await expect(region(page)).toContainText('not submitted');
  await region(page).getByRole('button', { name: 'Prepare fresh review' }).click();
  await expect(region(page).getByRole('button', { name: 'Accept transfer review' })).toBeVisible();
  expect(await chainBroadcasts()).toBe(0);
});
test('the wrong wallet chain blocks handoff and offers a switch to Robinhood Chain Testnet', async ({ page }) => {
  await author(page, { chain: '0x14a34' }); await review(page);
  await execute(page);
  await expect(region(page)).toContainText('Switch your wallet to Robinhood Chain Testnet');
  expect(await chainBroadcasts()).toBe(0);
  await region(page).getByRole('button', { name: 'Switch to Robinhood Chain Testnet' }).click();
  await expect(page.getByText('Wallet: ' + owner.slice(0, 6) + '…' + owner.slice(-4) + ' · Robinhood Chain Testnet (46630)')).toBeVisible();
  const switched = await page.evaluate(() => (window as unknown as { transferWalletRequests: { method: string; params?: unknown[] }[] }).transferWalletRequests
    .filter(r => r.method === 'wallet_switchEthereumChain').map(r => r.params?.[0]));
  expect(switched).toEqual([{ chainId: '0xb626' }]);
});
test('a different wallet account blocks handoff', async ({ page }) => {
  await author(page); await review(page);
  await page.evaluate(() => { const w = window as unknown as { ethereum: { request: (i: { method: string }) => Promise<unknown> } }; const original = w.ethereum.request;
    w.ethereum.request = async i => i.method === 'eth_accounts' ? ['0x2222222222222222222222222222222222222222'] : original(i); });
  await execute(page);
  await expect(region(page)).toContainText('Select the owner wallet');
  expect(await chainBroadcasts()).toBe(0);
});
test('a semantic edit removes transfer authority', async ({ page }) => {
  await author(page); await review(page);
  await stage(page, 'Build');
  await page.locator('.react-flow__node[data-id="node-002"] .flow-card').click();
  const form = page.getByRole('form', { name: 'Edit Robinhood transfer' });
  await form.getByLabel('Transfer amount (test ETH)').fill('0.000002');
  await form.getByRole('button', { name: 'Review transfer change' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await stage(page, 'Execute');
  await expect(region(page)).toContainText('The workflow changed');
  await expect(region(page).getByRole('button', { name: 'Execute', exact: true })).toHaveCount(0);
  expect(await chainBroadcasts()).toBe(0);
});

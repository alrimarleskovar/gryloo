// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-UNISWAP-LIQUIDITY-PUBLIC browser journey on the MOCKED loopback Base Sepolia chain (never public, never a broadcast). */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { installUniswapWallet, resetUniswapHarness, sendRequests, walletSends, UNI_E2E_OWNER as owner, type UniswapWalletOptions } from './uniswap-liquidity-fixtures';

const POOL = '0x94bfc0574ff48e92ce43d495376c477b1d0eeec0', NPM = '0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2';
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e', WETH = '0x4200000000000000000000000000000000000006';
const region = (page: Page) => page.getByRole('region', { name: 'Base Sepolia liquidity' });
const stage = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
const transactions = (page: Page) => region(page).getByRole('list', { name: 'Liquidity transactions' });
async function author(page: Page, options: UniswapWalletOptions = {}) {
  await installUniswapWallet(page, options); await page.goto('/');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.locator('#liquidity-network').selectOption('BASE_SEPOLIA');
  const form = page.getByRole('form', { name: 'Create Base Sepolia liquidity position' });
  await form.getByLabel('Maximum USDC').fill('10');
  await form.getByLabel('Maximum WETH').fill('0.005');
  await form.getByRole('button', { name: 'Use ±10% around the current Base Sepolia price' }).click();
  await expect(form.getByRole('status')).toContainText('±10% around');
  await form.getByRole('button', { name: 'Review position proposal' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('USDC/WETH v3 position');
  await page.getByRole('button', { name: 'Simular Fees' }).click();
  await region(page).getByRole('button', { name: 'Simulate position', exact: true }).click();
  await expect(region(page).getByRole('definition').filter({ hasText: 'exact ticks' })).toBeVisible();
}
async function accept(page: Page) {
  await stage(page, 'Execute');
  await region(page).getByRole('button', { name: 'Accept liquidity review' }).click();
}
const execute = (page: Page, label: string) => region(page).getByRole('button', { name: `Execute: ${label}` }).click();
test.beforeEach(async () => { await resetUniswapHarness(); });

test('Build → public-style Simulate → Review → exact approvals → owner-recipient mint → reconciled position and Evidence Bundle', async ({ page, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await author(page);
  for (const text of ['Base Sepolia (chain 84532)', POOL, `token0 USDC ${USDC}`, `token1 WETH ${WETH}`, 'fee 0.05%', 'tick spacing 10', 'in range',
    'exactly 10 USDC to the Position Manager', 'exactly 0.005 WETH to the Position Manager', NPM, `${owner} (your wallet)`, '(100 bps)',
    'Approve USDC (exact amount) → Approve WETH (exact amount) → Mint the position NFT', 'eth_simulateV1']) await expect(region(page)).toContainText(text);
  expect(await walletSends()).toBe(0);
  await accept(page);
  await execute(page, 'Approve USDC (exact amount)');
  await expect(transactions(page)).toContainText('Approve USDC (exact amount): confirmed');
  await execute(page, 'Approve WETH (exact amount)');
  await expect(transactions(page)).toContainText('Approve WETH (exact amount): confirmed');
  await execute(page, 'Mint the position NFT');
  await expect(region(page).getByRole('region', { name: 'Liquidity result' })).toContainText(`is owned by your wallet ${owner}`);
  await expect(region(page)).toContainText('Evidence: MOCKED');
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(evidence.transactions.map((t: { step: string }) => t.step)).toEqual(['APPROVE_TOKEN0', 'APPROVE_TOKEN1', 'MINT']);
  const sent = await sendRequests(page);
  expect(sent.map(t => [t.to, t.data?.slice(0, 10), t.chainId, t.from, t.value])).toEqual([[USDC, '0x095ea7b3', '0x14a34', owner, '0x0'],
    [WETH, '0x095ea7b3', '0x14a34', owner, '0x0'], [NPM, '0x88316456', '0x14a34', owner, '0x0']]);
  expect(await walletSends()).toBe(3);
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});
test('a page reload between approval and mint loses nothing and never resends', async ({ page }) => {
  await author(page); await accept(page);
  await execute(page, 'Approve USDC (exact amount)');
  await expect(transactions(page)).toContainText('Approve USDC (exact amount): confirmed');
  await page.reload(); await stage(page, 'Execute');
  await expect(region(page)).toContainText('Recovered run');
  await expect(transactions(page)).toContainText('Approve USDC (exact amount): confirmed');
  expect(await walletSends()).toBe(1);
  await execute(page, 'Approve WETH (exact amount)');
  await expect(transactions(page)).toContainText('Approve WETH (exact amount): confirmed');
  await execute(page, 'Mint the position NFT');
  await expect(region(page).getByRole('region', { name: 'Liquidity result' })).toBeVisible();
  expect(await walletSends()).toBe(3);
});
test('a wallet refusal is not sent and needs a refreshed simulation and a new Review; a lost response is observed, not resent', async ({ page }) => {
  await author(page, { rejectStep: 1, uncertainStep: 2 }); await accept(page);
  await execute(page, 'Approve USDC (exact amount)');
  await expect(region(page)).toContainText('You declined the request in your wallet. Nothing was sent.');
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  expect(await walletSends()).toBe(0);
  await region(page).getByRole('button', { name: 'Refresh simulation for the next step' }).click();
  await region(page).getByRole('button', { name: 'Accept liquidity review' }).click();
  await execute(page, 'Approve USDC (exact amount)');
  // The response was lost after the wallet sent it: Flofi only observes, and finds the transaction by nonce.
  await expect(region(page)).toContainText('The wallet result is unknown. Flofi is observing the network and will not send another request.');
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  await region(page).getByRole('button', { name: 'Observe existing transaction' }).click();
  await expect(transactions(page)).toContainText('Approve USDC (exact amount): confirmed');
  expect(await walletSends()).toBe(1);
});
test('MetaMask relayed type-2 depth-1 redemptions (as observed on Base Sepolia) reconcile approvals and the mint', async ({ page }) => {
  await resetUniswapHarness({ delegatedOwner: true });
  await author(page, { delegated: true }); await accept(page);
  await execute(page, 'Approve USDC (exact amount)');
  await expect(transactions(page)).toContainText('Approve USDC (exact amount): confirmed');
  await execute(page, 'Approve WETH (exact amount)');
  await expect(transactions(page)).toContainText('Approve WETH (exact amount): confirmed');
  await execute(page, 'Mint the position NFT');
  await expect(region(page).getByRole('region', { name: 'Liquidity result' })).toContainText(`is owned by your wallet ${owner}`);
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.transactions.map((t: { submissionKind: string }) => t.submissionKind)).toEqual(['DELEGATED_SINGLE', 'DELEGATED_SINGLE', 'DELEGATED_SINGLE']);
  expect(await walletSends()).toBe(3);
});

// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ROUTER-001 browser journey on MOCKED loopback Base/Arbitrum chains and providers (never public, never a broadcast). */
import { test, expect, openProposalReview, openSimulationDetails, acceptProductReview } from './fixtures';
import type { Page } from '@playwright/test';
import { installRouterWallet, resetRouterHarness, routerControl, routerSendRequests, routerWalletSends } from './router-fixtures';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae';
const region = (page: Page) => page.getByRole('region', { name: 'Cross-chain bridge' });
const stage = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
const transactions = (page: Page) => region(page).getByRole('list', { name: 'Base transactions' });
async function authorByChat(page: Page, text = 'Bridge 10 USDC from Base to Arbitrum', options: { rejectStep?: number } = {}) {
  await installRouterWallet(page, options); await page.goto('/app');
  await page.locator('#mock-prompt').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('BridgeRouter');
  await expect(page.locator('.react-flow__node[data-id="node-002"]').getByRole('button', { name: 'Configure source asset', exact: true })).toHaveAttribute('title', 'USDC on Base');
  await expect(page.locator('.react-flow__node[data-id="node-002"]').getByRole('button', { name: 'Configure destination asset', exact: true })).toHaveAttribute('title', 'USDC on Arbitrum');
  await page.getByRole('button', { name: 'Simulate fees' }).click(); await openSimulationDetails(page);
  await region(page).getByRole('button', { name: 'Get route and simulate' }).click();
  await expect(region(page).getByRole('list', { name: 'Route steps' })).toBeVisible();
}
async function accept(page: Page) { await acceptProductReview(page); }
const execute = (page: Page, label: RegExp) => region(page).getByRole('button', { name: label }).click();
async function bridgeToReconciled(page: Page) {
  for (let i = 0; i < 15 && !(await region(page).getByRole('region', { name: 'Bridge result' }).isVisible()); i++) {
    await routerControl('MOCK_advance', [10]);
    await region(page).getByRole('button', { name: 'Observe bridge' }).click();
    await expect(region(page).getByText('Working…')).toHaveCount(0);
  }
}
// BUILD-JOURNEY-001: each test is a fresh random wallet (signs in with a real signature; nothing is hard-coded).
let owner = '';
test.beforeEach(async () => { owner = await resetRouterHarness(); });

test('Guided Chat → route → simulation → Review → exact approval → deposit → in flight → destination fill → reconciled with evidence', async ({ page, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await authorByChat(page);
  for (const text of ['LI.FI · underlying protocol across', 'LI.FI fee collection on Base', 'Across bridge Base → Arbitrum One', 'Amount in10 USDC on Base',
    'Minimum received', 'LI.FI fee: 0.025 USDC', `Exactly 10 USDC to ${DIAMOND} (never unlimited)`, `${owner} on Arbitrum One (your wallet)`, 'Quote expiry',
    'Network fees (Base)', 'Estimated duration']) await expect(region(page)).toContainText(text);
  await region(page).getByText('Sources: provider quote, transaction simulation, chain observation').click();
  for (const text of ['Provider quote (not a simulation)', 'eth_simulateV1 of the exact Base transactions', 'Not simulated: the destination fill', 'Across (direct): available',
    'Route commitment', 'fixed provider lifi:across']) await expect(region(page)).toContainText(text);
  expect(await routerWalletSends()).toBe(0);
  await accept(page);
  await execute(page, /^Execute: Approve exactly 10 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  await execute(page, /^Execute: Deposit into the bridge/);
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  await expect(region(page)).toContainText('confirmed on Base');
  await expect(region(page).getByRole('region', { name: 'Bridge result' })).toHaveCount(0);
  await bridgeToReconciled(page);
  await expect(region(page).getByRole('region', { name: 'Bridge result' })).toContainText(`arrived at ${owner} on Arbitrum One`);
  await expect(region(page)).toContainText('Evidence: MOCKED');
  const href = await page.getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(evidence.transactions.map((t: { step: string }) => t.step)).toEqual(['APPROVAL', 'DEPOSIT', 'FILL']);
  const sent = await routerSendRequests(page);
  expect(sent.map(t => [t.to, t.data?.slice(0, 10), t.chainId, t.from, t.value])).toEqual([[USDC, '0x095ea7b3', '0x2105', owner, '0x0'],
    [DIAMOND, '0x1794958f', '0x2105', owner, '0x0']]);
  expect(await routerWalletSends()).toBe(2);
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});
test('a page reload while the bridge is in flight recovers the run from the server and never resends', async ({ page }) => {
  await authorByChat(page, 'Bridge 2 USDC from Base to Arbitrum via Across'); await accept(page);
  await execute(page, /^Execute: Approve exactly 2 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  await execute(page, /^Execute: Deposit into the bridge/);
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  await page.reload(); await stage(page, 'Execute');
  await expect(region(page)).toContainText('Recovered run');
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  await bridgeToReconciled(page);
  await expect(region(page).getByRole('region', { name: 'Bridge result' })).toBeVisible();
  expect(await routerWalletSends()).toBe(2);
});
test('a route change after Review clears the authorization, sends nothing and needs a fresh route and a new Review', async ({ page }) => {
  await authorByChat(page); await accept(page);
  await routerControl('MOCK_feeBump', ['5000']);
  await execute(page, /^Execute: Approve exactly 10 USDC/);
  await expect(region(page)).toContainText('The provider no longer offers the reviewed route');
  await expect(region(page)).toContainText('Route changed: fees above the reviewed amount, lower minimum received');
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  await expect(region(page).getByRole('button', { name: 'Accept route review' })).toHaveCount(0);
  expect(await routerWalletSends()).toBe(0);
  await region(page).getByRole('button', { name: 'Get a fresh route and review' }).click();
  await region(page).getByRole('button', { name: 'Accept route review' }).click();
  await execute(page, /^Execute: Approve exactly 10 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  expect(await routerWalletSends()).toBe(1);
});
test('Canvas authoring with an explicit recipient and Across-only routing reaches the same Review path', async ({ page, networkGuard }) => {
  const recipient = '0x6666666666666666666666666666666666666666';
  await installRouterWallet(page); await page.goto('/app');
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByText('Cross-chain bridge · Base → Arbitrum (Router)', { exact: true }).click();
  const form = page.getByRole('form', { name: 'Create cross-chain bridge' });
  await form.getByLabel('Cross-chain amount (USDC)').fill('3');
  await form.getByLabel('Cross-chain recipient').fill(recipient);
  await form.getByLabel('Cross-chain routing policy').selectOption('ACROSS');
  await form.getByRole('button', { name: 'Review bridge proposal' }).click();
  await expect(page.locator('body')).toContainText(`Recipient on Arbitrum: ${recipient}`);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('BridgeRouter');
  await page.getByRole('button', { name: 'Simulate fees' }).click(); await openSimulationDetails(page);
  await region(page).getByRole('button', { name: 'Get route and simulate' }).click();
  for (const text of ['Across (direct) · underlying protocol across', `${recipient} on Arbitrum One`, 'Amount in3 USDC on Base',
    'Exactly 3 USDC to 0x09aea4b2242abc8bb4bb78d537a67a245a7bec64 (never unlimited)']) await expect(region(page)).toContainText(text);
  await expect(region(page)).not.toContainText('LI.FI fee');
  expect(await routerWalletSends()).toBe(0);
  networkGuard.assertClean();
});

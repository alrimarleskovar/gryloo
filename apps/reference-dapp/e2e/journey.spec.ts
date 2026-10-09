// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001 permissionless external-user journey on MOCKED loopback Base Sepolia / Arbitrum Sepolia chains and providers
 * (never a public network, never a broadcast). Every wallet is a fresh random test wallet that signs in with a real signature.
 */
import { test, expect, chooseWallet, openProposalReview, openSimulationDetails, acceptProductReview } from './fixtures';
import type { Page } from '@playwright/test';
import { createTestWallet, type TestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { BASE_SEPOLIA_HEX, guardedContext, installJourneyWallet, journeyAdvance, journeySends, resetJourneyHarness, setWalletChain, switchAccount,
  walletRequests } from './journey-fixtures';

const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e', DIAMOND = '0x816fc6eee47e3157a666827a0c06205294c81770';
const POINTER = 'flofi:crosschain-router-testnet:run';
const card = (page: Page) => page.getByRole('region', { name: 'Testnet journey' });
const region = (page: Page) => page.getByRole('region', { name: 'Cross-chain bridge' });
const stage = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
const transactions = (page: Page) => region(page).getByRole('list', { name: 'Base Sepolia transactions' });
async function signIn(scope: ReturnType<typeof card>) {
  if (await scope.getByRole('button', { name: 'Connect wallet' }).isVisible()) {
    await scope.getByRole('button', { name: 'Connect wallet' }).click();
    await chooseWallet(scope.page(), 'Browser wallet');
  }
  await scope.getByRole('button', { name: 'Sign in with wallet' }).click();
  await expect(scope.getByRole('status', { name: 'Signed-in wallet' })).toBeVisible();
}
async function author(page: Page, text = 'Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia') {
  await page.locator('#mock-prompt').fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('BridgeRouter');
  await expect(page.locator('.react-flow__node[data-id="node-002"]').getByRole('button', { name: 'Configure source asset', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
  await expect(page.locator('.react-flow__node[data-id="node-002"]').getByRole('button', { name: 'Configure destination asset', exact: true })).toHaveAttribute('title', 'USDC on Arbitrum Sepolia');
}
async function simulateAndAccept(page: Page) {
  await page.getByRole('button', { name: 'Simulate fees' }).click(); await openSimulationDetails(page);
  await region(page).getByRole('button', { name: 'Get route and simulate' }).click();
  await expect(region(page).getByRole('list', { name: 'Route steps' })).toBeVisible();
  await acceptProductReview(page);
}
const execute = (page: Page, label: RegExp) => region(page).getByRole('button', { name: label }).click();
async function toReconciled(page: Page) {
  for (let i = 0; i < 15 && !(await region(page).getByRole('region', { name: 'Bridge result' }).isVisible()); i++) {
    await journeyAdvance(10);
    await region(page).getByRole('button', { name: 'Observe bridge' }).click();
    await expect(region(page).getByText('Working…')).toHaveCount(0);
  }
}
async function runId(page: Page): Promise<string> {
  const pointer = await page.evaluate(key => window.localStorage.getItem(key), POINTER);
  return (JSON.parse(pointer!) as { id: string }).id;
}
let A: TestWallet, B: TestWallet;
test.beforeEach(async () => { A = createTestWallet(); B = createTestWallet(); await resetJourneyHarness([A, B]); });

test('a fresh external wallet: connect → sign in → create → simulate → review + Manifest → sign → execute → reload → reconcile → evidence', async ({ page, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await installJourneyWallet(page, [A]); await page.goto('/app');
  await expect(card(page)).toContainText('Bridge test USDC from Base Sepolia to Arbitrum Sepolia with your own wallet');
  // The injected wallet answers eth_accounts passively (like a previously connected extension); nothing else is done yet.
  await expect(card(page).getByRole('list', { name: 'Journey steps' }).locator('li[data-done="true"]')).toHaveText(['✓ Connect your wallet']);
  await signIn(card(page));
  await expect(card(page)).toContainText(`Signed in as ${A.address.slice(0, 6)}…${A.address.slice(-4)}`);
  await expect(card(page).getByRole('region', { name: 'Your runs' })).toContainText('No runs yet for this wallet.');
  expect(await walletRequests(page)).toContain('personal_sign');
  await author(page);
  await page.getByRole('button', { name: 'Simulate fees' }).click(); await openSimulationDetails(page);
  await region(page).getByRole('button', { name: 'Get route and simulate' }).click();
  for (const text of ['Test USDC on public testnets: Base Sepolia and Arbitrum Sepolia. No real funds.', 'LI.FI · underlying protocol across',
    'Across bridge Base Sepolia → Arbitrum Sepolia', 'Amount in1 USDC on Base Sepolia', `Exactly 1 USDC to ${DIAMOND} (never unlimited)`,
    `${A.address} on Arbitrum Sepolia (your wallet)`, 'Strategy Manifest', `Owner ${A.address}`]) await expect(region(page)).toContainText(text);
  expect(await journeySends()).toBe(0);
  await acceptProductReview(page);
  await execute(page, /^Execute: Approve exactly 1 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  await execute(page, /^Execute: Deposit into the bridge/);
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  // The only wallet requests: the exact approval and the deposit, from A, on Base Sepolia (read before the reload resets the log).
  const sent = await page.evaluate(() => (window as unknown as { flofiJourneyWallet: { state: { requests: { method: string; params?: Record<string, string>[] }[] } } })
    .flofiJourneyWallet.state.requests.filter(r => r.method === 'eth_sendTransaction').map(r => r.params![0]!));
  expect(sent.map(t => [t.to, t.data?.slice(0, 10), t.chainId, t.from, t.value])).toEqual([[USDC, '0x095ea7b3', BASE_SEPOLIA_HEX, A.address, '0x0'],
    [DIAMOND, '0x1794958f', BASE_SEPOLIA_HEX, A.address, '0x0']]);
  // Refresh after submission: the run comes back from the server; nothing is resent.
  await page.reload(); await stage(page, 'Execute');
  await expect(region(page)).toContainText('Recovered run');
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  await toReconciled(page);
  await expect(region(page).getByRole('region', { name: 'Bridge result' })).toContainText(`arrived at ${A.address} on Arbitrum Sepolia`);
  await expect(region(page)).toContainText('Evidence: MOCKED');
  const href = await region(page).getByRole('link', { name: 'Download Evidence Bundle' }).getAttribute('href');
  const evidence = JSON.parse(decodeURIComponent(href!.split(',')[1]!));
  expect(evidence.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
  expect(evidence.transactions.map((t: { chain: string; step: string }) => [t.chain, t.step])).toEqual([['eip155:84532', 'APPROVAL'], ['eip155:84532', 'DEPOSIT'],
    ['eip155:421614', 'FILL']]);
  await expect(region(page).getByRole('list', { name: 'Journey steps' }).locator('li[data-done="true"]')).toHaveCount(8);
  expect(await journeySends()).toBe(2);
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  expect(errors).toEqual([]);
  networkGuard.assertClean();
});

test('wallet B in another browser cannot see or resume wallet A’s run, even with its id; wallet A recovers it from any browser', async ({ page, browser }) => {
  await installJourneyWallet(page, [A]); await page.goto('/app');
  await signIn(card(page));
  await author(page); await simulateAndAccept(page);
  await execute(page, /^Execute: Approve exactly 1 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  await execute(page, /^Execute: Deposit into the bridge/);
  await expect(transactions(page)).toContainText('Bridge deposit: confirmed');
  const id = await runId(page);

  // Another person, another browser, holding A's run id in a forged pointer: the server refuses everything.
  const other = await guardedContext(browser), pageB = await other.context.newPage();
  await pageB.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [POINTER, JSON.stringify({ id, owner: B.address })]);
  await installJourneyWallet(pageB, [B]); await pageB.goto('/app');
  await signIn(card(pageB));
  await expect(card(pageB).getByRole('region', { name: 'Your runs' })).toContainText('No runs yet for this wallet.');
  await expect(pageB.locator('body')).not.toContainText(id);
  await stage(pageB, 'Execute');
  await expect(pageB.getByRole('region', { name: 'Cross-chain bridge' })).toHaveCount(0);
  expect(other.unexpected).toEqual([]);
  await other.context.close();

  // Wallet A reconnects in a fresh browser with no local state: its run is listed by the server and resumes there.
  const fresh = await guardedContext(browser), pageA = await fresh.context.newPage();
  await installJourneyWallet(pageA, [A]); await pageA.goto('/app');
  await signIn(card(pageA));
  const runs = card(pageA).getByRole('region', { name: 'Your runs' });
  await expect(runs).toContainText(id);
  await runs.getByRole('button', { name: `Open ${id}` }).click();
  await stage(pageA, 'Execute');
  await expect(region(pageA)).toContainText(`Recovered run ${id}`);
  await toReconciled(pageA);
  await expect(region(pageA).getByRole('region', { name: 'Bridge result' })).toContainText(`arrived at ${A.address} on Arbitrum Sepolia`);
  expect(await journeySends()).toBe(2);
  expect(fresh.unexpected).toEqual([]);
  await fresh.context.close();
});

test('a chain switch blocks execution until the user switches back; an account switch after Review clears the authorization and signs the old account out', async ({ page }) => {
  await installJourneyWallet(page, [A, B]); await page.goto('/app');
  await signIn(card(page));
  await author(page); await simulateAndAccept(page);
  await expect(region(page).getByRole('button', { name: /^Execute: Approve/ })).toBeVisible();
  // Wallet on another chain: the reviewed action is unchanged, but nothing can be sent until the user switches back.
  await setWalletChain(page, '0x1');
  await expect(region(page).getByRole('button', { name: 'Switch to Base Sepolia' })).toBeVisible();
  await execute(page, /^Execute: Approve exactly 1 USDC/);
  await expect(region(page)).toContainText('Switch your wallet to Base Sepolia.');
  expect(await journeySends()).toBe(0);
  await region(page).getByRole('button', { name: 'Switch to Base Sepolia' }).click();
  await expect(region(page).getByRole('button', { name: 'Switch to Base Sepolia' })).toHaveCount(0);
  await expect(region(page).getByRole('button', { name: /^Execute: Approve/ })).toBeVisible();

  // Another account after Review: the authorization is cleared, A is signed out and its run disappears from view.
  await switchAccount(page, B.address);
  await expect(region(page)).toContainText('Your wallet switched accounts.');
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  await expect(region(page).getByRole('button', { name: 'Sign in with wallet' })).toBeVisible();
  await region(page).getByRole('button', { name: 'Sign in with wallet' }).click();
  await expect(region(page).getByRole('region', { name: 'Your runs' })).toContainText('No runs yet for this wallet.');
  expect(await journeySends()).toBe(0);

  // Back to A: a new sign-in recovers the run, which now needs a fresh Review before any wallet request.
  await switchAccount(page, A.address);
  await expect(region(page).getByRole('button', { name: 'Sign in with wallet' })).toBeVisible();
  await region(page).getByRole('button', { name: 'Sign in with wallet' }).click();
  await expect(region(page)).toContainText('The wallet account changed after Review. That authorization was cleared');
  await expect(region(page).getByRole('button', { name: /^Execute:/ })).toHaveCount(0);
  await region(page).getByRole('button', { name: 'Accept route review' }).click();
  await execute(page, /^Execute: Approve exactly 1 USDC/);
  await expect(transactions(page)).toContainText('Approval: confirmed');
  expect(await journeySends()).toBe(1);
});

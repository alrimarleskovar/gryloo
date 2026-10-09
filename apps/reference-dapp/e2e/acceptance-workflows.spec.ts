// SPDX-License-Identifier: AGPL-3.0-only
/** Integrated acceptance on disposable PostgreSQL and MOCKED loopback chains. No public broadcasts. */
import { test, expect, chooseWallet, openProposalReview, openSimulationDetails, readWorkflowIr } from './fixtures';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import { createRouterHarness } from './router-harness';
import type { Page } from '@playwright/test';
import { createDatabase, createLogger } from '@defi-workflow-engine/cloud-runtime';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBackend, type FlowResult } from '../backend/app';
import type { RouterBegin, RouterRecord } from '../src/server/router-service';
import { createTestWallet, type TestWallet } from '../../../packages/reference-reconciler/test/test-wallet';
import { installJourneyWallet, resetJourneyHarness, journeySends, switchAccount, walletRequests, setWalletChain } from './journey-fixtures';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
async function author(page: Page) {
  await page.locator('#mock-prompt').fill('Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page); await page.getByRole('button', { name: 'Apply proposal' }).click();

}
async function savedCanonical(owner: string) {
  if (!process.env.FLOFI_E2E_DATABASE_URL) throw Error('MOCK_DATABASE_REQUIRED');
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL, maxConnections: 1 });
  try { return (await db.query<{ semantic_workflow: SemanticWorkflow }>('SELECT semantic_workflow FROM saved_workflows WHERE owner_account=$1', [owner])).rows[0]!.semantic_workflow; }
  finally { await db.close(); }
}
async function libraryWorkspace(page: Page, language: 'EN' | 'PT' = 'EN') {
  const label = language === 'PT' ? 'Seus workflows' : 'Your workflows';
  await page.getByRole('button', { name: language === 'PT' ? 'Abrir navegação' : 'Open navigation' }).click();
  const sidebar = page.getByRole('complementary', { name: language === 'PT' ? 'Navegação FloFi' : 'FloFi navigation' });
  await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeVisible();
  for (const text of ['Refresh', 'Loading', 'temporarily unavailable', 'Save workflow', 'No workflows yet.', 'Ainda não há workflows.']) await expect(sidebar).not.toContainText(text);
  await expect(sidebar.locator('.saved-workflows, .navigation-workflows')).toHaveCount(0);
  await sidebar.getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL('/app/workflows');
  await expect(page.locator('main').getByRole('heading', { name: label, exact: true })).toBeVisible();
  return page.locator('main').getByRole('region', { name: label, exact: true });
}
const ok = <T,>(result: FlowResult): T => { if (!result.ok) throw Error(result.code); return result.value as T; };
/** Existing owner runtime creates the durable execution fixtures; the only sends go to the MOCKED loopback chain. */
let fixtureNonce = 3n;
async function executeFixture(workflow: SemanticWorkflow, owner: TestWallet) {
  if (process.env.GRYLOO_CLOUD_RUNTIME_E2E !== 'EMBEDDED_LOOPBACK_ONLY' || !process.env.FLOFI_E2E_DATABASE_URL) throw Error('MOCK_SEED_DENIED');
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL, maxConnections: 2 });
  const harness = createRouterHarness({ profile: TESTNET, owner: owner.address, nonce: fixtureNonce });
  try {
    const backend = createBackend({ db, env: { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, tenantId: 'default', holderId: 'acceptance-seed', evidenceStore: null,
      logger: createLogger({ service: 'acceptance', sink: () => undefined }), rpc: { 'crosschain-router-testnet': harness.baseRpc },
      routers: { 'crosschain-router-testnet': { destinationRpc: harness.arbitrumRpc, providers: harness.providers } } });
    const call = (method: string, args: unknown[]) => backend.callFlow('crosschain-router-testnet', method, args, undefined, owner.address);
    const run = ok<RouterRecord>(await call('simulate', [workflow, owner.address]));
    ok(await call('review', [run.id, run.review.commitment, workflow]));
    // Explicit test-wallet operations, through the same attempt/handoff/report/observe contract as the owner browser.
    for (let i = 0; i < 2; i++) {
      const next = ok<RouterBegin>(await call('begin', [run.id, owner.address, workflow]));
      ok(await call('handoff', [run.id]));
      const hash = harness.wallet.send(next.transaction);
      ok(await call('report', [run.id, { kind: 'HASH', hash }]));
      const current = ok<RouterRecord>(await call('observe', [run.id]));
      if (next.attempt.step === 'DEPOSIT' || current.phase === 'RECONCILED') break;
    }
    harness.advance(20);
    ok<RouterRecord>(await call('observe', [run.id]));
    // The fill is mined when MOCK_advance processes it; advance again past destination safe-head lag.
    harness.advance(12);
    const final = ok<RouterRecord>(await call('observe', [run.id]));
    expect(final.verdict).toBe('RECONCILED'); expect(final.evidence?.bundle.environment).toBe('MOCKED');
    fixtureNonce += BigInt(harness.counters.sends);
    return final.id;
  } finally { await db.close(); }
}

test.beforeEach(async ({ page }) => {
  // Build estimates must never contact a public provider from this browser suite.
  await page.route('**/api/build-estimate', route => route.fulfill({ json: { ok: false, code: 'ESTIMATE_UNAVAILABLE' } }));
});

test('new workflow identity is unique per load and matches the serialized server identity after hydration', async ({ page, networkGuard }) => {
  const response = await page.goto('/app');
  // The initial Build page keeps the technical IR inspector closed. The request
  // identity is still serialized in the server component's provider props.
  const server = (await response!.text()).match(/initialWorkflowId.{0,12}(workflow-[0-9a-f-]{36})/)?.[1];
  expect(server).toBeDefined();
  await page.locator('#mock-prompt').fill('Swap 1 USDC to WETH on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await openProposalReview(page); await page.getByRole('button', { name: 'Apply proposal' }).click();
  const client = JSON.parse(await readWorkflowIr(page)).workflowId;
  expect(client).toBe(server); expect(client).toMatch(/^workflow-[0-9a-f-]{36}$/);
  const reload = await page.reload();
  expect((await reload!.text()).match(/initialWorkflowId.{0,12}(workflow-[0-9a-f-]{36})/)?.[1]).not.toBe(client);
  networkGuard.assertClean();
});

test('normal Build removes the entire QA panel, keeps the header wallet and authors/simulates the permissionless bridge', async ({ page, networkGuard }) => {
  const owner = createTestWallet(); await resetJourneyHarness([owner]); await installJourneyWallet(page, [owner]); await page.goto('/app');
  await expect(page.getByRole('group', { name: 'Wallet connection' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('EVM Default');
  for (const text of ['PERMISSIONLESS TESTNET JOURNEY', 'Bridge test USDC from Base Sepolia to Arbitrum Sepolia with your own wallet',
    'Connect your wallet', 'Create the bridge workflow', 'Refresh runs']) await expect(page.locator('main')).not.toContainText(text);
  await expect(page.getByRole('region', { name: 'Testnet journey' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Journey steps' })).toHaveCount(0);
  expect(await page.locator('main').evaluate(element => element.firstElementChild?.classList.contains('build-grid'))).toBe(true);
  const layout = await page.locator('main').evaluate(element => ({ main: element.getBoundingClientRect().top, build: element.querySelector('.build-grid')!.getBoundingClientRect().top, padding: parseFloat(getComputedStyle(element).paddingTop) }));
  expect(layout.build - layout.main).toBeCloseTo(layout.padding, 1);
  await author(page);
  const card = page.locator('.build-flow-surface .composer-card').first();
  await expect(card.getByRole('button', { name: 'Configure source asset', exact: true })).toHaveAttribute('title', 'USDC on Base Sepolia');
  await expect(card.getByRole('button', { name: 'Configure destination asset', exact: true })).toHaveAttribute('title', 'USDC on Arbitrum Sepolia');
  await stage(page, 'Simulate'); await openSimulationDetails(page);
  const bridge = page.getByRole('region', { name: 'Cross-chain bridge', exact: true });
  await bridge.getByRole('button', { name: 'Sign in with wallet', exact: true }).click();
  await bridge.getByRole('button', { name: 'Get route and simulate', exact: true }).click();
  await expect(bridge.getByRole('list', { name: 'Route steps' })).toBeVisible();
  await expect(bridge).toContainText('Base Sepolia'); await expect(bridge).toContainText('Arbitrum Sepolia');
  // MOCKED evidence must never authorize the normal product execution path.
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  expect(await journeySends()).toBe(0); expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
  networkGuard.assertClean();
});

test('Save → Your workflows → exact Canvas restoration; grouped executions, ownership, EN/PT and Dashboard evidence stay separate', async ({ page, networkGuard }) => {
  test.setTimeout(90_000);
  const A = createTestWallet(), B = createTestWallet(); await resetJourneyHarness([A, B]); await installJourneyWallet(page, [A, B]); await page.goto('/app');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await author(page);
  const name = 'Save workflow'; // User data that happens to be a catalog key must stay unchanged.
  await page.getByRole('button', { name: 'Rename workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Workflow name', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await page.getByRole('button', { name: 'Connect wallet and prove ownership', exact: true }).click();
  await chooseWallet(page, 'Browser wallet'); // The canonical selector (HOTFIX-WALLET-SELECTOR) asks which wallet proves ownership.
  await expect(page.getByRole('button', { name: 'Connect wallet and prove ownership', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Workflow saved.');
  const workflow = await savedCanonical(A.address);
  expect(workflow.nodes.some(n => n.actionType === 'asset.bridge' && n.chainId === 'eip155:84532')).toBe(true);
  let library = await libraryWorkspace(page); await expect(library.getByRole('button', { name, exact: true })).toHaveCount(1);
  await stage(page, 'Build');
  const card = page.locator('.build-flow-surface .composer-card').first();
  await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill('2');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  const run1 = await executeFixture(workflow, A), run2 = await executeFixture(workflow, A);
  const executed = { ...workflow, workflowId: 'executed-only-' + crypto.randomUUID() };
  await executeFixture(executed, A);
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your execution workspace' })).toBeVisible();
  await expect(page.locator('main .navigation-workflows, main .saved-workflows')).toHaveCount(0);
  await expect(page.locator('main').getByRole('heading', { name: 'Workflows', exact: true })).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Workflows are temporarily unavailable. Try again.');
  await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-run-list>li')).toHaveCount(3);
  await page.locator(`a[href="/app/dashboard/runs/${run1}"]`).click();
  await expect(page.locator('main')).toContainText(run1);
  await expect(page.locator('main')).toContainText('Evidence');
  expect(run1).not.toBe(run2);
  await page.reload();
  library = await libraryWorkspace(page);
  await expect(library.getByRole('button', { name, exact: true })).toHaveCount(1);
  await expect(library.getByRole('button', { name: 'Workflow', exact: true })).toHaveCount(1);
  expect(await library.innerText()).not.toMatch(/RECONCILED|0x[0-9a-f]{40}|crx-/);
  await library.getByRole('button', { name, exact: true }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.locator('.build-flow-surface .composer-card').first().getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click();
  await expect.poll(() => savedCanonical(A.address)).toEqual(workflow);
  await expect(page.locator('.canvas-name h2')).toHaveText(name);
  await stage(page, 'Simulate');
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  await expect(review).toContainText('Review unavailable until simulation is ready.');
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(review).not.toContainText('Review approved');
  // Changing locale is presentation only; wallet identity and canonical IR remain unchanged.
  await stage(page, 'Build');
  const requests = await walletRequests(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click(); await page.getByRole('switch', { name: 'Language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt'); await page.keyboard.press('Escape');
  library = await libraryWorkspace(page, 'PT');
  await expect(library.getByRole('button', { name, exact: true })).toHaveCount(1);
  await expect(page.getByRole('group', { name: 'Ligação da carteira' })).toContainText(A.address.slice(0, 6));
  await library.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.build-flow-surface .composer-card').first().getByRole('textbox', { name: 'Montante de origem (USDC)', exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Guardar fluxo', exact: true }).click();
  await expect.poll(() => savedCanonical(A.address)).toEqual(workflow);
  expect((await walletRequests(page)).filter(method => method !== 'eth_accounts' && method !== 'eth_chainId')).toEqual(requests.filter(method => method !== 'eth_accounts' && method !== 'eth_chainId'));
  await switchAccount(page, B.address);
  library = await libraryWorkspace(page, 'PT');
  await expect(library.getByRole('button', { name, exact: true })).toHaveCount(0);
  await library.getByRole('button', { name: 'Ligar carteira e verificar titularidade', exact: true }).click();
  await chooseWallet(page, 'Browser wallet', 'Ethereum', 'PT');
  await expect(library).toContainText('Ainda não há workflows.');
  expect(errors).toEqual([]); networkGuard.assertClean();
});


for (const [initialChain, initialLabel] of [['0x1', 'Ethereum Mainnet'], ['0xaa36a7', 'Ethereum Sepolia']] as const) {
test(`header tracks external chain changes and reloads the actual provider on ${initialLabel}`, async ({ page, networkGuard }) => {
  const owner = createTestWallet(); await resetJourneyHarness([owner]); await installJourneyWallet(page, [owner], { chain: initialChain }); await page.goto('/app');
  const header = page.getByRole('group', { name: 'Wallet connection' });
  await expect(header).toContainText('EVM Default'); await expect(header).toContainText(initialLabel);
  await page.reload(); await expect(header).toContainText(initialLabel);
  for (const [chain, label] of [['0x2105', 'Base (8453)'], ['0x1', 'Ethereum Mainnet'], ['0xa4b1', 'Arbitrum (42161)'], ['0x14a34', 'Base Sepolia'], ['0xaa36a7', 'Ethereum Sepolia'], ['0xdeadbeef', 'Other chain (0xdeadbeef)']]) {
    await setWalletChain(page, chain!); await expect(header).toContainText(label!); await expect(header).toContainText('EVM Default');
  }
  // A new browser load must read eth_chainId; it never infers chain from the selected product environment.
  expect(await walletRequests(page)).not.toContain('eth_sendTransaction'); networkGuard.assertClean();
});
}

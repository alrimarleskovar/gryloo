// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 AC-7: the in-chat execution journey in a real browser, end to end, on the embedded PostgreSQL runtime with the
 * MOCKED loopback router and Solana Devnet harnesses (never a public network, never a real transaction):
 *
 *   consumer OAuth (consent page, invite) → compose_strategy → request_user_approval → the FloFi panel in an MCP Apps host →
 *   "Connect wallet & execute in FloFi" (ui/open-link to a fresh FloFi approval session) → the FloFi signing window → wallet proof
 *   (EIP-4361 / Sign-In With Solana) → claim → the existing proposal card → the owner's unchanged flow (fresh simulation,
 *   Review) → current main blocks MOCKED financial authority → prepared status back in the panel and model context.
 *   The separate PostgreSQL journey retains the positive owner-driven lifecycle and reconciled evidence coverage.
 *
 * The test host is minimal and honest about what it is: it proves FloFi's side of the MCP Apps contract, not any vendor's host.
 */
import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { createMockedSolanaWallet } from '@defi-workflow-engine/reference-compiler';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';
import { chooseSolanaWallet, MOCKED_SOLANA_WALLET, signRequests } from './jupiter-fixtures';
import { chooseWallet, openSimulationDetails } from './fixtures';
import { assertExecutionBlocked } from './release-safety-fixtures';
import { guardedContext, installJourneyWallet, journeySends, walletRequests } from './journey-fixtures';
import { assertMcpHarness, CLIENT_NAME, connectViaBrowser, hostLog, mcpClient, openHost, panelHtmlOf } from './mcp-fixtures';
import { routerControl } from './router-fixtures';
import { installLendingWallet, LENDING_OWNER, lendingRpc, lendingSends } from './lending-fixtures';
import { devnetControl, devnetPanel, installDevnetWallet } from './solana-devnet-fixtures';

const PANEL_URI = 'ui://flofi/approval-panel.html';
/** The newest durable run of one flow owned by one wallet, read from the disposable loopback database. */
async function latestRun(flow: string, owner: string): Promise<string> {
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try {
    const row = (await db.query<{ run_id: string }>('SELECT run_id FROM execution_runs WHERE flow = $1 AND owner_account = $2 ORDER BY created_at DESC LIMIT 1',
      [flow, owner])).rows[0];
    if (!row) throw new Error('RUN_NOT_RECORDED');
    return row.run_id;
  } finally { await db.close(); }
}
const approval = (page: Page) => page.getByRole('region', { name: 'External proposal' });
const bridge = (page: Page) => page.getByRole('region', { name: 'Cross-chain bridge' });
async function simulateStage(page: Page) {
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await openSimulationDetails(page);
}
async function assertHandoffReviewBlocked(page: Page, requests: () => Promise<number>) {
  await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
  await expect(page.getByRole('region', { name: 'Authorization technical details', exact: true })).toContainText('Strategy Manifest');
  await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toHaveCount(0);
  expect(await requests()).toBe(0);
  await assertExecutionBlocked(page, requests);
  // An applied signing-session link is consumed. Recovery remains in the existing FloFi workspace.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to FloFi', exact: true }).click();
  await assertExecutionBlocked(page, requests);
}

async function chatToSigningWindow(context: BrowserContext, strategy: Record<string, unknown>) {
  const consent = await context.newPage();
  const { accessToken } = await connectViaBrowser(consent, context.request);
  const client = mcpClient(context.request, accessToken);
  const composed = await client.tool('compose_strategy', { strategy });
  expect(composed).toMatchObject({ ok: true, stepCount: 1 });
  const args = { strategy: composed.strategy as Record<string, unknown>, workflowHash: String(composed.workflowHash) };
  const result = await client.toolResult('request_user_approval', args);
  expect(result.structuredContent).toMatchObject({ ok: true, status: 'PENDING', authority: 'NONE' });
  // The text result alone already lets a host without MCP Apps send the user to FloFi (fallback E).
  expect(result.content?.[0]?.text).toContain(`${APP_ORIGIN}/approve#flofi_hs_`);
  const host = await context.newPage();
  const panel = await openHost(host, client, await panelHtmlOf(client, PANEL_URI), args, result);
  await expect(panel.getByText('Nothing is authorized yet.', { exact: false })).toBeVisible();
  await expect(panel.getByText(String(composed.workflowHash))).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Check this chat environment (diagnostics)' })).toBeVisible();
  await panel.getByRole('button', { name: 'Connect wallet & execute in FloFi' }).click();
  await expect.poll(async () => (await hostLog(host)).openLinks.length).toBe(1);
  const url = (await hostLog(host)).openLinks[0]!;
  expect(url).toMatch(new RegExp(`^${APP_ORIGIN.replace(/[.]/g, '\\.')}/approve#flofi_hs_[A-Za-z0-9_-]{43}$`));
  await consent.close();
  return { client, host, panel, url, composed };
}
async function proposalIntoWorkflow(signing: Page, url: string, wallet: 'evm' | 'solana', account?: string) {
  const response = await signing.goto(url);
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(signing.locator('.app-shell')).toHaveCount(1);
  const region = approval(signing);
  await expect(region).toContainText(`EXTERNAL PROPOSAL · FROM ${CLIENT_NAME.toUpperCase()}`);
  await expect(region).toContainText('Nothing is authorized yet.');
  await expect(region).toContainText('Test funds');
  await expect(region).toContainText('not financial advice');
  // The secret left the address bar; the account consented in this browser, so status sharing is on by default.
  expect(signing.url()).not.toContain('flofi_hs_');
  await expect(region.getByRole('checkbox')).toBeChecked();
  if (wallet === 'evm') { await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click(); await chooseWallet(signing, 'Browser wallet'); }
  else { await region.getByRole('button', { name: 'Connect Solana wallet and prove ownership' }).click(); await chooseWallet(signing, MOCKED_SOLANA_WALLET, 'Solana'); }
  await expect(region).toContainText(`Signed in as ${account ?? ''}`);
  await region.getByRole('button', { name: 'Load proposal' }).click();
  await region.getByRole('button', { name: 'Add to my workflow' }).click();
  await expect(region.getByRole('status')).toContainText('Ready for your review.');
}

test.describe('BUILD-MCP-002 in-chat execution (mocked MCP Apps host)', () => {
  test.beforeAll(assertMcpHarness);

  test('EVM: chat → panel → wallet proof → router simulation; current main blocks MOCKED execution and the panel reports prepared status', async ({ browser }) => {
    const owner = createTestWallet();
    await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
    const { context, unexpected } = await guardedContext(browser);
    const { host, panel, url } = await chatToSigningWindow(context, { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' });
    expect(await journeySends()).toBe(0);

    const signing = await context.newPage();
    const errors: string[] = []; signing.on('pageerror', e => errors.push(e.message));
    await installJourneyWallet(signing, [owner]);
    await proposalIntoWorkflow(signing, url, 'evm');
    // Use the authoritative product's simulation and Review; a MOCKED route cannot authorize execution.
    await simulateStage(signing);
    await bridge(signing).getByRole('button', { name: 'Get route and simulate' }).click();
    await expect(bridge(signing)).toContainText('Strategy Manifest');
    await expect(bridge(signing)).toContainText(`Owner ${owner.address}`);
    expect(await walletRequests(signing)).toContain('personal_sign');
    await assertHandoffReviewBlocked(signing, journeySends);
    expect(await walletRequests(signing)).not.toContain('eth_sendTransaction');

    // Status still reaches the chat, without claiming reconciliation or an evidence bundle.
    await expect(panel.getByText(/crosschain-router-testnet · PREPARED/)).toBeVisible({ timeout: 45_000 });
    const log = await hostLog(host);
    expect(log.toolCalls).toEqual(expect.arrayContaining(['open_approval_session', 'get_execution_progress']));
    expect(log.toolCalls).not.toContain('request_user_approval');
    const context0 = log.modelContext.at(-1)!;
    expect(context0.content?.[0]?.text).toContain('PREPARED');
    expect(JSON.stringify(context0)).not.toMatch(/RECONCILED|0x[0-9a-f]{64}/);
    expect(JSON.stringify(log)).not.toMatch(/flofi_at_|flofi_rt_|calldata|"signature"/);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('Solana: Sign-In With Solana → Orca simulation; current main blocks MOCKED execution and the panel reports simulated status', async ({ browser }) => {
    const wallet = createMockedSolanaWallet();
    await devnetControl({ action: 'reset', owner: wallet.owner, options: {}, devUsdc: '0' });
    const { context, unexpected } = await guardedContext(browser);
    const { panel, url } = await chatToSigningWindow(context, { action: 'swap', network: 'solana-devnet', inputAsset: 'SOL', outputAsset: 'devUSDC', amount: '0.1' });
    const signing = await context.newPage();
    await installDevnetWallet(signing, wallet, { signMessage: true });
    await proposalIntoWorkflow(signing, url, 'solana', wallet.owner);
    await simulateStage(signing);
    await chooseSolanaWallet(devnetPanel(signing));
    await devnetPanel(signing).getByRole('button', { name: 'Simulate swap' }).click();
    await expect(devnetPanel(signing).getByRole('definition').filter({ hasText: '→ expected' })).toContainText('0.1 Devnet SOL → expected');
    await assertHandoffReviewBlocked(signing, () => signRequests(signing));
    expect(await devnetControl({ action: 'sent' })).toBe(0);
    await expect(panel.getByText(/solana-devnet-swap · SIMULATED/)).toBeVisible({ timeout: 45_000 });
    expect(unexpected).toEqual([]);
    await context.close();
  });

  test('lending composition (v2 supply → borrow → swap): proposal and simulation preserve main’s MOCKED execution guard and report simulated status', async ({ browser }) => {
    test.setTimeout(120_000);
    // The lending harness funds one public disposable fixture account; the test signs its sign-in message with that fixture key.
    const fixtureOwner = createTestWallet(new Uint8Array(32).fill(0x43));
    expect(fixtureOwner.address).toBe(LENDING_OWNER);
    await lendingRpc('MOCK_reset', [{}]);
    const { context, unexpected } = await guardedContext(browser);
    const steps = [{ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '0.1', beneficiary: LENDING_OWNER },
      { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '0.01', beneficiary: LENDING_OWNER },
      { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '0.01', slippageBps: 50 }];
    const { panel, url, composed } = await chatToSigningWindow(context, { version: 2, steps });
    expect(composed).toMatchObject({ strategy: { action: 'lending_composition', owner: LENDING_OWNER }, executionPlan: { kind: 'COMPOSITE_FLOW' } });
    const signing = await context.newPage();
    await installLendingWallet(signing, { signer: fixtureOwner });
    await proposalIntoWorkflow(signing, url, 'evm', LENDING_OWNER);
    const lending = signing.getByRole('region', { name: 'Lending composition' });
    await simulateStage(signing);
    await signing.getByRole('button', { name: 'Simulate lending composition', exact: true }).click();
    await expect(lending).toContainText('Expected output:');
    await assertHandoffReviewBlocked(signing, () => lendingSends(signing));
    await expect(panel.getByText(/lending-composition · SIMULATED/)).toBeVisible({ timeout: 45_000 });
    expect(unexpected).toEqual([]);
    await context.close();
  });

  test('another browser cannot take a claimed proposal or share by default; /connections links a wallet for run reads, and unlinks it', async ({ browser }) => {
    const owner = createTestWallet(), other = createTestWallet();
    await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [other.address] }]);
    const { context, unexpected } = await guardedContext(browser);
    const { client, url } = await chatToSigningWindow(context, { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' });
    // Someone else's browser (no FloFi account here) can see the proposal; sharing with the requesting account is off by default.
    const elsewhere = await guardedContext(browser), stranger = await elsewhere.context.newPage();
    await installJourneyWallet(stranger, [other]);
    await stranger.goto(url);
    await expect(approval(stranger).getByRole('checkbox')).not.toBeChecked();
    // The owner claims first, in the browser that holds the account.
    const signing = await context.newPage();
    await installJourneyWallet(signing, [owner]);
    await proposalIntoWorkflow(signing, url, 'evm', owner.address);
    // A second proven wallet holding the same link cannot take it: claimed by another wallet, and once applied the approval-session
    // link no longer resolves at all (it reveals nothing about the proposal).
    await approval(stranger).getByRole('button', { name: 'Connect wallet and prove ownership' }).click();
    await chooseWallet(stranger, 'Browser wallet');
    await approval(stranger).getByRole('button', { name: 'Load proposal' }).click();
    await expect(approval(stranger).getByRole('alert')).toContainText(/^(HANDOFF_ALREADY_CLAIMED|HANDOFF_NOT_FOUND)$/);
    // The owner's simulation creates a durable run owned by their wallet; the account cannot read it until the wallet is linked.
    await simulateStage(signing);
    await bridge(signing).getByRole('button', { name: 'Get route and simulate' }).click();
    await expect(bridge(signing)).toContainText(`Owner ${owner.address}`);
    await expect.poll(() => latestRun('crosschain-router-testnet', owner.address).catch(() => null)).not.toBeNull();
    const runId = await latestRun('crosschain-router-testnet', owner.address);
    expect(await client.tool('get_execution_status', { executionId: runId })).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    const connections = await context.newPage();
    await installJourneyWallet(connections, [owner]);
    await connections.goto(`${APP_ORIGIN}/connections`);
    const panel = connections.getByRole('region', { name: 'Connections' });
    await expect(panel).toContainText(/Account mcpacct_[a-z2-7]{26}/);
    await expect(panel).toContainText(`Signed in as ${owner.address}`);
    await panel.getByRole('button', { name: /^Link 0x/ }).click();
    await expect(panel.getByRole('button', { name: 'Remove link' })).toBeVisible();
    expect(await client.tool('get_execution_status', { executionId: runId })).toMatchObject({ ok: true, executionId: runId, owner: owner.address, accessBasis: 'ACCOUNT_LINKED_WALLET' });
    await panel.getByRole('button', { name: 'Remove link' }).click();
    await expect(panel).toContainText('No linked wallet.');
    expect(await client.tool('get_execution_status', { executionId: runId })).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    expect(await journeySends()).toBe(0);
    expect([...unexpected, ...elsewhere.unexpected]).toEqual([]);
    await elsewhere.context.close(); await context.close();
  });

  test('a mainnet strategy is refused by policy before any panel or link exists; nothing is opened', async ({ browser }) => {
    const { context, unexpected } = await guardedContext(browser);
    const consent = await context.newPage();
    const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
    const composed = await client.tool('compose_strategy', { strategy: { action: 'swap', network: 'solana', inputAsset: 'USDC', outputAsset: 'SOL', amount: '1' } });
    const refused = await client.toolResult('request_user_approval', { strategy: composed.strategy as Record<string, unknown>, workflowHash: String(composed.workflowHash) });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({ ok: false, gates: { supportedByCode: { execute: true }, enabledByPolicy: { enabled: false, fundsClass: 'REAL_FUNDS' } } });
    expect(['MAINNET_HANDOFF_DISABLED_BY_POLICY', 'FLOW_NOT_ENABLED_IN_DEPLOYMENT']).toContain(refused.structuredContent?.code);
    expect(JSON.stringify(refused)).not.toContain('/approve#');
    expect(unexpected).toEqual([]);
    await context.close();
  });
});

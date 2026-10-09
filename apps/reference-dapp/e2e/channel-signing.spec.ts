// SPDX-License-Identifier: AGPL-3.0-only
/** FloFi-side host contracts, never live ChatGPT/Claude or wallet apps. Network guard permits loopback app traffic only. */
import { test, expect } from '@playwright/test';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { chooseWallet } from './fixtures';
import { guardedContext, installJourneyWallet, journeySends, walletRequests } from './journey-fixtures';
import { assertMcpHarness, connectViaBrowser, hostLog, mcpClient, openHost, panelHtmlOf } from './mcp-fixtures';
import { routerControl } from './router-fixtures';

const strategy = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' };
test.beforeAll(assertMcpHarness);
test.setTimeout(90_000);

for (const hostName of ['ChatGPT fixture', 'Claude fixture']) {
  test(`${hostName}: private panel handoff, nonsecret browser fallback, one load action and consumed-link recovery`, async ({ browser }) => {
    const owner = createTestWallet();
    await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
    const { context, unexpected } = await guardedContext(browser), consent = await context.newPage();
    const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
    const composed = await client.tool('compose_strategy', { strategy });
    const result = await client.toolResult('request_user_approval', { strategy, workflowHash: composed.workflowHash });
    expect(JSON.stringify(result.content) + JSON.stringify(result.structuredContent)).not.toContain('flofi_hs_');
    const fallback = String(result.structuredContent!.approvalUrl);
    expect(fallback).toMatch(/\/approve#apr_[a-z2-7]{26}$/);
    const host = await context.newPage();
    const panel = await openHost(host, client, await panelHtmlOf(client, 'ui://flofi/approval-panel.html'), {}, result, { hostName });
    await expect(panel.getByRole('button', { name: 'Open in MetaMask' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Open Phantom browser' })).toHaveCount(0);
    const elsewhere = await guardedContext(browser), stranger = await elsewhere.context.newPage();
    await stranger.goto(fallback);
    await expect(stranger.locator('.approval-page [role=alert]')).toContainText('APPROVAL_ACCOUNT_REQUIRED');
    await expect(stranger.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(0);
    // A normal browser with the original OAuth account opens the universal fallback without asking the model for a capability.
    const page = await context.newPage(); await installJourneyWallet(page, [owner]);
    await page.goto(fallback);
    const region = page.getByRole('region', { name: 'External proposal' });
    await expect(region).toContainText('Nothing is authorized yet.');
    await region.getByText('Open with a mobile wallet', { exact: true }).click();
    const metaMask = new URL((await region.getByRole('link', { name: 'Open in MetaMask', exact: true }).getAttribute('href'))!);
    expect(metaMask.hash).toMatch(/^#flofi_hs_/);
    expect(metaMask.pathname + metaMask.search).not.toContain('flofi_hs_');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click(); await chooseWallet(page, 'Browser wallet');
    await expect(region).toContainText(`Signed in as ${owner.address}`);
    // Closing grants nothing, and reopening the original reference remains possible before it is consumed.
    await region.getByRole('button', { name: 'Close approval' }).click();
    await expect(page.getByRole('heading', { name: 'Approval closed' })).toBeVisible();
    expect(await journeySends()).toBe(0);
    const reopened = await page.goto(fallback);
    expect(reopened?.status() ?? 200).toBe(200);
    await expect(region).toContainText('Nothing is authorized yet.');
    // Simulate an interruption after the server sees the exact workflow but before the client receives the apply result.
    let interrupted = false;
    await page.route('**/approve', async route => {
      const body = route.request().postData() ?? '';
      if (!interrupted && route.request().headers()['next-action'] && body.includes('"workflowId"')) {
        interrupted = true; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
      } else await route.continue();
    });
    await region.getByRole('button', { name: 'Load proposal' }).click();
    await expect(region.getByRole('alert')).toContainText('APPROVAL_UNAVAILABLE');
    await page.unroute('**/approve');
    await page.reload();
    await region.getByRole('button', { name: 'Load proposal' }).click();
    await expect(region.getByRole('status')).toContainText('Ready for your review.');
    await expect(region).toContainText('Proposal restored for its proven owner.');
    await region.getByRole('button', { name: 'Continue to simulation' }).click();
    await expect(page.locator('.simulate-workspace')).toBeVisible();
    expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
    expect(await journeySends()).toBe(0);
    // Browser history may restore the same consumed fragment. Only its existing proven owner can reconstruct it.
    const consumed = await page.evaluate(() => sessionStorage.getItem('flofi.approval.secret'));
    await page.goto(new URL(`/approve#${consumed}`, fallback).href);
    await expect(region).toContainText('Nothing is authorized yet.');
    // A different presented link must clear the old recovery hint, even in that proven owner's tab.
    await page.goto(new URL('/approve#flofi_hs_' + 'x'.repeat(43), fallback).href);
    await expect(page.locator('.approval-page [role=alert]')).toContainText('HANDOFF_NOT_FOUND');
    await expect(region).toHaveCount(0);
    await panel.getByRole('button', { name: 'Refresh status' }).click();
    await expect.poll(async () => (await hostLog(host)).modelContext.length).toBeGreaterThan(0);
    expect(JSON.stringify((await hostLog(host)).modelContext)).not.toMatch(/flofi_hs_|approvalUrl|walletLinks/);
    expect([...unexpected, ...elsewhere.unexpected]).toEqual([]);
    await elsewhere.context.close(); await context.close();
  });
}

test('a delayed apply response cannot restore the previous proposal after another link is presented', async ({ browser }) => {
  const owner = createTestWallet();
  await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
  const { context, unexpected } = await guardedContext(browser), consent = await context.newPage();
  const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
  const composed = await client.tool('compose_strategy', { strategy });
  const result = await client.toolResult('request_user_approval', { strategy, workflowHash: composed.workflowHash });
  const page = await context.newPage(); await installJourneyWallet(page, [owner]);
  await page.goto(String(result.structuredContent!.approvalUrl));
  const region = page.getByRole('region', { name: 'External proposal' });
  await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click(); await chooseWallet(page, 'Browser wallet');
  await expect(region).toContainText(`Signed in as ${owner.address}`);
  let releaseApply!: () => void, notifyApplied!: () => void;
  const held = new Promise<void>(resolve => { releaseApply = resolve; });
  const applied = new Promise<void>(resolve => { notifyApplied = resolve; });
  await page.route('**/approve', async route => {
    if (route.request().headers()['next-action'] && (route.request().postData() ?? '').includes('"workflowId"')) {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      notifyApplied(); await held; await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await region.getByRole('button', { name: 'Load proposal' }).click();
    await applied;
    // Keep the component mounted while the old response is in flight.
    await page.evaluate(() => { window.location.hash = 'flofi_hs_' + 'x'.repeat(43); });
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('flofi.approval.id'))).toBeNull();
    releaseApply();
    await expect(page.getByRole('heading', { name: 'Open this link from your assistant' })).toBeVisible();
    await expect(page.locator('.approval-page [role=alert]')).toContainText('HANDOFF_NOT_FOUND');
    await expect(region).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toHaveCount(0);
    expect(await journeySends()).toBe(0);
    expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
    expect(unexpected).toEqual([]);
  } finally { releaseApply(); await context.close(); }
});

test('host link refusal leaves a usable private fallback and concurrent clicks mint only one session', async ({ browser }) => {
  const { context, unexpected } = await guardedContext(browser), consent = await context.newPage();
  const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
  const composed = await client.tool('compose_strategy', { strategy });
  const result = await client.toolResult('request_user_approval', { strategy, workflowHash: composed.workflowHash });
  const host = await context.newPage();
  const panel = await openHost(host, client, await panelHtmlOf(client, 'ui://flofi/approval-panel.html'), {}, result, { openLinkRefused: true });
  await panel.getByRole('button', { name: 'Review with your wallet in FloFi' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(panel.getByText('OPEN_LINK_REFUSED', { exact: true })).toBeVisible();
  const log = await hostLog(host);
  expect(log.toolCalls.filter(name => name === 'open_approval_session')).toHaveLength(1);
  await expect(panel.locator('code')).toHaveText(log.openLinks[0]!);
  expect(unexpected).toEqual([]); await context.close();
});

test('a rejected wallet proof leaves the proposal unclaimed and can be retried without any spend authorization', async ({ browser }) => {
  const owner = createTestWallet();
  await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
  const { context, unexpected } = await guardedContext(browser), consent = await context.newPage();
  const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
  const composed = await client.tool('compose_strategy', { strategy });
  const result = await client.toolResult('request_user_approval', { strategy, workflowHash: composed.workflowHash });
  const page = await context.newPage(); await installJourneyWallet(page, [owner]);
  await page.goto(String(result.structuredContent!.approvalUrl));
  const region = page.getByRole('region', { name: 'External proposal' });
  await expect(region).toContainText('Nothing is authorized yet.');
  await page.evaluate(() => {
    const provider = (window as unknown as { ethereum: { request(input: { method: string }): Promise<unknown> } }).ethereum;
    const original = provider.request;
    let rejected = false;
    provider.request = input => {
      if (input.method === 'personal_sign' && !rejected) { rejected = true; return Promise.reject(Object.assign(new Error('Rejected'), { code: 4001 })); }
      return original(input);
    };
  });
  await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click(); await chooseWallet(page, 'Browser wallet');
  await expect(region.getByRole('alert')).toContainText('WALLET_REQUEST_FAILED');
  await expect(region.getByRole('button', { name: 'Load proposal' })).toBeDisabled();
  expect(await client.tool('get_approval_status', { approvalId: result.structuredContent!.approvalId })).toMatchObject({ status: 'PENDING', claimed: false, authority: 'NONE' });
  await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click(); await chooseWallet(page, 'Browser wallet');
  await expect(region).toContainText(`Signed in as ${owner.address}`);
  await expect(region.getByRole('button', { name: 'Load proposal' })).toBeEnabled();
  expect(await journeySends()).toBe(0);
  expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
  expect(unexpected).toEqual([]); await context.close();
});

test('progress reporting projects public facts even when a host returns unexpected fields', async ({ browser }) => {
  const { context, unexpected } = await guardedContext(browser), consent = await context.newPage();
  const client = mcpClient(context.request, (await connectViaBrowser(consent, context.request)).accessToken);
  const composed = await client.tool('compose_strategy', { strategy });
  const result = await client.toolResult('request_user_approval', { strategy, workflowHash: composed.workflowHash });
  const fake = { ...client, toolResult: async () => ({ structuredContent: { ok: true, status: 'APPLIED', runs: [{ executionId: 'run-test',
    flow: 'crosschain-router-testnet', status: 'RECONCILED', reconciled: true, terminal: true, evidenceEnvironment: 'MOCKED',
    evidenceBundleHash: '0x' + 'a'.repeat(64), approvalUrl: 'flofi_hs_' + 'x'.repeat(43), signature: 'hidden', transaction: 'hidden' }] } }) };
  const host = await context.newPage();
  const panel = await openHost(host, fake, await panelHtmlOf(client, 'ui://flofi/approval-panel.html'), {}, result);
  await panel.getByRole('button', { name: 'Refresh status' }).click();
  await expect.poll(async () => (await hostLog(host)).modelContext.length).toBe(1);
  expect(JSON.stringify((await hostLog(host)).modelContext)).not.toMatch(/flofi_hs_|hidden|approvalUrl|signature|transaction/);
  expect(JSON.stringify((await hostLog(host)).modelContext)).toContain('MOCKED');
  expect(unexpected).toEqual([]); await context.close();
});

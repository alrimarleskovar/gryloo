// SPDX-License-Identifier: AGPL-3.0-only
/** Real public-swap UI/API/durable runtime, synthetic loopback RPC and explicit scripted owner confirmations. No public broadcast. */
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, acceptProductReview } from './fixtures';
import { installJourneyWallet, synchronizeWallet, walletRequests } from './journey-fixtures';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { validatePublicRunLog, type PublicRun } from '../src/server/public-testnet-service';

test.skip(process.env.FLOFI_SWAP_EXECUTION_E2E !== 'MOCKED_LOOPBACK_ONLY', 'Requires the opt-in loopback swap execution harness');
test.setTimeout(90_000);
const stage = (page: Page, name: 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();
const summary = (page: Page) => page.locator('.execution-summary');
const falseWalletChange = 'Wallet changed. Simulate and review this workflow again with the connected wallet.';
const pointer = (page: Page) => page.evaluate(() => localStorage.getItem('gryloo:public-testnet-execution-id'));
async function durable(id: string) {
  const url = process.env.FLOFI_E2E_DATABASE_URL!;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw Error('LOOPBACK_DATABASE_REQUIRED');
  const db = createDatabase({ connectionString: url, maxConnections: 1 });
  try {
    const runs = (await db.query('SELECT status, has_evidence FROM execution_runs WHERE run_id = $1', [id])).rows;
    const attempts = (await db.query('SELECT step, state, reconciled FROM execution_attempts WHERE run_id = $1 ORDER BY step', [id])).rows;
    // Reconciliation persists the bundle in the run log in the same transaction.
    // evidence_objects is a later worker archive; this browser harness runs the API.
    const segments = (await db.query<{ bytes: Buffer }>(`SELECT s.bytes FROM execution_log_segments s JOIN execution_runs r
      ON s.tenant_id = r.tenant_id AND s.namespace = r.namespace AND s.name = r.log_name
      WHERE r.run_id = $1 ORDER BY s.seq`, [id])).rows;
    const bytes = Buffer.concat(segments.map(segment => segment.bytes));
    validatePublicRunLog(bytes);
    const run = JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!) as PublicRun;
    expect(run.quote.executionId).toBe(id);
    const evidence = run.outcome ? [{ outcome: run.outcome.evidence.outcome }] : [];
    if (run.outcome) {
      validateArtifact('evidence-bundle', run.outcome.evidence);
      expect(hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(run.outcome.evidence)))).toBe(run.outcome.evidenceBundleHash);
      expect(run.outcome).toMatchObject({ inputSpent: '1000000', outputReceived: '500000000000000', allowanceAfter: '0' });
    }
    return { runs, attempts, evidence };
  } finally { await db.close(); }
}
async function control(request: APIRequestContext, method: string, params: unknown[] = []) {
  const response = await request.post('https://127.0.0.1:8558/control', { ignoreHTTPSErrors: true, data: { jsonrpc: '2.0', id: 1, method, params } });
  expect(response.ok()).toBe(true);
  return (await response.json() as { result: unknown }).result;
}
async function setup(page: Page, request: APIRequestContext, loseAt = 0) {
  await control(request, 'MOCK_reset');
  const confirmations: (() => void)[] = [];
  let requested = 0;
  await installJourneyWallet(page, [createTestWallet()], { transactionControl: async (method, params) => {
    if (method !== 'MOCK_send') throw Error('MOCK_METHOD_DENIED');
    const number = ++requested;
    await new Promise<void>(resolve => confirmations.push(resolve));
    const hash = await control(request, method, params);
    if (number === loseAt) throw Error('MOCK_WALLET_RESPONSE_LOST');
    return hash;
  } });
  // Announce the same scripted provider as MetaMask, as in the production sequence.
  await page.addInitScript(() => window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { provider: (window as Window & { ethereum?: unknown }).ethereum, info: { rdns: 'io.metamask', name: 'MetaMask', uuid: 'continuity-metamask' } },
  }))));
  await page.goto('/app');
  await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('MetaMask');
  await expect(page.getByRole('group', { name: 'Wallet connection' })).toContainText('Base Sepolia');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card').first();
  await card.getByRole('button', { name: 'Select source token', exact: true }).click();
  await page.getByRole('region', { name: 'Action network picker', exact: true }).getByRole('button', { name: 'Base Sepolia', exact: true }).click();
  await page.getByRole('button', { name: 'Hide token picker', exact: true }).click();
  await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill('1');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  await stage(page, 'Simulate');
  await page.getByRole('button', { name: 'Simulate workflow', exact: true }).click();
  await acceptProductReview(page);
  await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeEnabled();
  return {
    requested: () => requested,
    confirm: async () => { await expect.poll(() => confirmations.length).toBe(1); confirmations.shift()!(); },
    sends: () => control(request, 'MOCK_sends'),
  };
}

test('production regression: same MetaMask/account/Base Sepolia → approval CONFIRMED → harmless sync → explicit swap → reconciled evidence', async ({ page, request, networkGuard }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const owner = await setup(page, request), id = await pointer(page);
  await page.getByRole('button', { name: 'Execute workflow', exact: true }).click();
  await expect.poll(owner.requested).toBe(1);
  await expect(summary(page)).toContainText('Preparing request');
  expect(await owner.sends()).toBe(0);
  // Wallet extension sync during interaction, followed by owner confirmation of approval.
  await synchronizeWallet(page); await owner.confirm();
  await expect(page.locator('.execution-timeline')).toContainText('Confirmed');
  expect(await owner.sends()).toBe(1);
  expect(await durable(id!)).toMatchObject({ runs: [{ status: 'CONFIRMED', has_evidence: false }], attempts: [{ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true }], evidence: [] });
  await synchronizeWallet(page);
  await expect(summary(page)).not.toContainText(falseWalletChange);
  const next = page.locator('.canvas-primary-action').getByRole('button', { name: 'Continue to swap', exact: true });
  await expect(next).toBeEnabled();
  // A settled approval has no unresolved status check. Navigation/rerenders
  // must never repeat it or submit the still-unattempted swap.
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Check status', exact: true })).toHaveCount(0);
  await stage(page, 'Simulate'); await expect(page.locator('.review-authorization-details')).not.toContainText(falseWalletChange);
  await stage(page, 'Execute'); await expect(next).toBeEnabled();
  expect(await pointer(page)).toBe(id); expect(await owner.sends()).toBe(1); expect(owner.requested()).toBe(1);
  // Two clicks in one browser turn exercise the existing request lock.
  await next.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(owner.requested).toBe(2);
  await expect(summary(page)).toContainText('Preparing request');
  expect(await owner.sends()).toBe(1);
  await synchronizeWallet(page); await owner.confirm();
  await expect(summary(page)).toContainText('Execution completed');
  await expect(page.locator('.execution-timeline')).toContainText('Reconciled');
  await expect(summary(page)).toContainText('1 of 1');
  expect(await owner.sends()).toBe(2);
  expect(await durable(id!)).toEqual({ runs: [{ status: 'RECONCILED', has_evidence: true }], attempts: [
    { step: 'APPROVAL', state: 'CONFIRMED', reconciled: true }, { step: 'SWAP', state: 'CONFIRMED', reconciled: true },
  ], evidence: [{ outcome: 'RECONCILED' }] });
  expect((await walletRequests(page)).filter(method => method === 'eth_sendTransaction')).toHaveLength(2);
  await page.getByText('View technical details', { exact: true }).click();
  await expect(page.locator('.execution-evidence-details')).toContainText(id!);
  await expect(page.locator('.execution-evidence-details').getByRole('button', { name: /Copy.*transaction/ })).toHaveCount(2);
  await page.reload(); await stage(page, 'Execute');
  await expect(summary(page)).toContainText('Execution completed');
  await expect(page.locator('.execution-evidence-restored')).toHaveText('This step’s saved result was restored.');
  expect(await pointer(page)).toBe(id); expect(await owner.sends()).toBe(2); expect(owner.requested()).toBe(2);
  expect(errors).toEqual([]); networkGuard.assertClean();
});

test('reload after confirmed approval recovers the same run and refreshes its quote without resending approval', async ({ page, request }) => {
  const owner = await setup(page, request), id = await pointer(page);
  await page.getByRole('button', { name: 'Execute workflow', exact: true }).click(); await owner.confirm();
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Continue to swap', exact: true })).toBeEnabled();
  await page.reload(); await stage(page, 'Execute');
  await expect(summary(page)).toContainText('Current execution restored');
  expect(await pointer(page)).toBe(id); expect(await owner.sends()).toBe(1);
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Continue to swap', exact: true })).toHaveCount(0);
  await stage(page, 'Simulate');
  await page.getByRole('region', { name: 'Simulation workflow graph', exact: true }).getByRole('button', { name: 'Simulate again', exact: true }).click();
  await page.locator('.canvas-primary-action').getByRole('button', { name: 'Approve & Continue', exact: true }).click();
  await stage(page, 'Execute');
  expect(await pointer(page)).toBe(id); expect(await owner.sends()).toBe(1);
  const next = page.locator('.canvas-primary-action').getByRole('button', { name: 'Continue to swap', exact: true });
  await expect(next).toBeEnabled(); await next.click(); await owner.confirm();
  await expect(summary(page)).toContainText('Execution completed');
  expect(await owner.sends()).toBe(2); expect(owner.requested()).toBe(2);
});

test('lost second wallet response stays uncertain across sync and reload and never blindly retries', async ({ page, request }) => {
  const owner = await setup(page, request, 2), id = await pointer(page);
  await page.getByRole('button', { name: 'Execute workflow', exact: true }).click(); await owner.confirm();
  const next = page.locator('.canvas-primary-action').getByRole('button', { name: 'Continue to swap', exact: true });
  await expect(next).toBeEnabled(); await next.click(); await owner.confirm();
  await expect(summary(page)).toContainText('Execution status unresolved');
  await synchronizeWallet(page);
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: /Continue to|Execute workflow|Retry|Try again/ })).toHaveCount(0);
  expect((await durable(id!)).attempts).toMatchObject([{ step: 'APPROVAL', state: 'CONFIRMED' }, { step: 'SWAP', state: 'UNKNOWN' }]);
  expect(await owner.sends()).toBe(2); expect(owner.requested()).toBe(2);
  await page.reload(); await stage(page, 'Execute');
  await expect(summary(page)).toContainText('Execution status unresolved');
  expect(await pointer(page)).toBe(id); expect(await owner.sends()).toBe(2); expect(owner.requested()).toBe(2);
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: /Continue to|Execute workflow|Retry|Try again/ })).toHaveCount(0);
});

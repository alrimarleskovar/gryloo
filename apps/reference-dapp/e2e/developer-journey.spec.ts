// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001 acceptance in a real browser: a third-party server application integrates FloFi end to end with the SDK alone,
 * against the running app on the embedded PostgreSQL runtime with the MOCKED loopback router chains and a loopback webhook receiver
 * (never a public network, never a real transaction):
 *
 *   operator CLI: project + sandbox key (mode-0600 file) → SDK: capabilities, immutable strategy, validate, simulate, webhook endpoint,
 *   approval → the end user opens the approval link: a third-party proposal (not an AI one), sharing OFF until they opt in, wallet
 *   proof, the existing proposal card → the owner's unchanged router flow (fresh simulation, Strategy Manifest Review, two wallet
 *   signatures, reconciliation) → signed webhooks verified by the SDK → SDK: approval status, execution and canonical evidence.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, expect, type Page } from '@playwright/test';
import { FloFi, verifyWebhook, type WebhookEvent } from '../../../packages/developer-sdk/src/index.ts';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';
import { guardedContext, installJourneyWallet, journeyAdvance, journeySends } from './journey-fixtures';
import { assertMcpHarness } from './mcp-fixtures';
import { routerControl } from './router-fixtures';

const STRATEGY = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '1' };
const approval = (page: Page) => page.getByRole('region', { name: 'External proposal' });
const bridge = (page: Page) => page.getByRole('region', { name: 'Cross-chain bridge' });
const stage = (page: Page, name: 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();

/** The operator's CLI against the run's disposable database: one project, one sandbox key written to a new mode-0600 file. */
async function operatorKey(): Promise<{ key: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'flofi-developer-e2e-')), keyFile = join(dir, 'key');
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const cli = (args: string[]) => promisify(execFile)(process.execPath, ['backend/developer-admin.ts', ...args, '--tenant', 'default'], { cwd, timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_DEVELOPER_SECRET: process.env.FLOFI_E2E_DEVELOPER_SECRET! } });
  const project = JSON.parse((await cli(['create-project', '--name', 'Acme Wallet'])).stdout) as { projectId: string };
  await cli(['create-key', '--project', project.projectId, '--key-file', keyFile]);
  return { key: (await readFile(keyFile, 'utf8')).trim(), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test.describe('BUILD-DEVELOPER-001 third-party integration (SDK → FloFi /approve → owner wallet)', () => {
  test.beforeAll(() => {
    assertMcpHarness();
    if (!process.env.FLOFI_E2E_DEVELOPER_SECRET || !process.env.FLOFI_E2E_DEVELOPER_DISPATCH_TOKEN) throw new Error('DEVELOPER_E2E_NOT_CONFIGURED');
  });

  test('a third-party app hands a strategy to its user; the user signs in FloFi; the app gets signed webhooks, status and evidence', async ({ browser }) => {
    test.setTimeout(120_000);
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    const receiver = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { received.push({ headers: req.headers, body }); res.end(); }); });
    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    const owner = createTestWallet(), { key, cleanup } = await operatorKey();
    try {
      await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
      // ── The third-party server ──
      const flofi = new FloFi({ apiKey: key, baseUrl: APP_ORIGIN });
      const row = (await flofi.capabilities.list({ network: 'base-sepolia', action: 'bridge' })).data.find(r => r.destinationNetwork === 'arbitrum-sepolia')!;
      expect(row.operations).toMatchObject({ compose: { available: true }, approve: { available: true }, execute: { available: false } });
      const strategy = await flofi.strategies.create({ strategy: STRATEGY });
      expect((await flofi.strategies.validate(strategy.id)).availability.approvable).toBe(true);
      expect(await flofi.strategies.simulate(strategy.id, { simulationSubject: owner.address })).toMatchObject({ provenance: 'MOCKED', authorizable: false });
      const endpoint = await flofi.webhookEndpoints.create({ url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/flofi` });
      const created = await flofi.approvals.create({ strategy });
      expect(created.approvalUrl).toMatch(new RegExp(`^${APP_ORIGIN.replace(/[.]/g, '\\.')}/approve#flofi_dhs_[A-Za-z0-9_-]{43}$`));
      expect(await journeySends()).toBe(0);

      // ── The end user, in FloFi ──
      const { context, unexpected } = await guardedContext(browser);
      const page = await context.newPage(), errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await installJourneyWallet(page, [owner]);
      await page.goto(created.approvalUrl!);
      const region = approval(page);
      await expect(region).toContainText('EXTERNAL PROPOSAL · FROM ACME WALLET');
      await expect(region).toContainText('Nothing is authorized yet.');
      await expect(region).toContainText('Created by Acme Wallet, a third-party app registered with FloFi, not by FloFi.');
      await expect(region).not.toContainText('AI assistant');
      expect(page.url()).not.toContain('flofi_dhs_');
      // Status sharing with the app is OFF until the user turns it on.
      await expect(region.getByRole('checkbox')).not.toBeChecked();
      await region.getByRole('checkbox').check();
      await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click();
      await expect(region).toContainText(`Signed in as ${owner.address}`);
      await region.getByRole('button', { name: 'Load proposal' }).click();
      await region.getByRole('button', { name: 'Add to my workflow' }).click();
      await expect(region.getByRole('status')).toContainText('Ready for your review.');
      await page.getByRole('button', { name: 'Continue to Simulate' }).click();
      await bridge(page).getByRole('button', { name: 'Get route and simulate' }).click();
      await expect(bridge(page)).toContainText('Strategy Manifest');
      await stage(page, 'Execute');
      await bridge(page).getByRole('button', { name: 'Accept route review' }).click();
      await bridge(page).getByRole('button', { name: /^Execute: Approve exactly 1 USDC/ }).click();
      await expect(bridge(page).getByRole('list', { name: 'Base Sepolia transactions' })).toContainText('Approval: confirmed');
      await bridge(page).getByRole('button', { name: /^Execute: Deposit into the bridge/ }).click();
      await expect(bridge(page).getByRole('list', { name: 'Base Sepolia transactions' })).toContainText('Bridge deposit: confirmed');
      for (let i = 0; i < 15 && !(await bridge(page).getByRole('region', { name: 'Bridge result' }).isVisible()); i++) {
        await journeyAdvance(10);
        await bridge(page).getByRole('button', { name: 'Observe bridge' }).click();
        await expect(bridge(page).getByText('Working…')).toHaveCount(0);
      }
      await expect(bridge(page).getByRole('region', { name: 'Bridge result' })).toBeVisible();
      expect(await journeySends()).toBe(2);
      expect(unexpected).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();

      // ── Back in the third-party server ──
      await expect.poll(async () => (await flofi.approvals.get(created.id)).executions.filter(e => e.reconciled).length, { timeout: 30_000 }).toBe(1);
      const progress = await flofi.approvals.get(created.id);
      expect(progress).toMatchObject({ status: 'APPLIED', statusShared: true, executionsVisible: true, executions: [{ status: 'RECONCILED', evidence: { environment: 'MOCKED' } }] });
      const executionId = progress.executions[0]!.id;
      expect(await flofi.executions.get(executionId)).toMatchObject({ approvalId: created.id, reconciled: true, owner: owner.address, provenance: 'MOCKED' });
      expect((await flofi.executions.evidence(executionId)).evidence).toMatchObject({ environment: 'MOCKED', canonical: true });
      // The deployment's scheduler delivers the run's notifications (the claim and apply ones went out right after /approve).
      const dispatch = await fetch(`${APP_ORIGIN}/api/developer/v1/internal/dispatch`, { headers: { authorization: `Bearer ${process.env.FLOFI_E2E_DEVELOPER_DISPATCH_TOKEN}` } });
      expect(dispatch.status).toBe(200);
      await expect.poll(() => received.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
      const events: WebhookEvent[] = [];
      for (const r of received) events.push(await verifyWebhook({ payload: r.body, headers: r.headers as Record<string, string>, secret: endpoint.secret! }));
      expect(events.map(e => e.type).sort()).toEqual(['approval.applied', 'approval.claimed', 'execution.reconciled', 'execution.started']);
      expect(events.find(e => e.type === 'execution.reconciled')!.data).toMatchObject({ approvalId: created.id, executionId, evidence: { environment: 'MOCKED' } });
      expect(received.map(r => r.body).join('')).not.toMatch(/flofi_sk_|flofi_dhs_|whsec_|calldata/);
      expect(await journeySends()).toBe(2);
    } finally {
      await cleanup();
      await new Promise(resolve => receiver.close(resolve));
    }
  });
});

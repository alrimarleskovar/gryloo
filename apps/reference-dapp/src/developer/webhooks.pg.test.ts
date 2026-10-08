// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: webhook notifications on a disposable loopback PostgreSQL (loopback HTTP and in-memory transports only — no
 * network). Events are derived from FloFi's own state and deduplicated; deliveries are signed per Standard Webhooks with a stable
 * `webhook-id`, leased to one dispatcher, retried on the fixed schedule and dead after ten attempts; a failing endpoint changes no
 * FloFi outcome; rotation by replacement works with two secrets; /approve transitions notify at once; the scheduler endpoint is
 * bearer-protected; payloads carry no wallet, secret or executable material.
 */
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { applyApproval, claimApproval, createPgHandoffStore, shareApproval, type WalletRef } from '../platform/index.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { developerApi, developerConfig, developerEnv, developerProject, ORIGIN, recordingRuntime, type ApiResponse } from './developer.test-harness.ts';
import { deriveEvents } from './events.ts';
import { developerApprovalChanged, dispatchDeliveries, nextAttemptAt, syncAndDispatch, WEBHOOK_MAX_ATTEMPTS, type WebhookRequest, type WebhookTransport } from './dispatch.ts';
import { createPgDeveloperStore } from './pg-store.ts';
import type { ApprovalBinding } from './store.ts';
import { signWebhook, webhookSecret, webhookSecretBytes } from './webhooks.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const OWNER = '0x' + '1'.repeat(40), WALLET: WalletRef = { namespace: 'eip155', address: OWNER };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const composed = composeStrategy(BRIDGE);
if (!composed.ok) throw new Error(composed.code);
const LOOPBACK_ENV = developerEnv({ FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY' });
/** An in-memory endpoint: records every request and answers with the next scripted status (default 200). */
function inbox(statuses: number[] = []) {
  const received: WebhookRequest[] = [];
  const transport: WebhookTransport = async request => { received.push(request); return { status: statuses.shift() ?? 200 }; };
  return { received, transport };
}
/** Standard Webhooks verification, written independently of FloFi's signer. */
function verifies(secret: string, request: { headers: Record<string, string>; body: string }): boolean {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const expected = createHmac('sha256', key).update(`${request.headers['webhook-id']}.${request.headers['webhook-timestamp']}.${request.body}`).digest('base64');
  return request.headers['webhook-signature']!.split(' ').includes(`v1,${expected}`);
}
/** A project with a strategy, an endpoint and an approval claimed and applied by WALLET through /approve. */
async function claimedApproval(api: ReturnType<typeof developerApi>, share: boolean, runtime = recordingRuntime()) {
  const strategy = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
  const approval = (await api<{ id: string; approvalUrl: string }>('POST', '/approvals', { strategyId: strategy.id, workflowHash: strategy.workflowHash })).body;
  const secret = decodeURIComponent(new URL(approval.approvalUrl).hash.slice(1));
  const surface = await approvalSurface(LOOPBACK_ENV, () => undefined, { host: { db: t.db, tenantId: 'default' }, runtime });
  await claimApproval(surface, secret, [WALLET], share);
  await applyApproval(surface, secret, [WALLET], composed.ok ? composed.workflow : null);
  return { strategy, approval, secret, surface };
}

describe('BUILD-DEVELOPER-001 webhook events and signatures', () => {
  it('derives exactly the events FloFi\'s state implies, with stable dedupe keys and no wallet', () => {
    const binding: ApprovalBinding = { handoffId: 'apr_a', projectId: 'prj_a', environment: 'sandbox', strategyId: 'str_a', workflowHash: '0x' + 'ab'.repeat(32),
      syncState: 'OPEN', createdAt: new Date() };
    const h = { handoffId: 'apr_a', workflowHash: binding.workflowHash, status: 'APPLIED', claimedAt: new Date(), appliedAt: new Date(), claimed: WALLET } as never;
    const runs = [{ executionId: 'run-ok', flow: 'f', status: 'RECONCILED', reconciled: true, terminal: true, errorCode: null, evidenceEnvironment: 'MOCKED',
      evidenceOutcome: 'RECONCILED', evidenceBundleHash: '0x' + '2'.repeat(64), updatedAt: '' }, { executionId: 'run-bad', flow: 'f', status: 'FAILED', reconciled: false,
      terminal: true, errorCode: 'REVERTED', evidenceEnvironment: null, evidenceOutcome: null, evidenceBundleHash: null, updatedAt: '' }];
    const events = deriveEvents(binding, h, runs);
    expect(events.map(e => e.dedupeKey)).toEqual(['approval.claimed:apr_a', 'approval.applied:apr_a', 'execution.started:run-ok', 'execution.reconciled:run-ok',
      'execution.started:run-bad', 'execution.failed:run-bad']);
    expect(events.find(e => e.type === 'execution.reconciled')!.data).toEqual({ approvalId: 'apr_a', strategyId: 'str_a', workflowHash: binding.workflowHash,
      executionId: 'run-ok', status: 'RECONCILED', evidence: { environment: 'MOCKED', outcome: 'RECONCILED', bundleHash: '0x' + '2'.repeat(64) } });
    expect(JSON.stringify(events)).not.toContain(OWNER.slice(2));
    expect(deriveEvents(binding, { ...h as object, status: 'EXPIRED', appliedAt: null, claimedAt: null } as never, null).map(e => e.type)).toEqual(['approval.ended']);
  });

  it('signs per Standard Webhooks with a derived per-endpoint secret; a changed body or timestamp no longer verifies', () => {
    const config = developerConfig(), secret = webhookSecret(config, 'default', 'whe_' + 'a'.repeat(26));
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(webhookSecret(config, 'default', 'whe_' + 'b'.repeat(26))).not.toBe(secret);
    expect(webhookSecret(config, 'other', 'whe_' + 'a'.repeat(26))).not.toBe(secret);
    expect(webhookSecret(developerConfig(developerEnv({ FLOFI_DEVELOPER_SECRET: 'q'.repeat(48) })), 'default', 'whe_' + 'a'.repeat(26))).not.toBe(secret);
    const body = '{"id":"evt_x"}', signature = signWebhook(webhookSecretBytes(config, 'default', 'whe_' + 'a'.repeat(26)), 'evt_x', 1_800_000_000, body);
    const headers = { 'webhook-id': 'evt_x', 'webhook-timestamp': '1800000000', 'webhook-signature': signature };
    expect(verifies(secret, { headers, body })).toBe(true);
    expect(verifies(secret, { headers, body: body + ' ' })).toBe(false);
    expect(verifies(secret, { headers: { ...headers, 'webhook-timestamp': '1800000001' }, body })).toBe(false);
  });

  it('retries on the fixed schedule with bounded jitter, and stops after ten attempts', () => {
    const now = new Date('2026-10-07T00:00:00Z'), at = (attempts: number, r: number) => (nextAttemptAt(attempts, now, () => r)!.getTime() - now.getTime()) / 1000;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => at(n, 0.5))).toEqual([30, 120, 600, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400]);
    expect([at(1, 0), at(1, 1)]).toEqual([24, 36]);
    expect(nextAttemptAt(WEBHOOK_MAX_ATTEMPTS, now)).toBeNull();
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(10);
  });
});

describe('BUILD-DEVELOPER-001 webhook delivery', () => {
  it('notifies at once after /approve transitions, over the loopback transport, signed and verifiable; nothing depends on the receiver', async () => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    let answer = 500;
    const server = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { received.push({ headers: req.headers, body }); res.statusCode = answer; res.end('x'.repeat(5_000)); }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/flofi`;
      const p = await developerProject(t.db), runtime = recordingRuntime(), api = developerApi({ db: t.db, runtime, env: LOOPBACK_ENV }, p.key);
      const endpoint = (await api<{ id: string; secret: string }>('POST', '/webhook-endpoints', { url })).body;
      const { approval, secret } = await claimedApproval(api, false, runtime);
      // The /approve hook (what the server actions schedule with after()), on the deployment's embedded runtime.
      const env = { ...LOOPBACK_ENV, FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url };
      await developerApprovalChanged(env, secret);
      expect(received.map(r => JSON.parse(r.body).type).sort()).toEqual(['approval.applied', 'approval.claimed']);
      for (const r of received) {
        expect(r.headers).toMatchObject({ 'content-type': 'application/json', 'user-agent': 'FloFi-Webhooks/1', 'flofi-delivery-attempt': '1' });
        expect(verifies(endpoint.secret, { headers: r.headers as Record<string, string>, body: r.body })).toBe(true);
        expect(JSON.parse(r.body)).toMatchObject({ id: r.headers['webhook-id'], object: 'event', apiVersion: 'v1', environment: 'sandbox',
          data: { approvalId: approval.id, workflowHash: composed.ok ? composed.workflowHash : '' } });
        expect(r.body).not.toMatch(new RegExp(`${OWNER.slice(2)}|flofi_dhs_|whsec_|flofi_sk_`));
      }
      // The receiver answered 500: FloFi's approval is exactly as the owner left it; the deliveries wait for their retry.
      expect((await api<{ status: string }>('GET', `/approvals/${approval.id}`)).body.status).toBe('APPLIED');
      const rows = (await t.db.query(`SELECT status, attempts, last_status, last_error FROM developer_webhook_deliveries WHERE endpoint_id = $1`, [endpoint.id])).rows;
      expect(rows).toEqual([{ status: 'PENDING', attempts: 1, last_status: 500, last_error: 'HTTP_STATUS' }, { status: 'PENDING', attempts: 1, last_status: 500, last_error: 'HTTP_STATUS' }]);
      // A second hook call derives nothing new and sends nothing (the retries are not due yet).
      await developerApprovalChanged(env, secret);
      expect(received).toHaveLength(2);
      // Other links are not the developer hook's business.
      await developerApprovalChanged(env, 'flofi_hs_' + 'a'.repeat(43));
      await developerApprovalChanged({ ...env, FLOFI_DEVELOPER: 'disabled' }, secret);
      // Once due, the retry carries the same webhook-id and succeeds.
      answer = 204;
      await t.db.query(`UPDATE developer_webhook_deliveries SET next_attempt_at = now() WHERE endpoint_id = $1`, [endpoint.id]);
      const store = createPgDeveloperStore(t.db, 'default');
      expect(await dispatchDeliveries({ config: developerConfig(LOOPBACK_ENV), tenantId: 'default', store }, {}, 10)).toEqual({ attempted: 2, succeeded: 2, retrying: 0, dead: 0 });
      expect(received.slice(2).map(r => r.headers['webhook-id']).sort()).toEqual(received.slice(0, 2).map(r => r.headers['webhook-id']).sort());
      expect(received.slice(2).every(r => r.headers['flofi-delivery-attempt'] === '2')).toBe(true);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('dies after ten attempts on the schedule, and a failing endpoint never touches FloFi\'s outcomes', async () => {
    const p = await developerProject(t.db), runtime = recordingRuntime(), store = createPgDeveloperStore(t.db, 'default');
    const box = inbox(Array(20).fill(503)), api = developerApi({ db: t.db, runtime, env: LOOPBACK_ENV, transport: box.transport }, p.key);
    await api('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/dead' });
    const { approval } = await claimedApproval(api, false, runtime);
    let clock = Date.now() + 60_000;
    const deps = { config: developerConfig(LOOPBACK_ENV), tenantId: 'default', store, handoffs: createPgHandoffStore(t.db, 'default'), runtime, transport: box.transport,
      now: () => new Date(clock), random: () => 0.5 };
    await syncAndDispatch(deps, { scope: { projectId: p.projectId, environment: 'sandbox' } }, { approvals: 5, deliveries: 10 });
    for (let attempt = 2; attempt <= WEBHOOK_MAX_ATTEMPTS + 2; attempt++) {
      clock += 86_400_000 + 1_000;
      await dispatchDeliveries(deps, { scope: { projectId: p.projectId, environment: 'sandbox' } }, 10);
    }
    const rows = (await t.db.query(`SELECT d.status, d.attempts, d.last_status FROM developer_webhook_deliveries d WHERE d.project_id = $1`, [p.projectId])).rows;
    expect(rows).toEqual([{ status: 'DEAD', attempts: 10, last_status: 503 }, { status: 'DEAD', attempts: 10, last_status: 503 }]);
    expect(box.received).toHaveLength(20);
    // Every attempt of one event carried that event's id.
    expect(new Set(box.received.map(r => r.headers['webhook-id'])).size).toBe(2);
    expect((await api<{ status: string; applied: boolean }>('GET', `/approvals/${approval.id}`)).body).toMatchObject({ status: 'APPLIED', applied: true });
  });

  it('rotates by replacement: both secrets verify during the overlap with one webhook-id, and a deleted endpoint receives nothing more', async () => {
    const p = await developerProject(t.db), runtime = recordingRuntime(), store = createPgDeveloperStore(t.db, 'default'), box = inbox();
    const api = developerApi({ db: t.db, runtime, env: LOOPBACK_ENV, transport: box.transport }, p.key);
    const old = (await api<{ id: string; secret: string; url: string }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/old' })).body;
    const fresh = (await api<{ id: string; secret: string; url: string }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/new' })).body;
    const first = await claimedApproval(api, false, runtime);
    const deps = { config: developerConfig(LOOPBACK_ENV), tenantId: 'default', store, handoffs: createPgHandoffStore(t.db, 'default'), runtime, transport: box.transport };
    await syncAndDispatch(deps, { handoffId: first.approval.id }, { approvals: 1, deliveries: 10 });
    const claimed = box.received.filter(r => JSON.parse(r.body).type === 'approval.claimed');
    expect(claimed.map(r => r.url).sort()).toEqual([fresh.url, old.url].sort());
    expect(new Set(claimed.map(r => r.headers['webhook-id'])).size).toBe(1);
    for (const r of claimed) expect([verifies(old.secret, r), verifies(fresh.secret, r)]).toEqual([r.url === old.url, r.url === fresh.url]);

    expect((await api('DELETE', `/webhook-endpoints/${old.id}`)).status).toBe(200);
    const second = await claimedApproval(api, false, runtime);
    await syncAndDispatch(deps, { handoffId: second.approval.id }, { approvals: 1, deliveries: 10 });
    expect(box.received.filter(r => r.body.includes(second.approval.id)).map(r => r.url)).toEqual([fresh.url, fresh.url]);
  });

  it('leases each delivery to one dispatcher: concurrent sweeps never send an attempt twice', async () => {
    const p = await developerProject(t.db), runtime = recordingRuntime(), store = createPgDeveloperStore(t.db, 'default');
    const sent: string[] = [];
    const slow: WebhookTransport = async request => { sent.push(String(request.headers['flofi-delivery-id'])); await new Promise(r => setTimeout(r, 50)); return { status: 200 }; };
    const api = developerApi({ db: t.db, runtime, env: LOOPBACK_ENV, transport: slow }, p.key);
    for (const i of [1, 2, 3]) await api('POST', '/webhook-endpoints', { url: `https://hooks.example.com/${i}` });
    const { approval } = await claimedApproval(api, false, runtime);
    const deps = { config: developerConfig(LOOPBACK_ENV), tenantId: 'default', store, handoffs: createPgHandoffStore(t.db, 'default'), runtime, transport: slow };
    await syncAndDispatch({ ...deps, transport: async () => { throw new Error('WEBHOOK_NOT_YET'); } }, { handoffId: approval.id }, { approvals: 1, deliveries: 0 });
    const results = await Promise.all([1, 2, 3, 4].map(() => dispatchDeliveries(deps, { scope: { projectId: p.projectId, environment: 'sandbox' } }, 10)));
    expect(results.reduce((n, r) => n + r.attempted, 0)).toBe(6);
    expect(sent).toHaveLength(6);
    expect(new Set(sent).size).toBe(6);
  });

  it('shares run events only while the owner shares status', async () => {
    const p = await developerProject(t.db), box = inbox(), store = createPgDeveloperStore(t.db, 'default');
    let claimedAt = 0;
    const runtime = recordingRuntime({
      runList: async (flow, owner) => ({ ok: true, value: owner === OWNER && claimedAt ? [{ runId: 'run-hook-1', flow, status: 'RECONCILED', ownerAccount: owner, hasEvidence: true,
        updatedAt: new Date(claimedAt + 5_000).toISOString() }] : [] }),
      runs: async (runId, owner) => ({ ok: true, value: owner === OWNER && claimedAt ? { runId, workflowId: 'w', flow: 'crosschain-router-testnet', status: 'RECONCILED',
        provenance: 'MOCKED', ownerAccount: owner, errorCode: null, needsObservation: false, attentionRequired: false, hasEvidence: true,
        createdAt: new Date(claimedAt + 1_000).toISOString(), updatedAt: new Date(claimedAt + 5_000).toISOString(), attempts: [] } : null }),
      record: async () => ({ ok: true, value: { review: { workflow: composed.ok ? composed.workflow : null } } }),
      evidence: async () => ({ ok: true, value: { bundleHash: '0x' + '9'.repeat(64), environment: 'MOCKED', outcome: 'RECONCILED', content: {} } }) });
    const api = developerApi({ db: t.db, runtime, env: LOOPBACK_ENV, transport: box.transport }, p.key);
    await api('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/runs', events: ['execution.reconciled', 'execution.started'] });
    const { approval, secret, surface } = await claimedApproval(api, false, runtime);
    claimedAt = Date.now();
    const deps = { config: developerConfig(LOOPBACK_ENV), tenantId: 'default', store, handoffs: createPgHandoffStore(t.db, 'default'), runtime, transport: box.transport };
    await syncAndDispatch(deps, { handoffId: approval.id }, { approvals: 1, deliveries: 10 });
    expect(box.received).toEqual([]);
    await shareApproval(surface, secret, [WALLET], true);
    await syncAndDispatch(deps, { handoffId: approval.id }, { approvals: 1, deliveries: 10 });
    expect(box.received.map(r => JSON.parse(r.body)).map(e => [e.type, e.data.executionId])).toEqual(expect.arrayContaining([['execution.started', 'run-hook-1'],
      ['execution.reconciled', 'run-hook-1']]));
    expect(box.received).toHaveLength(2);
    expect(JSON.parse(box.received.find(r => r.body.includes('execution.reconciled'))!.body).data.evidence).toEqual({ environment: 'MOCKED', outcome: 'RECONCILED',
      bundleHash: '0x' + '9'.repeat(64) });
    expect((await t.db.query(`SELECT count FROM developer_usage WHERE project_id = $1 AND metric = 'execution.reconciled'`, [p.projectId])).rows).toEqual([{ count: '1' }]);
  });
});

describe('BUILD-DEVELOPER-001 scheduler endpoint', () => {
  it('exists only with a configured token digest and runs one bounded sweep for a valid bearer', async () => {
    const token = 'scheduler-token-'.padEnd(40, 'z'), runtime = recordingRuntime(), p = await developerProject(t.db);
    const call = async (env: Record<string, string>, headers: Record<string, string>, method = 'GET'): Promise<ApiResponse> => developerApi({ db: t.db, runtime, env }, null)(method,
      '/internal/dispatch', undefined, headers);
    expect((await call(LOOPBACK_ENV, { authorization: `Bearer ${token}` })).status).toBe(404);
    const env = { ...LOOPBACK_ENV, FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') };
    expect((await call(env, { authorization: 'Bearer wrong-token-of-sufficient-length' })).status).toBe(401);
    expect((await call(env, {})).status).toBe(401);
    expect((await call(env, { authorization: `Bearer ${p.key}` })).status).toBe(401);
    expect((await call(env, { authorization: `Bearer ${token}`, origin: ORIGIN })).status).toBe(403);
    const ok = await call(env, { authorization: `Bearer ${token}` });
    expect([ok.status, ok.body]).toEqual([200, { object: 'dispatch', approvalsSynced: expect.any(Number), deliveries: { attempted: expect.any(Number), succeeded: expect.any(Number),
      retrying: expect.any(Number), dead: expect.any(Number) } }]);
    expect((await call(env, { authorization: `Bearer ${token}` }, 'POST')).status).toBe(200);
    expect((await call(env, { authorization: `Bearer ${token}` }, 'DELETE')).status).toBe(405);
  });
});

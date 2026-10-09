// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001 on FloFi's production topology — Vercel BFF → Railway API → PostgreSQL, plus the Railway worker — on a disposable
 * loopback PostgreSQL: the REAL API HTTP server (its existing routes plus the automation routes, behind the bearer token) and the REAL BFF
 * functions the server actions call (remote runtime: `API_BASE_URL`; the web process has no database and no automation variable).
 *
 *   the owner's workspace through the API (same views as in process) → only the verified owner crosses the boundary, and the API
 *   enforces it on its own → wallet A / wallet B isolation → a remotely created automation is evaluated by the worker's sweep (no cron),
 *   even racing the protected dispatch: one occurrence → Review in FloFi on the API's shared approval model (view / claim / apply) → the
 *   worker completes it. Throughout, the API makes no flow call beyond the read-only `mode` / `info` gates: nothing is signed or submitted.
 */
import { createHttpServer, createLogger, createPostgresWorkQueue, createWorker, type Database } from '@defi-workflow-engine/cloud-runtime';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createBackend, type Backend } from '../../backend/app.ts';
import { composeStrategy } from '../engine/strategy-engine';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { automationAvailability, automationOperation, remoteApproval, remoteAutomationApproval } from '../server/automation-operation';
import { automationApiRoutes } from './api.ts';
import { automationHarness, OWNER_A, OWNER_B, weeklyDca } from './automation.test-harness.ts';
import { dispatchAutomations } from './dispatch.ts';
import type { OverviewView, RuleView } from './views.ts';
import { automationWorkerParts, type AutomationWorkerParts } from './worker.ts';

let t: TestDatabase;
const quiet = createLogger({ service: 'test', sink: () => undefined });
const TOKEN = 'remote-api-token-'.padEnd(48, 'x');
const API_ENV = { FLOFI_AUTOMATIONS: 'enabled', FLOFI_AUTOMATION_SECRET: 'remote-automation-secret-'.padEnd(64, 's'), FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3999',
  GRYLOO_PUBLIC_TESTNET: 'record' };
let clock = new Date('2026-10-08T10:00:00Z');
const now = () => new Date(clock.getTime());
let server: ReturnType<typeof createHttpServer>, base = '', flowCalls: string[] = [];
const sent: { url: string; headers: Record<string, string> }[] = [];
const transport: typeof fetch = async (url, init) => { sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } }); return fetch(url, init); };
const web = () => ({ env: { API_BASE_URL: base, API_AUTH_TOKEN: TOKEN }, transport });
const as = (owner: WorkflowOwner, principals: readonly WorkflowOwner[] = [owner]) => ({ ...web(), principals: async () => principals });
const op = <T>(owner: WorkflowOwner, method: Parameters<typeof automationOperation>[0], args: readonly unknown[], principals?: readonly WorkflowOwner[]) =>
  automationOperation<T>(method, args, owner, as(owner, principals));
const value = <T>(result: { ok: true; value: T } | { ok: false; code: string }): T => { if (!result.ok) throw new Error(result.code); return result.value; };
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (e) { return e instanceof Error ? e.message : String(e); } };

beforeAll(async () => {
  t = await createTestDatabase();
  const backend = createBackend({ db: t.db, env: API_ENV, logger: quiet, tenantId: 'default', holderId: 'api-test', evidenceStore: null });
  // Every flow call the automation routes make is recorded: only the read-only gates may appear.
  const watched: Backend = { ...backend, callFlow: (flow, method, ...rest) => { flowCalls.push(method); return backend.callFlow(flow, method, ...rest); },
    previewFlow: (flow, args) => { flowCalls.push('preview'); return backend.previewFlow(flow, args); } };
  server = createHttpServer({ routes: [...backend.routes, ...automationApiRoutes(API_ENV, { db: t.db, tenantId: 'default', backend: watched, logger: quiet, now })],
    logger: quiet, authToken: TOKEN });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server?.close(); await t?.drop(); });
beforeEach(async () => {
  await t.db.query('TRUNCATE automation_notifications, automation_evaluations, automation_occurrences, automation_rules, automation_link_codes, work_items, mcp_handoffs, mcp_rate_limits, api_idempotency CASCADE');
  clock = new Date('2026-10-08T10:00:00Z'); sent.length = 0; flowCalls = [];
});

/** The Railway worker as `main.ts worker` builds it, with this test's clock and a price source (none is needed by a DCA). */
function railwayWorker(db: Database = t.db, workerId = 'railway') {
  const h = automationHarness(db), automations = automationWorkerParts({ FLOFI_AUTOMATIONS: 'enabled', FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3999' }, db, 'default', quiet,
    { now, price: h.prices.source }) as AutomationWorkerParts;
  const tenantQueue = createPostgresWorkQueue({ db, ownerId: workerId, tenantId: 'default' });
  const worker = createWorker({ queue: { ...tenantQueue, claim: (limit: number) => tenantQueue.claim(limit, Object.keys(automations.handlers)) },
    handlers: automations.handlers, logger: quiet, workerId, sweep: automations.sweep });
  return async () => { await automations.sweep(); let total = 0, n: number; do { n = await worker.drainOnce(); total += n; } while (n > 0); return total; };
}
const MONDAY_SLOT = '2026-10-12T08:00:40Z';

describe('BUILD-AUTOMATION-001 on the remote runtime (Vercel BFF → Railway API → PostgreSQL + Railway worker)', () => {
  it('serves the workspace through the API with the verified owner only: create, overview, pause/resume, history — the views the embedded runtime returns', async () => {
    expect(await automationAvailability(web())).toEqual({ enabled: true, code: null });
    const created = value(await op<RuleView>(OWNER_A, 'create', [weeklyDca()]));
    expect(created).toMatchObject({ name: 'Weekly ETH', state: 'ACTIVE', executionMode: 'CONFIRM_EACH_TIME' });
    const create = sent.find(s => s.url.endsWith('/v1/automations/create'))!;
    expect(create.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'x-flofi-workflow-owner': `eip155:${OWNER_A.address}`, 'idempotency-key': expect.any(String) });
    const paused = value(await op<RuleView>(OWNER_A, 'setState', [created.ruleId, created.version, 'PAUSE']));
    expect(paused.state).toBe('PAUSED');
    expect(await op(OWNER_A, 'setState', [created.ruleId, created.version, 'RESUME'])).toEqual({ ok: false, code: 'AUTOMATION_VERSION_CONFLICT' });
    const resumed = value(await op<RuleView>(OWNER_A, 'setState', [created.ruleId, paused.version, 'RESUME']));
    expect(resumed.state).toBe('ACTIVE');
    const overview = value(await op<OverviewView>(OWNER_A, 'overview', []));
    expect(overview.rules.map(r => [r.ruleId, r.state])).toEqual([[created.ruleId, 'ACTIVE']]);
    expect(value(await op<{ entries: unknown[] }>(OWNER_A, 'history', [created.ruleId])).entries.length).toBeGreaterThan(0);
    // The same views the in-process (embedded) runtime builds from the same database.
    const local = automationHarness(t.db).service();
    expect(JSON.parse(JSON.stringify((await local.overview(OWNER_A)).rules))).toEqual(overview.rules);
    // Only the bearer, the verified owner and (for create) an idempotency key crossed the boundary — nothing the browser supplied.
    for (const s of sent) expect([s.url, Object.keys(s.headers).filter(k => !['content-type', 'authorization', 'x-flofi-workflow-owner', 'idempotency-key'].includes(k))])
      .toEqual([s.url, []]);
    expect(sent.filter(s => s.headers['idempotency-key']).map(s => s.url.split('/').pop())).toEqual(['create']);
  });

  it('only a verified owner crosses the boundary, and the API refuses on its own anything without a well-formed owner', async () => {
    // An unproven owner (or a proof of another wallet) never reaches the API.
    expect(await op(OWNER_A, 'overview', [], [])).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await op(OWNER_A, 'overview', [], [OWNER_B])).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(sent).toEqual([]);
    const post = (path: string, headers: Record<string, string>, body: unknown = { args: [] }) => fetch(`${base}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => [r.status, (await r.json() as { code?: string }).code]);
    expect(await post('/v1/automations/overview', {})).toEqual([401, 'UNAUTHORIZED']);
    expect(await post('/v1/automations/overview', { authorization: `Bearer ${TOKEN}` })).toEqual([401, 'WALLET_SESSION_REQUIRED']);
    expect(await post('/v1/automations/overview', { authorization: `Bearer ${TOKEN}`, 'x-flofi-workflow-owner': OWNER_A.address })).toEqual([401, 'WALLET_SESSION_REQUIRED']);
    expect(await post('/v1/automations/overview', { authorization: `Bearer ${TOKEN}`, 'x-flofi-workflow-owner': `eip155:${OWNER_A.address.toUpperCase()}` }))
      .toEqual([401, 'WALLET_SESSION_REQUIRED']);
    expect(await post('/v1/automations/create', { authorization: `Bearer ${TOKEN}`, 'x-flofi-workflow-owner': `eip155:${OWNER_A.address}` }, { args: [weeklyDca()] }))
      .toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
    expect(await post('/v1/automations/runFlow', { authorization: `Bearer ${TOKEN}`, 'x-flofi-workflow-owner': `eip155:${OWNER_A.address}` })).toEqual([404, 'AUTOMATION_OPERATION_UNKNOWN']);
    expect(await post('/v1/approvals/view', { authorization: `Bearer ${TOKEN}`, 'x-flofi-wallet-principals': `eip155:${OWNER_A.address},eip155:${OWNER_B.address}` },
      { args: ['flofi_auhs_x'] })).toEqual([400, 'WALLET_PRINCIPAL_INVALID']);
    expect(await t.db.query('SELECT count(*)::int AS n FROM automation_rules').then(r => r.rows[0])).toEqual({ n: 0 });
  });

  it('isolates wallet A from wallet B across the remote boundary: B never finds, changes, opens, dismisses or claims A’s automation', async () => {
    const rule = value(await op<RuleView>(OWNER_A, 'create', [weeklyDca()]));
    clock = new Date(MONDAY_SLOT);
    await railwayWorker()();
    const occurrence = value(await op<OverviewView>(OWNER_A, 'overview', [])).pending[0]!;
    expect(value(await op<OverviewView>(OWNER_B, 'overview', []))).toMatchObject({ rules: [], pending: [] });
    for (const [method, args] of [['history', [rule.ruleId]], ['setState', [rule.ruleId, rule.version, 'PAUSE']], ['rebind', [rule.ruleId, rule.version]]] as const)
      expect([method, await op(OWNER_B, method, args)]).toEqual([method, { ok: false, code: 'AUTOMATION_NOT_FOUND' }]);
    for (const method of ['open', 'dismiss'] as const)
      expect([method, await op(OWNER_B, method, [occurrence.occurrenceId])]).toEqual([method, { ok: false, code: 'AUTOMATION_OCCURRENCE_NOT_FOUND' }]);
    // A's approval link, even in B's hands with B's proven wallet, cannot be claimed.
    const opened = value(await op<{ approvalUrl: string }>(OWNER_A, 'open', [occurrence.occurrenceId]));
    const secret = decodeURIComponent(new URL(opened.approvalUrl).hash.slice(1));
    expect(await refusal(remoteApproval('claim', [secret, false], as(OWNER_B)))).toBe('AUTOMATION_OWNER_MISMATCH');
    expect((await t.db.query('SELECT state FROM automation_rules WHERE rule_id = $1', [rule.ruleId])).rows[0]).toEqual({ state: 'ACTIVE' });
  });

  it('a remotely created automation is evaluated by the Railway worker’s sweep — no cron — and racing the protected dispatch still yields one occurrence', async () => {
    const rule = value(await op<RuleView>(OWNER_A, 'create', [weeklyDca()]));
    clock = new Date('2026-10-12T07:59:00Z');
    expect(await railwayWorker()()).toBe(0);
    clock = new Date(MONDAY_SLOT);
    const h = automationHarness(t.db);
    const dispatch = () => dispatchAutomations(automationWorkerless(h), createPostgresWorkQueue({ db: t.open(3), ownerId: 'web', tenantId: 'default' }), quiet, 'web');
    await Promise.all([railwayWorker(t.open(3), 'railway-1')(), dispatch(), railwayWorker(t.open(3), 'railway-2')(), dispatch()]);
    expect((await t.db.query('SELECT trigger_key, state FROM automation_occurrences WHERE rule_id = $1', [rule.ruleId])).rows)
      .toEqual([{ trigger_key: 'slot:2026-10-12T09:00', state: 'PENDING_OWNER' }]);
    expect(await t.db.query(`SELECT count(*)::int AS n FROM work_items WHERE kind = 'automation.evaluate' AND state <> 'DONE'`).then(r => r.rows[0])).toEqual({ n: 0 });
    expect(value(await op<OverviewView>(OWNER_A, 'overview', [])).pending.map(o => o.ruleId)).toEqual([rule.ruleId]);
  });

  it('the occurrence enters the shared approval model on the API: open → /approve view, claim, apply → the worker completes it; nothing is signed', async () => {
    value(await op<RuleView>(OWNER_A, 'create', [weeklyDca()]));
    clock = new Date(MONDAY_SLOT);
    await railwayWorker()();
    const occurrence = value(await op<OverviewView>(OWNER_A, 'overview', [])).pending[0]!;
    const opened = value(await op<{ approvalUrl: string }>(OWNER_A, 'open', [occurrence.occurrenceId]));
    expect(opened.approvalUrl).toMatch(/^http:\/\/127\.0\.0\.1:3999\/approve#flofi_auhs_[A-Za-z0-9_-]{43}$/);
    const secret = decodeURIComponent(new URL(opened.approvalUrl).hash.slice(1));
    // /approve forwards only automation links on the remote runtime; every other link kind is served as before.
    expect(remoteAutomationApproval(secret, web().env)).toBe(true);
    expect(remoteAutomationApproval('flofi_hs_' + 'a'.repeat(43), web().env)).toBe(false);
    expect(remoteAutomationApproval(secret, { DATABASE_URL: 'postgres://x', FLOFI_RUNTIME: 'embedded' })).toBe(false);
    const view = await remoteApproval<{ authorized: boolean; authority: string; requesterKind: string; status: string }>('view', [secret], as(OWNER_A));
    expect(view).toMatchObject({ authorized: false, authority: 'NONE', requesterKind: 'AUTOMATION_RULE', status: 'PENDING' });
    expect(await refusal(remoteApproval('claim', [secret, false], as(OWNER_A, [])))).toBe('EVM_WALLET_PROOF_REQUIRED');
    const claimed = await remoteApproval<{ command: { type: string; amount: string }; workflowHash: string }>('claim', [secret, false], as(OWNER_A));
    const canonical = composeStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 });
    if (!canonical.ok) throw new Error(canonical.code);
    expect(claimed).toMatchObject({ command: { type: 'ADD_TESTNET_SWAP', amount: '50' }, workflowHash: canonical.workflowHash });
    expect(await refusal(remoteApproval('apply', [secret, { ...canonical.workflow, revision: 99 }], as(OWNER_A)))).toBe('HANDOFF_WORKFLOW_MISMATCH');
    expect((await remoteApproval<{ status: string }>('apply', [secret, canonical.workflow], as(OWNER_A))).status).toBe('APPLIED');
    await railwayWorker()();
    expect((await t.db.query('SELECT state, outcome FROM automation_occurrences WHERE occurrence_id = $1', [occurrence.occurrenceId])).rows[0])
      .toEqual({ state: 'COMPLETED', outcome: 'APPROVAL_APPLIED' });
    expect(value(await op<OverviewView>(OWNER_A, 'overview', [])).pending).toEqual([]);
    // The API's automation routes made no flow call beyond the read-only gates (which did run through the API's own backend): no
    // simulation, run, record, signature or submission.
    expect(flowCalls).toContain('mode');
    expect([...new Set(flowCalls)].filter(m => m !== 'mode' && m !== 'info')).toEqual([]);
  });
});

/** The web deployment's dispatch runtime on the same database (as an embedded Preview would run it), sharing this test's clock. */
function automationWorkerless(h: ReturnType<typeof automationHarness>) {
  const rt = h.rt(t.open(3));
  return { ...rt, now };
}
vi.setConfig({ testTimeout: 120_000 });

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API's HTTP boundary on a disposable loopback PostgreSQL. Server-side sandbox keys only: missing,
 * malformed, unknown, revoked and disabled credentials are refused alike; live keys and browser contexts are refused before any
 * lookup; scopes gate every resource; projects never see each other's resources (byte-identical 404s); requests are closed-schema;
 * creating POSTs are idempotent without ever storing an approval link or a webhook secret; the project's rates are enforced; webhook
 * endpoints are validated, capped and deletable; and no credential reaches a response, a log line or a table in plaintext.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureTenant } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { revokeKey, disableProject } from './admin.ts';
import { webhookSecret } from './webhooks.ts';
import { developerApi, developerConfig, developerEnv, developerProject, memoryLogger, recordingRuntime, READ_ONLY_CALL, type ApiResponse } from './developer.test-harness.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await ensureTenant(t.db, 'other'); });
afterAll(async () => { await t?.drop(); });
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const hashOf = (strategy: unknown) => { const c = composeStrategy(strategy); if (!c.ok) throw new Error(c.code); return c.workflowHash; };
type Err = { error: { code: string; reason: string; message: string; requestId: string; issues?: { path: string; rule: string }[] } };
const errorOf = (r: ApiResponse) => (r.body as unknown as Err).error;
const withoutRequestId = (r: ApiResponse) => r.text.replace(/req_[a-z2-7]{26}/g, 'REQ');

describe('BUILD-DEVELOPER-001 Developer API authentication', () => {
  it('accepts an ACTIVE sandbox key and refuses missing, malformed, unknown, revoked, disabled and live credentials', async () => {
    const calls: string[] = [], runtime = recordingRuntime({ calls }), p = await developerProject(t.db);
    const ok = await developerApi({ db: t.db, runtime }, p.key)('GET', '/capabilities?network=base-sepolia');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('request-id')).toMatch(/^req_[a-z2-7]{26}$/);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();

    const refused = async (key: string | null, headers: Record<string, string> = {}) => developerApi({ db: t.db, runtime }, key)('GET', '/capabilities', undefined, headers);
    const missing = await refused(null);
    expect([missing.status, errorOf(missing).reason, missing.headers.get('www-authenticate')]).toEqual([401, 'API_KEY_REQUIRED', 'Bearer realm="flofi-developer"']);
    for (const key of [p.key.slice(0, -1), p.key + 'x', 'flofi_hs_' + 'a'.repeat(43), 'flofi_sk_test_' + 'a'.repeat(43)])
      expect(errorOf(await refused(key))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'API_KEY_INVALID' });
    expect(errorOf(await refused(null, { authorization: `Basic ${p.key}` }))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'API_KEY_INVALID' });
    // A live key is refused before any lookup: there are no production credentials in this build.
    expect(await refused('flofi_sk_live_' + 'a'.repeat(43))).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN', reason: 'LIVE_MODE_DISABLED' } } });
    // The same key under another deployment secret or tenant is unknown.
    expect((await developerApi({ db: t.db, runtime, env: developerEnv({ FLOFI_DEVELOPER_SECRET: 'z'.repeat(48) }) }, p.key)('GET', '/capabilities')).status).toBe(401);
    expect((await developerApi({ db: t.db, runtime, tenantId: 'other', env: developerEnv({ TENANT_ID: 'other' }) }, p.key)('GET', '/capabilities')).status).toBe(401);

    await revokeKey(p.deps, p.keyId);
    expect(errorOf(await refused(p.key))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'API_KEY_INVALID' });
    const q = await developerProject(t.db);
    await disableProject(q.deps, q.projectId);
    expect(errorOf(await refused(q.key))).toMatchObject({ code: 'UNAUTHORIZED', reason: 'API_KEY_INVALID' });
    expect(calls.every(c => READ_ONLY_CALL.test(c))).toBe(true);
  });

  it('refuses browser contexts before reading the key: API keys are server-side only', async () => {
    const p = await developerProject(t.db), api = developerApi({ db: t.db, runtime: recordingRuntime() }, p.key);
    for (const headers of [{ origin: 'https://evil.example' }, { origin: 'https://flofi.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin' }]) {
      const r = await api('GET', '/capabilities', undefined, headers);
      expect([r.status, errorOf(r).reason], JSON.stringify(headers)).toEqual([403, 'BROWSER_ORIGIN_FORBIDDEN']);
      expect(r.headers.get('access-control-allow-origin')).toBeNull();
    }
    // A server-side client (Node's fetch sends `sec-fetch-mode: cors` but no Origin or Sec-Fetch-Site) is served.
    expect((await api('GET', '/capabilities', undefined, { 'sec-fetch-mode': 'cors' })).status).toBe(200);
  });

  it('is off unless enabled and fails closed when misconfigured', async () => {
    const p = await developerProject(t.db), runtime = recordingRuntime();
    const off = await developerApi({ db: t.db, runtime, env: {} }, p.key)('GET', '/capabilities');
    expect([off.status, errorOf(off).reason]).toEqual([404, 'DEVELOPER_API_NOT_ENABLED']);
    const logger = memoryLogger(), bad = await developerApi({ db: t.db, runtime, logger, env: developerEnv({ FLOFI_DEVELOPER_SECRET: 'short' }) }, p.key)('GET', '/capabilities');
    expect([bad.status, errorOf(bad).reason]).toEqual([503, 'DEVELOPER_CONFIGURATION_INVALID']);
    expect(logger.lines.find(l => l.event === 'developer.configuration_invalid')?.fields).toEqual({ reason: 'FLOFI_DEVELOPER_SECRET' });
  });
});

describe('BUILD-DEVELOPER-001 Developer API scopes, routes and closed schemas', () => {
  it('gates each resource by its scope; discovery needs only a valid key', async () => {
    const p = await developerProject(t.db, { scopes: ['strategies'] }), api = developerApi({ db: t.db, runtime: recordingRuntime() }, p.key);
    expect((await api('GET', '/capabilities')).status).toBe(200);
    expect((await api('POST', '/strategies', { strategy: BRIDGE })).status).toBe(201);
    for (const [method, path, body] of [['POST', '/approvals', { strategyId: 'str_' + 'a'.repeat(26), workflowHash: hashOf(BRIDGE) }],
      ['GET', '/approvals/apr_' + 'a'.repeat(26)], ['GET', '/executions/run-1'], ['GET', '/executions/run-1/evidence'],
      ['POST', '/webhook-endpoints', { url: 'https://hooks.example.com/flofi' }], ['DELETE', '/webhook-endpoints/whe_' + 'a'.repeat(26)]] as const) {
      const r = await api(method, path, body);
      expect([r.status, errorOf(r).reason], `${method} ${path}`).toEqual([403, 'INSUFFICIENT_SCOPE']);
    }
  });

  it('answers unknown routes, wrong methods, malformed ids, unknown fields and oversized bodies without echoing input', async () => {
    const p = await developerProject(t.db), api = developerApi({ db: t.db, runtime: recordingRuntime() }, p.key);
    expect(errorOf(await api('GET', '/nope'))).toMatchObject({ code: 'NOT_FOUND', reason: 'ROUTE_NOT_FOUND' });
    const patch = await api('PATCH', '/strategies', { strategy: BRIDGE });
    expect([patch.status, patch.headers.get('allow')]).toEqual([405, 'POST']);
    expect(errorOf(await api('GET', '/approvals/not-an-id'))).toMatchObject({ code: 'NOT_FOUND', reason: 'RESOURCE_NOT_FOUND' });
    expect(errorOf(await api('GET', '/capabilities?network=base-sepolia&chain=1'))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'SCHEMA_INVALID' });
    expect(errorOf(await api('GET', '/capabilities?network=base&network=solana'))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'QUERY_PARAMETER_REPEATED' });
    expect(errorOf(await api('GET', '/approvals/apr_' + 'a'.repeat(26) + '?x=1'))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'QUERY_NOT_ALLOWED' });
    expect(errorOf(await api('POST', '/strategies', '{"strategy":'))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'MALFORMED_JSON' });
    expect(errorOf(await api('POST', '/strategies', '[1]'))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'BODY_NOT_OBJECT' });
    expect(errorOf(await api('POST', '/strategies', JSON.stringify({ strategy: BRIDGE }), { 'content-type': 'text/plain' }))).toMatchObject({ reason: 'CONTENT_TYPE_NOT_JSON' });
    const extra = await api('POST', '/strategies', { strategy: BRIDGE, privateKey: '0x' + 'ab'.repeat(32) });
    expect([extra.status, errorOf(extra).reason]).toEqual([400, 'SCHEMA_INVALID']);
    expect(extra.text).not.toContain('abab');
    // A strategy is reported against its own action's schema; values are never echoed.
    const secretShaped = await api('POST', '/strategies', { strategy: { ...BRIDGE, mnemonic: 'test test test test test test test test test test test junk' } });
    expect(errorOf(secretShaped)).toMatchObject({ code: 'INVALID_STRATEGY', reason: 'STRATEGY_SCHEMA_INVALID', issues: [{ path: '/strategy/mnemonic', rule: 'additionalProperties' }] });
    expect(secretShaped.text).not.toContain('junk');
    const big = await api('POST', '/strategies', { strategy: BRIDGE, pad: 'x'.repeat(70_000) });
    expect([big.status, errorOf(big).reason]).toEqual([413, 'REQUEST_TOO_LARGE']);
    expect(errorOf(await api('POST', '/strategies/str_' + 'a'.repeat(26) + '/validate', { extra: 1 }))).toMatchObject({ reason: 'SCHEMA_INVALID' });
    expect(errorOf(await api('DELETE', '/webhook-endpoints/whe_' + 'a'.repeat(26), { force: true }))).toMatchObject({ reason: 'BODY_NOT_ALLOWED' });
  });
});

describe('BUILD-DEVELOPER-001 Developer API tenant isolation', () => {
  it('never shows a project another project\'s strategies, approvals, executions or webhook endpoints (404s identical to absent ones)', async () => {
    const runtime = recordingRuntime(), a = await developerProject(t.db, { name: 'Project A' }), b = await developerProject(t.db, { name: 'Project B' });
    const apiA = developerApi({ db: t.db, runtime }, a.key), apiB = developerApi({ db: t.db, runtime }, b.key);
    const strategy = (await apiA<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const approval = (await apiA<{ id: string }>('POST', '/approvals', { strategyId: strategy.id, workflowHash: strategy.workflowHash }));
    expect(approval.status).toBe(201);
    const endpoint = (await apiA<{ id: string }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/a' })).body;
    const absent = { strategy: 'str_' + 'a'.repeat(26), approval: 'apr_' + 'a'.repeat(26), endpoint: 'whe_' + 'a'.repeat(26) };
    for (const [method, foreign, missing, body] of [
      ['POST', `/strategies/${strategy.id}/validate`, `/strategies/${absent.strategy}/validate`, {}],
      ['POST', `/strategies/${strategy.id}/simulate`, `/strategies/${absent.strategy}/simulate`, { simulationSubject: '0x' + '1'.repeat(40) }],
      ['POST', '/approvals', '/approvals', null],
      ['GET', `/approvals/${approval.body.id}`, `/approvals/${absent.approval}`, undefined],
      ['DELETE', `/webhook-endpoints/${endpoint.id}`, `/webhook-endpoints/${absent.endpoint}`, undefined]] as const) {
      const theirs = await apiB(method, foreign, body === null ? { strategyId: strategy.id, workflowHash: strategy.workflowHash } : body);
      const none = await apiB(method, missing, body === null ? { strategyId: absent.strategy, workflowHash: strategy.workflowHash } : body);
      expect(theirs.status, `${method} ${foreign}`).toBe(404);
      expect(withoutRequestId(theirs)).toBe(withoutRequestId(none));
    }
    // The owner project still has everything.
    expect((await apiA('GET', `/approvals/${approval.body.id}`)).status).toBe(200);
    expect((await apiA('DELETE', `/webhook-endpoints/${endpoint.id}`)).status).toBe(200);
  });
});

describe('BUILD-DEVELOPER-001 Developer API idempotency and rate limits', () => {
  it('replays creating POSTs by Idempotency-Key without ever storing an approval link or a webhook secret', async () => {
    const p = await developerProject(t.db), api = developerApi({ db: t.db, runtime: recordingRuntime() }, p.key), key = { 'idempotency-key': crypto.randomUUID() };
    const first = await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE }, key);
    const again = await api<{ id: string }>('POST', '/strategies', { strategy: BRIDGE }, key);
    expect([first.status, again.status, again.body.id, again.headers.get('idempotent-replayed')]).toEqual([201, 201, first.body.id, 'true']);
    expect(errorOf(await api('POST', '/strategies', { strategy: { ...BRIDGE, amount: '4' } }, key))).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(errorOf(await api('POST', '/strategies', { strategy: BRIDGE }, { 'idempotency-key': 'short' }))).toMatchObject({ reason: 'IDEMPOTENCY_KEY_INVALID' });
    // Without a key, every POST creates a new immutable strategy.
    expect((await api<{ id: string }>('POST', '/strategies', { strategy: BRIDGE })).body.id).not.toBe(first.body.id);

    const approvalKey = { 'idempotency-key': crypto.randomUUID() }, body = { strategyId: first.body.id, workflowHash: first.body.workflowHash };
    const created = await api<{ id: string; approvalUrl: string }>('POST', '/approvals', body, approvalKey);
    const replay = await api<{ id: string; approvalUrl: string; approvalUrlExpiresAt: string }>('POST', '/approvals', body, approvalKey);
    expect([created.status, replay.status, replay.body.id, replay.headers.get('idempotent-replayed')]).toEqual([201, 201, created.body.id, 'true']);
    // A replay mints a fresh short-lived link; the stored response holds none.
    expect(replay.body.approvalUrl).toMatch(/^https:\/\/flofi\.test\/approve#flofi_dhs_[A-Za-z0-9_-]{43}$/);
    expect(replay.body.approvalUrl).not.toBe(created.body.approvalUrl);
    expect(Date.parse(replay.body.approvalUrlExpiresAt) - Date.now()).toBeLessThanOrEqual(300_000);

    const endpointKey = { 'idempotency-key': crypto.randomUUID() };
    const endpoint = await api<{ id: string; secret: string | null; secretAlreadyIssued: boolean }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/i' }, endpointKey);
    const endpointAgain = await api<{ id: string; secret: string | null; secretAlreadyIssued: boolean }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/i' }, endpointKey);
    expect(endpoint.body.secret).toBe(webhookSecret(developerConfig(), 'default', endpoint.body.id));
    expect(endpointAgain.body).toMatchObject({ id: endpoint.body.id, secret: null, secretAlreadyIssued: true });
    const stored = JSON.stringify((await t.db.query('SELECT scope, response FROM api_idempotency')).rows);
    expect(stored).toContain('developer/');
    expect(stored).not.toMatch(/flofi_dhs_|whsec_|flofi_sk_/);
  });

  it('enforces the project\'s request rate with Retry-After, per project and environment', async () => {
    const p = await developerProject(t.db), q = await developerProject(t.db), runtime = recordingRuntime(), now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    await t.db.query(`INSERT INTO mcp_rate_limits (tenant_id, bucket, window_start, count) VALUES ('default', $1, $2, 300)
      ON CONFLICT (tenant_id, bucket, window_start) DO UPDATE SET count = 300`, [`dev:${p.projectId}:sandbox:requests`, windowStart]);
    const limited = await developerApi({ db: t.db, runtime, now: () => now }, p.key)('GET', '/capabilities');
    expect([limited.status, errorOf(limited).reason]).toEqual([429, 'REQUESTS_PER_MINUTE']);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect((await developerApi({ db: t.db, runtime, now: () => now }, q.key)('GET', '/capabilities')).status).toBe(200);
    expect((await developerApi({ db: t.db, runtime, now: () => new Date(windowStart.getTime() + 60_000) }, p.key)('GET', '/capabilities')).status).toBe(200);
  });
});

describe('BUILD-DEVELOPER-001 Developer API webhook endpoints', () => {
  it('registers https endpoints on public hosts only, returns the derived secret once, caps them and deletes them', async () => {
    const p = await developerProject(t.db), api = developerApi({ db: t.db, runtime: recordingRuntime() }, p.key);
    const created = await api<{ id: string; secret: string; events: string[]; url: string; status: string }>('POST', '/webhook-endpoints',
      { url: 'https://hooks.example.com/flofi?token=abc', events: ['approval.claimed', 'execution.reconciled'] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ object: 'webhook_endpoint', url: 'https://hooks.example.com/flofi?token=abc', events: ['approval.claimed', 'execution.reconciled'],
      status: 'ACTIVE', secretAlreadyIssued: false, secret: expect.stringMatching(/^whsec_[A-Za-z0-9+/]{43}=$/) });
    expect(JSON.stringify((await t.db.query('SELECT * FROM developer_webhook_endpoints WHERE endpoint_id = $1', [created.body.id])).rows)).not.toContain(created.body.secret.slice(6));
    for (const [url, reason] of [['http://hooks.example.com/x', 'WEBHOOK_URL_NOT_HTTPS'], ['https://hooks.example.com:8443/x', 'WEBHOOK_URL_PORT'],
      ['https://10.0.0.5/x', 'WEBHOOK_URL_HOST'], ['https://169.254.169.254/latest', 'WEBHOOK_URL_HOST'], ['https://localhost/x', 'WEBHOOK_URL_HOST'],
      ['https://[::1]/x', 'WEBHOOK_URL_HOST'], ['https://intranet/x', 'WEBHOOK_URL_HOST'], ['https://user:pw@hooks.example.com/x', 'WEBHOOK_URL_INVALID'],
      ['https://hooks.example.com/x#frag', 'WEBHOOK_URL_INVALID'], ['http://127.0.0.1:9999/x', 'WEBHOOK_URL_NOT_HTTPS'], ['ftp://hooks.example.com/x', 'WEBHOOK_URL_NOT_HTTPS']] as const)
      expect(errorOf(await api('POST', '/webhook-endpoints', { url })), url).toMatchObject({ code: 'INVALID_REQUEST', reason });
    expect(errorOf(await api('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/x', events: ['execution.signed'] }))).toMatchObject({ reason: 'SCHEMA_INVALID' });
    // Loopback http only with the local test seam.
    expect((await developerApi({ db: t.db, runtime: recordingRuntime(), env: developerEnv({ FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY' }) }, p.key)('POST',
      '/webhook-endpoints', { url: 'http://127.0.0.1:9999/hook' })).status).toBe(201);
    for (let i = 0; i < 3; i++) expect((await api('POST', '/webhook-endpoints', { url: `https://hooks.example.com/${i}` })).status).toBe(201);
    expect(errorOf(await api('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/6' }))).toMatchObject({ code: 'FORBIDDEN', reason: 'WEBHOOK_ENDPOINT_LIMIT' });
    expect((await api('DELETE', `/webhook-endpoints/${created.body.id}`)).body).toEqual({ id: created.body.id, object: 'webhook_endpoint', deleted: true });
    expect(errorOf(await api('DELETE', `/webhook-endpoints/${created.body.id}`))).toMatchObject({ code: 'NOT_FOUND', reason: 'WEBHOOK_ENDPOINT_NOT_FOUND' });
    expect((await api('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/7' })).status).toBe(201);
  });
});

describe('BUILD-DEVELOPER-001 Developer API secret hygiene', () => {
  it('keeps keys, approval links, webhook URLs and secrets out of logs, and keys out of every response and table', async () => {
    const logger = memoryLogger(), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime: recordingRuntime(), logger }, p.key);
    const queried = (await api('POST', '/strategies?x=1', { strategy: BRIDGE })).body;
    const created = await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE });
    const approval = await api<{ approvalUrl: string }>('POST', '/approvals', { strategyId: created.body.id, workflowHash: created.body.workflowHash });
    const endpoint = await api<{ secret: string }>('POST', '/webhook-endpoints', { url: 'https://hooks.example.com/secret-path' });
    await api('GET', '/capabilities', undefined, { origin: 'https://evil.example' });
    const logged = JSON.stringify(logger.lines);
    for (const needle of [p.key, p.key.slice(14), approval.body.approvalUrl.split('#')[1]!, endpoint.body.secret, 'hooks.example.com', 'secret-path'])
      expect(logged).not.toContain(needle);
    expect(logger.lines.filter(l => l.event === 'developer.request').map(l => l.fields.route)).toEqual(expect.arrayContaining(['/strategies', '/approvals', '/webhook-endpoints']));
    expect(logger.lines.find(l => l.event === 'developer.request' && l.fields.status === 201)?.fields).toMatchObject({ project: p.projectId, key: p.keyId,
      environment: 'sandbox', tenant: 'default', code: 'OK' });
    expect(queried).toMatchObject({ error: { reason: 'QUERY_NOT_ALLOWED' } });
    const tables = JSON.stringify((await t.db.query(`SELECT (SELECT json_agg(k) FROM developer_api_keys k) AS keys, (SELECT json_agg(h) FROM mcp_handoffs h) AS handoffs,
      (SELECT json_agg(e) FROM developer_webhook_endpoints e) AS endpoints, (SELECT json_agg(s) FROM developer_strategies s) AS strategies`)).rows);
    expect(tables).not.toContain(p.key.slice(14));
    expect(tables).not.toContain(approval.body.approvalUrl.split('#flofi_dhs_')[1]!);
    expect(tables).not.toContain(endpoint.body.secret.slice(6));
  });
});

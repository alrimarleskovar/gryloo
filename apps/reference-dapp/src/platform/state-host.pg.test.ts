// SPDX-License-Identifier: AGPL-3.0-only
/** Real platform handlers on disposable PostgreSQL; flow transport is mocked and can only answer discovery/read requests. */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrate, SHIPPED_MIGRATIONS, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { developerEnv, developerProject, ORIGIN } from '../developer/developer.test-harness.ts';
import { developerApprovalChanged } from '../developer/dispatch.ts';
import { handleDeveloperRequest } from '../developer/http.ts';
import { session } from '../mcp/gateway.test-harness.ts';
import { oauthClient, oauthEnv, signIn } from '../mcp/oauth/oauth-test-harness.ts';
import { deploymentOAuthStore, mcpStateHost } from '../mcp/oauth/runtime.ts';
import { handleOAuthRequest } from '../mcp/oauth/server.ts';
import { mcpState } from '../mcp/oauth/state.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { deploymentTenant } from '../server/deployment.ts';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { claimApproval, deploymentEngineRuntime, viewApproval } from './index.ts';
import { platformStateHost } from '../server/platform-state-host.ts';

type Env = Record<string, string>;
const REMOTE = { API_BASE_URL: 'https://api.example', API_AUTH_TOKEN: 'platform state test token '.padEnd(48, '.') };
const OWNER = '0x' + '1'.repeat(40);
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
let t: TestDatabase;
const pools = new Set<Database>();
beforeAll(async () => { t = await createTestDatabase(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await Promise.allSettled([...pools].map(db => db.close())); await t?.drop(); });
const remoteEnv = (tenant: string): Env => ({ ...REMOTE, VERCEL: '1', VERCEL_ENV: 'production', TENANT_ID: tenant, DATABASE_URL: t.url });
async function hostFor(env: Env) { const host = await platformStateHost(env); pools.add(host.db); return host; }
async function api(env: Env, key: string, method: string, path: string, body?: unknown) {
  return handleDeveloperRequest(new Request(ORIGIN + '/api/developer/v1' + path, { method,
    headers: { authorization: `Bearer ${key}`, ...body === undefined ? {} : { 'content-type': 'application/json' } },
    ...body === undefined ? {} : { body: JSON.stringify(body) } }), { env: developerEnv(env), schedule: () => undefined });
}
/** Any execution preparation, signing or submission endpoint fails this test immediately. */
function remoteTransport() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(REMOTE.API_BASE_URL);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${REMOTE.API_AUTH_TOKEN}`);
    if (url.pathname.startsWith('/v1/previews/')) return Response.json({ ok: false, code: 'ROUTER_NO_EXECUTABLE_ROUTE' });
    if (url.pathname.endsWith('/mode')) return Response.json({ ok: true, value: url.pathname.includes('crosschain-router-testnet') ? 'live' : 'off' });
    if (url.pathname.endsWith('/info')) return Response.json({ ok: true, value: { executionEnabled: true } });
    if (url.pathname.endsWith('/status')) return Response.json({ ok: true, value: { evidence: null } });
    if (url.pathname.startsWith('/v1/runs/')) return Response.json({ ok: false, code: 'RUN_NOT_FOUND' }, { status: 404 });
    throw new Error('UNEXPECTED_RUNTIME_ENDPOINT');
  });
}

describe('BUILD-PLATFORM-STATE-001 direct durable state with remote flows', () => {
  it('shares one initialized PostgreSQL pool across concurrent requests and MCP/Developer consumers', async () => {
    const env = remoteEnv('platform-shared');
    expect(flowRuntimeKind(env)).toBe('remote');
    const hosts = await Promise.all(Array.from({ length: 16 }, () => hostFor(env)));
    expect(hosts.every(h => h === hosts[0])).toBe(true);
    expect(Object.keys(hosts[0]!).sort()).toEqual(['db', 'tenantId']);
    expect(hosts[0]!.tenantId).toBe(deploymentTenant(env));
    expect((await mcpStateHost(env)).db).toBe(hosts[0]!.db);
    expect((await hosts[0]!.db.query('SELECT version() AS version')).rows[0]!.version).toMatch(/^PostgreSQL /);
    expect((await t.db.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1', [deploymentTenant(env)])).rows).toEqual([{ tenant_id: 'platform-shared' }]);
    const project = await developerProject(hosts[0]!.db, { tenantId: hosts[0]!.tenantId });
    remoteTransport();
    expect((await api(env, project.key, 'GET', '/capabilities')).status).toBe(200);
    const resized = await hostFor({ ...env, DATABASE_POOL_MAX: '1' });
    expect(resized.db).not.toBe(hosts[0]!.db);
    expect(resized.tenantId).toBe(hosts[0]!.tenantId);
  });

  it.each(['remote', 'embedded'])('%s: actual Developer/OAuth handlers and approval links use PostgreSQL without injected hosts', async kind => {
    const env: Env = kind === 'remote' ? remoteEnv('platform-remote-journey') : {
      FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, TENANT_ID: 'platform-embedded-journey', GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY',
    };
    const host = await hostFor(env);
    if (kind === 'embedded') expect(host.db).toBe((await embeddedRuntime(env)).db);
    else remoteTransport();
    const p = await developerProject(host.db, { tenantId: host.tenantId });
    const created = await api(env, p.key, 'POST', '/strategies', { strategy: BRIDGE });
    expect(created.status).toBe(201);
    const strategy = await created.json() as { id: string; workflowHash: string; authority: string };
    expect(strategy.authority).toBe('NONE');
    const approval = await api(env, p.key, 'POST', '/approvals', { strategyId: strategy.id, workflowHash: strategy.workflowHash });
    expect(approval.status).toBe(201);
    const link = await approval.json() as { approvalUrl: string };
    const surface = await approvalSurface(developerEnv(env), () => undefined);
    expect(surface.runtime.kind).toBe(kind);
    expect(await viewApproval(surface, decodeURIComponent(new URL(link.approvalUrl).hash.slice(1)), [])).toMatchObject({
      requesterKind: 'DEVELOPER_PROJECT', authorized: false, authority: 'NONE', statusShared: false,
    });
    const secret = decodeURIComponent(new URL(link.approvalUrl).hash.slice(1));
    await claimApproval(surface, secret, [{ namespace: 'eip155', address: OWNER }], false);
    await developerApprovalChanged(developerEnv(env), secret);
    expect((await t.db.query('SELECT type FROM developer_events WHERE tenant_id = $1', [host.tenantId])).rows).toEqual([{ type: 'approval.claimed' }]);
    const consumer = oauthClient({ env: oauthEnv(env) });
    const tokens = await signIn(consumer, { scope: 'flofi.strategy flofi.approval flofi.runs' });
    const mcp = session({ env: { ...oauthEnv(env), FLOFI_MCP: 'enabled' }, token: tokens.access_token });
    const composed = (await mcp.callTool('compose_strategy', { strategy: BRIDGE })).output;
    const handoffResult = await mcp.callTool('request_user_approval', { strategy: BRIDGE, workflowHash: composed.workflowHash });
    expect(handoffResult.text).not.toContain('flofi_hs_');
    const handoff = { ...handoffResult.output, ...handoffResult.meta['flofi/approval'] as Record<string, unknown> };
    expect(handoff).toMatchObject({ ok: true, authority: 'NONE' });
    const mcpSurface = await approvalSurface(oauthEnv(env), () => undefined);
    expect(await viewApproval(mcpSurface, decodeURIComponent(new URL(String(handoff.approvalUrl)).hash.slice(1)), [])).toMatchObject({
      requesterKind: 'MCP_ACCOUNT', authorized: false, authority: 'NONE',
    });
    const stranger = await signIn(oauthClient({ env: oauthEnv(env) }), { scope: 'flofi.approval' });
    expect((await session({ env: { ...oauthEnv(env), FLOFI_MCP: 'enabled' }, token: stranger.access_token })
      .callTool('get_approval_status', { approvalId: handoff.approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_NOT_FOUND' });
    expect((await t.db.query('SELECT DISTINCT tenant_id FROM developer_strategies WHERE strategy_id = $1', [strategy.id])).rows).toEqual([{ tenant_id: host.tenantId }]);
    expect((await t.db.query('SELECT count(*)::int AS n FROM execution_runs WHERE tenant_id = $1', [host.tenantId])).rows[0]!.n).toBe(0);
    // OAuth grants confer no wallet ownership, and revocation is read from PostgreSQL on the very next request.
    expect(await (await mcpState(env)).links.active(String((await t.db.query('SELECT account_id FROM mcp_accounts WHERE tenant_id = $1', [host.tenantId])).rows[0]!.account_id), new Date())).toEqual([]);
    await consumer.revoke({ token: tokens.access_token, client_id: tokens.clientId });
    expect((await mcp.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it('routes a financial preview and owner-scoped status/evidence reads to API_BASE_URL after opening direct state', async () => {
    const env = remoteEnv('platform-routing'), host = await hostFor(env), p = await developerProject(host.db, { tenantId: host.tenantId });
    const transport = remoteTransport();
    const created = await api(env, p.key, 'POST', '/strategies', { strategy: BRIDGE });
    const strategy = await created.json() as { id: string };
    expect(created.status).toBe(201);
    const simulated = await api(env, p.key, 'POST', `/strategies/${strategy.id}/simulate`, { simulationSubject: OWNER });
    expect(simulated.status).toBe(422);
    expect(await simulated.json()).toMatchObject({ error: { code: 'SIMULATION_FAILED', reason: 'ROUTER_NO_EXECUTABLE_ROUTE' } });
    const runtime = deploymentEngineRuntime(env), runId = 'xroute-' + 'a'.repeat(32);
    expect(runtime.kind).toBe('remote');
    expect(await runtime.preview('crosschain-router-testnet', [{ workflowId: 'w', nodes: [] }, OWNER])).toEqual({ ok: false, code: 'ROUTER_NO_EXECUTABLE_ROUTE' });
    expect(await runtime.run(runId, OWNER)).toEqual({ ok: true, value: null });
    expect(await runtime.evidence('crosschain-router-testnet', runId, OWNER)).toEqual({ ok: true, value: null });
    const previews = transport.mock.calls.filter(([url]) => String(url).includes('/v1/previews/'));
    expect(previews).toHaveLength(2);
    for (const [url, init] of previews) {
      expect(String(url)).toBe('https://api.example/v1/previews/crosschain-router-testnet');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).has('x-flofi-wallet-principal')).toBe(false);
      expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
    }
    for (const [url, init] of transport.mock.calls.filter(([url]) => String(url).includes('/v1/runs/') || String(url).endsWith('/status')))
      expect(new Headers(init?.headers).get('x-flofi-wallet-principal'), String(url)).toBe(OWNER);
    expect((await t.db.query('SELECT count(*)::int AS n FROM execution_runs WHERE tenant_id = $1', [host.tenantId])).rows[0]!.n).toBe(0);
  });

  it('uses exactly deploymentTenant and isolates direct state across production tenants and Preview branches', async () => {
    const aEnv = remoteEnv('platform-tenant-a'), a = await hostFor(aEnv), bEnv = remoteEnv('platform-tenant-b'), b = await hostFor(bEnv);
    expect([a.tenantId, b.tenantId]).toEqual([deploymentTenant(aEnv), deploymentTenant(bEnv)]);
    const p = await developerProject(a.db, { tenantId: a.tenantId });
    expect((await api(bEnv, p.key, 'GET', '/capabilities')).status).toBe(401);
    const tokens = await signIn(oauthClient({ env: oauthEnv(aEnv) }));
    const otherMcp = session({ env: { ...oauthEnv(bEnv), FLOFI_MCP: 'enabled' }, token: tokens.access_token });
    expect((await otherMcp.post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    for (const branch of ['platform/preview-a', 'platform/preview-b']) {
      const env = { ...aEnv, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch, TENANT_ID: 'platform-tenant-a' };
      expect((await hostFor(env)).tenantId).toBe(deploymentTenant(env));
      expect((await hostFor(env)).tenantId).not.toBe(a.tenantId);
    }
    expect((await hostFor({ ...aEnv, DATABASE_POOL_MAX: '1' })).db).not.toBe(a.db);
    const restartedStore = await deploymentOAuthStore({ ...aEnv, DATABASE_POOL_MAX: '1' });
    const account = (await a.db.query('SELECT account_id FROM mcp_accounts WHERE tenant_id = $1', [a.tenantId])).rows[0]!.account_id;
    expect(await restartedStore.accountActive(String(account))).toBe(true);
  });

  it('fails closed on a behind schema without creating a tenant, closes failed pools, and retries after migration', async () => {
    const behind = await createTestDatabase();
    // A real schema missing the last shipped migration identity must not serve platform state.
    await behind.db.query('DELETE FROM schema_migrations WHERE version = $1', [SHIPPED_MIGRATIONS.length]);
    const env: Env = { ...remoteEnv('platform-schema-behind'), DATABASE_URL: behind.url };
    try {
      await expect(platformStateHost(env)).rejects.toThrow('SCHEMA_NOT_MIGRATED');
      await expect(mcpStateHost(env)).rejects.toThrow('MCP_OAUTH_STORE_UNAVAILABLE');
      const developer = await api(env, `flofi_sk_test_${'a'.repeat(43)}`, 'GET', '/capabilities');
      expect(developer.status).toBe(503);
      expect(await developer.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE', reason: 'DEVELOPER_STORE_UNAVAILABLE' } });
      const oauth = await handleOAuthRequest('token', new Request(ORIGIN + '/oauth/token', { method: 'POST', body: 'grant_type=x',
        headers: { 'content-type': 'application/x-www-form-urlencoded' } }), { env: oauthEnv(env) });
      expect([oauth.status, await oauth.json()]).toEqual([503, { error: 'temporarily_unavailable', code: 'MCP_OAUTH_STORE_UNAVAILABLE' }]);
      expect((await behind.db.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1', [env.TENANT_ID])).rows).toEqual([]);
      expect((await behind.db.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'flofi-platform-state'")).rows[0]!.n).toBe(0);
      const last = SHIPPED_MIGRATIONS.at(-1)!;
      await behind.db.query('INSERT INTO schema_migrations(version, name, sha256) VALUES ($1, $2, $3)', [last.version, last.name, last.sha256]);
      const recovered = await platformStateHost(env);
      expect(recovered.tenantId).toBe(deploymentTenant(env));
      await recovered.db.close();
    } finally { await behind.drop(); }
    const unmigrated = await createTestDatabase({ migrated: false });
    const fresh = { ...env, DATABASE_URL: unmigrated.url };
    try {
      await expect(platformStateHost(fresh)).rejects.toThrow('SCHEMA_NOT_MIGRATED');
      await migrate(unmigrated.db);
      const recovered = await platformStateHost(fresh);
      expect(recovered.tenantId).toBe(deploymentTenant(fresh));
      await recovered.db.close();
    } finally { await unmigrated.drop(); }
  });
});

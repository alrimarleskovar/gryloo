// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: `/api/mcp` as an OAuth protected resource, on a disposable loopback PostgreSQL. A consumer signs in through
 * FloFi's authorization server and calls tools with the access token; the 401 challenge, audience binding, tenant isolation,
 * revocation, expiry, scope step-up (403 insufficient_scope) and the production refusal of static credentials are proven.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { readMcpConfig } from '../config.ts';
import { credential, gatewayEnv, memoryLogger, session } from '../gateway.test-harness.ts';
import { CHATGPT, CHATGPT_REDIRECT, oauthClient, oauthEnv, ORIGIN, signIn } from './oauth-test-harness.ts';
import { createPgOAuthStore } from './pg-store.ts';
import { stateOf } from './state.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('other')`); });
afterAll(async () => { await t?.drop(); });
const env = (extra: Record<string, string> = {}) => ({ FLOFI_MCP: 'enabled', ...oauthEnv(extra) });
const state = (tenant = 'default') => stateOf({ db: t.db, tenantId: tenant });
const connect = (scope?: string) => signIn(oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }), scope ? { scope } : {});
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const METADATA = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;

describe('BUILD-MCP-002 /api/mcp as an OAuth protected resource', () => {
  it('challenges unauthenticated and invalid requests with 401 and the protected resource metadata', async () => {
    const missing = await session({ env: env(), token: null, state: state() }).post(LIST);
    expect([missing.status, missing.text]).toEqual([401, JSON.stringify({ ok: false, code: 'MCP_UNAUTHORIZED' })]);
    expect(missing.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${METADATA}", scope="flofi.strategy flofi.approval"`);
    for (const token of ['flofi_at_' + 'A'.repeat(43), 'flofi_rt_' + 'A'.repeat(43), credential()]) {
      const invalid = await session({ env: env(), token, state: state() }).post(LIST);
      expect(invalid.status, token.slice(0, 9)).toBe(401);
      expect(invalid.headers.get('www-authenticate')).toBe(`Bearer error="invalid_token", resource_metadata="${METADATA}", scope="flofi.strategy flofi.approval"`);
    }
  });

  it('serves a consumer signed in through FloFi OAuth, with securitySchemes on every tool', async () => {
    const tokens = await connect(), client = session({ env: env(), token: tokens.access_token, state: state() });
    const tools = ((await client.request('tools/list')).result as { tools: { name: string; _meta?: { securitySchemes?: unknown } }[] }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(9);
    for (const tool of tools) expect(tool._meta?.securitySchemes, tool.name).toEqual([{ type: 'oauth2', scopes: [expect.stringMatching(/^flofi\./)] }]);
    const composed = await client.callTool('compose_strategy', { strategy: BRIDGE });
    expect(composed.output).toMatchObject({ ok: true, workflowHash: expect.stringMatching(/^0x[0-9a-f]{64}$/), fundsClass: 'TEST_FUNDS' });
  });

  it('refuses a tool outside the token\'s scopes with 403 insufficient_scope, then serves it after step-up', async () => {
    const narrow = await connect(), logger = memoryLogger();
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_execution_status', arguments: { executionId: 'run-1' } } };
    const refused = await session({ env: env(), token: narrow.access_token, state: state(), logger }).post(call);
    expect([refused.status, refused.text]).toEqual([403, JSON.stringify({ ok: false, code: 'MCP_INSUFFICIENT_SCOPE' })]);
    expect(refused.headers.get('www-authenticate')).toBe(`Bearer error="insufficient_scope", resource_metadata="${METADATA}", scope="flofi.strategy flofi.approval flofi.runs"`);
    // A batch cannot smuggle the call past the check.
    expect((await session({ env: env(), token: narrow.access_token, state: state() }).post([LIST, call])).status).toBe(403);
    expect(JSON.stringify(logger.lines)).not.toContain(narrow.access_token);
    const wide = await connect('flofi.strategy flofi.approval flofi.runs');
    expect(wide.scope).toBe('flofi.strategy flofi.approval flofi.runs');
    // With the scope, a run is still visible only through a wallet linked on FloFi: none here, so it is not found.
    expect((await session({ env: env(), token: wide.access_token, state: state() }).callTool('get_execution_status', { executionId: 'run-1' })).output)
      .toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
  });

  it('stops accepting a token at once when it is revoked, expires or its account is disabled', async () => {
    const tokens = await connect();
    expect((await session({ env: env(), token: tokens.access_token, state: state() }).post(LIST)).status).toBe(200);
    const later = () => new Date(Date.now() + 15 * 60_000 + 1_000);
    expect((await session({ env: env(), token: tokens.access_token, state: state(), now: later }).post(LIST)).status).toBe(401);
    await oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }).revoke({ token: tokens.refresh_token, client_id: tokens.clientId });
    expect((await session({ env: env(), token: tokens.access_token, state: state() }).post(LIST)).status).toBe(401);
    const other = await connect();
    await t.db.query(`UPDATE mcp_accounts SET status = 'DISABLED' WHERE account_id = (SELECT account_id FROM mcp_oauth_grants g JOIN mcp_oauth_tokens k USING (tenant_id, grant_id)
      WHERE k.kind = 'ACCESS' ORDER BY k.created_at DESC LIMIT 1)`);
    expect((await session({ env: env(), token: other.access_token, state: state() }).post(LIST)).status).toBe(401);
  });

  it('binds tokens to this resource and tenant: another origin or another tenant refuses them', async () => {
    const tokens = await signIn(oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }), { clientId: CHATGPT, redirectUri: CHATGPT_REDIRECT });
    expect((await session({ env: env(), token: tokens.access_token, state: state() }).post(LIST)).status).toBe(200);
    expect((await session({ env: env({ FLOFI_PUBLIC_ORIGIN: 'https://other.flofi.test' }), token: tokens.access_token, state: state() }).post(LIST)).status).toBe(401);
    expect((await session({ env: env({ TENANT_ID: 'other' }), token: tokens.access_token, state: state('other') }).post(LIST)).status).toBe(401);
  });

  it('gives each OAuth account an hourly simulation budget', async () => {
    const tokens = await connect(), client = session({ env: env(), token: tokens.access_token, state: state() });
    const account = (await t.db.query<{ account_id: string }>(`SELECT g.account_id FROM mcp_oauth_grants g ORDER BY g.created_at DESC LIMIT 1`)).rows[0]!.account_id;
    const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await t.db.query(`INSERT INTO mcp_rate_limits (tenant_id, bucket, window_start, count) VALUES ('default', $1, $2, 30)`, [`simulate:account:${account}`, windowStart]);
    const composed = (await client.callTool('compose_strategy', { strategy: BRIDGE })).output as { workflowHash: string };
    expect((await client.callTool('simulate_strategy', { strategy: BRIDGE, workflowHash: composed.workflowHash, simulationSubject: '0x' + '1'.repeat(40) })).output)
      .toEqual({ ok: false, code: 'MCP_SIMULATION_RATE_LIMITED' });
  });

  it('fails closed when the OAuth store is unavailable or OAuth is misconfigured; never falls back to another credential', async () => {
    const tokens = await connect();
    const remote = await session({ env: env({ API_BASE_URL: 'https://api.flofi.test' }), token: tokens.access_token }).post(LIST);
    expect([remote.status, remote.text]).toEqual([503, JSON.stringify({ ok: false, code: 'MCP_OAUTH_STORE_UNAVAILABLE' })]);
    const reused = await session({ env: env({ API_AUTH_TOKEN: 's'.repeat(48) }), token: tokens.access_token, state: state() }).post(LIST);
    expect(reused.status).toBe(503);
  });

  it('keeps static developer credentials off production; OAuth-only production is valid', async () => {
    const dev = { principal: 'dev-alice', token: credential() };
    const production = { VERCEL: '1', VERCEL_ENV: 'production' };
    expect(readMcpConfig({ ...gatewayEnv([dev]), ...production })).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
    expect(readMcpConfig({ ...gatewayEnv([dev]), ...production, FLOFI_MCP_OAUTH: 'enabled' })).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
    expect(readMcpConfig({ FLOFI_MCP: 'enabled', FLOFI_MCP_OAUTH: 'enabled', ...production })).toMatchObject({ enabled: true, clients: [] });
    expect(readMcpConfig({ FLOFI_MCP: 'enabled' })).toEqual({ enabled: false, code: 'MCP_CONFIGURATION_INVALID' });
    // A Preview may still use a static developer credential next to OAuth; it keeps BUILD-MCP-001's read-only surface.
    const preview = { ...gatewayEnv([dev]), ...oauthEnv(), VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-mcp-002' };
    const tools = ((await session({ env: preview, token: dev.token }).request('tools/list')).result as { tools: { name: string }[] }).tools.map(tool => tool.name);
    expect(tools).not.toContain('request_user_approval');
  });
});

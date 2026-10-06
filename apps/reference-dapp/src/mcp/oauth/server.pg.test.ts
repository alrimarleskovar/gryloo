// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: FloFi's OAuth authorization server end to end on a disposable loopback PostgreSQL — discovery, consent with
 * CSRF and invite codes, PKCE S256, exact redirects, `iss`, resource binding, refresh rotation and reuse, revocation,
 * narrow DCR, abuse limits, fail-closed configuration and no credential in any log line. No network, no wallet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createPgOAuthStore } from './pg-store.ts';
import { CHATGPT, CHATGPT_REDIRECT, CLAUDE, CLAUDE_CODE, CLAUDE_REDIRECT, consentForm, INVITE, memoryOAuthLogger, oauthClient, oauthEnv, ORIGIN, pkce, signIn } from './oauth-test-harness.ts';
import { handleOAuthRequest } from './server.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const store = (tenant = 'default') => createPgOAuthStore(t.db, tenant);
const params = (extra: Record<string, string> = {}) => ({ response_type: 'code', client_id: CLAUDE, redirect_uri: CLAUDE_REDIRECT, state: 'state-123',
  code_challenge: pkce().challenge, code_challenge_method: 'S256', resource: ORIGIN + '/api/mcp', ...extra });

describe('BUILD-MCP-002 OAuth discovery', () => {
  it('publishes RFC 9728 and RFC 8414 metadata matching what Claude and ChatGPT require', async () => {
    const client = oauthClient({ env: oauthEnv() });
    const prm = await (await client.send('protected-resource', '/.well-known/oauth-protected-resource/api/mcp')).json();
    expect(prm).toEqual({ resource: ORIGIN + '/api/mcp', authorization_servers: [ORIGIN], scopes_supported: ['flofi.strategy', 'flofi.approval', 'flofi.runs'],
      bearer_methods_supported: ['header'], resource_name: 'FloFi' });
    const response = await client.send('authorization-server', '/.well-known/oauth-authorization-server');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const as = await response.json() as Record<string, unknown>;
    expect(as).toMatchObject({ issuer: ORIGIN, authorization_endpoint: ORIGIN + '/oauth/authorize', token_endpoint: ORIGIN + '/oauth/token',
      revocation_endpoint: ORIGIN + '/oauth/revoke', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true });
    expect(as).not.toHaveProperty('registration_endpoint');
    expect(JSON.stringify(as)).not.toMatch(/private_key_jwt|client_secret|implicit|password|client_credentials|plain/);
    const dcr = await (await oauthClient({ env: oauthEnv({ FLOFI_MCP_OAUTH_DCR: 'enabled' }) }).send('authorization-server', '/.well-known/oauth-authorization-server')).json();
    expect(dcr).toMatchObject({ registration_endpoint: ORIGIN + '/oauth/register' });
  });
  it('is absent unless enabled and fails closed when misconfigured or when the store is unavailable', async () => {
    const off = await handleOAuthRequest('authorization-server', new Request(ORIGIN + '/.well-known/oauth-authorization-server'), { env: {} });
    expect([off.status, await off.json()]).toEqual([404, { ok: false, code: 'MCP_OAUTH_NOT_ENABLED' }]);
    const reused = await handleOAuthRequest('token', new Request(ORIGIN + '/oauth/token', { method: 'POST' }), { env: oauthEnv({ API_AUTH_TOKEN: 's'.repeat(48) }) });
    expect([reused.status, await reused.json()]).toEqual([503, { ok: false, code: 'MCP_OAUTH_CONFIGURATION_INVALID' }]);
    // The remote runtime (API on another host) has no OAuth store: fail closed, never a memory or file fallback.
    const remote = await handleOAuthRequest('token', new Request(ORIGIN + '/oauth/token', { method: 'POST', body: 'grant_type=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      { env: oauthEnv({ API_BASE_URL: 'https://api.flofi.test' }) });
    expect([remote.status, await remote.json()]).toEqual([503, { error: 'temporarily_unavailable', code: 'MCP_OAUTH_STORE_UNAVAILABLE' }]);
    const page = await handleOAuthRequest('authorize', new Request(ORIGIN + '/oauth/authorize?' + new URLSearchParams(params())), { env: oauthEnv({ API_BASE_URL: 'https://api.flofi.test' }) });
    expect(page.status).toBe(503);
  });
});

describe('BUILD-MCP-002 authorization endpoint and consent', () => {
  it('never redirects before the client and the exact redirect URI are validated', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() });
    for (const query of [params({ client_id: 'https://evil.example/client.json' }), params({ client_id: 'https://claude.ai/oauth/unknown' }), params({ client_id: '' }),
      params({ redirect_uri: 'https://evil.example/cb' }), params({ redirect_uri: CLAUDE_REDIRECT + '/x' }), params({ redirect_uri: CHATGPT_REDIRECT }), params({ redirect_uri: '' })]) {
      const response = await client.authorize(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
    const repeated = await client.send('authorize', '/oauth/authorize?' + new URLSearchParams(params()).toString() + '&state=again');
    expect([repeated.status, repeated.headers.get('location')]).toEqual([400, null]);
  });
  it('returns protocol errors to the registered redirect with state and iss', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() });
    const cases: [Record<string, string>, string][] = [[{ response_type: 'token' }, 'unsupported_response_type'], [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge_method: '' }, 'invalid_request'], [{ code_challenge: 'short' }, 'invalid_request'], [{ scope: 'flofi.strategy admin' }, 'invalid_scope'],
      [{ resource: 'https://evil.example/api/mcp' }, 'invalid_target'], [{ resource: ORIGIN + '/api/other' }, 'invalid_target']];
    for (const [patch, error] of cases) {
      const response = await client.authorize(params(patch)), location = new URL(response.headers.get('location') ?? 'about:blank');
      expect([response.status, location.origin + location.pathname, location.searchParams.get('error'), location.searchParams.get('state'), location.searchParams.get('iss')],
        JSON.stringify(patch)).toEqual([303, CLAUDE_REDIRECT, error, 'state-123', ORIGIN]);
    }
    const noState = await client.authorize(params({ state: '' }));
    expect(new URL(noState.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });
  it('renders a script-free consent page showing the client, the redirect host and what the connection cannot do', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), response = await client.authorize(params());
    expect(response.status).toBe(200);
    const html = await response.text(), csp = response.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'"); expect(csp).toContain('form-action \'self\' https://claude.ai'); expect(csp).not.toContain('script-src');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect([response.headers.get('x-frame-options'), response.headers.get('referrer-policy'), response.headers.get('x-robots-tag')]).toEqual(['DENY', 'no-referrer', 'noindex, nofollow']);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Connect Claude to FloFi'); expect(html).toContain('<strong>claude.ai</strong>');
    expect(html).toContain('never moves funds'); expect(html).toContain('not financial advice'); expect(html).toContain('name="invite"');
    const cookie = response.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/^flofi_oauth_consent=oar_[a-z2-7]{26}\.flofi_csrf_[A-Za-z0-9_-]{43}; Path=\/oauth; Max-Age=600; HttpOnly; SameSite=Strict; Secure$/);
  });
  it('warns when a client returns only to localhost (Claude Code), matching its loopback redirect on any port', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() });
    const response = await client.authorize(params({ client_id: CLAUDE_CODE, redirect_uri: 'http://localhost:53682/callback' }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('returns to an app on your own computer (localhost)');
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self' http://localhost:53682");
  });
  it('accepts a consent decision only from FloFi\'s own page with the matching CSRF token and cookie', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), form = consentForm(await (await client.authorize(params())).text());
    const approve = { ...form, decision: 'approve', invite: INVITE };
    for (const headers of [{}, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }])
      expect((await client.decide(approve, headers)).status, JSON.stringify(headers)).toBe(403);
    expect((await client.decide({ ...approve, csrf: 'flofi_csrf_' + 'A'.repeat(43) })).status).toBe(403);
    const stranger = oauthClient({ env: oauthEnv(), store: store() });
    expect((await stranger.decide(approve)).status).toBe(403);
    const wrongInvite = await client.decide({ ...approve, invite: 'not-the-invite' });
    expect([wrongInvite.status, (await wrongInvite.text()).includes('That invite code was not accepted.')]).toEqual([400, true]);
    const ok = await client.decide(approve), location = new URL(ok.headers.get('location')!);
    expect([ok.status, location.origin + location.pathname, location.searchParams.get('state'), location.searchParams.get('iss')]).toEqual([303, CLAUDE_REDIRECT, 'state-123', ORIGIN]);
    expect(location.searchParams.get('code')).toMatch(/^flofi_code_[A-Za-z0-9_-]{43}$/);
    expect(ok.headers.getSetCookie().some(c => /^flofi_mcp_account=ma1\./.test(c) && /HttpOnly; SameSite=Lax; Secure/.test(c))).toBe(true);
    expect((await client.decide(approve)).status).toBe(403);
  });
  it('denial returns access_denied; an open deployment needs no invite; the browser keeps its pseudonymous account', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() });
    const denied = await client.decide({ ...consentForm(await (await client.authorize(params())).text()), decision: 'deny' });
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    const open = oauthClient({ env: oauthEnv({ FLOFI_MCP_OAUTH_ACCESS: 'open' }), store: store() });
    const first = await signIn(open, { invite: null });
    // A second connection from the same browser (here ChatGPT) reuses the account and needs no invite.
    const page = await (await open.authorize(params({ client_id: CHATGPT, redirect_uri: CHATGPT_REDIRECT }))).text();
    expect(page).toMatch(/signed in to FloFi as <code>mcpacct_[a-z2-7]{26}<\/code>/);
    expect(page).not.toContain('name="invite"');
    const second = await signIn(oauthClient({ env: oauthEnv(), store: store() }));
    expect(first.access_token).not.toBe(second.access_token);
  });
});

describe('BUILD-MCP-002 token endpoint', () => {
  it('exchanges a code once with the exact client, redirect and PKCE verifier, binding tokens to the MCP resource', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), tokens = await signIn(client);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900, scope: 'flofi.strategy flofi.approval' });
    expect(tokens.access_token).toMatch(/^flofi_at_[A-Za-z0-9_-]{43}$/); expect(tokens.refresh_token).toMatch(/^flofi_rt_[A-Za-z0-9_-]{43}$/);
    const replay = await client.token({ grant_type: 'authorization_code', code: tokens.code, redirect_uri: CLAUDE_REDIRECT, client_id: CLAUDE, code_verifier: tokens.verifier });
    expect([replay.status, await replay.json()]).toEqual([400, { error: 'invalid_grant' }]);
    // The replay revoked what the code had minted.
    expect(await store().authenticate((await import('./crypto.ts')).credentialDigest((await import('./config.ts')).deriveKey('s'.repeat(48), 'token'), tokens.access_token), new Date())).toBeNull();
  });
  it('refuses a wrong verifier, client, redirect or resource, and burns the code on the first attempt', async () => {
    const env = oauthEnv();
    for (const patch of [{ code_verifier: pkce().verifier }, { client_id: CHATGPT }, { redirect_uri: CLAUDE_REDIRECT + '/x' }, { resource: 'https://evil.example/api/mcp' }]) {
      const client = oauthClient({ env, store: store() }), { verifier, challenge } = pkce();
      const form = consentForm(await (await client.authorize(params({ code_challenge: challenge }))).text());
      const code = new URL((await client.decide({ ...form, decision: 'approve', invite: INVITE })).headers.get('location')!).searchParams.get('code')!;
      const good = { grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT, client_id: CLAUDE, code_verifier: verifier };
      const bad = await client.token({ ...good, ...patch });
      expect((await bad.json() as { error: string }).error, JSON.stringify(patch)).toBe('resource' in patch ? 'invalid_target' : 'invalid_grant');
      if (!('resource' in patch)) expect((await (await client.token(good)).json() as { error: string }).error).toBe('invalid_grant');
    }
  });
  it('expires codes after 60 seconds', async () => {
    let now = new Date('2026-10-06T12:00:00Z');
    const client = oauthClient({ env: oauthEnv(), store: store(), now: () => now }), { verifier, challenge } = pkce();
    const form = consentForm(await (await client.authorize(params({ code_challenge: challenge }))).text());
    const code = new URL((await client.decide({ ...form, decision: 'approve', invite: INVITE })).headers.get('location')!).searchParams.get('code')!;
    now = new Date(now.getTime() + 61_000);
    expect(await (await client.token({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT, client_id: CLAUDE, code_verifier: verifier })).json())
      .toEqual({ error: 'invalid_grant' });
  });
  it('rotates refresh tokens, detects reuse, narrows scope and refuses unsupported grants', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), first = await signIn(client);
    const refresh = (token: string, extra: Record<string, string> = {}) => client.token({ grant_type: 'refresh_token', refresh_token: token, client_id: CLAUDE, ...extra });
    expect(await (await refresh(first.refresh_token, { scope: 'flofi.runs' })).json()).toEqual({ error: 'invalid_scope' });
    const second = await (await refresh(first.refresh_token, { scope: 'flofi.strategy' })).json() as { refresh_token: string; scope: string; access_token: string };
    expect(second.scope).toBe('flofi.strategy');
    expect(await (await refresh(first.refresh_token)).json()).toEqual({ error: 'invalid_grant' });
    expect(await (await client.token({ grant_type: 'client_credentials', client_id: CLAUDE })).json()).toEqual({ error: 'unsupported_grant_type' });
    expect(await (await client.token({ grant_type: 'password', client_id: CLAUDE, username: 'a', password: 'b' })).json()).toEqual({ error: 'unsupported_grant_type' });
    expect((await client.token({ grant_type: 'refresh_token', refresh_token: second.refresh_token })).status).toBe(401);
    const json = await client.send('token', '/oauth/token', { method: 'POST', browser: false, headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(await json.json()).toEqual({ error: 'invalid_request' });
  });
  it('revokes per RFC 7009 and never reveals whether a token existed', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), tokens = await signIn(client);
    expect((await client.revoke({ token: 'flofi_rt_' + 'x'.repeat(43), client_id: CLAUDE })).status).toBe(200);
    expect((await client.revoke({ token: tokens.refresh_token, client_id: CHATGPT })).status).toBe(200);
    expect((await (await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLAUDE })).json() as { access_token?: string }).access_token)
      .toMatch(/^flofi_at_/);
    const fresh = await signIn(client);
    expect((await client.revoke({ token: fresh.refresh_token, client_id: CLAUDE })).status).toBe(200);
    expect(await (await client.token({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token, client_id: CLAUDE })).json()).toEqual({ error: 'invalid_grant' });
  });
  it('keeps every token, code and CSRF value out of the logs', async () => {
    const logger = memoryOAuthLogger(), client = oauthClient({ env: oauthEnv(), store: store(), logger }), tokens = await signIn(client);
    await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLAUDE });
    await client.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CLAUDE });
    const text = JSON.stringify(logger.lines);
    expect(logger.lines.map(l => l.event)).toEqual(expect.arrayContaining(['mcp.oauth.approved', 'mcp.oauth.token_issued', 'mcp.oauth.token_refused']));
    expect(text).not.toMatch(/flofi_(at|rt|code|csrf|hs)_|state-|mcpacct_/);
  });
  it('isolates tenants: a code minted on one deployment cannot be redeemed on another', async () => {
    await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('other') ON CONFLICT DO NOTHING`);
    const client = oauthClient({ env: oauthEnv(), store: store() }), { verifier, challenge } = pkce();
    const form = consentForm(await (await client.authorize(params({ code_challenge: challenge }))).text());
    const code = new URL((await client.decide({ ...form, decision: 'approve', invite: INVITE })).headers.get('location')!).searchParams.get('code')!;
    const elsewhere = oauthClient({ env: oauthEnv({ TENANT_ID: 'other' }), store: store('other') });
    expect(await (await elsewhere.token({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_REDIRECT, client_id: CLAUDE, code_verifier: verifier })).json())
      .toEqual({ error: 'invalid_grant' });
  });
});

describe('BUILD-MCP-002 dynamic registration and abuse limits', () => {
  it('registers only narrow public clients when DCR is enabled', async () => {
    expect((await oauthClient({ env: oauthEnv(), store: store() }).register({ redirect_uris: [CLAUDE_REDIRECT] })).status).toBe(404);
    const client = oauthClient({ env: oauthEnv({ FLOFI_MCP_OAUTH_DCR: 'enabled' }), store: store() });
    const created = await client.register({ redirect_uris: [CLAUDE_REDIRECT], client_name: 'Claude', token_endpoint_auth_method: 'none' });
    const body = await created.json() as { client_id: string; token_endpoint_auth_method: string };
    expect([created.status, body.token_endpoint_auth_method]).toEqual([201, 'none']);
    expect(body.client_id).toMatch(/^flofi_dcr_[a-z2-7]{26}$/);
    expect((await client.authorize(params({ client_id: body.client_id }))).status).toBe(200);
    for (const [meta, error] of [[{ redirect_uris: ['https://evil.example/cb'] }, 'invalid_redirect_uri'], [{ redirect_uris: ['http://claude.ai/cb'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: [] }, 'invalid_redirect_uri'], [{ redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }, 'invalid_client_metadata'],
      [{ redirect_uris: [CLAUDE_REDIRECT], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ redirect_uris: [CLAUDE_REDIRECT], response_types: ['token'] }, 'invalid_client_metadata']] as const)
      expect(await (await client.register(meta)).json(), JSON.stringify(meta)).toEqual({ error });
    expect((await client.register({ redirect_uris: ['http://localhost:9999/cb'] })).status).toBe(201);
  });
  it('limits authorization requests per caller', async () => {
    const client = oauthClient({ env: oauthEnv(), store: store() }), statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await client.send('authorize', '/oauth/authorize?' + new URLSearchParams(params()), { headers: { 'x-forwarded-for': '203.0.113.9' } })).status);
    expect(statuses.slice(0, 30).every(s => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
  it('fetches each CIMD document once and serves it from the cache afterwards', async () => {
    const fetched: string[] = [], client = oauthClient({ env: oauthEnv({ TENANT_ID: 'cache' }), store: store('cache'), fetched });
    await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('cache') ON CONFLICT DO NOTHING`);
    for (let i = 0; i < 3; i++) expect((await client.authorize(params())).status).toBe(200);
    expect(fetched).toEqual([CLAUDE]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the MCP OAuth store on a disposable loopback PostgreSQL (migration 0005). Consent, single-use codes, code
 * replay, refresh rotation and reuse detection, revocation, tenant isolation, rate limits, retention, the handoff state
 * machine enforced by the database, and the absence of any plaintext secret column.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { deriveKey, type McpScope } from './config.ts';
import { credentialDigest, newCredential, newId, pkceMatches } from './crypto.ts';
import { createPgOAuthStore } from './pg-store.ts';
import type { AuthorizationRecord, McpOAuthStore, TokenIssue } from './store.ts';

const KEY = deriveKey('k'.repeat(40), 'token'), CSRF = deriveKey('k'.repeat(40), 'csrf');
const RESOURCE = 'https://flofi.test/api/mcp', CLIENT = 'https://claude.ai/oauth/mcp-oauth-client-metadata', REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const MIN = 60_000, DAY = 86_400_000;
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  for (const tenant of ['tenant-a', 'tenant-b']) await t.db.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenant]);
});
afterAll(async () => { await t?.drop(); });

const at = (ms: number) => new Date(Date.UTC(2026, 9, 6, 12) + ms);
function issue(scopes: readonly McpScope[], now: Date, familyId = newId('fam'), familyExpiresAt = new Date(now.getTime() + 30 * DAY)) {
  const access = newCredential('access'), refresh = newCredential('refresh');
  const tokens: TokenIssue = { accessDigest: credentialDigest(KEY, access), accessExpiresAt: new Date(now.getTime() + 15 * MIN),
    refreshDigest: credentialDigest(KEY, refresh), refreshExpiresAt: familyExpiresAt, familyId, familyExpiresAt, scopes, resource: RESOURCE };
  return { access, refresh, tokens };
}
/** A full consent: pending request → approval (new account) → code. */
async function consent(store: McpOAuthStore, now: Date, scopes: McpScope[] = ['flofi.strategy', 'flofi.approval']) {
  const requestId = newId('oar'), csrf = newCredential('csrf'), code = newCredential('code'), accountId = newId('mcpacct'), grantId = newId('grt');
  await store.createAuthorization({ requestId, clientId: CLIENT, clientName: 'Claude', redirectUri: REDIRECT, state: 'st-1', codeChallenge: CHALLENGE, scopes,
    resource: RESOURCE, csrfDigest: credentialDigest(CSRF, csrf), expiresAt: new Date(now.getTime() + 10 * MIN) });
  const decided = await store.decide(requestId, credentialDigest(CSRF, csrf), { decision: 'APPROVE', accountId, createAccount: true, grantId,
    codeDigest: credentialDigest(KEY, code), codeExpiresAt: new Date(now.getTime() + MIN) }, now);
  return { requestId, csrf, code, accountId, grantId, decided };
}
const verifyWith = (verifier: string, client = CLIENT, redirect = REDIRECT) => (a: AuthorizationRecord) =>
  a.clientId !== client ? 'CLIENT_MISMATCH' : a.redirectUri !== redirect ? 'REDIRECT_MISMATCH' : pkceMatches(verifier, a.codeChallenge) ? null : 'PKCE_MISMATCH';

describe('BUILD-MCP-002 OAuth store (PostgreSQL)', () => {
  it('stores digests only: no column can hold a plaintext token, code, secret or CSRF value', async () => {
    const { rows } = await t.db.query<{ table_name: string; column_name: string; data_type: string }>(`SELECT table_name, column_name, data_type
      FROM information_schema.columns WHERE table_name LIKE 'mcp_%'`);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      if (/digest$/.test(row.column_name)) expect(row.data_type, row.column_name).toBe('bytea');
      expect(row.column_name).not.toMatch(/^(token|secret|code|csrf|access_token|refresh_token|password|invite|ip|private_key|seed)$/);
    }
  });

  it('decides a pending request once, only with its CSRF token and before it expires', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0);
    const requestId = newId('oar'), csrf = newCredential('csrf');
    await store.createAuthorization({ requestId, clientId: CLIENT, clientName: 'Claude', redirectUri: REDIRECT, state: 's', codeChallenge: CHALLENGE,
      scopes: ['flofi.strategy'], resource: RESOURCE, csrfDigest: credentialDigest(CSRF, csrf), expiresAt: at(10 * MIN) });
    const approve = { decision: 'APPROVE' as const, accountId: newId('mcpacct'), createAccount: true, grantId: newId('grt'),
      codeDigest: credentialDigest(KEY, newCredential('code')), codeExpiresAt: at(MIN) };
    expect(await store.decide(requestId, credentialDigest(CSRF, newCredential('csrf')), approve, now)).toBeNull();
    expect(await store.decide(requestId, credentialDigest(CSRF, csrf), approve, at(11 * MIN))).toBeNull();
    expect(await createPgOAuthStore(t.db, 'tenant-b').decide(requestId, credentialDigest(CSRF, csrf), approve, now)).toBeNull();
    expect((await store.decide(requestId, credentialDigest(CSRF, csrf), approve, now))?.status).toBe('APPROVED');
    expect(await store.decide(requestId, credentialDigest(CSRF, csrf), { decision: 'DENY' }, now)).toBeNull();
    expect((await store.getAuthorization(requestId))?.status).toBe('APPROVED');
  });

  it('redeems a code once; a failed verifier consumes it; a replay revokes everything issued from it', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0);
    const first = await consent(store, now);
    expect(await store.redeemCode(credentialDigest(KEY, first.code), now, verifyWith('x'.repeat(43)), a => issue(a.scopes, now).tokens))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'PKCE_MISMATCH' });
    expect(await store.redeemCode(credentialDigest(KEY, first.code), now, verifyWith(VERIFIER), a => issue(a.scopes, now).tokens))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'CODE_REPLAYED' });

    const second = await consent(store, now), minted = issue(['flofi.strategy', 'flofi.approval'], now);
    expect(await store.redeemCode(credentialDigest(KEY, second.code), now, verifyWith(VERIFIER), () => minted.tokens))
      .toEqual({ ok: true, scopes: ['flofi.strategy', 'flofi.approval'], accountId: second.accountId });
    const principal = await store.authenticate(credentialDigest(KEY, minted.access), now);
    expect(principal).toMatchObject({ accountId: second.accountId, grantId: second.grantId, clientId: CLIENT, clientName: 'Claude', resource: RESOURCE,
      scopes: ['flofi.strategy', 'flofi.approval'] });
    // Replay after success: the client or the code leaked. The access token it minted stops working at once.
    expect((await store.redeemCode(credentialDigest(KEY, second.code), now, verifyWith(VERIFIER), () => issue(['flofi.strategy'], now).tokens)).ok).toBe(false);
    expect(await store.authenticate(credentialDigest(KEY, minted.access), now)).toBeNull();

    const third = await consent(store, now);
    expect(await store.redeemCode(credentialDigest(KEY, third.code), at(MIN + 1), verifyWith(VERIFIER), a => issue(a.scopes, now).tokens))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'CODE_EXPIRED' });
    const fourth = await consent(store, now);
    expect(await store.redeemCode(credentialDigest(KEY, fourth.code), now, verifyWith(VERIFIER, CLIENT, REDIRECT + '/other'), a => issue(a.scopes, now).tokens))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'REDIRECT_MISMATCH' });
    expect(await store.redeemCode(credentialDigest(KEY, newCredential('code')), now, verifyWith(VERIFIER), a => issue(a.scopes, now).tokens))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'CODE_UNKNOWN' });
  });

  it('access tokens expire, are tenant-bound and never authenticate as refresh tokens (or the reverse)', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0), c = await consent(store, now), minted = issue(['flofi.strategy'], now);
    expect((await store.redeemCode(credentialDigest(KEY, c.code), now, verifyWith(VERIFIER), () => minted.tokens)).ok).toBe(true);
    expect(await store.authenticate(credentialDigest(KEY, minted.access), at(15 * MIN - 1))).not.toBeNull();
    expect(await store.authenticate(credentialDigest(KEY, minted.access), at(15 * MIN))).toBeNull();
    expect(await store.authenticate(credentialDigest(KEY, minted.refresh), now)).toBeNull();
    expect(await createPgOAuthStore(t.db, 'tenant-b').authenticate(credentialDigest(KEY, minted.access), now)).toBeNull();
    expect((await store.rotateRefresh(credentialDigest(KEY, minted.access), CLIENT, now, 10_000, { scopes: null, resource: null },
      (scopes, resource, family, cap) => issue(scopes, now, family, cap).tokens)).ok).toBe(false);
  });

  it('rotates refresh tokens; a racing reuse is refused harmlessly, a later reuse revokes the whole family', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0), c = await consent(store, now), first = issue(['flofi.strategy', 'flofi.approval'], now);
    expect((await store.redeemCode(credentialDigest(KEY, c.code), now, verifyWith(VERIFIER), () => first.tokens)).ok).toBe(true);
    let second!: ReturnType<typeof issue>;
    const rotate = (refresh: string, when: Date, requested: { scopes: McpScope[] | null; resource: string | null } = { scopes: null, resource: null }, client = CLIENT) =>
      store.rotateRefresh(credentialDigest(KEY, refresh), client, when, 10_000, requested, (scopes, _resource, family, cap) => (second = issue(scopes, when, family, cap)).tokens);
    expect(await rotate(first.refresh, at(MIN), { scopes: null, resource: null }, 'https://chatgpt.com/oauth/BpZIpxL-aggt/client.json'))
      .toEqual({ ok: false, error: 'invalid_grant', reason: 'REFRESH_UNKNOWN' });
    expect(await rotate(first.refresh, at(MIN), { scopes: ['flofi.runs'], resource: null })).toEqual({ ok: false, error: 'invalid_scope', reason: 'SCOPE_NOT_GRANTED' });
    expect(await rotate(first.refresh, at(MIN), { scopes: null, resource: 'https://evil.test/api/mcp' })).toEqual({ ok: false, error: 'invalid_target', reason: 'RESOURCE_MISMATCH' });
    expect(await rotate(first.refresh, at(MIN), { scopes: ['flofi.strategy'], resource: RESOURCE })).toEqual({ ok: true, scopes: ['flofi.strategy'], accountId: c.accountId });
    const rotated = second;
    expect(await store.authenticate(credentialDigest(KEY, rotated.access), at(MIN))).toMatchObject({ scopes: ['flofi.strategy'] });
    // The same refresh token again within the grace window (a client retrying in parallel): refused, nothing revoked.
    expect(await rotate(first.refresh, at(MIN + 5_000))).toEqual({ ok: false, error: 'invalid_grant', reason: 'REFRESH_RACE' });
    expect(await store.authenticate(credentialDigest(KEY, rotated.access), at(MIN + 5_000))).not.toBeNull();
    // Later reuse means a stolen token: the family dies, including the tokens the legitimate client holds now.
    expect(await rotate(first.refresh, at(2 * MIN))).toEqual({ ok: false, error: 'invalid_grant', reason: 'REFRESH_REUSED' });
    expect(await store.authenticate(credentialDigest(KEY, rotated.access), at(2 * MIN))).toBeNull();
    expect(await rotate(rotated.refresh, at(2 * MIN))).toEqual({ ok: false, error: 'invalid_grant', reason: 'REFRESH_REVOKED' });
  });

  it('a refresh family never outlives its cap', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0), c = await consent(store, now), minted = issue(['flofi.strategy'], now);
    expect((await store.redeemCode(credentialDigest(KEY, c.code), now, verifyWith(VERIFIER), () => minted.tokens)).ok).toBe(true);
    const result = await store.rotateRefresh(credentialDigest(KEY, minted.refresh), CLIENT, at(30 * DAY), 10_000, { scopes: null, resource: null },
      (scopes, _r, family, cap) => issue(scopes, at(30 * DAY), family, cap).tokens);
    expect(result).toEqual({ ok: false, error: 'invalid_grant', reason: 'REFRESH_EXPIRED' });
  });

  it('revokes per RFC 7009: refresh → family, access → itself; another client cannot revoke', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0), c = await consent(store, now), minted = issue(['flofi.strategy'], now);
    expect((await store.redeemCode(credentialDigest(KEY, c.code), now, verifyWith(VERIFIER), () => minted.tokens)).ok).toBe(true);
    await store.revoke(credentialDigest(KEY, minted.access), 'https://chatgpt.com/oauth/BpZIpxL-aggt/client.json', now);
    expect(await store.authenticate(credentialDigest(KEY, minted.access), now)).not.toBeNull();
    await store.revoke(credentialDigest(KEY, minted.refresh), CLIENT, now);
    expect(await store.authenticate(credentialDigest(KEY, minted.access), now)).toBeNull();
    await store.revoke(credentialDigest(KEY, newCredential('access')), CLIENT, now);
  });

  it('a disabled account stops authenticating at once', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0), c = await consent(store, now), minted = issue(['flofi.strategy'], now);
    expect((await store.redeemCode(credentialDigest(KEY, c.code), now, verifyWith(VERIFIER), () => minted.tokens)).ok).toBe(true);
    expect(await store.accountActive(c.accountId)).toBe(true);
    await t.db.query(`UPDATE mcp_accounts SET status = 'DISABLED' WHERE tenant_id = 'tenant-a' AND account_id = $1`, [c.accountId]);
    expect(await store.authenticate(credentialDigest(KEY, minted.access), now)).toBeNull();
    expect(await store.accountActive(c.accountId)).toBe(false);
  });

  it('caches clients per tenant, never lets a DCR registration overwrite a CIMD client, and honours expiry', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0);
    await store.saveClient({ clientId: CLIENT, kind: 'CIMD', clientName: 'Claude', redirectUris: [REDIRECT], metadataSha256: 'a'.repeat(64), expiresAt: at(60 * MIN) }, now);
    await store.saveClient({ clientId: CLIENT, kind: 'DCR', clientName: 'Evil', redirectUris: ['https://evil.test/cb'], metadataSha256: 'b'.repeat(64), expiresAt: at(DAY) }, now);
    expect(await store.getClient(CLIENT, now)).toMatchObject({ kind: 'CIMD', clientName: 'Claude', redirectUris: [REDIRECT] });
    expect(await store.getClient(CLIENT, at(60 * MIN))).toBeNull();
    expect(await createPgOAuthStore(t.db, 'tenant-b').getClient(CLIENT, now)).toBeNull();
  });

  it('rate limits by fixed windows and purges expired state', async () => {
    const store = createPgOAuthStore(t.db, 'tenant-a'), now = at(0);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.allow('authorize:ip:test', 3, 600, now));
    expect(results).toEqual([true, true, true, false]);
    expect(await store.allow('authorize:ip:test', 3, 600, at(10 * MIN))).toBe(true);
    expect(await createPgOAuthStore(t.db, 'tenant-b').allow('authorize:ip:test', 3, 600, now)).toBe(true);
    await store.purge(at(40 * DAY));
    const left = await t.db.query<{ n: number }>(`SELECT (SELECT count(*) FROM mcp_oauth_tokens WHERE tenant_id = 'tenant-a')::int
      + (SELECT count(*) FROM mcp_rate_limits WHERE tenant_id = 'tenant-a')::int + (SELECT count(*) FROM mcp_oauth_authorizations WHERE tenant_id = 'tenant-a')::int AS n`);
    expect(left.rows[0]!.n).toBe(0);
  });
});

describe('BUILD-MCP-002 handoff state machine (database-enforced)', () => {
  async function handoff(status = 'PENDING') {
    const store = createPgOAuthStore(t.db, 'tenant-a'), c = await consent(store, at(0)), id = newId('apr');
    await t.db.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, account_id, grant_id, client_id, client_name, secret_digest, strategy, workflow_hash,
      engine_version, network_environment, funds_class, plan, status, expires_at) VALUES ('tenant-a', $1, $2, $3, $4, 'Claude', $5, '{"version":1}', $6, 'flofi-engine-1',
      'MAINNET', 'REAL_FUNDS', '{"kind":"SINGLE_FLOW","steps":[]}', $7, $8)`,
    [id, c.accountId, c.grantId, CLIENT, credentialDigest(KEY, newCredential('handoff')), '0x' + 'a'.repeat(64), status, at(15 * MIN)]);
    return id;
  }
  const update = (id: string, set: string, values: unknown[] = []) => t.db.query(`UPDATE mcp_handoffs SET ${set} WHERE tenant_id = 'tenant-a' AND handoff_id = $1`, [id, ...values]);
  const claim = `status = 'CLAIMED', claimed_namespace = 'eip155', claimed_address = '0x${'1'.repeat(40)}', claimed_at = now(), claim_expires_at = now() + interval '10 minutes'`;

  it('accepts a mainnet environment as plain data (policy, not schema, decides) and moves forward only', async () => {
    const id = await handoff();
    await update(id, claim);
    await expect(update(id, `claimed_address = '0x${'2'.repeat(40)}'`)).rejects.toThrow('MCP_HANDOFF_CLAIM_IMMUTABLE');
    await expect(update(id, `status = 'PENDING'`)).rejects.toThrow('MCP_HANDOFF_TRANSITION_INVALID');
    await expect(update(id, `status = 'SUPERSEDED', ended_at = now()`)).rejects.toThrow('MCP_HANDOFF_TRANSITION_INVALID');
    await update(id, `status = 'APPLIED', applied_at = now()`);
    await update(id, `run_ids = ARRAY['run-1'], share_status = true`);
    await expect(update(id, `status = 'REVOKED', ended_at = now()`)).rejects.toThrow('MCP_HANDOFF_TRANSITION_INVALID');
  });

  it('never revives a terminal handoff and never changes what it proposes', async () => {
    for (const end of ['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE']) {
      const id = await handoff();
      await expect(update(id, `strategy = '{"version":2}'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
      await expect(update(id, `workflow_hash = $2`, ['0x' + 'b'.repeat(64)])).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
      await update(id, `status = '${end}', ended_at = now()`);
      await expect(update(id, `status = 'PENDING'`)).rejects.toThrow('MCP_HANDOFF_TERMINAL');
      await expect(update(id, claim)).rejects.toThrow('MCP_HANDOFF_TERMINAL');
      await expect(update(id, `share_status = true`)).rejects.toThrow('MCP_HANDOFF_TERMINAL');
    }
  });

  it('rejects a claim that is not a well-formed wallet of its namespace', async () => {
    const id = await handoff();
    await expect(update(id, `status = 'CLAIMED', claimed_namespace = 'solana', claimed_address = '0x${'1'.repeat(40)}', claimed_at = now(),
      claim_expires_at = now()`)).rejects.toThrow();
    await update(id, `status = 'CLAIMED', claimed_namespace = 'solana', claimed_address = 'So11111111111111111111111111111111111111112', claimed_at = now(),
      claim_expires_at = now()`);
  });
});

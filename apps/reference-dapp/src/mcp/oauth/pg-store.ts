// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the PostgreSQL implementation of `McpOAuthStore` (migration 0005). Every statement is scoped by tenant;
 * state-changing operations lock their row (`FOR UPDATE`) inside one short transaction. No secret is ever written: callers
 * pass keyed digests. Timestamps come from the caller's clock so tests can move time; PostgreSQL only stores them.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import { fixedWindow } from '../../platform/fixed-window.ts';
import { MCP_SCOPES, type McpScope } from './config.ts';
import type { AccessPrincipal, AuthorizationRecord, AuthorizationStatus, ClientKind, GrantResult, McpOAuthStore, TokenIssue } from './store.ts';

const scopesOf = (value: unknown): McpScope[] => Array.isArray(value) ? value.filter((s): s is McpScope => MCP_SCOPES.includes(s as McpScope)) : [];
const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const DAY = 86_400_000;

function authorizationOf(row: Row): AuthorizationRecord {
  return { requestId: String(row.request_id), status: row.status as AuthorizationStatus, clientId: String(row.client_id), clientName: String(row.client_name),
    redirectUri: String(row.redirect_uri), state: String(row.state), codeChallenge: String(row.code_challenge), scopes: scopesOf(row.scopes),
    resource: String(row.resource), csrfDigest: row.csrf_digest as Buffer, accountId: row.account_id === null ? null : String(row.account_id),
    grantId: row.grant_id === null ? null : String(row.grant_id), codeExpiresAt: row.code_expires_at === null ? null : date(row.code_expires_at),
    expiresAt: date(row.expires_at) };
}
async function insertTokens(tx: Queryable, tenantId: string, grantId: string, issue: TokenIssue, now: Date): Promise<void> {
  const insert = `INSERT INTO mcp_oauth_tokens (tenant_id, token_digest, kind, grant_id, family_id, scopes, resource, expires_at, family_expires_at, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
  await tx.query(insert, [tenantId, issue.accessDigest, 'ACCESS', grantId, issue.familyId, issue.scopes, issue.resource, issue.accessExpiresAt, issue.familyExpiresAt, now]);
  await tx.query(insert, [tenantId, issue.refreshDigest, 'REFRESH', grantId, issue.familyId, issue.scopes, issue.resource, issue.refreshExpiresAt, issue.familyExpiresAt, now]);
}
const refused = (error: 'invalid_grant' | 'invalid_scope' | 'invalid_target', reason: string): GrantResult => ({ ok: false, error, reason });

export function createPgOAuthStore(db: Database, tenantId: string): McpOAuthStore {
  return {
    async getClient(clientId, now) {
      const row = (await db.query(`SELECT client_id, kind, client_name, redirect_uris, metadata_sha256, expires_at FROM mcp_oauth_clients
        WHERE tenant_id = $1 AND client_id = $2 AND expires_at > $3`, [tenantId, clientId, now])).rows[0];
      return row ? { clientId: String(row.client_id), kind: row.kind as ClientKind, clientName: String(row.client_name),
        redirectUris: (row.redirect_uris as string[]).map(String), metadataSha256: String(row.metadata_sha256), expiresAt: date(row.expires_at) } : null;
    },
    async saveClient(client, now) {
      await db.query(`INSERT INTO mcp_oauth_clients (tenant_id, client_id, kind, client_name, redirect_uris, metadata_sha256, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (tenant_id, client_id) DO UPDATE SET kind = EXCLUDED.kind, client_name = EXCLUDED.client_name, redirect_uris = EXCLUDED.redirect_uris,
          metadata_sha256 = EXCLUDED.metadata_sha256, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
        WHERE mcp_oauth_clients.kind = EXCLUDED.kind`,
      [tenantId, client.clientId, client.kind, client.clientName, client.redirectUris, client.metadataSha256, client.expiresAt, now]);
    },
    async createAuthorization(a) {
      await db.query(`INSERT INTO mcp_oauth_authorizations (tenant_id, request_id, status, client_id, client_name, redirect_uri, state, code_challenge, scopes,
        resource, csrf_digest, expires_at) VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenantId, a.requestId, a.clientId, a.clientName, a.redirectUri, a.state, a.codeChallenge, a.scopes, a.resource, a.csrfDigest, a.expiresAt]);
    },
    async getAuthorization(requestId) {
      const row = (await db.query('SELECT * FROM mcp_oauth_authorizations WHERE tenant_id = $1 AND request_id = $2', [tenantId, requestId])).rows[0];
      return row ? authorizationOf(row) : null;
    },
    decide: (requestId, csrfDigest, decision, now) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM mcp_oauth_authorizations WHERE tenant_id = $1 AND request_id = $2 FOR UPDATE', [tenantId, requestId])).rows[0];
      if (!row) return null;
      const current = authorizationOf(row);
      if (current.status !== 'PENDING' || current.expiresAt <= now || current.csrfDigest.length !== csrfDigest.length || !timingSafeEqual(current.csrfDigest, csrfDigest)) return null;
      if (decision.decision === 'DENY') {
        await tx.query(`UPDATE mcp_oauth_authorizations SET status = 'DENIED', updated_at = $3 WHERE tenant_id = $1 AND request_id = $2`, [tenantId, requestId, now]);
        return { ...current, status: 'DENIED' };
      }
      if (decision.createAccount) await tx.query(`INSERT INTO mcp_accounts (tenant_id, account_id, created_at) VALUES ($1, $2, $3)`, [tenantId, decision.accountId, now]);
      const account = (await tx.query(`SELECT status FROM mcp_accounts WHERE tenant_id = $1 AND account_id = $2 FOR SHARE`, [tenantId, decision.accountId])).rows[0];
      if (account?.status !== 'ACTIVE') return null;
      await tx.query(`INSERT INTO mcp_oauth_grants (tenant_id, grant_id, account_id, client_id, client_name, scopes, resource, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [tenantId, decision.grantId, decision.accountId, current.clientId, current.clientName, current.scopes, current.resource, now]);
      await tx.query(`UPDATE mcp_oauth_authorizations SET status = 'APPROVED', account_id = $3, grant_id = $4, code_digest = $5, code_expires_at = $6, updated_at = $7
        WHERE tenant_id = $1 AND request_id = $2`, [tenantId, requestId, decision.accountId, decision.grantId, decision.codeDigest, decision.codeExpiresAt, now]);
      return { ...current, status: 'APPROVED', accountId: decision.accountId, grantId: decision.grantId, codeExpiresAt: decision.codeExpiresAt };
    }),
    redeemCode: (codeDigest, now, verify, issue) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM mcp_oauth_authorizations WHERE tenant_id = $1 AND code_digest = $2 FOR UPDATE', [tenantId, codeDigest])).rows[0];
      if (!row) return refused('invalid_grant', 'CODE_UNKNOWN');
      const authorization = authorizationOf(row);
      if (authorization.status === 'CONSUMED') {
        // Replay: the code leaked or the client is confused. Revoke everything issued from this authorization.
        await tx.query(`UPDATE mcp_oauth_grants SET status = 'REVOKED', revoked_at = $3 WHERE tenant_id = $1 AND grant_id = $2 AND status = 'ACTIVE'`,
          [tenantId, authorization.grantId, now]);
        await tx.query('UPDATE mcp_oauth_tokens SET revoked_at = $3 WHERE tenant_id = $1 AND grant_id = $2 AND revoked_at IS NULL', [tenantId, authorization.grantId, now]);
        return refused('invalid_grant', 'CODE_REPLAYED');
      }
      if (authorization.status !== 'APPROVED') return refused('invalid_grant', 'CODE_NOT_REDEEMABLE');
      // Single use: consumed by this attempt whatever its outcome.
      await tx.query(`UPDATE mcp_oauth_authorizations SET status = 'CONSUMED', updated_at = $3 WHERE tenant_id = $1 AND request_id = $2`, [tenantId, authorization.requestId, now]);
      if (!authorization.codeExpiresAt || authorization.codeExpiresAt <= now) return refused('invalid_grant', 'CODE_EXPIRED');
      const failure = verify(authorization);
      if (failure) return refused('invalid_grant', failure);
      const live = (await tx.query(`SELECT g.status AS grant_status, a.status AS account_status FROM mcp_oauth_grants g JOIN mcp_accounts a USING (tenant_id, account_id)
        WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, authorization.grantId])).rows[0];
      if (live?.grant_status !== 'ACTIVE' || live.account_status !== 'ACTIVE') return refused('invalid_grant', 'GRANT_INACTIVE');
      const tokens = issue(authorization);
      await insertTokens(tx, tenantId, authorization.grantId!, tokens, now);
      return { ok: true, scopes: tokens.scopes, accountId: authorization.accountId! };
    }),
    rotateRefresh: (refreshDigest, clientId, now, graceMs, requested, issue) => db.transaction(async tx => {
      const row = (await tx.query(`SELECT t.*, g.client_id, g.account_id, g.status AS grant_status, a.status AS account_status
        FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.tenant_id = t.tenant_id AND g.grant_id = t.grant_id
        JOIN mcp_accounts a ON a.tenant_id = g.tenant_id AND a.account_id = g.account_id
        WHERE t.tenant_id = $1 AND t.token_digest = $2 FOR UPDATE OF t`, [tenantId, refreshDigest])).rows[0];
      if (!row || row.kind !== 'REFRESH' || row.client_id !== clientId) return refused('invalid_grant', 'REFRESH_UNKNOWN');
      if (row.revoked_at !== null || row.grant_status !== 'ACTIVE' || row.account_status !== 'ACTIVE') return refused('invalid_grant', 'REFRESH_REVOKED');
      if (row.used_at !== null) {
        if (now.getTime() - date(row.used_at).getTime() <= graceMs) return refused('invalid_grant', 'REFRESH_RACE');
        await tx.query('UPDATE mcp_oauth_tokens SET revoked_at = $3 WHERE tenant_id = $1 AND family_id = $2 AND revoked_at IS NULL', [tenantId, row.family_id, now]);
        return refused('invalid_grant', 'REFRESH_REUSED');
      }
      if (date(row.expires_at) <= now) return refused('invalid_grant', 'REFRESH_EXPIRED');
      const held = scopesOf(row.scopes);
      if (requested.scopes && !requested.scopes.every(s => held.includes(s))) return refused('invalid_scope', 'SCOPE_NOT_GRANTED');
      if (requested.resource !== null && requested.resource !== row.resource) return refused('invalid_target', 'RESOURCE_MISMATCH');
      await tx.query('UPDATE mcp_oauth_tokens SET used_at = $3 WHERE tenant_id = $1 AND token_digest = $2', [tenantId, refreshDigest, now]);
      const tokens = issue(requested.scopes ?? held, String(row.resource), String(row.family_id), date(row.family_expires_at));
      await insertTokens(tx, tenantId, String(row.grant_id), tokens, now);
      return { ok: true, scopes: tokens.scopes, accountId: String(row.account_id) };
    }),
    async authenticate(accessDigest, now): Promise<AccessPrincipal | null> {
      const row = (await db.query(`SELECT t.grant_id, t.family_id, t.scopes, t.resource, t.expires_at, g.account_id, g.client_id, g.client_name
        FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.tenant_id = t.tenant_id AND g.grant_id = t.grant_id
        JOIN mcp_accounts a ON a.tenant_id = g.tenant_id AND a.account_id = g.account_id
        WHERE t.tenant_id = $1 AND t.token_digest = $2 AND t.kind = 'ACCESS' AND t.revoked_at IS NULL AND t.expires_at > $3
          AND g.status = 'ACTIVE' AND a.status = 'ACTIVE'`, [tenantId, accessDigest, now])).rows[0];
      return row ? { accountId: String(row.account_id), grantId: String(row.grant_id), clientId: String(row.client_id), clientName: String(row.client_name),
        scopes: scopesOf(row.scopes), resource: String(row.resource), familyId: String(row.family_id), expiresAt: date(row.expires_at) } : null;
    },
    async revoke(digest, clientId, now) {
      await db.transaction(async tx => {
        const row = (await tx.query(`SELECT t.kind, t.family_id, g.client_id FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.tenant_id = t.tenant_id AND g.grant_id = t.grant_id
          WHERE t.tenant_id = $1 AND t.token_digest = $2 FOR UPDATE OF t`, [tenantId, digest])).rows[0];
        // Unknown tokens and tokens of another client are ignored (RFC 7009 §2.2: no oracle about other clients' tokens).
        if (!row || row.client_id !== clientId) return;
        if (row.kind === 'REFRESH') await tx.query('UPDATE mcp_oauth_tokens SET revoked_at = $3 WHERE tenant_id = $1 AND family_id = $2 AND revoked_at IS NULL', [tenantId, row.family_id, now]);
        else await tx.query('UPDATE mcp_oauth_tokens SET revoked_at = $3 WHERE tenant_id = $1 AND token_digest = $2 AND revoked_at IS NULL', [tenantId, digest, now]);
      });
    },
    async accountActive(accountId) {
      return (await db.query(`SELECT 1 FROM mcp_accounts WHERE tenant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`, [tenantId, accountId])).rowCount === 1;
    },
    // BUILD-DEVELOPER-001: the shared fixed-window limiter (same SQL and buckets as before).
    allow: (bucket, limit, windowSeconds, now) => fixedWindow(db, tenantId).allow(bucket, limit, windowSeconds, now),
    async purge(now) {
      const before = (days: number) => new Date(now.getTime() - days * DAY);
      await db.query('DELETE FROM mcp_oauth_tokens WHERE tenant_id = $1 AND family_expires_at < $2', [tenantId, before(7)]);
      await db.query('DELETE FROM mcp_oauth_authorizations WHERE tenant_id = $1 AND expires_at < $2', [tenantId, before(7)]);
      await db.query('DELETE FROM mcp_oauth_clients WHERE tenant_id = $1 AND expires_at < $2', [tenantId, before(7)]);
      await db.query('DELETE FROM mcp_rate_limits WHERE tenant_id = $1 AND window_start < $2', [tenantId, before(1)]);
    },
  };
}

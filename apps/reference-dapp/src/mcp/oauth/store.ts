// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the durable state of the MCP OAuth server, behind one interface with one implementation (PostgreSQL,
 * `pg-store.ts`). Every operation that moves a credential forward (consent decision, code redemption, refresh rotation,
 * revocation) is one transaction with a row lock, so concurrent serverless instances agree. Only digests are stored.
 */
import type { McpScope } from './config.ts';

export type ClientKind = 'CIMD' | 'DCR';
export type ClientRecord = { readonly clientId: string; readonly kind: ClientKind; readonly clientName: string; readonly redirectUris: readonly string[];
  readonly metadataSha256: string; readonly expiresAt: Date };
export type AuthorizationStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'CONSUMED' | 'EXPIRED';
export type AuthorizationRecord = { readonly requestId: string; readonly status: AuthorizationStatus; readonly clientId: string; readonly clientName: string;
  readonly redirectUri: string; readonly state: string; readonly codeChallenge: string; readonly scopes: readonly McpScope[]; readonly resource: string;
  readonly csrfDigest: Buffer; readonly accountId: string | null; readonly grantId: string | null; readonly codeExpiresAt: Date | null; readonly expiresAt: Date };
export type NewAuthorization = Omit<AuthorizationRecord, 'status' | 'accountId' | 'grantId' | 'codeExpiresAt'>;
/** Tokens to store for one issuance (an access token and its rotating refresh token, in one family). */
export type TokenIssue = { readonly accessDigest: Buffer; readonly accessExpiresAt: Date; readonly refreshDigest: Buffer; readonly refreshExpiresAt: Date;
  readonly familyId: string; readonly familyExpiresAt: Date; readonly scopes: readonly McpScope[]; readonly resource: string };
export type AccessPrincipal = { readonly accountId: string; readonly grantId: string; readonly clientId: string; readonly clientName: string;
  readonly scopes: readonly McpScope[]; readonly resource: string; readonly familyId: string; readonly expiresAt: Date };
export type Decision =
  | { readonly decision: 'APPROVE'; readonly accountId: string; readonly createAccount: boolean; readonly grantId: string; readonly codeDigest: Buffer;
      readonly codeExpiresAt: Date }
  | { readonly decision: 'DENY' };
/** OAuth `error` values the token endpoint returns for a refused grant (RFC 6749 §5.2, RFC 8707). */
export type GrantError = 'invalid_grant' | 'invalid_scope' | 'invalid_target';
export type GrantResult = { readonly ok: true; readonly scopes: readonly McpScope[]; readonly accountId: string } | { readonly ok: false; readonly error: GrantError; readonly reason: string };

export interface McpOAuthStore {
  /** A usable client registration (absent or expired → null). */
  readonly getClient: (clientId: string, now: Date) => Promise<ClientRecord | null>;
  readonly saveClient: (client: ClientRecord, now: Date) => Promise<void>;
  readonly createAuthorization: (authorization: NewAuthorization) => Promise<void>;
  readonly getAuthorization: (requestId: string) => Promise<AuthorizationRecord | null>;
  /**
   * The user's decision on a PENDING, unexpired request whose consent CSRF digest matches. Approval creates the account when
   * asked, a grant and a single-use authorization code. Anything else (decided, expired, wrong token, disabled account) is
   * `null` and changes nothing.
   */
  readonly decide: (requestId: string, csrfDigest: Buffer, decision: Decision, now: Date) => Promise<AuthorizationRecord | null>;
  /**
   * Redeems an authorization code once. Any attempt consumes it; a second redemption revokes the grant and everything issued
   * from it (RFC 6749 §4.1.2). `verify` checks the client, redirect URI and PKCE verifier against the request.
   */
  readonly redeemCode: (codeDigest: Buffer, now: Date, verify: (authorization: AuthorizationRecord) => string | null,
    issue: (authorization: AuthorizationRecord) => TokenIssue) => Promise<GrantResult>;
  /**
   * Rotates a refresh token: the presented one is used up and a new access + refresh pair joins its family. Reuse of a used
   * refresh token within `graceMs` is refused without side effects (concurrent clients); later reuse revokes the family.
   */
  readonly rotateRefresh: (refreshDigest: Buffer, clientId: string, now: Date, graceMs: number, requested: { readonly scopes: readonly McpScope[] | null;
    readonly resource: string | null }, issue: (scopes: readonly McpScope[], resource: string, familyId: string, familyExpiresAt: Date) => TokenIssue) => Promise<GrantResult>;
  /** The principal of a live access token (unexpired, unrevoked, grant and account active), else null. */
  readonly authenticate: (accessDigest: Buffer, now: Date) => Promise<AccessPrincipal | null>;
  /** RFC 7009: revokes a token issued to `clientId` (a refresh token revokes its family). Unknown tokens are ignored. */
  readonly revoke: (digest: Buffer, clientId: string, now: Date) => Promise<void>;
  readonly accountActive: (accountId: string) => Promise<boolean>;
  /** Fixed-window counter: true while `bucket` stays within `limit` per `windowSeconds`. */
  readonly allow: (bucket: string, limit: number, windowSeconds: number, now: Date) => Promise<boolean>;
  /** Bounded retention: deletes expired credentials, requests, caches and counters past their grace periods. */
  readonly purge: (now: Date) => Promise<void>;
}

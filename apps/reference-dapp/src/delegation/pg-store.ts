// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: durable state of delegated execution on PostgreSQL (migration 0011). Concurrency comes from the database, never
 * process memory:
 *
 *   - one lock order everywhere: authorization row → execution row → grant rows;
 *   - the budget reservation runs inside the authorization's row lock, so two workers can never both spend the same remaining budget, and
 *     a revocation (same lock) either commits before a reservation (which then fails) or after it (and blocks the execution later);
 *   - preparing a submission re-checks, in the same transaction, that the authorization and the grant are still ACTIVE: no submission is
 *     ever prepared after an effective revocation; the exact signed bytes are committed before anything is broadcast;
 *   - every transition is a compare-and-set, and the triggers of 0011 refuse any backwards move, any change of a prepared submission and
 *     any deletion of the ledger or the audit trail.
 *
 * Every query names the tenant; every owner query names the owner too. Nothing stored here is key material.
 */
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import type { StrategyInput } from '../engine/strategy-spec';
import type { GrantScope, GrantState, GrantView } from './authority.ts';
import type { Mechanism } from './capabilities.ts';
import type { DelegatedAuthorizationManifest, Period, UniversalWorkflowAuthorization } from './manifest.ts';
import type { Usage } from './policy.ts';
import type { ExecutionState, StepState } from './state-machine.ts';
import type { Namespace } from './steps.ts';

export type Owner = { readonly namespace: Namespace; readonly address: string };
const date = (v: unknown) => v instanceof Date ? v : new Date(String(v));
const maybeDate = (v: unknown) => v === null || v === undefined ? null : date(v);
const str = (v: unknown) => v === null || v === undefined ? null : String(v);
const json = (v: unknown) => v === null || v === undefined ? null : JSON.stringify(v, (_k, x: unknown) => typeof x === 'bigint' ? x.toString() : x);
const refuse = (code: string): never => { throw new Error(code); };

export type PasskeyRecord = { readonly passkeyId: string; readonly owner: Owner; readonly credentialId: string; readonly publicKeySpki: Uint8Array; readonly rpId: string;
  readonly origin: string; readonly signCount: number; readonly label: string; readonly createdAt: Date; readonly lastUsedAt: Date | null; readonly revokedAt: Date | null };
export type CredentialRecord = { readonly credentialId: string; readonly owner: Owner; readonly walletNamespace: Namespace; readonly walletAddress: string;
  readonly label: string; readonly createdAt: Date };
export type GrantRecord = GrantView & { readonly owner: Owner; readonly sessionKeyRef: string; readonly enrollment: Readonly<Record<string, unknown>>;
  readonly grantPayload: Readonly<Record<string, unknown>> | null; readonly verification: Readonly<Record<string, unknown>> | null; readonly expiresAt: Date;
  readonly revocation: Readonly<Record<string, unknown>> | null; readonly revocationRequestedAt: Date | null; readonly revokedAt: Date | null;
  readonly evmNextNonce: bigint | null; readonly version: number; readonly createdAt: Date; readonly updatedAt: Date };
export type AuthorizationState = 'PENDING_SIGNATURE' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type AuthorizationRecord = { readonly authorizationId: string; readonly owner: Owner; readonly ruleId: string; readonly state: AuthorizationState;
  readonly activeRevision: number | null; readonly latestRevision: number; readonly revokedAt: Date | null; readonly revokeCode: string | null; readonly version: number;
  readonly createdAt: Date; readonly updatedAt: Date };
export type RevisionState = 'PENDING_SIGNATURE' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED' | 'EXPIRED';
export type RevisionRecord = { readonly authorizationId: string; readonly revision: number; readonly owner: Owner; readonly state: RevisionState;
  readonly strategy: StrategyInput; readonly workflowHash: string; readonly manifest: DelegatedAuthorizationManifest; readonly manifestHash: string;
  readonly widening: readonly string[]; readonly envelope: UniversalWorkflowAuthorization | null; readonly envelopeDigest: string | null; readonly passkeyId: string | null;
  readonly assertion: Readonly<Record<string, unknown>> | null; readonly signedAt: Date | null; readonly createdAt: Date };
export type ExecutionRecord = { readonly executionId: string; readonly authorizationId: string; readonly revision: number; readonly owner: Owner; readonly ruleId: string;
  readonly occurrenceId: string; readonly state: ExecutionState; readonly code: string | null; readonly workflowHash: string; readonly manifestHash: string;
  readonly stepCount: number; readonly currentStep: number; readonly attention: boolean; readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly version: number; readonly reservedAt: Date | null; readonly settledAt: Date | null; readonly createdAt: Date; readonly updatedAt: Date };
export type StepRecord = { readonly executionId: string; readonly stepIndex: number; readonly state: StepState; readonly credentialId: string; readonly grantId: string;
  readonly mechanism: Mechanism; readonly chain: string; readonly grantCommitment: string; readonly plan: Readonly<Record<string, unknown>> | null;
  readonly submission: Readonly<Record<string, unknown>> | null; readonly reconciliation: Readonly<Record<string, unknown>> | null; readonly code: string | null;
  readonly attempts: number; readonly updatedAt: Date };
export type BudgetEntry = { readonly executionId: string; readonly stepIndex: number; readonly asset: string; readonly reserved: bigint; readonly spent: bigint | null;
  readonly state: 'RESERVED' | 'SPENT' | 'RELEASED'; readonly starts: Readonly<Record<Period, Date>> };

const ownerOf = (r: Row): Owner => ({ namespace: r.owner_namespace as Namespace, address: String(r.owner_account) });
const passkeyOf = (r: Row): PasskeyRecord => ({ passkeyId: String(r.passkey_id), owner: ownerOf(r), credentialId: String(r.credential_id),
  publicKeySpki: Uint8Array.from(r.public_key_spki as Buffer), rpId: String(r.rp_id), origin: String(r.origin), signCount: Number(r.sign_count), label: String(r.label),
  createdAt: date(r.created_at), lastUsedAt: maybeDate(r.last_used_at), revokedAt: maybeDate(r.revoked_at) });
const credentialOf = (r: Row): CredentialRecord => ({ credentialId: String(r.credential_id), owner: ownerOf(r), walletNamespace: r.wallet_namespace as Namespace,
  walletAddress: String(r.wallet_address), label: String(r.label), createdAt: date(r.created_at) });
const grantOf = (r: Row): GrantRecord => ({ grantId: String(r.grant_id), credentialId: String(r.credential_id), owner: ownerOf(r),
  walletNamespace: r.wallet_namespace as Namespace, walletAddress: String(r.wallet_address), chain: String(r.chain), mechanism: r.mechanism as Mechanism,
  state: r.state as GrantState, scope: r.scope as GrantScope, scopeHash: String(r.scope_hash), sessionAddress: String(r.session_address), commitment: str(r.commitment),
  passkeyId: String(r.passkey_id), verifiedAt: maybeDate(r.verified_at)?.toISOString() ?? null, callsUsed: Number(r.calls_used), sessionKeyRef: String(r.session_key_ref),
  enrollment: r.enrollment as Record<string, unknown>, grantPayload: (r.grant_payload ?? null) as Record<string, unknown> | null,
  verification: (r.verification ?? null) as Record<string, unknown> | null, expiresAt: date(r.expires_at), revocation: (r.revocation ?? null) as Record<string, unknown> | null,
  revocationRequestedAt: maybeDate(r.revocation_requested_at), revokedAt: maybeDate(r.revoked_at), evmNextNonce: r.evm_next_nonce === null ? null : BigInt(String(r.evm_next_nonce)),
  version: Number(r.version), createdAt: date(r.created_at), updatedAt: date(r.updated_at) });
const authorizationOf = (r: Row): AuthorizationRecord => ({ authorizationId: String(r.authorization_id), owner: ownerOf(r), ruleId: String(r.rule_id),
  state: r.state as AuthorizationState, activeRevision: r.active_revision === null ? null : Number(r.active_revision), latestRevision: Number(r.latest_revision),
  revokedAt: maybeDate(r.revoked_at), revokeCode: str(r.revoke_code), version: Number(r.version), createdAt: date(r.created_at), updatedAt: date(r.updated_at) });
const revisionOf = (r: Row): RevisionRecord => ({ authorizationId: String(r.authorization_id), revision: Number(r.revision), owner: ownerOf(r), state: r.state as RevisionState,
  strategy: r.strategy as StrategyInput, workflowHash: String(r.workflow_hash), manifest: r.manifest as DelegatedAuthorizationManifest, manifestHash: String(r.manifest_hash),
  widening: (r.widening ?? []) as string[], envelope: (r.envelope ?? null) as UniversalWorkflowAuthorization | null, envelopeDigest: str(r.envelope_digest),
  passkeyId: str(r.passkey_id), assertion: (r.assertion ?? null) as Record<string, unknown> | null, signedAt: maybeDate(r.signed_at), createdAt: date(r.created_at) });
const executionOf = (r: Row): ExecutionRecord => ({ executionId: String(r.execution_id), authorizationId: String(r.authorization_id), revision: Number(r.revision),
  owner: ownerOf(r), ruleId: String(r.rule_id), occurrenceId: String(r.occurrence_id), state: r.state as ExecutionState, code: str(r.code),
  workflowHash: String(r.workflow_hash), manifestHash: String(r.manifest_hash), stepCount: Number(r.step_count), currentStep: Number(r.current_step),
  attention: r.attention === true, evidence: (r.evidence ?? null) as Record<string, unknown> | null, version: Number(r.version), reservedAt: maybeDate(r.reserved_at),
  settledAt: maybeDate(r.settled_at), createdAt: date(r.created_at), updatedAt: date(r.updated_at) });
const stepOf = (r: Row): StepRecord => ({ executionId: String(r.execution_id), stepIndex: Number(r.step_index), state: r.state as StepState,
  credentialId: String(r.credential_id), grantId: String(r.grant_id), mechanism: r.mechanism as Mechanism, chain: String(r.chain), grantCommitment: String(r.grant_commitment),
  plan: (r.plan ?? null) as Record<string, unknown> | null, submission: (r.submission ?? null) as Record<string, unknown> | null,
  reconciliation: (r.reconciliation ?? null) as Record<string, unknown> | null, code: str(r.code), attempts: Number(r.attempts), updatedAt: date(r.updated_at) });
const GRANT_SELECT = `SELECT g.*, c.wallet_namespace, c.wallet_address FROM credential_grants g
  JOIN execution_credentials c ON c.tenant_id = g.tenant_id AND c.credential_id = g.credential_id`;

export type EventInput = { readonly owner: Owner; readonly kind: string; readonly authorizationId?: string | null; readonly executionId?: string | null;
  readonly grantId?: string | null; readonly passkeyId?: string | null; readonly code?: string | null; readonly detail?: Readonly<Record<string, unknown>> | null };
export type ReservationInput = { readonly executionId: string; readonly expectedVersion: number; readonly revision: number; readonly now: Date;
  readonly periods: Readonly<Record<Period, Date>>; readonly entries: readonly { readonly stepIndex: number; readonly asset: string; readonly amount: bigint }[];
  readonly steps: readonly { readonly stepIndex: number; readonly credentialId: string; readonly grantId: string; readonly mechanism: Mechanism; readonly chain: string;
    readonly grantCommitment: string }[];
  /** Decides with the ledger's usage, inside the authorization lock. */
  readonly check: (usage: Usage) => string | null };

export function createPgDelegationStore(db: Database, tenantId: string) {
  const event = (tx: Queryable, e: EventInput) => tx.query(`INSERT INTO delegated_events (tenant_id, owner_namespace, owner_account, kind, authorization_id, execution_id,
      grant_id, passkey_id, code, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
  [tenantId, e.owner.namespace, e.owner.address, e.kind, e.authorizationId ?? null, e.executionId ?? null, e.grantId ?? null, e.passkeyId ?? null, e.code ?? null, json(e.detail)]);
  const lockAuthorization = async (tx: Queryable, authorizationId: string) => {
    const row = (await tx.query('SELECT * FROM delegated_authorizations WHERE tenant_id = $1 AND authorization_id = $2 FOR UPDATE', [tenantId, authorizationId])).rows[0];
    return row ? authorizationOf(row) : null;
  };
  const executionRow = async (tx: Queryable, executionId: string, lock: boolean) => {
    const row = (await tx.query(`SELECT * FROM delegated_executions WHERE tenant_id = $1 AND execution_id = $2${lock ? ' FOR UPDATE' : ''}`, [tenantId, executionId])).rows[0];
    return row ? executionOf(row) : null;
  };
  const usage = async (tx: Queryable, authorizationId: string, periods: Readonly<Record<Period, Date>>): Promise<Usage> => {
    const rows = (await tx.query<{ asset: string; day: string; week: string; month: string }>(`SELECT asset,
        coalesce(sum(CASE WHEN state = 'SPENT' THEN spent_amount ELSE reserved_amount END) FILTER (WHERE day_start = $3), 0)::text AS day,
        coalesce(sum(CASE WHEN state = 'SPENT' THEN spent_amount ELSE reserved_amount END) FILTER (WHERE week_start = $4), 0)::text AS week,
        coalesce(sum(CASE WHEN state = 'SPENT' THEN spent_amount ELSE reserved_amount END) FILTER (WHERE month_start = $5), 0)::text AS month
      FROM delegated_budget_entries WHERE tenant_id = $1 AND authorization_id = $2 AND state <> 'RELEASED' GROUP BY asset`,
    [tenantId, authorizationId, periods.DAY, periods.WEEK, periods.MONTH])).rows;
    const counts = (await tx.query<{ day: number; week: number; month: number; last: Date | null }>(`SELECT
        count(DISTINCT execution_id) FILTER (WHERE day_start = $3)::int AS day, count(DISTINCT execution_id) FILTER (WHERE week_start = $4)::int AS week,
        count(DISTINCT execution_id) FILTER (WHERE month_start = $5)::int AS month, max(created_at) AS last
      FROM delegated_budget_entries WHERE tenant_id = $1 AND authorization_id = $2 AND state <> 'RELEASED'`,
    [tenantId, authorizationId, periods.DAY, periods.WEEK, periods.MONTH])).rows[0]!;
    return { amounts: new Map(rows.map(r => [r.asset, new Map<Period, bigint>([['DAY', BigInt(r.day)], ['WEEK', BigInt(r.week)], ['MONTH', BigInt(r.month)]])])),
      executions: new Map<Period, number>([['DAY', counts.day], ['WEEK', counts.week], ['MONTH', counts.month]]), lastExecutionAt: counts.last ? date(counts.last).getTime() : null };
  };

  return {
    async schemaInstalled(): Promise<boolean> {
      return (await db.query<{ ok: boolean }>(`SELECT to_regclass('delegated_executions') IS NOT NULL AND to_regclass('passkey_credentials') IS NOT NULL AS ok`)).rows[0]?.ok === true;
    },
    recordEvent: (e: EventInput) => event(db, e).then(() => undefined),
    async events(owner: Owner, filter: { readonly authorizationId?: string; readonly executionId?: string; readonly limit: number }) {
      return (await db.query(`SELECT * FROM delegated_events WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND ($4::text IS NULL OR authorization_id = $4)
          AND ($5::text IS NULL OR execution_id = $5) ORDER BY at DESC, event_id DESC LIMIT $6`,
      [tenantId, owner.namespace, owner.address, filter.authorizationId ?? null, filter.executionId ?? null, Math.min(Math.max(1, filter.limit), 200)])).rows
        .map(r => ({ kind: String(r.kind), at: date(r.at), code: str(r.code), authorizationId: str(r.authorization_id), executionId: str(r.execution_id), grantId: str(r.grant_id),
          detail: (r.detail ?? null) as Record<string, unknown> | null }));
    },

    // ── Passkeys ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    async createChallenge(owner: Owner, purpose: 'REGISTER' | 'AUTHORIZE', digest: Uint8Array, subject: string | null, expiresAt: Date, now: Date) {
      await db.query(`INSERT INTO passkey_challenges (tenant_id, challenge_digest, owner_namespace, owner_account, purpose, subject, expires_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, challenge_digest) DO NOTHING`,
      [tenantId, Buffer.from(digest), owner.namespace, owner.address, purpose, subject, expiresAt, now]);
    },
    /** Consumes a single-use challenge of this owner and purpose (and subject); false when unknown, used, expired or another owner's. */
    async consumeChallenge(tx: Queryable | null, owner: Owner, purpose: 'REGISTER' | 'AUTHORIZE', digest: Uint8Array, subject: string | null, now: Date): Promise<boolean> {
      return (await (tx ?? db).query(`UPDATE passkey_challenges SET consumed_at = $7 WHERE tenant_id = $1 AND challenge_digest = $2 AND owner_namespace = $3
          AND owner_account = $4 AND purpose = $5 AND subject IS NOT DISTINCT FROM $6 AND consumed_at IS NULL AND expires_at > $7 RETURNING 1`,
      [tenantId, Buffer.from(digest), owner.namespace, owner.address, purpose, subject, now])).rowCount === 1;
    },
    insertPasskey: (owner: Owner, p: { readonly passkeyId: string; readonly credentialId: string; readonly publicKeySpki: Uint8Array; readonly rpId: string;
      readonly origin: string; readonly signCount: number; readonly label: string }, challenge: Uint8Array, now: Date) => db.transaction(async tx => {
      if ((await tx.query(`UPDATE passkey_challenges SET consumed_at = $5 WHERE tenant_id = $1 AND challenge_digest = $2 AND owner_namespace = $3 AND owner_account = $4
          AND purpose = 'REGISTER' AND consumed_at IS NULL AND expires_at > $5 RETURNING 1`, [tenantId, Buffer.from(challenge), owner.namespace, owner.address, now])).rowCount !== 1)
        refuse('PASSKEY_CHALLENGE_INVALID');
      const live = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM passkey_credentials WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3
        AND revoked_at IS NULL`, [tenantId, owner.namespace, owner.address])).rows[0]!.n;
      if (live >= 5) refuse('PASSKEY_LIMIT');
      const row = (await tx.query(`INSERT INTO passkey_credentials (tenant_id, passkey_id, owner_namespace, owner_account, credential_id, public_key_spki, algorithm, rp_id,
          origin, sign_count, label, created_at) VALUES ($1, $2, $3, $4, $5, $6, -7, $7, $8, $9, $10, $11) ON CONFLICT (tenant_id, credential_id) DO NOTHING RETURNING *`,
      [tenantId, p.passkeyId, owner.namespace, owner.address, p.credentialId, Buffer.from(p.publicKeySpki), p.rpId, p.origin, p.signCount, p.label, now])).rows[0];
      if (!row) refuse('PASSKEY_ALREADY_REGISTERED');
      await event(tx, { owner, kind: 'PASSKEY_REGISTERED', passkeyId: p.passkeyId });
      return passkeyOf(row!);
    }),
    async listPasskeys(owner: Owner): Promise<readonly PasskeyRecord[]> {
      return (await db.query(`SELECT * FROM passkey_credentials WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 ORDER BY created_at DESC`,
        [tenantId, owner.namespace, owner.address])).rows.map(passkeyOf);
    },
    async passkey(owner: Owner, passkeyId: string): Promise<PasskeyRecord | null> {
      const row = (await db.query(`SELECT * FROM passkey_credentials WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND passkey_id = $4`,
        [tenantId, owner.namespace, owner.address, passkeyId])).rows[0];
      return row ? passkeyOf(row) : null;
    },
    revokePasskey: (owner: Owner, passkeyId: string, now: Date) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE passkey_credentials SET revoked_at = $5 WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND passkey_id = $4
          AND revoked_at IS NULL RETURNING *`, [tenantId, owner.namespace, owner.address, passkeyId, now])).rows[0] ?? refuse('PASSKEY_NOT_FOUND');
      await event(tx, { owner, kind: 'PASSKEY_REVOKED', passkeyId });
      return passkeyOf(row);
    }),

    // ── Execution Credentials and grants ────────────────────────────────────────────────────────────────────────────────────
    async credential(owner: Owner, wallet: { readonly namespace: Namespace; readonly address: string }, label: string, newId: () => string, now: Date): Promise<CredentialRecord> {
      await db.query(`INSERT INTO execution_credentials (tenant_id, credential_id, owner_namespace, owner_account, wallet_namespace, wallet_address, label, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (tenant_id, owner_namespace, owner_account, wallet_namespace, wallet_address) DO NOTHING`,
      [tenantId, newId(), owner.namespace, owner.address, wallet.namespace, wallet.address, label, now]);
      return credentialOf((await db.query(`SELECT * FROM execution_credentials WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND wallet_namespace = $4
        AND wallet_address = $5`, [tenantId, owner.namespace, owner.address, wallet.namespace, wallet.address])).rows[0]!);
    },
    async credentials(owner: Owner): Promise<readonly CredentialRecord[]> {
      return (await db.query(`SELECT * FROM execution_credentials WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 ORDER BY created_at`,
        [tenantId, owner.namespace, owner.address])).rows.map(credentialOf);
    },
    insertGrant: (owner: Owner, g: { readonly grantId: string; readonly credentialId: string; readonly chain: string; readonly mechanism: Mechanism;
      readonly scope: GrantScope; readonly scopeHash: string; readonly passkeyId: string; readonly sessionKeyRef: string; readonly sessionAddress: string;
      readonly enrollment: Readonly<Record<string, unknown>>; readonly expiresAt: Date }, now: Date) => db.transaction(async tx => {
      const live = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM credential_grants WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3
        AND state IN ('PENDING_SIGNATURE', 'ACTIVE', 'UNCERTAIN')`, [tenantId, owner.namespace, owner.address])).rows[0]!.n;
      if (live >= 20) refuse('CREDENTIAL_GRANT_LIMIT');
      await tx.query(`INSERT INTO credential_grants (tenant_id, grant_id, credential_id, owner_namespace, owner_account, chain, mechanism, state, scope, scope_hash, passkey_id,
          session_key_ref, session_address, enrollment, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_SIGNATURE', $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $15, $15)`,
      [tenantId, g.grantId, g.credentialId, owner.namespace, owner.address, g.chain, g.mechanism, json(g.scope), g.scopeHash, g.passkeyId, g.sessionKeyRef, g.sessionAddress,
        json(g.enrollment), g.expiresAt, now]);
      await event(tx, { owner, kind: 'CREDENTIAL_ENROLLMENT_PREPARED', grantId: g.grantId, detail: { chain: g.chain, mechanism: g.mechanism } });
      return grantOf((await tx.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, g.grantId])).rows[0]!);
    }),
    async grants(owner: Owner): Promise<readonly GrantRecord[]> {
      return (await db.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.owner_namespace = $2 AND g.owner_account = $3 ORDER BY g.created_at DESC`,
        [tenantId, owner.namespace, owner.address])).rows.map(grantOf);
    },
    async grant(owner: Owner, grantId: string): Promise<GrantRecord | null> {
      const row = (await db.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.owner_namespace = $2 AND g.owner_account = $3 AND g.grant_id = $4`,
        [tenantId, owner.namespace, owner.address, grantId])).rows[0];
      return row ? grantOf(row) : null;
    },
    async grantById(grantId: string): Promise<GrantRecord | null> {
      const row = (await db.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, grantId])).rows[0];
      return row ? grantOf(row) : null;
    },
    /** PENDING_SIGNATURE → ACTIVE (verified) or FAILED, compare-and-set on the grant's version. */
    settleEnrollment: (owner: Owner, grantId: string, expectedVersion: number, result: { readonly ok: true; readonly payload: Readonly<Record<string, unknown>>;
      readonly commitment: string; readonly verification: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly code: string }, now: Date) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE credential_grants SET state = $5, grant_payload = coalesce($6::jsonb, grant_payload), commitment = coalesce($7, commitment),
          verification = coalesce($8::jsonb, verification), verified_at = CASE WHEN $5 = 'ACTIVE' THEN $9 ELSE verified_at END, version = version + 1
        WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND grant_id = $4 AND state = 'PENDING_SIGNATURE' AND version = $10 RETURNING grant_id`,
      [tenantId, owner.namespace, owner.address, grantId, result.ok ? 'ACTIVE' : 'FAILED', result.ok ? json(result.payload) : null, result.ok ? result.commitment : null,
        result.ok ? json(result.verification) : json({ code: result.code }), now, expectedVersion])).rows[0];
      if (!row) refuse('CREDENTIAL_GRANT_CHANGED');
      await event(tx, { owner, kind: result.ok ? 'CREDENTIAL_ENROLLED' : 'CREDENTIAL_ENROLLMENT_FAILED', grantId, code: result.ok ? null : result.code });
      return grantOf((await tx.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, grantId])).rows[0]!);
    }),
    /** A read-only re-verification of an ACTIVE grant: still valid (refresh `verified_at`), expired, or uncertain. */
    async reverify(grantId: string, outcome: { readonly state: 'ACTIVE' | 'EXPIRED' | 'UNCERTAIN' | 'REVOKED'; readonly verification: Readonly<Record<string, unknown>> }, now: Date) {
      const row = (await db.query(`UPDATE credential_grants SET state = $3, verification = $4::jsonb, verified_at = CASE WHEN $3 = 'ACTIVE' THEN $5 ELSE verified_at END,
          revoked_at = CASE WHEN $3 = 'REVOKED' THEN $5 ELSE revoked_at END, version = version + 1
        WHERE tenant_id = $1 AND grant_id = $2 AND (state = $3 OR (state = 'ACTIVE' AND $3 IN ('EXPIRED', 'UNCERTAIN'))
          OR (state = 'UNCERTAIN' AND $3 IN ('ACTIVE', 'REVOKED') AND revocation_requested_at IS NULL) OR (state IN ('REVOCATION_REQUESTED', 'EXPIRED') AND $3 = 'REVOKED'))
        RETURNING owner_namespace, owner_account`, [tenantId, grantId, outcome.state, json(outcome.verification), now])).rows[0];
      if (row && outcome.state !== 'ACTIVE') await event(db, { owner: ownerOf(row), kind: `CREDENTIAL_${outcome.state}`, grantId, detail: outcome.verification });
      return row !== undefined;
    },
    /** Owner's revocation: unusable by FloFi at once (REVOCATION_REQUESTED); on-chain confirmation follows separately. */
    requestRevocation: (owner: Owner, grantId: string, revocation: Readonly<Record<string, unknown>>, now: Date) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE credential_grants SET state = 'REVOCATION_REQUESTED', revocation = $5::jsonb, revocation_requested_at = $6, version = version + 1
        WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND grant_id = $4 AND state IN ('ACTIVE', 'UNCERTAIN', 'EXPIRED') RETURNING grant_id`,
      [tenantId, owner.namespace, owner.address, grantId, json(revocation), now])).rows[0];
      if (!row) refuse('CREDENTIAL_NOT_REVOCABLE');
      await event(tx, { owner, kind: 'CREDENTIAL_REVOCATION_REQUESTED', grantId });
      return grantOf((await tx.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, grantId])).rows[0]!);
    }),
    async confirmRevocation(owner: Owner, grantId: string, state: 'REVOKED' | 'UNCERTAIN', verification: Readonly<Record<string, unknown>>, now: Date) {
      return db.transaction(async tx => {
        const row = (await tx.query(`UPDATE credential_grants SET state = $5, verification = $6::jsonb, revoked_at = CASE WHEN $5 = 'REVOKED' THEN $7 ELSE revoked_at END,
            version = version + 1 WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND grant_id = $4 AND state IN ('REVOCATION_REQUESTED', 'UNCERTAIN')
          RETURNING grant_id`, [tenantId, owner.namespace, owner.address, grantId, state, json(verification), now])).rows[0];
        if (!row) refuse('CREDENTIAL_REVOCATION_NOT_REQUESTED');
        await event(tx, { owner, kind: state === 'REVOKED' ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_REVOCATION_UNCERTAIN', grantId, detail: verification });
        return grantOf((await tx.query(`${GRANT_SELECT} WHERE g.tenant_id = $1 AND g.grant_id = $2`, [tenantId, grantId])).rows[0]!);
      });
    },

    // ── Authorizations ──────────────────────────────────────────────────────────────────────────────────────────────────────
    /** Inside the rule-creation transaction: the lineage and its first revision (PENDING_SIGNATURE). */
    async createAuthorization(tx: Queryable, owner: Owner, a: { readonly authorizationId: string; readonly ruleId: string; readonly strategy: StrategyInput;
      readonly manifest: DelegatedAuthorizationManifest; readonly manifestHash: string }, now: Date) {
      await tx.query(`INSERT INTO delegated_authorizations (tenant_id, authorization_id, owner_namespace, owner_account, rule_id, state, latest_revision, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'PENDING_SIGNATURE', 1, $6, $6)`, [tenantId, a.authorizationId, owner.namespace, owner.address, a.ruleId, now]);
      await tx.query(`INSERT INTO delegated_authorization_revisions (tenant_id, authorization_id, revision, owner_namespace, owner_account, state, strategy, workflow_hash, manifest,
          manifest_hash, created_at, updated_at) VALUES ($1, $2, 1, $3, $4, 'PENDING_SIGNATURE', $5::jsonb, $6, $7::jsonb, $8, $9, $9)`,
      [tenantId, a.authorizationId, owner.namespace, owner.address, json(a.strategy), a.manifest.workflow.workflowHash, json(a.manifest), a.manifestHash, now]);
      await event(tx, { owner, kind: 'AUTHORIZATION_CREATED', authorizationId: a.authorizationId, detail: { revision: 1, manifestHash: a.manifestHash } });
    },
    async authorization(owner: Owner, authorizationId: string): Promise<AuthorizationRecord | null> {
      const row = (await db.query(`SELECT * FROM delegated_authorizations WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND authorization_id = $4`,
        [tenantId, owner.namespace, owner.address, authorizationId])).rows[0];
      return row ? authorizationOf(row) : null;
    },
    async authorizationById(authorizationId: string): Promise<AuthorizationRecord | null> {
      const row = (await db.query('SELECT * FROM delegated_authorizations WHERE tenant_id = $1 AND authorization_id = $2', [tenantId, authorizationId])).rows[0];
      return row ? authorizationOf(row) : null;
    },
    async authorizations(owner: Owner): Promise<readonly AuthorizationRecord[]> {
      return (await db.query(`SELECT * FROM delegated_authorizations WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 ORDER BY created_at DESC LIMIT 100`,
        [tenantId, owner.namespace, owner.address])).rows.map(authorizationOf);
    },
    async revision(authorizationId: string, revision: number): Promise<RevisionRecord | null> {
      const row = (await db.query('SELECT * FROM delegated_authorization_revisions WHERE tenant_id = $1 AND authorization_id = $2 AND revision = $3',
        [tenantId, authorizationId, revision])).rows[0];
      return row ? revisionOf(row) : null;
    },
    async revisions(owner: Owner, authorizationId: string): Promise<readonly RevisionRecord[]> {
      return (await db.query(`SELECT * FROM delegated_authorization_revisions WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND authorization_id = $4
        ORDER BY revision DESC`, [tenantId, owner.namespace, owner.address, authorizationId])).rows.map(revisionOf);
    },
    /** Stores the envelope the owner is about to sign (a PENDING revision only; a new review replaces an unsigned envelope). */
    async prepareReview(owner: Owner, authorizationId: string, revision: number, envelope: UniversalWorkflowAuthorization, digest: string, now: Date) {
      const row = (await db.query(`UPDATE delegated_authorization_revisions SET envelope = $5::jsonb, envelope_digest = $6, updated_at = $7
        WHERE tenant_id = $1 AND authorization_id = $2 AND revision = $3 AND owner_namespace = $4 AND owner_account = $8 AND state = 'PENDING_SIGNATURE' AND assertion IS NULL
        RETURNING *`, [tenantId, authorizationId, revision, owner.namespace, json(envelope), digest, now, owner.address])).rows[0];
      return row ? revisionOf(row) : refuse('AUTHORIZATION_NOT_PENDING');
    },
    /**
     * The owner's ONE signature activates a revision, atomically: the single-use challenge (= envelope digest) is consumed, the passkey
     * counter advances, the revision becomes ACTIVE (a previous one SUPERSEDED), the lineage ACTIVE, and the rule resumes.
     */
    activate: (owner: Owner, input: { readonly authorizationId: string; readonly revision: number; readonly digest: string; readonly passkeyId: string;
      readonly signCount: number; readonly assertion: Readonly<Record<string, unknown>>; readonly ruleResume: { readonly nextEvaluationAt: Date; readonly scheduleCursor: Date | null } },
    now: Date) => db.transaction(async tx => {
      const a = await lockAuthorization(tx, input.authorizationId);
      if (!a || a.owner.namespace !== owner.namespace || a.owner.address !== owner.address) refuse('AUTHORIZATION_NOT_FOUND');
      if (a!.state === 'REVOKED' || a!.state === 'EXPIRED') refuse(`AUTHORIZATION_${a!.state}`);
      if (a!.latestRevision !== input.revision) refuse('AUTHORIZATION_REVISION_STALE');
      const rev = (await tx.query('SELECT * FROM delegated_authorization_revisions WHERE tenant_id = $1 AND authorization_id = $2 AND revision = $3 FOR UPDATE',
        [tenantId, input.authorizationId, input.revision])).rows[0];
      if (!rev || rev.state !== 'PENDING_SIGNATURE' || rev.envelope_digest !== input.digest) refuse('AUTHORIZATION_NOT_PENDING');
      if ((await tx.query(`UPDATE passkey_challenges SET consumed_at = $5 WHERE tenant_id = $1 AND challenge_digest = $2 AND owner_namespace = $3 AND owner_account = $4
          AND purpose = 'AUTHORIZE' AND subject = $6 AND consumed_at IS NULL AND expires_at > $5 RETURNING 1`,
      [tenantId, Buffer.from(input.digest.slice(2), 'hex'), owner.namespace, owner.address, now, `${input.authorizationId}:${input.revision}`])).rowCount !== 1)
        refuse('AUTHORIZATION_CHALLENGE_INVALID');
      if ((await tx.query(`UPDATE passkey_credentials SET sign_count = $5, last_used_at = $6 WHERE tenant_id = $1 AND passkey_id = $2 AND owner_namespace = $3 AND owner_account = $4
          AND revoked_at IS NULL AND (sign_count < $5 OR ($5 = 0 AND sign_count = 0)) RETURNING 1`,
      [tenantId, input.passkeyId, owner.namespace, owner.address, input.signCount, now])).rowCount !== 1) refuse('PASSKEY_COUNTER_REPLAY');
      if (a!.activeRevision !== null) await tx.query(`UPDATE delegated_authorization_revisions SET state = 'SUPERSEDED' WHERE tenant_id = $1 AND authorization_id = $2 AND revision = $3`,
        [tenantId, input.authorizationId, a!.activeRevision]);
      await tx.query(`UPDATE delegated_authorization_revisions SET state = 'ACTIVE', passkey_id = $4, assertion = $5::jsonb, signed_at = $6
        WHERE tenant_id = $1 AND authorization_id = $2 AND revision = $3`, [tenantId, input.authorizationId, input.revision, input.passkeyId, json(input.assertion), now]);
      const updated = authorizationOf((await tx.query(`UPDATE delegated_authorizations SET state = 'ACTIVE', active_revision = $3, version = version + 1
        WHERE tenant_id = $1 AND authorization_id = $2 RETURNING *`, [tenantId, input.authorizationId, input.revision])).rows[0]!);
      // The rule resumes (re-armed from the next observation, schedule from now); an archived or expired rule stays as it is.
      await tx.query(`UPDATE automation_rules SET state = 'ACTIVE', version = version + 1, next_evaluation_at = $3, schedule_cursor = $4,
          trigger_state = jsonb_set(trigger_state, '{armed}', 'null'::jsonb)
        WHERE tenant_id = $1 AND rule_id = $2 AND state = 'PAUSED'`, [tenantId, a!.ruleId, input.ruleResume.nextEvaluationAt, input.ruleResume.scheduleCursor]);
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, 'DELEGATED_AUTHORIZATION_ACTIVATED')`, [tenantId, a!.ruleId, now]);
      await event(tx, { owner, kind: 'AUTHORIZATION_SIGNED', authorizationId: input.authorizationId, passkeyId: input.passkeyId,
        detail: { revision: input.revision, digest: input.digest } });
      return updated;
    }),
    /** A new revision (PENDING_SIGNATURE). An ACTIVE lineage stops at once (the old revision is SUPERSEDED, the rule paused) until it is signed. */
    newRevision: (owner: Owner, input: { readonly authorizationId: string; readonly strategy: StrategyInput; readonly manifest: DelegatedAuthorizationManifest;
      readonly manifestHash: string; readonly widening: readonly string[] }, now: Date) => db.transaction(async tx => {
      const a = await lockAuthorization(tx, input.authorizationId);
      if (!a || a.owner.namespace !== owner.namespace || a.owner.address !== owner.address) refuse('AUTHORIZATION_NOT_FOUND');
      if (a!.state === 'REVOKED' || a!.state === 'EXPIRED') refuse(`AUTHORIZATION_${a!.state}`);
      const revision = a!.latestRevision + 1;
      if (input.manifest.revision !== revision) refuse('AUTHORIZATION_REVISION_STALE');
      await tx.query(`UPDATE delegated_authorization_revisions SET state = 'SUPERSEDED' WHERE tenant_id = $1 AND authorization_id = $2 AND state IN ('ACTIVE', 'PENDING_SIGNATURE')`,
        [tenantId, input.authorizationId]);
      await tx.query(`INSERT INTO delegated_authorization_revisions (tenant_id, authorization_id, revision, owner_namespace, owner_account, state, strategy, workflow_hash, manifest,
          manifest_hash, widening, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'PENDING_SIGNATURE', $6::jsonb, $7, $8::jsonb, $9, $10::jsonb, $11, $11)`,
      [tenantId, input.authorizationId, revision, owner.namespace, owner.address, json(input.strategy), input.manifest.workflow.workflowHash, json(input.manifest),
        input.manifestHash, json(input.widening), now]);
      await tx.query(`UPDATE delegated_authorizations SET state = 'PENDING_SIGNATURE', active_revision = NULL, latest_revision = $3, version = version + 1
        WHERE tenant_id = $1 AND authorization_id = $2`, [tenantId, input.authorizationId, revision]);
      await tx.query(`UPDATE automation_rules SET state = 'PAUSED', version = version + 1 WHERE tenant_id = $1 AND rule_id = $2 AND state = 'ACTIVE'`, [tenantId, a!.ruleId]);
      await event(tx, { owner, kind: 'AUTHORIZATION_REVISION_CREATED', authorizationId: input.authorizationId, detail: { revision, widening: [...input.widening] } });
      return revision;
    }),
    /**
     * Revoke authorization: immediate and local. No reservation can commit after this transaction (same row lock); the active revision is
     * revoked, the rule paused; queued executions are blocked at their next transition; in-flight submissions are reconciled, never undone.
     */
    revoke: (owner: Owner, authorizationId: string, code: string, now: Date) => db.transaction(async tx => {
      const a = await lockAuthorization(tx, authorizationId);
      if (!a || a.owner.namespace !== owner.namespace || a.owner.address !== owner.address) refuse('AUTHORIZATION_NOT_FOUND');
      if (a!.state === 'REVOKED') return a!;
      await tx.query(`UPDATE delegated_authorization_revisions SET state = 'REVOKED' WHERE tenant_id = $1 AND authorization_id = $2 AND state IN ('ACTIVE', 'PENDING_SIGNATURE')`,
        [tenantId, authorizationId]);
      const updated = authorizationOf((await tx.query(`UPDATE delegated_authorizations SET state = 'REVOKED', active_revision = NULL, revoked_at = $3, revoke_code = $4,
          version = version + 1 WHERE tenant_id = $1 AND authorization_id = $2 RETURNING *`, [tenantId, authorizationId, now, code])).rows[0]!);
      await tx.query(`UPDATE automation_rules SET state = 'PAUSED', version = version + 1 WHERE tenant_id = $1 AND rule_id = $2 AND state = 'ACTIVE'`, [tenantId, a!.ruleId]);
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, 'DELEGATED_AUTHORIZATION_REVOKED')`, [tenantId, a!.ruleId, now]);
      await event(tx, { owner, kind: 'AUTHORIZATION_REVOKED', authorizationId, code });
      return updated;
    }),
    /** Lapses ACTIVE / PENDING lineages past their manifest expiry (sweep). */
    async expireAuthorizations(now: Date, limit: number): Promise<number> {
      const due = (await db.query(`SELECT a.authorization_id FROM delegated_authorizations a JOIN delegated_authorization_revisions r ON r.tenant_id = a.tenant_id
          AND r.authorization_id = a.authorization_id AND r.revision = a.latest_revision
        WHERE a.tenant_id = $1 AND a.state IN ('ACTIVE', 'PENDING_SIGNATURE') AND (r.manifest->>'expiresAt')::timestamptz <= $2 LIMIT $3`, [tenantId, now, limit])).rows;
      let n = 0;
      for (const { authorization_id } of due) await db.transaction(async tx => {
        const a = await lockAuthorization(tx, String(authorization_id));
        if (!a || (a.state !== 'ACTIVE' && a.state !== 'PENDING_SIGNATURE')) return;
        await tx.query(`UPDATE delegated_authorization_revisions SET state = 'EXPIRED' WHERE tenant_id = $1 AND authorization_id = $2 AND state IN ('ACTIVE', 'PENDING_SIGNATURE')`,
          [tenantId, a.authorizationId]);
        await tx.query(`UPDATE delegated_authorizations SET state = 'EXPIRED', active_revision = NULL, version = version + 1 WHERE tenant_id = $1 AND authorization_id = $2`,
          [tenantId, a.authorizationId]);
        await tx.query(`UPDATE automation_rules SET state = 'PAUSED', version = version + 1 WHERE tenant_id = $1 AND rule_id = $2 AND state = 'ACTIVE'`, [tenantId, a.ruleId]);
        await event(tx, { owner: a.owner, kind: 'AUTHORIZATION_EXPIRED', authorizationId: a.authorizationId });
        n++;
      });
      return n;
    },

    // ── Executions ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    /** The execution of one delegated occurrence (created QUEUED once; a duplicate delivery finds the same row). */
    async ensureExecution(e: { readonly executionId: string; readonly authorizationId: string; readonly revision: number; readonly owner: Owner; readonly ruleId: string;
      readonly occurrenceId: string; readonly workflowHash: string; readonly manifestHash: string; readonly stepCount: number }, now: Date): Promise<ExecutionRecord> {
      await db.query(`INSERT INTO delegated_executions (tenant_id, execution_id, authorization_id, revision, owner_namespace, owner_account, rule_id, occurrence_id, state,
          workflow_hash, manifest_hash, step_count, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'QUEUED', $9, $10, $11, $12, $12)
        ON CONFLICT (tenant_id, authorization_id, occurrence_id) DO NOTHING`,
      [tenantId, e.executionId, e.authorizationId, e.revision, e.owner.namespace, e.owner.address, e.ruleId, e.occurrenceId, e.workflowHash, e.manifestHash, e.stepCount, now]);
      return executionOf((await db.query(`SELECT * FROM delegated_executions WHERE tenant_id = $1 AND authorization_id = $2 AND occurrence_id = $3`,
        [tenantId, e.authorizationId, e.occurrenceId])).rows[0]!);
    },
    executionById: (executionId: string) => executionRow(db, executionId, false),
    async executions(owner: Owner, filter: { readonly authorizationId?: string; readonly limit: number }): Promise<readonly ExecutionRecord[]> {
      return (await db.query(`SELECT * FROM delegated_executions WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND ($4::text IS NULL OR authorization_id = $4)
          ORDER BY created_at DESC, execution_id LIMIT $5`, [tenantId, owner.namespace, owner.address, filter.authorizationId ?? null, Math.min(Math.max(1, filter.limit), 200)])).rows
        .map(executionOf);
    },
    async steps(executionId: string): Promise<readonly StepRecord[]> {
      return (await db.query('SELECT * FROM delegated_execution_steps WHERE tenant_id = $1 AND execution_id = $2 ORDER BY step_index', [tenantId, executionId])).rows.map(stepOf);
    },
    async budget(authorizationId: string, executionId?: string): Promise<readonly BudgetEntry[]> {
      return (await db.query(`SELECT * FROM delegated_budget_entries WHERE tenant_id = $1 AND authorization_id = $2 AND ($3::text IS NULL OR execution_id = $3)
          ORDER BY entry_id`, [tenantId, authorizationId, executionId ?? null])).rows.map(r => ({ executionId: String(r.execution_id), stepIndex: Number(r.step_index),
        asset: String(r.asset), reserved: BigInt(String(r.reserved_amount)), spent: r.spent_amount === null ? null : BigInt(String(r.spent_amount)), state: r.state as BudgetEntry['state'],
        starts: { DAY: date(r.day_start), WEEK: date(r.week_start), MONTH: date(r.month_start) } }));
    },
    usageOf: (authorizationId: string, periods: Readonly<Record<Period, Date>>) => usage(db, authorizationId, periods),
    /** A compare-and-set execution transition, with the authorization still ACTIVE at `revision` when `requireActive` (locked, shared). */
    transition: (executionId: string, expected: { readonly version: number; readonly from: readonly ExecutionState[] }, to: ExecutionState,
      patch: { readonly code?: string | null; readonly currentStep?: number; readonly attention?: boolean; readonly evidence?: Readonly<Record<string, unknown>>; readonly settled?: boolean },
      now: Date) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE delegated_executions SET state = $4, version = version + 1, code = CASE WHEN $5 THEN $6 ELSE code END,
          current_step = coalesce($7, current_step), attention = coalesce($8, attention), evidence = coalesce($9::jsonb, evidence),
          settled_at = CASE WHEN $10 THEN $11 ELSE settled_at END
        WHERE tenant_id = $1 AND execution_id = $2 AND version = $3 AND state = ANY($12::text[]) RETURNING *`,
      [tenantId, executionId, expected.version, to, patch.code !== undefined, patch.code ?? null, patch.currentStep ?? null, patch.attention ?? null, json(patch.evidence),
        patch.settled === true, now, [...expected.from]])).rows[0];
      if (!row) return null;
      const e = executionOf(row);
      await event(tx, { owner: e.owner, kind: `EXECUTION_${to}`, authorizationId: e.authorizationId, executionId, code: patch.code ?? null });
      return e;
    }),
    /**
     * The atomic budget reservation (AUTHORITY_VERIFIED → RESERVED): authorization row locked, ACTIVE at the execution's revision, ledger
     * usage summed inside the lock, `check` decides, entries and PENDING steps inserted. Returns the refusal code or the reserved execution.
     */
    reserve: (input: ReservationInput) => db.transaction(async tx => {
      const pre = await executionRow(tx, input.executionId, false);
      if (!pre) return { ok: false as const, code: 'EXECUTION_NOT_FOUND' };
      const a = await lockAuthorization(tx, pre.authorizationId);
      const e = await executionRow(tx, input.executionId, true);
      if (!a || !e) return { ok: false as const, code: 'EXECUTION_NOT_FOUND' };
      if (e.state !== 'AUTHORITY_VERIFIED' || e.version !== input.expectedVersion) return { ok: false as const, code: 'EXECUTION_CHANGED' };
      if (a.state !== 'ACTIVE') return { ok: false as const, code: a.state === 'REVOKED' ? 'AUTHORIZATION_REVOKED' : a.state === 'EXPIRED' ? 'AUTHORIZATION_EXPIRED' : 'AUTHORIZATION_NOT_ACTIVE' };
      if (a.activeRevision !== e.revision || input.revision !== e.revision) return { ok: false as const, code: 'AUTHORIZATION_REVISION_CHANGED' };
      const refused = input.check(await usage(tx, a.authorizationId, input.periods));
      if (refused) return { ok: false as const, code: refused };
      for (const entry of input.entries) await tx.query(`INSERT INTO delegated_budget_entries (tenant_id, authorization_id, execution_id, step_index, asset, reserved_amount, state,
          day_start, week_start, month_start, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::numeric, 'RESERVED', $7, $8, $9, $10, $10)`,
      [tenantId, a.authorizationId, e.executionId, entry.stepIndex, entry.asset, entry.amount.toString(), input.periods.DAY, input.periods.WEEK, input.periods.MONTH, input.now]);
      for (const s of input.steps) await tx.query(`INSERT INTO delegated_execution_steps (tenant_id, execution_id, step_index, state, credential_id, grant_id, mechanism, chain,
          grant_commitment, created_at, updated_at) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, $8, $9, $9)`,
      [tenantId, e.executionId, s.stepIndex, s.credentialId, s.grantId, s.mechanism, s.chain, s.grantCommitment, input.now]);
      const reserved = executionOf((await tx.query(`UPDATE delegated_executions SET state = 'RESERVED', version = version + 1, reserved_at = $3
        WHERE tenant_id = $1 AND execution_id = $2 RETURNING *`, [tenantId, e.executionId, input.now])).rows[0]!);
      await event(tx, { owner: e.owner, kind: 'EXECUTION_RESERVED', authorizationId: a.authorizationId, executionId: e.executionId,
        detail: { entries: input.entries.map(x => ({ step: x.stepIndex, asset: x.asset, amount: x.amount.toString() })) } });
      return { ok: true as const, execution: reserved };
    }),
    /** A compare-and-set step transition (no submission). */
    stepTransition: (executionId: string, stepIndex: number, from: readonly StepState[], to: StepState,
      patch: { readonly plan?: Readonly<Record<string, unknown>>; readonly reconciliation?: Readonly<Record<string, unknown>>; readonly code?: string | null }) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE delegated_execution_steps SET state = $4, plan = coalesce($5::jsonb, plan), reconciliation = coalesce($6::jsonb, reconciliation),
          code = CASE WHEN $7 THEN $8 ELSE code END, attempts = attempts + CASE WHEN $4 = 'SIMULATED' THEN 1 ELSE 0 END
        WHERE tenant_id = $1 AND execution_id = $2 AND step_index = $3 AND state = ANY($9::text[]) RETURNING *`,
      [tenantId, executionId, stepIndex, to, json(patch.plan), json(patch.reconciliation), patch.code !== undefined, patch.code ?? null, [...from]])).rows[0];
      return row ? stepOf(row) : null;
    }),
    /**
     * POLICY_VERIFIED → SUBMISSION_PREPARED with the exact signed bytes, committed BEFORE any broadcast — only if, in this same transaction,
     * the authorization is still ACTIVE at the execution's revision and the grant still ACTIVE (rows locked). Advances the grant's call
     * counter and EVM nonce. Returns the refusal code when revoked/changed (the caller then blocks the step).
     */
    prepareSubmission: (executionId: string, stepIndex: number, submission: Readonly<Record<string, unknown>>,
      grantUse: { readonly calls: number; readonly nextNonce: bigint | null }, now: Date) => db.transaction(async tx => {
      const e0 = await executionRow(tx, executionId, false);
      if (!e0) return { ok: false as const, code: 'EXECUTION_NOT_FOUND' };
      const a = await lockAuthorization(tx, e0.authorizationId);
      const e = await executionRow(tx, executionId, true);
      if (!a || !e) return { ok: false as const, code: 'EXECUTION_NOT_FOUND' };
      if (a.state !== 'ACTIVE' || a.activeRevision !== e.revision) return { ok: false as const, code: a.state === 'REVOKED' ? 'AUTHORIZATION_REVOKED' : 'AUTHORIZATION_NOT_ACTIVE' };
      if (e.state !== 'RUNNING') return { ok: false as const, code: 'EXECUTION_CHANGED' };
      const step = (await tx.query('SELECT * FROM delegated_execution_steps WHERE tenant_id = $1 AND execution_id = $2 AND step_index = $3 FOR UPDATE',
        [tenantId, executionId, stepIndex])).rows[0];
      if (!step || step.state !== 'POLICY_VERIFIED') return { ok: false as const, code: 'STEP_CHANGED' };
      const g = (await tx.query('SELECT state, calls_used, evm_next_nonce, expires_at FROM credential_grants WHERE tenant_id = $1 AND grant_id = $2 FOR UPDATE',
        [tenantId, step.grant_id])).rows[0];
      if (!g || g.state !== 'ACTIVE') return { ok: false as const, code: g ? `CREDENTIAL_${String(g.state)}` : 'CREDENTIAL_NOT_FOUND' };
      if (date(g.expires_at) <= now) return { ok: false as const, code: 'CREDENTIAL_EXPIRED' };
      await tx.query(`UPDATE credential_grants SET calls_used = calls_used + $3, evm_next_nonce = coalesce($4, evm_next_nonce), version = version + 1
        WHERE tenant_id = $1 AND grant_id = $2`, [tenantId, step.grant_id, grantUse.calls, grantUse.nextNonce === null ? null : grantUse.nextNonce.toString()]);
      const row = (await tx.query(`UPDATE delegated_execution_steps SET state = 'SUBMISSION_PREPARED', submission = $4::jsonb
        WHERE tenant_id = $1 AND execution_id = $2 AND step_index = $3 RETURNING *`, [tenantId, executionId, stepIndex, json(submission)])).rows[0]!;
      await event(tx, { owner: e.owner, kind: 'STEP_SUBMISSION_PREPARED', authorizationId: e.authorizationId, executionId, grantId: String(step.grant_id),
        detail: { step: stepIndex, hashes: (submission as { hashes?: unknown }).hashes ?? null } });
      return { ok: true as const, step: stepOf(row) };
    }),
    /** RESERVED → SPENT for what reconciliation proved spent; RELEASED for entries of steps that never submitted. */
    settleBudget: (executionId: string, spent: readonly { readonly stepIndex: number; readonly asset: string; readonly amount: bigint }[],
      release: readonly number[]) => db.transaction(async tx => {
      for (const s of spent) await tx.query(`UPDATE delegated_budget_entries SET state = 'SPENT', spent_amount = $5::numeric
        WHERE tenant_id = $1 AND execution_id = $2 AND step_index = $3 AND asset = $4 AND state = 'RESERVED'`, [tenantId, executionId, s.stepIndex, s.asset, s.amount.toString()]);
      if (release.length) await tx.query(`UPDATE delegated_budget_entries SET state = 'RELEASED' WHERE tenant_id = $1 AND execution_id = $2 AND step_index = ANY($3::int[])
        AND state = 'RESERVED'`, [tenantId, executionId, [...release]]);
    }),
    /** Executions that need the executor again (sweep): not terminal, untouched for `idleMs`. */
    async openExecutions(idleBefore: Date, limit: number): Promise<readonly ExecutionRecord[]> {
      return (await db.query(`SELECT * FROM delegated_executions WHERE tenant_id = $1 AND state NOT IN ('SETTLED', 'BLOCKED', 'FAILED') AND updated_at < $2
        ORDER BY updated_at LIMIT $3`, [tenantId, idleBefore, limit])).rows.map(executionOf);
    },
  };
}
export type DelegationStore = ReturnType<typeof createPgDelegationStore>;

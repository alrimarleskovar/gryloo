// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 → BUILD-DEVELOPER-001: durable approval handoffs on PostgreSQL — ONE model for every requester kind (migrations 0005
 * and 0006; the table keeps its historical name `mcp_handoffs`).
 *
 * A handoff is an external proposal waiting for its owner on FloFi. It carries no authority: the secret in its URL fragment only lets a
 * browser SEE the proposal; claiming it needs a proven wallet session, and everything after that is FloFi's existing flow (fresh
 * simulation, Strategy Manifest Review, explicit approval, the owner's wallet signature).
 *
 * The requester is generic: `(requester_kind, requester_ref)` is its isolation key. Every requester-scoped operation (lookup, approval
 * session, revocation, listing, the open-request cap and supersession) is limited to it; secret lookups can be limited to the requester
 * kinds of the link scheme that resolved the secret. An MCP requester keeps its account and grant (ref = account id).
 *
 * States move forward only (the database trigger enforces it): PENDING → CLAIMED → APPLIED; EXPIRED, SUPERSEDED, REVOKED and STALE are
 * terminal and never revive. Every transition is a compare-and-set inside one short transaction with a row lock. Expiry is applied
 * lazily, by whoever reads or writes the row next. Only keyed digests of secrets are ever written.
 */
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import type { ExecutionPlan } from '../mcp/execution.ts';

export const APPROVAL_REQUESTER_KINDS = Object.freeze(['MCP_ACCOUNT', 'DEVELOPER_PROJECT', 'CHANNEL_CONVERSATION'] as const);
export type ApprovalRequesterKind = (typeof APPROVAL_REQUESTER_KINDS)[number];
/** A requester's isolation scope. For an MCP account, `ref` is its account id. */
export type RequesterScope = { readonly kind: ApprovalRequesterKind; readonly ref: string };
/** The persisted form of a requester ref (lower-case, so it also fits abuse-limit bucket names). */
export const REQUESTER_REF = /^[a-z][a-z0-9_.:-]{2,95}$/;
export type HandoffStatus = 'PENDING' | 'CLAIMED' | 'APPLIED' | 'EXPIRED' | 'SUPERSEDED' | 'REVOKED' | 'STALE';
export const TERMINAL: readonly HandoffStatus[] = Object.freeze(['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE']);
export type WalletRef = { readonly namespace: 'eip155' | 'solana'; readonly address: string };
export type HandoffRecord = {
  readonly handoffId: string;
  readonly requesterKind: ApprovalRequesterKind; readonly requesterRef: string;
  /** Immutable, non-secret facts the requester's claim policy may need; never shown to the owner or returned to the requester. */
  readonly requesterContext: Readonly<Record<string, unknown>>;
  /** MCP requesters only: the pseudonymous account (= requesterRef) and the OAuth grant that made the request; null otherwise. */
  readonly accountId: string | null; readonly grantId: string | null;
  /** The requester's client or application id, and the name the owner sees on /approve. */
  readonly clientId: string; readonly clientName: string;
  readonly strategy: unknown; readonly workflowHash: string; readonly engineVersion: string; readonly networkEnvironment: string;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly plan: ExecutionPlan; readonly status: HandoffStatus; readonly claimed: WalletRef | null;
  readonly shareStatus: boolean; readonly runIds: readonly string[]; readonly expiresAt: Date; readonly claimExpiresAt: Date | null; readonly claimedAt: Date | null;
  readonly appliedAt: Date | null; readonly endedAt: Date | null; readonly createdAt: Date; readonly signingExpiresAt: Date | null;
};
export type NewHandoff = Pick<HandoffRecord, 'handoffId' | 'clientId' | 'clientName' | 'strategy' | 'workflowHash' | 'engineVersion' | 'networkEnvironment' |
  'fundsClass' | 'plan' | 'expiresAt'> & {
  readonly requester: RequesterScope;
  /** MCP requesters: the OAuth grant (required); every other kind: null. */
  readonly grantId: string | null;
  readonly requesterContext: Readonly<Record<string, unknown>>;
  readonly secretDigest: Buffer;
};
/** How one requester kind's new handoffs interact with its open ones. */
export type HandoffCreateRules = { readonly maxPending: number; readonly supersedeSameWorkflow: boolean };
export type ClaimDecision = { readonly ok: true; readonly share: boolean } | { readonly ok: false; readonly code: string; readonly stale?: boolean };
export type ClaimResult = { readonly ok: true; readonly handoff: HandoffRecord } | { readonly ok: false; readonly code: string; readonly handoff: HandoffRecord | null };
/** Requester kinds a secret lookup is limited to (the resolving link scheme's kinds); omitted = any kind. */
type Kinds = readonly ApprovalRequesterKind[] | undefined;

export interface HandoffStore {
  /**
   * Creates a PENDING handoff for its requester: expires the requester's lapsed ones, supersedes its older PENDING handoffs of the same
   * workflow when the rules say so, and enforces the requester's open-request cap (`HANDOFF_PENDING_LIMIT`).
   */
  readonly create: (handoff: NewHandoff, now: Date, rules: HandoffCreateRules) => Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'HANDOFF_PENDING_LIMIT' }>;
  /** One requester's handoff (never another requester's), with lazy expiry. */
  readonly forRequester: (handoffId: string, requester: RequesterScope, now: Date) => Promise<HandoffRecord | null>;
  /** The handoff a browser holds a secret for: the approval secret, or a live approval-session secret. */
  readonly bySecret: (digest: Buffer, now: Date, kinds?: Kinds) => Promise<HandoffRecord | null>;
  /**
   * Claims a PENDING handoff for a proven wallet (or re-opens the same wallet's live claim). `decide` re-verifies the proposal and the
   * requester's claim rules inside the lock; a stale proposal becomes STALE.
   */
  readonly claim: (digest: Buffer, wallet: WalletRef, now: Date, claimSeconds: number, decide: (handoff: HandoffRecord) => ClaimDecision, kinds?: Kinds) => Promise<ClaimResult>;
  /** The claimant applied the re-composed proposal into its FloFi workflow: CLAIMED → APPLIED. */
  readonly apply: (digest: Buffer, wallet: WalletRef, now: Date, kinds?: Kinds) => Promise<ClaimResult>;
  /** The requester withdraws a handoff that is not yet applied: PENDING/CLAIMED → REVOKED. */
  readonly revokeForRequester: (handoffId: string, requester: RequesterScope, now: Date) => Promise<HandoffRecord | null>;
  /** A fresh approval-session secret digest for an open handoff of this requester (replaces the previous one). */
  readonly openSession: (handoffId: string, requester: RequesterScope, digest: Buffer, expiresAt: Date, now: Date) => Promise<HandoffRecord | null>;
  /** Records runs started from this handoff by its claimant (bounded list). */
  readonly bindRuns: (handoffId: string, runIds: readonly string[]) => Promise<void>;
  /** The claimant's choice to share run status with the requester. */
  readonly setSharing: (digest: Buffer, wallet: WalletRef, share: boolean, now: Date, kinds?: Kinds) => Promise<HandoffRecord | null>;
  /** One requester's handoffs, newest first. */
  readonly listForRequester: (requester: RequesterScope, now: Date, limit: number) => Promise<readonly HandoffRecord[]>;
  /** BUILD-MCP-002 forms, kept for its callers: the requester is the MCP account. */
  readonly forAccount: (handoffId: string, accountId: string, now: Date) => Promise<HandoffRecord | null>;
  readonly revoke: (handoffId: string, accountId: string, now: Date) => Promise<HandoffRecord | null>;
  readonly listForAccount: (accountId: string, now: Date, limit: number) => Promise<readonly HandoffRecord[]>;
  readonly purge: (now: Date) => Promise<void>;
}

const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown) => value === null || value === undefined ? null : date(value);
const mcpAccount = (accountId: string): RequesterScope => ({ kind: 'MCP_ACCOUNT', ref: accountId });
function recordOf(row: Row): HandoffRecord {
  return { handoffId: String(row.handoff_id), requesterKind: row.requester_kind as ApprovalRequesterKind, requesterRef: String(row.requester_ref),
    requesterContext: (row.requester_context ?? {}) as Record<string, unknown>,
    accountId: row.account_id === null ? null : String(row.account_id), grantId: row.grant_id === null ? null : String(row.grant_id), clientId: String(row.client_id),
    clientName: String(row.client_name), strategy: row.strategy, workflowHash: String(row.workflow_hash), engineVersion: String(row.engine_version),
    networkEnvironment: String(row.network_environment), fundsClass: row.funds_class as HandoffRecord['fundsClass'], plan: row.plan as ExecutionPlan,
    status: row.status as HandoffStatus, claimed: row.claimed_address ? { namespace: row.claimed_namespace as WalletRef['namespace'], address: String(row.claimed_address) } : null,
    shareStatus: row.share_status === true, runIds: (row.run_ids as string[] | null ?? []).map(String), expiresAt: date(row.expires_at),
    claimExpiresAt: maybeDate(row.claim_expires_at), claimedAt: maybeDate(row.claimed_at), appliedAt: maybeDate(row.applied_at), endedAt: maybeDate(row.ended_at),
    createdAt: date(row.created_at), signingExpiresAt: maybeDate(row.signing_expires_at) };
}
/** The status a row has at `now`: PENDING past its expiry, or CLAIMED past its claim window, is EXPIRED. */
const lapsed = (h: HandoffRecord, now: Date) => h.status === 'PENDING' && h.expiresAt <= now || h.status === 'CLAIMED' && (h.claimExpiresAt ?? now) <= now;
async function expireIfLapsed(tx: Queryable, tenantId: string, h: HandoffRecord, now: Date): Promise<HandoffRecord> {
  if (!lapsed(h, now)) return h;
  await tx.query(`UPDATE mcp_handoffs SET status = 'EXPIRED', ended_at = $3 WHERE tenant_id = $1 AND handoff_id = $2 AND status IN ('PENDING', 'CLAIMED')`, [tenantId, h.handoffId, now]);
  return { ...h, status: 'EXPIRED', endedAt: now };
}
const sameWallet = (a: WalletRef | null, b: WalletRef) => a !== null && a.namespace === b.namespace && a.address === b.address;
const BY_DIGEST = `SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND (secret_digest = $2 OR (signing_digest = $2 AND signing_expires_at > $3))
  AND ($4::text[] IS NULL OR requester_kind = ANY($4::text[])) FOR UPDATE`;
const SCOPED = 'tenant_id = $1 AND handoff_id = $2 AND requester_kind = $3 AND requester_ref = $4';
const kindsOf = (kinds: Kinds) => kinds === undefined ? null : [...kinds];

export function createPgHandoffStore(db: Database, tenantId: string): HandoffStore {
  const locked = async (tx: Queryable, digest: Buffer, now: Date, kinds: Kinds) => {
    const row = (await tx.query(BY_DIGEST, [tenantId, digest, now, kindsOf(kinds)])).rows[0];
    return row ? expireIfLapsed(tx, tenantId, recordOf(row), now) : null;
  };
  const scoped = async (tx: Queryable, handoffId: string, requester: RequesterScope, now: Date) => {
    const row = (await tx.query(`SELECT * FROM mcp_handoffs WHERE ${SCOPED} FOR UPDATE`, [tenantId, handoffId, requester.kind, requester.ref])).rows[0];
    return row ? expireIfLapsed(tx, tenantId, recordOf(row), now) : null;
  };
  const forRequester: HandoffStore['forRequester'] = (handoffId, requester, now) => db.transaction(tx => scoped(tx, handoffId, requester, now));
  const revokeForRequester: HandoffStore['revokeForRequester'] = (handoffId, requester, now) => db.transaction(async tx => {
    const h = await scoped(tx, handoffId, requester, now);
    if (!h) return null;
    if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return h;
    await tx.query(`UPDATE mcp_handoffs SET status = 'REVOKED', ended_at = $3 WHERE tenant_id = $1 AND handoff_id = $2`, [tenantId, handoffId, now]);
    return { ...h, status: 'REVOKED', endedAt: now };
  });
  const listForRequester: HandoffStore['listForRequester'] = async (requester, now, limit) => {
    const rows = (await db.query(`SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND requester_kind = $2 AND requester_ref = $3 ORDER BY created_at DESC LIMIT $4`,
      [tenantId, requester.kind, requester.ref, limit])).rows;
    return rows.map(recordOf).map(h => lapsed(h, now) ? { ...h, status: 'EXPIRED' as const } : h);
  };
  return {
    create: (h, now, rules) => db.transaction(async tx => {
      const mcp = h.requester.kind === 'MCP_ACCOUNT';
      // Serialize one requester's handoff creation so its cap and supersession are exact (any requester kind, row or not).
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`flofi.handoff/${tenantId}/${h.requester.kind}/${h.requester.ref}`]);
      await tx.query(`UPDATE mcp_handoffs SET status = 'EXPIRED', ended_at = $4 WHERE tenant_id = $1 AND requester_kind = $2 AND requester_ref = $3
        AND ((status = 'PENDING' AND expires_at <= $4) OR (status = 'CLAIMED' AND claim_expires_at <= $4))`, [tenantId, h.requester.kind, h.requester.ref, now]);
      if (rules.supersedeSameWorkflow) await tx.query(`UPDATE mcp_handoffs SET status = 'SUPERSEDED', ended_at = $5 WHERE tenant_id = $1 AND requester_kind = $2
        AND requester_ref = $3 AND workflow_hash = $4 AND status = 'PENDING'`, [tenantId, h.requester.kind, h.requester.ref, h.workflowHash, now]);
      const pending = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_handoffs WHERE tenant_id = $1 AND requester_kind = $2 AND requester_ref = $3
        AND status IN ('PENDING', 'CLAIMED')`, [tenantId, h.requester.kind, h.requester.ref])).rows[0]!.n;
      if (pending >= rules.maxPending) return { ok: false, code: 'HANDOFF_PENDING_LIMIT' } as const;
      await tx.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, requester_kind, requester_id, requester_context, account_id, grant_id, client_id, client_name,
        secret_digest, strategy, workflow_hash, engine_version, network_environment, funds_class, plan, status, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'PENDING', $17, $18, $18)`,
      [tenantId, h.handoffId, h.requester.kind, mcp ? null : h.requester.ref, JSON.stringify(h.requesterContext), mcp ? h.requester.ref : null, h.grantId,
        h.clientId, h.clientName, h.secretDigest, JSON.stringify(h.strategy), h.workflowHash, h.engineVersion, h.networkEnvironment, h.fundsClass,
        JSON.stringify(h.plan), h.expiresAt, now]);
      return { ok: true } as const;
    }),
    forRequester,
    bySecret: (digest, now, kinds) => db.transaction(tx => locked(tx, digest, now, kinds)),
    claim: (digest, wallet, now, claimSeconds, decide, kinds) => db.transaction(async tx => {
      const h = await locked(tx, digest, now, kinds);
      if (!h) return { ok: false, code: 'HANDOFF_NOT_FOUND', handoff: null };
      if (h.status === 'CLAIMED' || h.status === 'APPLIED') {
        // The same wallet re-opening its own claim (a reload) is idempotent; anyone else is refused.
        return sameWallet(h.claimed, wallet) ? { ok: true, handoff: h } : { ok: false, code: 'HANDOFF_ALREADY_CLAIMED', handoff: null };
      }
      if (h.status !== 'PENDING') return { ok: false, code: `HANDOFF_${h.status}`, handoff: h };
      const decision = decide(h);
      if (!decision.ok) {
        if (decision.stale) {
          await tx.query(`UPDATE mcp_handoffs SET status = 'STALE', ended_at = $3 WHERE tenant_id = $1 AND handoff_id = $2`, [tenantId, h.handoffId, now]);
          return { ok: false, code: 'HANDOFF_STALE', handoff: { ...h, status: 'STALE', endedAt: now } };
        }
        return { ok: false, code: decision.code, handoff: h };
      }
      const claimExpiresAt = new Date(now.getTime() + claimSeconds * 1000);
      await tx.query(`UPDATE mcp_handoffs SET status = 'CLAIMED', claimed_namespace = $3, claimed_address = $4, claimed_at = $5, claim_expires_at = $6, share_status = $7
        WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'PENDING'`, [tenantId, h.handoffId, wallet.namespace, wallet.address, now, claimExpiresAt, decision.share]);
      return { ok: true, handoff: { ...h, status: 'CLAIMED', claimed: wallet, claimedAt: now, claimExpiresAt, shareStatus: decision.share } };
    }),
    apply: (digest, wallet, now, kinds) => db.transaction(async tx => {
      const h = await locked(tx, digest, now, kinds);
      if (!h || !sameWallet(h.claimed, wallet)) return { ok: false, code: 'HANDOFF_NOT_FOUND', handoff: null };
      if (h.status === 'APPLIED') return { ok: true, handoff: h };
      if (h.status !== 'CLAIMED') return { ok: false, code: `HANDOFF_${h.status}`, handoff: h };
      await tx.query(`UPDATE mcp_handoffs SET status = 'APPLIED', applied_at = $3, signing_digest = NULL, signing_expires_at = NULL
        WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'CLAIMED'`, [tenantId, h.handoffId, now]);
      return { ok: true, handoff: { ...h, status: 'APPLIED', appliedAt: now, signingExpiresAt: null } };
    }),
    revokeForRequester,
    openSession: (handoffId, requester, digest, expiresAt, now) => db.transaction(async tx => {
      const h = await scoped(tx, handoffId, requester, now);
      if (!h) return null;
      if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return h;
      await tx.query('UPDATE mcp_handoffs SET signing_digest = $3, signing_expires_at = $4 WHERE tenant_id = $1 AND handoff_id = $2', [tenantId, handoffId, digest, expiresAt]);
      return { ...h, signingExpiresAt: expiresAt };
    }),
    async bindRuns(handoffId, runIds) {
      await db.query(`UPDATE mcp_handoffs SET run_ids = (SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(run_ids || $3::text[]) AS r)
        WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'APPLIED' AND cardinality(run_ids || $3::text[]) <= 16`, [tenantId, handoffId, [...runIds]]);
    },
    setSharing: (digest, wallet, share, now, kinds) => db.transaction(async tx => {
      const h = await locked(tx, digest, now, kinds);
      if (!h || !sameWallet(h.claimed, wallet) || (h.status !== 'CLAIMED' && h.status !== 'APPLIED')) return null;
      await tx.query('UPDATE mcp_handoffs SET share_status = $3 WHERE tenant_id = $1 AND handoff_id = $2', [tenantId, h.handoffId, share]);
      return { ...h, shareStatus: share };
    }),
    listForRequester,
    forAccount: (handoffId, accountId, now) => forRequester(handoffId, mcpAccount(accountId), now),
    revoke: (handoffId, accountId, now) => revokeForRequester(handoffId, mcpAccount(accountId), now),
    listForAccount: (accountId, now, limit) => listForRequester(mcpAccount(accountId), now, limit),
    async purge(now) {
      await db.query('DELETE FROM mcp_handoffs WHERE tenant_id = $1 AND created_at < $2', [tenantId, new Date(now.getTime() - 30 * 86_400_000)]);
    },
  };
}

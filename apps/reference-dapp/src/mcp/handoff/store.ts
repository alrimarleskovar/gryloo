// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: durable approval handoffs (`mcp_handoffs`, migration 0005) on PostgreSQL.
 *
 * A handoff is an external proposal waiting for its owner on FloFi. It carries no authority: the secret in its URL fragment
 * only lets a browser SEE the proposal; claiming it needs a proven wallet session, and everything after that is FloFi's
 * existing flow (fresh simulation, Strategy Manifest Review, explicit approval, the owner's wallet signature).
 *
 * States move forward only (the database trigger enforces it): PENDING → CLAIMED → APPLIED; EXPIRED, SUPERSEDED, REVOKED and
 * STALE are terminal and never revive. Every transition is a compare-and-set inside one short transaction with a row lock.
 * Expiry is applied lazily, by whoever reads or writes the row next.
 */
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import type { ExecutionPlan } from '../execution.ts';

export type HandoffStatus = 'PENDING' | 'CLAIMED' | 'APPLIED' | 'EXPIRED' | 'SUPERSEDED' | 'REVOKED' | 'STALE';
export const TERMINAL: readonly HandoffStatus[] = Object.freeze(['EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE']);
export type WalletRef = { readonly namespace: 'eip155' | 'solana'; readonly address: string };
export type HandoffRecord = {
  readonly handoffId: string; readonly accountId: string; readonly grantId: string; readonly clientId: string; readonly clientName: string;
  readonly strategy: unknown; readonly workflowHash: string; readonly engineVersion: string; readonly networkEnvironment: string;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly plan: ExecutionPlan; readonly status: HandoffStatus; readonly claimed: WalletRef | null;
  readonly shareStatus: boolean; readonly runIds: readonly string[]; readonly expiresAt: Date; readonly claimExpiresAt: Date | null; readonly claimedAt: Date | null;
  readonly appliedAt: Date | null; readonly endedAt: Date | null; readonly createdAt: Date; readonly signingExpiresAt: Date | null;
};
export type NewHandoff = Pick<HandoffRecord, 'handoffId' | 'accountId' | 'grantId' | 'clientId' | 'clientName' | 'strategy' | 'workflowHash' | 'engineVersion' |
  'networkEnvironment' | 'fundsClass' | 'plan' | 'expiresAt'> & { readonly secretDigest: Buffer };
export type ClaimDecision = { readonly ok: true; readonly share: boolean } | { readonly ok: false; readonly code: string; readonly stale?: boolean };
export type ClaimResult = { readonly ok: true; readonly handoff: HandoffRecord } | { readonly ok: false; readonly code: string; readonly handoff: HandoffRecord | null };

export interface HandoffStore {
  /** Creates a PENDING handoff: expires the account's lapsed ones, supersedes its older PENDING handoffs of the same workflow, enforces the cap. */
  readonly create: (handoff: NewHandoff, now: Date, maxPending: number) => Promise<{ readonly ok: true } | { readonly ok: false; readonly code: 'MCP_HANDOFF_LIMIT' }>;
  /** One account's handoff (never another account's), with lazy expiry. */
  readonly forAccount: (handoffId: string, accountId: string, now: Date) => Promise<HandoffRecord | null>;
  /** The handoff a browser holds a secret for: the approval secret, or a live approval-session secret. */
  readonly bySecret: (digest: Buffer, now: Date) => Promise<HandoffRecord | null>;
  /**
   * Claims a PENDING handoff for a proven wallet (or re-opens the same wallet's live claim). `decide` re-verifies the proposal
   * (re-composition, engine, gates) inside the lock; a stale proposal becomes STALE.
   */
  readonly claim: (digest: Buffer, wallet: WalletRef, now: Date, claimSeconds: number, decide: (handoff: HandoffRecord) => ClaimDecision) => Promise<ClaimResult>;
  /** The claimant applied the re-composed proposal into its FloFi workflow: CLAIMED → APPLIED. */
  readonly apply: (digest: Buffer, wallet: WalletRef, now: Date) => Promise<ClaimResult>;
  /** The account withdraws a handoff that is not yet applied: PENDING/CLAIMED → REVOKED. */
  readonly revoke: (handoffId: string, accountId: string, now: Date) => Promise<HandoffRecord | null>;
  /** A fresh approval-session secret for an open handoff of this account (replaces the previous one). */
  readonly openSession: (handoffId: string, accountId: string, digest: Buffer, expiresAt: Date, now: Date) => Promise<HandoffRecord | null>;
  /** Records a run started from this handoff by its claimant (bounded list), and the claimant's sharing choice. */
  readonly bindRuns: (handoffId: string, runIds: readonly string[]) => Promise<void>;
  readonly setSharing: (digest: Buffer, wallet: WalletRef, share: boolean, now: Date) => Promise<HandoffRecord | null>;
  /** Handoffs of an account, newest first (for /connections). */
  readonly listForAccount: (accountId: string, now: Date, limit: number) => Promise<readonly HandoffRecord[]>;
  readonly purge: (now: Date) => Promise<void>;
}

const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown) => value === null || value === undefined ? null : date(value);
function recordOf(row: Row): HandoffRecord {
  return { handoffId: String(row.handoff_id), accountId: String(row.account_id), grantId: String(row.grant_id), clientId: String(row.client_id),
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
const BY_DIGEST = `SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND (secret_digest = $2 OR (signing_digest = $2 AND signing_expires_at > $3)) FOR UPDATE`;

export function createPgHandoffStore(db: Database, tenantId: string): HandoffStore {
  const locked = async (tx: Queryable, digest: Buffer, now: Date) => {
    const row = (await tx.query(BY_DIGEST, [tenantId, digest, now])).rows[0];
    return row ? expireIfLapsed(tx, tenantId, recordOf(row), now) : null;
  };
  return {
    create: (h, now, maxPending) => db.transaction(async tx => {
      // Serialize one account's handoff creation so the cap and supersession are exact.
      await tx.query('SELECT 1 FROM mcp_accounts WHERE tenant_id = $1 AND account_id = $2 FOR UPDATE', [tenantId, h.accountId]);
      await tx.query(`UPDATE mcp_handoffs SET status = 'EXPIRED', ended_at = $3 WHERE tenant_id = $1 AND account_id = $2
        AND ((status = 'PENDING' AND expires_at <= $3) OR (status = 'CLAIMED' AND claim_expires_at <= $3))`, [tenantId, h.accountId, now]);
      await tx.query(`UPDATE mcp_handoffs SET status = 'SUPERSEDED', ended_at = $4 WHERE tenant_id = $1 AND account_id = $2 AND workflow_hash = $3 AND status = 'PENDING'`,
        [tenantId, h.accountId, h.workflowHash, now]);
      const pending = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM mcp_handoffs WHERE tenant_id = $1 AND account_id = $2 AND status IN ('PENDING', 'CLAIMED')`,
        [tenantId, h.accountId])).rows[0]!.n;
      if (pending >= maxPending) return { ok: false, code: 'MCP_HANDOFF_LIMIT' } as const;
      await tx.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, account_id, grant_id, client_id, client_name, secret_digest, strategy, workflow_hash, engine_version,
        network_environment, funds_class, plan, status, expires_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING', $14, $15, $15)`,
      [tenantId, h.handoffId, h.accountId, h.grantId, h.clientId, h.clientName, h.secretDigest, JSON.stringify(h.strategy), h.workflowHash, h.engineVersion,
        h.networkEnvironment, h.fundsClass, JSON.stringify(h.plan), h.expiresAt, now]);
      return { ok: true } as const;
    }),
    forAccount: (handoffId, accountId, now) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND handoff_id = $2 AND account_id = $3 FOR UPDATE', [tenantId, handoffId, accountId])).rows[0];
      return row ? expireIfLapsed(tx, tenantId, recordOf(row), now) : null;
    }),
    bySecret: (digest, now) => db.transaction(tx => locked(tx, digest, now)),
    claim: (digest, wallet, now, claimSeconds, decide) => db.transaction(async tx => {
      const h = await locked(tx, digest, now);
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
    apply: (digest, wallet, now) => db.transaction(async tx => {
      const h = await locked(tx, digest, now);
      if (!h || !sameWallet(h.claimed, wallet)) return { ok: false, code: 'HANDOFF_NOT_FOUND', handoff: null };
      if (h.status === 'APPLIED') return { ok: true, handoff: h };
      if (h.status !== 'CLAIMED') return { ok: false, code: `HANDOFF_${h.status}`, handoff: h };
      await tx.query(`UPDATE mcp_handoffs SET status = 'APPLIED', applied_at = $3, signing_digest = NULL, signing_expires_at = NULL
        WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'CLAIMED'`, [tenantId, h.handoffId, now]);
      return { ok: true, handoff: { ...h, status: 'APPLIED', appliedAt: now, signingExpiresAt: null } };
    }),
    revoke: (handoffId, accountId, now) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND handoff_id = $2 AND account_id = $3 FOR UPDATE', [tenantId, handoffId, accountId])).rows[0];
      if (!row) return null;
      const h = await expireIfLapsed(tx, tenantId, recordOf(row), now);
      if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return h;
      await tx.query(`UPDATE mcp_handoffs SET status = 'REVOKED', ended_at = $3 WHERE tenant_id = $1 AND handoff_id = $2`, [tenantId, handoffId, now]);
      return { ...h, status: 'REVOKED', endedAt: now };
    }),
    openSession: (handoffId, accountId, digest, expiresAt, now) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND handoff_id = $2 AND account_id = $3 FOR UPDATE', [tenantId, handoffId, accountId])).rows[0];
      if (!row) return null;
      const h = await expireIfLapsed(tx, tenantId, recordOf(row), now);
      if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return h;
      await tx.query('UPDATE mcp_handoffs SET signing_digest = $3, signing_expires_at = $4 WHERE tenant_id = $1 AND handoff_id = $2', [tenantId, handoffId, digest, expiresAt]);
      return { ...h, signingExpiresAt: expiresAt };
    }),
    async bindRuns(handoffId, runIds) {
      await db.query(`UPDATE mcp_handoffs SET run_ids = (SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(run_ids || $3::text[]) AS r)
        WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'APPLIED' AND cardinality(run_ids || $3::text[]) <= 16`, [tenantId, handoffId, [...runIds]]);
    },
    setSharing: (digest, wallet, share, now) => db.transaction(async tx => {
      const h = await locked(tx, digest, now);
      if (!h || !sameWallet(h.claimed, wallet) || (h.status !== 'CLAIMED' && h.status !== 'APPLIED')) return null;
      await tx.query('UPDATE mcp_handoffs SET share_status = $3 WHERE tenant_id = $1 AND handoff_id = $2', [tenantId, h.handoffId, share]);
      return { ...h, shareStatus: share };
    }),
    async listForAccount(accountId, now, limit) {
      const rows = (await db.query('SELECT * FROM mcp_handoffs WHERE tenant_id = $1 AND account_id = $2 ORDER BY created_at DESC LIMIT $3', [tenantId, accountId, limit])).rows;
      return rows.map(recordOf).map(h => lapsed(h, now) ? { ...h, status: 'EXPIRED' as const } : h);
    },
    async purge(now) {
      await db.query('DELETE FROM mcp_handoffs WHERE tenant_id = $1 AND created_at < $2', [tenantId, new Date(now.getTime() - 30 * 86_400_000)]);
    },
  };
}

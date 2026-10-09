// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Durable work queue over the `work_items` outbox table. Producers insert items inside the transaction that
 * makes them necessary (see log-store projections); workers claim with FOR UPDATE SKIP LOCKED and receive a
 * lease token. Settlement (complete / retry / dead) is fenced by that token, so a worker whose lease expired
 * and whose item was reclaimed cannot settle it. Delivery is at-least-once: handlers must be idempotent.
 * A relay to SQS/PubSub can later publish these rows without changing producers or handlers.
 */
import type { Database } from './db.js';

export type WorkItem = { readonly id: string; readonly tenantId: string; readonly kind: string; readonly dedupeKey: string;
  readonly runId: string | null; readonly payload: Readonly<Record<string, string>>; readonly deliveries: number;
  readonly leaseToken: string; readonly traceParent: string | null; readonly createdAt: Date };
export interface WorkQueue {
  readonly enqueue: (tenantId: string, kind: string, dedupeKey: string, runId: string | null, payload?: Readonly<Record<string, string>>, delayMs?: number) => Promise<boolean>;
  /** BUILD-AUTOMATION-001: `kinds` limits the claim to those work kinds (a scheduler endpoint that drains only its own work). */
  readonly claim: (limit: number, kinds?: readonly string[]) => Promise<readonly WorkItem[]>;
  readonly heartbeat: (item: WorkItem) => Promise<boolean>;
  readonly complete: (item: WorkItem) => Promise<boolean>;
  readonly retry: (item: WorkItem, delayMs: number, reason: string) => Promise<boolean>;
  readonly dead: (item: WorkItem, reason: string) => Promise<boolean>;
}
type ItemRow = { id: string; tenant_id: string; kind: string; dedupe_key: string; run_id: string | null; payload: Record<string, string>;
  deliveries: number; lease_token: string; trace_parent: string | null; created_at: Date };
const reasonText = (reason: string) => reason.replace(/[^A-Za-z0-9_:. -]/g, '').slice(0, 200) || 'UNSPECIFIED';

/**
 * BUILD-CLOUD-PARITY-001: `tenantId` scopes claims to one tenant, so deployments that share a database (for example a Preview
 * and Production) never process each other's runs with their own code and configuration. Without it every tenant is claimed.
 */
export function createPostgresWorkQueue(input: { db: Database; ownerId: string; leaseMs?: number; tenantId?: string }): WorkQueue {
  const { db, ownerId } = input, leaseMs = input.leaseMs ?? 60_000, tenantId = input.tenantId ?? null;
  const settle = async (item: WorkItem, sql: string, values: readonly unknown[]) =>
    (await db.query(sql + ' AND id = $1 AND lease_token = $2 AND state = \'LEASED\' RETURNING 1', [item.id, item.leaseToken, ...values])).rows.length === 1;
  return {
    async enqueue(tenantId, kind, dedupeKey, runId, payload = {}, delayMs = 0) {
      const { rows } = await db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, 'READY', now() + make_interval(secs => $6::double precision / 1000))
        ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING RETURNING 1`,
      [tenantId, kind, dedupeKey, runId, JSON.stringify(payload), delayMs]);
      return rows.length === 1;
    },
    async claim(limit, kinds) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('WORK_CLAIM_LIMIT_INVALID');
      if (kinds !== undefined && (!kinds.length || kinds.length > 16 || kinds.some(kind => !/^[a-z][a-z0-9.-]{1,63}$/.test(kind)))) throw new Error('WORK_CLAIM_KINDS_INVALID');
      const { rows } = await db.query<ItemRow>(`WITH candidate AS (
          SELECT id FROM work_items
          WHERE ((state = 'READY' AND available_at <= now()) OR (state = 'LEASED' AND lease_expires_at < now()))
            AND ($4::text IS NULL OR tenant_id = $4) AND ($5::text[] IS NULL OR kind = ANY($5::text[]))
          ORDER BY available_at, id LIMIT $1 FOR UPDATE SKIP LOCKED)
        UPDATE work_items w SET state = 'LEASED', lease_owner = $2, lease_token = gen_random_uuid(),
          lease_expires_at = now() + make_interval(secs => $3::double precision / 1000), deliveries = w.deliveries + 1, updated_at = now()
        FROM candidate WHERE w.id = candidate.id
        RETURNING w.id::text AS id, w.tenant_id, w.kind, w.dedupe_key, w.run_id, w.payload, w.deliveries, w.lease_token::text AS lease_token,
          w.trace_parent, w.created_at`, [limit, ownerId, leaseMs, tenantId, kinds === undefined ? null : [...kinds]]);
      return rows.map(row => Object.freeze({ id: row.id, tenantId: row.tenant_id, kind: row.kind, dedupeKey: row.dedupe_key, runId: row.run_id,
        payload: row.payload, deliveries: row.deliveries, leaseToken: row.lease_token, traceParent: row.trace_parent, createdAt: row.created_at }));
    },
    heartbeat: item => settle(item, `UPDATE work_items SET lease_expires_at = now() + make_interval(secs => $3::double precision / 1000), updated_at = now() WHERE lease_expires_at > now()`, [leaseMs]),
    complete: item => settle(item, `UPDATE work_items SET state = 'DONE', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      completed_at = now(), updated_at = now(), last_error = NULL WHERE true`, []),
    retry: (item, delayMs, reason) => settle(item, `UPDATE work_items SET state = 'READY', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      available_at = now() + make_interval(secs => $3::double precision / 1000), last_error = $4, updated_at = now() WHERE true`, [Math.max(0, Math.round(delayMs)), reasonText(reason)]),
    async dead(item, reason) {
      return db.transaction(async tx => {
        const settled = await tx.query(`UPDATE work_items SET state = 'DEAD', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
          completed_at = now(), last_error = $3, updated_at = now() WHERE id = $1 AND lease_token = $2 AND state = 'LEASED' RETURNING 1`,
        [item.id, item.leaseToken, reasonText(reason)]);
        // An exhausted run needs an operator or the owner; the sweeper must not silently re-arm it.
        if (settled.rows.length && item.runId) await tx.query(`UPDATE execution_runs SET attention_required = true, updated_at = now()
          WHERE tenant_id = $1 AND run_id = $2`, [item.tenantId, item.runId]);
        return settled.rows.length === 1;
      });
    },
  };
}

/**
 * Defense in depth: re-creates missing reconcile/evidence items from durable run state, and prunes old rows. Work is addressed by the
 * run's FLOW (what the projectors enqueue and the handlers dispatch on), which differs from its storage namespace when flows share one.
 */
export async function sweep(db: Database, options: { completedRetentionDays?: number; tenantId?: string } = {}): Promise<{ reconcile: number; evidence: number }> {
  // BUILD-CLOUD-PARITY-001: a tenant-scoped deployment only re-arms and prunes its own tenant's rows.
  const tenant = [options.tenantId ?? null];
  const reconcile = await db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
    SELECT r.tenant_id, 'reconcile', r.flow || ':' || r.run_id, r.run_id,
      jsonb_build_object('namespace', r.flow, 'runId', r.run_id), 'READY', now()
    FROM execution_runs r
    WHERE r.needs_observation AND NOT r.attention_required AND ($1::text IS NULL OR r.tenant_id = $1) AND NOT EXISTS (
      SELECT 1 FROM work_items w WHERE w.tenant_id = r.tenant_id AND w.kind = 'reconcile'
        AND w.dedupe_key = r.flow || ':' || r.run_id AND w.state IN ('READY', 'LEASED'))
    LIMIT 500
    ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`, tenant);
  const evidence = await db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
    SELECT r.tenant_id, 'evidence.archive', r.flow || ':' || r.run_id, r.run_id,
      jsonb_build_object('namespace', r.flow, 'runId', r.run_id), 'READY', now()
    FROM execution_runs r
    WHERE r.has_evidence AND NOT r.attention_required AND ($1::text IS NULL OR r.tenant_id = $1)
      AND NOT EXISTS (SELECT 1 FROM evidence_objects e WHERE e.tenant_id = r.tenant_id AND e.run_id = r.run_id)
      AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id = r.tenant_id AND w.kind = 'evidence.archive'
        AND w.dedupe_key = r.flow || ':' || r.run_id AND w.state IN ('READY', 'LEASED', 'DEAD'))
    LIMIT 500
    ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`, tenant);
  const days = options.completedRetentionDays ?? 14;
  await db.query(`DELETE FROM work_items WHERE state = 'DONE' AND completed_at < now() - make_interval(days => $1) AND ($2::text IS NULL OR tenant_id = $2)`, [days, ...tenant]);
  await db.query(`DELETE FROM api_idempotency WHERE expires_at < now() AND ($1::text IS NULL OR tenant_id = $1)`, tenant);
  return { reconcile: reconcile.rowCount, evidence: evidence.rowCount };
}

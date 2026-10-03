// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Durable fenced leases in PostgreSQL, implementing the executor's LeaseStore port for N processes on N hosts.
 * Acquisition succeeds only when the key is free or its holder's lease has expired by the DATABASE clock, and
 * increments a per-key fence that never decreases (rows are never deleted). The held (key, fence) pairs travel
 * in AsyncLocalStorage, and every durable write made inside the section re-verifies them in its own
 * transaction (`assertHeldLeases`), so a paused or partitioned holder cannot write after takeover.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { assertLogName, type LeaseStore } from '@defi-workflow-engine/reference-executor';
import type { Database, Queryable } from './db.js';

export type HeldLease = { readonly tenantId: string; readonly namespace: string; readonly key: string;
  readonly ownerId: string; readonly fence: string; lost: boolean };
const held = new AsyncLocalStorage<readonly HeldLease[]>();
export const currentLeases = (): readonly HeldLease[] => held.getStore() ?? [];

/** Fails closed with EXECUTION_LEASE_LOST unless every lease held for `tenantId` is still owned and unexpired. */
export async function assertHeldLeases(tx: Queryable, tenantId: string): Promise<void> {
  const leases = currentLeases().filter(lease => lease.tenantId === tenantId);
  if (!leases.length) return;
  if (leases.some(lease => lease.lost)) throw new Error('EXECUTION_LEASE_LOST');
  // FOR SHARE blocks a concurrent takeover until this write commits; takeover requires expiry anyway.
  const { rows } = await tx.query(`SELECT 1 FROM execution_leases
    WHERE tenant_id = $1 AND (namespace, lease_key, owner_id, fence) IN
      (SELECT * FROM unnest($2::text[], $3::text[], $4::text[], $5::bigint[]))
      AND expires_at > now() FOR SHARE`,
  [tenantId, leases.map(l => l.namespace), leases.map(l => l.key), leases.map(l => l.ownerId), leases.map(l => l.fence)]);
  if (rows.length !== leases.length) throw new Error('EXECUTION_LEASE_LOST');
}

export type LeaseOptions = { readonly db: Database; readonly tenantId: string; readonly namespace: string; readonly busyCode: string;
  readonly holderId: string; readonly ttlMs?: number; readonly heartbeatMs?: number; readonly onLost?: (lease: HeldLease) => void };
export function createPostgresLeaseStore(options: LeaseOptions): LeaseStore {
  const ttl = options.ttlMs ?? 30_000, heartbeat = options.heartbeatMs ?? Math.floor(ttl / 3);
  if (!Number.isSafeInteger(ttl) || ttl < 1_000 || heartbeat < 100 || heartbeat >= ttl) throw new Error('LEASE_CONFIGURATION_INVALID');
  return {
    async hold<T>(key: string, action: () => Promise<T>): Promise<T> {
      assertLogName(key);
      const current = currentLeases();
      if (current.some(l => l.tenantId === options.tenantId && l.namespace === options.namespace && l.key === key)) return action();
      const ownerId = `${options.holderId}:${randomUUID()}`;
      const { rows } = await options.db.query<{ fence: string }>(`INSERT INTO execution_leases
          (tenant_id, namespace, lease_key, owner_id, fence, acquired_at, expires_at)
        VALUES ($1, $2, $3, $4, 1, now(), now() + make_interval(secs => $5::double precision / 1000))
        ON CONFLICT (tenant_id, namespace, lease_key) DO UPDATE
          SET owner_id = EXCLUDED.owner_id, fence = execution_leases.fence + 1, acquired_at = now(), expires_at = EXCLUDED.expires_at
          WHERE execution_leases.expires_at <= now()
        RETURNING fence::text AS fence`, [options.tenantId, options.namespace, key, ownerId, ttl]);
      if (!rows[0]) throw new Error(options.busyCode);
      const lease: HeldLease = { tenantId: options.tenantId, namespace: options.namespace, key, ownerId, fence: rows[0].fence, lost: false };
      const timer = setInterval(() => {
        options.db.query(`UPDATE execution_leases SET expires_at = now() + make_interval(secs => $5::double precision / 1000)
            WHERE tenant_id = $1 AND namespace = $2 AND lease_key = $3 AND owner_id = $4 AND expires_at > now() RETURNING 1`,
        [options.tenantId, options.namespace, key, ownerId, ttl]).then(result => {
          if (!result.rows.length && !lease.lost) { lease.lost = true; clearInterval(timer); options.onLost?.(lease); }
        }, () => undefined); // A failed renewal is retried; expiry is judged by the database clock at write time.
      }, heartbeat);
      timer.unref();
      try { return await held.run([...current, lease], action); }
      finally {
        clearInterval(timer);
        // Expire rather than delete: the fence of this key keeps increasing across holders.
        await options.db.query(`UPDATE execution_leases SET expires_at = now()
            WHERE tenant_id = $1 AND namespace = $2 AND lease_key = $3 AND owner_id = $4 AND expires_at > now()`,
        [options.tenantId, options.namespace, key, ownerId]).catch(() => undefined);
      }
    },
  };
}

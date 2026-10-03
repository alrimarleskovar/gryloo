// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HTTP request idempotency. A key binds to the SHA-256 of the request; a replay with the same request returns
 * the stored success, a different request under the same key is rejected, and a concurrent duplicate is told
 * to retry. Failures release the key so the caller may retry the (independently guarded) operation. A claim
 * left by a crashed API instance expires (`claimed_until`) and can be taken over.
 */
import { createHash } from 'node:crypto';
import type { Database } from './db.js';

export type IdempotencyBegin = { kind: 'NEW' } | { kind: 'REPLAY'; response: unknown } | { kind: 'CONFLICT' } | { kind: 'IN_PROGRESS' };
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export function requestHash(scope: string, body: unknown): string {
  return createHash('sha256').update(scope).update('\0').update(JSON.stringify(body)).digest('hex');
}

export function createIdempotencyStore(input: { db: Database; tenantId: string; claimMs?: number; retentionHours?: number }) {
  const { db, tenantId } = input, claimMs = input.claimMs ?? 120_000, retention = input.retentionHours ?? 24;
  return {
    async begin(scope: string, key: string, hash: string): Promise<IdempotencyBegin> {
      if (!IDEMPOTENCY_KEY.test(key)) throw new Error('IDEMPOTENCY_KEY_INVALID');
      return db.transaction(async tx => {
        await tx.query(`DELETE FROM api_idempotency WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3 AND expires_at < now()`, [tenantId, scope, key]);
        const inserted = await tx.query(`INSERT INTO api_idempotency (tenant_id, scope, idempotency_key, request_sha256, state, claimed_until, expires_at)
          VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + make_interval(secs => $5::double precision / 1000), now() + make_interval(hours => $6))
          ON CONFLICT DO NOTHING RETURNING 1`, [tenantId, scope, key, hash, claimMs, retention]);
        if (inserted.rows.length) return { kind: 'NEW' } as const;
        const { rows } = await tx.query<{ request_sha256: string; state: string; response: unknown; expired: boolean }>(`SELECT request_sha256, state, response,
            claimed_until < now() AS expired FROM api_idempotency WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3 FOR UPDATE`, [tenantId, scope, key]);
        const row = rows[0];
        if (!row) return { kind: 'IN_PROGRESS' } as const;
        if (row.request_sha256 !== hash) return { kind: 'CONFLICT' } as const;
        if (row.state === 'COMPLETED') return { kind: 'REPLAY', response: row.response } as const;
        if (!row.expired) return { kind: 'IN_PROGRESS' } as const;
        await tx.query(`UPDATE api_idempotency SET claimed_until = now() + make_interval(secs => $4::double precision / 1000), updated_at = now()
          WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3`, [tenantId, scope, key, claimMs]);
        return { kind: 'NEW' } as const;
      });
    },
    async complete(scope: string, key: string, hash: string, response: unknown): Promise<void> {
      await db.query(`UPDATE api_idempotency SET state = 'COMPLETED', response = $5::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3 AND request_sha256 = $4 AND state = 'IN_PROGRESS'`,
      [tenantId, scope, key, hash, JSON.stringify(response)]);
    },
    async release(scope: string, key: string, hash: string): Promise<void> {
      await db.query(`DELETE FROM api_idempotency WHERE tenant_id = $1 AND scope = $2 AND idempotency_key = $3 AND request_sha256 = $4 AND state = 'IN_PROGRESS'`,
        [tenantId, scope, key, hash]);
    },
  };
}
export type IdempotencyStore = ReturnType<typeof createIdempotencyStore>;

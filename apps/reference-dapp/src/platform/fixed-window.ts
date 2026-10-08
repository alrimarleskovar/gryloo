// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: fixed-window abuse limits on PostgreSQL (`mcp_rate_limits`, migration 0005), shared by every surface (moved
 * from the MCP OAuth store, which now delegates here; same SQL, same buckets). A bucket counts hits per aligned window; correctness
 * never depends on process memory, so any serverless instance may serve any request. Bucket names are opaque ids or digests, never an
 * address or a secret.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';

export type WindowHit = { readonly allowed: boolean; readonly count: number; readonly limit: number; readonly resetAt: Date };
export function fixedWindow(db: Database, tenantId: string) {
  const hit = async (bucket: string, limit: number, windowSeconds: number, now: Date): Promise<WindowHit> => {
    const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
    const row = (await db.query<{ count: number }>(`INSERT INTO mcp_rate_limits (tenant_id, bucket, window_start, count) VALUES ($1, $2, $3, 1)
      ON CONFLICT (tenant_id, bucket, window_start) DO UPDATE SET count = mcp_rate_limits.count + 1 RETURNING count`, [tenantId, bucket, windowStart])).rows[0];
    const count = row?.count ?? Infinity;
    return { allowed: count <= limit, count, limit, resetAt: new Date(windowStart.getTime() + windowSeconds * 1000) };
  };
  /** True while `bucket` stays within `limit` per `windowSeconds`. */
  const allow = async (bucket: string, limit: number, windowSeconds: number, now: Date) => (await hit(bucket, limit, windowSeconds, now)).allowed;
  return { hit, allow };
}

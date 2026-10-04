// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant-scoped read model over the projections. Every query filters by tenant_id; history uses keyset
 * pagination on indexed columns, so no endpoint loads unbounded history into memory.
 */
import type { Database } from './db.js';

export type RunSummary = { runId: string; workflowId: string; flow: string; status: string; provenance: string; ownerAccount: string | null; errorCode: string | null;
  needsObservation: boolean; attentionRequired: boolean; hasEvidence: boolean; version: number; createdAt: string; updatedAt: string };
/** BUILD-JOURNEY-001: optional narrowing of the history to one wallet and/or one flow. */
export type RunFilter = { readonly owner?: string | null; readonly flow?: string | null };
export type Page<T> = { items: T[]; next: string | null };
const CURSOR = /^[A-Za-z0-9_-]{1,400}$/;
const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor<T>(cursor: string | null, check: (value: unknown) => value is T): T | null {
  if (cursor === null) return null;
  if (!CURSOR.test(cursor)) throw new Error('CURSOR_INVALID');
  let value: unknown; try { value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new Error('CURSOR_INVALID'); }
  if (!check(value)) throw new Error('CURSOR_INVALID');
  return value;
}
const limitOf = (limit: number | null) => { const n = limit ?? 25; if (!Number.isSafeInteger(n) || n < 1 || n > 100) throw new Error('LIMIT_INVALID'); return n; };
type RunRow = { run_id: string; workflow_id: string; flow: string; status: string; provenance: string; owner_account: string | null; error_code: string | null; needs_observation: boolean;
  attention_required: boolean; has_evidence: boolean; log_version: string; created_at: Date; updated_at: Date; updated_cursor: string; namespace: string; log_name: string };
const summary = (row: RunRow): RunSummary => ({ runId: row.run_id, workflowId: row.workflow_id, flow: row.flow, status: row.status, provenance: row.provenance,
  ownerAccount: row.owner_account, errorCode: row.error_code, needsObservation: row.needs_observation, attentionRequired: row.attention_required, hasEvidence: row.has_evidence,
  version: Number(row.log_version), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const RUN_COLUMNS = `run_id, workflow_id, flow, status, provenance, owner_account, error_code, needs_observation, attention_required, has_evidence,
  log_version::text AS log_version, created_at, updated_at, updated_at::text AS updated_cursor, namespace, log_name`;

export function createRunQueries(db: Database, tenantId: string) {
  return {
    async listRuns(cursor: string | null, limit: number | null, filter: RunFilter = {}): Promise<Page<RunSummary>> {
      const n = limitOf(limit);
      const after = decodeCursor(cursor, (v): v is [string, string] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string');
      const { rows } = await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM execution_runs WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR (updated_at, run_id) < ($2::timestamptz, $3::text))
        AND ($5::text IS NULL OR owner_account = $5) AND ($6::text IS NULL OR flow = $6)
        ORDER BY updated_at DESC, run_id DESC LIMIT $4`, [tenantId, after?.[0] ?? null, after?.[1] ?? null, n + 1, filter.owner ?? null, filter.flow ?? null]);
      const items = rows.slice(0, n), last = rows.length > n ? rows[n - 1] : undefined;
      return { items: items.map(summary), next: last ? encodeCursor([last.updated_cursor, last.run_id]) : null };
    },
    async getRun(runId: string): Promise<(RunSummary & { namespace: string; logName: string; attempts: unknown[] }) | null> {
      const { rows } = await db.query<RunRow>(`SELECT ${RUN_COLUMNS} FROM execution_runs WHERE tenant_id = $1 AND run_id = $2`, [tenantId, runId]);
      const row = rows[0];
      if (!row) return null;
      const attempts = await db.query(`SELECT attempt_id AS "attemptId", step, state, nonce, transaction_hash AS "transactionHash",
          prepared_at_block::text AS "preparedAtBlock", reconciled, updated_at AS "updatedAt"
        FROM execution_attempts WHERE tenant_id = $1 AND run_id = $2 ORDER BY created_at, attempt_id`, [tenantId, runId]);
      return { ...summary(row), namespace: row.namespace, logName: row.log_name, attempts: attempts.rows };
    },
    async journal(runId: string, afterSequence: number | null, limit: number | null): Promise<Page<Record<string, unknown>>> {
      const n = limitOf(limit), after = afterSequence ?? -1;
      if (!Number.isSafeInteger(after) || after < -1) throw new Error('CURSOR_INVALID');
      const { rows } = await db.query<{ sequence: number }>(`SELECT sequence, entry_hash AS "entryHash", level, entity_id AS "entityId",
          attempt_id AS "attemptId", from_state AS "fromState", to_state AS "toState", recorded_at AS "recordedAt"
        FROM journal_entries WHERE tenant_id = $1 AND run_id = $2 AND sequence > $3 ORDER BY sequence LIMIT $4`, [tenantId, runId, after, n + 1]);
      const items = rows.slice(0, n);
      return { items, next: rows.length > n ? String(items.at(-1)!.sequence) : null };
    },
    async evidence(runId: string) {
      const { rows } = await db.query<{ bundle_hash: string; content_sha256: string; byte_length: string; object_key: string; store_id: string;
        environment: string; outcome: string; created_at: Date }>(`SELECT bundle_hash, content_sha256, byte_length::text AS byte_length, object_key, store_id,
          environment, outcome, created_at FROM evidence_objects WHERE tenant_id = $1 AND run_id = $2 ORDER BY created_at`, [tenantId, runId]);
      return rows.map(r => ({ bundleHash: r.bundle_hash, sha256: r.content_sha256, byteLength: Number(r.byte_length), key: r.object_key, storeId: r.store_id,
        environment: r.environment, outcome: r.outcome, createdAt: r.created_at.toISOString() }));
    },
    async recordEvidence(runId: string, input: { bundleHash: string; sha256: string; byteLength: number; key: string; storeId: string; environment: string; outcome: string }) {
      await db.query(`INSERT INTO evidence_objects (tenant_id, run_id, bundle_hash, content_sha256, byte_length, media_type, store_id, object_key, environment, outcome)
        VALUES ($1, $2, $3, $4, $5, 'application/json', $6, $7, $8, $9) ON CONFLICT (tenant_id, run_id, bundle_hash) DO NOTHING`,
      [tenantId, runId, input.bundleHash, input.sha256, input.byteLength, input.storeId, input.key, input.environment, input.outcome]);
      // An existing row must describe the same bytes; evidence metadata is never rewritten.
      const { rows } = await db.query(`SELECT 1 FROM evidence_objects WHERE tenant_id = $1 AND run_id = $2 AND bundle_hash = $3 AND content_sha256 = $4`,
        [tenantId, runId, input.bundleHash, input.sha256]);
      if (!rows.length) throw new Error('EVIDENCE_METADATA_CONFLICT');
    },
  };
}
export type RunQueries = ReturnType<typeof createRunQueries>;

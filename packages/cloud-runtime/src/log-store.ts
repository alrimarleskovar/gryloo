// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PostgreSQL implementation of the executor's DurableLogStore port (ExecutionStore + JournalStore).
 *
 * Semantics are those of the file store, enforced inside one short transaction per write:
 *  - the log row is locked FOR UPDATE, the stored bytes are re-read and integrity-checked (length, SHA-256);
 *  - `next` must strictly extend them (a stale writer fails with JOURNAL_CORRUPT, exactly as on disk);
 *  - the flow validator must accept prior and next bytes;
 *  - every lease held by the caller is re-verified (fencing), then one immutable segment is appended and the
 *    aggregate version incremented (explicit CAS for `extendAt`);
 *  - the flow projector's run/attempt/journal rows and any durable work (transactional outbox) are written in
 *    the SAME transaction, so a crash can never separate state from the work it requires. An already queued
 *    item is never duplicated, but a more urgent state (e.g. a known hash) brings it forward.
 */
import { createHash } from 'node:crypto';
import { assertLogName, type DurableLogStore, type LogValidator } from '@defi-workflow-engine/reference-executor';
import type { Database, Queryable } from './db.js';
import { assertHeldLeases } from './leases.js';
import { currentTraceparent } from './telemetry.js';

export const MAX_LOG_BYTES = 16_777_216;
export type AttemptProjection = { readonly attemptId: string; readonly step: string; readonly state: string; readonly nonce: string | null;
  readonly transactionHash: string | null; readonly preparedAtBlock: number | null; readonly reconciled: boolean };
export type JournalProjection = { readonly sequence: number; readonly entryHash: string; readonly level: string; readonly entityId: string;
  readonly attemptId: string | null; readonly fromState: string | null; readonly toState: string; readonly recordedAt: string };
export type RunProjection = { readonly runId: string; readonly workflowId: string; readonly flow: string; readonly status: string;
  readonly provenance: 'MOCKED' | 'PUBLIC_TESTNET'; readonly ownerAccount: string | null; readonly recoveryOf: string | null;
  readonly errorCode: string | null; readonly needsObservation: boolean; readonly hasEvidence: boolean;
  readonly attempts: readonly AttemptProjection[]; readonly journal: readonly JournalProjection[] };
export type WorkRequest = { readonly kind: string; readonly dedupeKey: string; readonly runId: string | null; readonly delayMs?: number;
  readonly payload?: Readonly<Record<string, string>> };
export type Projection = { readonly run: RunProjection; readonly work: readonly WorkRequest[] };
/** Derives the queryable projection of a run log. Throwing rolls the write back (fail closed). */
export type Projector = (name: string, bytes: Uint8Array) => Projection | null;

export type PostgresLogStore = DurableLogStore & {
  readonly readVersioned: (name: string) => Promise<{ bytes: Uint8Array; version: number } | null>;
  /** Explicit compare-and-swap: also fails with EXECUTION_VERSION_CONFLICT unless the stored version equals `expectedVersion`. */
  readonly extendAt: (name: string, expectedVersion: number, next: Uint8Array, validate: LogValidator) => Promise<number>;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const CODED = /^(JOURNAL_CORRUPT|EXECUTION_[A-Z_]+|STORAGE_[A-Z_]+)$/;
const coded = (error: unknown, fallback: string): Error =>
  error instanceof Error && CODED.test(error.message) ? error : new Error(fallback, { cause: error });

type LogRow = { version: string; segment_count: number; byte_length: number; content_sha256: string };
type SegmentRow = LogRow & { seq: number; bytes: Buffer };
function assemble(rows: readonly SegmentRow[]): { bytes: Uint8Array; version: number } | null {
  const head = rows[0];
  if (!head) return null;
  if (rows.length !== head.segment_count || rows.some((row, index) => row.seq !== index)) throw new Error('JOURNAL_CORRUPT');
  const bytes = new Uint8Array(Buffer.concat(rows.map(row => row.bytes)));
  if (bytes.length !== head.byte_length || sha256(bytes) !== head.content_sha256) throw new Error('JOURNAL_CORRUPT');
  return { bytes, version: Number(head.version) };
}
const SELECT_LOG = `SELECT l.version::text AS version, l.segment_count, l.byte_length, l.content_sha256, s.seq, s.bytes
  FROM execution_logs l JOIN execution_log_segments s USING (tenant_id, namespace, name)
  WHERE l.tenant_id = $1 AND l.namespace = $2 AND l.name = $3 ORDER BY s.seq`;

export function createPostgresLogStore(input: { db: Database; tenantId: string; namespace: string; projector?: Projector }): PostgresLogStore {
  const { db, tenantId, namespace } = input;
  const kind = (name: string) => name.endsWith('.jsonl') ? 'RUN' : 'INTENT';

  async function project(tx: Queryable, name: string, bytes: Uint8Array, version: number): Promise<void> {
    const projection = input.projector?.(name, bytes);
    if (!projection) return;
    const run = projection.run;
    await tx.query(`INSERT INTO workflows (tenant_id, workflow_id) VALUES ($1, $2)
      ON CONFLICT (tenant_id, workflow_id) DO UPDATE SET last_seen_at = now()`, [tenantId, run.workflowId]);
    const updated = await tx.query(`INSERT INTO execution_runs (tenant_id, run_id, namespace, log_name, workflow_id, flow, status, provenance,
        owner_account, recovery_of, error_code, needs_observation, has_evidence, log_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (tenant_id, run_id) DO UPDATE SET status = EXCLUDED.status, error_code = EXCLUDED.error_code,
        needs_observation = EXCLUDED.needs_observation, has_evidence = EXCLUDED.has_evidence, log_version = EXCLUDED.log_version, updated_at = now()
      WHERE execution_runs.namespace = EXCLUDED.namespace AND execution_runs.log_name = EXCLUDED.log_name
        AND execution_runs.workflow_id = EXCLUDED.workflow_id AND execution_runs.flow = EXCLUDED.flow
        AND execution_runs.provenance = EXCLUDED.provenance AND execution_runs.recovery_of IS NOT DISTINCT FROM EXCLUDED.recovery_of
      RETURNING 1`, [tenantId, run.runId, namespace, name, run.workflowId, run.flow, run.status, run.provenance,
      run.ownerAccount, run.recoveryOf, run.errorCode, run.needsObservation, run.hasEvidence, version]);
    if (updated.rows.length !== 1) throw new Error('EXECUTION_PROJECTION_CONFLICT');
    if (run.attempts.length) {
      const a = run.attempts;
      const attempts = await tx.query(`INSERT INTO execution_attempts (tenant_id, attempt_id, run_id, step, state, nonce, transaction_hash, prepared_at_block, reconciled)
        SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::boolean[])
        ON CONFLICT (tenant_id, attempt_id) DO UPDATE SET state = EXCLUDED.state, transaction_hash = EXCLUDED.transaction_hash,
          reconciled = EXCLUDED.reconciled, updated_at = now()
        WHERE execution_attempts.run_id = EXCLUDED.run_id AND execution_attempts.step = EXCLUDED.step
          AND execution_attempts.nonce IS NOT DISTINCT FROM EXCLUDED.nonce
          AND (execution_attempts.transaction_hash IS NULL OR execution_attempts.transaction_hash = EXCLUDED.transaction_hash)
          AND (NOT execution_attempts.reconciled OR EXCLUDED.reconciled)
        RETURNING 1`, [tenantId, a.map(x => x.attemptId), a.map(() => run.runId), a.map(x => x.step), a.map(x => x.state),
        a.map(x => x.nonce), a.map(x => x.transactionHash), a.map(x => x.preparedAtBlock), a.map(x => x.reconciled)]);
      if (attempts.rows.length !== a.length) throw new Error('EXECUTION_PROJECTION_CONFLICT');
    }
    if (run.journal.length) {
      const j = run.journal;
      await tx.query(`INSERT INTO journal_entries (tenant_id, run_id, sequence, entry_hash, level, entity_id, attempt_id, from_state, to_state, recorded_at)
        SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::timestamptz[])
        ON CONFLICT (tenant_id, run_id, sequence) DO NOTHING`, [tenantId, run.runId, j.map(x => x.sequence), j.map(x => x.entryHash),
        j.map(x => x.level), j.map(x => x.entityId), j.map(x => x.attemptId), j.map(x => x.fromState), j.map(x => x.toState), j.map(x => x.recordedAt)]);
      // Journal history is immutable: the stored hash chain must equal the snapshot's.
      const stored = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM journal_entries j
        JOIN unnest($3::int[], $4::text[]) AS s(sequence, entry_hash) ON j.sequence = s.sequence
        WHERE j.tenant_id = $1 AND j.run_id = $2 AND j.entry_hash = s.entry_hash`, [tenantId, run.runId, j.map(x => x.sequence), j.map(x => x.entryHash)]);
      if (Number(stored.rows[0]?.n) !== j.length) throw new Error('EXECUTION_PROJECTION_CONFLICT');
    }
    const trace = currentTraceparent();
    for (const work of projection.work) {
      await tx.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at, trace_parent)
        VALUES ($1, $2, $3, $4, $5::jsonb, 'READY', now() + make_interval(secs => $6::double precision / 1000), $7)
        ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED')
        DO UPDATE SET available_at = LEAST(work_items.available_at, EXCLUDED.available_at), updated_at = now()
        WHERE work_items.state = 'READY' AND EXCLUDED.available_at < work_items.available_at`,
      [tenantId, work.kind, work.dedupeKey, work.runId, JSON.stringify(work.payload ?? {}), work.delayMs ?? 0, trace]);
    }
  }

  async function write(name: string, next: Uint8Array, validate: LogValidator | null, expectedVersion: number | null, createOnly: boolean): Promise<number | false> {
    assertLogName(name);
    if (!(next instanceof Uint8Array) || next.length === 0 || next.length > MAX_LOG_BYTES) throw new Error('JOURNAL_CORRUPT');
    try {
      return await db.transaction(async tx => {
        await assertHeldLeases(tx, tenantId);
        const locked = await tx.query<LogRow>(`SELECT version::text AS version, segment_count, byte_length, content_sha256 FROM execution_logs
          WHERE tenant_id = $1 AND namespace = $2 AND name = $3 FOR UPDATE`, [tenantId, namespace, name]);
        const row = locked.rows[0];
        if (createOnly && row) return false;
        const prior = row ? assemble((await tx.query<SegmentRow>(SELECT_LOG, [tenantId, namespace, name])).rows) : null;
        if (row && !prior) throw new Error('JOURNAL_CORRUPT');
        const priorBytes = prior?.bytes ?? new Uint8Array();
        if (next.length <= priorBytes.length || !priorBytes.every((byte, index) => byte === next[index])) throw new Error('JOURNAL_CORRUPT');
        if (expectedVersion !== null && (prior?.version ?? 0) !== expectedVersion) throw new Error('EXECUTION_VERSION_CONFLICT');
        if (validate) {
          try { if (priorBytes.length) validate(priorBytes); validate(next); }
          catch (cause) { throw new Error('JOURNAL_CORRUPT', { cause }); }
        }
        const version = (prior?.version ?? 0) + 1, content = sha256(next), segment = next.subarray(priorBytes.length);
        if (!row) {
          const inserted = await tx.query(`INSERT INTO execution_logs (tenant_id, namespace, name, kind, version, segment_count, byte_length, content_sha256)
            VALUES ($1, $2, $3, $4, 1, 1, $5, $6) ON CONFLICT DO NOTHING RETURNING 1`, [tenantId, namespace, name, kind(name), next.length, content]);
          // A concurrent first writer won: this writer's bytes were computed against an empty log.
          if (!inserted.rows.length) { if (createOnly) return false; throw new Error('JOURNAL_CORRUPT'); }
        } else {
          const bumped = await tx.query(`UPDATE execution_logs SET version = version + 1, segment_count = segment_count + 1, byte_length = $5,
              content_sha256 = $6, updated_at = now() WHERE tenant_id = $1 AND namespace = $2 AND name = $3 AND version = $4 RETURNING 1`,
          [tenantId, namespace, name, prior!.version, next.length, content]);
          if (!bumped.rows.length) throw new Error('EXECUTION_VERSION_CONFLICT');
        }
        await tx.query(`INSERT INTO execution_log_segments (tenant_id, namespace, name, seq, bytes, segment_sha256, content_sha256)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [tenantId, namespace, name, version - 1, Buffer.from(segment), sha256(segment), content]);
        await project(tx, name, next, version);
        return version;
      });
    } catch (error) { throw coded(error, 'JOURNAL_WRITE_FAILED'); }
  }

  const readVersioned = async (name: string) => {
    assertLogName(name);
    let rows: SegmentRow[];
    try { rows = (await db.query<SegmentRow>(SELECT_LOG, [tenantId, namespace, name])).rows; }
    catch (cause) { throw new Error('STORAGE_UNAVAILABLE', { cause }); }
    return assemble(rows);
  };
  return {
    readVersioned,
    read: async name => (await readVersioned(name))?.bytes ?? null,
    extend: async (name, next, validate) => { await write(name, next, validate, null, false); },
    extendAt: async (name, expectedVersion, next, validate) => write(name, next, validate, expectedVersion, false) as Promise<number>,
    create: async (name, bytes) => (await write(name, bytes, null, null, true)) !== false,
  };
}

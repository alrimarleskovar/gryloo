// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createLogger, createPostgresWorkQueue, createWorker } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { tempoFixture, tempoOwner, tempoWorkflow, signMockTempo } from '../../../packages/reference-compiler/test/tempo-fixture.ts';
import type { TempoRecord } from '../src/server/tempo-service.ts';
import type { TempoTransaction } from '@defi-workflow-engine/reference-compiler';
import { createBackend, type FlowResult } from './app.ts';
const ok = <T,>(r: FlowResult): T => { if (!r.ok) throw new Error(r.code); return r.value as T; };
describe('Tempo on the generic PostgreSQL runtime', () => {
  it('survives API/browser loss, workers reconcile and archive evidence, and concurrent runs cannot reuse nonce', async () => {
    const db = await createTestDatabase(), fixture = tempoFixture(), workflow = tempoWorkflow();
    const evidenceStore = createFilesystemEvidenceStore(await mkdtemp(join(tmpdir(), 'tempo-pg-evidence-')));
    const logger = createLogger({ service: 'test', sink: () => undefined });
    const env = { NODE_ENV: 'test', GRYLOO_TEMPO_HARNESS: 'MOCKED_IN_PROCESS_ONLY' };
    const open = (holderId: string) => createBackend({ db: db.open(), tenantId: 'default', holderId, env, logger, evidenceStore, rpc: { 'tempo-payment': fixture.rpc }, busyRetries: 3 });
    try {
      const api = open('tempo-api-one');
      const run = ok<TempoRecord>(await api.callFlow('tempo-payment', 'simulate', [workflow, tempoOwner]));
      ok(await api.callFlow('tempo-payment', 'review', [run.id, run.review.commitment, workflow]));
      const other = ok<TempoRecord>(await api.callFlow('tempo-payment', 'simulate', [workflow, tempoOwner]));
      ok(await api.callFlow('tempo-payment', 'review', [other.id, other.review.commitment, workflow]));
      const results = await Promise.all([api.callFlow('tempo-payment', 'begin', [run.id, tempoOwner, workflow]),
        open('tempo-api-two').callFlow('tempo-payment', 'begin', [other.id, tempoOwner, workflow])]);
      expect(results.filter(r => r.ok)).toHaveLength(1);
      expect(results.find(r => !r.ok)).toMatchObject({ code: 'TEMPO_NONCE_RESERVED' });
      const prepared = ok<{ record: TempoRecord; transaction: TempoTransaction }>(results.find(r => r.ok)!);
      const id = prepared.record.id, signed = signMockTempo(prepared.transaction);
      ok(await open('tempo-handoff').callFlow('tempo-payment', 'handoff', [id, signed.hash, workflow]));
      fixture.mine(prepared.transaction); // MOCKED wallet only; report response and browser deliberately lost.
      const backend = open('tempo-worker');
      const worker = createWorker({ queue: createPostgresWorkQueue({ db: db.db, ownerId: 'tempo-worker' }), handlers: backend.handlers, logger, workerId: 'tempo-worker', concurrency: 2 });
      await db.db.query("UPDATE work_items SET available_at = now() WHERE state = 'READY'");
      expect(await worker.drainOnce()).toBeGreaterThan(0); await worker.drainOnce();
      const restored = ok<TempoRecord>(await open('tempo-api-restored').callFlow('tempo-payment', 'status', [id]));
      expect(restored).toMatchObject({ verdict: 'RECONCILED', attempt: { transactionHash: signed.hash, reconciled: true }, evidence: { bundle: { environment: 'MOCKED' } } });
      const rows = await db.db.query('SELECT status, has_evidence, needs_observation FROM execution_runs WHERE run_id = $1', [id]);
      expect(rows.rows[0]).toEqual({ status: 'RECONCILED', has_evidence: true, needs_observation: false });
      const route = backend.routes.find(r => r.name === 'run.evidence')!;
      const response = await route.handler({ method: 'GET', path: `/v1/runs/${id}/evidence`, query: new URLSearchParams(), headers: {}, body: null, requestId: 'tempo-test' }, route.pattern.exec(`/v1/runs/${id}/evidence`)!);
      expect(response.body).toMatchObject({ value: [{ verified: true, bundleHash: restored.evidence!.bundleHash }] });
      expect(fixture.calls.some(m => /sign|send|fund/i.test(m))).toBe(false);
      const journal = await db.db.query<{ to_state: string }>("SELECT to_state FROM journal_entries WHERE run_id = $1 AND level = 'attempt' ORDER BY sequence", [id]);
      expect(journal.rows.map(x => x.to_state)).toEqual(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']);
    } finally { await db.drop(); }
  });
});

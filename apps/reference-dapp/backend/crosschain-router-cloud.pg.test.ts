// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 Cross-chain Router on the BUILD-CLOUD-001 runtime: PostgreSQL state, fenced leases, outbox, worker
 * reconciliation of BOTH chains and EvidenceStore, with MOCKED in-process Base/Arbitrum chains and loopback providers. The
 * only "wallet" is the test calling `h.wallet.send`; the backend and workers have no send path.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createLogger, createPostgresWorkQueue, createWorker, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { editorReducer, initialEditor } from '../src/domain/editor.ts';
import type { RouterBegin, RouterRecord } from '../src/server/router-service.ts';
import { createRouterHarness, ROUTER_OWNER, type RouterHarness } from '../e2e/router-harness.ts';
import { createBackend, type FlowResult } from './app.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const env = { GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY' } as const;
const SEND = ['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction'];
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }
function workflow(): SemanticWorkflow {
  const result = editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input: { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '10', recipient: '',
    slippage: '50', routing: 'AUTO' }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('tenant-b')`); });
afterAll(async () => { await t?.drop(); });
/** One fresh API + worker "process" sharing the database; every RPC method it uses (both chains) is recorded. */
async function deployment(h: RouterHarness, options: { tenantId?: string; evidenceDir?: string } = {}) {
  const methods: string[] = [];
  const source = (method: string, params: readonly unknown[]) => { methods.push(method); return h.baseRpc(method, params); };
  const destination = (method: string, params: readonly unknown[]) => { methods.push(method); return h.arbitrumRpc(method, params); };
  const db: Database = t.open(6), workerId = `worker-${Math.random().toString(16).slice(2, 8)}`;
  const evidenceDir = options.evidenceDir ?? await mkdtemp(join(tmpdir(), 'flofi-router-evidence-'));
  const backend = createBackend({ db, env, logger: quiet, tenantId: options.tenantId ?? 'default', holderId: workerId, evidenceStore: createFilesystemEvidenceStore(evidenceDir),
    rpc: { 'crosschain-router': source }, router: { destinationRpc: destination, providers: h.providers }, busyRetries: 3 });
  const worker = createWorker({ queue: createPostgresWorkQueue({ db, ownerId: workerId }), handlers: backend.handlers, logger: quiet, workerId, concurrency: 8 });
  return { db, backend, worker, evidenceDir, methods, call: (method: string, ...args: unknown[]) => backend.callFlow('crosschain-router', method, args) };
}
const due = (db: Database) => db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY'`);
async function drain(h: RouterHarness, d: Awaited<ReturnType<typeof deployment>>, id: string, until: RouterRecord['phase'], rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await due(d.db); await d.worker.drainOnce();
    const run = ok<RouterRecord>(await d.call('status', id));
    if (run.phase === until) return run;
    h.advance(5);
  }
  return ok<RouterRecord>(await d.call('status', id));
}

describe('BUILD-ROUTER-001 router on durable cloud state (MOCKED Base / Arbitrum)', () => {
  it('approval and deposit through the API; fresh workers reconcile source and destination after browser loss and restarts; verified evidence', async () => {
    const h = createRouterHarness({ nonce: 40n }), w = workflow();
    const api1 = await deployment(h);
    expect(ok<string>(await api1.call('mode'))).toBe('harness');
    expect(ok<{ executionEnabled: boolean }>(await api1.call('info'))).toEqual({ executionEnabled: true });
    const run = ok<RouterRecord>(await api1.call('simulate', w, ROUTER_OWNER)), id = run.id;
    ok(await api1.call('review', id, run.review.commitment, w));
    const approval = ok<RouterBegin>(await api1.call('begin', id, ROUTER_OWNER, w));
    expect(approval.attempt.step).toBe('APPROVAL');
    const api1b = await deployment(h, { evidenceDir: api1.evidenceDir });
    expect(await api1b.call('begin', id, ROUTER_OWNER, w)).toEqual({ ok: false, code: 'ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING' });
    ok(await api1.call('handoff', id));
    const hash = h.wallet.send(approval.transaction);
    ok(await api1.call('report', id, { kind: 'HASH', hash }));
    ok(await api1b.call('report', id, { kind: 'HASH', hash }));
    const worker1 = await deployment(h, { evidenceDir: api1.evidenceDir });
    await due(worker1.db); await worker1.worker.drainOnce();
    const api2 = await deployment(h, { evidenceDir: api1.evidenceDir });
    const deposit = ok<RouterBegin>(await api2.call('begin', id, ROUTER_OWNER, w));
    expect(deposit.attempt.step).toBe('DEPOSIT');
    ok(await api2.call('handoff', id));
    h.wallet.send(deposit.transaction);                  // the browser closes before reporting the deposit hash
    const worker2 = await deployment(h, { evidenceDir: api1.evidenceDir });
    const final = await drain(h, worker2, id, 'RECONCILED');
    expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });
    expect(final.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
    await due(worker2.db); await worker2.worker.drainOnce();            // the outbox archives the Evidence Bundle
    expect(h.counters.sends).toBe(2);
    for (const d of [worker1, worker2]) expect(d.methods.filter(m => SEND.includes(m))).toEqual([]);
    const projected = await t.db.query(`SELECT status, provenance, needs_observation, has_evidence, owner_account FROM execution_runs WHERE run_id = $1`, [id]);
    expect(projected.rows[0]).toEqual({ status: 'RECONCILED', provenance: 'MOCKED', needs_observation: false, has_evidence: true, owner_account: ROUTER_OWNER });
    const attempts = await t.db.query(`SELECT step, state, reconciled, nonce FROM execution_attempts WHERE run_id = $1 ORDER BY attempt_id`, [id]);
    expect(attempts.rows).toEqual([{ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true, nonce: '40' }, { step: 'DEPOSIT', state: 'CONFIRMED', reconciled: true, nonce: '41' }]);
    const route = api2.backend.routes.find(r => r.name === 'run.evidence')!;
    const response = await route.handler({ method: 'GET', path: `/v1/runs/${id}/evidence`, query: new URLSearchParams(), headers: {}, body: null, requestId: 'x' },
      route.pattern.exec(`/v1/runs/${id}/evidence`)!);
    expect((response.body as { value: { verified: boolean; bundleHash: string }[] }).value).toEqual([expect.objectContaining({ verified: true, bundleHash: final.evidence!.bundleHash })]);
  });
  it('a bridge in flight stays observed by workers until the destination fill appears; tenants are isolated; a stale item never cancels PREPARED', async () => {
    const h = createRouterHarness({ nonce: 7n, autoFillSeconds: null }), w = workflow(), d = await deployment(h);
    const run = ok<RouterRecord>(await d.call('simulate', w, ROUTER_OWNER)), id = run.id;
    ok(await d.call('review', id, run.review.commitment, w));
    for (const step of ['APPROVAL', 'DEPOSIT']) {
      const begun = ok<RouterBegin>(await d.call('begin', id, ROUTER_OWNER, w));
      expect(begun.attempt.step).toBe(step);
      if (step === 'DEPOSIT') {
        // An old queued item re-checks under the run lease and leaves the PREPARED deposit untouched.
        await d.db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state) VALUES ('default', 'reconcile', $1, $2, $3::jsonb, 'READY')
          ON CONFLICT DO NOTHING`, [`crosschain-router:${id}`, id, JSON.stringify({ namespace: 'crosschain-router', runId: id })]);
        await d.worker.drainOnce();
        expect(ok<RouterRecord>(await d.call('status', id)).attempts.at(-1)!.state).toBe('PREPARED');
      }
      ok(await d.call('handoff', id));
      ok(await d.call('report', id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) }));
      await due(d.db); await d.worker.drainOnce();
    }
    const inFlight = await drain(h, d, id, 'RECONCILED', 4);
    expect(inFlight).toMatchObject({ phase: 'IN_FLIGHT', verdict: 'PENDING' });
    const pending = await t.db.query(`SELECT needs_observation, status FROM execution_runs WHERE run_id = $1`, [id]);
    expect(pending.rows[0]).toEqual({ needs_observation: true, status: 'IN_FLIGHT' });
    const other = await deployment(h, { tenantId: 'tenant-b' });
    expect(await other.call('status', id)).toEqual({ ok: false, code: 'ROUTER_RUN_NOT_FOUND' });
    h.relayer.fill();
    expect((await drain(h, d, id, 'RECONCILED')).phase).toBe('RECONCILED');
    expect(d.methods.filter(m => SEND.includes(m))).toEqual([]);
  });
});

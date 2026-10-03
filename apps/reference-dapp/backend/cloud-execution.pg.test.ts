// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 end-to-end durability and concurrency on PostgreSQL. The UNCHANGED Robinhood transfer and
 * Aave Supply services run behind the cloud API and worker against MOCKED in-process chains: no public network
 * and no real broadcast. The only "wallet" is the test calling MOCK_submit, exactly as the existing suites do.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createHttpServer, createLogger, createPostgresWorkQueue, createWorker, sweep, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createNativeTransferNode, createSupplyNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as aave } from '@defi-workflow-engine/action-registry';
import { verifyArchivedNativeTransfer, type ArchivedTransfer } from '@defi-workflow-engine/reference-reconciler';
import { createRobinhoodTransferChain, TRANSFER_OWNER as owner } from '../e2e/robinhood-transfer-harness.mjs';
import { supplyModel, SUPPLY_OWNER } from '../e2e/supply-fixtures';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { callCloudFlow } from '../src/server/cloud-api-client.ts';
import type { TransferRecord } from '../src/server/robinhood-transfer-service.ts';
import type { SupplyRecord } from '../src/server/supply-service.ts';
import { createBackend, type FlowResult } from './app.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const env = { GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_SUPPLY_HARNESS: 'MOCKED_LOOPBACK_ONLY' } as const;
const transferWorkflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'rh-demo', revision: 1, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain: 'eip155:46630', amount: '1000000000000', recipient: 'CONNECTED_OWNER' })] };
const supplyWorkflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'supply', revision: 0, resourceEdges: [],
  nodes: [createSupplyNode('supply', { chain: aave.chain, asset: { chainId: aave.chain, address: aave.asset, decimals: 6 }, amount: '10000000', beneficiary: SUPPLY_OWNER })] };
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('tenant-b')`); });
afterAll(async () => { await t?.drop(); });

// Owner nonces are global economic identities in the shared database: each scenario uses its own.
let nextNonce = 100;
const freshChain = () => createRobinhoodTransferChain({ nonce: nextNonce++ });
/** One "deployment": API backend + worker sharing a database; each call builds fresh processes' worth of state. */
async function deployment(options: { db?: Database; chain?: ReturnType<typeof createRobinhoodTransferChain>; model?: ReturnType<typeof supplyModel>; tenantId?: string; evidenceDir?: string } = {}) {
  const chain = options.chain ?? freshChain(), model = options.model ?? supplyModel();
  const evidenceDir = options.evidenceDir ?? await mkdtemp(join(tmpdir(), 'flofi-cloud-evidence-'));
  const db = options.db ?? t.open(6), tenantId = options.tenantId ?? 'default', workerId = `worker-${Math.random().toString(16).slice(2, 8)}`;
  const backend = createBackend({ db, env, logger: quiet, tenantId, holderId: workerId, evidenceStore: createFilesystemEvidenceStore(evidenceDir),
    rpc: { 'robinhood-transfer': chain.rpc, 'aave-supply': model.rpc }, busyRetries: 3 });
  const worker = createWorker({ queue: createPostgresWorkQueue({ db, ownerId: workerId }), handlers: backend.handlers, logger: quiet, workerId, concurrency: 8 });
  const rh = (method: string, ...args: unknown[]) => backend.callFlow('robinhood-transfer', method, args);
  const sp = (method: string, ...args: unknown[]) => backend.callFlow('aave-supply', method, args);
  return { chain, model, db, backend, worker, rh, sp, evidenceDir };
}
/** Time travel for queued work: make every READY item due now. */
const due = (db: Database) => db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY'`);
async function reviewedTransfer(d: Awaited<ReturnType<typeof deployment>>) {
  const simulated = ok<TransferRecord>(await d.rh('simulate', transferWorkflow, owner));
  return ok<TransferRecord>(await d.rh('review', simulated.id, simulated.review.commitment, transferWorkflow));
}

describe('BUILD-CLOUD-001 Robinhood transfer on durable cloud state', () => {
  it('full journey: owner-signed submission, worker reconciliation after browser loss, evidence archived and verifiable', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    const begin = ok<{ record: TransferRecord; transaction: Record<string, string> }>(await d.rh('begin', record.id, owner, transferWorkflow));
    expect(begin.record.attempt?.state).toBe('PREPARED');
    ok(await d.rh('handoff', record.id));
    const hash = await d.chain.rpc('MOCK_submit', [begin.transaction]) as string;     // the owner's wallet, the only submitter
    ok(await d.rh('report', record.id, { kind: 'HASH', hash }));
    // The browser disappears here. Nothing in memory matters: a fresh worker process reconciles from PostgreSQL.
    const later = await deployment({ chain: d.chain, model: d.model, evidenceDir: d.evidenceDir });
    await due(later.db);
    expect(await later.worker.drainOnce()).toBeGreaterThanOrEqual(1);
    await later.worker.drainOnce(); // evidence.archive enqueued by the reconciled snapshot
    // A browser reload on another machine (fresh API instance) restores the state from the cloud.
    const restored = ok<TransferRecord>(await (await deployment({ chain: d.chain, evidenceDir: d.evidenceDir })).rh('status', record.id));
    expect(restored).toMatchObject({ verdict: 'RECONCILED', attempt: { state: 'CONFIRMED', reconciled: true, transactionHash: hash } });
    expect(d.chain.transactions).toHaveLength(1);
    const verification = await verifyArchivedNativeTransfer(restored.evidence as unknown as ArchivedTransfer, d.chain.rpc as never, { expectedEnvironment: 'MOCKED' });
    expect(verification).toMatchObject({ status: 'INDEPENDENTLY_RECONCILED', economicSubmissions: 1 });
    // Projections: run, attempt and the full hash-chained journal are queryable without reading the log.
    const run = await t.db.query(`SELECT status, needs_observation, has_evidence, owner_account FROM execution_runs WHERE run_id = $1`, [record.id]);
    expect(run.rows[0]).toEqual({ status: 'RECONCILED', needs_observation: false, has_evidence: true, owner_account: owner.toLowerCase() });
    const journal = await t.db.query<{ to_state: string }>(`SELECT to_state FROM journal_entries WHERE run_id = $1 AND level = 'attempt' ORDER BY sequence`, [record.id]);
    expect(journal.rows.map(r => r.to_state)).toEqual(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']);
    // Evidence object: content-addressed, integrity verified against PostgreSQL metadata.
    const routes = d.backend.routes, evidenceRoute = routes.find(r => r.name === 'run.evidence')!;
    const response = await evidenceRoute.handler({ method: 'GET', path: `/v1/runs/${record.id}/evidence`, query: new URLSearchParams(), headers: {}, body: null, requestId: 'x' },
      evidenceRoute.pattern.exec(`/v1/runs/${record.id}/evidence`)!);
    const items = (response.body as { value: { verified: boolean; bundleHash: string; content: { bundleHash: string } }[] }).value;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ verified: true, bundleHash: restored.evidence!.bundleHash, content: { bundleHash: restored.evidence!.bundleHash } });
  });

  it('unknown submission: the worker discovers the owner transaction by nonce and never resubmits', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    const begin = ok<{ transaction: Record<string, string> }>(await d.rh('begin', record.id, owner, transferWorkflow));
    ok(await d.rh('handoff', record.id));
    await d.chain.rpc('MOCK_submit', [begin.transaction]);
    const unknown = ok<TransferRecord>(await d.rh('report', record.id, { kind: 'UNKNOWN', code: 'TRANSFER_SUBMISSION_UNKNOWN' }));
    expect(unknown.attempt?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    // A new attempt for the same run/nonce is refused: observation only.
    expect(await d.rh('begin', record.id, owner, transferWorkflow)).toEqual({ ok: false, code: 'TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY' });
    await due(d.db); await d.worker.drainOnce();
    const result = ok<TransferRecord>(await d.rh('status', record.id));
    expect(result).toMatchObject({ verdict: 'RECONCILED', attempt: { state: 'CONFIRMED', reconciled: true } });
    expect(d.chain.transactions).toHaveLength(1);
  });

  it('idempotent HTTP API: a retried request replays, a reused key with a different body is rejected; the BFF client round-trips', async () => {
    const d = await deployment(), token = 'test-token-'.padEnd(40, 'x');
    const server = createHttpServer({ routes: d.backend.routes, logger: quiet, authToken: token });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const post = (method: string, args: unknown[], key?: string, auth = token) => fetch(`${base}/v1/flows/robinhood-transfer/${method}`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}`, ...key ? { 'idempotency-key': key } : {} }, body: JSON.stringify({ args }) });
      expect((await post('simulate', [transferWorkflow, owner], undefined, 'wrong')).status).toBe(401);
      const first = await (await post('simulate', [transferWorkflow, owner], 'sim-key-0001')).json() as { ok: true; value: TransferRecord };
      const replay = await (await post('simulate', [transferWorkflow, owner], 'sim-key-0001')).json() as { ok: true; value: TransferRecord };
      expect(replay.value.id).toBe(first.value.id);   // no duplicate run from a retried request
      const conflict = await post('simulate', [{ ...transferWorkflow, revision: 2 }, owner], 'sim-key-0001');
      expect([conflict.status, (await conflict.json() as { code: string }).code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect((await post('begin', ['not-an-id', owner, transferWorkflow])).status).toBe(400);
      const runs = await t.db.query(`SELECT count(*)::int AS n FROM execution_runs WHERE run_id = $1`, [first.value.id]);
      expect(runs.rows[0]).toEqual({ n: 1 });
      // The Vercel-side server action client: same contract, bearer token, idempotency key and trace header.
      const viaBff = await callCloudFlow<TransferRecord>('robinhood-transfer', 'review', [first.value.id, first.value.review.commitment, transferWorkflow],
        { env: { API_BASE_URL: base, API_AUTH_TOKEN: token } });
      expect(viaBff).toMatchObject({ ok: true, value: { id: first.value.id, authorization: first.value.review.commitment } });
      expect(await callCloudFlow('robinhood-transfer', 'mode', [], { env: { API_BASE_URL: base, API_AUTH_TOKEN: token } })).toEqual({ ok: true, value: 'harness' });
    } finally { server.close(); }
  });

  it('two API instances racing begin: one attempt per run; two runs racing for one owner nonce: one economic intent', async () => {
    const a = await deployment(), b = await deployment({ chain: a.chain, model: a.model }), record = await reviewedTransfer(a);
    const same = await Promise.all([a.rh('begin', record.id, owner, transferWorkflow), b.rh('begin', record.id, owner, transferWorkflow)]);
    expect(same.filter(r => r.ok)).toHaveLength(1);
    expect(same.find(r => !r.ok)).toMatchObject({ ok: false, code: expect.stringMatching(/^TRANSFER_(BUSY|EXISTING_ATTEMPT_OBSERVE_ONLY)$/) });
    // A second, independently reviewed run for the SAME owner nonce can never prepare a second economic attempt.
    const chain2 = freshChain(), c = await deployment({ chain: chain2 }), d2 = await deployment({ chain: chain2 });
    const [r1, r2] = await Promise.all([reviewedTransfer(c), reviewedTransfer(d2)]);
    const raced = await Promise.all([c.rh('begin', r1.id, owner, transferWorkflow), d2.rh('begin', r2.id, owner, transferWorkflow)]);
    expect(raced.filter(r => r.ok)).toHaveLength(1);
    expect(raced.find(r => !r.ok)).toEqual({ ok: false, code: 'TRANSFER_NONCE_ALREADY_RESERVED' });
    expect(a.chain.transactions).toHaveLength(0);
    expect(chain2.transactions).toHaveLength(0);
  });

  it('duplicate deliveries and racing workers: observation happens under one lease; a crashed worker\'s item is reclaimed', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    const begin = ok<{ transaction: Record<string, string> }>(await d.rh('begin', record.id, owner, transferWorkflow));
    ok(await d.rh('handoff', record.id));
    const hash = await d.chain.rpc('MOCK_submit', [begin.transaction]) as string;
    ok(await d.rh('report', record.id, { kind: 'HASH', hash }));
    await due(d.db);
    // Worker A claims and "crashes" (never settles); its lease expires; worker B reclaims and reconciles.
    const crashed = await createPostgresWorkQueue({ db: d.db, ownerId: 'crashed' }).claim(10);
    expect(crashed.some(item => item.runId === record.id)).toBe(true);
    await d.db.query(`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE run_id = $1 AND state = 'LEASED'`, [record.id]);
    // A duplicate delivery of the same logical work arrives as well (e.g. a relayed queue message).
    await createPostgresWorkQueue({ db: d.db, ownerId: 'relay' }).enqueue('default', 'reconcile', `robinhood-transfer:${record.id}#dup`, record.id,
      { namespace: 'robinhood-transfer', runId: record.id });
    const b1 = await deployment({ chain: d.chain }), b2 = await deployment({ chain: d.chain });
    await Promise.all([b1.worker.drainOnce(), b2.worker.drainOnce()]);
    await due(d.db); await Promise.all([b1.worker.drainOnce(), b2.worker.drainOnce()]);
    expect(ok<TransferRecord>(await d.rh('status', record.id))).toMatchObject({ verdict: 'RECONCILED' });
    expect(d.chain.transactions).toHaveLength(1);
    expect(await createPostgresWorkQueue({ db: d.db, ownerId: 'crashed' }).complete(crashed.find(i => i.runId === record.id)!)).toBe(false);
    const confirmed = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM journal_entries WHERE run_id = $1 AND to_state = 'CONFIRMED'`, [record.id]);
    expect(confirmed.rows[0]!.n).toBe(1);
  });

  it('a stale work item never cancels a PREPARED attempt the owner is about to hand to the wallet', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    ok(await d.rh('begin', record.id, owner, transferWorkflow));
    await createPostgresWorkQueue({ db: d.db, ownerId: 'stale' }).enqueue('default', 'reconcile', `robinhood-transfer:${record.id}`, record.id,
      { namespace: 'robinhood-transfer', runId: record.id });
    await d.worker.drainOnce();
    expect(ok<TransferRecord>(await d.rh('status', record.id)).attempt?.state).toBe('PREPARED');
    expect(ok<TransferRecord>(await d.rh('handoff', record.id)).attempt?.state).toBe('SUBMITTING');
  });

  it('crash after commit before delivery: the outbox item exists; the sweeper restores lost work', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    const begin = ok<{ transaction: Record<string, string> }>(await d.rh('begin', record.id, owner, transferWorkflow));
    ok(await d.rh('handoff', record.id));
    const open = await t.db.query(`SELECT kind, state FROM work_items WHERE run_id = $1 AND state = 'READY'`, [record.id]);
    expect(open.rows).toEqual([{ kind: 'reconcile', state: 'READY' }]);   // SUBMITTING committed together with its work
    await d.chain.rpc('MOCK_submit', [begin.transaction]);
    // An operator mistakenly deletes the queue row; durable run state still says observation is needed.
    await t.db.query(`DELETE FROM work_items WHERE run_id = $1`, [record.id]);
    expect((await sweep(t.db)).reconcile).toBeGreaterThanOrEqual(1);
    await due(d.db); await d.worker.drainOnce();
    expect(ok<TransferRecord>(await d.rh('status', record.id))).toMatchObject({ verdict: 'RECONCILED' });
    expect(d.chain.transactions).toHaveLength(1);
  });

  it('malformed or tampered state fails closed for the API and the worker', async () => {
    const d = await deployment(), record = await reviewedTransfer(d);
    ok(await d.rh('begin', record.id, owner, transferWorkflow));
    ok(await d.rh('handoff', record.id));
    await t.db.transaction(async tx => {
      await tx.query('ALTER TABLE execution_log_segments DISABLE TRIGGER execution_log_segments_append_only');
      await tx.query(`UPDATE execution_log_segments SET bytes = convert_to(replace(convert_from(bytes, 'UTF8'), '"SUBMITTING"', '"CONFIRMED"'), 'UTF8')
        WHERE name = $1 AND seq = (SELECT max(seq) FROM execution_log_segments WHERE name = $1)`, [record.id + '.jsonl']);
      await tx.query('ALTER TABLE execution_log_segments ENABLE TRIGGER execution_log_segments_append_only');
    });
    expect(await d.rh('status', record.id)).toEqual({ ok: false, code: 'JOURNAL_CORRUPT' });
    expect(await d.rh('observe', record.id)).toEqual({ ok: false, code: 'JOURNAL_CORRUPT' });
    await due(d.db); await d.worker.drainOnce();
    const item = await t.db.query(`SELECT state, last_error FROM work_items WHERE run_id = $1 ORDER BY id DESC LIMIT 1`, [record.id]);
    expect(item.rows[0]).toEqual({ state: 'DEAD', last_error: 'JOURNAL_CORRUPT' });
    expect(d.chain.transactions).toHaveLength(0);
  });

  it('tenants cannot read or act on each other\'s runs', async () => {
    const a = await deployment(), b = await deployment({ chain: a.chain, tenantId: 'tenant-b' }), record = await reviewedTransfer(a);
    expect(await b.rh('status', record.id)).toEqual({ ok: false, code: 'TRANSFER_SERVICE_UNAVAILABLE' });
    expect(await b.rh('begin', record.id, owner, transferWorkflow)).toEqual({ ok: false, code: 'TRANSFER_SERVICE_UNAVAILABLE' });
    const runsRoute = b.backend.routes.find(r => r.name === 'runs')!;
    const listed = await runsRoute.handler({ method: 'GET', path: '/v1/runs', query: new URLSearchParams(), headers: {}, body: null, requestId: 'x' }, runsRoute.pattern.exec('/v1/runs')!);
    expect((listed.body as { value: { items: { runId: string }[] } }).value.items.map(i => i.runId)).not.toContain(record.id);
    expect(ok<TransferRecord>(await a.rh('status', record.id)).id).toBe(record.id);
  });
});

describe('BUILD-CLOUD-001 Aave Supply family on durable cloud state', () => {
  it('approval and supply reconcile through the worker across process restarts; a retry never duplicates an economic attempt', async () => {
    const d = await deployment();
    let run = ok<SupplyRecord>(await d.sp('simulate', supplyWorkflow, SUPPLY_OWNER));
    run = ok<SupplyRecord>(await d.sp('review', run.id, run.review.commitment, supplyWorkflow));
    for (const step of ['APPROVAL', 'SUPPLY']) {
      const api = await deployment({ chain: d.chain, model: d.model, evidenceDir: d.evidenceDir });    // a different API instance each step
      const begin = ok<{ step: string; transaction: Record<string, string> }>(await api.sp('begin', run.id, SUPPLY_OWNER, supplyWorkflow));
      expect(begin.step).toBe(step);
      // A retried begin (lost response) cannot create a second attempt for the same step.
      expect((await api.sp('begin', run.id, SUPPLY_OWNER, supplyWorkflow)).ok).toBe(false);
      ok(await api.sp('handoff', run.id, step));
      const hash = await d.model.rpc('MOCK_submit', [begin.transaction]) as string;
      ok(await api.sp('report', run.id, step, { kind: 'HASH', hash }));
      const worker = await deployment({ chain: d.chain, model: d.model, evidenceDir: d.evidenceDir });
      await due(worker.db); await worker.worker.drainOnce();
      run = ok<SupplyRecord>(await worker.sp('status', run.id));
    }
    expect(run.verdict).toBe('RECONCILED');
    expect(run.attempts.map(a => [a.step, a.state, a.reconciled])).toEqual([['APPROVAL', 'CONFIRMED', true], ['SUPPLY', 'CONFIRMED', true]]);
    expect(d.model.transactions).toHaveLength(2);
    await due(d.db); await d.worker.drainOnce();
    const evidence = await t.db.query(`SELECT environment, outcome FROM evidence_objects WHERE run_id = $1`, [run.id]);
    expect(evidence.rows).toEqual([{ environment: 'MOCKED', outcome: 'RECONCILED' }]);
    const attempts = await t.db.query(`SELECT step, state, reconciled FROM execution_attempts WHERE run_id = $1 ORDER BY step`, [run.id]);
    expect(attempts.rows).toEqual([{ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true }, { step: 'SUPPLY', state: 'CONFIRMED', reconciled: true }]);
  });
});

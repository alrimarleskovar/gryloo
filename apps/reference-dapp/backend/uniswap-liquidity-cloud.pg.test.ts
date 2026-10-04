// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC on the BUILD-CLOUD-001 runtime: PostgreSQL state, fenced leases, outbox, worker
 * reconciliation and EvidenceStore, with a MOCKED in-process Base Sepolia chain. The only "wallet" is the test calling
 * `chain.wallet.send`; the backend and workers have no send path.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createHttpServer, createLogger, createPostgresWorkQueue, createWorker, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { sqrtRatioAtTick } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { editorReducer, initialEditor } from '../src/domain/editor.ts';
import { uniswapBandInput } from '../src/domain/uniswap-liquidity-authoring.ts';
import type { UniswapBegin, UniswapLiquidityRecord } from '../src/server/uniswap-liquidity-service.ts';
import { createUniswapLiquidityChain, UNI_OWNER, type UniswapLiquidityChain } from '../e2e/uniswap-liquidity-harness.ts';
import { createBackend, type FlowResult } from './app.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const env = { GRYLOO_UNISWAP_LIQUIDITY_HARNESS: 'MOCKED_LOOPBACK_ONLY' } as const;
const SEND = ['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction'];
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }
function workflow(): SemanticWorkflow {
  const band = uniswapBandInput((sqrtRatioAtTick(225_600) + 123_456_789n).toString(), 1_000);
  const result = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: { network: 'Base Sepolia', maxUsdc: '10', maxWeth: '0.005',
    rangeUnit: band.rangeUnit, lower: band.lower, upper: band.upper, slippage: '100' }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('tenant-b')`); });
afterAll(async () => { await t?.drop(); });
/** One fresh API + worker "process" sharing the database; every RPC method it uses is recorded. */
async function deployment(chain: UniswapLiquidityChain, options: { tenantId?: string; evidenceDir?: string } = {}) {
  const methods: string[] = [];
  const rpc = (method: string, params: readonly unknown[]) => { methods.push(method); return chain.rpc(method, params); };
  const db: Database = t.open(6), workerId = `worker-${Math.random().toString(16).slice(2, 8)}`;
  const evidenceDir = options.evidenceDir ?? await mkdtemp(join(tmpdir(), 'flofi-unilp-evidence-'));
  const backend = createBackend({ db, env, logger: quiet, tenantId: options.tenantId ?? 'default', holderId: workerId,
    evidenceStore: createFilesystemEvidenceStore(evidenceDir), rpc: { 'uniswap-liquidity': rpc }, busyRetries: 3 });
  const worker = createWorker({ queue: createPostgresWorkQueue({ db, ownerId: workerId }), handlers: backend.handlers, logger: quiet, workerId, concurrency: 8 });
  return { db, backend, worker, evidenceDir, methods, lp: (method: string, ...args: unknown[]) => backend.callFlow('uniswap-liquidity', method, args) };
}
const due = (db: Database) => db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY'`);

describe('BUILD-UNISWAP-LIQUIDITY-PUBLIC Uniswap v3 liquidity on durable cloud state (MOCKED Base Sepolia chain)', () => {
  it('approvals and mint through the API; workers reconcile after browser loss and restarts; one position, verified evidence', async () => {
    const chain = createUniswapLiquidityChain({ nonce: 40n }), w = workflow();
    const api1 = await deployment(chain);
    expect(ok<string>(await api1.lp('mode'))).toBe('harness');
    expect(ok<{ executionEnabled: boolean }>(await api1.lp('info'))).toEqual({ executionEnabled: true });
    let run = ok<UniswapLiquidityRecord>(await api1.lp('simulate', w, UNI_OWNER));
    const id = run.id;
    ok<UniswapLiquidityRecord>(await api1.lp('review', id, run.review.commitment, w));
    const approval0 = ok<UniswapBegin>(await api1.lp('begin', id, UNI_OWNER, w));
    expect(approval0.attempt.step).toBe('APPROVE_TOKEN0');
    // Two API instances racing begin cannot create a second attempt.
    const api1b = await deployment(chain, { evidenceDir: api1.evidenceDir });
    expect(await api1b.lp('begin', id, UNI_OWNER, w)).toEqual({ ok: false, code: 'UNISWAP_ATTEMPT_ACTIVE_OBSERVE_EXISTING' });
    ok(await api1.lp('handoff', id));
    const hash0 = chain.wallet.send(approval0.transaction);
    ok(await api1.lp('report', id, { kind: 'HASH', hash: hash0 }));
    // Duplicate hash registration from a retried browser request is a no-op.
    ok(await api1b.lp('report', id, { kind: 'HASH', hash: hash0 }));
    // Browser closed: a fresh worker process reconciles the approval from PostgreSQL alone.
    const worker1 = await deployment(chain, { evidenceDir: api1.evidenceDir });
    await due(worker1.db); await worker1.worker.drainOnce();
    const api2 = await deployment(chain, { evidenceDir: api1.evidenceDir });
    run = ok<UniswapLiquidityRecord>(await api2.lp('status', id));
    expect(run.attempts.map(a => [a.step, a.state])).toEqual([['APPROVE_TOKEN0', 'CONFIRMED']]);
    const approval1 = ok<UniswapBegin>(await api2.lp('begin', id, UNI_OWNER, w));
    ok(await api2.lp('handoff', id));
    ok(await api2.lp('report', id, { kind: 'HASH', hash: chain.wallet.send(approval1.transaction) }));
    const worker2 = await deployment(chain, { evidenceDir: api1.evidenceDir });
    await due(worker2.db); await worker2.worker.drainOnce();
    // A backend restart between approval and mint: a new instance prepares the mint.
    const api3 = await deployment(chain, { evidenceDir: api1.evidenceDir });
    const mint = ok<UniswapBegin>(await api3.lp('begin', id, UNI_OWNER, w));
    expect(mint.attempt.step).toBe('MINT');
    ok(await api3.lp('handoff', id));
    chain.wallet.send(mint.transaction);                 // the browser closes before reporting the mint hash
    const worker3 = await deployment(chain, { evidenceDir: api1.evidenceDir });
    await due(worker3.db); await worker3.worker.drainOnce(); await worker3.worker.drainOnce();
    const final = ok<UniswapLiquidityRecord>(await (await deployment(chain, { evidenceDir: api1.evidenceDir })).lp('status', id));
    expect(final.verdict).toBe('RECONCILED');
    expect(final.position).toMatchObject({ owner: UNI_OWNER });
    expect(chain.snapshot.owners[final.position!.tokenId]).toBe(UNI_OWNER);
    expect(final.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
    expect(chain.counters.sends).toBe(3);
    expect(await api3.lp('begin', id, UNI_OWNER, w)).toEqual({ ok: false, code: 'UNISWAP_POSITION_ALREADY_MINTED' });
    expect(chain.counters.sends).toBe(3);
    for (const d of [worker1, worker2, worker3]) expect(d.methods.filter(m => SEND.includes(m))).toEqual([]);
    const projected = await t.db.query(`SELECT status, provenance, needs_observation, has_evidence, owner_account FROM execution_runs WHERE run_id = $1`, [id]);
    expect(projected.rows[0]).toEqual({ status: 'RECONCILED', provenance: 'MOCKED', needs_observation: false, has_evidence: true, owner_account: UNI_OWNER });
    const attempts = await t.db.query(`SELECT step, state, reconciled, nonce FROM execution_attempts WHERE run_id = $1 ORDER BY attempt_id`, [id]);
    expect(attempts.rows).toEqual([{ step: 'APPROVE_TOKEN0', state: 'CONFIRMED', reconciled: true, nonce: '40' },
      { step: 'APPROVE_TOKEN1', state: 'CONFIRMED', reconciled: true, nonce: '41' }, { step: 'MINT', state: 'CONFIRMED', reconciled: true, nonce: '42' }]);
    const route = api3.backend.routes.find(r => r.name === 'run.evidence')!;
    const response = await route.handler({ method: 'GET', path: `/v1/runs/${id}/evidence`, query: new URLSearchParams(), headers: {}, body: null, requestId: 'x' },
      route.pattern.exec(`/v1/runs/${id}/evidence`)!);
    expect((response.body as { value: { verified: boolean; bundleHash: string; environment: string }[] }).value).toEqual([
      expect.objectContaining({ verified: true, bundleHash: final.evidence!.bundleHash, environment: 'MOCKED' })]);
  });

  it('a worker keeps a preconfirmed zero-block-hash receipt observation-only, retries, then reconciles the canonical receipt once', async () => {
    const chain = createUniswapLiquidityChain({ nonce: 120n, delegatedOwner: true }), w = workflow(), api = await deployment(chain);
    const simulated = ok<UniswapLiquidityRecord>(await api.lp('simulate', w, UNI_OWNER)), id = simulated.id;
    ok(await api.lp('review', id, simulated.review.commitment, w));
    const begun = ok<UniswapBegin>(await api.lp('begin', id, UNI_OWNER, w));
    ok(await api.lp('handoff', id));
    ok(await api.lp('report', id, { kind: 'HASH', hash: chain.wallet.sendDelegated(begun.transaction, { preconfirmedReads: 1 }) }));
    const worker = await deployment(chain, { evidenceDir: api.evidenceDir });
    await due(worker.db); await worker.worker.drainOnce();
    let record = ok<UniswapLiquidityRecord>(await api.lp('status', id));
    expect(record.attempts[0]).toMatchObject({ state: 'PENDING', receipt: null, reconciled: false });
    expect(record.error).toBe('UNISWAP_RECEIPT_NOT_CANONICAL');
    const queued = await t.db.query(`SELECT state FROM work_items WHERE run_id = $1 AND kind = 'reconcile' ORDER BY id DESC LIMIT 1`, [id]);
    expect(queued.rows[0]).toEqual({ state: 'READY' });
    await due(worker.db); await worker.worker.drainOnce();
    record = ok<UniswapLiquidityRecord>(await api.lp('status', id));
    expect(record.attempts[0]).toMatchObject({ state: 'CONFIRMED', reconciled: true });
    expect(record.attempts[0]!.receipt!.blockHash).not.toBe('0x' + '0'.repeat(64));
    expect(chain.counters.sends).toBe(1);
    expect(worker.methods.filter(m => SEND.includes(m))).toEqual([]);
  });

  it('a stale work item never cancels a PREPARED attempt; idempotent HTTP replay; tenants are isolated; tampered state fails closed', async () => {
    const chain = createUniswapLiquidityChain({ nonce: 80n }), w = workflow(), d = await deployment(chain);
    const token = 'test-token-'.padEnd(40, 'x');
    const server = createHttpServer({ routes: d.backend.routes, logger: quiet, authToken: token });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    let id: string;
    try {
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const post = (method: string, args: unknown[], key?: string) => fetch(`${base}/v1/flows/uniswap-liquidity/${method}`, { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...key ? { 'idempotency-key': key } : {} }, body: JSON.stringify({ args }) });
      const first = await (await post('simulate', [w, UNI_OWNER], 'unilp-sim-0001')).json() as { ok: true; value: UniswapLiquidityRecord };
      const replay = await (await post('simulate', [w, UNI_OWNER], 'unilp-sim-0001')).json() as { ok: true; value: UniswapLiquidityRecord };
      expect(replay.value.id).toBe(first.value.id);
      expect((await post('begin', ['unilp-bad', UNI_OWNER, w])).status).toBe(400);
      expect((await post('report', [first.value.id, { kind: 'HASH', hash: 'nope' }])).status).toBe(400);
      id = first.value.id;
    } finally { server.close(); }
    const run = ok<UniswapLiquidityRecord>(await d.lp('review', id, (ok<UniswapLiquidityRecord>(await d.lp('status', id))).review.commitment, w));
    ok(await d.lp('begin', run.id, UNI_OWNER, w));
    // A worker with an old queued item re-checks under the run lease and leaves PREPARED untouched.
    await d.db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state) VALUES ('default', 'reconcile', $1, $2, $3::jsonb, 'READY')
      ON CONFLICT DO NOTHING`, [`uniswap-liquidity:${id}`, id, JSON.stringify({ namespace: 'uniswap-liquidity', runId: id })]);
    await d.worker.drainOnce();
    expect(ok<UniswapLiquidityRecord>(await d.lp('status', id)).attempts[0]!.state).toBe('PREPARED');
    const other = await deployment(chain, { tenantId: 'tenant-b' });
    expect(await other.lp('status', id)).toEqual({ ok: false, code: 'UNISWAP_LIQUIDITY_RUN_NOT_FOUND' });
    expect(await other.lp('handoff', id)).toMatchObject({ ok: false });
    await t.db.transaction(async tx => {
      await tx.query('ALTER TABLE execution_log_segments DISABLE TRIGGER execution_log_segments_append_only');
      await tx.query(`UPDATE execution_log_segments SET bytes = convert_to(replace(convert_from(bytes, 'UTF8'), '"PREPARED"', '"CONFIRMED"'), 'UTF8')
        WHERE name = $1 AND seq = (SELECT max(seq) FROM execution_log_segments WHERE name = $1)`, [id + '.jsonl']);
      await tx.query('ALTER TABLE execution_log_segments ENABLE TRIGGER execution_log_segments_append_only');
    });
    expect(await d.lp('status', id)).toEqual({ ok: false, code: 'JOURNAL_CORRUPT' });
    expect(await d.lp('handoff', id)).toEqual({ ok: false, code: 'JOURNAL_CORRUPT' });
    expect(chain.counters.sends).toBe(0);
  });
});

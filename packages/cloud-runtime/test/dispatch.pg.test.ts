// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createIdempotencyStore, createLogger, createPostgresLogStore, createPostgresWorkQueue, createWorker, requestHash, sweep,
  type Database, type Projector } from '../src/index.js';
import { bytes, createTestDatabase, type TestDatabase } from './pg-harness.js';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const runProjector = (needsObservation: (content: string) => boolean): Projector => (name, value) => {
  const content = new TextDecoder().decode(value), runId = name.replace(/\.jsonl$/, '');
  const observe = needsObservation(content);
  return { run: { runId, workflowId: 'wf', flow: 'test-flow', status: observe ? 'PENDING' : 'DONE', provenance: 'MOCKED', ownerAccount: null,
    recoveryOf: null, errorCode: null, needsObservation: observe, hasEvidence: false, attempts: [], journal: [] },
  work: observe ? [{ kind: 'reconcile', dedupeKey: `ns:${runId}`, runId, payload: { namespace: 'ns', runId } }] : [] };
};
const anyLines = (value: Uint8Array) => { if (!new TextDecoder().decode(value).endsWith('\n')) throw new Error('bad'); };

describe('BUILD-CLOUD-001 transactional outbox and durable work queue', () => {
  let t: TestDatabase, db: Database;
  beforeAll(async () => { t = await createTestDatabase(); db = t.db; });
  afterAll(async () => { await t.drop(); });
  const open = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM work_items WHERE state IN ('READY','LEASED')`)).rows[0]!.n;

  it('work is committed atomically with the state that requires it (and rolled back with it)', async () => {
    const log = createPostgresLogStore({ db, tenantId: 'default', namespace: 'ns', projector: runProjector(c => c.includes('submitted')) });
    await log.extend('run-a.jsonl', bytes('prepared\n'), anyLines);
    expect(await open()).toBe(0);
    // "Crash" right after commit: nobody delivers anything, yet the work item is already durable.
    await log.extend('run-a.jsonl', bytes('prepared\nsubmitted\n'), anyLines);
    expect(await open()).toBe(1);
    // A further state change while the item is open does not duplicate it.
    await log.extend('run-a.jsonl', bytes('prepared\nsubmitted\nsubmitted-again\n'), anyLines);
    expect(await open()).toBe(1);
    // A failed state transition enqueues nothing.
    await expect(log.extend('run-b.jsonl', bytes('submitted\n'), () => { throw new Error('invalid'); })).rejects.toThrow('JOURNAL_CORRUPT');
    expect(await open()).toBe(1);
    // A fresh worker process (new pool) finds the work after the "crash".
    const claimed = await createPostgresWorkQueue({ db: t.open(2), ownerId: 'restarted-worker' }).claim(10);
    expect(claimed.map(item => [item.kind, item.runId, item.deliveries])).toEqual([['reconcile', 'run-a', 1]]);
  });
  it('a more urgent state brings an already queued item forward without duplicating it', async () => {
    const projector: Projector = (name, value) => {
      const base = runProjector(() => true)(name, value)!, urgent = new TextDecoder().decode(value).includes('hash');
      return { ...base, work: base.work.map(w => ({ ...w, delayMs: urgent ? 0 : 3_600_000 })) };
    };
    const log = createPostgresLogStore({ db, tenantId: 'default', namespace: 'ns', projector });
    await log.extend('run-u.jsonl', bytes('submitting\n'), anyLines);
    const queue = createPostgresWorkQueue({ db, ownerId: 'u' });
    expect((await queue.claim(10)).some(i => i.runId === 'run-u')).toBe(false);
    await log.extend('run-u.jsonl', bytes('submitting\nhash\n'), anyLines);
    const claimed = (await queue.claim(10)).filter(i => i.runId === 'run-u');
    expect(claimed).toHaveLength(1);
    await queue.complete(claimed[0]!);
  });
  it('two racing workers never receive the same item; an expired lease is reclaimed and the stale settle is refused', async () => {
    for (let i = 0; i < 20; i++) await createPostgresWorkQueue({ db, ownerId: 'producer' }).enqueue('default', 'job', `race-${i}`, null);
    const w1 = createPostgresWorkQueue({ db, ownerId: 'w1' }), w2 = createPostgresWorkQueue({ db: t.open(4), ownerId: 'w2' });
    const [a, b] = await Promise.all([w1.claim(15), w2.claim(15)]);
    const ids = [...a, ...b].filter(item => item.kind === 'job').map(item => item.dedupeKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    const victim = a.find(item => item.kind === 'job')!;
    await db.query(`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [victim.id]);
    const reclaimed = (await w2.claim(10)).find(item => item.id === victim.id)!;
    expect(reclaimed.deliveries).toBe(2);
    expect(await w1.complete(victim)).toBe(false);     // stale token
    expect(await w2.complete(reclaimed)).toBe(true);
    for (const item of [...a, ...b]) if (item.id !== victim.id) await (a.includes(item) ? w1 : w2).complete(item);
  });
  it('retry delays redelivery; DEAD flags the run; the sweeper re-creates missing reconcile work but not for flagged runs', async () => {
    const log = createPostgresLogStore({ db, tenantId: 'default', namespace: 'ns', projector: runProjector(() => true) });
    await log.extend('run-c.jsonl', bytes('submitted\n'), anyLines);
    const queue = createPostgresWorkQueue({ db, ownerId: 'w' });
    const item = (await queue.claim(10)).find(i => i.runId === 'run-c')!;
    expect(await queue.retry(item, 60_000, 'RPC_UNAVAILABLE')).toBe(true);
    expect((await queue.claim(10)).some(i => i.runId === 'run-c')).toBe(false);
    await db.query(`UPDATE work_items SET available_at = now() WHERE run_id = 'run-c'`);
    const again = (await queue.claim(10)).find(i => i.runId === 'run-c')!;
    expect(again.deliveries).toBe(2);
    await queue.complete(again);
    // Lost item (e.g. manual cleanup): the sweeper restores it from durable run state.
    expect((await sweep(db)).reconcile).toBeGreaterThanOrEqual(1);
    const swept = (await queue.claim(10)).find(i => i.runId === 'run-c')!;
    expect(await queue.dead(swept, 'OBSERVATION_BUDGET_EXHAUSTED')).toBe(true);
    const run = await db.query(`SELECT attention_required FROM execution_runs WHERE run_id = 'run-c'`);
    expect(run.rows[0]).toEqual({ attention_required: true });
    await sweep(db);
    expect((await queue.claim(10)).some(i => i.runId === 'run-c')).toBe(false);
  });
  it('the worker loop settles, retries a failing handler and kills unknown kinds', async () => {
    const queue = createPostgresWorkQueue({ db, ownerId: 'loop' });
    await queue.enqueue('default', 'ok', 'ok-1', null);
    await queue.enqueue('default', 'fails', 'fails-1', null);
    await queue.enqueue('default', 'mystery', 'mystery-1', null);
    const seen: string[] = [];
    const worker = createWorker({ queue, logger: quiet, workerId: 'loop', concurrency: 10, handlers: {
      ok: async (item, settle) => { seen.push(item.kind); await settle({ outcome: 'DONE' }); },
      fails: async () => { throw new Error('RPC_UNAVAILABLE'); },
    } });
    expect(await worker.drainOnce()).toBe(3);
    const rows = (await db.query<{ kind: string; state: string; last_error: string | null }>(`SELECT kind, state, last_error FROM work_items
      WHERE kind IN ('ok','fails','mystery') ORDER BY kind`)).rows;
    expect(rows).toEqual([{ kind: 'fails', state: 'READY', last_error: 'RPC_UNAVAILABLE' }, { kind: 'mystery', state: 'DEAD', last_error: 'WORK_KIND_UNKNOWN' },
      { kind: 'ok', state: 'DONE', last_error: null }]);
    expect(seen).toEqual(['ok']);
  });
});

describe('BUILD-CLOUD-001 API idempotency', () => {
  let t: TestDatabase;
  beforeAll(async () => { t = await createTestDatabase(); });
  afterAll(async () => { await t.drop(); });
  it('replays a completed response, rejects key reuse with a different body and serializes concurrent duplicates', async () => {
    const store = createIdempotencyStore({ db: t.db, tenantId: 'default' }), other = createIdempotencyStore({ db: t.open(2), tenantId: 'default' });
    const hash = requestHash('flows/x/begin', { args: ['run-1'] });
    const concurrent = await Promise.all([store.begin('flows/x/begin', 'key-00000001', hash), other.begin('flows/x/begin', 'key-00000001', hash)]);
    expect(concurrent.map(c => c.kind).sort()).toEqual(['IN_PROGRESS', 'NEW']);
    await store.complete('flows/x/begin', 'key-00000001', hash, { ok: true, value: 'first' });
    expect(await other.begin('flows/x/begin', 'key-00000001', hash)).toEqual({ kind: 'REPLAY', response: { ok: true, value: 'first' } });
    expect(await store.begin('flows/x/begin', 'key-00000001', requestHash('flows/x/begin', { args: ['run-2'] }))).toEqual({ kind: 'CONFLICT' });
    // A failure releases the key; a crashed claim expires and can be taken over.
    expect((await store.begin('flows/x/report', 'key-00000002', hash)).kind).toBe('NEW');
    await store.release('flows/x/report', 'key-00000002', hash);
    expect((await store.begin('flows/x/report', 'key-00000002', hash)).kind).toBe('NEW');
    await t.db.query(`UPDATE api_idempotency SET claimed_until = now() - interval '1 second' WHERE idempotency_key = 'key-00000002'`);
    expect((await other.begin('flows/x/report', 'key-00000002', hash)).kind).toBe('NEW');
    // Tenant isolation: the same key in another tenant is independent.
    await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('tenant-b')`);
    expect((await createIdempotencyStore({ db: t.db, tenantId: 'tenant-b' }).begin('flows/x/begin', 'key-00000001', hash)).kind).toBe('NEW');
    await expect(store.begin('flows/x/begin', 'bad key', hash)).rejects.toThrow('IDEMPOTENCY_KEY_INVALID');
  });
});

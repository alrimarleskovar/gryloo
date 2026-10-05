// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: the BUILD-013 Supply → Borrow → Swap composition on the cloud runtime, on a disposable loopback PostgreSQL with
 * the MOCKED in-process lending chain (no public network, no broadcast; the only "wallet" is the test calling MOCK_submit). Every
 * request runs on a NEW embedded runtime instance, exactly what a serverless platform may give each request.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, createPostgresWorkQueue, createWorker, ensureTenant } from '@defi-workflow-engine/cloud-runtime';
import { createLendingHarness, OWNER } from '../e2e/lending-harness.mjs';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { createAuthoredLending } from '../src/domain/lending-authoring.ts';
import { createEmbeddedRuntime } from '../src/server/flow-runtime.ts';
import { createLendingCompositionService, type LendingRecord } from '../src/server/lending-composition-service.ts';

const workflow = createAuthoredLending('lending', 0, { supply: '0.1', borrow: '0.01', slippage: '50', owner: OWNER });
const quiet = createLogger({ service: 'test', sink: () => undefined });
type Result<T> = { ok: true; value: T } | { ok: false; code: string };
function ok<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.code); return result.value; }
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

/** One deployment (own tenant): each call opens a fresh runtime instance, calls the lending flow once and closes it. */
function deployment(tenant: string, model = createLendingHarness()) {
  const env = { FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, TENANT_ID: tenant, GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY' };
  const instance = () => createEmbeddedRuntime(env, { rpc: { 'lending-composition': model.rpc }, busyRetries: 3 });
  const call = async <T>(method: string, ...args: unknown[]): Promise<Result<T>> => {
    const runtime = await instance();
    try { return await runtime.backend.callFlow('lending-composition', method, args) as Result<T>; } finally { await runtime.close(); }
  };
  return { model, env, instance, call };
}
type Begin = { record: LendingRecord; attemptId: string; transaction: Record<string, string> };
async function authorized(d: ReturnType<typeof deployment>) {
  const simulated = ok(await d.call<LendingRecord>('simulate', workflow, OWNER));
  return ok(await d.call<LendingRecord>('review', simulated.id, simulated.reviews[0]!.commitment, workflow));
}
async function step(d: ReturnType<typeof deployment>, id: string) {
  const begin = ok(await d.call<Begin>('begin', id, OWNER, workflow));
  ok(await d.call('handoff', id, begin.attemptId));
  const hash = await d.model.rpc('MOCK_submit', [begin.transaction]) as string;     // the owner's wallet, the only submitter
  ok(await d.call('report', id, begin.attemptId, { kind: 'HASH', hash }));
  return ok(await d.call<LendingRecord>('observe', id));
}

describe('BUILD-CLOUD-PARITY-001 lending composition on the cloud runtime', () => {
  it('completes the five-step composition with every request on a new instance, one transaction per step, all state in PostgreSQL', async () => {
    const d = deployment('lending-a'); await ensureTenant(t.db, 'lending-a');
    let r = await authorized(d);
    for (let i = 0; i < 5; i++) {
      r = await step(d, r.id);
      if (r.status !== 'COMPLETED') { r = ok(await d.call<LendingRecord>('refresh', r.id)); r = ok(await d.call<LendingRecord>('review', r.id, r.reviews.at(-1)!.commitment, workflow)); }
    }
    expect(r.status).toBe('COMPLETED');
    expect(r.evidence?.bundle.outcome).toBe('RECONCILED');
    expect(r.attempts.map(a => [a.step, a.state, a.reconciled])).toEqual(['POOL_APPROVAL', 'SUPPLY', 'BORROW', 'ROUTER_APPROVAL', 'SWAP'].map(s => [s, 'CONFIRMED', true]));
    expect(d.model.transactions).toHaveLength(5);
    // Projected for the history and workers; stored in the Aave family's namespace, with the reservations it shares.
    const run = (await t.db.query(`SELECT flow, namespace, status, provenance, owner_account, has_evidence FROM execution_runs WHERE tenant_id = 'lending-a' AND run_id = $1`, [r.id])).rows[0];
    expect(run).toEqual({ flow: 'lending-composition', namespace: 'aave-supply', status: 'COMPLETED', provenance: 'MOCKED', owner_account: OWNER.toLowerCase(), has_evidence: true });
    const intents = (await t.db.query<{ name: string }>(`SELECT name FROM execution_logs WHERE tenant_id = 'lending-a' AND namespace = 'aave-supply' AND kind = 'INTENT' ORDER BY name`)).rows;
    expect(intents.filter(i => i.name.startsWith(OWNER.toLowerCase() + '-'))).toHaveLength(5);
    expect(intents.filter(i => i.name.startsWith('economic-')).length).toBeGreaterThanOrEqual(5);
    // A completed run never prepares another step.
    expect((await d.call('begin', r.id, OWNER, workflow)).ok).toBe(false);
    expect(d.model.transactions).toHaveLength(5);
  }, 180_000);
  it('a lost wallet result is reconciled by a worker after the browser is gone, without a second submission', async () => {
    const d = deployment('lending-b'); await ensureTenant(t.db, 'lending-b');
    const r = await authorized(d), begin = ok(await d.call<Begin>('begin', r.id, OWNER, workflow));
    ok(await d.call('handoff', r.id, begin.attemptId));
    await d.model.rpc('MOCK_submit', [begin.transaction]);
    expect(ok(await d.call<LendingRecord>('report', r.id, begin.attemptId, { kind: 'UNKNOWN' })).attempts[0]!.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    // The browser disappears. A worker of THIS tenant claims the reconcile item and observes read-only.
    await t.db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY' AND tenant_id = 'lending-b'`);
    const runtime = await d.instance();
    try {
      const worker = createWorker({ queue: createPostgresWorkQueue({ db: t.db, ownerId: 'worker-lending', tenantId: 'lending-b' }), handlers: runtime.backend.handlers,
        logger: quiet, workerId: 'worker-lending' });
      expect(await worker.drainOnce()).toBeGreaterThanOrEqual(1);
    } finally { await runtime.close(); }
    const after = ok(await d.call<LendingRecord>('status', r.id));
    expect(after.attempts[0]).toMatchObject({ step: 'POOL_APPROVAL', state: 'CONFIRMED', reconciled: true });
    expect(d.model.transactions).toHaveLength(1);
  }, 120_000);
  it('owner-nonce reservations are shared with the Aave Supply family: a nonce held by another run blocks the step before any wallet request', async () => {
    const d = deployment('lending-c'); await ensureTenant(t.db, 'lending-c');
    const r = await authorized(d), runtime = await d.instance();
    try {
      // A single-step Aave run of the same owner already holds this nonce in the shared namespace.
      const nonce = Number(BigInt(await d.model.rpc('eth_getTransactionCount', [OWNER, 'pending']) as string));
      const held = JSON.stringify({ id: 'supply-' + 'a'.repeat(32), step: 'SUPPLY', transaction: { from: OWNER, to: '0x' + '1'.repeat(40), data: '0x', value: '0x0' } }) + '\n';
      expect(await runtime.backend.storage('aave-supply', 'lending-c').log.create(`${OWNER.toLowerCase()}-${nonce}.intent`, new TextEncoder().encode(held))).toBe(true);
    } finally { await runtime.close(); }
    expect((await d.call('begin', r.id, OWNER, workflow)).ok).toBe(false);
    expect(ok(await d.call<LendingRecord>('status', r.id)).attempts).toEqual([]);
    expect(d.model.transactions).toHaveLength(0);
  }, 120_000);
  it('the capacity guard on the durable store refuses a step before any wallet request when its outcome might not fit', async () => {
    const d = deployment('lending-d'); await ensureTenant(t.db, 'lending-d');
    const r = await authorized(d), runtime = await d.instance();
    try {
      const bytes = (await runtime.backend.storage('lending-composition', 'lending-d').log.read(r.id + '.jsonl'))!.length;
      const tight = createLendingCompositionService({ storage: runtime.backend.storage('lending-composition', 'lending-d'), rpc: d.model.rpc, provenance: 'MOCKED',
        maxRunBytes: bytes + 4 * (JSON.stringify(r).length + 1) });
      await expect(tight.begin(r.id, OWNER, workflow)).rejects.toThrow('LENDING_JOURNAL_CAPACITY_INSUFFICIENT');
    } finally { await runtime.close(); }
    expect(ok(await d.call<LendingRecord>('status', r.id)).attempts).toEqual([]);
    expect(d.model.transactions).toHaveLength(0);
  }, 120_000);
});

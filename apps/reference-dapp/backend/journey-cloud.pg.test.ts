// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001 permissionless journey on the BUILD-CLOUD-001 runtime: the testnet Router flow (Base Sepolia → Arbitrum
 * Sepolia) through the real API routes, PostgreSQL state, fenced leases, outbox, workers and EvidenceStore, with MOCKED
 * in-process chains and loopback providers. Wallets are fresh random addresses; the API trusts only the wallet session
 * principal the BFF forwards. The only "wallet" sending anything is the test calling `h.wallet.send`.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFilesystemEvidenceStore, createLogger, createPostgresWorkQueue, createWorker, HttpError, type Database } from '@defi-workflow-engine/cloud-runtime';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { editorReducer, initialEditor } from '../src/domain/editor.ts';
import type { RouterBridgeInput } from '../src/domain/router-authoring.ts';
import type { RouterBegin, RouterRecord } from '../src/server/router-service.ts';
import type { WorkflowList, WorkflowDocument, WorkflowOwner } from '../src/domain/saved-workflow.ts';
import { WALLET_PRINCIPAL_HEADER } from '../src/server/run-ownership.ts';
import { createRouterHarness, type RouterHarness } from '../e2e/router-harness.ts';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { createBackend, type FlowResult } from './app.ts';

const FLOW = 'crosschain-router-testnet';
const quiet = createLogger({ service: 'test', sink: () => undefined });
const env = { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY', GRYLOO_ROUTER_HARNESS: 'MOCKED_LOOPBACK_ONLY' } as const;
const SEND = ['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction'];
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }
function workflow(patch: Partial<RouterBridgeInput> = {}): SemanticWorkflow {
  const input: RouterBridgeInput = { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO', ...patch };
  const result = editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
/** One fresh API + worker "process" (a restart is a new one) sharing the database; every chain RPC method it uses is recorded. */
async function deployment(h: RouterHarness, evidenceDir?: string, mainnet?: RouterHarness) {
  const methods: string[] = [];
  const record = (rpc: (m: string, p: readonly unknown[]) => Promise<unknown>) => (method: string, params: readonly unknown[]) => { methods.push(method); return rpc(method, params); };
  const db: Database = t.open(6), workerId = `worker-${Math.random().toString(16).slice(2, 8)}`, dir = evidenceDir ?? await mkdtemp(join(tmpdir(), 'flofi-journey-evidence-'));
  const backend = createBackend({ db, env, logger: quiet, tenantId: 'default', holderId: workerId, evidenceStore: createFilesystemEvidenceStore(dir),
    rpc: { [FLOW]: record(h.baseRpc), ...mainnet ? { 'crosschain-router': record(mainnet.baseRpc) } : {} },
    routers: { [FLOW]: { destinationRpc: record(h.arbitrumRpc), providers: h.providers },
      ...mainnet ? { 'crosschain-router': { destinationRpc: record(mainnet.arbitrumRpc), providers: mainnet.providers } } : {} }, busyRetries: 3 });
  const worker = createWorker({ queue: createPostgresWorkQueue({ db, ownerId: workerId }), handlers: backend.handlers, logger: quiet, workerId, concurrency: 8 });
  /** The BFF → API flow route exactly as deployed: JSON body, idempotency key, server-side principal header. */
  const post = async (method: string, args: unknown[], principal: string | null, key = crypto.randomUUID(), flow = FLOW) => {
    const route = backend.routes.find(r => r.name === 'flow')!, path = `/v1/flows/${flow}/${method}`;
    try {
      const response = await route.handler({ method: 'POST', path, query: new URLSearchParams(), body: { args }, requestId: 'r',
        headers: { 'idempotency-key': key, ...principal ? { [WALLET_PRINCIPAL_HEADER]: principal } : {} } }, route.pattern.exec(path)!);
      return response.body as FlowResult;
    } catch (error) { if (error instanceof HttpError) return { ok: false, code: `HTTP_${error.status}_${error.message}` } as FlowResult; throw error; }
  };
  const get = async (name: string, path: string, principal: string | null, query = new URLSearchParams()) => {
    const route = backend.routes.find(r => r.name === name)!;
    try {
      const response = await route.handler({ method: 'GET', path, query, body: null, requestId: 'r', headers: principal ? { [WALLET_PRINCIPAL_HEADER]: principal } : {} },
        route.pattern.exec(path)!);
      return { status: response.status, body: response.body as { ok: boolean; value: unknown } };
    } catch (error) { if (error instanceof HttpError) return { status: error.status, body: { ok: false, value: error.message } }; throw error; }
  };
  return { db, backend, worker, dir, methods, post, get };
}
const due = (db: Database) => db.query(`UPDATE work_items SET available_at = now() WHERE state = 'READY'`);
async function drain(h: RouterHarness, d: Awaited<ReturnType<typeof deployment>>, owner: string, id: string, until: RouterRecord['phase'], rounds = 15) {
  for (let i = 0; i < rounds; i++) {
    await due(d.db); await d.worker.drainOnce();
    const run = ok<RouterRecord>(await d.post('status', [id], owner));
    if (run.phase === until) return run;
    h.advance(5);
  }
  return ok<RouterRecord>(await d.post('status', [id], owner));
}

describe('BUILD-JOURNEY-001 permissionless testnet journey on durable cloud state', () => {
  it('wallet A: create → simulate → review → approve → deposit → restarts → reconcile → evidence; wallet B can neither see nor operate the run', async () => {
    const A = createTestWallet().address, B = createTestWallet().address;
    const h = createRouterHarness({ profile: TESTNET, owner: A, wallets: [B], nonce: 12n }), w = workflow();
    const api1 = await deployment(h);
    expect(ok<string>(await api1.post('mode', [], null))).toBe('harness');
    expect(ok<{ executionEnabled: boolean }>(await api1.post('info', [], null))).toEqual({ executionEnabled: true });
    // Onboarding is the wallet session alone: no allowlist, no operator step, no preconfigured owner.
    expect(await api1.post('simulate', [w, A], null)).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await api1.post('simulate', [w, A], B)).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    expect((await api1.post('simulate', [w, A], A.toUpperCase().replace('0X', '0x'))).ok).toBe(false);
    const run = ok<RouterRecord>(await api1.post('simulate', [w, A], A)), id = run.id;
    expect(run).toMatchObject({ owner: A, phase: 'PREPARED', provenance: 'MOCKED' });
    const otherRun = ok<RouterRecord>(await api1.post('simulate', [w, B], B));
    expect(otherRun.owner).toBe(B);

    // Wallet B, even knowing the run id, gets nothing: no read, no authorization, no resume, no report.
    const diagnostic = { invoked: false, calls: [], code: 'ROUTER_WALLET_PREFLIGHT' };
    for (const [method, args] of [['status', [id]], ['review', [id, run.review.commitment, w]], ['invalidate', [id]], ['invalidate', [id, 'WALLET_CHANGED']],
      ['begin', [id, B, w]], ['begin', [id, A, w]], ['handoff', [id]], ['report', [id, { kind: 'HASH', hash: '0x' + '1'.repeat(64) }]], ['report', [id, { kind: 'REJECTED' }]],
      ['walletFailure', [id, diagnostic]], ['observe', [id]], ['refresh', [id]]] as const)
      expect(await api1.post(method, [...args], B), method).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    expect((await api1.get('run', `/v1/runs/${id}`, B)).status).toBe(404);
    expect((await api1.get('run.journal', `/v1/runs/${id}/journal`, B)).status).toBe(404);
    expect((await api1.get('run.evidence', `/v1/runs/${id}/evidence`, B)).status).toBe(404);
    const listed = async (principal: string) => ((await api1.get('runs', '/v1/runs', principal, new URLSearchParams({ flow: FLOW }))).body.value as { items: { runId: string; ownerAccount: string }[] }).items;
    expect((await listed(B)).map(r => r.runId)).toEqual([otherRun.id]);
    expect((await listed(A)).map(r => [r.runId, r.ownerAccount])).toEqual([[id, A]]);
    expect((await api1.get('run', `/v1/runs/${id}`, A)).status).toBe(200);
    expect(ok<RouterRecord>(await api1.post('status', [id], A))).toMatchObject({ phase: 'PREPARED', authorization: null });

    // Review; an account switch in A's browser clears it; a fresh Review is required.
    ok(await api1.post('review', [id, run.review.commitment, w], A));
    expect(ok<RouterRecord>(await api1.post('invalidate', [id, 'WALLET_CHANGED'], A))).toMatchObject({ phase: 'PREPARED', error: 'ROUTER_WALLET_CHANGED_REVIEW_REQUIRED' });
    expect(await api1.post('begin', [id, A, w], A)).toEqual({ ok: false, code: 'ROUTER_REVIEW_REQUIRED' });
    // A material workflow change after Review is refused server-side, whatever the browser does.
    ok(await api1.post('review', [id, run.review.commitment, w], A));
    expect(await api1.post('begin', [id, A, workflow({ amount: '2' })], A)).toEqual({ ok: false, code: 'ROUTER_SEMANTIC_REVISION_CHANGED' });

    // Refresh after authorization = a new API process: the authorization is durable.
    const api2 = await deployment(h, api1.dir);
    expect(ok<RouterRecord>(await api2.post('status', [id], A)).phase).toBe('AUTHORIZED');
    const approval = ok<RouterBegin>(await api2.post('begin', [id, A, w], A));
    expect(approval.attempt).toMatchObject({ step: 'APPROVAL', state: 'PREPARED', nonce: '12' });
    expect(approval.transaction).toMatchObject({ chainId: '0x14a34', from: A, to: TESTNET.source.usdc });
    ok(await api2.post('handoff', [id], A));
    const approvalHash = h.wallet.send(approval.transaction);
    ok(await api2.post('report', [id, { kind: 'HASH', hash: approvalHash }], A));
    // Refresh after submission: a new process sees the reported hash; the reload's pointer replay of the same hash is a no-op.
    const api3 = await deployment(h, api1.dir);
    expect(ok<RouterRecord>(await api3.post('status', [id], A)).attempts.at(-1)).toMatchObject({ state: 'PENDING', transactionHash: approvalHash });
    ok(await api3.post('report', [id, { kind: 'HASH', hash: approvalHash }], A));
    expect(await api3.post('report', [id, { kind: 'HASH', hash: '0x' + '2'.repeat(64) }], A)).toEqual({ ok: false, code: 'ROUTER_HASH_DIVERGENT' });
    const worker1 = await deployment(h, api1.dir);
    await due(worker1.db); await worker1.worker.drainOnce();
    expect(ok<RouterRecord>(await api3.post('status', [id], A)).attempts.at(-1)).toMatchObject({ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true });

    // Deposit: the wallet's answer is lost (ambiguous). It is observed, never resent; a second attempt is refused meanwhile.
    const api4 = await deployment(h, api1.dir);
    const deposit = ok<RouterBegin>(await api4.post('begin', [id, A, w], A));
    expect(deposit.attempt.step).toBe('DEPOSIT');
    ok(await api4.post('handoff', [id], A));
    h.wallet.send(deposit.transaction);
    expect(ok<RouterRecord>(await api4.post('report', [id, { kind: 'UNKNOWN', code: 'ROUTER_SUBMISSION_UNKNOWN' }], A)).attempts.at(-1)!.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    expect(await api4.post('begin', [id, A, w], A)).toEqual({ ok: false, code: 'ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING' });
    // A key replayed under another wallet session is a conflict, never a replay of A's answer.
    const key = crypto.randomUUID();
    ok(await api4.post('observe', [id], A, key));
    expect(await api4.post('observe', [id], B, key)).toEqual({ ok: false, code: 'HTTP_409_IDEMPOTENCY_KEY_REUSED' });

    // A fresh worker (restart) rediscovers the deposit on chain and reconciles both chains.
    const worker2 = await deployment(h, api1.dir);
    const final = await drain(h, worker2, A, id, 'RECONCILED');
    expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED', owner: A });
    expect(final.attempts.at(-1)).toMatchObject({ step: 'DEPOSIT', state: 'CONFIRMED', reconciled: true });
    expect(final.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
    await due(worker2.db); await worker2.worker.drainOnce();            // the outbox archives the Evidence Bundle
    const evidence = await api4.get('run.evidence', `/v1/runs/${id}/evidence`, A);
    expect(evidence.body.value).toEqual([expect.objectContaining({ verified: true, bundleHash: final.evidence!.bundleHash, environment: 'MOCKED', outcome: 'RECONCILED' })]);
    expect((await api4.get('run.evidence', `/v1/runs/${id}/evidence`, B)).status).toBe(404);
    expect(h.counters.sends).toBe(2);

    // The execution library is a canonical workflow identity, separate from Dashboard's run/evidence routes.
    const ownerA: WorkflowOwner = { namespace: 'eip155', address: A }, ownerB: WorkflowOwner = { namespace: 'eip155', address: B };
    const library = async (owner: WorkflowOwner) => ok<WorkflowList>(await api4.backend.callWorkflows('list', [], owner));
    expect((await library(ownerA)).items).toEqual([expect.objectContaining({ workflowId: w.workflowId, saved: false, runCount: 1 })]);
    expect((await library(ownerB)).items).toEqual([]); // B's simulation has never reached the wallet.
    const reopened = ok<WorkflowDocument>(await api4.backend.callWorkflows('get', [w.workflowId], ownerA));
    expect(reopened.workflow).toEqual(w);
    for (const key of ['authorization', 'review', 'quote', 'evidence', 'attempts']) expect(reopened).not.toHaveProperty(key);
    expect(await api4.backend.callWorkflows('get', [w.workflowId], ownerB)).toEqual({ ok: false, code: 'WORKFLOW_NOT_FOUND' });
    ok(await api4.backend.callWorkflows('save', [{ workflow: w, name: 'Base → Arbitrum bridge', expectedVersion: 0 }], ownerA));
    expect((await library(ownerA)).items).toEqual([expect.objectContaining({ workflowId: w.workflowId, saved: true, runCount: 1, name: 'Base → Arbitrum bridge' })]);
    const unused = { ...workflow({ amount: '3' }), workflowId: 'saved-unused-' + crypto.randomUUID() };
    ok(await api4.backend.callWorkflows('save', [{ workflow: unused, name: 'Saved, never executed', expectedVersion: 0 }], ownerA));
    expect((await library(ownerA)).items.find(item => item.workflowId === unused.workflowId)).toMatchObject({ saved: true, runCount: 0 });
    const second = ok<RouterRecord>(await api4.post('simulate', [w, A], A));
    ok(await api4.post('review', [second.id, second.review.commitment, w], A));
    const next = ok<RouterBegin>(await api4.post('begin', [second.id, A, w], A));
    ok(await api4.post('handoff', [second.id], A));
    ok(await api4.post('report', [second.id, { kind: 'HASH', hash: h.wallet.send(next.transaction) }], A));
    expect((await library(ownerA)).items.filter(item => item.workflowId === w.workflowId)).toEqual([expect.objectContaining({ saved: true, runCount: 2 })]);
    // An executed record with no matching canonical IR must not become a broken sidebar entry.
    await api4.db.query('INSERT INTO workflows (tenant_id,workflow_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['default', unused.workflowId]);
    await api4.db.query('UPDATE execution_runs SET workflow_id=$1 WHERE run_id=$2', [unused.workflowId, second.id]);
    // The saved document still restores safely, independent of the malformed execution projection.
    expect(ok<WorkflowDocument>(await api4.backend.callWorkflows('get', [unused.workflowId], ownerA)).workflow).toEqual(unused);
    await api4.db.query('DELETE FROM saved_workflows WHERE workflow_id=$1', [unused.workflowId]);
    expect((await library(ownerA)).items.some(item => item.workflowId === unused.workflowId)).toBe(false);
    expect(await api4.backend.callWorkflows('get', [unused.workflowId], ownerA)).toEqual({ ok: false, code: 'WORKFLOW_NOT_FOUND' });
    expect((await api4.get('run.evidence', `/v1/runs/${id}/evidence`, A)).body.value).toEqual([expect.objectContaining({ verified: true })]);
    for (const d of [worker1, worker2]) expect(d.methods.filter(m => SEND.includes(m))).toEqual([]);
    const projected = await t.db.query(`SELECT flow, status, provenance, owner_account, has_evidence FROM execution_runs WHERE run_id = $1`, [id]);
    expect(projected.rows[0]).toEqual({ flow: FLOW, status: 'RECONCILED', provenance: 'MOCKED', owner_account: A, has_evidence: true });
    // Operator access (bearer token, no wallet principal) still sees the tenant.
    expect((await api4.get('run', `/v1/runs/${id}`, null)).status).toBe(200);
  });
  it('an unfilled deposit is recovered as a verified refund by workers; testnet and mainnet guards never collide for the same wallet', async () => {
    const A = createTestWallet().address;
    const h = createRouterHarness({ profile: TESTNET, owner: A, nonce: 4n, autoFillSeconds: null }), w = workflow({ routing: 'ACROSS' });
    const mainnet = createRouterHarness({ owner: A, nonce: 4n });
    const d = await deployment(h, undefined, mainnet);
    const run = ok<RouterRecord>(await d.post('simulate', [w, A], A)), id = run.id;
    ok(await d.post('review', [id, run.review.commitment, w], A));
    // Same wallet, same nonce, other network: each network is its own flow and durable namespace, so a PREPARED testnet attempt
    // (which holds the owner+nonce guard) never blocks the mainnet run, and neither network can read the other's run.
    const mw = workflow({ source: 'Base', destination: 'Arbitrum', amount: '10', routing: 'ACROSS' });
    const mainRun = ok<RouterRecord>(await d.post('simulate', [mw, A], A, undefined, 'crosschain-router'));
    ok(await d.post('review', [mainRun.id, mainRun.review.commitment, mw], A, undefined, 'crosschain-router'));
    expect(await d.post('status', [mainRun.id], A)).toEqual({ ok: false, code: 'ROUTER_RUN_NOT_FOUND' });
    expect(await d.post('simulate', [mw, A], A)).toEqual({ ok: false, code: 'ROUTER_NETWORK_MISMATCH' });
    const testnetFirst = ok<RouterBegin>(await d.post('begin', [id, A, w], A));
    const mainnetSecond = ok<RouterBegin>(await d.post('begin', [mainRun.id, A, mw], A, undefined, 'crosschain-router'));
    expect([testnetFirst.attempt.nonce, mainnetSecond.attempt.nonce, testnetFirst.transaction.chainId, mainnetSecond.transaction.chainId]).toEqual(['4', '4', '0x14a34', '0x2105']);
    ok(await d.post('walletFailure', [id, { invoked: false, calls: [], code: 'ROUTER_WALLET_PREFLIGHT' }], A));   // the browser stopped before the wallet
    ok(await d.post('review', [id, run.review.commitment, w], A));
    for (const step of ['APPROVAL', 'DEPOSIT']) {
      const begun = ok<RouterBegin>(await d.post('begin', [id, A, w], A));
      expect(begun.attempt.step).toBe(step);
      ok(await d.post('handoff', [id], A));
      ok(await d.post('report', [id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) }], A));
      await due(d.db); await d.worker.drainOnce();
    }
    expect(['SOURCE_CONFIRMED', 'IN_FLIGHT']).toContain(ok<RouterRecord>(await d.post('status', [id], A)).phase);   // settling; no fill yet
    h.advance(7_300);
    const recovery = await drain(h, d, A, id, 'RECOVERY_REQUIRED');
    expect(recovery).toMatchObject({ phase: 'RECOVERY_REQUIRED', error: 'ROUTER_FILL_DEADLINE_PASSED_REFUND_EXPECTED' });
    expect((await t.db.query(`SELECT needs_observation FROM execution_runs WHERE run_id = $1`, [id])).rows[0]).toEqual({ needs_observation: true });
    h.relayer.refund();
    const refunded = await drain(h, d, A, id, 'REFUNDED');
    expect(refunded).toMatchObject({ phase: 'REFUNDED', verdict: 'REFUNDED', refund: { amount: '1000000', recipient: A } });
    expect(h.counters.sends).toBe(2);
    expect(d.methods.filter(m => SEND.includes(m))).toEqual([]);
  });
});

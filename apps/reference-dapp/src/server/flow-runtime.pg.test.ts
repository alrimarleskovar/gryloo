// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: the embedded runtime that a Vercel deployment runs, on a disposable loopback PostgreSQL with MOCKED
 * in-process chains (no public network, no broadcast; the only "wallet" is the test calling MOCK_submit, as in the existing
 * suites). Every step runs on a NEW runtime instance — a fresh pool and service map, exactly what a serverless platform may
 * give each request — so nothing can depend on process memory.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createRobinhoodTransferChain, TRANSFER_OWNER as owner } from '../../e2e/robinhood-transfer-harness.mjs';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { TransferRecord } from './robinhood-transfer-service.ts';
import { cloudFlow, cloudRuns, createEmbeddedRuntime } from './flow-runtime.ts';

const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'rh-embedded', revision: 1, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain: 'eip155:46630', amount: '1000000000000', recipient: 'CONNECTED_OWNER' })] };
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

/** A Vercel Preview of `branch`, running the embedded runtime against the test database with MOCKED chains. */
const preview = (branch: string, extra: Record<string, string> = {}) => ({ FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: branch, GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY', ...extra });
let nonce = 300;
function deployment(env: Record<string, string>, chain = createRobinhoodTransferChain({ nonce: nonce++ })) {
  /** One request on a brand-new instance: open, call, close. */
  const call = async <T>(method: string, ...args: unknown[]): Promise<{ ok: true; value: T } | { ok: false; code: string }> => {
    const instance = await createEmbeddedRuntime(env, { rpc: { 'robinhood-transfer': chain.rpc }, busyRetries: 3 });
    try { return await instance.backend.callFlow('robinhood-transfer', method, args) as { ok: true; value: T } | { ok: false; code: string }; }
    finally { await instance.close(); }
  };
  return { chain, call };
}
function ok<T>(result: { ok: true; value: T } | { ok: false; code: string }): T { if (!result.ok) throw new Error(result.code); return result.value; }

describe('BUILD-CLOUD-PARITY-001 embedded runtime (Vercel functions on PostgreSQL)', () => {
  it('a complete owner-signed journey where every request lands on a different instance, with one transaction', async () => {
    const d = deployment(preview('feature/cloud-a'));
    const simulated = ok<TransferRecord>(await d.call('simulate', workflow, owner));
    const reviewed = ok<TransferRecord>(await d.call('review', simulated.id, simulated.review.commitment, workflow));
    const begin = ok<{ record: TransferRecord; transaction: Record<string, string> }>(await d.call('begin', reviewed.id, owner, workflow));
    expect(begin.record.attempt?.state).toBe('PREPARED');
    ok(await d.call('handoff', reviewed.id));
    const hash = await d.chain.rpc('MOCK_submit', [begin.transaction]) as string;   // the owner's wallet, the only submitter
    ok(await d.call('report', reviewed.id, { kind: 'HASH', hash }));
    // The function that recorded the hash is gone; a later request on another instance reconciles from PostgreSQL.
    const observed = ok<TransferRecord>(await d.call('observe', reviewed.id));
    expect(observed).toMatchObject({ verdict: 'RECONCILED', attempt: { state: 'CONFIRMED', reconciled: true, transactionHash: hash } });
    expect(observed.evidence).not.toBeNull();
    expect(d.chain.transactions).toHaveLength(1);
    // A repeated begin after reconciliation never prepares a second transaction.
    expect((await d.call('begin', reviewed.id, owner, workflow)).ok).toBe(false);
    expect(d.chain.transactions).toHaveLength(1);
    const { rows } = await t.db.query<{ tenant_id: string; status: string }>(`SELECT tenant_id, status FROM execution_runs WHERE run_id = $1`, [reviewed.id]);
    expect(rows).toEqual([{ tenant_id: expect.stringMatching(/^pv-feature-cloud-a-[0-9a-f]{8}$/), status: 'RECONCILED' }]);
  });
  it('Preview branches are isolated tenants; a redeploy of the same branch keeps its runs', async () => {
    const a = deployment(preview('feature/iso-a')), simulated = ok<TransferRecord>(await a.call('simulate', workflow, owner));
    const redeployed = deployment(preview('feature/iso-a', { VERCEL_DEPLOYMENT_ID: 'dpl_second' }), a.chain);
    expect(ok<TransferRecord>(await redeployed.call('status', simulated.id)).id).toBe(simulated.id);
    const other = deployment(preview('feature/iso-b'), a.chain);
    expect(await other.call('status', simulated.id)).toEqual({ ok: false, code: 'TRANSFER_SERVICE_UNAVAILABLE' });
    expect((await other.call('review', simulated.id, simulated.review.commitment, workflow)).ok).toBe(false);
    const { rows } = await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM execution_runs WHERE run_id = $1`, [simulated.id]);
    expect(rows[0]!.n).toBe(1);
  });
  it('the cached per-instance runtime behind every server action validates arguments and enforces Router ownership', async () => {
    const env = preview('feature/cached', { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' });
    expect(await cloudFlow('robinhood-transfer', 'mode', [], { env })).toEqual({ ok: true, value: 'harness' });
    expect(await cloudFlow('aave-supply', 'mode', [], { env })).toEqual({ ok: true, value: 'off' });
    expect(await cloudFlow('aave-supply', 'simulate', ['not-a-workflow'], { env })).toEqual({ ok: false, code: 'ARGUMENTS_INVALID' });
    expect(await cloudFlow('aave-supply', 'simulate', [{ workflowId: 'w', nodes: [] }, owner], { env })).toEqual({ ok: false, code: 'SUPPLY_PUBLIC_TESTNET_NOT_ENABLED' });
    const shape = { workflowId: 'w', nodes: [] }, other = '0x' + 'b'.repeat(40);
    expect(await cloudFlow('crosschain-router-testnet', 'simulate', [shape, owner], { env })).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await cloudFlow('crosschain-router-testnet', 'simulate', [shape, owner], { env, principal: other })).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    expect(await cloudRuns('crosschain-router-testnet', other, env)).toEqual({ ok: true, value: [] });
  });
  it('fails closed on a database whose schema is behind, and recovers on the next request once migrated', async () => {
    const behind = await createTestDatabase({ migrated: false });
    try {
      const env = { FLOFI_RUNTIME: 'embedded', DATABASE_URL: behind.url, GRYLOO_ROBINHOOD_HARNESS: 'MOCKED_LOOPBACK_ONLY' };
      expect(await cloudFlow('robinhood-transfer', 'mode', [], { env })).toEqual({ ok: false, code: 'SCHEMA_NOT_MIGRATED' });
      const { migrate } = await import('@defi-workflow-engine/cloud-runtime');
      await migrate(behind.db);
      expect(await cloudFlow('robinhood-transfer', 'mode', [], { env })).toEqual({ ok: true, value: 'harness' });
    } finally { await behind.drop(); }
  });
});

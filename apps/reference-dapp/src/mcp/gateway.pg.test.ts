// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001 on the embedded runtime a Vercel Preview runs (BUILD-CLOUD-PARITY-001): a disposable loopback PostgreSQL and
 * MOCKED in-process Base Sepolia / Arbitrum Sepolia chains and providers. MCP previews leave zero rows; the owner's own journey
 * (wallet-session principal, Review, the test's "wallet" sending) creates the durable run; MCP then reads it only through an
 * operator-granted wallet, never across credentials or tenants. No public network, no real transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createRouterHarness, ROUTER_OWNER, type RouterHarness } from '../../e2e/router-harness.ts';
import { createEmbeddedRuntime } from '../server/flow-runtime.ts';
import type { RouterBegin, RouterRecord } from '../server/router-service.ts';
import { credential, gatewayEnv, session } from './gateway.test-harness';
import { embeddedMcpRuntime } from './runtime';

const FLOW = 'crosschain-router-testnet';
const STRATEGY = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const alice = { principal: 'dev-alice', token: credential(), wallets: [ROUTER_OWNER] };
const bob = { principal: 'dev-bob', token: credential(), wallets: ['0x' + '7'.repeat(40)] };
const carol = { principal: 'dev-carol', token: credential() };
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
function ok<T>(result: { ok: boolean; value?: unknown; code?: string }): T { if (!result.ok) throw new Error(result.code); return result.value as T; }

/** A Vercel Preview of `branch` on the embedded runtime; each call gets a brand-new instance (a fresh serverless function). */
function preview(h: RouterHarness, branch: string) {
  const env = { FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch, GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY',
    ...gatewayEnv([alice, bob, carol]) };
  const instance = () => createEmbeddedRuntime(env, { rpc: { [FLOW]: h.baseRpc }, routers: { [FLOW]: { destinationRpc: h.arbitrumRpc, providers: h.providers } }, busyRetries: 3 });
  /** The owner's browser through the DApp: the server action forwards the verified wallet-session principal. */
  const owner = async <T>(method: string, ...args: unknown[]) => { const i = await instance(); try { return ok<T>(await i.backend.callFlow(FLOW, method, args, undefined, ROUTER_OWNER)); } finally { await i.close(); } };
  /** One MCP request on a fresh instance. */
  const mcp = async (client: { token: string }, tool: string, args: unknown) => {
    const i = await instance();
    try { return await session({ env, token: client.token, runtime: embeddedMcpRuntime(i) }).callTool(tool, args); } finally { await i.close(); }
  };
  return { env, owner, mcp };
}
const count = async (table: string) => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

describe('BUILD-MCP-001 gateway on the embedded PostgreSQL runtime', () => {
  it('previews persist nothing; the owner\'s run is readable only through an operator-granted wallet', async () => {
    const h = createRouterHarness({ profile: TESTNET, nonce: 11n }), p = preview(h, 'claude/build-mcp-001');
    const composed = (await p.mcp(alice, 'compose_strategy', { strategy: STRATEGY })).output;
    const simulated = await p.mcp(alice, 'simulate_strategy', { strategy: STRATEGY, workflowHash: composed.workflowHash, simulationSubject: ROUTER_OWNER });
    expect(simulated.output).toMatchObject({ ok: true, flow: FLOW, provenance: 'MOCKED', persisted: false, authorizable: false });
    for (const table of ['execution_logs', 'execution_log_segments', 'execution_runs', 'execution_attempts', 'journal_entries', 'execution_leases', 'work_items', 'api_idempotency', 'workflows', 'evidence_objects']) expect(await count(table), table).toBe(0);
    expect(h.counters.sends).toBe(0);

    // The owner's own journey, exactly as the DApp runs it (MCP plays no part): the IR is the one MCP composed.
    const w = composed.workflow as SemanticWorkflow;
    const run = await p.owner<RouterRecord>('simulate', w, ROUTER_OWNER);
    await p.owner('review', run.id, run.review.commitment, w);
    for (const step of ['APPROVAL', 'DEPOSIT']) {
      const begun = await p.owner<RouterBegin>('begin', run.id, ROUTER_OWNER, w);
      expect(begun.attempt.step).toBe(step);
      await p.owner('handoff', run.id);
      await p.owner('report', run.id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) });
      await p.owner('observe', run.id);
    }
    let final = await p.owner<RouterRecord>('observe', run.id);
    for (let i = 0; i < 12 && final.phase !== 'RECONCILED'; i++) { h.advance(5); final = await p.owner<RouterRecord>('observe', run.id); }
    expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });

    const status = await p.mcp(alice, 'get_execution_status', { executionId: run.id, journalLimit: 5 });
    expect(status.output).toMatchObject({ ok: true, executionId: run.id, flow: FLOW, status: 'RECONCILED', provenance: 'MOCKED', owner: ROUTER_OWNER, hasEvidence: true });
    expect((status.output.attempts as { step: string; state: string }[]).map(a => `${a.step}:${a.state}`)).toEqual(['APPROVAL:CONFIRMED', 'DEPOSIT:CONFIRMED']);
    const evidence = await p.mcp(alice, 'get_evidence', { executionId: run.id });
    expect(evidence.output).toMatchObject({ ok: true, evidence: { environment: 'MOCKED', outcome: 'RECONCILED', canonical: true, bundleHash: final.evidence!.bundleHash,
      canonicalBundle: { environment: 'MOCKED', outcome: 'RECONCILED' } } });

    // Another credential (other or no wallet grants) and another Preview tenant see nothing — identical to an unknown id.
    for (const [client, d] of [[bob, p], [carol, p], [alice, preview(h, 'claude/other-branch')]] as const) {
      for (const tool of ['get_execution_status', 'get_evidence'])
        expect((await d.mcp(client, tool, { executionId: run.id })).output, `${tool}`).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    }
    expect((await p.mcp(alice, 'get_execution_status', { executionId: 'xroute-' + 'f'.repeat(32) })).output).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    // MCP never moved anything: the only sends were the owner's two wallet transactions.
    expect(h.counters.sends).toBe(2);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the in-chat execution journey on the embedded PostgreSQL runtime a Vercel Preview runs, with MOCKED loopback Base
 * Sepolia / Arbitrum Sepolia chains and providers (no public network, no real transaction):
 *
 *   OAuth consumer → compose_strategy → request_user_approval → (FloFi) wallet-proven claim → applied proposal → the owner's own
 *   unchanged router journey (simulate → Review → two wallet-signed transactions → reconciliation) → get_execution_progress /
 *   get_approval_status report the run and its evidence back to the chat while the owner shares them → wallet links for
 *   get_execution_status.
 *
 * MCP never calls a flow method that could authorize or send; the only "sends" are the owner's two wallet transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createRouterHarness, ROUTER_OWNER, type RouterHarness } from '../../../e2e/router-harness.ts';
import { composeStrategy } from '../../engine/strategy-engine';
import { createEmbeddedRuntime } from '../../server/flow-runtime.ts';
import type { RouterBegin, RouterRecord } from '../../server/router-service.ts';
import { readHandoffPolicy } from '../execution.ts';
import { session } from '../gateway.test-harness.ts';
import { deriveKey } from '../oauth/config.ts';
import { credentialDigest, credentialOf } from '../oauth/crypto.ts';
import { oauthClient, oauthEnv, OAUTH_SECRET, signIn } from '../oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from '../oauth/pg-store.ts';
import { stateOf } from '../oauth/state.ts';
import { embeddedMcpRuntime } from '../runtime.ts';
import { CLAIM_SECONDS, verifyHandoff } from './service.ts';

const FLOW = 'crosschain-router-testnet';
const STRATEGY = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const HANDOFF_KEY = deriveKey(OAUTH_SECRET, 'handoff');
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
function ok<T>(result: { ok: boolean; value?: unknown; code?: string }): T { if (!result.ok) throw new Error(result.code); return result.value as T; }

/** One Preview deployment of the branch; every call gets a brand-new serverless instance. */
function deployment(h: RouterHarness) {
  const env = { FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-mcp-002', GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY',
    FLOFI_MCP: 'enabled', ...oauthEnv() };
  const instance = () => createEmbeddedRuntime(env, { rpc: { [FLOW]: h.baseRpc }, routers: { [FLOW]: { destinationRpc: h.arbitrumRpc, providers: h.providers } }, busyRetries: 3 });
  const within = async <T>(work: (i: Awaited<ReturnType<typeof instance>>) => Promise<T>) => { const i = await instance(); try { return await work(i); } finally { await i.close(); } };
  const owner = <T>(method: string, ...args: unknown[]) => within(async i => ok<T>(await i.backend.callFlow(FLOW, method, args, undefined, ROUTER_OWNER)));
  const mcp = (token: string, tool: string, args: unknown) => within(i => session({ env, token, runtime: embeddedMcpRuntime(i), state: stateOf({ db: i.db, tenantId: i.tenantId }) })
    .callTool(tool, args));
  const state = <T>(work: (s: ReturnType<typeof stateOf>, runtime: ReturnType<typeof embeddedMcpRuntime>) => Promise<T>) =>
    within(i => work(stateOf({ db: i.db, tenantId: i.tenantId }), embeddedMcpRuntime(i)));
  const connect = (scope: string) => within(i => signIn(oauthClient({ env, store: createPgOAuthStore(i.db, i.tenantId) }), { scope }));
  return { env, owner, mcp, state, connect };
}
async function ownerJourney(d: ReturnType<typeof deployment>, h: RouterHarness, w: SemanticWorkflow) {
  const run = await d.owner<RouterRecord>('simulate', w, ROUTER_OWNER);
  await d.owner('review', run.id, run.review.commitment, w);
  for (const step of ['APPROVAL', 'DEPOSIT']) {
    const begun = await d.owner<RouterBegin>('begin', run.id, ROUTER_OWNER, w);
    expect(begun.attempt.step).toBe(step);
    await d.owner('handoff', run.id);
    await d.owner('report', run.id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) });
    await d.owner('observe', run.id);
  }
  let final = await d.owner<RouterRecord>('observe', run.id);
  for (let i = 0; i < 12 && final.phase !== 'RECONCILED'; i++) { h.advance(5); final = await d.owner<RouterRecord>('observe', run.id); }
  return final;
}

describe('BUILD-MCP-002 in-chat execution journey (embedded runtime, MOCKED chains)', () => {
  it('chat → approval → owner wallet in FloFi → reconciled run and evidence back in the chat; links gate run reads', async () => {
    const h = createRouterHarness({ profile: TESTNET, nonce: 21n }), d = deployment(h);
    const tokens = await d.connect('flofi.strategy flofi.approval flofi.runs');
    const composed = (await d.mcp(tokens.access_token, 'compose_strategy', { strategy: STRATEGY })).output as { strategy: unknown; workflowHash: string; workflow: SemanticWorkflow };
    const approval = (await d.mcp(tokens.access_token, 'request_user_approval', { strategy: composed.strategy, workflowHash: composed.workflowHash })).output as
      { ok: boolean; approvalId: string; approvalUrl: string; gates: { enabledByDeployment: { mockedHarness: boolean } } };
    expect(approval).toMatchObject({ ok: true, status: 'PENDING', authority: 'NONE', gates: { enabledByDeployment: { enabled: true, mockedHarness: true } } });
    expect(h.counters.sends).toBe(0);

    // FloFi /approve: the owner proved ROUTER_OWNER (EIP-4361 session); the server re-verifies and the claim binds that wallet.
    const digest = credentialDigest(HANDOFF_KEY, credentialOf('handoff', decodeURIComponent(new URL(approval.approvalUrl).hash.slice(1)))!);
    const wallet = { namespace: 'eip155' as const, address: ROUTER_OWNER };
    const claimed = await d.state(async (s, runtime) => {
      const h0 = (await s.handoffs.bySecret(digest, new Date()))!, verified = await verifyHandoff(h0, runtime, readHandoffPolicy({}));
      if (!verified.ok) throw new Error(verified.code);
      expect(verified.composition.workflow).toEqual(composed.workflow);
      return { result: await s.handoffs.claim(digest, wallet, new Date(), CLAIM_SECONDS, () => ({ ok: true, share: true })), workflow: verified.composition.workflow };
    });
    expect(claimed.result).toMatchObject({ ok: true, handoff: { status: 'CLAIMED', shareStatus: true } });
    expect((await d.state(s => s.handoffs.apply(digest, wallet, new Date()))).ok).toBe(true);
    expect((await d.mcp(tokens.access_token, 'get_execution_progress', { approvalId: approval.approvalId })).output)
      .toMatchObject({ ok: true, status: 'APPLIED', runs: [], runsVisible: true, authority: 'NONE' });

    // The owner's own, unchanged journey in FloFi with the applied workflow; the wallet signs both transactions.
    const final = await ownerJourney(d, h, claimed.workflow as SemanticWorkflow);
    expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });
    expect(h.counters.sends).toBe(2);

    const progress = (await d.mcp(tokens.access_token, 'get_execution_progress', { approvalId: approval.approvalId })).output as { runs: Record<string, unknown>[] };
    expect(progress).toMatchObject({ ok: true, status: 'APPLIED', runsVisible: true });
    expect(progress.runs).toEqual([{ executionId: final.id, flow: FLOW, status: 'RECONCILED', reconciled: true, terminal: true, errorCode: null, evidenceEnvironment: 'MOCKED',
      evidenceOutcome: 'RECONCILED', evidenceBundleHash: final.evidence!.bundleHash, updatedAt: expect.any(String) }]);
    expect(JSON.stringify(progress)).not.toMatch(/calldata|"transaction|signature"|flofi_hs_/);
    expect((await d.mcp(tokens.access_token, 'get_approval_status', { approvalId: approval.approvalId })).output).toMatchObject({ runs: [{ executionId: final.id }] });
    expect((await t.db.query<{ run_ids: string[] }>('SELECT run_ids FROM mcp_handoffs WHERE handoff_id = $1', [approval.approvalId])).rows[0]!.run_ids).toEqual([final.id]);

    // An edited strategy run by the same wallet after the claim is not this proposal: never attributed to it.
    const edited = composeStrategy({ ...STRATEGY, amount: '4' });
    if (!edited.ok) throw new Error(edited.code);
    await d.owner<RouterRecord>('simulate', edited.workflow, ROUTER_OWNER);
    const again = (await d.mcp(tokens.access_token, 'get_execution_progress', { approvalId: approval.approvalId })).output as { runs: { executionId: string }[] };
    expect(again.runs.map(r => r.executionId)).toEqual([final.id]);

    // The owner stops sharing: the chat sees the approval but no run.
    await d.state(s => s.handoffs.setSharing(digest, wallet, false, new Date()));
    expect((await d.mcp(tokens.access_token, 'get_execution_progress', { approvalId: approval.approvalId })).output)
      .toMatchObject({ runs: [], runsVisible: false, note: expect.stringContaining('not shared') });

    // Run reads through MCP need a wallet the account linked on FloFi; an execution id alone grants nothing.
    const read = () => d.mcp(tokens.access_token, 'get_execution_status', { executionId: final.id });
    expect((await read()).output).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    const account = (await t.db.query<{ account_id: string }>('SELECT account_id FROM mcp_handoffs WHERE handoff_id = $1', [approval.approvalId])).rows[0]!.account_id;
    const linked = await d.state(s => s.links.link(account, wallet, new Date()));
    expect(linked.ok).toBe(true);
    expect((await read()).output).toMatchObject({ ok: true, executionId: final.id, status: 'RECONCILED', owner: ROUTER_OWNER, accessBasis: 'ACCOUNT_LINKED_WALLET' });
    expect((await d.mcp(tokens.access_token, 'get_evidence', { executionId: final.id })).output).toMatchObject({ ok: true, evidence: { environment: 'MOCKED', canonical: true } });
    // Another account, even with the run id and its own token, sees nothing.
    const stranger = await d.connect('flofi.strategy flofi.approval flofi.runs');
    expect((await d.mcp(stranger.access_token, 'get_execution_status', { executionId: final.id })).output).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    expect((await d.mcp(stranger.access_token, 'get_execution_progress', { approvalId: approval.approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_NOT_FOUND' });
    // Revoking the link removes the access at once.
    if (linked.ok) await d.state(s => s.links.revoke(account, linked.link.linkId, new Date()));
    expect((await read()).output).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
    // MCP moved nothing: only the owner's two wallet transactions were ever sent.
    expect(h.counters.sends).toBe(2);
  });
});

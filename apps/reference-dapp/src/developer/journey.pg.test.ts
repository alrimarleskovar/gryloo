// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001 acceptance (MOCKED): a third-party server application integrates FloFi end to end with the SDK alone, on the
 * embedded PostgreSQL runtime a Vercel Preview runs, with MOCKED loopback Base Sepolia / Arbitrum Sepolia chains and providers and a
 * loopback webhook receiver — no public network, no real transaction:
 *
 *   operator: project + sandbox key → SDK: capabilities → immutable strategy → validate → simulate → webhook endpoint → approval →
 *   end user on FloFi /approve: sees the third-party proposal, proves a wallet, opts in to sharing, loads it into FloFi →
 *   the owner's own, unchanged router journey (fresh simulation → Review → two wallet-signed transactions → reconciliation) →
 *   signed webhooks verified by the SDK → SDK: approval status, execution status and the canonical Evidence Bundle.
 *
 * FloFi remains the single execution truth and the developer credential has zero financial authority: the Developer API only reads
 * flow `info` and `status`; the only sends are the owner's two wallet transactions.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { FloFi, verifyWebhook, type WebhookEvent } from '../../../../packages/developer-sdk/src/index.ts';
import { createRouterHarness, ROUTER_OWNER, type RouterHarness } from '../../e2e/router-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { applyApproval, claimApproval, createPgHandoffStore, embeddedEngineRuntime, viewApproval, type WalletRef } from '../platform/index.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { deploymentTenant } from '../server/deployment.ts';
import { createEmbeddedRuntime } from '../server/flow-runtime.ts';
import type { RouterBegin, RouterRecord } from '../server/router-service.ts';
import { createProject, issueSandboxKey } from './admin.ts';
import { developerEnv, developerConfig, ORIGIN } from './developer.test-harness.ts';
import { handleDeveloperRequest } from './http.ts';
import { createPgDeveloperStore } from './pg-store.ts';

const FLOW = 'crosschain-router-testnet';
const STRATEGY = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const DISPATCH_TOKEN = 'journey-scheduler-token-0001';
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
function ok<T>(result: { ok: boolean; value?: unknown; code?: string }): T { if (!result.ok) throw new Error(result.code); return result.value as T; }

/** One Preview deployment of this branch; every request gets a brand-new serverless instance (state lives in PostgreSQL only). */
function deployment(h: RouterHarness) {
  const env = { ...developerEnv({ FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY',
    FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256: createHash('sha256').update(DISPATCH_TOKEN).digest('hex') }),
  FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-developer-001', GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' };
  const flowCalls: string[] = [];
  const instance = () => createEmbeddedRuntime(env, { rpc: { [FLOW]: h.baseRpc }, routers: { [FLOW]: { destinationRpc: h.arbitrumRpc, providers: h.providers } }, busyRetries: 3 });
  const within = async <T>(work: (i: Awaited<ReturnType<typeof instance>>) => Promise<T>) => { const i = await instance(); try { return await work(i); } finally { await i.close(); } };
  /** The Developer API as deployed: the request, then its after() work on the same instance; every flow method it reaches is recorded. */
  const api = (async (input: URL | RequestInfo, init?: RequestInit) => within(async i => {
    const backend = new Proxy(i.backend, { get: (target, key) => key === 'callFlow'
      ? (flow: string, method: string, ...rest: unknown[]) => { flowCalls.push(method); return (target.callFlow as (...a: unknown[]) => unknown)(flow, method, ...rest); }
      : key === 'previewFlow' ? (...args: unknown[]) => { flowCalls.push('previewFlow'); return (target.previewFlow as (...a: unknown[]) => unknown)(...args); }
        : Reflect.get(target, key) });
    const after: (() => Promise<unknown>)[] = [];
    const response = await handleDeveloperRequest(new Request(input, init), { env, host: { db: i.db, tenantId: i.tenantId },
      runtime: embeddedEngineRuntime({ ...i, backend }), schedule: work => { after.push(work); } });
    const body = await response.arrayBuffer();
    for (const work of after) await work();
    return new Response(body, { status: response.status, headers: response.headers });
  })) as typeof fetch;
  const owner = <T>(method: string, ...args: unknown[]) => within(async i => ok<T>(await i.backend.callFlow(FLOW, method, args, undefined, ROUTER_OWNER)));
  const approve = <T>(work: (surface: Awaited<ReturnType<typeof approvalSurface>>) => Promise<T>) =>
    within(async i => work(await approvalSurface(env, () => undefined, { host: { db: i.db, tenantId: i.tenantId }, runtime: embeddedEngineRuntime(i) })));
  return { env, api, owner, approve, within, flowCalls };
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

describe('BUILD-DEVELOPER-001 third-party integration journey (embedded runtime, MOCKED chains, loopback webhooks)', () => {
  it('SDK → strategy → approval → owner wallet in FloFi → reconciled run → signed webhooks → status and evidence; zero financial authority', async () => {
    const received: { headers: IncomingHttpHeaders; body: string }[] = [];
    const receiver = createServer((req, res) => { let body = ''; req.on('data', c => { body += c; }); req.on('end', () => { received.push({ headers: req.headers, body }); res.end(); }); });
    await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
    const h = createRouterHarness({ profile: TESTNET, nonce: 31n }), d = deployment(h);
    try {
      // The operator onboards the integrator: one project, one sandbox key (shown once).
      const tenantId = deploymentTenant(d.env), { key } = await d.within(async i => {
        const deps = { store: createPgDeveloperStore(i.db, tenantId), handoffs: createPgHandoffStore(i.db, tenantId), config: developerConfig(), now: () => new Date() };
        return issueSandboxKey(deps, (await createProject(deps, 'Acme Wallet')).projectId);
      });

      // ── The third-party server: the whole integration is these SDK calls. ──
      const flofi = new FloFi({ apiKey: key, baseUrl: ORIGIN, fetch: d.api });
      const capability = (await flofi.capabilities.list({ network: 'base-sepolia', action: 'bridge' })).data.find(r => r.destinationNetwork === 'arbitrum-sepolia')!;
      expect(capability.operations).toMatchObject({ compose: { available: true }, simulate: { available: true }, approve: { available: true } });
      const strategy = await flofi.strategies.create({ strategy: STRATEGY });
      expect((await flofi.strategies.validate(strategy.id)).availability).toMatchObject({ approvable: true, mockedHarness: true });
      const simulation = await flofi.strategies.simulate(strategy.id, { simulationSubject: ROUTER_OWNER });
      expect(simulation).toMatchObject({ kind: 'CROSS_CHAIN_ROUTE', provenance: 'MOCKED', authorizable: false, evidenceLevel: 'MOCKED_SIMULATION_PREVIEW' });
      const endpoint = await flofi.webhookEndpoints.create({ url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/flofi/webhooks` });
      const approval = await flofi.approvals.create({ strategy });
      expect(approval).toMatchObject({ status: 'PENDING', authority: 'NONE', statusShared: false, requires: expect.arrayContaining(['Explicit wallet signature']) });
      expect(h.counters.sends).toBe(0);

      // ── The end user, on FloFi's /approve with the link the app sent: a third-party proposal, a proven wallet, sharing opted in. ──
      const secret = decodeURIComponent(new URL(approval.approvalUrl!).hash.slice(1)), wallet: WalletRef = { namespace: 'eip155', address: ROUTER_OWNER };
      expect(await d.approve(s => viewApproval(s, secret, []))).toMatchObject({ clientName: 'Acme Wallet', requesterKind: 'DEVELOPER_PROJECT', authorized: false, statusShared: false });
      const claimed = await d.approve(s => claimApproval(s, secret, [wallet], true));
      expect(claimed.workflowHash).toBe(strategy.workflowHash);
      // FloFi's proposal card turns the returned command into the editor workflow, which hashes exactly to the approval's workflow.
      const composed = composeStrategy(strategy.strategy);
      if (!composed.ok) throw new Error(composed.code);
      await d.approve(s => applyApproval(s, secret, [wallet], composed.workflow));

      // ── The owner's own FloFi journey: fresh simulation, Review, two wallet signatures, reconciliation. ──
      const final = await ownerJourney(d, h, composed.workflow as SemanticWorkflow);
      expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });
      expect(h.counters.sends).toBe(2);

      // ── Back in the third-party server: status, execution, evidence, and the signed notifications. ──
      const progress = await flofi.approvals.get(approval.id);
      expect(progress).toMatchObject({ status: 'APPLIED', applied: true, statusShared: true, executionsVisible: true,
        executions: [{ id: final.id, status: 'RECONCILED', reconciled: true, terminal: true, evidence: { environment: 'MOCKED', outcome: 'RECONCILED' } }] });
      const execution = await flofi.executions.get(final.id);
      expect(execution).toMatchObject({ id: final.id, approvalId: approval.id, status: 'RECONCILED', provenance: 'MOCKED', reconciled: true, owner: ROUTER_OWNER,
        accessBasis: 'OWNER_SHARED_WITH_PROJECT' });
      expect(execution.attempts.map(a => a.step)).toEqual(expect.arrayContaining(['APPROVAL', 'DEPOSIT']));
      const evidence = await flofi.executions.evidence(final.id);
      expect(evidence.evidence).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED', canonical: true, bundleHash: final.evidence!.bundleHash });

      // The deployment's scheduler delivers what is due (on a Preview without one, the app's own next requests do the same).
      const sweep = await d.api(`${ORIGIN}/api/developer/v1/internal/dispatch`, { headers: { authorization: `Bearer ${DISPATCH_TOKEN}` } });
      expect(sweep.status).toBe(200);
      const events: WebhookEvent[] = [];
      for (const delivery of received)
        events.push(await verifyWebhook({ payload: delivery.body, headers: delivery.headers as Record<string, string>, secret: endpoint.secret! }));
      expect(events.map(e => e.type).sort()).toEqual(['approval.applied', 'approval.claimed', 'execution.reconciled', 'execution.started']);
      expect(events.find(e => e.type === 'execution.reconciled')!.data).toMatchObject({ approvalId: approval.id, strategyId: strategy.id, executionId: final.id,
        evidence: { environment: 'MOCKED', outcome: 'RECONCILED', bundleHash: final.evidence!.bundleHash } });
      expect(new Set(events.map(e => e.id)).size).toBe(4);
      expect(received.map(r => r.body).join('\n')).not.toMatch(new RegExp(`${ROUTER_OWNER.slice(2)}|flofi_dhs_|whsec_|flofi_sk_|"transaction"|calldata`));

      // Zero financial authority: the Developer API only read flow mode, info and status and ran the read-only preview; the owner signed the
      // only two transactions, in FloFi.
      expect(d.flowCalls.filter(m => !['mode', 'info', 'status', 'previewFlow'].includes(m))).toEqual([]);
      expect(d.flowCalls).toEqual(expect.arrayContaining(['previewFlow', 'status']));
      expect(h.counters.sends).toBe(2);
    } finally { await new Promise(resolve => receiver.close(resolve)); }
  });
});

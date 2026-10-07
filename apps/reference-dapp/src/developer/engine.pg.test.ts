// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API runs FloFi's one engine, on a disposable loopback PostgreSQL. Capability discovery, strategy
 * composition, validation and simulation give the same facts, canonical strategies and workflow hashes as MCP; strategies are stored
 * immutably and a changed strategy is a new one; sandbox credentials never reach mainnet; an approval is bound to one strategy revision
 * and enters the shared /approve surface, where only a proven wallet claims it — with the project's name, a third-party disclosure and
 * status sharing OFF by default; runs and evidence reach the developer only while the owner shares them. No call could execute.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import { createLogger, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createBackend } from '../../backend/app.ts';
import { createRouterHarness, ROUTER_OWNER } from '../../e2e/router-harness.ts';
import { composeStrategy, composeWorkflow } from '../engine/strategy-engine';
import { credential, gatewayEnv, session } from '../mcp/gateway.test-harness.ts';
import { applyApproval, claimApproval, createPgHandoffStore, embeddedEngineRuntime, executionPlan, PlatformRefusal, requestApproval, shareApproval, typedId, viewApproval,
  type EngineRuntime, type WalletRef } from '../platform/index.ts';
import type { CloudRun } from '../server/flow-runtime.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { developerApprovalLinkScheme, developerHandoffRules } from './approval-profile.ts';
import { SANDBOX_POLICY } from './config.ts';
import { developerApi, developerConfig, developerEnv, developerProject, ORIGIN, recordingRuntime, READ_ONLY_CALL, type ApiResponse } from './developer.test-harness.ts';
import { limitsOf } from './limits.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const OWNER = '0x' + '1'.repeat(40);
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const SUPPLY = { action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '10', beneficiary: OWNER };
const BORROW = { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '2', beneficiary: OWNER };
const SWAP = { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2' };
const MAINNET = { action: 'bridge', sourceNetwork: 'base', destinationNetwork: 'arbitrum-one', asset: 'USDC', amount: '5' };
type Err = { error: { code: string; reason: string; issues?: unknown[] } };
const errorOf = (r: ApiResponse) => (r.body as unknown as Err).error;
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (e) { return e instanceof PlatformRefusal || e instanceof Error ? e.message : 'UNEXPECTED'; } };
/** Every key of a JSON value, at any depth. */
const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(keysOf)
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : [];

/** The deployment's real backend with MOCKED in-process router chains: previews run the flow's own simulation; nothing is persisted. */
const untouchable = { query: async () => { throw new Error('DB_TOUCHED'); }, close: async () => undefined } as unknown as Database;
function routerRuntime(calls: string[]): EngineRuntime {
  const h = createRouterHarness({ profile: TESTNET });
  const backend = createBackend({ db: untouchable, env: { GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, logger: createLogger({ service: 'test', sink: () => undefined }),
    tenantId: 'default', holderId: 'test', evidenceStore: null, busyRetries: 1, rpc: { 'crosschain-router-testnet': h.baseRpc },
    routers: { 'crosschain-router-testnet': { destinationRpc: h.arbitrumRpc, providers: h.providers } } });
  const inner = embeddedEngineRuntime({ backend, run: async () => null, journal: async () => null });
  return { ...inner, mode: flow => { calls.push(`mode:${flow}`); return inner.mode(flow); }, info: flow => { calls.push(`info:${flow}`); return inner.info!(flow); },
    preview: (flow, args) => { calls.push(`preview:${flow}`); return inner.preview(flow, args); } };
}

describe('BUILD-DEVELOPER-001 one engine: discovery, composition, validation and simulation match MCP', () => {
  it('capability discovery reports the same rows and facts as MCP, without internal names, and sandbox keys see mainnet as unavailable', async () => {
    const calls: string[] = [], runtime = routerRuntime(calls), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const alice = { principal: 'dev-alice', token: credential() }, mcp = session({ env: gatewayEnv([alice]), token: alice.token, runtime });
    const ours = (await api<{ data: Record<string, unknown>[]; ownerExecution: string }>('GET', '/capabilities')).body;
    const theirs = (await mcp.callTool('get_capabilities', {})).output as { capabilities: Record<string, unknown>[] };
    expect(ours.ownerExecution).toBe('IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY');
    expect(ours.data.map(r => `${r.action}:${r.network}:${r.destinationNetwork}`)).toEqual(theirs.capabilities.map(r => `${r.action}:${r.network}:${r.destinationNetwork}`));
    for (const [row, mcpRow] of ours.data.map((r, i) => [r, theirs.capabilities[i]!] as const)) {
      const facts = mcpRow as { supportedByCode: { execute: boolean }; enabledByDeployment: { enabled: boolean }; enabledByPolicy: { enabled: boolean }; demonstratedEvidence: string };
      expect(row.availability).toMatchObject({ supportedByCode: facts.supportedByCode.execute, enabledByDeployment: facts.enabledByDeployment.enabled,
        enabledByPolicy: facts.enabledByPolicy.enabled, demonstratedEvidence: facts.demonstratedEvidence });
      expect(row.exampleStrategy).toEqual(mcpRow.example);
      if (row.fundsClass === 'REAL_FUNDS') expect(row.operations).toMatchObject({ compose: { available: false, reason: 'SANDBOX_TEST_FUNDS_ONLY' },
        approve: { available: false, reason: 'SANDBOX_TEST_FUNDS_ONLY' } });
      expect(row.operations).toMatchObject({ execute: { available: false, reason: 'OWNER_WALLET_IN_FLOFI_ONLY' } });
    }
    const bridge = ours.data.find(r => r.action === 'bridge' && r.network === 'base-sepolia')!;
    expect(bridge).toMatchObject({ operations: { compose: { available: true }, simulate: { available: true }, approve: { available: true, reason: null } },
      availability: { mockedHarness: true } });
    // No flow names or modes, adapters, action types or editor structures leave.
    expect(keysOf(ours).filter(k => ['flow', 'mode', 'adapters', 'actionTypes', 'deployment', 'mcp', 'nodeId', 'workflow'].includes(k))).toEqual([]);
    expect(JSON.stringify(ours)).not.toMatch(/crosschain-router|"harness"/);
    const filtered = (await api<{ data: { action: string; network: string; destinationNetwork: string | null }[] }>('GET', '/capabilities?network=base-sepolia&action=bridge')).body.data;
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every(r => r.action === 'bridge' && (r.network === 'base-sepolia' || r.destinationNetwork === 'base-sepolia'))).toBe(true);
    expect(calls.every(c => READ_ONLY_CALL.test(c))).toBe(true);
  });

  it('stores the canonical strategy with the same workflow hash as MCP for a v1 strategy, a one-step list, the lending composition and a general sequence', async () => {
    const calls: string[] = [], runtime = recordingRuntime({ calls }), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const alice = { principal: 'dev-alice', token: credential() }, mcp = session({ env: gatewayEnv([alice]), token: alice.token, runtime });
    for (const [input, plan] of [[BRIDGE, 'SINGLE_FLOW'], [{ version: 2, steps: [BRIDGE] }, 'SINGLE_FLOW'], [{ version: 2, steps: [SUPPLY, BORROW, SWAP] }, 'COMPOSITE_FLOW'],
      [{ version: 2, steps: [BRIDGE, SWAP] }, 'NOT_EXECUTABLE']] as const) {
      const created = await api<{ id: string; strategy: unknown; workflowHash: string; executionPlan: { kind: string; reason: string | null }; availability: Record<string, unknown>;
        authority: string; validation: { summary: Record<string, number> } }>('POST', '/strategies', { strategy: input });
      const composed = (await mcp.callTool('compose_strategy', { strategy: input })).output as { strategy: unknown; workflowHash: string };
      const validated = (await mcp.callTool('validate_strategy', { strategy: input })).output as { reviewSummary: { block: number; warning: number } };
      expect(created.status, JSON.stringify(input)).toBe(201);
      expect(created.body).toMatchObject({ strategy: composed.strategy, workflowHash: composed.workflowHash, executionPlan: { kind: plan }, authority: 'NONE' });
      expect(created.body.validation.summary).toMatchObject(validated.reviewSummary);
      const row = (await t.db.query('SELECT strategy, workflow_hash, plan FROM developer_strategies WHERE strategy_id = $1', [created.body.id])).rows[0]!;
      expect([row.strategy, row.workflow_hash, (row.plan as { kind: string }).kind]).toEqual([composed.strategy, composed.workflowHash, plan]);
      if (plan === 'NOT_EXECUTABLE') {
        expect(created.body.executionPlan.reason).toBe('MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED');
        expect(created.body.availability).toMatchObject({ approvable: false, reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' });
        expect(errorOf(await api('POST', '/approvals', { strategyId: created.body.id, workflowHash: created.body.workflowHash })))
          .toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED', reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' });
        expect(errorOf(await api('POST', `/strategies/${created.body.id}/simulate`, { simulationSubject: OWNER })))
          .toMatchObject({ code: 'CAPABILITY_NOT_SUPPORTED', reason: 'SIMULATE_ONE_STEP_AT_A_TIME' });
      }
    }
    // Engine refusals keep the engine's code; nothing is stored for them.
    const before = (await t.db.query('SELECT count(*)::int AS n FROM developer_strategies')).rows[0]!.n;
    expect(errorOf(await api('POST', '/strategies', { strategy: { ...BRIDGE, amount: '-1' } }))).toMatchObject({ code: 'INVALID_STRATEGY' });
    const mainnet = await api('POST', '/strategies', { strategy: MAINNET });
    expect([mainnet.status, errorOf(mainnet).code, errorOf(mainnet).reason]).toEqual([403, 'MAINNET_DISABLED', 'SANDBOX_TEST_FUNDS_ONLY']);
    expect(errorOf(await api('POST', '/strategies', { strategy: { version: 2, steps: [BRIDGE, MAINNET] } }))).toMatchObject({ code: 'MAINNET_DISABLED' });
    expect((await t.db.query('SELECT count(*)::int AS n FROM developer_strategies')).rows[0]!.n).toBe(before);
    expect(calls.every(c => READ_ONLY_CALL.test(c))).toBe(true);
  });

  it('validates against the current engine, and refuses a stored strategy the engine no longer reproduces (stale) everywhere', async () => {
    const runtime = recordingRuntime(), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const created = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const validated = await api<Record<string, unknown>>('POST', `/strategies/${created.id}/validate`);
    expect(validated.body).toMatchObject({ object: 'strategy_validation', strategyId: created.id, workflowHash: created.workflowHash, reproducible: true,
      validation: { valid: true }, availability: { approvable: true, reason: null }, executionPlan: { kind: 'SINGLE_FLOW' }, authority: 'NONE' });
    // A row whose hash the current engine does not reproduce (as after an engine change): stale for validate, simulate and approvals.
    const c = composeWorkflow(BRIDGE);
    if (!c.ok) throw new Error(c.code);
    const staleId = typedId('str'), staleHash = '0x' + 'e'.repeat(64);
    await t.db.query(`INSERT INTO developer_strategies (tenant_id, strategy_id, project_id, environment, strategy, workflow_hash, engine_version, funds_class, network_environment, plan)
      SELECT tenant_id, $1, project_id, environment, strategy, $2, engine_version, funds_class, network_environment, plan FROM developer_strategies WHERE strategy_id = $3`,
    [staleId, staleHash, created.id]);
    for (const [path, body] of [[`/strategies/${staleId}/validate`, {}], [`/strategies/${staleId}/simulate`, { simulationSubject: OWNER }], ['/approvals', { strategyId: staleId, workflowHash: staleHash }]] as const)
      expect(errorOf(await api('POST', path, body)), path).toMatchObject({ code: 'STRATEGY_STALE', reason: 'STRATEGY_STALE' });
  });

  it('simulates with the flow\'s own read-only preview, exactly as MCP does, and nothing is persisted, sent or authorizable', async () => {
    const calls: string[] = [], runtime = routerRuntime(calls), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const alice = { principal: 'dev-alice', token: credential() }, mcp = session({ env: gatewayEnv([alice]), token: alice.token, runtime });
    const created = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const ours = await api<Record<string, unknown> & { facts: Record<string, Record<string, unknown>> }>('POST', `/strategies/${created.id}/simulate`, { simulationSubject: ROUTER_OWNER });
    const theirs = (await mcp.callTool('simulate_strategy', { strategy: BRIDGE, workflowHash: created.workflowHash, simulationSubject: ROUTER_OWNER })).output as
      Record<string, unknown> & { facts: Record<string, Record<string, unknown>> };
    expect(ours.status, ours.text).toBe(200);
    expect(ours.body).toMatchObject({ object: 'simulation', strategyId: created.id, workflowHash: created.workflowHash, kind: 'CROSS_CHAIN_ROUTE', provenance: 'MOCKED',
      simulationSubject: ROUTER_OWNER, subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION', preview: true, persisted: false, authorizable: false,
      evidenceLevel: 'MOCKED_SIMULATION_PREVIEW', authority: 'NONE' });
    for (const field of ['kind', 'provenance', 'evidenceLevel', 'simulationSubject', 'workflowHash'] as const) expect(ours.body[field], field).toEqual(theirs[field]);
    expect(Object.keys(ours.body.facts).sort()).toEqual(Object.keys(theirs.facts).sort());
    expect(ours.body.facts.quote).toMatchObject({ provider: theirs.facts.quote!.provider, inputAmount: theirs.facts.quote!.inputAmount });
    expect(keysOf(ours.body).filter(k => /^(data|calldata|transaction|unsignedTransaction|signature|commitment|flow)$/.test(k))).toEqual([]);
    expect(calls.filter(c => c.startsWith('preview:'))).toEqual(['preview:crosschain-router-testnet', 'preview:crosschain-router-testnet']);

    // A Solana key is no subject for an EVM flow; the hourly simulation budget is per project.
    expect(errorOf(await api('POST', `/strategies/${created.id}/simulate`, { simulationSubject: 'So11111111111111111111111111111111111111112' })))
      .toMatchObject({ code: 'INVALID_REQUEST', reason: 'SIMULATION_SUBJECT_INVALID' });
    expect(errorOf(await api('POST', `/strategies/${created.id}/simulate`, {}))).toMatchObject({ code: 'INVALID_REQUEST', reason: 'SCHEMA_INVALID' });
    const now = new Date(), hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    await t.db.query(`INSERT INTO mcp_rate_limits (tenant_id, bucket, window_start, count) VALUES ('default', $1, $2, 30)
      ON CONFLICT (tenant_id, bucket, window_start) DO UPDATE SET count = 30`, [`dev:${p.projectId}:sandbox:simulations`, hour]);
    const limited = await developerApi({ db: t.db, runtime, now: () => now }, p.key)('POST', `/strategies/${created.id}/simulate`, { simulationSubject: ROUTER_OWNER });
    expect([limited.status, errorOf(limited).reason]).toEqual([429, 'SIMULATIONS_PER_HOUR']);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // A flow that cannot simulate here is SIMULATION_FAILED with the flow's own code.
    const q = await developerProject(t.db), failing = developerApi({ db: t.db, runtime: recordingRuntime() }, q.key);
    const other = (await failing<{ id: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    expect(errorOf(await failing('POST', `/strategies/${other.id}/simulate`, { simulationSubject: ROUTER_OWNER }))).toMatchObject({ code: 'SIMULATION_FAILED', reason: 'PREVIEW_UNAVAILABLE_IN_TEST' });
  });
});

describe('BUILD-DEVELOPER-001 approvals: bound to one strategy revision, claimed only by a proven wallet in FloFi', () => {
  it('binds the approval to the exact strategy revision; a changed strategy is a new strategy with its own approval', async () => {
    const runtime = recordingRuntime(), p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const five = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const four = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: { ...BRIDGE, amount: '4' } })).body;
    expect([four.id === five.id, four.workflowHash === five.workflowHash]).toEqual([false, false]);
    const changed = await api('POST', '/approvals', { strategyId: five.id, workflowHash: four.workflowHash });
    expect([changed.status, errorOf(changed).code, errorOf(changed).reason]).toEqual([409, 'STRATEGY_CHANGED', 'WORKFLOW_HASH_MISMATCH']);
    const approval = await api<Record<string, unknown> & { id: string; approvalUrl: string }>('POST', '/approvals', { strategyId: five.id, workflowHash: five.workflowHash });
    expect(approval.status).toBe(201);
    expect(approval.body).toMatchObject({ object: 'approval', environment: 'sandbox', strategyId: five.id, workflowHash: five.workflowHash, status: 'PENDING', claimed: false,
      applied: false, statusShared: false, executions: [], executionsVisible: false, walletNamespace: 'eip155', fundsClass: 'TEST_FUNDS', authority: 'NONE',
      requires: ['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'] });
    expect(approval.body.approvalUrl).toMatch(/^https:\/\/flofi\.test\/approve#flofi_dhs_[A-Za-z0-9_-]{43}$/);
    expect((await t.db.query('SELECT strategy_id, workflow_hash, project_id FROM developer_approvals WHERE handoff_id = $1', [approval.body.id])).rows[0])
      .toEqual({ strategy_id: five.id, workflow_hash: five.workflowHash, project_id: p.projectId });
    const read = await api<Record<string, unknown>>('GET', `/approvals/${approval.body.id}`);
    expect(read.body).toMatchObject({ id: approval.body.id, status: 'PENDING', approvalUrl: null, approvalUrlExpiresAt: null });
    // Many end users may share one workflow: a second approval for the same strategy does not supersede the first.
    const second = await api<{ id: string }>('POST', '/approvals', { strategyId: five.id, workflowHash: five.workflowHash });
    expect((await api<{ status: string }>('GET', `/approvals/${approval.body.id}`)).body.status).toBe('PENDING');
    expect(second.body.id).not.toBe(approval.body.id);
  });

  it('enters the shared /approve surface: a developer link resolves for its kind only, names the project, and needs a proven wallet to claim', async () => {
    const calls: string[] = [], runs: string[] = [], WALLET: WalletRef = { namespace: 'eip155', address: OWNER };
    const strategy = composeStrategy(BRIDGE);
    if (!strategy.ok) throw new Error(strategy.code);
    let claimedAt = 0;
    const runtime = recordingRuntime({ calls,
      runList: async (flow, owner) => ({ ok: true, value: owner === OWNER && claimedAt ? [{ runId: 'run-dev-1', flow, status: 'RECONCILED', ownerAccount: owner, hasEvidence: true,
        updatedAt: new Date(claimedAt + 5_000).toISOString() }] : [] }),
      runs: async (runId, owner) => { runs.push(runId); return { ok: true, value: owner === OWNER && runId === 'run-dev-1' && claimedAt ? { runId, workflowId: 'w', flow: 'crosschain-router-testnet',
        status: 'RECONCILED', provenance: 'MOCKED', ownerAccount: owner, errorCode: null, needsObservation: false, attentionRequired: false, hasEvidence: true,
        createdAt: new Date(claimedAt + 1_000).toISOString(), updatedAt: new Date(claimedAt + 5_000).toISOString(),
        attempts: [{ attemptId: 'att-1', step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: '0x' + 'ab'.repeat(32), reconciled: true, updatedAt: new Date().toISOString(),
          unsignedTransaction: { data: '0xdeadbeef' }, nonce: 7 }] } as unknown as CloudRun : null }; },
      record: async () => ({ ok: true, value: { review: { workflow: strategy.workflow } } }),
      evidence: async () => ({ ok: true, value: { bundleHash: '0x' + 'cd'.repeat(32), environment: 'MOCKED', outcome: 'RECONCILED', content: { bundle: { not: 'canonical' } } } }) });
    const p = await developerProject(t.db, { name: 'Acme Wallet' }), api = developerApi({ db: t.db, runtime }, p.key);
    const created = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const approval = (await api<{ id: string; approvalUrl: string }>('POST', '/approvals', { strategyId: created.id, workflowHash: created.workflowHash })).body;
    const secret = decodeURIComponent(new URL(approval.approvalUrl).hash.slice(1));
    const surface = await approvalSurface(developerEnv(), () => undefined, { host: { db: t.db, tenantId: 'default' }, runtime });

    const view = await viewApproval(surface, secret, []);
    expect(view).toMatchObject({ approvalId: approval.id, status: 'PENDING', clientName: 'Acme Wallet', requesterKind: 'DEVELOPER_PROJECT', sameAccount: false, authorized: false,
      authority: 'NONE', statusShared: false });
    // The API key is not a wallet: without a proven wallet session nothing can be claimed.
    expect(await refusal(claimApproval(surface, secret, [], true))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(errorOf(await api('POST', `/approvals/${approval.id}/claim`, {}))).toMatchObject({ code: 'NOT_FOUND', reason: 'ROUTE_NOT_FOUND' });

    const claimed = await claimApproval(surface, secret, [WALLET], false);
    claimedAt = Date.now();
    expect(claimed.workflowHash).toBe(created.workflowHash);
    const afterClaim = (await api<Record<string, unknown>>('GET', `/approvals/${approval.id}`)).text;
    expect(JSON.parse(afterClaim)).toMatchObject({ status: 'CLAIMED', claimed: true, statusShared: false, executionsVisible: false });
    expect(afterClaim.toLowerCase()).not.toContain(OWNER.slice(2));
    await applyApproval(surface, secret, [WALLET], strategy.workflow);

    // Applied but not shared: the developer sees the state, never the runs or the wallet.
    const unshared = await api<Record<string, unknown>>('GET', `/approvals/${approval.id}`);
    expect(unshared.body).toMatchObject({ status: 'APPLIED', applied: true, statusShared: false, executions: [], executionsVisible: false,
      note: 'The owner has not shared the status of runs started from this approval.' });
    expect(errorOf(await api('GET', '/executions/run-dev-1'))).toMatchObject({ code: 'NOT_FOUND', reason: 'EXECUTION_NOT_FOUND' });

    // The owner opts in: the approval's run, its status and its evidence become visible to this project only.
    await shareApproval(surface, secret, [WALLET], true);
    const shared = await api<{ executions: Record<string, unknown>[]; executionsVisible: boolean }>('GET', `/approvals/${approval.id}`);
    expect(shared.body).toMatchObject({ statusShared: true, executionsVisible: true, executions: [{ id: 'run-dev-1', status: 'RECONCILED', reconciled: true, terminal: true,
      errorCode: null, evidence: { environment: 'MOCKED', outcome: 'RECONCILED', bundleHash: '0x' + 'cd'.repeat(32) } }] });
    const execution = await api<Record<string, unknown>>('GET', '/executions/run-dev-1');
    expect(execution.body).toMatchObject({ id: 'run-dev-1', object: 'execution', approvalId: approval.id, status: 'RECONCILED', provenance: 'MOCKED', reconciled: true,
      terminal: true, owner: OWNER, accessBasis: 'OWNER_SHARED_WITH_PROJECT',
      attempts: [{ attemptId: 'att-1', step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: '0x' + 'ab'.repeat(32), reconciled: true }] });
    expect(execution.text).not.toMatch(/deadbeef|unsignedTransaction|nonce|"flow"/);
    expect((await api<Record<string, unknown>>('GET', '/executions/run-dev-1/evidence')).body).toMatchObject({ object: 'evidence', executionId: 'run-dev-1', approvalId: approval.id,
      evidence: { bundleHash: '0x' + 'cd'.repeat(32), environment: 'MOCKED', outcome: 'RECONCILED', canonical: false, bundle: null }, reason: null });
    const stranger = await developerProject(t.db, { name: 'Other App' });
    expect((await developerApi({ db: t.db, runtime }, stranger.key)('GET', '/executions/run-dev-1')).status).toBe(404);
    expect((await developerApi({ db: t.db, runtime }, stranger.key)('GET', `/approvals/${approval.id}`)).status).toBe(404);

    // The owner stops sharing: visibility ends at once.
    await shareApproval(surface, secret, [WALLET], false);
    expect(errorOf(await api('GET', '/executions/run-dev-1'))).toMatchObject({ reason: 'EXECUTION_NOT_FOUND' });
    expect((await api<{ executionsVisible: boolean }>('GET', `/approvals/${approval.id}`)).body.executionsVisible).toBe(false);
    expect(calls.every(c => READ_ONLY_CALL.test(c)), calls.join(',')).toBe(true);
    expect(runs.every(r => r === 'run-dev-1')).toBe(true);
  });

  it('a disabled project\'s approvals cannot be claimed, a production approval never can, and the developer scheme resolves developer approvals only', async () => {
    const runtime = recordingRuntime(), WALLET: WalletRef = { namespace: 'eip155', address: OWNER };
    const p = await developerProject(t.db), api = developerApi({ db: t.db, runtime }, p.key);
    const created = (await api<{ id: string; workflowHash: string }>('POST', '/strategies', { strategy: BRIDGE })).body;
    const approval = (await api<{ id: string; approvalUrl: string }>('POST', '/approvals', { strategyId: created.id, workflowHash: created.workflowHash })).body;
    const secret = decodeURIComponent(new URL(approval.approvalUrl).hash.slice(1));
    const surface = await approvalSurface(developerEnv(), () => undefined, { host: { db: t.db, tenantId: 'default' }, runtime });
    // Disabled after the approval was created (and before any revocation sweep): the claim rule refuses it.
    await t.db.query(`UPDATE developer_projects SET status = 'DISABLED', disabled_at = now() WHERE project_id = $1`, [p.projectId]);
    expect(await refusal(claimApproval(surface, secret, [WALLET], false))).toBe('DEVELOPER_PROJECT_DISABLED');
    // An MCP-shaped secret never resolves through the developer scheme, and an unknown developer secret is simply not found.
    expect(await refusal(viewApproval(surface, secret.replace('flofi_dhs_', 'flofi_hs_'), []))).toBe('HANDOFF_NOT_FOUND');
    expect(await refusal(viewApproval(surface, 'flofi_dhs_' + 'A'.repeat(43), []))).toBe('HANDOFF_NOT_FOUND');

    // A production approval (no live credential exists to create one; written here through the platform directly) is never claimable.
    const q = await developerProject(t.db, { name: 'Live App' }), c = composeStrategy(BRIDGE);
    if (!c.ok) throw new Error(c.code);
    const prodId = typedId('str');
    await t.db.query(`INSERT INTO developer_strategies (tenant_id, strategy_id, project_id, environment, strategy, workflow_hash, engine_version, funds_class, network_environment, plan)
      VALUES ('default', $1, $2, 'production', $3, $4, 'flofi-engine-2', 'TEST_FUNDS', 'PUBLIC_TESTNET', $5)`, [prodId, q.projectId, JSON.stringify(c.strategy), c.workflowHash,
      JSON.stringify(executionPlan(c))]);
    const live = await requestApproval({ origin: ORIGIN, scheme: developerApprovalLinkScheme(developerConfig()), handoffs: createPgHandoffStore(t.db, 'default'), allow: async () => true,
      runtime, policy: SANDBOX_POLICY, rules: developerHandoffRules(limitsOf('free')), now: new Date() },
    { kind: 'DEVELOPER_PROJECT', ref: `${q.projectId}.production`, clientId: q.projectId, displayName: 'Live App', context: { strategyId: prodId } }, c.strategy, c.workflowHash);
    if (!live.ok) throw new Error(live.code);
    expect(await refusal(claimApproval(surface, decodeURIComponent(new URL(live.value.approvalUrl).hash.slice(1)), [WALLET], false))).toBe('LIVE_MODE_DISABLED');
  });
});

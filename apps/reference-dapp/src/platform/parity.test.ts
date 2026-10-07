// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: one execution truth. Every MCP read-only tool returns exactly what the shared platform computes, and the
 * platform returns exactly what the deterministic engine computes — so a second surface calling `src/platform` gets MCP-identical
 * strategies, workflow hashes, validation, review, capability facts, simulation previews, execution status and evidence.
 */
import { describe, expect, it } from 'vitest';
import type { FlowName } from '../../backend/flows.ts';
import { composeWorkflow } from '../engine/strategy-engine';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';
import { NETWORK_IDS } from '../engine/strategy-spec';
import { readHandoffPolicy } from '../mcp/execution';
import { credential, gatewayEnv, session } from '../mcp/gateway.test-harness';
import type { McpRuntime } from '../mcp/runtime';
import type { CloudRun } from '../server/flow-runtime';
import { capabilityFacts, composeWorkflowOrRefuse, evidenceView, executionStatusView, findOwnedRun, PlatformRefusal, reviewWorkflow, simulatePreview, stepViews,
  validateStrategy } from './index.ts';

const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40), H = (c: string) => '0x' + c.repeat(64);
const V2_LENDING = { version: 2, steps: [{ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '100', beneficiary: A },
  { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '20', beneficiary: A }, { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '20' }] };
const V2_GENERAL = { version: 2, steps: [STRATEGY_EXAMPLES[0]!.strategy, STRATEGY_EXAMPLES[3]!.strategy] };
const STRATEGIES: readonly (readonly [string, unknown])[] = [...STRATEGY_EXAMPLES.map(e => [e.id, e.strategy] as const), ['v2-lending', V2_LENDING], ['v2-general', V2_GENERAL],
  ['v2-one-step', { version: 2, steps: [STRATEGY_EXAMPLES[0]!.strategy] }]];
const hashOf = (strategy: unknown) => { const c = composeWorkflow(strategy); if (!c.ok) throw new Error(c.code); return c.workflowHash; };
const QUOTE = { chainId: 84532, inputToken: '0x' + '1'.repeat(40), outputToken: '0x' + '2'.repeat(40), inputSymbol: 'USDC', outputSymbol: 'WETH', amountIn: '1000000',
  expectedOut: '300000000000000', minimumOut: '298500000000000', slippageBps: 50, pool: '0x' + '3'.repeat(40), fee: 500, blockNumber: '123', estimatedGas: '150000',
  observedAt: '2026-10-07T00:00:00.000Z', expiresAt: '2026-10-07T00:01:00.000Z', calldata: '0xdeadbeef' };
const bundle = { schemaVersion: '1.0.0', evidenceBundleId: 'router.evidence.test', version: 1, supersedes: null, semanticWorkflowHash: H('1'), artifactSetHash: H('2'),
  simulationHash: H('3'), policyHash: H('4'), manifestHash: H('5'), executionPlanHash: H('6'), journalHeadHash: H('7'), observedAt: '2026-10-06T00:00:00.000Z',
  environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED', receipts: [{ receiptId: 'source', contentHash: H('8') }], differences: [],
  reconciliation: { balances: [], allowances: [], debt: [], positions: [], fees: [], residualAssets: [], ownership: [], limitations: [] }, evidence: [] };
const RUN = { runId: 'xroute-' + 'a'.repeat(32), workflowId: 'w', flow: 'crosschain-router-testnet', status: 'RECONCILED', provenance: 'PUBLIC_TESTNET', ownerAccount: A,
  errorCode: null, needsObservation: false, attentionRequired: false, hasEvidence: true, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:05:00.000Z',
  attempts: [{ attemptId: 'x.deposit.2', step: 'DEPOSIT', state: 'CONFIRMED', nonce: '41', transactionHash: H('9'), reconciled: true, preparedAtBlock: '100', updatedAt: '2026-10-06T00:04:00.000Z' }] } as CloudRun;
const MODES: Partial<Record<FlowName, 'live' | 'harness'>> = { 'crosschain-router-testnet': 'live', 'aave-supply': 'harness', 'jupiter-swap': 'live', 'base-sepolia-swap': 'live' };
/** A deterministic deployment: fixed modes and switches, one canned swap quote, one owned run with canonical evidence. */
function runtime(kind: McpRuntime['kind'] = 'embedded', previews: unknown[][] = []): McpRuntime {
  return { kind, mode: async flow => kind === 'local' ? null : MODES[flow] ?? 'off', info: async flow => ({ executionEnabled: flow !== 'jupiter-swap' }),
    preview: async (flow, args) => { previews.push([flow, ...args]); return flow === 'base-sepolia-swap' ? { ok: true, value: { quote: QUOTE } } : { ok: false, code: 'NOT_CANNED' }; },
    run: async (id, owner) => ({ ok: true, value: id === RUN.runId && owner === A ? RUN : null }),
    journal: async (id, owner, after, limit) => ({ ok: true, value: id === RUN.runId && owner === A ? { items: [{ sequence: after ?? 0, entryHash: H('c'), level: 'workflow',
      entityId: 'w', attemptId: null, fromState: null, toState: 'DRAFT', recordedAt: '2026-10-06T00:00:00.000Z', limit }], next: null } : null }),
    evidence: async (_flow, id, owner) => ({ ok: true, value: id === RUN.runId && owner === A ? { bundleHash: H('a'), environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED',
      content: { bundle } } : null }) };
}
const alice = { principal: 'dev-alice', token: credential(), wallets: [B, A] }, env = gatewayEnv([alice]);
const mcp = (r: McpRuntime) => session({ env, token: alice.token, runtime: r });
const refusalOf = (work: () => unknown) => {
  try { work(); return null; } catch (error) { if (error instanceof PlatformRefusal) return { code: error.message, extra: error.extra }; throw error; }
};

describe('BUILD-DEVELOPER-001 platform parity: MCP ≡ platform ≡ engine', () => {
  it('composes every example and step list to the engine\'s canonical strategy and workflow hash', async () => {
    const client = mcp(runtime());
    for (const [id, strategy] of STRATEGIES) {
      const engine = composeWorkflow(strategy), platform = composeWorkflowOrRefuse(strategy, undefined);
      if (!engine.ok) throw new Error(`${id}: ${engine.code}`);
      const tool = (await client.callTool('compose_strategy', { strategy })).output as Record<string, unknown>;
      expect([platform.workflowHash, platform.strategy], id).toEqual([engine.workflowHash, engine.strategy]);
      expect([tool.workflowHash, tool.strategy], id).toEqual([engine.workflowHash, engine.strategy]);
      if (platform.steps.length === 1) expect(tool.steps, id).toEqual(stepViews(platform.steps[0]!));
      else expect((tool.workflowSteps as { steps: unknown }[]).map(s => s.steps), id).toEqual(platform.steps.map(stepViews));
      expect(composeWorkflowOrRefuse(strategy, engine.workflowHash).workflowHash, id).toBe(engine.workflowHash);
    }
  });

  it('validates and reviews identically, including refusals', async () => {
    const client = mcp(runtime());
    // Schema-valid strategies the engine refuses (schema violations never reach a handler: the MCP SDK validates tool input first).
    const invalid = [{ action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'USDC', amount: '1' },
      { action: 'swap', network: 'base-sepolia', inputAsset: 'WETH', outputAsset: 'SOL', amount: '1' },
      { version: 2, steps: [STRATEGY_EXAMPLES[0]!.strategy, { action: 'swap', network: 'base-sepolia', inputAsset: 'WETH', outputAsset: 'SOL', amount: '1' }] }];
    for (const [id, strategy] of [...STRATEGIES, ...invalid.map((s, i) => [`invalid-${i}`, s] as const)]) {
      for (const workflowHash of [undefined, H('e'), ...composeWorkflow(strategy).ok ? [hashOf(strategy)] : []]) {
        const args = { strategy, ...workflowHash ? { workflowHash } : {} };
        expect((await client.callTool('validate_strategy', args)).output, `${id} ${workflowHash}`).toEqual({ ok: true, ...validateStrategy(strategy, workflowHash) });
        const review = (await client.callTool('review_strategy', args)).output as Record<string, unknown>;
        const refusal = refusalOf(() => composeWorkflowOrRefuse(strategy, workflowHash));
        if (refusal) { expect(review, id).toEqual({ ok: false, ...refusal.extra, code: refusal.code }); continue; }
        const platform = reviewWorkflow(composeWorkflowOrRefuse(strategy, workflowHash));
        if (platform.steps.length > 1) expect([review.summary, review.workflowSteps], id).toEqual([platform.summary, platform.steps]);
        else expect([review.summary, review.findings, review.capability, review.environment], id)
          .toEqual([platform.steps[0]!.summary, platform.steps[0]!.findings, platform.steps[0]!.capability, platform.steps[0]!.environment]);
      }
    }
  });

  it('reports the same capability facts on embedded and local runtimes, for every filter', async () => {
    const policy = readHandoffPolicy({});
    for (const kind of ['embedded', 'local'] as const) for (const network of [undefined, ...NETWORK_IDS]) {
      const tool = (await mcp(runtime(kind)).callTool('get_capabilities', network ? { network } : {})).output as { capabilities: Record<string, Record<string, unknown>>[] };
      const facts = await capabilityFacts(runtime(kind), policy, { network });
      expect(tool.capabilities.map(c => [c.action, c.network, c.enabledByDeployment, c.enabledByPolicy, c.supportedByCode!.reason, c.mcp!.simulate,
        c.mcp!.simulateUnavailableReason, c.deployment!.flow]), `${kind} ${network}`)
        .toEqual(facts.map(f => [f.row.action, f.row.network, f.gates.enabledByDeployment, f.gates.enabledByPolicy, f.gates.supportedByCode.reason, f.previewable,
          f.previewUnavailableReason, f.flow]));
    }
  });

  it('previews the same flow call and projection, with no executable material', async () => {
    const strategy = STRATEGY_EXAMPLES[3]!.strategy, request = { strategy, workflowHash: hashOf(strategy), simulationSubject: A };
    const viaTool: unknown[][] = [], viaPlatform: unknown[][] = [];
    const tool = (await mcp(runtime('embedded', viaTool)).callTool('simulate_strategy', request)).output as Record<string, unknown>;
    const platform = await simulatePreview(runtime('embedded', viaPlatform), request);
    expect(viaTool).toEqual(viaPlatform);
    expect(viaTool.map(call => call.length)).toEqual([2]);
    expect([tool.flow, tool.kind, tool.provenance, tool.observedAt, tool.expiresAt, tool.facts, tool.canonicalArtifacts, tool.simulationSubject])
      .toEqual([platform.plan.flow, platform.view.kind, platform.view.provenance, platform.view.observedAt, platform.view.expiresAt, platform.view.facts,
        platform.view.canonicalArtifacts, platform.simulationSubject]);
    expect(JSON.stringify(platform.view)).not.toContain('deadbeef');
  });

  it('reads execution status and evidence identically, as the owning wallet only', async () => {
    const r = runtime(), client = mcp(r), found = await findOwnedRun(r, alice.wallets, RUN.runId);
    expect(found.owner).toBe(A);
    const status = (await client.callTool('get_execution_status', { executionId: RUN.runId, journalAfter: 2, journalLimit: 5 })).output as Record<string, unknown>;
    const { notes: statusNotes, ...statusRest } = status;
    expect(statusRest).toEqual({ ok: true, ...await executionStatusView(r, found, RUN.runId, 'OPERATOR_GRANTED_WALLET', { after: 2, limit: 5 }) });
    expect(statusNotes).toHaveLength(1);
    const evidence = (await client.callTool('get_evidence', { executionId: RUN.runId })).output as Record<string, unknown>;
    const { notes: evidenceNotes, ...evidenceRest } = evidence;
    expect(evidenceRest).toEqual({ ok: true, ...await evidenceView(r, found, RUN.runId, 'OPERATOR_GRANTED_WALLET') });
    expect((evidenceRest.evidence as { canonical: boolean }).canonical).toBe(true);
    expect(evidenceNotes).toHaveLength(1);
    expect(JSON.stringify(status)).not.toMatch(/"nonce"|"limit"/);
    for (const executionId of ['xroute-' + 'b'.repeat(32)]) {
      expect((await client.callTool('get_execution_status', { executionId })).output).toEqual({ ok: false, code: 'RUN_NOT_FOUND' });
      await expect(findOwnedRun(r, alice.wallets, executionId)).rejects.toThrow('RUN_NOT_FOUND');
    }
  });
});

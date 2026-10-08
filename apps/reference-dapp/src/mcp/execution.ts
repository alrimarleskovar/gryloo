// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: what owner-wallet execution a composed strategy can have, and whether this deployment lets an MCP client hand
 * it to its owner. Four independent facts, always reported:
 *
 *   supportedByCode        an existing FloFi flow executes this workflow with the owner's wallet (execution capability registry
 *                          + flow mapping + execution plan; general multi-step sequences: MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED)
 *   enabledByDeployment    the flow is enabled here (`mode`), and its own owner-execution switch is on (`info.executionEnabled`)
 *   enabledByPolicy        the MCP handoff policy allows these funds: test funds (FLOFI_MCP_HANDOFF_TEST_FUNDS, default enabled)
 *                          and each mainnet network explicitly (FLOFI_MCP_HANDOFF_MAINNET_NETWORKS, default none)
 *   demonstratedEvidence   what the registry records as demonstrated — reported, never a gate
 *
 * A handoff is allowed only when the first three hold; the reason is the first failing gate. Mainnet is disabled by POLICY only:
 * nothing here, in the schemas or in the database is testnet-specific, so enabling a mainnet network is configuration plus
 * evidence. Nothing here authorizes anything: the owner still proves the wallet, re-simulates, reviews and signs in FloFi.
 */
import type { EvidenceMaturity, ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import type { FlowName } from '../../backend/flows.ts';
import { NETWORKS, reviewComposition, type Composition, type WorkflowComposition } from '../engine/strategy-engine';
import { NETWORK_IDS, type NetworkId, type StrategyAction, type StrategySpec } from '../engine/strategy-spec';
import type { McpRuntime } from './runtime.ts';
import { strategyFlow } from './simulation.ts';

type Env = Readonly<Record<string, string | undefined>>;
/** Composition semantics of handoffs. A handoff created under another version is re-verified and goes STALE if it no longer reproduces. */
export const ENGINE_VERSION = 'flofi-engine-2';
/** Flows that expose `info.executionEnabled` (a separate owner-execution switch). Kept equal to `backend/flows.ts` by a test. */
export const FLOWS_WITH_EXECUTION_SWITCH: readonly FlowName[] = Object.freeze(['solana-devnet-swap', 'jupiter-swap', 'orca-liquidity', 'uniswap-liquidity',
  'crosschain-router', 'crosschain-router-testnet', 'pix-payment']);

/**
 * Review findings that are not defects but the owner's own pre-execution steps in FloFi: every executable flow quotes, simulates
 * and reviews before anything can be signed (the linter BLOCKs execution until then; the capability registry needs the runtime
 * facts the flow measures at Simulate). A handoff exists precisely so the owner can do that; any OTHER blocker refuses it.
 */
export const OWNER_PRE_EXECUTION_FINDINGS: ReadonlySet<string> = new Set(['LINTER:ROUTER_ROUTE_REQUIRED', 'LINTER:SOLANA_SWAP_QUOTE_REQUIRED',
  'LINTER:SUPPLY_SIMULATION_REQUIRED', 'LINTER:UNISWAP_LIQUIDITY_SIMULATION_REQUIRED', 'LINTER:SOLANA_LIQUIDITY_SIMULATION_REQUIRED',
  'LINTER:UNQUOTED_EXECUTION_UNAVAILABLE', 'CAPABILITY:RUNTIME_UNAVAILABLE']);
/** The review's BLOCK findings split into the owner's pre-execution steps and genuine blockers. */
export function handoffFindings(composition: Composition) {
  const blocks = reviewComposition(composition).findings.filter(f => f.level === 'BLOCK');
  const pre = blocks.filter(f => OWNER_PRE_EXECUTION_FINDINGS.has(`${f.source}:${f.code}`));
  return { preExecution: [...new Set(pre.map(f => f.code))], blockers: blocks.filter(f => !pre.includes(f)) };
}

export type HandoffPolicy = { readonly ok: true; readonly testFunds: boolean; readonly mainnetNetworks: readonly NetworkId[] } | { readonly ok: false; readonly code: 'MCP_HANDOFF_POLICY_INVALID' };
/** The MCP handoff policy. Any malformed value disables every handoff (fail closed). */
export function readHandoffPolicy(env: Env): HandoffPolicy {
  const testFunds = env.FLOFI_MCP_HANDOFF_TEST_FUNDS ?? 'enabled';
  if (testFunds !== 'enabled' && testFunds !== 'disabled') return { ok: false, code: 'MCP_HANDOFF_POLICY_INVALID' };
  const listed = (env.FLOFI_MCP_HANDOFF_MAINNET_NETWORKS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Only mainnet networks may be listed; a testnet name here is a configuration mistake, not a permission.
  if (!listed.every(n => (NETWORK_IDS as readonly string[]).includes(n) && NETWORKS[n as NetworkId].class === 'MAINNET')) return { ok: false, code: 'MCP_HANDOFF_POLICY_INVALID' };
  return { ok: true, testFunds: testFunds === 'enabled', mainnetNetworks: Object.freeze([...new Set(listed as NetworkId[])]) };
}

export type PlanStep = { readonly index: number; readonly action: StrategyAction | 'supply' | 'borrow' | 'swap'; readonly network: NetworkId;
  readonly destinationNetwork: NetworkId | null; readonly nodeIds: readonly string[]; readonly kind: string; readonly protocol: string;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly environment: ExecutionEnvironment;
  /** The existing flow that executes this step on its own, and the hash of the step's own IR (what that flow reviews). */
  readonly flow: FlowName | null; readonly workflowHash: string };
/**
 * How the owner executes a workflow. `SINGLE_FLOW`: one action, one existing flow. `COMPOSITE_FLOW`: an existing executor that
 * runs a fixed multi-step shape (the Base Sepolia lending composition). `NOT_EXECUTABLE`: with its reason — for a general
 * sequence of steps, `MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED`. `SEQUENTIAL` is reserved for the follow-up sequential runner (step →
 * simulate → sign → execute → reconcile → next) over the same step list: plans, handoffs, panel and evidence views already carry
 * per-step flows and hashes, so adding it changes no schema.
 */
export type ExecutionPlan = { readonly kind: 'SINGLE_FLOW' | 'COMPOSITE_FLOW' | 'SEQUENTIAL' | 'NOT_EXECUTABLE'; readonly flow: FlowName | null; readonly reason: string | null;
  readonly steps: readonly PlanStep[]; readonly networks: readonly NetworkId[]; readonly networkEnvironment: ExecutionEnvironment;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS' };

const networksOf = (spec: StrategySpec): NetworkId[] => spec.action === 'bridge' ? [spec.sourceNetwork, spec.destinationNetwork] : [spec.network];
const fundsOf = (networks: readonly NetworkId[]) => networks.some(n => NETWORKS[n].class === 'MAINNET') ? 'REAL_FUNDS' as const : 'TEST_FUNDS' as const;
const environmentOf = (networks: readonly NetworkId[]): ExecutionEnvironment => networks.some(n => NETWORKS[n].environment === 'MAINNET') ? 'MAINNET' : 'PUBLIC_TESTNET';

/** The execution plan of a composition: its ordered steps and the existing flow (if any) that executes them with the owner's wallet. */
export function executionPlan(composition: Composition): ExecutionPlan {
  // The editor's authoring-only template node is not a step.
  const spec = composition.strategy, networks = networksOf(spec), financial = composition.steps.filter(s => s.kind !== 'TEMPLATE');
  const base = { networks, networkEnvironment: environmentOf(networks), fundsClass: fundsOf(networks) };
  const flow = spec.action === 'lending_composition' ? 'lending-composition' : strategyFlow(spec);
  const step = (index: number, action: PlanStep['action'], nodeIds: readonly string[], kind: string, protocol: string): PlanStep => ({ index, action,
    network: networks[0]!, destinationNetwork: spec.action === 'bridge' ? spec.destinationNetwork : null, nodeIds, kind, protocol,
    fundsClass: base.fundsClass, environment: base.networkEnvironment, flow, workflowHash: composition.workflowHash });
  if (spec.action === 'lending_composition') {
    const roles = ['supply', 'borrow', 'swap'] as const;
    const steps = composition.steps.map((s, i) => step(i, roles[i] ?? 'swap', [s.nodeId], s.kind, s.protocol));
    return { kind: 'COMPOSITE_FLOW', flow: 'lending-composition', reason: null, steps, ...base };
  }
  const steps = [step(0, spec.action, financial.map(s => s.nodeId), financial[0]?.kind ?? 'OTHER', financial[0]?.protocol ?? '')];
  return flow ? { kind: 'SINGLE_FLOW', flow, reason: null, steps, ...base } : { kind: 'NOT_EXECUTABLE', flow: null, reason: 'OWNER_EXECUTION_NOT_IMPLEMENTED', steps, ...base };
}

/** BUILD-MCP-002: the plan of a step-list workflow. One step is that step's plan; several steps are not executable yet. */
export function workflowPlan(workflow: WorkflowComposition): ExecutionPlan {
  if (workflow.steps.length === 1) return executionPlan(workflow.steps[0]!);
  const plans = workflow.steps.map(executionPlan), networks = [...new Set(plans.flatMap(p => p.networks))];
  const steps = plans.map((p, index) => ({ ...p.steps[0]!, index, action: workflow.steps[index]!.strategy.action, nodeIds: p.steps.flatMap(s => s.nodeIds), flow: p.flow }));
  return { kind: 'NOT_EXECUTABLE', flow: null, reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED', steps, networks, networkEnvironment: environmentOf(networks),
    fundsClass: workflow.fundsClass };
}

type StepFacts = { readonly index: number; readonly flow: FlowName | null; readonly execute: boolean; readonly deploymentEnabled: boolean; readonly reason: string | null };
export type Gates = {
  readonly supportedByCode: { readonly execute: boolean; readonly plan: ExecutionPlan['kind']; readonly flow: FlowName | null; readonly reason: string | null;
    readonly steps?: readonly StepFacts[] };
  readonly enabledByDeployment: { readonly enabled: boolean; readonly flow: FlowName | null; readonly mode: string; readonly executionSwitch: boolean | null;
    readonly mockedHarness: boolean; readonly reason: string | null };
  readonly enabledByPolicy: { readonly enabled: boolean; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly networks: readonly NetworkId[]; readonly reason: string | null };
  readonly demonstratedEvidence: EvidenceMaturity | 'NONE_DEMONSTRATED';
  readonly handoff: { readonly allowed: boolean; readonly reason: string | null };
};

/** The policy fact alone (pure). */
export function policyGate(plan: ExecutionPlan, policy: HandoffPolicy): Gates['enabledByPolicy'] {
  const facts = { fundsClass: plan.fundsClass, networks: plan.networks };
  if (!policy.ok) return { enabled: false, ...facts, reason: policy.code };
  for (const network of plan.networks) {
    if (NETWORKS[network].class === 'MAINNET') { if (!policy.mainnetNetworks.includes(network)) return { enabled: false, ...facts, reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY' }; }
    else if (!policy.testFunds) return { enabled: false, ...facts, reason: 'TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY' };
  }
  return { enabled: true, ...facts, reason: null };
}

/** All four facts for one composition on this deployment. */
export async function evaluateGates(composition: Composition, runtime: McpRuntime, policy: HandoffPolicy): Promise<Gates & { readonly plan: ExecutionPlan }> {
  const plan = executionPlan(composition), review = reviewComposition(composition);
  const implemented = plan.kind !== 'NOT_EXECUTABLE' && review.capability.executionImplementedForOwnerWallet;
  const supportedByCode = { execute: implemented, plan: plan.kind, flow: plan.flow,
    reason: implemented ? null : plan.reason ?? 'OWNER_EXECUTION_NOT_IMPLEMENTED' };
  const cloud = runtime.kind === 'remote' || runtime.kind === 'embedded';
  let enabledByDeployment: Gates['enabledByDeployment'];
  if (!plan.flow) enabledByDeployment = { enabled: false, flow: null, mode: 'NONE', executionSwitch: null, mockedHarness: false, reason: 'NO_EXECUTION_FLOW' };
  else if (!cloud) enabledByDeployment = { enabled: false, flow: plan.flow, mode: 'UNKNOWN_IN_LOCAL_RUNTIME', executionSwitch: null, mockedHarness: false,
    reason: runtime.kind === 'local' ? 'MCP_CLOUD_RUNTIME_REQUIRED' : 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  else {
    const mode = await runtime.mode(plan.flow) ?? 'off', on = mode === 'live' || mode === 'harness';
    const switchable = FLOWS_WITH_EXECUTION_SWITCH.includes(plan.flow);
    const executionSwitch = on && switchable ? (await runtime.info?.(plan.flow))?.executionEnabled ?? null : null;
    const reason = !on ? 'FLOW_NOT_ENABLED_IN_DEPLOYMENT' : switchable && executionSwitch === null ? 'EXECUTION_SWITCH_UNKNOWN'
      : switchable && !executionSwitch ? 'OWNER_EXECUTION_NOT_ENABLED_IN_DEPLOYMENT' : null;
    enabledByDeployment = { enabled: reason === null, flow: plan.flow, mode, executionSwitch, mockedHarness: mode === 'harness', reason };
  }
  const enabledByPolicy = policyGate(plan, policy);
  const demonstratedEvidence = implemented && review.capability.evidenceCeiling ? review.capability.evidenceCeiling : 'NONE_DEMONSTRATED';
  const reason = supportedByCode.reason ?? enabledByDeployment.reason ?? enabledByPolicy.reason;
  return { plan, supportedByCode, enabledByDeployment, enabledByPolicy, demonstratedEvidence, handoff: { allowed: reason === null, reason } };
}

/**
 * The four facts for a step-list workflow. One step: exactly `evaluateGates` of that step. Several steps: each step's own facts are
 * reported (what the sequential runner will need), the workflow is refused with MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED, policy covers
 * every network of every step, and no sequence evidence exists.
 */
export async function evaluateWorkflowGates(workflow: WorkflowComposition, runtime: McpRuntime, policy: HandoffPolicy): Promise<Gates & { readonly plan: ExecutionPlan }> {
  if (workflow.steps.length === 1) return evaluateGates(workflow.steps[0]!, runtime, policy);
  const plan = workflowPlan(workflow), each = await Promise.all(workflow.steps.map(step => evaluateGates(step, runtime, policy)));
  const steps = each.map((g, index) => ({ index, flow: g.plan.flow, execute: g.supportedByCode.execute, deploymentEnabled: g.enabledByDeployment.enabled,
    reason: g.supportedByCode.reason ?? g.enabledByDeployment.reason }));
  const deploymentReason = each.find(g => !g.enabledByDeployment.enabled)?.enabledByDeployment.reason ?? null;
  const enabledByPolicy = policyGate(plan, policy);
  return { plan, supportedByCode: { execute: false, plan: plan.kind, flow: null, reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED', steps },
    enabledByDeployment: { enabled: deploymentReason === null, flow: null, mode: 'PER_STEP', executionSwitch: null, mockedHarness: each.some(g => g.enabledByDeployment.mockedHarness),
      reason: deploymentReason }, enabledByPolicy, demonstratedEvidence: 'NONE_DEMONSTRATED', handoff: { allowed: false, reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' } };
}

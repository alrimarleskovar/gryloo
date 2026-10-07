// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: execution plans and the four handoff facts (supported by code, enabled by deployment, enabled by policy,
 * demonstrated evidence). Mainnet is refused by POLICY only: the same composition, plan and schema proceed when an isolated
 * policy lists the network, REAL_FUNDS survives, and evidence is reported but never a gate.
 */
import { describe, expect, it } from 'vitest';
import { FLOWS, type FlowName } from '../../backend/flows.ts';
import { composeStrategy, type Composition } from '../engine/strategy-engine';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';
import type { StrategySpec } from '../engine/strategy-spec';
import { evaluateGates, executionPlan, FLOWS_WITH_EXECUTION_SWITCH, policyGate, readHandoffPolicy, type HandoffPolicy } from './execution.ts';
import type { McpRuntime } from './runtime.ts';

const compose = (spec: unknown): Composition => { const c = composeStrategy(spec); if (!c.ok) throw new Error(c.code); return c; };
const example = (id: string) => STRATEGY_EXAMPLES.find(e => e.id === id)!.strategy;
const DEFAULT = readHandoffPolicy({});
function runtime(modes: Partial<Record<FlowName, 'live' | 'harness' | 'off'>>, switches: Partial<Record<FlowName, boolean>> = {}, kind: McpRuntime['kind'] = 'embedded'): McpRuntime {
  const never = async (): Promise<never> => { throw new Error('NOT_IN_THIS_TEST'); };
  return { kind, mode: async flow => modes[flow] ?? 'off', info: async flow => flow in switches ? { executionEnabled: switches[flow]! } : null,
    preview: never, run: never, journal: never, evidence: never };
}

describe('BUILD-MCP-002 handoff policy', () => {
  it('defaults to test funds on and every mainnet off', () => {
    expect(DEFAULT).toEqual({ ok: true, testFunds: true, mainnetNetworks: [] });
    expect(readHandoffPolicy({ FLOFI_MCP_HANDOFF_TEST_FUNDS: 'disabled', FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'solana, base,base' }))
      .toEqual({ ok: true, testFunds: false, mainnetNetworks: ['solana', 'base'] });
  });
  it('fails closed on anything malformed, including a testnet listed as a mainnet', () => {
    for (const env of [{ FLOFI_MCP_HANDOFF_TEST_FUNDS: 'yes' }, { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'base-sepolia' }, { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'solana-devnet' },
      { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'ethereum' }, { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'all' }])
      expect(readHandoffPolicy(env), JSON.stringify(env)).toEqual({ ok: false, code: 'MCP_HANDOFF_POLICY_INVALID' });
  });
});

describe('BUILD-MCP-002 execution plans', () => {
  it('maps every supported strategy to an existing flow, the lending composition to its executor, and nothing nearby', () => {
    const plans = Object.fromEntries(STRATEGY_EXAMPLES.map(e => [e.id, executionPlan(compose(e.strategy))]));
    expect(plans['swap-base']).toMatchObject({ kind: 'NOT_EXECUTABLE', flow: null, reason: 'OWNER_EXECUTION_NOT_IMPLEMENTED', fundsClass: 'REAL_FUNDS' });
    expect(plans['lending-composition-base-sepolia']).toMatchObject({ kind: 'COMPOSITE_FLOW', flow: 'lending-composition', fundsClass: 'TEST_FUNDS',
      steps: [{ index: 0, action: 'supply', nodeIds: ['lending-supply'] }, { index: 1, action: 'borrow', nodeIds: ['lending-borrow'] }, { index: 2, action: 'swap', nodeIds: ['lending-swap'] }] });
    expect(plans['bridge-base-arbitrum-one']).toMatchObject({ kind: 'SINGLE_FLOW', flow: 'crosschain-router', networks: ['base', 'arbitrum-one'], networkEnvironment: 'MAINNET',
      fundsClass: 'REAL_FUNDS', steps: [{ index: 0, action: 'bridge', network: 'base', destinationNetwork: 'arbitrum-one', nodeIds: ['node-002'] }] });
    expect(plans['add-liquidity-solana-devnet']).toMatchObject({ kind: 'SINGLE_FLOW', flow: 'orca-liquidity', networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS' });
    for (const [id, plan] of Object.entries(plans)) {
      if (plan.kind === 'SINGLE_FLOW') expect(plan.steps, id).toHaveLength(1);
      // Steps never include the editor's authoring-only template node.
      expect(plan.steps.flatMap(s => s.nodeIds), id).not.toContain('node-001');
    }
  });
  it('keeps the list of flows with an owner-execution switch equal to the flow registry', () => {
    const withInfo = (Object.keys(FLOWS) as FlowName[]).filter(flow => Object.hasOwn(FLOWS[flow].methods, 'info'));
    expect([...FLOWS_WITH_EXECUTION_SWITCH].sort()).toEqual(withInfo.sort());
  });
});

describe('BUILD-MCP-002 handoff gates', () => {
  const testnetBridge = compose(example('bridge-base-sepolia-arbitrum-sepolia')), solanaSwap = compose(example('swap-solana'));
  const mainnetBridge = compose(example('bridge-base-arbitrum-one'));

  it('allows a public testnet path enabled by the deployment under the default policy', async () => {
    const gates = await evaluateGates(testnetBridge, runtime({ 'crosschain-router-testnet': 'live' }, { 'crosschain-router-testnet': true }), DEFAULT);
    expect(gates).toMatchObject({ supportedByCode: { execute: true, plan: 'SINGLE_FLOW', flow: 'crosschain-router-testnet', reason: null },
      enabledByDeployment: { enabled: true, mode: 'live', executionSwitch: true, mockedHarness: false, reason: null },
      enabledByPolicy: { enabled: true, fundsClass: 'TEST_FUNDS', reason: null }, handoff: { allowed: true, reason: null } });
  });

  it('refuses mainnet by policy while still reporting that code supports it and the deployment enables it', async () => {
    const gates = await evaluateGates(solanaSwap, runtime({ 'jupiter-swap': 'live' }, { 'jupiter-swap': true }), DEFAULT);
    expect(gates).toMatchObject({ supportedByCode: { execute: true, flow: 'jupiter-swap' }, enabledByDeployment: { enabled: true },
      enabledByPolicy: { enabled: false, fundsClass: 'REAL_FUNDS', networks: ['solana'], reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY' },
      demonstratedEvidence: 'NONE_DEMONSTRATED', handoff: { allowed: false, reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY' } });
  });

  it('an isolated policy enabling the network lets the same composition proceed, REAL_FUNDS intact, evidence not a gate', async () => {
    const policy = readHandoffPolicy({ FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'solana' });
    const gates = await evaluateGates(solanaSwap, runtime({ 'jupiter-swap': 'live' }, { 'jupiter-swap': true }), policy);
    expect(gates).toMatchObject({ handoff: { allowed: true }, enabledByPolicy: { fundsClass: 'REAL_FUNDS' }, demonstratedEvidence: 'NONE_DEMONSTRATED',
      plan: { networkEnvironment: 'MAINNET', fundsClass: 'REAL_FUNDS' } });
    // Every mainnet the workflow touches must be listed: a Base → Arbitrum One bridge needs both.
    const router = runtime({ 'crosschain-router': 'live' }, { 'crosschain-router': true });
    expect((await evaluateGates(mainnetBridge, router, readHandoffPolicy({ FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'base' }))).handoff)
      .toEqual({ allowed: false, reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY' });
    expect((await evaluateGates(mainnetBridge, router, readHandoffPolicy({ FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'base,arbitrum-one' }))).handoff)
      .toEqual({ allowed: true, reason: null });
  });

  it('reports each deployment reason: flow off, owner execution switched off, switch unknown, local runtime', async () => {
    const reason = async (r: McpRuntime, c = solanaSwap, p: HandoffPolicy = readHandoffPolicy({ FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'solana' })) =>
      (await evaluateGates(c, r, p)).enabledByDeployment.reason;
    expect(await reason(runtime({}))).toBe('FLOW_NOT_ENABLED_IN_DEPLOYMENT');
    expect(await reason(runtime({ 'jupiter-swap': 'live' }, { 'jupiter-swap': false }))).toBe('OWNER_EXECUTION_NOT_ENABLED_IN_DEPLOYMENT');
    expect(await reason(runtime({ 'jupiter-swap': 'live' }))).toBe('EXECUTION_SWITCH_UNKNOWN');
    expect(await reason(runtime({ 'jupiter-swap': 'live' }, { 'jupiter-swap': true }, 'local'))).toBe('MCP_CLOUD_RUNTIME_REQUIRED');
    expect(await reason(runtime({ 'jupiter-swap': 'live' }, { 'jupiter-swap': true }, 'unconfigured'))).toBe('CLOUD_RUNTIME_NOT_CONFIGURED');
    // A flow without a separate switch is governed by its mode alone; the MOCKED harness is reported as such.
    const supply = compose(example('supply-base-sepolia'));
    expect((await evaluateGates(supply, runtime({ 'aave-supply': 'harness' }), DEFAULT)).enabledByDeployment)
      .toMatchObject({ enabled: true, mode: 'harness', executionSwitch: null, mockedHarness: true, reason: null });
  });

  it('refuses what no existing flow executes with the owner\'s wallet, whatever the deployment or policy says', async () => {
    const swapBase = compose(example('swap-base'));
    expect((await evaluateGates(swapBase, runtime({ 'base-sepolia-swap': 'live' }), readHandoffPolicy({ FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'base' }))).handoff)
      .toEqual({ allowed: false, reason: 'OWNER_EXECUTION_NOT_IMPLEMENTED' });
  });

  it('test funds can be switched off by policy, and an invalid policy refuses everything', () => {
    const plan = executionPlan(testnetBridge);
    expect(policyGate(plan, readHandoffPolicy({ FLOFI_MCP_HANDOFF_TEST_FUNDS: 'disabled' })).reason).toBe('TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY');
    expect(policyGate(plan, readHandoffPolicy({ FLOFI_MCP_HANDOFF_TEST_FUNDS: 'maybe' })).reason).toBe('MCP_HANDOFF_POLICY_INVALID');
  });

  it('every example yields the four facts without touching any flow but mode and info', async () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const gates = await evaluateGates(compose(strategy as StrategySpec), runtime({}), DEFAULT);
      expect(Object.keys(gates).sort(), id).toEqual(['demonstratedEvidence', 'enabledByDeployment', 'enabledByPolicy', 'handoff', 'plan', 'supportedByCode']);
    }
  });
});

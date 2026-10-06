// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the step-list contract (strategy version 2). One step is exactly version 1; the Base Sepolia supply → borrow →
 * swap shape is FloFi's existing lending composition; any other sequence is authored and reviewed per step and refused for
 * execution with MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED — honestly, with every step's own facts — until the sequential runner.
 */
import { describe, expect, it } from 'vitest';
import type { FlowName } from '../../backend/flows.ts';
import { composeStrategy, composeWorkflow, workflowSequenceHash, type WorkflowComposition } from '../engine/strategy-engine';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';
import { strategyInputIssues } from '../engine/strategy-spec';
import { evaluateWorkflowGates, readHandoffPolicy, workflowPlan } from './execution.ts';
import { credential, gatewayEnv, session } from './gateway.test-harness.ts';
import type { McpRuntime } from './runtime.ts';

const OWNER = '0x' + '1'.repeat(40);
const workflow = (input: unknown): WorkflowComposition => { const w = composeWorkflow(input); if (!w.ok) throw new Error(w.code + JSON.stringify(w.issues)); return w; };
const SUPPLY = { action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '10', beneficiary: OWNER };
const BORROW = { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '2', beneficiary: OWNER };
const SWAP = { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2' };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const SOLANA = { action: 'swap', network: 'solana', inputAsset: 'USDC', outputAsset: 'SOL', amount: '1' };
function runtime(): McpRuntime {
  const never = async (): Promise<never> => { throw new Error('NEVER'); };
  const on: FlowName[] = ['crosschain-router-testnet', 'base-sepolia-swap', 'aave-supply', 'jupiter-swap', 'lending-composition'];
  return { kind: 'embedded', mode: async flow => on.includes(flow) ? 'harness' : 'off', info: async () => ({ executionEnabled: true }), preview: never, run: never, journal: never, evidence: never };
}

describe('BUILD-MCP-002 step-list contract', () => {
  it('a one-step workflow is exactly its version 1 strategy: same canonical form, same hash', () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const v1 = composeStrategy(strategy), v2 = workflow({ version: 2, steps: [strategy] });
      if (!v1.ok) throw new Error(id);
      expect([v2.strategy, v2.workflowHash, v2.steps.length], id).toEqual([v1.strategy, v1.workflowHash, 1]);
    }
  });
  it('supply → borrow → swap of the borrowed USDC on Base Sepolia is the existing lending composition', () => {
    const lending = STRATEGY_EXAMPLES.find(e => e.id === 'lending-composition-base-sepolia')!.strategy;
    const v2 = workflow({ version: 2, steps: [SUPPLY, BORROW, { ...SWAP, slippageBps: 50 }] }), v1 = composeStrategy(lending);
    if (!v1.ok) throw new Error('lending');
    expect(v2.steps).toHaveLength(1);
    expect(v2.strategy).toMatchObject({ action: 'lending_composition', supplyAmount: '10', borrowAmount: '2', owner: OWNER });
    expect(workflowPlan(v2)).toMatchObject({ kind: 'COMPOSITE_FLOW', flow: 'lending-composition', steps: [{ action: 'supply' }, { action: 'borrow' }, { action: 'swap' }] });
    // Near misses stay general sequences: another amount, another account, another order.
    for (const steps of [[SUPPLY, BORROW, { ...SWAP, amount: '1' }], [SUPPLY, { ...BORROW, beneficiary: '0x' + '2'.repeat(40) }, SWAP], [BORROW, SUPPLY, SWAP]])
      expect(workflow({ version: 2, steps }).steps).toHaveLength(3);
  });
  it('several steps keep their own IRs and hashes; the workflow hash covers them in order', () => {
    const a = workflow({ version: 2, steps: [BRIDGE, SWAP] }), b = workflow({ version: 2, steps: [SWAP, BRIDGE] });
    expect(a.steps.map(s => s.workflowHash)).toEqual([...b.steps.map(s => s.workflowHash)].reverse());
    expect(a.workflowHash).toBe(workflowSequenceHash(a.steps.map(s => s.workflowHash)));
    expect(a.workflowHash).not.toBe(b.workflowHash);
    expect(workflow({ version: 2, steps: [BRIDGE, { ...SWAP, amount: '1.5' }] }).workflowHash).not.toBe(a.workflowHash);
    expect(a.strategy).toEqual({ version: 2, steps: a.steps.map(s => s.strategy) });
    expect(workflow(a.strategy).workflowHash).toBe(a.workflowHash);
    expect(a.fundsClass).toBe('TEST_FUNDS');
    expect(workflow({ version: 2, steps: [BRIDGE, SOLANA] }).fundsClass).toBe('REAL_FUNDS');
  });
  it('refuses malformed step lists at the exact step and field, never echoing values', () => {
    expect(strategyInputIssues({ version: 2, steps: [] })).toEqual([{ path: '/steps', rule: 'minItems' }]);
    expect(strategyInputIssues({ version: 2, steps: Array(9).fill(SWAP) })).toEqual([{ path: '/steps', rule: 'maxItems' }]);
    expect(strategyInputIssues({ version: 2, steps: [SWAP], extra: 1 })).toEqual([{ path: '/', rule: 'additionalProperties' }]);
    expect(strategyInputIssues({ version: 2, steps: [SWAP, { ...SWAP, calldata: '0xdead' }] })).toEqual([{ path: '/steps/1/calldata', rule: 'additionalProperties' }]);
    expect(strategyInputIssues({ version: 2, steps: [{ action: 'transfer' }] })).toEqual([{ path: '/steps/0/action', rule: 'enum' }]);
    expect(composeWorkflow({ version: 2, steps: [SWAP, { ...BRIDGE, amount: '500' }] })).toMatchObject({ ok: false, code: 'ROUTER_AMOUNT_OUT_OF_RANGE' });
  });
  it('plans and gates a general sequence honestly: per-step facts, MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED, policy over every network', async () => {
    const w = workflow({ version: 2, steps: [BRIDGE, SWAP] });
    expect(workflowPlan(w)).toMatchObject({ kind: 'NOT_EXECUTABLE', reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED', networks: ['base-sepolia', 'arbitrum-sepolia'],
      steps: [{ index: 0, action: 'bridge', flow: 'crosschain-router-testnet', workflowHash: w.steps[0]!.workflowHash },
        { index: 1, action: 'swap', flow: 'base-sepolia-swap', workflowHash: w.steps[1]!.workflowHash }] });
    const gates = await evaluateWorkflowGates(w, runtime(), readHandoffPolicy({}));
    expect(gates).toMatchObject({ handoff: { allowed: false, reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' }, supportedByCode: { execute: false,
      steps: [{ index: 0, execute: true, deploymentEnabled: true }, { index: 1, execute: true, deploymentEnabled: true }] }, enabledByPolicy: { enabled: true } });
    const mixed = await evaluateWorkflowGates(workflow({ version: 2, steps: [BRIDGE, SOLANA] }), runtime(), readHandoffPolicy({}));
    expect(mixed.enabledByPolicy).toMatchObject({ enabled: false, reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY', fundsClass: 'REAL_FUNDS' });
  });
  it('works end to end over MCP: compose and review per step, simulate one step at a time', async () => {
    const dev = { principal: 'dev-alice', token: credential() }, client = session({ env: gatewayEnv([dev]), token: dev.token });
    const composed = (await client.callTool('compose_strategy', { strategy: { version: 2, steps: [BRIDGE, SWAP] } })).output as Record<string, unknown>;
    expect(composed).toMatchObject({ ok: true, stepCount: 2, executionPlan: { kind: 'NOT_EXECUTABLE', reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' },
      workflowSteps: [{ index: 0, action: 'bridge' }, { index: 1, action: 'swap' }], authority: expect.stringMatching(/^NONE/) });
    const hash = String(composed.workflowHash);
    expect((await client.callTool('validate_strategy', { strategy: composed.strategy, workflowHash: hash })).output).toMatchObject({ ok: true, valid: true, stepCount: 2 });
    expect((await client.callTool('review_strategy', { strategy: composed.strategy, workflowHash: hash })).output).toMatchObject({ ok: true, stepCount: 2,
      workflowSteps: [{ index: 0 }, { index: 1 }], executionPlan: { reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED' } });
    expect((await client.callTool('simulate_strategy', { strategy: composed.strategy, workflowHash: hash, simulationSubject: OWNER })).output)
      .toEqual({ ok: false, code: 'SIMULATE_ONE_STEP_AT_A_TIME', stepCount: 2 });
    const single = (await client.callTool('compose_strategy', { strategy: { version: 2, steps: [BRIDGE] } })).output;
    expect(single).toMatchObject({ ok: true, stepCount: 1, executionPlan: { kind: 'SINGLE_FLOW', reason: null } });
    expect((await client.callTool('get_capabilities', {})).output).toMatchObject({ stepLists: { maxSteps: 8 } });
  });
});

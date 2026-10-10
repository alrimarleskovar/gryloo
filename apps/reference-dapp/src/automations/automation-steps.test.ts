// SPDX-License-Identifier: AGPL-3.0-only
// BUILD-AUTOMATION-002: "Automate this workflow" reads the exact Canvas workflow (built here by the real chat grammar and Canvas reducer).
import { describe, expect, it } from 'vitest';
import { buildWorkflow, FIXTURE } from '../domain/copilot-test-fixtures';
import { composeWorkflowBound } from '../engine/strategy-engine';
import { routeStrategy } from './assets';
import { bindStrategy, strategyOfSavedWorkflow } from './binding';
import { automationSteps } from './automation-steps';

const BASE_50 = 'swap 50 USDC to WETH on Base Sepolia slippage 50 bps', BASE_40 = 'swap 40 USDC to WETH on Base Sepolia slippage 50 bps';
const hashOf = (routes: readonly Parameters<typeof routeStrategy>[0][]) => {
  const strategies = routes.map(r => { const s = routeStrategy(r); if (!s.ok) throw Error(s.code); return s.strategy; });
  const composed = composeWorkflowBound(strategies.length === 1 ? strategies[0] : { version: 2, steps: strategies }, undefined);
  if (!composed.ok) throw Error(composed.code);
  return composed.workflowHash;
};

describe('the exact Canvas workflow → automation steps', () => {
  it('reproduces a multi-step Base Sepolia workflow node for node, in Canvas order', () => {
    const r = automationSteps(buildWorkflow([BASE_50, BASE_40]));
    expect(r.ok).toBe(true);
    expect(r.steps.map(s => s.route)).toEqual([{ asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 },
      { asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '40', slippageBps: 50 }]);
  });
  it('binds the same canonical hash as AUTOMATION-001\'s saved-workflow binding of the same Canvas workflow', () => {
    const workflow = buildWorkflow([BASE_50]);
    const saved = strategyOfSavedWorkflow(workflow as Parameters<typeof strategyOfSavedWorkflow>[0]);
    const bound = saved.ok ? bindStrategy(saved.strategy) : null;
    const r = automationSteps(workflow);
    expect(r.ok && bound?.ok).toBe(true);
    if (r.ok && bound?.ok) expect(hashOf(r.steps.map(s => s.route))).toBe(bound.binding.workflowHash);
  });
  it.each([
    ['swap 20 USDC to WETH on Ethereum Sepolia slippage 50 bps', { asset: 'ETH', side: 'BUY', network: 'ethereum-sepolia', amount: '20', slippageBps: 50 }],
    ['swap 0.01 WETH to USDC on Base Sepolia slippage 75 bps', { asset: 'ETH', side: 'SELL', network: 'base-sepolia', amount: '0.01', slippageBps: 75 }],
    ['swap 5 devUSDC to SOL on Solana Devnet slippage 50 bps', { asset: 'SOL', side: 'BUY', network: 'solana-devnet', amount: '5', slippageBps: 50 }],
  ] as const)('reproduces %s', (sentence, route) => {
    expect(automationSteps(buildWorkflow([sentence]))).toMatchObject({ ok: true, steps: [{ route }] });
  });
  it('refuses a Base → Arbitrum composition (a bridge is not a reproducible swap) and still lists every node', () => {
    const r = automationSteps(buildWorkflow(['compose bridge 1 USDC from Base to Arbitrum slippage 50 bps then swap to WETH slippage 50 bps']));
    expect(r).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' });
    expect(r.steps.map(s => [s.actionType, s.chainId, s.route])).toEqual([['asset.bridge', 'eip155:8453', null], ['asset.swap.exact-input', 'eip155:42161', null]]);
  });
  it('refuses any difference from what the engine reproduces, never approximating it', () => {
    const workflow = buildWorkflow([BASE_50]);
    const node = workflow.nodes.find(n => !n.actionType.startsWith('mock-'))!;
    const tampered = { ...workflow, nodes: workflow.nodes.map(n => n === node ? { ...n, adapterConstraints: { ...n.adapterConstraints, protocols: ['other-dex'] } } : n) };
    expect(automationSteps(tampered)).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' });
    const failing = { ...workflow, nodes: workflow.nodes.map(n => n === node ? { ...n, failurePolicy: 'CONTINUE' } : n) };
    expect(automationSteps(failing)).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' });
  });
  it('refuses an empty Canvas, a malformed document, too many steps and an out-of-order dependency', () => {
    const empty = buildWorkflow([]);
    expect(automationSteps(empty)).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_EMPTY' });
    expect(automationSteps({ nodes: 'x' })).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_INVALID' });
    expect(automationSteps(buildWorkflow([BASE_50, BASE_40, FIXTURE.testnetSwap, FIXTURE.testnetSwap2, BASE_50]))).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_TOO_LONG' });
    const two = buildWorkflow([BASE_50, BASE_40]);
    const [first, second] = two.nodes.filter(n => !n.actionType.startsWith('mock-'));
    const reordered = { ...two, nodes: two.nodes.map(n => n === first ? { ...n, dependencies: [second!.nodeId] } : n) };
    expect(automationSteps(reordered)).toMatchObject({ ok: false, code: 'AUTOMATION_WORKFLOW_ORDER_UNSUPPORTED' });
  });
});

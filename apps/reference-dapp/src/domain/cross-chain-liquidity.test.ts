// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { createCrossChainLiquidityWorkflow } from './cross-chain-liquidity';
import { editorReducer, initialEditor } from './editor';
import { parseLocalCommand } from './commands';
const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const recipient = '0x1111111111111111111111111111111111111111';
const input = { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50', tickLower: '-200100',
  tickUpper: '-199900', recipient, provider: 'lifi.rest' as const, noSwap: false };
describe('BUILD-011C-1 shared semantic graph', () => {
  it('chat and canvas author the identical four-node graph with real output references', () => {
    const before = initialEditor();
    const chat = editorReducer(before, parseLocalCommand(`bridge 100 USDC from Base to Arbitrum via LI.FI and create Uniswap liquidity ticks -200100 to -199900 recipient ${recipient}`, before.workflow, context), context);
    const canvas = editorReducer(before, { type: 'AUTHOR_CROSS_CHAIN_LIQUIDITY', input, source: 'CANVAS', baseRevision: 0 }, context);
    expect(chat.error).toBeNull(); expect(chat.workflow).toEqual(canvas.workflow);
    expect(chat.workflow.nodes.map(node => node.actionType)).toEqual(['asset.bridge','asset.liquidity.prepare','asset.swap.exact-input','asset.liquidity.uniswap-v3']);
    expect(chat.workflow.resourceEdges).toHaveLength(4);
    expect(validateAuthoringWorkflow(JSON.parse(JSON.stringify(chat.workflow)), context)).toBeTruthy();
  });
  it('permits fixed direct Across and a deliberate no-swap graph, while preserving dependencies', () => {
    const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, { ...input, provider: 'across.direct', noSwap: true });
    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes[0]?.adapterConstraints.adapters[0]?.id).toBe('across.direct');
    expect(validateAuthoringWorkflow(flow, context)).toBeTruthy();
    const bad = { ...flow, nodes: flow.nodes.map(node => node.nodeId === 'build011c-mint' ? { ...node, dependencies: [] } : node) };
    expect(() => validateAuthoringWorkflow(bad, context)).toThrow();
  });
  it('rejects provider or semantic path mutations and round-trips without changing references', () => {
    const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, input);
    expect(JSON.parse(JSON.stringify(flow))).toEqual(flow);
    const switched = { ...flow, nodes: flow.nodes.map(node => node.nodeId === 'build011c-bridge'
      ? { ...node, adapterConstraints: { adapters: [{ id: 'across.direct', version: '1.0.0' }], protocols: ['across'] } } : node) };
    expect(validateAuthoringWorkflow(switched, context)).toBeTruthy();
    expect(JSON.stringify(switched)).not.toBe(JSON.stringify(flow));
  });
});

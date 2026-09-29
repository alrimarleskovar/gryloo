// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCrossChainLiquidityWorkflow } from '../../../apps/reference-dapp/src/domain/cross-chain-liquidity';
import { validateCrossChainLiquidityWorkflow } from '../src/cross-chain-liquidity.js';
const owner = '0x1111111111111111111111111111111111111111';
const input = { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50',
  tickLower: '-200100', tickUpper: '-199900', recipient: owner, provider: 'lifi.rest' as const, noSwap: false };
describe('BUILD-011C-1 closed composition graph', () => {
  it('validates bridge → preparation → partial swap → mint output references', () => {
    const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, input);
    expect(validateCrossChainLiquidityWorkflow(flow)).toMatchObject({ bridgeProvider: 'lifi.rest', noSwap: false });
    expect(flow.resourceEdges.map(e => e.outputId)).toEqual(['amount-out', 'swap-input', 'liquidity-usdc', 'amount-out']);
  });
  it('accepts the direct Across bridge and deliberate one-sided no-swap path', () => {
    const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, { ...input, provider: 'across.direct', noSwap: true });
    expect(validateCrossChainLiquidityWorkflow(flow)).toMatchObject({ bridgeProvider: 'across.direct', noSwap: true });
  });
  it('rejects a changed dependency, recipient, fee or edge', () => {
    const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, input);
    for (const changed of [
      { ...flow, resourceEdges: flow.resourceEdges.slice(1) },
      { ...flow, nodes: flow.nodes.map(n => n.nodeId === 'build011c-mint' ? { ...n, dependencies: [] } : n) },
      { ...flow, nodes: flow.nodes.map(n => n.nodeId === 'build011c-prepare' ? { ...n,
        inputs: n.inputs.map(i => i.name === 'fee-tier' ? { ...i, value: 3000 } : i) } : n) },
    ]) expect(() => validateCrossChainLiquidityWorkflow(changed)).toThrow('CROSS_CHAIN_LIQUIDITY_GRAPH_INVALID');
  });
});

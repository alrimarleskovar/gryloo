// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '../src/context.js';
import { validateAuthoringWorkflow } from '../src/validation.js';
import { validateCompositionWorkflow } from '../src/composition.js';
import { createSwapNode } from '../../../apps/reference-dapp/src/domain/swap-authoring.js';
import { createLiquidityNode } from '../../../apps/reference-dapp/src/domain/liquidity-authoring.js';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const safe = '0x1111111111111111111111111111111111111111';
function fixture() {
  const swap = createSwapNode('swap', 'USDC_TO_WETH', '400', '50', context);
  const mint = createLiquidityNode('mint', { weth: '0.1', usdc: '200', minimumWeth: '0.01', minimumUsdc: '1',
    tickLower: '-197510', tickUpper: '-197310', recipient: safe }, context);
  return { schemaVersion: '1.0.0' as const, workflowId: 'b007-fixture', revision: 1,
    nodes: [{ ...swap, requiredAuthorizationClass: 'MODE_B' as const }, { ...mint, requiredAuthorizationClass: 'MODE_B' as const,
      dependencies: ['swap'], inputs: [...mint.inputs, { name: 'weth-from-swap', kind: 'OUTPUT_REFERENCE' as const,
        value: { nodeId: 'swap', outputId: 'amount-out' } }] }],
    resourceEdges: [{ fromNodeId: 'swap', outputId: 'amount-out', toNodeId: 'mint', inputName: 'weth-from-swap' }] };
}
describe('BUILD-007 strict composition graph', () => {
  it('accepts only the typed USDC to WETH to position graph', () => {
    const value = fixture();
    expect(validateCompositionWorkflow(value, context).maxUSDC).toBe(200_000_000n);
    expect(validateAuthoringWorkflow(value, context)).toBe(value);
  });
  it('rejects changed edge, recipient, adapter and graph', () => {
    const base = fixture();
    for (const changed of [
      { ...base, resourceEdges: [{ ...base.resourceEdges[0]!, outputId: 'wrong' }] },
      { ...base, nodes: base.nodes.map((n, i) => i ? { ...n, inputs: n.inputs.map(x => x.name === 'recipient' ?
        { name: 'recipient', kind: 'ACCOUNT' as const, value: { chainId: 'eip155:1', address: '0x2222222222222222222222222222222222222222' } } : x) } : n) },
      { ...base, nodes: base.nodes.map((n, i) => i ? { ...n, adapterConstraints: { adapters: ['arbitrary'], protocols: ['uniswap-v3'] } } : n) },
      { ...base, nodes: [...base.nodes, base.nodes[0]!] },
    ]) expect(() => validateAuthoringWorkflow(changed, context)).toThrow();
  });
});

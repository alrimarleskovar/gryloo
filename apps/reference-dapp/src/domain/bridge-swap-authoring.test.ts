// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { createBridgeSwapWorkflow } from './bridge-swap-authoring';
import { parseLocalCommand } from './commands';
import { editorReducer, initialEditor } from './editor';
const context = createReviewContext({ registryId: 'reference.registry', capabilityId: 'swap.direct-transaction',
  actionId: 'asset.swap.exact-input', assets: baseAssetRegistry });
const input = { amount: '1.25', slippageBps: '50', swapSlippageBps: '75' };
describe('BUILD-009 authoring', () => {
  it('creates the same exact typed Base → Arbitrum bridge → swap graph from chat and canvas', () => {
    const before = initialEditor();
    const chat = editorReducer(before, parseLocalCommand('compose bridge 1.25 USDC from Base to Arbitrum slippage 50 bps then swap to WETH slippage 75 bps', before.workflow, context), context);
    const canvas = editorReducer(before, { type: 'AUTHOR_BRIDGE_SWAP', input, source: 'CANVAS', baseRevision: 0 }, context);
    expect(chat.error).toBeNull(); expect(chat.workflow).toEqual(canvas.workflow);
    expect(chat.workflow.resourceEdges).toEqual([{ fromNodeId: 'build009-bridge', outputId: 'amount-out', toNodeId: 'build009-swap', inputName: 'amount-in' }]);
    expect(chat.workflow.nodes[0]?.expectedOutputs[0]?.asset.chainId).toBe('eip155:42161');
    expect(validateAuthoringWorkflow(createBridgeSwapWorkflow('workflow-local', 1, input), context)).toBeTruthy();
  });
  it('rejects alternate destination assets and missing dependency', () => {
    const good = createBridgeSwapWorkflow('workflow-local', 1, input);
    expect(() => validateAuthoringWorkflow({ ...good, nodes: [good.nodes[0]!, { ...good.nodes[1]!, dependencies: [] }] }, context)).toThrow();
    const swap = good.nodes[1]!;
    expect(() => validateAuthoringWorkflow({ ...good, nodes: [good.nodes[0]!, { ...swap, expectedOutputs: [{ ...swap.expectedOutputs[0]!, asset: { chainId: 'eip155:42161', address: '0x1111111111111111111111111111111111111111', decimals: 18 } }] }] }, context)).toThrow();
  });
});

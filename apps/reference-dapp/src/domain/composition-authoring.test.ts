// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { createCompositionWorkflow, type CompositionInput } from './composition-authoring';
import { editorReducer, initialEditor } from './editor';
import { parseLocalCommand } from './commands';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const safe = '0x1111111111111111111111111111111111111111';
const input: CompositionInput = { swapUSDC: '400', slippageBps: '50', mint: { weth: '0.1', usdc: '200', minimumWeth: '0.01', minimumUsdc: '1',
  tickLower: '-197510', tickUpper: '-197310', recipient: safe } };
describe('BUILD-007 common composition authoring', () => {
  it('chat and canvas produce the same versioned graph and a material edit replaces it', () => {
    const original = initialEditor();
    const chat = parseLocalCommand(`compose swap 400 USDC to WETH slippage 50 bps then mint maximum 0.1 WETH and 200 USDC minimum 0.01 WETH and 1 USDC ticks -197510 to -197310 safe ${safe}`, original.workflow, context);
    const canvas = { type: 'AUTHOR_COMPOSITION' as const, safe, input, source: 'CANVAS' as const, baseRevision: 0 };
    const a = editorReducer(original, chat, context), b = editorReducer(original, canvas, context);
    expect(a.error).toBeNull(); expect(a.workflow).toEqual(b.workflow); expect(a.workflow.nodes).toHaveLength(2);
    expect(a.workflow.resourceEdges).toEqual([{ fromNodeId: 'composition-swap', outputId: 'amount-out', toNodeId: 'composition-mint', inputName: 'weth-from-swap' }]);
    const revised = editorReducer(a, { ...canvas, baseRevision: 1, input: { ...input, mint: { ...input.mint, tickUpper: '-197300' } } }, context);
    expect(revised.error).toBeNull(); expect(revised.workflow.revision).toBe(2);
    expect(editorReducer(revised, canvas, context).error).toMatch(/CONFLICT/);
  });
  it('rejects recipient mismatch and malformed edge before authorization', () => {
    expect(() => createCompositionWorkflow('w', 1, '0x2222222222222222222222222222222222222222', input, context)).toThrow();
    const graph = createCompositionWorkflow('w', 1, safe, input, context);
    expect(() => validateAuthoringWorkflow({ ...graph, resourceEdges: [{ ...graph.resourceEdges[0]!, outputId: 'wrong' }] }, context)).toThrow();
  });
});

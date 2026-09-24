// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { parseLocalCommand } from './commands';
import { formatHumanAmount } from './swap-authoring';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });

describe('shared swap authoring', () => {
  it('creates equal IR from chat text and canvas form in both directions', () => {
    for (const [direction, text, amount] of [
      ['USDC_TO_WETH', 'swap 2.25 USDC to WETH on Base slippage 50 bps', '2.25'],
      ['WETH_TO_USDC', 'swap 0.125 WETH to USDC on Base slippage 50 bps', '0.125'],
    ] as const) {
      const start = initialEditor();
      const chat = editorReducer(start, parseLocalCommand(text, start.workflow, context), context);
      const canvas = editorReducer(start, { type: 'ADD_SWAP', direction, amount, slippage: '50', source: 'CANVAS', baseRevision: 0 }, context);
      expect(chat.error).toBeNull(); expect(canvas.error).toBeNull();
      expect(chat.workflow).toEqual(canvas.workflow);
      expect(lintWorkflow(chat.workflow, context).executable).toBe(false);
      const node = chat.workflow.nodes[1]!;
      const quantity = node.inputs[0]!;
      if (quantity.kind !== 'QUANTITY') throw new Error('missing amount');
      expect(formatHumanAmount(quantity.value.amount, direction === 'USDC_TO_WETH' ? 'USDC' : 'WETH', context)).toBe(amount);
    }
  });
  it('rejects stale edits, swap connections, locked edits and cap widening', () => {
    const added = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context);
    const stale = editorReducer(added, { type: 'SET_SLIPPAGE', nodeId: 'node-002', slippage: '80', source: 'CHAT', baseRevision: 0 }, context);
    expect(stale.workflow).toBe(added.workflow);
    const edge = editorReducer(added, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 }, context);
    expect(edge.error).toBe('SWAP_EDGE_UNSUPPORTED');
    const locked = editorReducer(added, { type: 'LOCK', nodeId: 'node-002', locked: true, source: 'CANVAS', baseRevision: 1 }, context);
    expect(locked.workflow.nodes[1]?.editableBounds).toEqual([]);
    const refused = editorReducer(locked, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002', amount: '3', source: 'CHAT', baseRevision: 2 }, context);
    expect(refused.workflow).toBe(locked.workflow);
    const unlocked = editorReducer(locked, { type: 'LOCK', nodeId: 'node-002', locked: false, source: 'CANVAS', baseRevision: 2 }, context);
    expect(unlocked.workflow.nodes[1]?.editableBounds[0]?.maximumAmount).toBe('1000000000000');
  });
});

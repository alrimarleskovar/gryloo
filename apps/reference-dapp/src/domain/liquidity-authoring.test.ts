// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { parseLocalCommand } from './commands';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const recipient = '0x1111111111111111111111111111111111111111';
const input = { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0', tickLower: '-100', tickUpper: '100', recipient };
describe('shared liquidity authoring', () => {
  it('chat and canvas make identical IR, and a material edit advances revision', () => {
    const original = initialEditor();
    const chat = parseLocalCommand(`add liquidity 0.1 WETH and 200 USDC minimum 0 WETH and 0 USDC ticks -100 to 100 recipient ${recipient}`, original.workflow, context);
    const canvas = { type: 'ADD_LIQUIDITY' as const, input, source: 'CANVAS' as const, baseRevision: 0 };
    const a = editorReducer(original, chat, context), b = editorReducer(original, canvas, context);
    expect(a.error).toBeNull(); expect(a.workflow).toEqual(b.workflow); expect(a.workflow.revision).toBe(1);
    const edit = editorReducer(a, { type: 'SET_LIQUIDITY', nodeId: 'node-002', input: { ...input, tickUpper: '200' }, source: 'CANVAS', baseRevision: 1 }, context);
    expect(edit.error).toBeNull(); expect(edit.workflow.revision).toBe(2);
    expect(editorReducer(edit, canvas, context).error).toMatch(/CONFLICT/);
  });
  it('rejects duplicate isolated positions, invalid ranges and composition edges', () => {
    const a = editorReducer(initialEditor(), { type: 'ADD_LIQUIDITY', input, source: 'CANVAS', baseRevision: 0 }, context);
    expect(editorReducer(a, { type: 'ADD_LIQUIDITY', input, source: 'CANVAS', baseRevision: 1 }, context).error).toBe('ONE_LIQUIDITY_POSITION_ONLY');
    expect(editorReducer(a, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 }, context).error).toBe('ISOLATED_ACTION_EDGE_UNSUPPORTED');
    expect(editorReducer(a, { type: 'SET_LIQUIDITY', nodeId: 'node-002', input: { ...input, tickLower: '99' }, source: 'CANVAS', baseRevision: 1 }, context).workflow).toBe(a.workflow);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { canvasPosition, defaultCanvasPosition } from './canvas-layout';
import type { ActionKind } from './mock-actions';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });

describe('canvas action toolbox semantics', () => {
  it('adds an unquoted Base swap through the existing semantic reducer', () => {
    const result = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context);
    expect(result.error).toBeNull();
    expect(result.workflow.nodes[1]?.actionType).toBe('asset.swap.exact-input');
  });
  it.each(['bridge', 'pool', 'lending', 'borrow'] as const)('adds a clearly nonexecuting %s template', kind => {
    const result = editorReducer(initialEditor(), { type: 'ADD', kind: kind as ActionKind, source: 'CANVAS', baseRevision: 0 }, context);
    expect(result.error).toBeNull();
    expect(result.workflow.nodes[1]?.actionType).toBe(`mock-${kind}`);
    expect(result.workflow.nodes[1]?.requiredAuthorizationClass).toBe('NONE');
    expect(result.workflow.nodes[1]?.requiredCapabilities).toEqual([]);
    expect(canvasPosition({}, result.workflow.nodes[1]!, 1)).toEqual(defaultCanvasPosition(1));
  });
  it('does not let a template bypass swap validation', () => {
    const swap = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context);
    const result = editorReducer(swap, { type: 'ADD', kind: 'pool', source: 'CANVAS', baseRevision: 1 }, context);
    expect(result.error).toBeNull();
    expect(result.workflow.nodes[2]?.actionType).toBe('mock-pool');
  });
});

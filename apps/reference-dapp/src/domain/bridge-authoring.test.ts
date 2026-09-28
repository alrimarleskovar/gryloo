import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { parseLocalCommand } from './commands';
import { editorReducer, initialEditor } from './editor';
import { createBridgeNode, parseBridgeAmount } from './bridge-authoring';
const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
describe('bridge authoring', () => {
  it('uses identical semantic IR for chat and canvas', () => {
    const initial = initialEditor();
    const chat = editorReducer(initial, parseLocalCommand('bridge 1.25 USDC from Base to Optimism slippage 50 bps', initial.workflow, context), context);
    const canvas = editorReducer(initial, { type: 'ADD_BRIDGE', input: { amount: '1.25', slippageBps: '50' },
      source: 'CANVAS', baseRevision: initial.workflow.revision }, context);
    expect(chat.error).toBeNull();
    expect(chat.workflow).toEqual(canvas.workflow);
    expect(chat.workflow.nodes[0]?.actionType).toBe('asset.bridge');
    expect(validateAuthoringWorkflow(chat.workflow, context)).toBeTruthy();
  });
  it('rejects precision overflow and route data in semantic input', () => {
    expect(() => parseBridgeAmount('1.0000001')).toThrow();
    expect(() => createBridgeNode('node-002', { amount: '1', slippageBps: '301' })).toThrow();
  });
});

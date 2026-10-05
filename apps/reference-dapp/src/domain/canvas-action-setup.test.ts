// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { canvasAddCommand } from './canvas-authoring';
import { canvasAmountCommand, canvasAmountMessage, canvasAuthoringIncomplete } from './canvas-action-setup';
import { editorHistoryReducer, initialEditorHistory, type EditorHistory } from './editor-history';

const context = createBaseSepoliaReviewContext();
const start = (action: 'swap' | 'bridge') => editorHistoryReducer(initialEditorHistory(), { type: 'START_ACTION_SETUP', action, position: { x: 90, y: 90 } });
const input = (state: EditorHistory, amount: string, id = state.actionSetup!.id) => editorHistoryReducer(state, { type: 'EDIT_CANVAS_AMOUNT', id, amount, context });
const apply = (state: EditorHistory) => {
  const id = state.actionSetup!.id, amount = state.actionSetup!.amount;
  const command = canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, id, context);
  return editorHistoryReducer(state, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: amount });
};
const incomplete = (state: EditorHistory) => canvasAuthoringIncomplete(state.actionSetup, state.amountInputs);
const financial = (state: EditorHistory) => state.editor.workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));

describe('zero-based product authoring without invalid executable IR', () => {
  it.each(['swap', 'bridge'] as const)('adding %s creates only an unconfigured zero action and cannot imply amount 1', action => {
    const initial = initialEditorHistory(), state = start(action);
    expect(state.actionSetup).toMatchObject({ action, amount: '0' });
    expect(state.editor.workflow).toEqual(initial.editor.workflow);
    expect(financial(state)).toEqual([]);
    expect(incomplete(state)).toBe(true);
    expect(() => canvasAddCommand(action, 0, null)).toThrow('Enter an amount');
    expect(() => canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, state.actionSetup!.id, context)).toThrow();
  });

  it.each(['swap', 'bridge'] as const)('%s rejects zero, empty, malformed and negative amounts without changing the IR', action => {
    const initial = start(action);
    for (const amount of ['', '0', '0.00', '-1', '1e2', 'abc']) {
      const state = input(initial, amount);
      expect(incomplete(state)).toBe(true);
      expect(() => canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, state.actionSetup!.id, context)).toThrow();
      try { canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, state.actionSetup!.id, context); }
      catch (cause) { expect(canvasAmountMessage(cause)).toContain('greater than 0'); }
      expect(state.editor.workflow).toBe(initial.editor.workflow);
      expect(financial(state)).toEqual([]);
    }
  });

  it.each(['swap', 'bridge'] as const)('%s accepts a positive amount only through the existing validated command, preserving position/history', action => {
    const prepared = input(start(action), '2.5');
    const id = prepared.actionSetup!.id;
    expect(incomplete(prepared)).toBe(true);
    const accepted = apply(prepared);
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(accepted.actionSetup).toBeNull();
    const node = financial(accepted)[0]!;
    expect(node.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '2500000' } });
    expect(() => validateAuthoringWorkflow(accepted.editor.workflow, context)).not.toThrow();
    expect(accepted.layout[node.nodeId]).toMatchObject({ x: 90, y: 90 });
    expect(accepted.layout[id]).toBeUndefined();
    const undone = editorHistoryReducer(accepted, { type: 'UNDO' });
    expect(financial(undone)).toEqual([]); expect(incomplete(undone)).toBe(true);
    expect(undone.actionSetup).toMatchObject({ amount: '2.5', id });
    const redone = editorHistoryReducer(undone, { type: 'REDO' });
    expect(incomplete(redone)).toBe(false);
    expect(financial(redone)[0]!.inputs).toEqual(node.inputs);
  });

  it.each(['swap', 'bridge'] as const)('%s keeps zero out of canonical IR even if a command bypasses the amount review UI', action => {
    const state = start(action);
    const rejected = editorHistoryReducer(state, { type: 'COMMAND', command: canvasAddCommand(action, state.editor.workflow.revision, null, '0'), context });
    expect(rejected.editor.error).not.toBeNull();
    expect(rejected.editor.workflow).toBe(state.editor.workflow);
    expect(financial(rejected)).toEqual([]);
    const configured = apply(input(state, '2'));
    const node = financial(configured)[0]!;
    const replacement = input(configured, '3', node.nodeId);
    const command = canvasAmountCommand(replacement.editor, null, replacement.amountInputs, node.nodeId, context);
    if (command.type !== 'SET_SWAP_AMOUNT' && command.type !== 'SET_ROUTER_BRIDGE') throw new Error('Expected an existing amount edit');
    const zero = command.type === 'SET_SWAP_AMOUNT' ? { ...command, amount: '0' } : { ...command, input: { ...command.input, amount: '0' } };
    const refused = editorHistoryReducer(configured, { type: 'COMMAND', command: zero, context });
    expect(refused.editor.error).not.toBeNull();
    expect(refused.editor.workflow).toBe(configured.editor.workflow);
    expect(financial(refused)[0]!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '2000000' } });
  });

  it('rejects accepting an amount after the field changes, including a change back to zero', () => {
    const state = input(start('swap'), '2');
    const command = canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, state.actionSetup!.id, context);
    const changed = input(state, '0');
    const rejected = editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: state.actionSetup!.id, authoringAmount: '2' });
    expect(rejected).toBe(changed); expect(financial(rejected)).toEqual([]); expect(incomplete(rejected)).toBe(true);
  });

  it('blocks both later stages while an existing action is cleared, then validates its replacement or restores the original', () => {
    const accepted = apply(input(start('swap'), '2'));
    const id = financial(accepted)[0]!.nodeId;
    const cleared = input(accepted, '', id);
    expect(cleared.editor.workflow).toBe(accepted.editor.workflow); expect(incomplete(cleared)).toBe(true);
    expect(() => canvasAmountCommand(cleared.editor, null, cleared.amountInputs, id, context)).toThrow();
    const cancel = editorHistoryReducer(cleared, { type: 'CANCEL_CANVAS_AMOUNT', id });
    expect(incomplete(cancel)).toBe(false); expect(cancel.editor.workflow).toBe(accepted.editor.workflow);
    const changed = input(cleared, '3', id);
    const command = canvasAmountCommand(changed.editor, null, changed.amountInputs, id, context);
    const applied = editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '3' });
    expect(incomplete(applied)).toBe(false);
    expect(financial(applied)[0]!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '3000000' } });
  });

  it('refuses a new isolated Bridge when its constructor would replace already-authored actions', () => {
    const configured = apply(input(start('swap'), '2'));
    const adding = editorHistoryReducer(configured, { type: 'START_ACTION_SETUP', action: 'bridge', position: { x: 360, y: 90 } });
    const entered = input(adding, '3');
    expect(() => canvasAmountCommand(entered.editor, entered.actionSetup, entered.amountInputs, entered.actionSetup!.id, context)).toThrow('ACTION_REQUIRES_SEPARATE_WORKFLOW');
    expect(entered.editor.workflow).toBe(configured.editor.workflow);
    expect(incomplete(entered)).toBe(true);
  });

  it('keeps setup deletion and restoration in existing history without ever introducing a zero node', () => {
    const state = start('bridge');
    const removed = editorHistoryReducer(state, { type: 'REMOVE_ACTION_SETUP' });
    expect(incomplete(removed)).toBe(false);
    const restored = editorHistoryReducer(removed, { type: 'UNDO' });
    expect(restored.actionSetup).toEqual(state.actionSetup); expect(incomplete(restored)).toBe(true);
    expect(restored.editor.workflow).toBe(state.editor.workflow);
    expect(editorHistoryReducer(restored, { type: 'START_ACTION_SETUP', action: 'swap', position: { x: 100, y: 100 } })).toBe(restored);
  });
});

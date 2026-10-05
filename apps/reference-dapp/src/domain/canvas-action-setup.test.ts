// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { canvasAddCommand } from './canvas-authoring';
import { canvasAmountCommand, canvasAmountMessage, canvasAuthoringIncomplete, amountCommandTarget } from './canvas-action-setup';
import { editorHistoryReducer, initialEditorHistory, type EditorHistory } from './editor-history';

const context = createBaseSepoliaReviewContext();
const owner = '0x1111111111111111111111111111111111111111';
const start = (action: 'swap' | 'bridge' | 'supply' | 'borrow' | 'repay' | 'withdraw') => editorHistoryReducer(initialEditorHistory(), { type: 'START_ACTION_SETUP', action, position: { x: 90, y: 90 }, ...(['supply', 'borrow', 'repay'].includes(action) ? { beneficiary: owner } : {}) });
const input = (state: EditorHistory, amount: string, id = state.actionSetup!.id) => editorHistoryReducer(state, { type: 'EDIT_CANVAS_AMOUNT', id, amount, context });
const apply = (state: EditorHistory) => {
  const id = state.actionSetup!.id, amount = state.actionSetup!.amount;
  const command = canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, id, context);
  return editorHistoryReducer(state, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: amount });
};
const incomplete = (state: EditorHistory) => canvasAuthoringIncomplete(state.actionSetup, state.amountInputs);
const financial = (state: EditorHistory) => state.editor.workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));

describe('Supply reuses the existing inline amount authoring buffer', () => {
  const owner = '0x1111111111111111111111111111111111111111';
  const supplied = () => editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', command: canvasAddCommand('supply', 0, owner, '1'), context });

  it('keeps invalid values out of IR and accepts a positive replacement with the existing SET_SUPPLY command', () => {
    const initial = supplied(), id = financial(initial)[0]!.nodeId;
    for (const value of ['0', '', '-1', '1e2', '0.0000001']) {
      const editing = input(initial, value, id);
      expect(editing.amountInputs[id]).toBe(value); expect(incomplete(editing)).toBe(true);
      expect(editing.editor.workflow).toBe(initial.editor.workflow);
      expect(() => canvasAmountCommand(editing.editor, null, editing.amountInputs, id, context)).toThrow();
    }
    const editing = input(initial, '2.5', id);
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, id, context);
    expect(command).toMatchObject({ type: 'SET_SUPPLY', nodeId: id, input: { amount: '2.5', beneficiary: owner } });
    expect(editing.editor.workflow).toBe(initial.editor.workflow);
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '2.5' });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(financial(accepted)[0]!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '2500000' } });
    expect(() => validateAuthoringWorkflow(accepted.editor.workflow, context)).not.toThrow();
  });

  it('refuses stale Supply acceptance and preserves the original amount on cancellation/history', () => {
    const initial = supplied(), id = financial(initial)[0]!.nodeId, editing = input(initial, '2', id);
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, id, context);
    const cleared = input(editing, '0', id);
    expect(editorHistoryReducer(cleared, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '2' })).toBe(cleared);
    const cancel = editorHistoryReducer(cleared, { type: 'CANCEL_CANVAS_AMOUNT', id });
    expect(incomplete(cancel)).toBe(false); expect(cancel.editor.workflow).toBe(initial.editor.workflow);
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '2' });
    const undone = editorHistoryReducer(accepted, { type: 'UNDO' });
    expect(undone.editor.workflow.nodes).toEqual(initial.editor.workflow.nodes); expect(undone.amountInputs[id]).toBe('2');
    expect(undone.editor.workflow.revision).toBeGreaterThan(accepted.editor.workflow.revision);
    const redone = editorHistoryReducer(undone, { type: 'REDO' });
    expect(redone.editor.workflow.nodes).toEqual(accepted.editor.workflow.nodes);
    expect(redone.editor.workflow.revision).toBeGreaterThan(undone.editor.workflow.revision);
  });

  it('binds lending Supply edits without changing Borrow/linkage or claiming other lending edits', () => {
    const initial = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', context, command: { type: 'AUTHOR_LENDING', source: 'CANVAS', baseRevision: 0, input: { supply: '0.1', borrow: '0.01', slippage: '50', owner } } });
    const editing = input(initial, '0.2', 'lending-supply');
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, 'lending-supply', context);
    if (command.type !== 'AUTHOR_LENDING') throw new Error('Expected the existing lending authoring command');
    expect(command.input).toEqual({ supply: '0.2', borrow: '0.01', slippage: '50', owner });
    expect(amountCommandTarget(command, editing.editor.workflow)).toEqual({ id: 'lending-supply', amount: '0.2' });
    expect(amountCommandTarget({ ...command, input: { ...command.input, borrow: '0.02' } }, editing.editor.workflow)).toBeNull();
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: 'lending-supply', authoringAmount: '0.2' });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(accepted.editor.workflow.resourceEdges).toEqual(initial.editor.workflow.resourceEdges);
    expect(accepted.editor.workflow.nodes.find(node => node.nodeId === 'lending-borrow')?.inputs).toEqual(initial.editor.workflow.nodes.find(node => node.nodeId === 'lending-borrow')?.inputs);
    const reverted = input(initial, '0.1', 'lending-supply');
    const same = canvasAmountCommand(reverted.editor, null, reverted.amountInputs, 'lending-supply', context);
    expect(incomplete(editorHistoryReducer(reverted, { type: 'COMMAND', command: same, context, authoringId: 'lending-supply', authoringAmount: '0.1' }))).toBe(false);
  });
});

describe('zero-based product authoring without invalid executable IR', () => {
  it.each(['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const)('adding %s creates only an unconfigured zero action and cannot imply amount 1', action => {
    const initial = initialEditorHistory(), state = start(action);
    expect(state.actionSetup).toMatchObject({ action, amount: '0' });
    expect(state.editor.workflow).toEqual(initial.editor.workflow);
    expect(financial(state)).toEqual([]);
    expect(incomplete(state)).toBe(true);
    expect(() => canvasAddCommand(action, 0, null)).toThrow('Enter an amount');
    expect(() => canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, state.actionSetup!.id, context)).toThrow();
  });

  it.each(['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const)('%s rejects zero, empty, malformed and negative amounts without changing the IR', action => {
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

  it.each(['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const)('%s accepts a positive amount only through the existing validated command, preserving position/history', action => {
    const prepared = input(start(action), '2.5');
    const id = prepared.actionSetup!.id;
    expect(incomplete(prepared)).toBe(true);
    const accepted = apply(prepared);
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(accepted.actionSetup).toBeNull();
    const node = financial(accepted)[0]!;
    expect(node.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '2500000' } });
    if (action === 'supply') expect(node.inputs.find(field => field.name === 'beneficiary')).toMatchObject({ value: { address: owner } });
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

  it.each(['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const)('%s keeps zero out of canonical IR even if a command bypasses the amount review UI', action => {
    const state = start(action);
    const rejected = editorHistoryReducer(state, { type: 'COMMAND', command: canvasAddCommand(action, state.editor.workflow.revision, owner, '0'), context });
    expect(rejected.editor.error).not.toBeNull();
    expect(rejected.editor.workflow).toBe(state.editor.workflow);
    expect(financial(rejected)).toEqual([]);
    const configured = apply(input(state, '2'));
    const node = financial(configured)[0]!;
    const replacement = input(configured, '3', node.nodeId);
    const command = canvasAmountCommand(replacement.editor, null, replacement.amountInputs, node.nodeId, context);
    if (command.type !== 'SET_SWAP_AMOUNT' && command.type !== 'SET_ROUTER_BRIDGE' && command.type !== 'SET_SUPPLY' && command.type !== 'SET_BORROW' && command.type !== 'SET_REPAY' && command.type !== 'SET_WITHDRAW') throw new Error('Expected an existing amount edit');
    const zero = command.type === 'SET_SWAP_AMOUNT' ? { ...command, amount: '0' }
      : command.type === 'SET_SUPPLY' ? { ...command, input: { ...command.input, amount: '0' } }
      : command.type === 'SET_BORROW' ? { ...command, input: { ...command.input, amount: '0' } }
      : command.type === 'SET_REPAY' ? { ...command, input: { ...command.input, amount: '0' } }
      : command.type === 'SET_WITHDRAW' ? { ...command, input: { ...command.input, amount: '0' } }
      : { ...command, input: { ...command.input, amount: '0' } };
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


describe('single-value lending cards reuse guarded amount acceptance', () => {
  it.each(['borrow', 'repay', 'withdraw'] as const)('%s edits retain original IR until acceptance and refuse stale reviews', action => {
    const original = apply(input(start(action), '2'));
    const id = financial(original)[0]!.nodeId;
    for (const invalid of ['0', '', '-1', '1e2', '0.0000001']) {
      const editing = input(original, invalid, id);
      expect(editing.editor.workflow).toBe(original.editor.workflow);
      expect(incomplete(editing)).toBe(true);
      expect(() => canvasAmountCommand(editing.editor, null, editing.amountInputs, id, context)).toThrow();
    }
    const editing = input(original, '3.05', id);
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, id, context);
    expect(command).toMatchObject({ type: `SET_${action.toUpperCase()}`, nodeId: id, input: { amount: '3.05' } });
    expect(amountCommandTarget(command, editing.editor.workflow)).toEqual({ id, amount: '3.05' });
    const cleared = input(editing, '0', id);
    expect(editorHistoryReducer(cleared, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '3.05' })).toBe(cleared);
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: '3.05' });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(financial(accepted)[0]!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '3050000' } });
    const restored = editorHistoryReducer(cleared, { type: 'CANCEL_CANVAS_AMOUNT', id });
    expect(restored.editor.workflow).toBe(original.editor.workflow); expect(incomplete(restored)).toBe(false);
  });

  it('lending Borrow edits preserve Supply and update the linked Swap input through AUTHOR_LENDING', () => {
    const original = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', command: canvasAddCommand('lending', 0, owner), context });
    const editing = input(original, '0.02', 'lending-borrow');
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, 'lending-borrow', context);
    expect(command).toMatchObject({ type: 'AUTHOR_LENDING', input: { supply: '0.1', borrow: '0.02', slippage: '50', owner } });
    expect(amountCommandTarget(command, original.editor.workflow)).toEqual({ id: 'lending-borrow', amount: '0.02' });
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: 'lending-borrow', authoringAmount: '0.02' });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(accepted.editor.workflow.resourceEdges).toEqual(original.editor.workflow.resourceEdges);
    expect(accepted.editor.workflow.nodes.find(node => node.nodeId === 'lending-supply')?.inputs).toEqual(original.editor.workflow.nodes.find(node => node.nodeId === 'lending-supply')?.inputs);
    expect(accepted.editor.workflow.nodes.find(node => node.nodeId === 'lending-borrow')!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { amount: '20000' } });
    expect(() => validateAuthoringWorkflow(accepted.editor.workflow, context)).not.toThrow();
    const sameAmount = input(accepted, '0.02', 'lending-borrow');
    const sameCommand = canvasAmountCommand(sameAmount.editor, null, sameAmount.amountInputs, 'lending-borrow', context);
    expect(amountCommandTarget(sameCommand, accepted.editor.workflow, 'lending-borrow')).toEqual({ id: 'lending-borrow', amount: '0.02' });
    expect(incomplete(editorHistoryReducer(sameAmount, { type: 'COMMAND', command: sameCommand, context, authoringId: 'lending-borrow', authoringAmount: '0.02' }))).toBe(false);
  });
});

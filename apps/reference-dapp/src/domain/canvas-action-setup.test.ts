// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { canvasAddCommand } from './canvas-authoring';
import { canvasAmountCommand, canvasAmountMessage, canvasAuthoringIncomplete, amountCommandTarget, setupReviewValue, canvasAmountReviewValue, bridgeSetupNetworks, CANVAS_BRIDGE_NETWORK_OPTIONS } from './canvas-action-setup';
import { ROUTER_NETWORK_OPTIONS, routerDetails, createRouterNode } from './router-authoring';
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

describe('neutral Pool setup', () => {
  it('keeps zero inputs outside the workflow and rejects stale reviews before accepting authored amounts', () => {
    const initial = initialEditorHistory();
    const draft = editorHistoryReducer(initial, { type: 'START_ACTION_SETUP', action: 'pool', position: { x: 90, y: 90 } });
    const setup = draft.actionSetup;
    if (setup?.action !== 'pool') throw new Error('Expected Pool setup');
    expect(setup.input).toMatchObject({ maxUsdc: '0', maxWeth: '0' });
    expect(draft.editor.workflow).toBe(initial.editor.workflow);
    expect(incomplete(draft)).toBe(true);
    expect(() => canvasAmountCommand(draft.editor, setup, {}, setup.id, context)).toThrow('UNISWAP_LIQUIDITY_ZERO');
    const editing = editorHistoryReducer(draft, { type: 'EDIT_POOL_SETUP', id: setup.id, input: { ...setup.input, maxUsdc: '2.5', maxWeth: '0.0002' } });
    const command = canvasAmountCommand(editing.editor, editing.actionSetup, {}, setup.id, context);
    const authoringAmount = setupReviewValue(editing.actionSetup!);
    const changed = editorHistoryReducer(editing, { type: 'EDIT_POOL_SETUP', id: setup.id, input: { ...setup.input, maxUsdc: '3' } });
    expect(editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: setup.id, authoringAmount })).toBe(changed);
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', command, context, authoringId: setup.id, authoringAmount });
    expect(accepted.editor.error).toBeNull();
    expect(accepted.editor.workflow.revision).toBe(1);
    expect(accepted.actionSetup).toBeNull();
    expect(financial(accepted)[0]?.actionType).toBe('asset.liquidity.concentrated');
    expect(accepted.layout[financial(accepted)[0]!.nodeId]).toMatchObject({ x: 90, y: 90 });
    const undone = editorHistoryReducer(accepted, { type: 'UNDO' });
    expect(undone.actionSetup).toEqual(editing.actionSetup);
    expect(financial(undone)).toHaveLength(0);
    const redone = editorHistoryReducer(undone, { type: 'REDO' });
    expect(redone.actionSetup).toBeNull(); expect(financial(redone)).toHaveLength(1);
  });
});


describe('canvas token selection reuses supported Swap directions', () => {
  it('keeps selection outside IR, invalidates stale reviews and validates the selected denomination on apply', () => {
    const initial = input(start('swap'), '0.25'), id = initial.actionSetup!.id;
    const command = canvasAmountCommand(initial.editor, initial.actionSetup, initial.amountInputs, id, context);
    const selected = editorHistoryReducer(initial, { type: 'EDIT_SWAP_SETUP_DIRECTION', id, direction: 'WETH_TO_USDC' });
    expect(selected.editor.workflow).toBe(initial.editor.workflow);
    expect(editorHistoryReducer(selected, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: setupReviewValue(initial.actionSetup!) })).toBe(selected);
    const reviewed = canvasAmountCommand(selected.editor, selected.actionSetup, selected.amountInputs, id, context);
    expect(reviewed).toMatchObject({ type: 'ADD_SWAP', direction: 'WETH_TO_USDC', amount: '0.25' });
    const accepted = editorHistoryReducer(selected, { type: 'COMMAND', command: reviewed, context, authoringId: id, authoringAmount: setupReviewValue(selected.actionSetup!) });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
    expect(financial(accepted)[0]!.inputs.find(field => field.kind === 'QUANTITY')).toMatchObject({ value: { asset: context.assets.WETH.asset, amount: '250000000000000000' } });
    expect(() => validateAuthoringWorkflow(accepted.editor.workflow, context)).not.toThrow();
    const undone = editorHistoryReducer(selected, { type: 'UNDO' });
    expect(undone.actionSetup).toEqual(initial.actionSetup);
    expect(editorHistoryReducer(undone, { type: 'REDO' }).actionSetup).toEqual(selected.actionSetup);
    const excessivePrecision = input(selected, '0.0000000000000000001');
    expect(() => canvasAmountCommand(excessivePrecision.editor, excessivePrecision.actionSetup, excessivePrecision.amountInputs, id, context)).toThrow();
  });

  it('rejects unsupported directions and selection on fixed-asset actions or unrelated cards', () => {
    for (const action of ['bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const) {
      const initial = start(action);
      expect(editorHistoryReducer(initial, { type: 'EDIT_SWAP_SETUP_DIRECTION', id: initial.actionSetup!.id, direction: 'WETH_TO_USDC' })).toBe(initial);
    }
    const initial = start('swap');
    expect(editorHistoryReducer(initial, { type: 'EDIT_SWAP_SETUP_DIRECTION', id: 'other-card', direction: 'WETH_TO_USDC' })).toBe(initial);
    expect(editorHistoryReducer(initial, { type: 'EDIT_SWAP_SETUP_DIRECTION', id: initial.actionSetup!.id, direction: 'FAKE' as 'WETH_TO_USDC' })).toBe(initial);
  });
});


describe('Bridge card networks use existing router authoring capabilities', () => {
  const choose = (state: EditorHistory, patch: { source?: 'Base' | 'Base Sepolia'; destination?: 'Arbitrum' | 'Arbitrum Sepolia' }, id = state.actionSetup!.id) =>
    editorHistoryReducer(state, { type: 'EDIT_BRIDGE_NETWORKS', id, patch, context });
  const review = (state: EditorHistory, id = state.actionSetup!.id) =>
    canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, id, context, state.bridgeNetworkInputs);
  const accept = (state: EditorHistory, id = state.actionSetup!.id) => editorHistoryReducer(state, { type: 'COMMAND', command: review(state, id), context, authoringId: id,
    authoringAmount: state.actionSetup?.id === id ? setupReviewValue(state.actionSetup) : canvasAmountReviewValue(state.amountInputs[id], state.bridgeNetworkInputs[id])! });

  it('offers the existing endpoint catalog and changes only the chosen side of a new card', () => {
    expect(CANVAS_BRIDGE_NETWORK_OPTIONS.source).toEqual(Object.values(ROUTER_NETWORK_OPTIONS).map(option => option.source));
    expect(CANVAS_BRIDGE_NETWORK_OPTIONS.destination).toEqual(Object.values(ROUTER_NETWORK_OPTIONS).map(option => option.destination));
    const initial = input(start('bridge'), '2.5'), source = choose(initial, { source: 'Base' });
    expect(source.actionSetup).toMatchObject({ amount: '2.5', networks: { source: 'Base', destination: 'Arbitrum Sepolia' } });
    expect(source.editor.workflow).toBe(initial.editor.workflow);
    expect(() => review(source)).toThrow('ROUTER_PAIR_UNSUPPORTED');
    const destination = choose(source, { destination: 'Arbitrum' });
    expect(destination.actionSetup).toMatchObject({ networks: { source: 'Base', destination: 'Arbitrum' } });
    expect(review(destination)).toMatchObject({ type: 'ADD_ROUTER_BRIDGE', input: { source: 'Base', destination: 'Arbitrum', amount: '2.5' } });
    const accepted = accept(destination);
    expect(routerDetails(financial(accepted)[0]!)).toMatchObject({ source: 'Base', destination: 'Arbitrum', amount: '2.5' });
    expect(accepted.editor.error).toBeNull(); expect(incomplete(accepted)).toBe(false);
  });

  it('rejects stale network reviews even when the amount did not change', () => {
    const initial = input(start('bridge'), '2'), command = review(initial), id = initial.actionSetup!.id;
    const changed = choose(choose(initial, { source: 'Base' }), { destination: 'Arbitrum' });
    expect(editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: id, authoringAmount: setupReviewValue(initial.actionSetup!) })).toBe(changed);
    const undo = editorHistoryReducer(changed, { type: 'UNDO' });
    expect(undo.actionSetup).toMatchObject({ networks: { source: 'Base', destination: 'Arbitrum Sepolia' } });
    expect(editorHistoryReducer(undo, { type: 'REDO' }).actionSetup).toEqual(changed.actionSetup);
    expect(bridgeSetupNetworks(initial.actionSetup as Extract<typeof initial.actionSetup, { action: 'bridge' }>)).toEqual({ source: 'Base Sepolia', destination: 'Arbitrum Sepolia' });
  });

  it('rejects unsupported endpoints, wrong-side choices and network edits on other actions', () => {
    const initial = start('bridge');
    for (const source of ['Ethereum', 'Optimism', 'Arbitrum']) expect(choose(initial, { source: source as 'Base' })).toBe(initial);
    expect(choose(initial, { destination: 'Base' as 'Arbitrum' })).toBe(initial);
    const other = start('swap'); expect(choose(other, { source: 'Base' })).toBe(other);
    expect(choose(initial, { source: 'Base' }, 'other-card')).toBe(initial);
  });

  it('edits configured router endpoints through SET_ROUTER_BRIDGE and preserves recipient, slippage and provider policy', () => {
    const initial = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', context, command: { type: 'ADD_ROUTER_BRIDGE', source: 'CANVAS', baseRevision: 0, input: { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '2.5', recipient: owner, slippage: '75', routing: 'LIFI' } } }), id = financial(initial)[0]!.nodeId;
    const source = choose(initial, { source: 'Base' }, id);
    expect(source.editor.workflow).toBe(initial.editor.workflow);
    expect(source.bridgeNetworkInputs[id]).toEqual({ source: 'Base', destination: 'Arbitrum Sepolia' });
    expect(source.amountInputs[id]).toBe('2.5'); expect(incomplete(source)).toBe(true);
    expect(() => review(source, id)).toThrow('ROUTER_PAIR_UNSUPPORTED');
    const destination = choose(source, { destination: 'Arbitrum' }, id), command = review(destination, id);
    expect(command).toMatchObject({ type: 'SET_ROUTER_BRIDGE', nodeId: id, input: { source: 'Base', destination: 'Arbitrum', amount: '2.5', recipient: owner, slippage: '75', routing: 'LIFI' } });
    const accepted = accept(destination, id);
    expect(accepted.editor.error).toBeNull(); expect(accepted.bridgeNetworkInputs).toEqual({}); expect(incomplete(accepted)).toBe(false);
    expect(routerDetails(financial(accepted)[0]!)).toMatchObject({ source: 'Base', destination: 'Arbitrum', amount: '2.5', recipient: owner, slippage: '75', routing: 'LIFI' });
    const undo = editorHistoryReducer(accepted, { type: 'UNDO' });
    expect(routerDetails(financial(undo)[0]!)?.network).toBe('testnet'); expect(undo.bridgeNetworkInputs[id]).toEqual(destination.bridgeNetworkInputs[id]);
    const cancel = editorHistoryReducer(destination, { type: 'CANCEL_CANVAS_AMOUNT', id });
    expect(cancel.editor.workflow).toBe(initial.editor.workflow); expect(cancel.bridgeNetworkInputs).toEqual({}); expect(incomplete(cancel)).toBe(false);
  });

  it('binds configured-card review acceptance to the exact endpoint draft and respects locked routes', () => {
    const initial = accept(input(start('bridge'), '2')), id = financial(initial)[0]!.nodeId;
    const selected = choose(choose(initial, { source: 'Base' }, id), { destination: 'Arbitrum' }, id), command = review(selected, id);
    const authoringAmount = canvasAmountReviewValue(selected.amountInputs[id], selected.bridgeNetworkInputs[id])!;
    const changed = choose(selected, { destination: 'Arbitrum Sepolia' }, id);
    expect(editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: id, authoringAmount })).toBe(changed);
    const oldRoute = review(input(initial, '2', id), id);
    expect(editorHistoryReducer(selected, { type: 'COMMAND', command: oldRoute, context, authoringId: id, authoringAmount })).toBe(selected);
    const node = createRouterNode('locked', { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '2', recipient: '', slippage: '50', routing: 'AUTO' });
    const locked = { ...initial, editor: { ...initial.editor, workflow: { ...initial.editor.workflow, nodes: [{ ...node, lockedParameters: [node.inputs[0]!] }] } } };
    expect(choose(locked, { source: 'Base Sepolia' }, 'locked')).toBe(locked);
    const legacy = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', context, command: { type: 'ADD_BRIDGE', input: { amount: '2', slippageBps: '50' }, source: 'CANVAS', baseRevision: 0 } });
    expect(choose(legacy, { source: 'Base Sepolia' }, financial(legacy)[0]!.nodeId)).toBe(legacy);
  });
});

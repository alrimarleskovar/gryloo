// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import {isLendingComposition,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import type { Command } from './commands';
import type { CanvasLayout } from './canvas-layout';
import { editorReducer, initialEditor, type EditorState } from './editor';
import { freeze, type Workflow } from './initial-workflow';
import { canEditCanvasAmount, canvasAmountCommand, amountCommandTarget, type CanvasActionSetup, type CanvasAmountInputs } from './canvas-action-setup';

type Snapshot = { readonly workflow: Workflow; readonly layout: CanvasLayout; readonly actionSetup: CanvasActionSetup | null; readonly amountInputs: CanvasAmountInputs };
export type EditorHistory = { readonly editor: EditorState; readonly layout: CanvasLayout;
  readonly actionSetup: CanvasActionSetup | null; readonly amountInputs: CanvasAmountInputs; readonly setupSerial: number;
  readonly past: readonly Snapshot[]; readonly future: readonly Snapshot[] };
export type HistoryAction =
  | { readonly type: 'RESTORE_LENDING_CANVAS'; readonly workflow: SemanticWorkflow }
  | { readonly type: 'COMMAND'; readonly command: Command; readonly context: ReviewContext; readonly position?: { x: number; y: number }; readonly authoringId?: string; readonly authoringAmount?: string }
  | { readonly type: 'START_ACTION_SETUP'; readonly action: 'swap' | 'bridge'; readonly position: { x: number; y: number } }
  | { readonly type: 'EDIT_CANVAS_AMOUNT'; readonly id: string; readonly amount: string; readonly context: ReviewContext }
  | { readonly type: 'CANCEL_CANVAS_AMOUNT'; readonly id: string }
  | { readonly type: 'REMOVE_ACTION_SETUP' }
  | { readonly type: 'MOVE'; readonly positions: Readonly<Record<string, { x: number; y: number }>> }
  | { readonly type: 'DUPLICATE'; readonly nodeIds: readonly string[]; readonly context: ReviewContext }
  | { readonly type: 'LOAD_LAYOUT'; readonly layout: CanvasLayout }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' };

export const initialEditorHistory = (): EditorHistory => ({ editor: initialEditor(), layout: {}, actionSetup: null, amountInputs: {}, setupSerial: 0, past: [], future: [] });
const snapshot = (state: EditorHistory): Snapshot => ({ workflow: state.editor.workflow, layout: state.layout, actionSetup: state.actionSetup, amountInputs: state.amountInputs });

export function planCanvasDuplicate(workflow: Workflow, layout: CanvasLayout, nodeIds: readonly string[], context: ReviewContext) {
  const selected = new Set(nodeIds);
  const sources = workflow.nodes.filter(node => selected.has(node.nodeId) &&
    (node.actionType.startsWith('mock-') || (node.actionType === 'asset.swap.exact-input' &&
      !node.dependencies.length && !node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE'))));
  if (!sources.length || workflow.nodes.length + sources.length > 1024 || workflow.revision === Number.MAX_SAFE_INTEGER) return null;
  const next = Math.max(9000000000000000, ...workflow.nodes.flatMap(node => /^node-\d{3,16}$/.test(node.nodeId)
    ? [Number(node.nodeId.slice(5))] : []));
  if (next + sources.length > Number.MAX_SAFE_INTEGER) return null;
  const ids = sources.map((_, index) => `node-${next + index + 1}`);
  const copies = new Map(sources.map((node, index) => [node.nodeId, ids[index]!]));
  const nodes: Workflow['nodes'][number][] = sources.map(node => {
    const inputs: Workflow['nodes'][number]['inputs'][number][] = [];
    for (const input of node.inputs) {
      if (input.kind !== 'OUTPUT_REFERENCE') inputs.push(input);
      else if (copies.has(input.value.nodeId)) inputs.push({ ...input,
        value: { ...input.value, nodeId: copies.get(input.value.nodeId)! } });
    }
    return { ...node, nodeId: copies.get(node.nodeId)!,
      dependencies: node.dependencies.flatMap(id => copies.has(id) ? [copies.get(id)!] : []), inputs };
  });
  const resourceEdges = workflow.resourceEdges.filter(edge => copies.has(edge.fromNodeId) && copies.has(edge.toNodeId))
    .map(edge => ({ ...edge, fromNodeId: copies.get(edge.fromNodeId)!, toNodeId: copies.get(edge.toNodeId)! }));
  const candidate = { ...workflow, revision: workflow.revision + 1,
    nodes: [...workflow.nodes, ...nodes], resourceEdges: [...workflow.resourceEdges, ...resourceEdges] };
  try { validateAuthoringWorkflow(candidate, context); } catch { return null; }
  const duplicateLayout = { ...layout };
  for (const [index, node] of sources.entries()) {
    const sourcePosition = layout[node.nodeId]?.actionType === node.actionType
      ? layout[node.nodeId]! : { x: 85 + (workflow.nodes.indexOf(node) % 3) * 270,
        y: 90 + Math.floor(workflow.nodes.indexOf(node) / 3) * 190, actionType: node.actionType };
    duplicateLayout[ids[index]!] = { ...sourcePosition, x: sourcePosition.x + 36, y: sourcePosition.y + 36 };
  }
  return { workflow: freeze(candidate), layout: duplicateLayout, ids };
}

export function editorHistoryReducer(state: EditorHistory, action: HistoryAction): EditorHistory {
  if (action.type === 'START_ACTION_SETUP') {
    // Configure one new action at a time so the existing canonical sequence never changes on acceptance.
    if (state.actionSetup || !Number.isFinite(action.position.x) || !Number.isFinite(action.position.y)) return state;
    const id = `action-setup-${state.setupSerial + 1}`;
    return { ...state, actionSetup: { id, action: action.action, amount: '0' }, setupSerial: state.setupSerial + 1,
      layout: { ...state.layout, [id]: { ...action.position, actionType: action.action === 'swap' ? 'asset.swap.exact-input' : 'asset.bridge' } },
      past: [...state.past, snapshot(state)], future: [] };
  }
  if (action.type === 'EDIT_CANVAS_AMOUNT') {
    if (state.actionSetup?.id === action.id) return { ...state, actionSetup: { ...state.actionSetup, amount: action.amount }, future: [] };
    const node = state.editor.workflow.nodes.find(item => item.nodeId === action.id);
    if (!node || !canEditCanvasAmount(node, action.context)) return state;
    return { ...state, amountInputs: { ...state.amountInputs, [action.id]: action.amount },
      past: state.amountInputs[action.id] === undefined ? [...state.past, snapshot(state)] : state.past, future: [] };
  }
  if (action.type === 'CANCEL_CANVAS_AMOUNT') {
    const amountInputs = { ...state.amountInputs }; delete amountInputs[action.id];
    return { ...state, amountInputs, future: [] };
  }
  if (action.type === 'REMOVE_ACTION_SETUP') {
    if (!state.actionSetup) return state;
    const layout = { ...state.layout }; delete layout[state.actionSetup.id];
    return { ...state, actionSetup: null, layout, past: [...state.past, snapshot(state)], future: [] };
  }
  if(action.type==='RESTORE_LENDING_CANVAS') {
    // Restore only the untouched initial Canvas from a validated durable run.
    // Preserve its exact IR/revision; this creates no Review or execution authority.
    if(state.actionSetup||Object.keys(state.amountInputs).length||state.editor.workflow.revision!==0||state.past.length||!state.editor.workflow.nodes.every(n=>n.actionType.startsWith('mock-')))return state;
    try {
      const workflow=validateAuthoringWorkflow(action.workflow,createBaseSepoliaReviewContext());
      if(!isLendingComposition(workflow))return state;
      return {...state,editor:{workflow:freeze(workflow),error:null},layout:{},past:[],future:[]};
    } catch {return state;}
  }
  if (action.type === 'LOAD_LAYOUT') return { ...state, layout: action.layout };
  if (action.type === 'DUPLICATE') {
    if (state.actionSetup || Object.keys(state.amountInputs).length) return state;
    const result = planCanvasDuplicate(state.editor.workflow, state.layout, action.nodeIds, action.context);
    return result ? { ...state, editor: { workflow: result.workflow, error: null }, layout: result.layout,
      past: [...state.past, snapshot(state)], future: [] } : state;
  }
  if (action.type === 'UNDO' || action.type === 'REDO') {
    const source = action.type === 'UNDO' ? state.past : state.future;
    const target = source.at(-1);
    if (!target) return state;
    const current = snapshot(state);
    // A restored semantic edit is a fresh revision, so old review and execution artifacts cannot become current again.
    const semantic = target.workflow.nodes !== current.workflow.nodes
      || target.workflow.resourceEdges !== current.workflow.resourceEdges;
    if (semantic && current.workflow.revision === Number.MAX_SAFE_INTEGER) return state;
    const workflow = semantic ? freeze({ ...target.workflow, revision: current.workflow.revision + 1 }) : current.workflow;
    return { ...state, editor: { workflow, error: null }, layout: target.layout, actionSetup: target.actionSetup, amountInputs: target.amountInputs,
      past: action.type === 'UNDO' ? state.past.slice(0, -1) : [...state.past, current],
      future: action.type === 'REDO' ? state.future.slice(0, -1) : [...state.future, current] };
  }
  if (action.type === 'MOVE') {
    const layout = { ...state.layout };
    let changed = false;
    for (const [id, position] of Object.entries(action.positions)) {
      const node = state.editor.workflow.nodes.find(item => item.nodeId === id) ?? (state.actionSetup?.id === id
        ? { actionType: state.actionSetup.action === 'swap' ? 'asset.swap.exact-input' : 'asset.bridge' } : undefined);
      if (!node || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      const before = layout[id];
      if (before?.x === position.x && before?.y === position.y) continue;
      layout[id] = { ...position, actionType: node.actionType };
      changed = true;
    }
    return changed ? { ...state, layout, past: [...state.past, snapshot(state)], future: [] } : state;
  }
  if (action.authoringId) {
    const amount = state.actionSetup?.id === action.authoringId ? state.actionSetup.amount : state.amountInputs[action.authoringId];
    if (amount === undefined || amount !== action.authoringAmount) return state;
    if (state.actionSetup?.id === action.authoringId) {
      try {
        if (JSON.stringify(canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, action.authoringId, action.context)) !== JSON.stringify(action.command)) return state;
      } catch { return state; }
    } else {
      const target = amountCommandTarget(action.command);
      if (target?.id !== action.authoringId || target.amount !== amount) return state;
    }
  }
  const editor = editorReducer(state.editor, action.command, action.context);
  if (editor.error) return { ...state, editor };
  const amountInputs = { ...state.amountInputs };
  if (action.authoringId) delete amountInputs[action.authoringId];
  for (const id of Object.keys(amountInputs)) {
    const node = editor.workflow.nodes.find(node => node.nodeId === id);
    if (!node || !canEditCanvasAmount(node, action.context)) delete amountInputs[id];
  }
  const actionSetup = state.actionSetup?.id === action.authoringId ? null : state.actionSetup;
  if (editor.workflow === state.editor.workflow && actionSetup === state.actionSetup && Object.keys(amountInputs).length === Object.keys(state.amountInputs).length) return { ...state, editor };
  let layout = state.layout;
  const position = action.position ?? (state.actionSetup && state.actionSetup.id === action.authoringId ? state.layout[state.actionSetup.id] : undefined);
  if (position) {
    const added = editor.workflow.nodes.find(node => !state.editor.workflow.nodes.some(previous => previous.nodeId === node.nodeId));
    if (added) layout = { ...layout, [added.nodeId]: { ...position, actionType: added.actionType } };
  }
  if (state.actionSetup && !actionSetup) { const nextLayout = { ...layout }; delete nextLayout[state.actionSetup.id]; layout = nextLayout; }
  return { ...state, editor, layout, actionSetup, amountInputs, past: [...state.past, snapshot(state)], future: [] };
}

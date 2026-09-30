// SPDX-License-Identifier: AGPL-3.0-only
import { validateAuthoringWorkflow, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Command } from './commands';
import type { CanvasLayout } from './canvas-layout';
import { editorReducer, initialEditor, type EditorState } from './editor';
import { freeze, type Workflow } from './initial-workflow';

type Snapshot = { readonly workflow: Workflow; readonly layout: CanvasLayout };
export type EditorHistory = { readonly editor: EditorState; readonly layout: CanvasLayout;
  readonly past: readonly Snapshot[]; readonly future: readonly Snapshot[] };
export type HistoryAction =
  | { readonly type: 'COMMAND'; readonly command: Command; readonly context: ReviewContext; readonly position?: { x: number; y: number } }
  | { readonly type: 'MOVE'; readonly positions: Readonly<Record<string, { x: number; y: number }>> }
  | { readonly type: 'DUPLICATE'; readonly nodeIds: readonly string[]; readonly context: ReviewContext }
  | { readonly type: 'LOAD_LAYOUT'; readonly layout: CanvasLayout }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' };

export const initialEditorHistory = (): EditorHistory => ({ editor: initialEditor(), layout: {}, past: [], future: [] });
const snapshot = (state: EditorHistory): Snapshot => ({ workflow: state.editor.workflow, layout: state.layout });

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
  if (action.type === 'LOAD_LAYOUT') return { ...state, layout: action.layout };
  if (action.type === 'DUPLICATE') {
    const result = planCanvasDuplicate(state.editor.workflow, state.layout, action.nodeIds, action.context);
    return result ? { editor: { workflow: result.workflow, error: null }, layout: result.layout,
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
    return { editor: { workflow, error: null }, layout: target.layout,
      past: action.type === 'UNDO' ? state.past.slice(0, -1) : [...state.past, current],
      future: action.type === 'REDO' ? state.future.slice(0, -1) : [...state.future, current] };
  }
  if (action.type === 'MOVE') {
    const layout = { ...state.layout };
    let changed = false;
    for (const [id, position] of Object.entries(action.positions)) {
      const node = state.editor.workflow.nodes.find(item => item.nodeId === id);
      if (!node || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      const before = layout[id];
      if (before?.x === position.x && before?.y === position.y) continue;
      layout[id] = { ...position, actionType: node.actionType };
      changed = true;
    }
    return changed ? { ...state, layout, past: [...state.past, snapshot(state)], future: [] } : state;
  }
  const editor = editorReducer(state.editor, action.command, action.context);
  if (editor.workflow === state.editor.workflow) return { ...state, editor };
  let layout = state.layout;
  if (action.position) {
    const added = editor.workflow.nodes.find(node => !state.editor.workflow.nodes.some(previous => previous.nodeId === node.nodeId));
    if (added) layout = { ...layout, [added.nodeId]: { ...action.position, actionType: added.actionType } };
  }
  return { editor, layout, past: [...state.past, snapshot(state)], future: [] };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
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
  | { readonly type: 'LOAD_LAYOUT'; readonly layout: CanvasLayout }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' };

export const initialEditorHistory = (): EditorHistory => ({ editor: initialEditor(), layout: {}, past: [], future: [] });
const snapshot = (state: EditorHistory): Snapshot => ({ workflow: state.editor.workflow, layout: state.layout });

export function editorHistoryReducer(state: EditorHistory, action: HistoryAction): EditorHistory {
  if (action.type === 'LOAD_LAYOUT') return { ...state, layout: action.layout };
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

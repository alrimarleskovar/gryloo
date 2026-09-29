// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canvasShortcut, canDeleteCanvasEdge, canDeleteCanvasNode } from './canvas-keyboard';
import { editorReducer, initialEditor } from './editor';
import { parseMockCommand } from './commands';

describe('canvas keyboard semantic deletion', () => {
  it('deletes a selected node through REMOVE for both keys and clears selection on Escape', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    expect(canvasShortcut('Delete', false, 'node-002', added.workflow)).toBe('REMOVE');
    expect(canvasShortcut('Backspace', false, 'node-002', added.workflow)).toBe('REMOVE');
    expect(canvasShortcut('Escape', false, 'node-002', added.workflow)).toBe('CLEAR');
    const removed = editorReducer(added, { type: 'REMOVE', nodeId: 'node-002', source: 'CANVAS', baseRevision: 1 });
    expect(removed.workflow.nodes.map(node => node.nodeId)).toEqual(['node-001']);
  });
  it('protects required nodes and dependents but removes incoming edges with a deleted node', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    expect(canDeleteCanvasNode(added.workflow, 'node-001')).toBe(false);
    const connected = editorReducer(added, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 });
    expect(canDeleteCanvasNode(connected.workflow, 'node-002')).toBe(true);
    const removed = editorReducer(connected, { type: 'REMOVE', nodeId: 'node-002', source: 'CANVAS', baseRevision: 2 });
    expect(removed.workflow.resourceEdges).toHaveLength(0);
    expect(removed.workflow.nodes.map(node => node.nodeId)).toEqual(['node-001']);
    const third = editorReducer(connected, parseMockCommand('add condition', 2));
    const dependent = editorReducer(third, { type: 'CONNECT', from: 'node-002', to: 'node-004', source: 'CANVAS', baseRevision: 3 });
    expect(canDeleteCanvasNode(dependent.workflow, 'node-002')).toBe(false);
    expect(editorReducer(dependent, { type: 'REMOVE', nodeId: 'node-002', source: 'CANVAS', baseRevision: 4 }).error).toMatch(/PROTECTED_NODE/);
  });
  it('disconnects editable edges and protects required typed edges', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    const connected = editorReducer(added, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 });
    expect(canDeleteCanvasEdge(connected.workflow, 'node-001', 'node-002')).toBe(true);
    const disconnected = editorReducer(connected, { type: 'DISCONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 2 });
    expect(disconnected.workflow.resourceEdges).toHaveLength(0);
    expect(disconnected.workflow.nodes[1]?.dependencies).toEqual([]);
    const typed = { ...connected.workflow, nodes: connected.workflow.nodes.map(node => node.nodeId === 'node-002' ? { ...node, actionType: 'asset.swap.exact-input' } : node) } as typeof connected.workflow;
    expect(canDeleteCanvasEdge(typed, 'node-001', 'node-002')).toBe(false);
    const rejected = editorReducer({ workflow: typed, error: null }, { type: 'DISCONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 2 });
    expect(rejected.workflow).toBe(typed);
    expect(rejected.error).toMatch(/PROTECTED_CONNECTION/);
  });
  it('does not issue destructive node commands from text entry', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    expect(canvasShortcut('Delete', true, 'node-002', added.workflow)).toBeNull();
    expect(canvasShortcut('Backspace', true, 'node-002', added.workflow)).toBeNull();
  });
});

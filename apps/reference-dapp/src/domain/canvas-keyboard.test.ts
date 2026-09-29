// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canvasShortcut, canDeleteCanvasNode } from './canvas-keyboard';
import { editorReducer, initialEditor } from './editor';
import { parseMockCommand } from './commands';
describe('canvas keyboard semantic deletion', () => {
  it('deletes an editable selected node through REMOVE and clears selection on Escape', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    expect(canvasShortcut('Delete', false, 'node-002', added.workflow)).toBe('REMOVE');
    expect(canvasShortcut('Backspace', false, 'node-002', added.workflow)).toBe('REMOVE');
    expect(canvasShortcut('Escape', false, 'node-002', added.workflow)).toBe('CLEAR');
    const removed = editorReducer(added, { type: 'REMOVE', nodeId: 'node-002', source: 'CANVAS', baseRevision: 1 });
    expect(removed.workflow.nodes.map(node => node.nodeId)).toEqual(['node-001']);
    expect(removed.workflow.revision).toBe(2);
  });
  it('protects text entry, required nodes, locks and dependencies', () => {
    const added = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    expect(canvasShortcut('Delete', true, 'node-002', added.workflow)).toBeNull();
    expect(canvasShortcut('Backspace', true, 'node-002', added.workflow)).toBeNull();
    expect(canvasShortcut('Escape', true, 'node-002', added.workflow)).toBe('CLEAR');
    expect(canDeleteCanvasNode(added.workflow, 'node-001')).toBe(false);
    const connected = editorReducer(added, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 });
    expect(canDeleteCanvasNode(connected.workflow, 'node-002')).toBe(false);
    const rejected = editorReducer(connected, { type: 'REMOVE', nodeId: 'node-002', source: 'CANVAS', baseRevision: 2 });
    expect(rejected.workflow).toBe(connected.workflow);
    expect(rejected.error).toContain('PROTECTED_NODE');
  });
});

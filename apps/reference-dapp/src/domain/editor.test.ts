// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { editorReducer, initialEditor } from './editor';
import { amountOf, parseMockCommand } from './commands';

describe('shared immutable editor reducer', () => {
  it('round-trips chat edits and canvas edits through one semantic workflow', () => {
    const original = initialEditor();
    const added = editorReducer(original, parseMockCommand('add transform', 0));
    const connected = editorReducer(added, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 });
    const edited = editorReducer(connected, { type: 'SET_AMOUNT', nodeId: 'node-002', amount: '2500000', source: 'CANVAS', baseRevision: 2 });
    const locked = editorReducer(edited, { type: 'LOCK', nodeId: 'node-002', locked: true, source: 'CANVAS', baseRevision: 3 });
    const rejected = editorReducer(locked, parseMockCommand('set node-002 amount 9', 4));

    expect(original.workflow.revision).toBe(0);
    expect(original.workflow.nodes).toHaveLength(1);
    expect(added.workflow.nodes.map((node) => node.nodeId)).toEqual(['node-001', 'node-002']);
    expect(connected.error).toBeNull();
    expect(connected.workflow.resourceEdges).toHaveLength(1);
    expect(connected.workflow.resourceEdges[0]?.inputName).toBe('source');
    expect(edited.workflow.nodes[1] && amountOf(edited.workflow.nodes[1])).toBe('2500000');
    expect(locked.workflow.nodes[1]?.lockedParameters).toHaveLength(1);
    expect(rejected.workflow).toBe(locked.workflow);
    expect(rejected.error).toMatch(/LOCKED_PARAMETER/);
    expect(Object.isFrozen(locked.workflow.nodes[1])).toBe(true);
  });

  it('rejects stale revisions and cyclic connections without changing the IR', () => {
    const first = editorReducer(initialEditor(), parseMockCommand('add transform', 0));
    const stale = editorReducer(first, parseMockCommand('add condition', 0));
    expect(stale.workflow).toBe(first.workflow);
    expect(stale.error).toMatch(/BASE_REVISION_CONFLICT/);
    const connected = editorReducer(first, { type: 'CONNECT', from: 'node-001', to: 'node-002', source: 'CANVAS', baseRevision: 1 });
    const cycle = editorReducer(connected, { type: 'CONNECT', from: 'node-002', to: 'node-001', source: 'CANVAS', baseRevision: 2 });
    expect(cycle.workflow).toBe(connected.workflow);
    expect(cycle.error).toBe('CYCLIC_CONNECTION');
  });
});

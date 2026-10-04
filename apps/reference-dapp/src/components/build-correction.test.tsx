// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { initialEditor, editorReducer } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { WorkflowCanvas } from './workflow-canvas';
import { ArtifactInspector } from './artifact-inspector';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('../state/build009-wallet-store', () => ({ useBuild009Wallet: () => ({ account: '0x1111111111111111111111111111111111111111' }) }));
// Render the actual card projection without a browser/layout engine. Financial state stays in the canonical editor.
vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    ReactFlow: ({ nodes, nodeTypes }: { nodes: { id: string; data: unknown }[]; nodeTypes: { workflow: React.ComponentType } }) =>
      React.createElement('div', {}, nodes.map(node => React.createElement(nodeTypes.workflow, { key: node.id, data: node.data } as React.Attributes))),
    Background: () => null, Controls: () => null, Handle: () => null, Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    useNodesState: (nodes: unknown) => [nodes, vi.fn(), vi.fn()], useNodesInitialized: () => false,
    useReactFlow: () => ({ fitView: vi.fn() }), useStore: () => '', useStoreApi: () => ({}), useUpdateNodeInternals: () => vi.fn(),
  };
});

const owner = '0x1111111111111111111111111111111111111111';
function setWorkflow(action?: 'supply' | 'borrow' | 'repay' | 'withdraw') {
  const context = createBaseSepoliaReviewContext();
  const state = action ? editorReducer(initialEditor(), canvasAddCommand(action, 0, owner), context) : initialEditor();
  fixture.store = { state, context, canvasLayout: {}, canUndo: false, canRedo: false,
    dispatch: vi.fn(), propose: vi.fn(), undo: vi.fn(), redo: vi.fn(), moveCanvasNodes: vi.fn(), addCanvasCommand: vi.fn(), duplicateCanvasNodes: vi.fn(),
  } as unknown as typeof fixture.store;
  return state.workflow.nodes.find(node => node.actionType === action)?.nodeId ?? null;
}

describe('corrected Build workspace presentation', () => {
  it('shows an empty authoring surface instead of the internal starting scaffold', () => {
    setWorkflow();
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: null, select: vi.fn() }));
    expect(html).toContain('Start your workflow');
    expect(html).not.toMatch(/class="flow-card|Mock example|Local mock|MOCK ACTION|Template.*no execution/i);
  });

  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)('%s is a compact selected card; its parameters live only in the inspector', action => {
    const selectedId = setWorkflow(action);
    const before = JSON.stringify(fixture.store.state.workflow);
    const canvas = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId, select: vi.fn() }));
    expect(canvas).toContain('class="flow-card active"');
    expect(canvas).toContain('BASE SEPOLIA · AAVE V3');
    expect(canvas).toContain('USDC');
    expect(canvas).not.toMatch(/<form|role="dialog"|MOCK ACTION|Template.*no execution/i);
    const inspector = renderToStaticMarkup(createElement(ArtifactInspector, { selectedId, select: vi.fn() }));
    const name = action[0]!.toUpperCase() + action.slice(1);
    expect(inspector).toContain(`aria-label="Edit ${name}"`);
    expect(inspector).toContain(`aria-label="${name} amount (USDC)"`);
    expect(JSON.stringify(fixture.store.state.workflow)).toBe(before);
    expect(fixture.store.dispatch).not.toHaveBeenCalled();
    expect(fixture.store.propose).not.toHaveBeenCalled();
  });
});

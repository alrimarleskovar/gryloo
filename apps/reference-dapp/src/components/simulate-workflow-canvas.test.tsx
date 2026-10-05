// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { createCrossChainLiquidityWorkflow } from '../domain/cross-chain-liquidity';
import { composerActions, composerConnections, composerSummary } from '../domain/composer-presentation';
import { WorkflowCanvas } from './workflow-canvas';
import { SimulateWorkflowCanvas } from './simulate-workflow-canvas';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow>, graph: {} as Record<string, unknown> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    ReactFlow: (props: { nodes: { id: string; data: unknown }[]; nodeTypes: { workflow: React.ComponentType } }) => {
      fixture.graph = props;
      return React.createElement('div', { 'data-projected-graph': '' }, props.nodes.map(node => React.createElement(props.nodeTypes.workflow, { key: node.id, data: node.data } as React.Attributes)));
    },
    Background: () => null, Controls: () => null, Handle: () => null,
    Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' }, MarkerType: { ArrowClosed: 'arrowclosed' },
    useStoreApi: () => ({}), useUpdateNodeInternals: () => vi.fn(), useNodesInitialized: () => false, getNodesBounds: vi.fn(), getViewportForBounds: vi.fn(), useReactFlow: () => ({ setViewport: vi.fn() }), useStore: () => '',
  };
});
const owner = '0x1111111111111111111111111111111111111111';
beforeEach(() => {
  fixture.store = { state: initialEditor(), context: createBaseSepoliaReviewContext(), canvasLayout: {}, reviewError: null,
    dispatch: vi.fn(), propose: vi.fn(), moveCanvasNodes: vi.fn(), generateArtifacts: vi.fn() } as unknown as typeof fixture.store;
});
function render() {
  const workflow = fixture.store.state.workflow;
  const html = renderToStaticMarkup(createElement(SimulateWorkflowCanvas, { workflowName: 'ESPARTACUS' }));
  expect(fixture.store.state.workflow).toBe(workflow);
  for (const fn of [fixture.store.dispatch, fixture.store.propose, fixture.store.moveCanvasNodes, fixture.store.generateArtifacts]) expect(fn).not.toHaveBeenCalled();
  return html;
}
function author(action: Parameters<typeof canvasAddCommand>[0]) {
  fixture.store.state = editorReducer(initialEditor(), canvasAddCommand(action, 0, owner), fixture.store.context);
  expect(fixture.store.state.error).toBeNull();
}
describe('UX-003A same canonical workflow in Simulate', () => {
  it.each(['swap', 'bridge', 'pool', 'supply', 'borrow', 'repay', 'withdraw'] as const)('reuses the Build summary and compact card for %s', action => {
    author(action);
    const node = composerActions(fixture.store.state.workflow)[0]!;
    const summary = composerSummary(fixture.store.state.workflow, node, fixture.store.context);
    const html = render();
    expect(html).toContain('flow-card composer-card'); expect(html).toContain('Step 1');
    for (const value of [summary.action, summary.provider, summary.chain, summary.amount]) expect(html).toContain(value);
    expect(html).not.toMatch(/<form|<input|Select to edit|Editing in Selected Action|composer-card-state|Expected |Minimum |MOCK|LOCAL|SYNTHETIC|Confirmed|Authorized|Success|health factor/i);
  });

  it('preserves lending order, linkage and current authored amounts without inferred simulation results', () => {
    author('lending'); const html = render();
    const nodes = fixture.graph.nodes as { id: string; data: { step: number; summary: { amount: string } } }[];
    expect(nodes.map(node => [node.id, node.data.step])).toEqual([['lending-supply', 1], ['lending-borrow', 2], ['lending-swap', 3]]);
    expect(nodes.map(node => node.data.summary.amount)).toEqual(['0.1 USDC', '0.01 USDC', '0.01 USDC']);
    const edges = fixture.graph.edges as { source: string; target: string; markerEnd: { type: string } }[];
    expect(edges.map(edge => [edge.source, edge.target])).toEqual([['lending-supply', 'lending-borrow'], ['lending-borrow', 'lending-swap']]);
    expect(edges.every(edge => edge.markerEnd.type === 'arrowclosed')).toBe(true);
    expect(html).not.toMatch(/HF|health factor|Expected|Minimum|simulated|confirmed/i);
  });

  it('preserves canonical branching and symbolic future amounts', () => {
    fixture.store.state = { ...initialEditor(), workflow: createCrossChainLiquidityWorkflow('strategy', 1, { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: owner, provider: 'across.direct', noSwap: false }) };
    const html = render();
    const edges = fixture.graph.edges as { source: string; target: string }[];
    expect(edges.map(edge => [edge.source, edge.target])).toEqual(composerConnections(fixture.store.state.workflow).map(edge => [edge.source, edge.target]));
    expect(edges).toHaveLength(4);
    expect(html).toContain('100 USDC'); expect(html).toContain('Amount from linked step');
  });

  it('preserves the saved Build layout without allowing any authoring interactions', () => {
    author('swap'); const node = composerActions(fixture.store.state.workflow)[0]!;
    fixture.store.canvasLayout = { [node.nodeId]: { x: 333, y: 222, actionType: node.actionType } };
    render();
    expect((fixture.graph.nodes as { position: unknown }[])[0]?.position).toEqual({ x: 333, y: 222 });
    for (const key of ['nodesDraggable', 'nodesConnectable', 'elementsSelectable', 'nodesFocusable', 'edgesFocusable']) expect(fixture.graph[key]).toBe(false);
    expect(fixture.graph.deleteKeyCode).toBeNull();
    for (const key of ['onNodeClick', 'onConnect', 'onNodesChange', 'onEdgesChange', 'onNodeDragStop']) expect(fixture.graph[key]).toBeUndefined();
    expect(fixture.graph.edges).toEqual([]);
  });

  it.each([false, true])('shows a compact empty/incomplete state without fabricated nodes (incomplete=%s)', incomplete => {
    if (incomplete) { author('swap'); fixture.store.reviewError = 'INVALID_WORKFLOW'; }
    const html = render();
    expect(fixture.graph.nodes).toEqual([]); expect(fixture.graph.edges).toEqual([]);
    expect(html).toContain(incomplete ? 'Check your workflow' : 'Add an action to your workflow');
    expect(html).not.toContain('flow-card composer-card');
  });

  it('uses the supplied shared title and leaves existing artifact overlays out of the authored graph', () => {
    author('swap'); const revision = fixture.store.state.workflow.revision;
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { mode: 'simulate', workflowName: 'ETH Carry Strategy', overlay: new Map([['node-002', { symbol: 'WETH' as const, expected: '999000000000000000000', minimum: '998000000000000000000' }]]) }));
    expect(html).toContain('<h2>ETH Carry Strategy</h2>'); expect(html).not.toContain('Rename workflow');
    expect(html).not.toMatch(/999|998|data-mocked-value|Expected |Minimum /);
    expect(fixture.store.state.workflow.revision).toBe(revision);
  });
});

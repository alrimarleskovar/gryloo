// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { lintWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { initialEditor, editorReducer } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { WorkflowCanvas } from './workflow-canvas';
import { ArtifactInspector } from './artifact-inspector';
import { createCrossChainLiquidityWorkflow } from '../domain/cross-chain-liquidity';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import { createSolanaLiquidityNode } from '../domain/solana-liquidity-authoring';
import { composerSummary, composerConnections, composerNodeState } from '../domain/composer-presentation';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('../state/build009-wallet-store', () => ({ useBuild009Wallet: () => ({ account: '0x1111111111111111111111111111111111111111' }) }));
// Render the actual card projection without a browser/layout engine. Financial state stays in the canonical editor.
vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    ReactFlow: ({ nodes, nodeTypes, nodesDraggable, nodesConnectable, elementsSelectable }: { nodes: { id: string; data: unknown }[]; nodeTypes: { workflow: React.ComponentType }; nodesDraggable?: boolean; nodesConnectable?: boolean; elementsSelectable?: boolean }) =>
      React.createElement('div', { 'data-graph-readonly': nodesDraggable === false && nodesConnectable === false && elementsSelectable === false }, nodes.map(node => React.createElement(nodeTypes.workflow, { key: node.id, data: node.data } as React.Attributes))),
    MarkerType: { ArrowClosed: 'arrowclosed' }, Background: () => null, Controls: () => null, Handle: () => null, Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
    useNodesState: (nodes: unknown) => [nodes, vi.fn(), vi.fn()], useNodesInitialized: () => false,
    useReactFlow: () => ({ fitView: vi.fn() }), useStore: () => '', useStoreApi: () => ({}), useUpdateNodeInternals: () => vi.fn(),
  };
});

describe('Execute workflow overview', () => {
  function renderOverview() {
    const before = JSON.stringify(fixture.store.state.workflow);
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { mode: 'execute', workflowName: 'ESPARTACUS' }));
    expect(html).toContain('aria-label="Workflow overview graph"');
    expect(html).toContain('data-graph-readonly="true"');
    expect(html).toContain('<h2>ESPARTACUS</h2>');
    expect(html).not.toMatch(/<form|<input|data-mocked-value|Expected |Minimum |Select to edit|Generate mocked|MOCK|EXECUTE \/ UNAVAILABLE|Completed|Running|Confirmed/);
    expect(JSON.stringify(fixture.store.state.workflow)).toBe(before);
    for (const handler of [fixture.store.dispatch, fixture.store.propose, fixture.store.moveCanvasNodes, fixture.store.addCanvasCommand]) expect(handler).not.toHaveBeenCalled();
    return html;
  }

  it('renders an empty workflow surface without the internal scaffold or authoring controls', () => {
    setWorkflow();
    expect(renderOverview()).not.toMatch(/class="flow-card|<button|Start your workflow|Add action|Rename workflow/);
  });

  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)('shows the canonical %s parameters without editing or execution claims', action => {
    setWorkflow(action);
    const html = renderOverview();
    expect(html).toContain('class="flow-card"');
    expect(html).toContain('USDC');
    expect(html).toContain('AAVE V3');
    expect(html).toContain('Base Sepolia');
  });

  it('shows the authored swap amount without projecting simulation outputs as execution results', () => {
    setWorkflow();
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2.25', slippage: '50', source: 'CHAT', baseRevision: 0 }, fixture.store.context);
    const html = renderOverview();
    expect(html).toContain('USDC → WETH');
    expect(html).toContain('2.25 USDC');
    expect(fixture.store.state.workflow.revision).toBe(1);
  });
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

  it('places an inert Privacy entry after Withdraw and renders the presentation title without editing IR', () => {
    setWorkflow();
    const before = JSON.stringify(fixture.store.state.workflow);
    const renameWorkflow = vi.fn();
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: null, select: vi.fn(), workflowName: 'ETH Carry Strategy', renameWorkflow }));
    expect(html).toContain('<h2>ETH Carry Strategy</h2>');
    expect(html).toContain('aria-label="Rename workflow"');
    expect(html).toMatch(/aria-label="Add withdraw"[\s\S]*?<\/button><button type="button" disabled="" aria-label="Privacy"/);
    expect(html).toContain('Privacy · not available yet');
    expect(html).not.toMatch(/Cloak|Zcash/);
    expect(JSON.stringify(fixture.store.state.workflow)).toBe(before);
    expect(renameWorkflow).not.toHaveBeenCalled();
    expect(fixture.store.dispatch).not.toHaveBeenCalled();
    expect(fixture.store.addCanvasCommand).not.toHaveBeenCalled();
  });

  it('renders the supplied primary action inside the graph without triggering authoring or navigation', () => {
    setWorkflow();
    const navigate = vi.fn();
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: null, select: vi.fn(),
      primaryAction: createElement('button', { type: 'button', onClick: navigate }, 'Simular Fees') }));
    expect(html).toMatch(/aria-label="Workflow graph"[\s\S]*?<div class="canvas-primary-action"><button type="button">Simular Fees<\/button><\/div><\/div><div class="canvas-foot"/);
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.store.dispatch).not.toHaveBeenCalled();
    expect(fixture.store.addCanvasCommand).not.toHaveBeenCalled();
  });

  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)('%s is a compact selected card; its parameters live only in the inspector', action => {
    const selectedId = setWorkflow(action);
    const before = JSON.stringify(fixture.store.state.workflow);
    const canvas = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId, select: vi.fn() }));
    expect(canvas).toContain('class="flow-card composer-card active"');
    expect(canvas).toContain('Aave V3');
    expect(canvas).toContain('Base Sepolia');
    expect(canvas).toContain('Editing in Selected Action');
    expect(canvas).toContain('Step 1');
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


describe('UX-002 canonical composer projections', () => {
  it.each(['swap', 'bridge', 'pool', 'supply', 'borrow', 'repay', 'withdraw'] as const)('summarizes the real %s toolbar node without modifying it', action => {
    setWorkflow();
    fixture.store.state = editorReducer(initialEditor(), canvasAddCommand(action, 0, '0x1111111111111111111111111111111111111111'), fixture.store.context);
    const workflow = fixture.store.state.workflow;
    const node = workflow.nodes.find(item => !item.actionType.startsWith('mock-'))!;
    const before = JSON.stringify(workflow);
    const summary = composerSummary(workflow, node, fixture.store.context);
    expect(summary.action).not.toBe('Action');
    expect(summary.provider).not.toBe('');
    expect(summary.chain).toContain('Base Sepolia');
    expect(summary.amount).toContain('USDC');
    expect(summary.amount).not.toMatch(/undefined|sample|mock/i);
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it('keeps dependency arrows, order, active editor and linked summaries on the same lending IR', () => {
    setWorkflow();
    fixture.store.state = editorReducer(initialEditor(), canvasAddCommand('lending', 0, '0x1111111111111111111111111111111111111111'), fixture.store.context);
    const workflow = fixture.store.state.workflow;
    expect(composerConnections(workflow).map(edge => [edge.source, edge.target])).toEqual([
      ['lending-supply', 'lending-borrow'], ['lending-borrow', 'lending-swap'],
    ]);
    const canvas = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: 'lending-borrow', select: vi.fn() }));
    expect(canvas.match(/composer-card active/g)).toHaveLength(1);
    expect(canvas).toContain('Step 1'); expect(canvas).toContain('Step 2'); expect(canvas).toContain('Step 3');
    expect(canvas).not.toMatch(/Completed|Runtime:|Confirmed|<form/);
    const inspector = renderToStaticMarkup(createElement(ArtifactInspector, { selectedId: 'lending-borrow', select: vi.fn() }));
    expect(inspector).toContain('SELECTED ACTION · STEP 2');
    expect(inspector).toContain('aria-label="Edit Aave Borrow"');
    fixture.store.state = editorReducer(fixture.store.state, { type: 'AUTHOR_LENDING', source: 'CANVAS', baseRevision: workflow.revision,
      input: { supply: '0.1', borrow: '0.025', slippage: '50', owner: '0x1111111111111111111111111111111111111111' } }, fixture.store.context);
    for (const id of ['lending-borrow', 'lending-swap']) {
      const node = fixture.store.state.workflow.nodes.find(item => item.nodeId === id)!;
      expect(composerSummary(fixture.store.state.workflow, node, fixture.store.context).amount).toBe('0.025 USDC');
    }
    expect(composerConnections(fixture.store.state.workflow)).toEqual(composerConnections(workflow));
  });

  it('shows existing slippage findings while keeping quote gates distinct from authoring errors', () => {
    setWorkflow();
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SWAP', source: 'CANVAS', baseRevision: 0, direction: 'USDC_TO_WETH', amount: '1', slippage: '200' }, fixture.store.context);
    const node = fixture.store.state.workflow.nodes.find(item => item.actionType === 'asset.swap.exact-input')!;
    fixture.store.review = lintWorkflow(fixture.store.state.workflow, fixture.store.context);
    const state = composerNodeState(fixture.store.review, node.nodeId);
    expect(state.status).toBe('Warning'); expect(state.tone).toBe('warning');
    expect(state.findings.map(finding => finding.code)).toContain('ELEVATED_SLIPPAGE');
    expect(state.next).toBe('Simulation / review required');
    const canvas = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: node.nodeId, select: vi.fn() }));
    expect(canvas).toContain('data-state="warning"'); expect(canvas).toContain('Check settings');
    const inspector = renderToStaticMarkup(createElement(ArtifactInspector, { selectedId: node.nodeId, select: vi.fn() }));
    expect(inspector).toContain('Selected action checks'); expect(inspector).toContain(state.message);
    const missingSlippage = { ...fixture.store.state.workflow, nodes: fixture.store.state.workflow.nodes.map(item => item.nodeId === node.nodeId ? { ...item, userConstraints: item.userConstraints.filter(constraint => constraint.kind !== 'MAXIMUM_SLIPPAGE_BPS') } : item) };
    expect(composerNodeState(lintWorkflow(missingSlippage, fixture.store.context), node.nodeId).tone).toBe('invalid');
  });

  it('creates no sequence edges for independent actions and leaves cleared selection empty', () => {
    setWorkflow('supply');
    expect(composerConnections(fixture.store.state.workflow)).toEqual([]);
    const canvas = renderToStaticMarkup(createElement(WorkflowCanvas, { selectedId: null, select: vi.fn() }));
    expect(canvas).not.toContain('composer-card active');
    const inspector = renderToStaticMarkup(createElement(ArtifactInspector, { selectedId: null, select: vi.fn() }));
    expect(inspector).toContain('Select a step'); expect(inspector).not.toContain('Edit Supply');
  });
});


it('projects cross-chain output references and Solana assets without guessed amounts', () => {
  setWorkflow();
  const cross = createCrossChainLiquidityWorkflow('strategy', 1, { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: '0x1111111111111111111111111111111111111111', provider: 'across.direct', noSwap: false });
  const before = JSON.stringify(cross);
  expect(composerConnections(cross)).toHaveLength(4);
  expect(composerSummary(cross, cross.nodes[0]!, fixture.store.context)).toMatchObject({ action: 'Bridge', provider: 'Across', amount: '100 USDC' });
  for (const node of cross.nodes.slice(1)) expect(composerSummary(cross, node, fixture.store.context).amount).toBe('Amount from linked step');
  expect(JSON.stringify(cross)).toBe(before);
  const swap = createSolanaSwapNode('swap', { network: 'Solana', from: 'USDC', to: 'SOL', amount: '10', slippage: '50' });
  expect(composerSummary({ ...cross, nodes: [swap], resourceEdges: [] }, swap, fixture.store.context)).toMatchObject({ action: 'Swap', amount: '10 USDC', detail: 'USDC → SOL' });
  const pool = createSolanaLiquidityNode('pool', { network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.30', rangeUnit: 'PRICE', lower: '20.121902', upper: '24.593436', slippage: '100' });
  expect(composerSummary({ ...cross, nodes: [pool], resourceEdges: [] }, pool, fixture.store.context)).toMatchObject({ action: 'Pool / Liquidity', amount: '0.01 SOL + 0.3 devUSDC' });
});

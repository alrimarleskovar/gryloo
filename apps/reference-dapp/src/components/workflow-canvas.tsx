// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, useReactFlow, useStore, useStoreApi, type NodeProps, type ReactFlowState } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, liquidityDetails, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import { formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import type { Workflow } from '../domain/initial-workflow';
import { canvasViewportFor, canvasViewportSignature, SIMULATION_VIEWPORT, type CanvasViewportInputs } from '../domain/mode-a';

export type SimulationOverlay = { readonly symbol: Symbol; readonly expected: string; readonly minimum: string };
type CardData = { title: string; amount: string; locked: boolean; selected: boolean; swap: boolean; liquidity: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const card = data as CardData;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {!card.swap && !card.liquidity && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{card.liquidity ? 'BASE · LIQUIDITY UNOBSERVED' : card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION'}</span>
      <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>Expected {card.simulate.expected}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>Minimum {card.simulate.minimum}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
      </> : <small>{card.liquidity ? 'Use the isolated fork liquidity simulation' : card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)'}</small>}
      {!card.swap && !card.liquidity && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    {!card.swap && !card.liquidity && <Handle type="target" position={Position.Left} />}
    <span className="flow-card-kind">{card.liquidity ? 'BASE · UNQUOTED POSITION' : card.swap ? 'BASE · UNQUOTED SWAP' : 'MOCK ACTION'}</span>
    <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
    <small>{card.liquidity ? 'Select to edit · local fork only' : card.swap ? 'Execution unavailable' : card.locked ? 'Amount locked' : 'Editable on canvas'}</small>
    {!card.swap && !card.liquidity && <Handle type="source" position={Position.Right} />}
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };

type ViewportState = 'pending' | 'fitted';
function viewportInputs(state: ReactFlowState): CanvasViewportInputs {
  const nodes = [...state.nodeLookup.values()].filter(node => !node.hidden && !node.parentId).map(node => ({
    id: node.id, x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y,
    width: node.measured.width, height: node.measured.height,
  }));
  return { paneWidth: state.width, paneHeight: state.height, nodes };
}

/**
 * Applies the fitted viewport whenever the pane size, node set or any measured
 * node size changes, so the final viewport depends only on the final layout
 * (BUILD-003D §3.16). No timer or animation frame is used.
 */
function SimulationViewport({ onState }: { onState: (state: ViewportState) => void }) {
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  const ready = useStore((state: ReactFlowState) => state.panZoom !== null);
  const signature = useStore((state: ReactFlowState) => canvasViewportSignature(viewportInputs(state)));
  const applied = useRef<string | null>(null);
  useLayoutEffect(() => {
    const viewport = ready ? canvasViewportFor(viewportInputs(store.getState())) : null;
    if (!viewport) { applied.current = null; onState('pending'); return; }
    if (applied.current !== signature) {
      void setViewport(viewport, { duration: 0 });
      applied.current = signature;
    }
    onState('fitted');
  }, [ready, signature, store, setViewport, onState]);
  return null;
}

/** Read-only projection of the same IR with current mocked outputs only. */
function SimulationCanvas({ overlay }: { overlay: ReadonlyMap<string, SimulationOverlay> }) {
  const { state, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const position = liquidityDetails(node, context);
    const current = overlay.get(node.nodeId);
    const simulate = current ? {
      expected: `${formatHumanAmount(current.expected, current.symbol, context)} ${current.symbol}`,
      minimum: `${formatHumanAmount(current.minimum, current.symbol, context)} ${current.symbol}`,
    } : null;
    return { id: node.nodeId, type: 'workflow', position: { x: 60 + index * 280, y: 70 + (index % 2) * 40 },
      data: { title: position ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: position ? `Ticks ${position.tickLower}–${position.tickUpper} · fee ${position.fee}` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, swap: node.actionType === SWAP_ACTION, liquidity: Boolean(position), simulate },
    };
  }), [workflow, overlay, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const [viewportState, setViewportState] = useState<ViewportState>('pending');
  return <section className="canvas simulate-canvas panel" aria-label="Mocked outputs graph">
    <div className="canvas-head"><div><p className="eyebrow">MOCKED OUTPUTS · READ-ONLY</p><h2>Graph</h2></div><span className="revision">REV {workflow.revision.toString().padStart(2, '0')}</span></div>
    <div className="flow-surface" role="region" aria-label="Mocked outputs on the workflow graph" data-viewport={viewportState}>
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={SIMULATION_VIEWPORT.minZoom} maxZoom={SIMULATION_VIEWPORT.maxZoom}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
        <SimulationViewport onState={setViewportState} />
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="canvas-foot"><span>{workflow.nodes.length - swaps} mock · {swaps} Base swap {swaps === 1 ? 'node' : 'nodes'}</span><span>Read-only · MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></div>
  </section>;
}

export function WorkflowCanvas(props: { selectedId: string | null; select: (id: string | null) => void } | { mode: 'simulate'; overlay: ReadonlyMap<string, SimulationOverlay> }) {
  if ('mode' in props) return <SimulationCanvas overlay={props.overlay}/>;
  return <BuildCanvas selectedId={props.selectedId} select={props.select}/>;
}

function BuildCanvas({ selectedId, select }: { selectedId: string | null; select: (id: string | null) => void }) {
  const { state, dispatch, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const position = liquidityDetails(node, context);
    return { id: node.nodeId, type: 'workflow', position: { x: 85 + index * 260, y: 125 + (index % 2) * 55 },
      data: { title: position ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: position ? `Ticks ${position.tickLower}–${position.tickUpper} · fee ${position.fee}` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: selectedId === node.nodeId, swap: node.actionType === SWAP_ACTION, liquidity: Boolean(position) },
    };
  }), [workflow, selectedId, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId,
    label: 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const liquidityCount = workflow.nodes.filter(n => n.actionType === 'asset.liquidity.uniswap-v3').length;
  const mocks = workflow.nodes.length - swaps - liquidityCount;
  return <section className="canvas panel" aria-label="Workflow canvas">
    <div className="canvas-head"><div><p className="eyebrow">SEMANTIC WORKFLOW IR</p><h2>Canvas</h2></div><span className="revision">REV {workflow.revision.toString().padStart(2, '0')}</span></div>
    <div className="flow-surface" role="region" aria-label="Workflow graph">
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} maxZoom={1.4}
        nodesDraggable={false} nodesConnectable onNodeClick={(_event, node) => select(node.id)}
        onPaneClick={() => select(null)} onConnect={({ source, target }) => dispatch({ type: 'CONNECT', from: source, to: target, source: 'CANVAS', baseRevision: workflow.revision })}>
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="canvas-foot"><span>{mocks} mock · {liquidityCount ? `${liquidityCount} liquidity · ` : ''}{swaps} Base swap {swaps === 1 ? 'node' : 'nodes'}</span><span>{liquidityCount ? 'Swap and liquidity connections unavailable' : 'Swap connections unavailable'} · Select a node to edit</span></div>
  </section>;
}

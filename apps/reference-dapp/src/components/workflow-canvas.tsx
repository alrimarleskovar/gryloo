// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import { formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import type { Workflow } from '../domain/initial-workflow';

export type SimulationOverlay = { readonly symbol: Symbol; readonly expected: string; readonly minimum: string };
type CardData = { title: string; amount: string; locked: boolean; selected: boolean; swap: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const card = data as CardData;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {!card.swap && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION'}</span>
      <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>Expected {card.simulate.expected}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>Minimum {card.simulate.minimum}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
      </> : <small>{card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)'}</small>}
      {!card.swap && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    {!card.swap && <Handle type="target" position={Position.Left} />}
    <span className="flow-card-kind">{card.swap ? 'BASE · UNQUOTED SWAP' : 'MOCK ACTION'}</span>
    <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
    <small>{card.swap ? 'Execution unavailable' : card.locked ? 'Amount locked' : 'Editable on canvas'}</small>
    {!card.swap && <Handle type="source" position={Position.Right} />}
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };

/** Read-only projection of the same IR with current mocked outputs only. */
function SimulationCanvas({ overlay }: { overlay: ReadonlyMap<string, SimulationOverlay> }) {
  const { state, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const current = overlay.get(node.nodeId);
    const simulate = current ? {
      expected: `${formatHumanAmount(current.expected, current.symbol, context)} ${current.symbol}`,
      minimum: `${formatHumanAmount(current.minimum, current.symbol, context)} ${current.symbol}`,
    } : null;
    return { id: node.nodeId, type: 'workflow', position: { x: 60 + index * 280, y: 70 + (index % 2) * 40 },
      data: { title: swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, swap: node.actionType === SWAP_ACTION, simulate },
    };
  }), [workflow, overlay, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  return <section className="canvas simulate-canvas panel" aria-label="Mocked outputs graph">
    <div className="canvas-head"><div><p className="eyebrow">MOCKED OUTPUTS · READ-ONLY</p><h2>Graph</h2></div><span className="revision">REV {workflow.revision.toString().padStart(2, '0')}</span></div>
    <div className="flow-surface" role="region" aria-label="Mocked outputs on the workflow graph">
      <ReactFlow key={`${workflow.nodes.length}-${overlay.size}`} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} maxZoom={1.2}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
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
    return { id: node.nodeId, type: 'workflow', position: { x: 85 + index * 260, y: 125 + (index % 2) * 55 },
      data: { title: swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: selectedId === node.nodeId, swap: node.actionType === SWAP_ACTION },
    };
  }), [workflow, selectedId, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId,
    label: 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const mocks = workflow.nodes.length - swaps;
  return <section className="canvas panel" aria-label="Workflow canvas">
    <div className="canvas-head"><div><p className="eyebrow">SEMANTIC WORKFLOW IR</p><h2>Canvas</h2></div><span className="revision">REV {workflow.revision.toString().padStart(2, '0')}</span></div>
    <div className="flow-surface" role="region" aria-label="Workflow graph">
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} maxZoom={1.4}
        nodesDraggable={false} nodesConnectable onNodeClick={(_event, node) => select(node.id)}
        onPaneClick={() => select(null)} onConnect={({ source, target }) => dispatch({ type: 'CONNECT', from: source, to: target, source: 'CANVAS', baseRevision: workflow.revision })}>
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="canvas-foot"><span>{mocks} mock · {swaps} Base swap {swaps === 1 ? 'node' : 'nodes'}</span><span>Swap connections unavailable · Select a node to edit</span></div>
  </section>;
}

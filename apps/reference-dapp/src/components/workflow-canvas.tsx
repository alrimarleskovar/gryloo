// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type NodeProps } from '@xyflow/react';
import { amountOf } from '../domain/commands';
import { swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import type { Workflow } from '../domain/initial-workflow';

type CardData = { title: string; amount: string; locked: boolean; selected: boolean; swap: boolean };
function WorkflowCard({ data }: NodeProps) {
  const card = data as CardData;
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    {!card.swap && <Handle type="target" position={Position.Left} />}
    <span className="flow-card-kind">{card.swap ? 'BASE · UNQUOTED SWAP' : 'MOCK ACTION'}</span>
    <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
    <small>{card.swap ? 'Execution unavailable' : card.locked ? 'Amount locked' : 'Editable on canvas'}</small>
    {!card.swap && <Handle type="source" position={Position.Right} />}
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };
export function WorkflowCanvas({ selectedId, select }: { selectedId: string | null; select: (id: string | null) => void }) {
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
    <div className="canvas-foot"><span>{mocks} mock · {swaps} Base swap {swaps === 1 ? 'node' : 'nodes'}</span><span>Swap connections unavailable in BUILD-003A · Select a node to edit</span></div>
  </section>;
}

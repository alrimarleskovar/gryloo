// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals, type NodeProps, type ReactFlowState } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import { bridgeDetails } from '../domain/bridge-authoring';
import { formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { canvasShortcut, isTextEntry } from '../domain/canvas-keyboard';
import type { Workflow } from '../domain/initial-workflow';
import { canvasViewportFor, canvasViewportSignature, SIMULATION_VIEWPORT, type CanvasViewportInputs } from '../domain/mode-a';

export type SimulationOverlay = { readonly symbol: Symbol; readonly expected: string; readonly minimum: string };
type CardData = { title: string; amount: string; locked: boolean; selected: boolean; swap: boolean; bridge: boolean; liquidity: boolean; composition: boolean; bridgeSwap: boolean; across: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const card = data as CardData;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {((card.bridgeSwap && card.swap) || (!card.swap && !card.bridge && (!card.liquidity || card.composition))) && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE ROUTE' : 'ARBITRUM · DESTINATION SWAP') : card.bridge ? 'BASE → OPTIMISM · BRIDGE ROUTE' : card.liquidity ? 'BASE · LIQUIDITY UNOBSERVED' : card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION'}</span>
      <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>Expected {card.simulate.expected}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>Minimum {card.simulate.minimum}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
      </> : <small>{card.across ? 'Direct Across quote in bridge review' : card.bridge ? 'Live LI.FI route in bridge review' : card.liquidity ? 'Use the isolated fork liquidity simulation' : card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)'}</small>}
      {((card.bridgeSwap && card.bridge) || (!card.liquidity && !card.bridge && (!card.swap || card.composition))) && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    {((card.bridgeSwap && card.swap) || (!card.swap && !card.bridge && (!card.liquidity || card.composition))) && <Handle type="target" position={Position.Left} isConnectable={!card.composition} />}
    <span className="flow-card-kind">{card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · UNQUOTED BRIDGE' : 'ARBITRUM · UNQUOTED SWAP') : card.bridge ? 'BASE → OPTIMISM · UNQUOTED BRIDGE' : card.composition && card.liquidity ? 'BASE · POSITION' : card.liquidity ? 'BASE · UNQUOTED POSITION' : card.swap ? 'BASE · UNQUOTED SWAP' : 'MOCK ACTION'}</span>
    <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
    <small>{card.across ? 'Direct Across quote in Simulate · demo execution' : card.bridge ? 'Live LI.FI route in Simulate · MOCKED execution' : card.composition && card.liquidity ? 'Receives typed WETH output · local fork only' : card.liquidity ? 'Select to edit · local fork only' : card.swap ? 'Execution unavailable' : card.locked ? 'Amount locked' : 'Editable on canvas'}</small>
    {((card.bridgeSwap && card.bridge) || (!card.liquidity && !card.bridge && (!card.swap || card.composition))) && <Handle type="source" position={Position.Right} isConnectable={!card.composition} />}
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
 * (BUILD-003D §3.16). React Flow is asked to remeasure a node if its
 * first ResizeObserver notification is missed.
 */
function SimulationViewport({ onState }: { onState: (state: ViewportState) => void }) {
  const store = useStoreApi();
  const { setViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const ready = useStore((state: ReactFlowState) => state.panZoom !== null);
  const signature = useStore((state: ReactFlowState) => canvasViewportSignature(viewportInputs(state)));
  const applied = useRef<string | null>(null);
  const requestedMeasurement = useRef<string | null>(null);
  useLayoutEffect(() => {
    const inputs = viewportInputs(store.getState());
    const viewport = ready ? canvasViewportFor(inputs) : null;
    if (!viewport) {
      applied.current = null;
      onState('pending');
      if (ready && inputs.paneWidth > 0 && inputs.paneHeight > 0 && requestedMeasurement.current !== signature) {
        requestedMeasurement.current = signature;
        updateNodeInternals(inputs.nodes.filter(node => !node.width || !node.height).map(node => node.id));
      }
      return;
    }
    requestedMeasurement.current = null;
    if (applied.current !== signature) {
      void setViewport(viewport, { duration: 0 });
      applied.current = signature;
    }
    onState('fitted');
  }, [ready, signature, store, setViewport, updateNodeInternals, onState]);
  return null;
}

/** Read-only projection of the same IR with current mocked outputs only. */
function SimulationCanvas({ overlay }: { overlay: ReadonlyMap<string, SimulationOverlay> }) {
  const { state, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const bridge = bridgeDetails(node);
    const bridgeSwap = workflow.nodes[0]?.nodeId === 'build009-bridge';
    const across = node.adapterConstraints.adapters[0]?.id === 'across.direct';
    const composition = workflow.resourceEdges.length === 1 && (node.requiredAuthorizationClass === 'MODE_B' || bridgeSwap);
    const isLiquidity = node.actionType === 'asset.liquidity.uniswap-v3';
    const lower = node.inputs.find(i => i.name === 'tick-lower');
    const upper = node.inputs.find(i => i.name === 'tick-upper');
    const range = lower?.kind === 'IDENTIFIER' && upper?.kind === 'IDENTIFIER' ? `${lower.value.slice(5)}–${upper.value.slice(5)}` : 'unreviewed';
    const current = overlay.get(node.nodeId);
    const simulate = current ? {
      expected: `${formatHumanAmount(current.expected, current.symbol, context)} ${current.symbol}`,
      minimum: `${formatHumanAmount(current.minimum, current.symbol, context)} ${current.symbol}`,
    } : null;
    return { id: node.nodeId, type: 'workflow', position: { x: 60 + index * 280, y: 70 + (index % 2) * 40 },
      data: { title: across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, swap: node.actionType === SWAP_ACTION, bridge: Boolean(bridge), liquidity: isLiquidity, composition, bridgeSwap, across, simulate },
    };
  }), [workflow, overlay, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const bridges = workflow.nodes.filter(n => n.actionType === 'asset.bridge').length;
  const [viewportState, setViewportState] = useState<ViewportState>('pending');
  return <section className="canvas simulate-canvas panel" aria-label="Mocked outputs graph">
    <div className="canvas-head"><div><p className="eyebrow">MOCKED OUTPUTS · READ-ONLY</p><h2>Graph</h2></div><span className="revision">{workflow.nodes.length} steps</span></div>
    <div className="flow-surface" role="region" aria-label="Mocked outputs on the workflow graph" data-viewport={viewportState}>
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={SIMULATION_VIEWPORT.minZoom} maxZoom={SIMULATION_VIEWPORT.maxZoom}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}>
        <SimulationViewport onState={setViewportState} />
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="canvas-foot"><span>{workflow.nodes.length - swaps - bridges} mock · {bridges ? `${bridges} bridge · ` : ''}{swaps} {workflow.nodes[0]?.nodeId === 'build009-bridge' ? 'Arbitrum' : 'Base'} swap {swaps === 1 ? 'node' : 'nodes'}</span><span>Read-only · MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></div>
  </section>;
}

export function WorkflowCanvas(props: { selectedId: string | null; select: (id: string | null) => void } | { mode: 'simulate'; overlay: ReadonlyMap<string, SimulationOverlay> }) {
  if ('mode' in props) return <SimulationCanvas overlay={props.overlay}/>;
  return <BuildCanvas selectedId={props.selectedId} select={props.select}/>;
}

function BuildCanvas({ selectedId, select }: { selectedId: string | null; select: (id: string | null) => void }) {
  const { state, dispatch, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  useEffect(() => {
    if (selectedId && !workflow.nodes.some(node => node.nodeId === selectedId)) select(null);
  }, [workflow, selectedId, select]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const action = canvasShortcut(event.key, isTextEntry(event.target), selectedId, workflow);
      if (!action) return;
      event.preventDefault();
      if (action === 'CLEAR') select(null);
      else { dispatch({ type: 'REMOVE', nodeId: selectedId!, source: 'CANVAS', baseRevision: workflow.revision }); select(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, workflow, selectedId, select]);
  const nodes = useMemo(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const bridge = bridgeDetails(node);
    const bridgeSwap = workflow.nodes[0]?.nodeId === 'build009-bridge';
    const across = node.adapterConstraints.adapters[0]?.id === 'across.direct';
    const composition = workflow.resourceEdges.length === 1 && (node.requiredAuthorizationClass === 'MODE_B' || bridgeSwap);
    const isLiquidity = node.actionType === 'asset.liquidity.uniswap-v3';
    const lower = node.inputs.find(i => i.name === 'tick-lower');
    const upper = node.inputs.find(i => i.name === 'tick-upper');
    const range = lower?.kind === 'IDENTIFIER' && upper?.kind === 'IDENTIFIER' ? `${lower.value.slice(5)}–${upper.value.slice(5)}` : 'unreviewed';
    return { id: node.nodeId, type: 'workflow', position: { x: 85 + index * 260, y: 125 + (index % 2) * 55 },
      data: { title: across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.replace('mock-', 'Mock '), amount: bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: selectedId === node.nodeId, swap: node.actionType === SWAP_ACTION, bridge: Boolean(bridge), liquidity: isLiquidity, composition, bridgeSwap, across },
    };
  }), [workflow, selectedId, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId,
    label: edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false,
  })), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const bridges = workflow.nodes.filter(n => n.actionType === 'asset.bridge').length;
  const liquidityCount = workflow.nodes.filter(n => n.actionType === 'asset.liquidity.uniswap-v3').length;
  const mocks = workflow.nodes.length - swaps - liquidityCount - bridges;
  return <section className="canvas panel" aria-label="Workflow canvas">
    <div className="canvas-head"><div><p className="eyebrow">YOUR WORKFLOW</p><h2>Canvas</h2></div><span className="revision">{workflow.nodes.length} steps</span></div>
    <div className="flow-surface" role="region" aria-label="Workflow graph">
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.35} maxZoom={1.4}
        nodesDraggable={false} nodesConnectable onNodeClick={(_event, node) => select(node.id)}
        onPaneClick={() => select(null)} onConnect={({ source, target }) => dispatch({ type: 'CONNECT', from: source, to: target, source: 'CANVAS', baseRevision: workflow.revision })}>
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="canvas-foot"><span>{mocks} mock · {bridges ? `${bridges} bridge · ` : ''}{liquidityCount ? `${liquidityCount} liquidity · ` : ''}{swaps} {workflow.nodes[0]?.nodeId === 'build009-bridge' ? 'Arbitrum' : 'Base'} swap {swaps === 1 ? 'node' : 'nodes'}</span><span>{workflow.resourceEdges.some(edge => edge.inputName === 'weth-from-swap') ? 'Typed WETH dependency · no other connections' : liquidityCount ? 'Swap and liquidity connections unavailable' : 'Swap connections unavailable'} · Select a node to edit</span></div>
  </section>;
}

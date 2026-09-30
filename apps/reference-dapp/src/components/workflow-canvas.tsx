// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, useNodesState, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals, type Node, type NodeChange, type NodeProps, type ReactFlowState } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import type { ActionKind } from '../domain/mock-actions';
import { bridgeDetails } from '../domain/bridge-authoring';
import { formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { editorReducer } from '../domain/editor';
import { canDeleteCanvasEdge, deletableCanvasNodes, isTextEntry } from '../domain/canvas-keyboard';
import { canvasPosition, defaultCanvasPosition, readToolboxMode, saveToolboxMode, type ToolboxMode } from '../domain/canvas-layout';
import type { Workflow } from '../domain/initial-workflow';
import { canvasViewportFor, canvasViewportSignature, SIMULATION_VIEWPORT, type CanvasViewportInputs } from '../domain/mode-a';

export type CrossChainRuntimeStatus = 'Completed' | 'Failed' | 'Recovery required' | 'Pending';
const crossChainRuntime = new Map<string, Readonly<Record<string, CrossChainRuntimeStatus>>>();
export function setCrossChainCanvasRuntime(workflowId: string, revision: number, statuses: Readonly<Record<string, CrossChainRuntimeStatus>>) {
  const key = `${workflowId}:${revision}`;
  crossChainRuntime.set(key, statuses);
  window.dispatchEvent(new CustomEvent('gryloo:cross-chain-runtime', { detail: key }));
}
export type SimulationOverlay = { readonly symbol: Symbol; readonly expected: string; readonly minimum: string };
type CardData = { title: string; amount: string; runtime?: CrossChainRuntimeStatus; locked: boolean; selected: boolean; swap: boolean; bridge: boolean; liquidity: boolean; composition: boolean; bridgeSwap: boolean; across: boolean; crossChain: boolean; preparation: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const card = data as CardData;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {((card.bridgeSwap && card.swap) || (!card.swap && !card.bridge && (!card.liquidity || card.composition))) && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : 'ARBITRUM · COMPOSED STEP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE ROUTE' : 'ARBITRUM · DESTINATION SWAP') : card.bridge ? 'BASE → OPTIMISM · BRIDGE ROUTE' : card.liquidity ? 'BASE · LIQUIDITY UNOBSERVED' : card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION'}</span>
      <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>Expected {card.simulate.expected}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>Minimum {card.simulate.minimum}</span><span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span></span>
      </> : <small>{card.crossChain ? 'MOCKED composed simulation · actual outputs require reconciliation' : card.across ? 'Direct Across quote in bridge review' : card.bridge ? 'Live LI.FI route in bridge review' : card.liquidity ? 'Use the isolated fork liquidity simulation' : card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)'}</small>}
      {((card.bridgeSwap && card.bridge) || (!card.liquidity && !card.bridge && (!card.swap || card.composition))) && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={!card.composition} />
    <span className="flow-card-kind">{card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : card.preparation ? 'ARBITRUM · CALCULATED SPLIT' : card.liquidity ? 'ARBITRUM · UNISWAP V3' : 'ARBITRUM · DESTINATION SWAP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · UNQUOTED BRIDGE' : 'ARBITRUM · UNQUOTED SWAP') : card.bridge ? 'BASE → OPTIMISM · UNQUOTED BRIDGE' : card.composition && card.liquidity ? 'BASE · POSITION' : card.liquidity ? 'BASE · UNQUOTED POSITION' : card.swap ? 'BASE · UNQUOTED SWAP' : 'MOCK ACTION'}</span>
    <strong>{card.title}</strong><span className="numeric">{card.amount}</span>
    <small>{card.crossChain && card.runtime ? `Runtime: ${card.runtime}` : card.crossChain ? 'Select to review · non-atomic boundaries' : card.across ? 'Direct Across quote in Simulate · demo execution' : card.bridge ? 'Live LI.FI route in Simulate · MOCKED execution' : card.composition && card.liquidity ? 'Receives typed WETH output · local fork only' : card.liquidity ? 'Select to edit · local fork only' : card.swap ? 'Execution unavailable' : card.locked ? 'Amount locked' : 'Template · no execution'}</small>
    <Handle type="source" position={Position.Right} isConnectable={!card.composition} />
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };
const actions = ['swap', 'bridge', 'pool', 'supply', 'lending', 'borrow'] as const;
function actionLabel(action: typeof actions[number]) { return action === 'pool' ? 'Pool / Liquidity' : action[0]!.toUpperCase() + action.slice(1); }
function ActionIcon({ action }: { action: typeof actions[number] }) {
  const paths = {
    swap: <><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></>,
    bridge: <><path d="M3 18h18M5 18V9m14 9V9M5 9c4 0 4 6 7 6s3-6 7-6M3 7h4m10 0h4"/></>,
    pool: <><path d="M12 3c-3 5-7 9-7 13a7 7 0 0 0 14 0c0-4-4-8-7-13Z"/></>,
    supply: <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></>,
    lending: <><path d="m3 10 9-6 9 6M5 10v9m5-9v9m4-9v9m5-9v9M3 20h18"/></>,
    borrow: <><path d="M4 20h16M6 17V9m4 8V9m4 8V9m4 8V9M3 8l9-5 9 5M12 11v6m-3-3 3 3 3-3"/></>,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[action]}</svg>;
}
function HistoryIcon({ direction }: { direction: 'undo' | 'redo' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === 'undo' ? <><path d="m10 8-4 4 4 4"/><path d="M6 12h9a5 5 0 0 1 0 10"/></>
      : <><path d="m14 8 4 4-4 4"/><path d="M18 12H9a5 5 0 0 0 0 10"/></>}
  </svg>;
}

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
    const crossChain = workflow.nodes.some(item => item.actionType === 'asset.liquidity.prepare');
    const preparation = node.actionType === 'asset.liquidity.prepare';
    const crossBridge = crossChain && node.actionType === 'asset.bridge';
    const crossSwap = crossChain && node.actionType === 'asset.swap.exact-input';
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
      data: { title: crossChain ? (crossBridge ? 'Bridge USDC' : preparation ? 'Calculate destination split' : crossSwap ? 'Swap selected USDC for WETH' : 'Mint Uniswap v3 position') : across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.startsWith('mock-') ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : node.actionType, amount: crossChain ? (crossBridge ? 'Base USDC → Arbitrum USDC' : preparation ? 'Reconciled amount → range ratio' : crossSwap ? 'Calculated partial USDC input' : `Ticks ${range} · fee 500`) : bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, swap: node.actionType === SWAP_ACTION, bridge: Boolean(bridge) || crossBridge, liquidity: isLiquidity, composition, bridgeSwap, across, crossChain, preparation, simulate },
    };
  }), [workflow, overlay, context]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: edge.outputId === 'swap-input' ? 'Calculated swap USDC' : edge.outputId === 'liquidity-usdc' ? 'Reserved liquidity USDC' : edge.outputId === 'liquidity-weth' ? 'Existing WETH' : edge.outputId === 'amount-out' && edge.inputName === 'amount0-max' ? 'Reconciled WETH output' : edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false,
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
  const { state, dispatch, context, canvasLayout, canUndo, canRedo, undo, redo, moveCanvasNodes, addCanvasCommand } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() => selectedId ? [selectedId] : []);
  const selectedIdsRef = useRef<readonly string[]>(selectedId ? [selectedId] : []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const ignorePaneClick = useRef(false);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [toolboxMode, setToolboxMode] = useState<ToolboxMode>('top');
  const runtimeKey = `${workflow.workflowId}:${workflow.revision}`;
  const [runtime, setRuntime] = useState<Readonly<Record<string, CrossChainRuntimeStatus>>>(() => crossChainRuntime.get(runtimeKey) ?? {});
  useEffect(() => {
    setRuntime(crossChainRuntime.get(runtimeKey) ?? {});
    const update = (event: Event) => { if ((event as CustomEvent<string>).detail === runtimeKey)
      setRuntime(crossChainRuntime.get(runtimeKey) ?? {}); };
    window.addEventListener('gryloo:cross-chain-runtime', update);
    return () => window.removeEventListener('gryloo:cross-chain-runtime', update);
  }, [runtimeKey]);
  useEffect(() => { setToolboxMode(readToolboxMode()); }, []);
  function changeToolboxMode(mode: ToolboxMode) {
    setToolboxMode(mode);
    saveToolboxMode(mode);
  }
  useEffect(() => () => marqueeCleanup.current?.(), []);
  function selectNodes(ids: readonly string[], inspector: string | null) {
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
    select(inspector);
    setSelectedEdge(null);
    setFeedback('');
  }
  useEffect(() => {
    if (selectedEdge && !workflow.resourceEdges.some(edge => edge.fromNodeId === selectedEdge.from && edge.toNodeId === selectedEdge.to)) setSelectedEdge(null);
  }, [workflow, selectedEdge]);
  useEffect(() => {
    const remaining = selectedIdsRef.current.filter(id => workflow.nodes.some(node => node.nodeId === id));
    if (remaining.length !== selectedIdsRef.current.length) { selectedIdsRef.current = remaining; setSelectedIds(remaining); }
    if (selectedId && !workflow.nodes.some(node => node.nodeId === selectedId)) select(null);
  }, [workflow, selectedId, select]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.altKey || event.metaKey) return;
      const textEntry = isTextEntry(event.target);
      if (event.key === 'Escape' && (selectedIdsRef.current.length || selectedEdge)) { event.preventDefault(); selectNodes([], null); return; }
      if (textEntry) return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' || (key === 'y' && !event.shiftKey)) {
          event.preventDefault();
          if (key === 'z' && !event.shiftKey) undo(); else redo();
          return;
        }
        return;
      }
      if (event.shiftKey) return;
      if (textEntry || (event.key !== 'Delete' && event.key !== 'Backspace')) return;
      if (selectedEdge) {
        event.preventDefault();
        if (!canDeleteCanvasEdge(workflow, selectedEdge.from, selectedEdge.to)) { setFeedback('This connection is required by the workflow.'); return; }
        dispatch({ type: 'DISCONNECT', from: selectedEdge.from, to: selectedEdge.to, source: 'CANVAS', baseRevision: workflow.revision });
        setSelectedEdge(null); setFeedback(''); return;
      }
      const selected = selectedIdsRef.current;
      if (!selected.length) return;
      event.preventDefault();
      const removable = deletableCanvasNodes(workflow, selected);
      if (removable.length) {
        dispatch({ type: 'REMOVE_MANY', nodeIds: removable, source: 'CANVAS', baseRevision: workflow.revision });
        selectNodes(selected.filter(id => !removable.includes(id)), null);
      }
      if (removable.length !== selected.length) setFeedback(removable.length
        ? 'Some selected steps are required by another step or are protected.'
        : 'This step is required by another step or is protected.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, workflow, selectedEdge, select, undo, redo]);
  const projectedNodes = useMemo<Node[]>(() => workflow.nodes.map((node, index) => {
    const swap = swapDetails(node, context);
    const bridge = bridgeDetails(node);
    const bridgeSwap = workflow.nodes[0]?.nodeId === 'build009-bridge';
    const crossChain = workflow.nodes.some(item => item.actionType === 'asset.liquidity.prepare');
    const preparation = node.actionType === 'asset.liquidity.prepare';
    const crossBridge = crossChain && node.actionType === 'asset.bridge';
    const crossSwap = crossChain && node.actionType === 'asset.swap.exact-input';
    const across = node.adapterConstraints.adapters[0]?.id === 'across.direct';
    const composition = workflow.resourceEdges.length === 1 && (node.requiredAuthorizationClass === 'MODE_B' || bridgeSwap);
    const isLiquidity = node.actionType === 'asset.liquidity.uniswap-v3';
    const lower = node.inputs.find(i => i.name === 'tick-lower');
    const upper = node.inputs.find(i => i.name === 'tick-upper');
    const range = lower?.kind === 'IDENTIFIER' && upper?.kind === 'IDENTIFIER' ? `${lower.value.slice(5)}–${upper.value.slice(5)}` : 'unreviewed';
    return { id: node.nodeId, type: 'workflow', position: canvasPosition(canvasLayout, node, index), selected: selectedIds.includes(node.nodeId),
      data: { title: crossChain ? (crossBridge ? 'Bridge USDC' : preparation ? 'Calculate destination split' : crossSwap ? 'Swap selected USDC for WETH' : 'Mint Uniswap v3 position') : across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : swap ? `${swap.from} → ${swap.to}` : node.actionType.startsWith('mock-') ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : node.actionType, amount: crossChain ? (crossBridge ? 'Base USDC → Arbitrum USDC' : preparation ? 'Reconciled amount → range ratio' : crossSwap ? 'Calculated partial USDC input' : `Ticks ${range} · fee 500`) : bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: selectedIds.includes(node.nodeId), swap: node.actionType === SWAP_ACTION, bridge: Boolean(bridge) || crossBridge, liquidity: isLiquidity, composition, bridgeSwap, across, crossChain, preparation, runtime: crossChain ? runtime[node.nodeId] : undefined },
    };
  }), [workflow, selectedIds, context, canvasLayout, runtime]);
  // Live pointer positions stay in React Flow state; layout is committed on release.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(projectedNodes);
  useEffect(() => {
    setNodes(current => projectedNodes.map(node => {
      const previous = current.find(item => item.id === node.id);
      return previous?.measured ? { ...node, measured: previous.measured } : node;
    }));
  }, [projectedNodes, setNodes]);
  const edges = useMemo(() => workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId,
    label: edge.outputId === 'swap-input' ? 'Calculated swap USDC' : edge.outputId === 'liquidity-usdc' ? 'Reserved liquidity USDC' : edge.outputId === 'liquidity-weth' ? 'Existing WETH' : edge.outputId === 'amount-out' && edge.inputName === 'amount0-max' ? 'Reconciled WETH output' : edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false, selected: selectedEdge?.from === edge.fromNodeId && selectedEdge?.to === edge.toNodeId,
  })), [workflow, selectedEdge]);
  function addAction(action: 'swap' | ActionKind) {
    const nodeId = `node-${String(workflow.revision + 2).padStart(3, '0')}`;
    const command = action === 'swap'
      ? { type: 'ADD_SWAP' as const, direction: 'USDC_TO_WETH' as const, amount: '1', slippage: '50', source: 'CANVAS' as const, baseRevision: workflow.revision }
      : { type: 'ADD' as const, kind: action, source: 'CANVAS' as const, baseRevision: workflow.revision };
    const preview = editorReducer(state, command, context);
    if (preview.error) { setFeedback('This action could not be added. Check the workflow and try again.'); return; }
    let slot = workflow.nodes.length;
    let position = defaultCanvasPosition(slot);
    while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) {
      slot += 1;
      position = defaultCanvasPosition(slot);
    }
    addCanvasCommand(command, position);
    selectNodes([nodeId], nodeId);
  }
  function commitDrag(dragged: Node, draggedNodes: Node[]) {
    const moved = draggedNodes.length ? draggedNodes : [dragged];
    moveCanvasNodes(Object.fromEntries(moved.map(node => [node.id, node.position])));
  }
  function startMarquee(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const origin = { x: event.clientX, y: event.clientY };
    let current = origin;
    const onMove = (move: MouseEvent) => {
      current = { x: move.clientX, y: move.clientY };
      const bounds = surface.getBoundingClientRect();
      setMarquee({ x: Math.min(origin.x, current.x) - bounds.left, y: Math.min(origin.y, current.y) - bounds.top,
        width: Math.abs(origin.x - current.x), height: Math.abs(origin.y - current.y) });
    };
    const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); marqueeCleanup.current = null; setMarquee(null); };
    const onUp = (up: MouseEvent) => {
      current = { x: up.clientX, y: up.clientY };
      cleanup();
      if (Math.abs(current.x - origin.x) < 4 && Math.abs(current.y - origin.y) < 4) return;
      ignorePaneClick.current = true;
      setTimeout(() => { ignorePaneClick.current = false; }, 0);
      const box = { left: Math.min(origin.x, current.x), right: Math.max(origin.x, current.x),
        top: Math.min(origin.y, current.y), bottom: Math.max(origin.y, current.y) };
      const ids = [...surface.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')]
        .filter(element => { const rect = element.getBoundingClientRect();
          return rect.left <= box.right && rect.right >= box.left && rect.top <= box.bottom && rect.bottom >= box.top; })
        .map(element => element.dataset.id!).filter(Boolean);
      selectNodes(ids, ids.length === 1 ? ids[0]! : null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    marqueeCleanup.current = cleanup;
  }
  function connect(source: string | null, target: string | null) {
    if (!source || !target) return;
    const command = { type: 'CONNECT' as const, from: source, to: target, source: 'CANVAS' as const, baseRevision: workflow.revision };
    const preview = editorReducer(state, command, context);
    if (preview.error) {
      const reasons: Record<string, string> = { CYCLIC_CONNECTION: 'This connection would create a loop.', INPUT_ALREADY_CONNECTED: 'This step already has an input.', SWAP_EDGE_UNSUPPORTED: 'Swap connections are not available in this workflow.', ISOLATED_ACTION_EDGE_UNSUPPORTED: 'This step cannot be connected in this workflow.', INVALID_CONNECTION: 'Choose two different steps to connect.' };
      setFeedback(reasons[preview.error] ?? 'These steps cannot be connected.'); return;
    }
    dispatch(command); setFeedback('');
  }
  const toolbox = <div className="canvas-toolbox" role="toolbar" aria-label="Canvas tools">
    {actions.map(action => <button key={action} type="button"
      title={action === 'swap' ? 'Add swap' : 'Add a ' + actionLabel(action) + ' template'}
      aria-label={'Add ' + action} onClick={() => addAction(action)}><ActionIcon action={action}/><span>{actionLabel(action)}</span></button>)}
    <span className="toolbox-divider" aria-hidden="true"/>
    <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}><HistoryIcon direction="undo"/><span>Undo</span></button>
    <button type="button" title="Redo (Ctrl+Shift+Z or Ctrl+Y)" aria-label="Redo" disabled={!canRedo} onClick={redo}><HistoryIcon direction="redo"/><span>Redo</span></button>
  </div>;
  return <section className="canvas panel" aria-label="Workflow canvas">
    <div className="canvas-head"><h2>Your Workflow</h2>{toolboxMode === 'top' && toolbox}<label className="toolbox-mode-label">Tools <select aria-label="Toolbox position" value={toolboxMode} onChange={event => changeToolboxMode(event.target.value as ToolboxMode)}><option value="top">Top toolbar</option><option value="floating">Floating toolbox</option></select></label><span className="revision">{workflow.nodes.length} steps</span></div>
    {feedback && <p className="canvas-feedback" role="status">{feedback}</p>}
    <div ref={surfaceRef} className="flow-surface build-flow-surface" role="region" aria-label="Workflow graph" onMouseDown={startMarquee}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={(changes: NodeChange<Node>[]) => onNodesChange(changes.filter(change => change.type !== 'select'))} fitView minZoom={0.35} maxZoom={1.4}
        nodesDraggable nodesConnectable deleteKeyCode={null} selectNodesOnDrag={false} panOnDrag={[1, 2]}
        onNodeClick={(event, node) => {
          if (ignorePaneClick.current) return;
          if (event.shiftKey) {
            const current = selectedIdsRef.current;
            const ids = current.includes(node.id) ? current.filter(id => id !== node.id) : [...current, node.id];
            selectNodes(ids, ids.includes(node.id) ? node.id : ids.length === 1 ? ids[0]! : null);
          } else selectNodes([node.id], node.id);
        }}
        onNodeDragStart={(_event, node) => { if (!selectedIdsRef.current.includes(node.id)) selectNodes([node.id], node.id); }}
        onNodeDragStop={(_event, node, draggedNodes) => commitDrag(node, draggedNodes)}
        onEdgeClick={(_event, edge) => { selectNodes([], null); setSelectedEdge({ from: edge.source, to: edge.target }); }}
        onPaneClick={() => { if (ignorePaneClick.current) return; selectNodes([], null); }} onConnect={({ source, target }) => connect(source, target)}>
        <Background gap={18} size={1} color="var(--grid)" /><Controls showInteractive={false} />
      </ReactFlow>
      {marquee && marquee.width >= 4 && marquee.height >= 4 && <div className="canvas-marquee" aria-hidden="true" style={marquee}/>}
      {toolboxMode === 'floating' && <div className="floating-toolbox">{toolbox}</div>}
    </div>
    <div className="canvas-foot"><span>Drag steps to arrange your workflow.</span><span>Select a step or connection to edit.</span></div>
  </section>;
}

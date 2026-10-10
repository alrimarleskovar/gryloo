// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import Image from 'next/image';
import type { WalletEnvironment } from '../wallet/environment';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import {lendingDetails,lendingCanvasEdges} from '../domain/lending-authoring';
import {useBuild009Wallet} from '../state/build009-wallet-store';
import { transferCardLabel } from '../domain/robinhood-transfer-authoring';
import { lendingAmountLabel } from '../domain/supply-authoring';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReactFlow, Background, Handle, Position, useNodesInitialized, useNodesState, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals, type Node, type NodeChange, type NodeProps, type ReactFlowState, MarkerType } from '@xyflow/react';
import { MOCKED_CHAIN_PROFILE, type Symbol } from '@defi-workflow-engine/reference-linter';
import { amountOf } from '../domain/commands';
import { bridgeDetails } from '../domain/bridge-authoring';
import { directions, inputSymbol, outputSymbol, formatHumanAmount, swapDetails, SWAP_ACTION } from '../domain/swap-authoring';
import { solanaSwapDetails, solanaSwapLabels } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { uniswapLiquidityDetails } from '../domain/uniswap-liquidity-authoring';
import { routerDetails, routerNetworkOfInput, ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL } from '../domain/router-authoring';
import { useWorkflow } from '../state/workflow-store';
import { editorReducer } from '../domain/editor';
import { CANVAS_ACTIONS, canvasAddCommand, type CanvasAction } from '../domain/canvas-authoring';
import { shellChainLabel } from '../domain/product-shell';
import { WorkflowName } from './workflow-name';
import { DarkSpotlight } from './dark-spotlight';
import { CANVAS_GESTURES, CanvasNavigator } from './canvas-navigator';
import { WorkflowEditReview } from './workflow-edit-review';
import { ComposerCard, supplyReviewFormId, poolReviewFormId, poolProposalTarget, type ComposerCardData } from './composer-card';
import { canEditCanvasAmount, setupSummary, bridgeSetupNetworks, type CanvasBridgeNetworks } from '../domain/canvas-action-setup';
import { ActionIcon } from './action-icon';
import { useStockCardInputs } from './canvas-card-inputs';
import { cryptoNetworks, cryptoSelectionOf, cryptoProfile, cryptoTokenOptions, selectCryptoNetwork, selectCryptoToken, canSelectCryptoAssets, type CryptoSelection, type CryptoAction } from '../domain/crypto-action-picker';
import { actionReviewValue } from '../domain/canvas-action-setup';
import { SimulateWorkflowCanvas } from './simulate-workflow-canvas';
import { composerActions, composerSummary, composerNodeState, composerConnections, singleAmountProposalTarget } from '../domain/composer-presentation';
import { canDeleteCanvasEdge, canDeleteCanvasNode, deletableCanvasNodes, isTextEntry } from '../domain/canvas-keyboard';
import { canvasPosition, defaultCanvasPosition, readToolboxMode, saveToolboxMode, type ToolboxMode } from '../domain/canvas-layout';
import { canvasMarquee, marqueeIntersects } from '../domain/canvas-marquee';
import { planCanvasDuplicate } from '../domain/editor-history';
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
/** `solana`/`solanaKind`/`solanaProvider` mark a live-provider runtime card (Solana runtimes and the Base Sepolia Uniswap position). */
type CardData = { overview?: boolean; lending?: boolean; title: string; amount: string; runtime?: CrossChainRuntimeStatus; locked: boolean; selected: boolean; supply: boolean; chain?: string; risk?: string; swap: boolean; solana?: boolean; solanaKind?: string; solanaProvider?: string; bridge: boolean; liquidity: boolean; composition: boolean; bridgeSwap: boolean; across: boolean; crossChain: boolean; preparation: boolean;
  simulate?: { expected: string; minimum: string } | null };
function WorkflowCard({ data }: NodeProps) {
  const { t: tr } = useLocale();
  if (data.composer) return <ComposerCard data={data as ComposerCardData}/>;
  const card = data as CardData;
  if (card.overview) return <div className="flow-card">
    <Handle type="target" position={card.lending ? Position.Top : Position.Left} isConnectable={false}/>
    <span className="flow-card-kind">{tr(card.chain)}{tr(card.supply ? ' · AAVE V3' : card.solanaProvider ? ` · ${card.solanaProvider}` : '')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    {card.risk && <span className="flow-card-risk">{tr(card.risk)}</span>}
    <Handle type="source" position={card.lending ? Position.Bottom : Position.Right} isConnectable={false}/>
  </div>;
  if(card.lending)return <div className={`flow-card ${card.selected?'active':''}`}>
    <Handle type="target" position={Position.Top} isConnectable={false}/>
    <span className="flow-card-kind">{tr("BASE SEPOLIA · ")}{tr(card.swap?'UNISWAP V3':'AAVE V3')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    <small>{tr(card.swap?'Borrowed USDC flows into Swap':'Select to edit · simulate before review')}</small>
    <Handle type="source" position={Position.Bottom} isConnectable={false}/>
  </div>;
  if (card.simulate !== undefined) {
    return <div className={`flow-card simulated ${card.swap ? 'swap' : ''}`}>
      {((card.bridgeSwap && card.swap) || (!card.swap && !card.bridge && (!card.liquidity || card.composition))) && <Handle type="target" position={Position.Left} isConnectable={false} />}
      <span className="flow-card-kind">{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : 'ARBITRUM · COMPOSED STEP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE ROUTE' : 'ARBITRUM · DESTINATION SWAP') : card.bridge ? 'BASE → OPTIMISM · BRIDGE ROUTE' : card.liquidity ? 'BASE · LIQUIDITY UNOBSERVED' : card.solana ? card.solanaKind ?? 'SOLANA' : card.swap ? (card.simulate ? 'BASE · MOCKED OUTPUT' : 'BASE · NO CURRENT OUTPUT') : 'MOCK ACTION')}</span>
      <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
      {card.swap && card.simulate ? <>
        <span className="mocked-value" data-mocked-value=""><span>{tr("Expected ")}{tr(card.simulate.expected)}</span><span className="mocked-tag">{tr("MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></span>
        <span className="mocked-value" data-mocked-value=""><span>{tr("Minimum ")}{tr(card.simulate.minimum)}</span><span className="mocked-tag">{tr("MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></span>
      </> : <small>{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? 'MOCKED composed simulation · actual outputs require reconciliation' : card.across ? 'Direct Across quote in bridge review' : card.bridge ? 'Live LI.FI route in bridge review' : card.liquidity ? 'Use the isolated fork liquidity simulation' : card.solana ? `Live ${card.solanaProvider ?? ''} quote in Simulate` : card.swap ? 'Generate mocked artifacts to see outputs' : 'Not simulated (mock action)')}</small>}
      {((card.bridgeSwap && card.bridge) || (!card.liquidity && !card.bridge && (!card.swap || card.composition))) && <Handle type="source" position={Position.Right} isConnectable={false} />}
    </div>;
  }
  return <div className={`flow-card ${card.selected ? 'active' : ''}`}>
    <Handle type="target" position={Position.Left} isConnectable={!card.composition && !card.supply} />
    <span className="flow-card-kind">{tr(card.supply ? 'BASE SEPOLIA · AAVE V3' : card.crossChain ? (card.bridge ? 'BASE → ARBITRUM · BRIDGE' : card.preparation ? 'ARBITRUM · CALCULATED SPLIT' : card.liquidity ? 'ARBITRUM · UNISWAP V3' : 'ARBITRUM · DESTINATION SWAP') : card.bridgeSwap ? (card.bridge ? 'BASE → ARBITRUM · UNQUOTED BRIDGE' : 'ARBITRUM · UNQUOTED SWAP') : card.bridge ? 'BASE → OPTIMISM · UNQUOTED BRIDGE' : card.composition && card.liquidity ? 'BASE · POSITION' : card.liquidity ? 'BASE · UNQUOTED POSITION' : card.solana ? card.solanaKind ?? 'SOLANA' : card.swap ? `${card.chain ?? 'Base'} · SWAP` : 'WORKFLOW ACTION')}</span>
    <strong>{tr(card.title)}</strong><span className="numeric">{tr(card.amount)}</span>
    <small>{tr(card.supply ? 'Select to edit · simulate before review' : card.crossChain && card.runtime ? `Runtime: ${card.runtime}` : card.crossChain ? 'Select to review · non-atomic boundaries' : card.across ? 'Review route availability in Simulate' : card.bridge ? 'Review the route in Simulate' : card.composition && card.liquidity ? 'Receives the linked WETH output' : card.liquidity ? 'Select to configure the position' : card.solana ? 'Select to edit · simulate for a live quote' : card.swap ? 'Select to edit · simulate before review' : card.locked ? 'Amount locked' : 'Select to configure')}</small>
    {card.risk && <span className="flow-card-risk">{tr(card.risk)}</span>}
    <Handle type="source" position={Position.Right} isConnectable={!card.composition && !card.supply} />
  </div>;
}
const nodeTypes = { workflow: WorkflowCard };
const COMPOSER_FIT_PADDING = { top: '32px', bottom: '90px', left: '32px', right: '32px' } as const;
function LendingCanvasViewport() {
  const initialized=useNodesInitialized(),size=useStore((state:ReactFlowState)=>`${state.width}:${state.height}`);
  const {fitView}=useReactFlow();
  // Refit after pane resize/measurement, never after a drag or a semantic edit alone.
  useLayoutEffect(()=>{if(initialized)void fitView({padding:COMPOSER_FIT_PADDING,minZoom:0.35,maxZoom:1.1});},[initialized,size,fitView]);
  return null;
}
const actions = [...CANVAS_ACTIONS, 'stocks'] as const;
function actionLabel(action: typeof actions[number]) { return action === 'lending' ? 'Lending' : action === 'pool' ? 'Pool / Liquidity' : action[0]!.toUpperCase() + action.slice(1); }
function HistoryIcon({ direction }: { direction: 'undo' | 'redo' }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === 'undo' ? <><path d="m10 8-4 4 4 4"/><path d="M6 12h9a5 5 0 0 1 0 10"/></>
      : <><path d="m14 8 4 4-4 4"/><path d="M18 12H9a5 5 0 0 0 0 10"/></>}
  </svg>;
}
function DuplicateIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
  </svg>;
}
function DockIcon({ floating }: { floating: boolean }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
    {floating ? <path d="M10 14h4v-4m0 4-4-4"/> : <path d="M14 10h-4v4m0-4 4 4"/>}
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

/** Read-only IR projection. Execute overview supplies no outputs or execution state. */
function ReadonlyWorkflowCanvas({ mode, workflowName, overlay, primaryAction }: { mode: 'simulate' | 'execute'; workflowName: string; overlay: ReadonlyMap<string, SimulationOverlay>; primaryAction?: ReactNode }) {
  const { t: tr } = useLocale();
  const { state, context } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const nodes = useMemo(() => workflow.nodes.filter(node => !node.actionType.startsWith('mock-')).map((node, index) => {
    const lending=isLendingComposition(workflow)?lendingDetails(workflow):null;
    const swap = lending?null:swapDetails(node, context);
    const solana = solanaSwapDetails(node);
    const orcaPosition = solanaLiquidityDetails(node);
    const uniPosition = uniswapLiquidityDetails(node);
    const routed = routerDetails(node);
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
    return { id: node.nodeId, type: 'workflow', position: lending?{x:180,y:35+index*230}:{ x: 60 + index * 280, y: 70 + (index % 2) * 40 },
      data: { chain: shellChainLabel(node.chainId), risk: node.actionType === 'borrow' ? 'Variable debt' : node.actionType === 'withdraw' ? 'Collateral change' : undefined, lending:Boolean(lending), title: lending?(node.nodeId==='lending-supply'?'Aave Supply':node.nodeId==='lending-borrow'?'Aave Borrow':'Uniswap Swap'):node.actionType==='asset.transfer'?'Self-transfer test ETH':lending&&node.actionType==='asset.swap.exact-input'?'Borrowed Aave USDC → WETH':node.actionType==='withdraw'?'Withdraw from Aave V3':node.actionType==='repay'?'Repay to Aave V3':node.actionType==='borrow'?'Borrow from Aave V3':node.actionType === 'supply' ? 'Supply to Aave V3' : crossChain ? (crossBridge ? 'Bridge USDC' : preparation ? 'Calculate destination split' : crossSwap ? 'Swap selected USDC for WETH' : 'Mint Uniswap v3 position') : routed ? (routed.network === 'testnet' ? 'Base Sepolia → Arbitrum Sepolia USDC' : 'Base → Arbitrum USDC') : across ? 'Base → Arbitrum USDC' : bridgeSwap ? (bridge ? 'Base → Arbitrum USDC' : 'Arbitrum USDC → WETH') : bridge ? 'Base → Optimism USDC' : isLiquidity ? 'WETH/USDC v3 position' : orcaPosition ? 'SOL/devUSDC position' : uniPosition ? 'USDC/WETH v3 position' : solana ? `${solana.from} → ${solana.to}` : swap ? `${swap.from} → ${swap.to}` : node.actionType.startsWith('mock-') ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : node.actionType, amount: node.actionType==='asset.transfer'?transferCardLabel(node as Parameters<typeof transferCardLabel>[0]):lending?(node.actionType==='supply'?`${lending.supply} USDC collateral`:node.actionType==='borrow'?`${lending.borrow} USDC · HF checkpoint ≥ 2.0`:`Exactly ${lending.borrow} borrowed USDC`):['withdraw','repay','borrow','supply'].includes(node.actionType)?lendingAmountLabel(node as Parameters<typeof lendingAmountLabel>[0])??'' : crossChain ? (crossBridge ? 'Base USDC → Arbitrum USDC' : preparation ? 'Reconciled amount → range ratio' : crossSwap ? 'Calculated partial USDC input' : `Ticks ${range} · fee 500`) : routed ? `${routed.amount} USDC → ${routed.recipient ? routed.recipient.slice(0, 8) + '…' : 'your wallet'} · ${routed.slippage} bps` : bridgeSwap && !bridge ? 'Reconciled USDC input' : bridge ? `${bridge.amount} USDC · ${bridge.slippageBps} bps` : isLiquidity ? `Ticks ${range} · fee 500` : orcaPosition ? `${orcaPosition.lowerPrice}–${orcaPosition.upperPrice} devUSDC/SOL · ${orcaPosition.network}` : uniPosition ? `${uniPosition.lowerPrice}–${uniPosition.upperPrice} USDC/WETH · ${uniPosition.network}` : solana ? `${solana.amount} ${solana.from} · ${solana.network} · ${solana.slippage} bps` : swap ? `${swap.amount} ${swap.from} · ${swap.slippage ?? 'missing'} bps` : `${amountOf(node)} sample units`, locked: node.lockedParameters.length > 0, selected: false, supply: ['supply','borrow','repay','withdraw'].includes(node.actionType), swap: node.actionType === SWAP_ACTION, solana: Boolean(solana || orcaPosition || uniPosition || routed), solanaKind: solana ? solanaSwapLabels(solana.network).kind : orcaPosition ? 'SOLANA DEVNET · ORCA' : uniPosition ? `${uniPosition.network.toUpperCase()} · UNISWAP V3` : routed ? (routed.network === 'testnet' ? 'TESTNET · BASE SEPOLIA → ARBITRUM SEPOLIA · CROSS-CHAIN ROUTER' : 'BASE → ARBITRUM · CROSS-CHAIN ROUTER') : undefined, solanaProvider: solana ? solanaSwapLabels(solana.network).provider : orcaPosition ? orcaPosition.provider : uniPosition ? uniPosition.provider : routed ? ROUTER_ROUTING_LABEL[routed.routing] : undefined, bridge: Boolean(bridge) || crossBridge, liquidity: isLiquidity, composition, bridgeSwap, across, crossChain, preparation, simulate },
    };
  }).map(node => mode === 'execute' ? { ...node, data: { ...node.data, overview: true } } : node), [workflow, overlay, context, mode]);
  const edges = useMemo(() => (lendingCanvasEdges(workflow)??workflow.resourceEdges.map(edge => ({
    id: `${edge.fromNodeId}-${edge.toNodeId}`, source: edge.fromNodeId, target: edge.toNodeId, label: edge.outputId === 'swap-input' ? 'Calculated swap USDC' : edge.outputId === 'liquidity-usdc' ? 'Reserved liquidity USDC' : edge.outputId === 'liquidity-weth' ? 'Existing WETH' : edge.outputId === 'amount-out' && edge.inputName === 'amount0-max' ? 'Reconciled WETH output' : edge.outputId === 'amount-out' && edge.inputName === 'weth-from-swap' ? 'WETH output reference' : edge.inputName === 'amount-in' ? 'Arbitrum USDC output' : 'sample units', animated: false,
  }))), [workflow]);
  const swaps = workflow.nodes.filter(n => n.actionType === SWAP_ACTION).length;
  const bridges = workflow.nodes.filter(n => n.actionType === 'asset.bridge').length;
  const [viewportState, setViewportState] = useState<ViewportState>('pending');
  return <section className="canvas simulate-canvas panel" aria-label={tr(mode === 'execute' ? 'Workflow overview' : 'Mocked outputs graph')}>
    <div className="canvas-head"><div><h2>{workflowName}</h2></div><span className="revision">{tr(nodes.length)}{tr(" actions")}</span></div>
    <div className="flow-surface" role="region" aria-label={tr(mode === 'execute' ? 'Workflow overview graph' : 'Mocked outputs on the workflow graph')} data-viewport={viewportState}>
      <ReactFlow key={workflow.nodes.length} nodes={nodes} edges={edges} nodeTypes={nodeTypes} minZoom={SIMULATION_VIEWPORT.minZoom} maxZoom={SIMULATION_VIEWPORT.maxZoom}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} {...CANVAS_GESTURES}>
        <SimulationViewport onState={setViewportState} />
        <Background gap={18} size={1} color="var(--grid)" /><CanvasNavigator/>
      </ReactFlow>
      {primaryAction && <div className="canvas-primary-action simulation-canvas-actions">{primaryAction}</div>}
    </div>
    <div className="canvas-foot">{mode === 'execute' ? <span>{tr("Workflow overview")}</span> : <><span>{tr(workflow.nodes.length - swaps - bridges)}{tr(" mock · ")}{tr(bridges ? `${bridges} bridge · ` : '')}{tr(swaps)} {tr(workflow.nodes[0]?.nodeId === 'build009-bridge' ? 'Arbitrum' : 'Base')}{tr(" swap ")}{tr(swaps === 1 ? 'node' : 'nodes')}</span><span>{tr("Read-only · MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span></>}</div>
  </section>;
}

type BuildCanvasProps = { environment?: WalletEnvironment; selectedId: string | null; select: (id: string | null) => void; openSettings?: (id: string) => void; workflowName?: string; renameWorkflow?: (name: string) => void; onSave?: () => void; estimateOwner?: string | undefined; onToolboxModeChange?: (mode: ToolboxMode) => void; primaryAction?: ReactNode };
const EMPTY_OVERLAY: ReadonlyMap<string, SimulationOverlay> = new Map();
export function WorkflowCanvas(props: BuildCanvasProps | { mode: 'simulate'; workflowName: string; overlay?: ReadonlyMap<string, SimulationOverlay>; primaryAction?: ReactNode } | { mode: 'execute'; workflowName: string }) {
  if ('mode' in props && props.mode === 'simulate') return <SimulateWorkflowCanvas workflowName={props.workflowName} primaryAction={props.primaryAction}/>;
  if ('mode' in props) return <ReadonlyWorkflowCanvas mode={props.mode} workflowName={props.workflowName} overlay={EMPTY_OVERLAY}/>;
  return <BuildCanvas {...props}/>;
}

function BuildCanvas({ environment, selectedId, select, openSettings, workflowName = 'Your Workflow', renameWorkflow = () => {}, onSave, estimateOwner, onToolboxModeChange, primaryAction }: BuildCanvasProps) {
  const { t: tr } = useLocale();
  const { state, dispatch, context, canvasLayout, canUndo, canRedo, undo, redo, moveCanvasNodes, addCanvasCommand, duplicateCanvasNodes, propose, review,
    actionSetup = null, amountInputs = {}, bridgeNetworkInputs = {}, cryptoSelections = {}, editCryptoSelection, startActionSetup, editCanvasAmount, editSwapSetupDirection, editBridgeNetworks, cancelCanvasAmount, reviewCanvasAmount, removeActionSetup, pending, applyProposal, dismissProposal } = useWorkflow();
  const workflow: Workflow = state.workflow;
  const wallet=useBuild009Wallet();
  const stocks = useStockCardInputs();
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() => selectedId ? [selectedId] : []);
  const selectedIdsRef = useRef<readonly string[]>(selectedId ? [selectedId] : []);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const ignorePaneClick = useRef(false);
  const [selectedEdge, setSelectedEdge] = useState<{ from: string; to: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [toolboxMode, setToolboxMode] = useState<ToolboxMode>('top');
  useEffect(() => { setToolboxMode(readToolboxMode()); }, []);
  useEffect(() => { onToolboxModeChange?.(toolboxMode); }, [toolboxMode, onToolboxModeChange]);
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
    if (selectedId && !selectedIdsRef.current.includes(selectedId)) {
      selectedIdsRef.current = [selectedId]; setSelectedIds([selectedId]); setSelectedEdge(null);
    } else if (!selectedId && selectedIdsRef.current.length === 1) {
      selectedIdsRef.current = []; setSelectedIds([]);
    }
  }, [selectedId]);
  // Proposal-based compositions become selectable only after the canonical edit is applied.
  const previousNodeIds = useRef(new Set(workflow.nodes.map(node => node.nodeId)));
  useEffect(() => {
    if (selectedEdge && !composerConnections(workflow).some(edge => edge.source === selectedEdge.from && edge.target === selectedEdge.to)) setSelectedEdge(null);
  }, [workflow, selectedEdge]);
  useEffect(() => {
    const remaining = selectedIdsRef.current.filter(id => actionSetup?.id === id || stocks.cards.some(card => card.id === id) || workflow.nodes.some(node => node.nodeId === id));
    if (remaining.length !== selectedIdsRef.current.length) { selectedIdsRef.current = remaining; setSelectedIds(remaining); }
    // A newly accepted node replaces its setup card's ID; let the addition effect transfer selection without closing explicitly opened settings.
    if (selectedId && selectedId !== actionSetup?.id && !stocks.cards.some(card => card.id === selectedId) && !workflow.nodes.some(node => node.nodeId === selectedId) &&
      !composerActions(workflow).some(node => !previousNodeIds.current.has(node.nodeId))) select(null);
  }, [workflow, actionSetup, selectedId, select, stocks.cards]);
  const previousSetupId = useRef(actionSetup?.id);
  useEffect(() => {
    if (actionSetup && previousSetupId.current !== actionSetup.id) selectNodes([actionSetup.id], actionSetup.id);
    previousSetupId.current = actionSetup?.id;
  }, [actionSetup]);
  useEffect(() => {
    const added = composerActions(workflow).filter(node => !previousNodeIds.current.has(node.nodeId));
    previousNodeIds.current = new Set(workflow.nodes.map(node => node.nodeId));
    // Duplicate already selects every copy as one group. Preserve that explicit
    // selection while transferring a newly configured setup to its canonical ID.
    if (added.length && !added.every(node => selectedIdsRef.current.includes(node.nodeId)))
      selectNodes([added[0]!.nodeId], added[0]!.nodeId);
  }, [workflow]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Dialogs own their keyboard interaction while the persistent canvas stays mounted.
      if (event.defaultPrevented || event.target instanceof Element && event.target.closest('dialog[open], [role="dialog"], [role="menu"]')) return;
      if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.altKey || event.metaKey) return;
      const textEntry = isTextEntry(event.target);
      if (event.key === 'Escape' && (selectedIdsRef.current.length || selectedEdge)) { event.preventDefault(); selectNodes([], null); return; }
      if (textEntry) return;
      if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && !event.target.closest('button')) {
        const id = event.target.closest('.react-flow__node')?.getAttribute('data-id');
        if (id) { event.preventDefault(); selectNodes([id], id); return; }
      }
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
      const removingSetup = Boolean(actionSetup && selected.includes(actionSetup.id));
      const stockSelection = selected.filter(id => stocks.cards.some(card => card.id === id));
      const canonicalSelection = selected.filter(id => id !== actionSetup?.id && !stockSelection.includes(id));
      const removable = deletableCanvasNodes(workflow, canonicalSelection);
      if (stockSelection.length) stocks.remove(stockSelection);
      if (removingSetup) removeActionSetup();
      if (removable.length) {
        dispatch({ type: 'REMOVE_MANY', nodeIds: removable, source: 'CANVAS', baseRevision: workflow.revision });
        selectNodes(selected.filter(id => !removable.includes(id)), null);
      }
      if ((removingSetup || stockSelection.length) && !removable.length) selectNodes([], null);
      if (removable.length !== canonicalSelection.length) setFeedback(removable.length
        ? 'Some selected steps are required by another step or are protected.'
        : 'This step is required by another step or is protected.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, workflow, actionSetup, removeActionSetup, selectedEdge, select, undo, redo, stocks]);
  const previousEnvironment = useRef(environment);
  useEffect(() => {
    if (previousEnvironment.current === environment) return;
    previousEnvironment.current = environment;
    if (pending?.command.type === 'ADD_ROUTER_BRIDGE' || pending?.command.type === 'SET_ROUTER_BRIDGE') dismissProposal();
    else if (pending && ['ADD_CRYPTO_ACTION', 'SET_CRYPTO_ACTION', 'ADD_UNISWAP_LIQUIDITY', 'SET_UNISWAP_LIQUIDITY', 'ADD_SOLANA_LIQUIDITY', 'SET_SOLANA_LIQUIDITY', 'ADD_SUPPLY', 'SET_SUPPLY', 'ADD_BORROW', 'SET_BORROW', 'ADD_REPAY', 'SET_REPAY', 'ADD_WITHDRAW', 'SET_WITHDRAW'].includes(pending.command.type)) dismissProposal();
  }, [environment, pending, dismissProposal]);
  useEffect(() => {
    if (!environment || environment === 'unknown') return;
    if (actionSetup && actionSetup.action !== 'bridge') {
      const available = cryptoNetworks(actionSetup.action, environment);
      const selection = actionSetup.cryptoSelection;
      if (available.length && !available.some(profile => profile.network === selection?.network)) editCryptoSelection(actionSetup.id, selectCryptoNetwork(actionSetup.action, available[0]!.network, selection), wallet.account ?? undefined);
    }
    for (const node of workflow.nodes) {
      const selection = cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node);
      if (!selection || !canSelectCryptoAssets(node, workflow)) continue;
      const available = cryptoNetworks(selection.action, environment);
      if (available.length && !available.some(profile => profile.network === selection.network)) editCryptoSelection(node.nodeId, selectCryptoNetwork(selection.action, available[0]!.network, selection), wallet.account ?? undefined);
    }
  }, [environment, actionSetup, workflow, cryptoSelections, editCryptoSelection, wallet.account]);
  useEffect(() => {
    if (environment !== 'mainnet' && environment !== 'testnet') return;
    const option = ROUTER_NETWORK_OPTIONS[environment];
    const alignNetworks = (id: string, current: CanvasBridgeNetworks) => {
      const patch: Partial<CanvasBridgeNetworks> = {
        ...(current.source !== option.source ? { source: option.source } : {}),
        ...(current.destination !== option.destination ? { destination: option.destination } : {}),
      };
      // Change only editable drafts; the canonical route still requires Review / Apply.
      if (Object.keys(patch).length) editBridgeNetworks(id, patch);
    };
    if (actionSetup?.action === 'bridge') alignNetworks(actionSetup.id, bridgeSetupNetworks(actionSetup));
    for (const node of workflow.nodes) {
      const details = routerDetails(node);
      if (details && canEditCanvasAmount(node, context, workflow)) alignNetworks(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? details);
    }
  }, [environment, actionSetup, workflow, context, bridgeNetworkInputs, editBridgeNetworks]);
  const projectedNodes = useMemo<Node[]>(() => {
    const actionSelection = (id: string, selection: CryptoSelection, editable = true) => {
      const profiles = cryptoNetworks(selection.action, environment ?? 'unknown');
      const valid = profiles.some(profile => profile.network === selection.network);
      return { selection, networks: profiles.filter(profile => editable || profile.network === selection.network).map(profile => profile.network), valid,
        tokens: { source: valid ? editable ? cryptoTokenOptions(selection, 'source') : [selection.from] : [], destination: valid ? editable ? cryptoTokenOptions(selection, 'destination') : selection.to ? [selection.to] : [] : [] },
        onNetwork: (network: string) => { if (editable && profiles.some(profile => profile.network === network)) editCryptoSelection(id, selectCryptoNetwork(selection.action, network, selection), wallet.account ?? undefined); },
        onToken: (side: 'source' | 'destination', token: string) => { if (editable) editCryptoSelection(id, selectCryptoToken(selection, side, token)); },
      };
    };
    const selectedSummary = (summary: ReturnType<typeof composerSummary>, selection?: CryptoSelection | null) => !selection ? summary : {
      ...summary, chain: selection.network, provider: cryptoProfile(selection)!.provider,
      amount: `${summary.amount.split(' ')[0]} ${selection.from}`, detail: selection.action === 'swap' ? `${selection.from} → ${selection.to}` : summary.detail,
      ...(summary.liquidityValues ? { liquidityValues: summary.liquidityValues.map((value, index) => ({ ...value, token: index ? selection.to! : selection.from })) } : {}),
    };
    const bridgeSelection = (id: string, networks: CanvasBridgeNetworks) => {
      const network = environment === 'mainnet' || environment === 'testnet' ? environment : null;
      const option = network ? ROUTER_NETWORK_OPTIONS[network] : null;
      return {
        source: option ? [option.source] : [], destination: option ? [option.destination] : [],
        valid: network !== null && routerNetworkOfInput(networks) === network,
        // Solana has swap/liquidity support, but no canonical Bridge pair yet.
        unavailable: [network === 'testnet' ? ORCA_WHIRLPOOLS_DEVNET.network : JUPITER_SOLANA_MAINNET.network],
        onSelect: (side: 'source' | 'destination', selected: string) => {
          if (option && side === 'source' && selected === option.source) editBridgeNetworks(id, { source: option.source });
          if (option && side === 'destination' && selected === option.destination) editBridgeNetworks(id, { destination: option.destination });
        },
      };
    };
    const proposalTarget = pending?.authoringId ?? (pending ? singleAmountProposalTarget(workflow, pending.command) : null);
    const contextualTarget = pending?.command.source === 'CHAT' ? proposalTarget ?? poolProposalTarget(pending.command) : null;
    const projected: Node[] = composerActions(workflow).map((node, index) => ({
    id: node.nodeId, type: 'workflow',
    ariaLabel: `Step ${index + 1}: ${composerSummary(workflow, node, context).action}`,
    position: canvasLayout[node.nodeId] ? canvasPosition(canvasLayout, node, index) :
      isLendingComposition(workflow) ? { x: 180, y: 35 + index * 230 } : canvasPosition(canvasLayout, node, index),
    selected: selectedIds.includes(node.nodeId) || selectedId === node.nodeId,
    data: { composer: true, estimateWorkflow: amountInputs[node.nodeId] === undefined && !cryptoSelections[node.nodeId] ? workflow : undefined, estimateNodeId: node.nodeId, estimateOwner: estimateOwner ?? wallet.account, contextualProposal: contextualTarget === node.nodeId, onOpenSettings: () => { selectNodes([node.nodeId], node.nodeId); openSettings?.(node.nodeId); }, step: index + 1, selected: selectedId === node.nodeId,
      vertical: isLendingComposition(workflow), summary: selectedSummary(composerSummary(workflow, node, context), cryptoSelections[node.nodeId]),
      ...(cryptoSelectionOf(node) ? { actionSelection: actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!, canSelectCryptoAssets(node, workflow)) } : {}),
      ...(routerDetails(node) ? {
        summary: { ...composerSummary(workflow, node, context), chain: `${(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).source} → ${(bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).destination}` },
        ...(canEditCanvasAmount(node, context, workflow) ? { networkSelection: bridgeSelection(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!) } : {}),
      } : {}),
      ...(composerSummary(workflow, node, context).action === 'Pool / Liquidity' ? { poolProposal: {
        nodeId: node.nodeId, formId: poolReviewFormId(node.nodeId), canReview: selectedId === node.nodeId,
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && pending?.valid && poolProposalTarget(pending.command) === node.nodeId && pending.command.baseRevision === workflow.revision),
        onApply: applyProposal,
      } } : {}),
      ...(['supply', 'borrow', 'repay', 'withdraw', 'asset.transfer'].includes(node.actionType) ? { supplyProposal: {
        formId: supplyReviewFormId(node.nodeId), reviewLabel: `Review ${composerSummary(workflow, node, context).action} change`, canReview: selectedId === node.nodeId,
        hasProposal: Boolean(pending && proposalTarget === node.nodeId),
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && pending?.valid && proposalTarget === node.nodeId && pending.command.baseRevision === workflow.revision),
        onApply: applyProposal,
      } } : {}),
      validation: node.actionType !== 'supply' && amountInputs[node.nodeId] !== undefined
        ? { ...composerNodeState(review, node.nodeId), status: 'Check amount', tone: 'warning' }
        : composerNodeState(review, node.nodeId),
      ...(canEditCanvasAmount(node, context, workflow) ? { amountEditor: {
        ...(['supply', 'borrow', 'repay', 'withdraw', 'asset.transfer'].includes(node.actionType) ? { formId: supplyReviewFormId(node.nodeId) } : {}),
        value: amountInputs[node.nodeId] ?? composerSummary(workflow, node, context).amount.split(' ')[0]!,
        changed: amountInputs[node.nodeId] !== undefined,
        canApply: Boolean((!cryptoSelectionOf(node) || actionSelection(node.nodeId, cryptoSelections[node.nodeId] ?? cryptoSelectionOf(node)!).valid) && (!routerDetails(node) || bridgeSelection(node.nodeId, bridgeNetworkInputs[node.nodeId] ?? routerDetails(node)!).valid) && pending?.valid && pending.authoringId === node.nodeId && pending.authoringAmount === actionReviewValue(null, node.nodeId, amountInputs[node.nodeId], bridgeNetworkInputs[node.nodeId], cryptoSelections[node.nodeId]) && pending.command.baseRevision === workflow.revision),
        onChange: (value: string) => editCanvasAmount(node.nodeId, value),
        onReview: () => reviewCanvasAmount(node.nodeId), onCancel: () => cancelCanvasAmount(node.nodeId),
        onApply: applyProposal,
      } } : {}) },
    }));
    if (actionSetup) projected.push({ id: actionSetup.id, type: 'workflow', ariaLabel: `Step ${projected.length + 1}: ${setupSummary(actionSetup, context).action}`,
      position: canvasLayout[actionSetup.id] ?? defaultCanvasPosition(projected.length), selected: selectedId === actionSetup.id,
      data: { composer: true, onOpenSettings: () => { selectNodes([actionSetup.id], actionSetup.id); openSettings?.(actionSetup.id); }, step: projected.length + 1, selected: selectedId === actionSetup.id, vertical: false,
        summary: setupSummary(actionSetup, context),
        ...(actionSetup.action !== 'bridge' ? { actionSelection: actionSelection(actionSetup.id, actionSetup.cryptoSelection ?? selectCryptoNetwork(actionSetup.action as CryptoAction, actionSetup.action === 'swap' ? context.assets.USDC.asset.chainId === 'eip155:84532' ? 'Base Sepolia' : 'Base' : 'Base Sepolia')) } : {}),
        ...(actionSetup.action === 'bridge' ? { networkSelection: bridgeSelection(actionSetup.id, bridgeSetupNetworks(actionSetup)) } : {}),
        ...(actionSetup.action === 'swap' ? { tokenSelection: {
          source: directions.map(direction => inputSymbol(direction)), destination: directions.map(direction => outputSymbol(direction)),
          onSelect: (side: 'source' | 'destination', symbol: string) => {
            const direction = directions.find(direction => (side === 'source' ? inputSymbol(direction) : outputSymbol(direction)) === symbol);
            if (direction) editSwapSetupDirection(actionSetup.id, direction);
          },
        } } : {}),
        validation: { findings: [], status: 'Draft', tone: 'neutral', message: undefined, next: undefined },
        ...(actionSetup.action === 'pool' ? { poolProposal: { nodeId: actionSetup.id, formId: poolReviewFormId(actionSetup.id),
          canReview: selectedId === actionSetup.id,
          canApply: Boolean(Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision), onApply: applyProposal } } : {}),
        ...(actionSetup.action !== 'pool' && actionSetup.action !== 'swap' && actionSetup.action !== 'bridge' ? { supplyProposal: {
          formId: supplyReviewFormId(actionSetup.id), reviewLabel: `Review ${setupSummary(actionSetup, context).action} change`, canReview: selectedId === actionSetup.id,
          hasProposal: pending?.authoringId === actionSetup.id,
          canApply: Boolean(Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision),
          onApply: applyProposal,
        } } : {}),
        ...(actionSetup.action !== 'pool' ? { amountEditor: { ...(actionSetup.action !== 'swap' && actionSetup.action !== 'bridge' ? { formId: supplyReviewFormId(actionSetup.id) } : {}), value: actionSetup.amount, changed: true, onChange: (value: string) => editCanvasAmount(actionSetup.id, value),
          canApply: Boolean((actionSetup.action === 'bridge' || Boolean(actionSetup.cryptoSelection && actionSelection(actionSetup.id, actionSetup.cryptoSelection).valid)) && (actionSetup.action !== 'bridge' || bridgeSelection(actionSetup.id, bridgeSetupNetworks(actionSetup)).valid) && pending?.valid && pending.authoringId === actionSetup.id && pending.authoringAmount === actionReviewValue(actionSetup, actionSetup.id, undefined) && pending.command.baseRevision === workflow.revision),
          onReview: () => reviewCanvasAmount(actionSetup.id), onApply: applyProposal } } : {}),
      } });
    for (const card of stocks.cards) projected.push({ id: card.id, type: 'workflow', position: card.position,
      ariaLabel: `Step ${projected.length + 1}: Stocks`, selected: selectedIds.includes(card.id) || selectedId === card.id,
      data: { composer: true, step: projected.length + 1, selected: selectedId === card.id, vertical: false,
        summary: { action: 'Stocks', provider: 'Robinhood', chain: stocks.network, amount: `${card.amount} ${card.equity}`, detail: undefined, bridgePair: undefined, linked: false, risk: undefined },
        validation: { findings: [], status: 'Draft', tone: 'neutral' },
        stocks: { equity: card.equity, amount: card.amount, onAmountChange: (amount: string) => stocks.edit(card.id, { amount }), onEquityChange: (equity: typeof card.equity) => stocks.edit(card.id, { equity }) },
        onOpenSettings: () => { selectNodes([card.id], card.id); openSettings?.(card.id); },
      } });
    return projected;
  }, [environment, workflow, actionSetup, amountInputs, bridgeNetworkInputs, cryptoSelections, editCryptoSelection, wallet.account, selectedId, selectedIds, context, canvasLayout, review, editCanvasAmount, editSwapSetupDirection, editBridgeNetworks, reviewCanvasAmount, cancelCanvasAmount, openSettings, pending, applyProposal, stocks]);
  // Live pointer positions stay in React Flow state; layout is committed on release.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(projectedNodes);
  useLayoutEffect(() => {
    setNodes(current => projectedNodes.map(node => {
      const previous = current.find(item => item.id === node.id);
      return previous?.measured ? { ...node, measured: previous.measured } : node;
    }));
  }, [projectedNodes, setNodes]);
  const edges = useMemo(() => composerConnections(workflow).map(edge => ({ ...edge,
    type: 'smoothstep', animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 'var(--edge-active)' : 'var(--edge-line)' },
    selected: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target,
    style: { stroke: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 'var(--edge-active)' : 'var(--edge-line)', strokeWidth: selectedEdge?.from === edge.source && selectedEdge?.to === edge.target ? 2.5 : 1.5 },
    labelStyle: { fontSize: 10, fill: 'var(--edge-label)' }, labelBgStyle: { fill: 'var(--page)' },
  })), [workflow, selectedEdge]);
  function addAction(action: CanvasAction | 'stocks') {
    if (action === 'stocks') {
      let slot = projectedNodes.length, position = defaultCanvasPosition(slot);
      while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) position = defaultCanvasPosition(++slot);
      const id = stocks.add(position);
      selectNodes([id], id);
      return;
    }
    if (actionSetup) { selectNodes([actionSetup.id], actionSetup.id); setFeedback('Configure this action before adding another.'); return; }
    if (action === 'pool' || action === 'swap' || action === 'bridge' || action === 'supply' || action === 'borrow' || action === 'repay' || action === 'withdraw' || action === 'transfer') {
      if (['supply', 'borrow', 'repay'].includes(action) && !wallet.account) { setFeedback('Connect your wallet to set the beneficiary before adding this action.'); return; }
      let slot = composerActions(workflow).length;
      let position = defaultCanvasPosition(slot);
      while (nodes.some(node => Math.abs(node.position.x - position.x) < 220 && Math.abs(node.position.y - position.y) < 140)) position = defaultCanvasPosition(++slot);
      const id = startActionSetup(action, position, wallet.account ?? undefined);
      selectNodes([id], id); setFeedback(''); return;
    }
    let command;
    try { command = canvasAddCommand(action, workflow.revision, wallet.account); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : 'Connect your wallet to add this action.'); return; }
    const preview = editorReducer(state, command, context);
    if (preview.error) {
      setFeedback(/ISOLATED|WORKFLOW_MUST_BE_EMPTY/.test(preview.error)
        ? 'This action requires a separate workflow. Use Supply → Borrow → Swap for the supported connected lending flow.'
        : 'This action could not be added. Check the workflow and try again.');
      return;
    }
    if (action === 'lending') { propose(command); return; }
    const added = preview.workflow.nodes.find(node => !workflow.nodes.some(existing => existing.nodeId === node.nodeId));
    if (!added) return;
    const nodeId = added.nodeId;
    let slot = projectedNodes.length;
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
    const stockIds = new Set(stocks.cards.map(card => card.id));
    for (const node of moved) if (stockIds.has(node.id)) stocks.edit(node.id, { position: node.position });
    const canonical = moved.filter(node => !stockIds.has(node.id));
    if (canonical.length) moveCanvasNodes(Object.fromEntries(canonical.map(node => [node.id, node.position])));
  }
  const duplicatePlan = actionSetup || Object.keys(amountInputs).length || stocks.cards.some(card => selectedIds.includes(card.id)) ? null : planCanvasDuplicate(workflow, canvasLayout, selectedIds, context);
  function duplicateSelection() {
    if (!duplicatePlan) return;
    duplicateCanvasNodes(selectedIdsRef.current);
    selectNodes(duplicatePlan.ids, duplicatePlan.ids.length === 1 ? duplicatePlan.ids[0]! : null);
  }
  function startMarquee(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.classList.contains('react-flow__pane')) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const origin = { x: event.clientX, y: event.clientY };
    let current = origin;
    const onMove = (move: MouseEvent) => {
      current = { x: move.clientX, y: move.clientY };
      setMarquee(canvasMarquee(surface.getBoundingClientRect(), origin, current));
    };
    const cleanup = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); marqueeCleanup.current = null; setMarquee(null); };
    const onUp = (up: MouseEvent) => {
      current = { x: up.clientX, y: up.clientY };
      cleanup();
      if (Math.abs(current.x - origin.x) < 4 && Math.abs(current.y - origin.y) < 4) return;
      ignorePaneClick.current = true;
      setTimeout(() => { ignorePaneClick.current = false; }, 0);
      const bounds = surface.getBoundingClientRect();
      const rectangle = canvasMarquee(bounds, origin, current);
      const box = { left: bounds.left + rectangle.left, right: bounds.left + rectangle.left + rectangle.width,
        top: bounds.top + rectangle.top, bottom: bounds.top + rectangle.top + rectangle.height };
      const ids = [...surface.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')]
        .filter(element => marqueeIntersects(box, element.getBoundingClientRect()))
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
  const deleteAllowed = Boolean(selectedId && selectedId === actionSetup?.id) || stocks.cards.some(card => card.id === selectedId) || canDeleteCanvasNode(workflow, selectedId);
  function deleteSelectedCard() {
    if (!selectedId || !deleteAllowed) return;
    if (stocks.cards.some(card => card.id === selectedId)) { stocks.remove([selectedId]); selectNodes([], null); return; }
    if (selectedId === actionSetup?.id) { removeActionSetup(); selectNodes([], null); return; }
    dispatch({ type: 'REMOVE', nodeId: selectedId, source: 'CANVAS', baseRevision: workflow.revision });
    selectNodes(selectedIdsRef.current.filter(id => id !== selectedId), null);
  }
  const dockButton = <button type="button" className="toolbox-mode-toggle" title={tr(toolboxMode === 'top' ? 'Undock toolbar' : 'Dock toolbar')} aria-label={tr(toolboxMode === 'top' ? 'Undock toolbar' : 'Dock toolbar')} aria-pressed={toolboxMode === 'floating'} onClick={() => changeToolboxMode(toolboxMode === 'top' ? 'floating' : 'top')}><DockIcon floating={toolboxMode === 'floating'}/></button>;
  const toolbox = <div className="canvas-toolbox" role="toolbar" aria-label={tr("Canvas tools")}>
    <div className="canvas-primary-tools" role="group" aria-label={tr("Workflow actions")}>
    {actions.map(action => <button key={action} type="button"
      title={tr(action === 'stocks' ? 'Stocks' : action === 'lending' ? 'Add Aave Supply → Aave Borrow → Uniswap Swap' : action === 'swap' || action === 'supply' || action==='borrow' || action==='repay' || action==='withdraw' ? 'Add ' + action : 'Add ' + actionLabel(action))}
      aria-label={tr(action === 'stocks' ? 'Stocks' : action==='lending'?'Add Supply → Borrow → Swap':'Add ' + action)} disabled={action==='lending'&&isLendingComposition(workflow)} onClick={() => addAction(action)}><ActionIcon action={action}/><span>{tr(actionLabel(action))}</span></button>)}
    <button type="button" disabled aria-label={tr("Privacy")} title={tr("Privacy · not available yet")}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/></svg><span>{tr("Privacy")}</span>
    </button>
    </div>
    <div className="canvas-utility-tools" role="group" aria-label={tr("Workflow utilities")}>
    <span className="toolbox-divider" aria-hidden="true"/>
    <button type="button" title={tr("Duplicate selection")} aria-label={tr("Duplicate selection")} disabled={!duplicatePlan} onClick={duplicateSelection}><DuplicateIcon/><span>{tr("Duplicate")}</span></button>
    <button type="button" title={tr("Undo (Ctrl+Z)")} aria-label={tr("Undo")} disabled={!canUndo} onClick={undo}><HistoryIcon direction="undo"/><span>{tr("Undo")}</span></button>
    <button type="button" title={tr("Redo (Ctrl+Shift+Z or Ctrl+Y)")} aria-label={tr("Redo")} disabled={!canRedo} onClick={redo}><HistoryIcon direction="redo"/><span>{tr("Redo")}</span></button>
    <button type="button" aria-label={tr("Delete")} title={tr(deleteAllowed ? 'Delete' : selectedId ? 'This card is required by the workflow or protected.' : 'Select a card to delete')} disabled={!deleteAllowed} onClick={deleteSelectedCard}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>{tr("Delete")}</span>
    </button>
    {tr(toolboxMode === 'top' && dockButton)}
    </div>
  </div>;
  return <section className={`canvas panel ${isLendingComposition(workflow)?'lending-canvas':''}`} tabIndex={-1} aria-label={tr("Workflow canvas")}>
    <div className="canvas-head build-canvas-head"><WorkflowName name={workflowName} rename={renameWorkflow}
      onSave={onSave}/><div className={toolboxMode === 'top' ? 'canvas-toolbar-row' : 'canvas-toolbar-utilities'}>{tr(toolboxMode === 'top' && toolbox)}{tr(toolboxMode === 'floating' && dockButton)}<span className="revision">{tr(projectedNodes.length)} {tr(projectedNodes.length === 1 ? 'action' : 'actions')}</span></div></div>
    {feedback && <p className="canvas-feedback" role="status">{tr(feedback)}</p>}
    <div ref={surfaceRef} className="flow-surface build-flow-surface" role="region" aria-label={tr("Workflow graph")} onMouseDown={startMarquee}>
      <ReactFlow key={isLendingComposition(workflow)?'lending':'general'} nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={(changes: NodeChange<Node>[]) => onNodesChange(changes.filter(change => change.type !== 'select'))} fitView fitViewOptions={{ padding: COMPOSER_FIT_PADDING }} minZoom={0.35} maxZoom={1.4}
        nodesDraggable nodesConnectable={false} deleteKeyCode={null} selectNodesOnDrag={false} panOnDrag={[1, 2]} {...CANVAS_GESTURES}
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
        {isLendingComposition(workflow)&&<LendingCanvasViewport/>}
        <Background gap={18} size={1} color="var(--grid)" /><DarkSpotlight/><CanvasNavigator fitViewOptions={{ padding: COMPOSER_FIT_PADDING }}/>
      </ReactFlow>
      <WorkflowEditReview/>
      {projectedNodes.length === 0 && <div className="canvas-empty">
        <span className="canvas-empty-mascot" aria-hidden="true">
          <Image className="flofi-droplet-wave-light" src="/brand/flofi-droplet-wave.svg" alt={tr("")} width={400} height={400} draggable={false} unoptimized/>
          <Image className="flofi-droplet-wave-dark" src="/brand/flofi-droplet-wave-dark.svg" alt={tr("")} width={400} height={400} draggable={false} unoptimized/>
        </span>
        <strong>{tr("Start your workflow")}</strong><p>{tr("Add an action from the toolbar, then select its card to configure it.")}</p>
      </div>}
      {marquee && marquee.width >= 4 && marquee.height >= 4 && <div className="canvas-marquee" aria-hidden="true" style={marquee}/>}
      {toolboxMode === 'floating' && <div className="floating-toolbox">{tr(toolbox)}</div>}
      {primaryAction && <div className="canvas-primary-action">{primaryAction}</div>}
    </div>
    <div className="canvas-foot"><span>{tr(isLendingComposition(workflow)?'Supply → Borrow → Swap · HF ≥ 2 policy checkpoint':'Step numbers show workflow order. Dragging changes layout only.')}</span><span>{tr(isLendingComposition(workflow)?'Select each step to edit. Approvals appear only in the execution plan.':'Arrows show linked steps. Select a step to edit below.')}</span></div>
  </section>;
}

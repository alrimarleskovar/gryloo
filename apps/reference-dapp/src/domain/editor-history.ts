// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { validateSavedWorkflow } from './saved-workflow';
import {isLendingComposition,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import type { Command } from './commands';
import { directions, type Direction } from './swap-authoring';
import { routerDetails } from './router-authoring';
import type { UniswapLiquidityInput } from './uniswap-liquidity-authoring';
import { validCryptoSelection, canSelectCryptoAssets, cryptoInputOf, type CryptoSelection, type CryptoSelections } from './crypto-action-picker';
import { actionReviewValue } from './canvas-action-setup';
import type { CanvasLayout } from './canvas-layout';
import { editorReducer, initialEditor, type EditorState } from './editor';
import { freeze, type Workflow } from './initial-workflow';
import { canEditCanvasAmount, canvasAmountCommand, amountCommandTarget, bridgeSetupNetworks, CANVAS_BRIDGE_NETWORK_OPTIONS, type CanvasActionSetup, type CanvasAmountInputs, type CanvasBridgeNetworks, type CanvasBridgeNetworkInputs } from './canvas-action-setup';

type Snapshot = { readonly workflow: Workflow; readonly layout: CanvasLayout; readonly actionSetup: CanvasActionSetup | null; readonly amountInputs: CanvasAmountInputs; readonly bridgeNetworkInputs: CanvasBridgeNetworkInputs; readonly cryptoSelections: CryptoSelections };
export type EditorHistory = { readonly editor: EditorState; readonly layout: CanvasLayout;
  readonly actionSetup: CanvasActionSetup | null; readonly amountInputs: CanvasAmountInputs; readonly setupSerial: number;
  readonly bridgeNetworkInputs: CanvasBridgeNetworkInputs;
  readonly cryptoSelections: CryptoSelections;
  readonly past: readonly Snapshot[]; readonly future: readonly Snapshot[] };
export type HistoryAction =
  | { readonly type: 'EDIT_CRYPTO_SELECTION'; readonly id: string; readonly selection: CryptoSelection; readonly context: ReviewContext; readonly beneficiary?: string }
  | { readonly type: 'RESTORE_WORKFLOW'; readonly workflow: SemanticWorkflow }
  | { readonly type: 'ADOPT_DRAFT_IDENTITY'; readonly workflowId: string }
  | { readonly type: 'RESTORE_LENDING_CANVAS'; readonly workflow: SemanticWorkflow }
  | { readonly type: 'COMMAND'; readonly command: Command; readonly context: ReviewContext; readonly position?: { x: number; y: number }; readonly authoringId?: string; readonly authoringAmount?: string }
  | { readonly type: 'START_ACTION_SETUP'; readonly action: CanvasActionSetup['action']; readonly position: { x: number; y: number }; readonly beneficiary?: string }
  | { readonly type: 'EDIT_POOL_SETUP'; readonly id: string; readonly input: UniswapLiquidityInput }
  | { readonly type: 'EDIT_SWAP_SETUP_DIRECTION'; readonly id: string; readonly direction: Direction }
  | { readonly type: 'EDIT_BRIDGE_NETWORKS'; readonly id: string; readonly patch: Partial<CanvasBridgeNetworks>; readonly context: ReviewContext }
  | { readonly type: 'EDIT_CANVAS_AMOUNT'; readonly id: string; readonly amount: string; readonly context: ReviewContext }
  | { readonly type: 'CANCEL_CANVAS_AMOUNT'; readonly id: string }
  | { readonly type: 'REMOVE_ACTION_SETUP' }
  | { readonly type: 'MOVE'; readonly positions: Readonly<Record<string, { x: number; y: number }>> }
  | { readonly type: 'DUPLICATE'; readonly nodeIds: readonly string[]; readonly context: ReviewContext }
  | { readonly type: 'LOAD_LAYOUT'; readonly layout: CanvasLayout }
  | { readonly type: 'UNDO' }
  | { readonly type: 'REDO' };

export const initialEditorHistory = (): EditorHistory => ({ editor: initialEditor(), layout: {}, actionSetup: null, amountInputs: {}, bridgeNetworkInputs: {}, cryptoSelections: {}, setupSerial: 0, past: [], future: [] });
const snapshot = (state: EditorHistory): Snapshot => ({ workflow: state.editor.workflow, layout: state.layout, actionSetup: state.actionSetup, amountInputs: state.amountInputs, bridgeNetworkInputs: state.bridgeNetworkInputs, cryptoSelections: state.cryptoSelections });

export function planCanvasDuplicate(workflow: Workflow, layout: CanvasLayout, nodeIds: readonly string[], context: ReviewContext) {
  const selected = new Set(nodeIds);
  const sources = workflow.nodes.filter(node => selected.has(node.nodeId) &&
    (node.actionType.startsWith('mock-') || (node.actionType === 'asset.swap.exact-input' &&
      !node.dependencies.length && !node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE'))));
  if (!sources.length || workflow.nodes.length + sources.length > 1024 || workflow.revision === Number.MAX_SAFE_INTEGER) return null;
  const next = Math.max(9000000000000000, ...workflow.nodes.flatMap(node => /^node-\d{3,16}$/.test(node.nodeId)
    ? [Number(node.nodeId.slice(5))] : []));
  if (next + sources.length > Number.MAX_SAFE_INTEGER) return null;
  const ids = sources.map((_, index) => `node-${next + index + 1}`);
  const copies = new Map(sources.map((node, index) => [node.nodeId, ids[index]!]));
  const nodes: Workflow['nodes'][number][] = sources.map(node => {
    const inputs: Workflow['nodes'][number]['inputs'][number][] = [];
    for (const input of node.inputs) {
      if (input.kind !== 'OUTPUT_REFERENCE') inputs.push(input);
      else if (copies.has(input.value.nodeId)) inputs.push({ ...input,
        value: { ...input.value, nodeId: copies.get(input.value.nodeId)! } });
    }
    return { ...node, nodeId: copies.get(node.nodeId)!,
      dependencies: node.dependencies.flatMap(id => copies.has(id) ? [copies.get(id)!] : []), inputs };
  });
  const resourceEdges = workflow.resourceEdges.filter(edge => copies.has(edge.fromNodeId) && copies.has(edge.toNodeId))
    .map(edge => ({ ...edge, fromNodeId: copies.get(edge.fromNodeId)!, toNodeId: copies.get(edge.toNodeId)! }));
  const candidate = { ...workflow, revision: workflow.revision + 1,
    nodes: [...workflow.nodes, ...nodes], resourceEdges: [...workflow.resourceEdges, ...resourceEdges] };
  try { validateAuthoringWorkflow(candidate, context); } catch { return null; }
  const duplicateLayout = { ...layout };
  for (const [index, node] of sources.entries()) {
    const sourcePosition = layout[node.nodeId]?.actionType === node.actionType
      ? layout[node.nodeId]! : { x: 85 + (workflow.nodes.indexOf(node) % 3) * 270,
        y: 90 + Math.floor(workflow.nodes.indexOf(node) / 3) * 190, actionType: node.actionType };
    duplicateLayout[ids[index]!] = { ...sourcePosition, x: sourcePosition.x + 36, y: sourcePosition.y + 36 };
  }
  return { workflow: freeze(candidate), layout: duplicateLayout, ids };
}

export function editorHistoryReducer(state: EditorHistory, action: HistoryAction): EditorHistory {
  if (action.type === 'START_ACTION_SETUP') {
    // Configure one new action at a time so the existing canonical sequence never changes on acceptance.
    if (state.actionSetup || !Number.isFinite(action.position.x) || !Number.isFinite(action.position.y) || (['supply', 'borrow', 'repay'].includes(action.action) && !action.beneficiary)) return state;
    const id = `action-setup-${state.setupSerial + 1}`;
    let actionSetup: CanvasActionSetup;
    if (action.action === 'pool') actionSetup = { id, action: 'pool', amount: '0', input: {
      network: 'Base Sepolia', maxUsdc: '0', maxWeth: '0', rangeUnit: 'TICK', lower: '-887270', upper: '887270', slippage: '50',
    } };
    else if (action.action === 'transfer') actionSetup = { id, action: 'transfer', amount: '0', cryptoSelection: { action: 'transfer', network: 'Robinhood Chain Testnet', from: 'ETH' } };
    else if (action.action === 'supply' || action.action === 'borrow' || action.action === 'repay')
      actionSetup = { id, action: action.action, amount: '0', beneficiary: action.beneficiary! };
    else actionSetup = { id, action: action.action, amount: '0' };
    return { ...state, actionSetup, setupSerial: state.setupSerial + 1,
      layout: { ...state.layout, [id]: { ...action.position, actionType: action.action === 'swap' ? 'asset.swap.exact-input' : action.action === 'bridge' ? 'asset.bridge' : action.action } },
      past: [...state.past, snapshot(state)], future: [] };
  }
  if (action.type === 'EDIT_CRYPTO_SELECTION') {
    if (!validCryptoSelection(action.selection)) return state;
    const setup = state.actionSetup?.id === action.id ? state.actionSetup : null;
    const node = state.editor.workflow.nodes.find(node => node.nodeId === action.id);
    if (setup ? setup.action !== action.selection.action : !node || !canSelectCryptoAssets(node, state.editor.workflow) || cryptoInputOf(node)?.selection.action !== action.selection.action) return state;
    const current = setup?.cryptoSelection ?? state.cryptoSelections[action.id];
    if (JSON.stringify(current) === JSON.stringify(action.selection)) return state;
    const changedNetwork = current?.network !== action.selection.network;
    const poolInput = setup?.action === 'pool' && changedNetwork ? { ...setup.input, rangeUnit: 'TICK' as const,
      lower: action.selection.network === 'Solana Devnet' ? '-443584' : action.selection.network === 'Ethereum Sepolia' ? '-887220' : '-887270', upper: action.selection.network === 'Solana Devnet' ? '443584' : action.selection.network === 'Ethereum Sepolia' ? '887220' : '887270' } : null;
    return { ...state, ...(setup ? { actionSetup: { ...setup, cryptoSelection: action.selection, ...(action.beneficiary ? { cryptoBeneficiary: action.beneficiary } : {}), ...(poolInput ? { input: poolInput } : {}) } as CanvasActionSetup } : {
      cryptoSelections: { ...state.cryptoSelections, [action.id]: action.selection },
      amountInputs: { ...state.amountInputs, [action.id]: state.amountInputs[action.id] ?? cryptoInputOf(node!)!.amount },
    }), past: [...state.past, snapshot(state)], future: [] };
  }
  if (action.type === 'EDIT_BRIDGE_NETWORKS') {
    if (!Object.keys(action.patch).length || Object.keys(action.patch).some(key => key !== 'source' && key !== 'destination') ||
      (action.patch.source !== undefined && !CANVAS_BRIDGE_NETWORK_OPTIONS.source.includes(action.patch.source)) ||
      (action.patch.destination !== undefined && !CANVAS_BRIDGE_NETWORK_OPTIONS.destination.includes(action.patch.destination))) return state;
    const setup = state.actionSetup?.id === action.id && state.actionSetup.action === 'bridge' ? state.actionSetup : null;
    const node = state.editor.workflow.nodes.find(node => node.nodeId === action.id), router = node ? routerDetails(node) : null;
    if (!setup && (!node || !router || !canEditCanvasAmount(node, action.context, state.editor.workflow))) return state;
    const current = setup ? bridgeSetupNetworks(setup) : state.bridgeNetworkInputs[action.id] ?? router!;
    const networks = { source: action.patch.source ?? current.source, destination: action.patch.destination ?? current.destination };
    if (networks.source === current.source && networks.destination === current.destination) return state;
    return { ...state, ...(setup ? { actionSetup: { ...setup, networks } } : {
      bridgeNetworkInputs: { ...state.bridgeNetworkInputs, [action.id]: networks },
      amountInputs: { ...state.amountInputs, [action.id]: state.amountInputs[action.id] ?? router!.amount },
    }), past: [...state.past, snapshot(state)], future: [] };
  }
  if (action.type === 'EDIT_SWAP_SETUP_DIRECTION') {
    if (state.actionSetup?.id !== action.id || state.actionSetup.action !== 'swap' || !directions.includes(action.direction) || (state.actionSetup.direction ?? 'USDC_TO_WETH') === action.direction) return state;
    return { ...state, actionSetup: { ...state.actionSetup, direction: action.direction }, past: [...state.past, snapshot(state)], future: [] };
  }
  if (action.type === 'EDIT_POOL_SETUP') {
    if (state.actionSetup?.id !== action.id || state.actionSetup.action !== 'pool') return state;
    return { ...state, actionSetup: { ...state.actionSetup, input: action.input }, future: [] };
  }
  if (action.type === 'EDIT_CANVAS_AMOUNT') {
    if (state.actionSetup?.id === action.id) return { ...state, actionSetup: { ...state.actionSetup, amount: action.amount }, future: [] };
    const node = state.editor.workflow.nodes.find(item => item.nodeId === action.id);
    if (!node || !canEditCanvasAmount(node, action.context, state.editor.workflow)) return state;
    return { ...state, amountInputs: { ...state.amountInputs, [action.id]: action.amount },
      past: state.amountInputs[action.id] === undefined ? [...state.past, snapshot(state)] : state.past, future: [] };
  }
  if (action.type === 'CANCEL_CANVAS_AMOUNT') {
    const amountInputs = { ...state.amountInputs }; delete amountInputs[action.id];
    const bridgeNetworkInputs = { ...state.bridgeNetworkInputs }; delete bridgeNetworkInputs[action.id];
    const cryptoSelections = { ...state.cryptoSelections }; delete cryptoSelections[action.id];
    return { ...state, amountInputs, bridgeNetworkInputs, cryptoSelections, future: [] };
  }
  if (action.type === 'REMOVE_ACTION_SETUP') {
    if (!state.actionSetup) return state;
    const layout = { ...state.layout }; delete layout[state.actionSetup.id];
    return { ...state, actionSetup: null, layout, past: [...state.past, snapshot(state)], future: [] };
  }
  // An external proposal is composed on the initial draft. Only an untouched draft (revision 0) takes that draft's identity, so the
  // applied proposal hashes exactly to the proposal; any authored draft keeps its own identity and stays a mismatch.
  if (action.type === 'ADOPT_DRAFT_IDENTITY') {
    const workflow = state.editor.workflow;
    if (workflow.revision !== 0 || workflow.workflowId === action.workflowId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(action.workflowId)) return state;
    return { ...state, editor: { ...state.editor, workflow: freeze({ ...structuredClone(workflow), workflowId: action.workflowId }) } };
  }
  if (action.type === 'RESTORE_WORKFLOW') {
    try {
      const workflow = validateSavedWorkflow(action.workflow);
      return { ...initialEditorHistory(), editor: { workflow: freeze(structuredClone(workflow)), error: null } };
    } catch { return state; }
  }
  if(action.type==='RESTORE_LENDING_CANVAS') {
    // Restore only the untouched initial Canvas from a validated durable run.
    // Preserve its exact IR/revision; this creates no Review or execution authority.
    if(state.actionSetup||Object.keys(state.amountInputs).length||state.editor.workflow.revision!==0||state.past.length||!state.editor.workflow.nodes.every(n=>n.actionType.startsWith('mock-')))return state;
    try {
      const workflow=validateAuthoringWorkflow(action.workflow,createBaseSepoliaReviewContext());
      if(!isLendingComposition(workflow))return state;
      return {...state,editor:{workflow:freeze(workflow),error:null},layout:{},past:[],future:[]};
    } catch {return state;}
  }
  if (action.type === 'LOAD_LAYOUT') return { ...state, layout: action.layout };
  if (action.type === 'DUPLICATE') {
    if (state.actionSetup || Object.keys(state.amountInputs).length) return state;
    const result = planCanvasDuplicate(state.editor.workflow, state.layout, action.nodeIds, action.context);
    return result ? { ...state, editor: { workflow: result.workflow, error: null }, layout: result.layout,
      past: [...state.past, snapshot(state)], future: [] } : state;
  }
  if (action.type === 'UNDO' || action.type === 'REDO') {
    const source = action.type === 'UNDO' ? state.past : state.future;
    const target = source.at(-1);
    if (!target) return state;
    const current = snapshot(state);
    // A restored semantic edit is a fresh revision, so old review and execution artifacts cannot become current again.
    const semantic = target.workflow.nodes !== current.workflow.nodes
      || target.workflow.resourceEdges !== current.workflow.resourceEdges;
    if (semantic && current.workflow.revision === Number.MAX_SAFE_INTEGER) return state;
    const workflow = semantic ? freeze({ ...target.workflow, revision: current.workflow.revision + 1 }) : current.workflow;
    return { ...state, editor: { workflow, error: null }, layout: target.layout, actionSetup: target.actionSetup, amountInputs: target.amountInputs, bridgeNetworkInputs: target.bridgeNetworkInputs, cryptoSelections: target.cryptoSelections,
      past: action.type === 'UNDO' ? state.past.slice(0, -1) : [...state.past, current],
      future: action.type === 'REDO' ? state.future.slice(0, -1) : [...state.future, current] };
  }
  if (action.type === 'MOVE') {
    const layout = { ...state.layout };
    let changed = false;
    for (const [id, position] of Object.entries(action.positions)) {
      const node = state.editor.workflow.nodes.find(item => item.nodeId === id) ?? (state.actionSetup?.id === id
        ? { actionType: state.actionSetup.action === 'swap' ? 'asset.swap.exact-input' : state.actionSetup.action === 'bridge' ? 'asset.bridge' : state.actionSetup.action } : undefined);
      if (!node || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
      const before = layout[id];
      if (before?.x === position.x && before?.y === position.y) continue;
      layout[id] = { ...position, actionType: node.actionType };
      changed = true;
    }
    return changed ? { ...state, layout, past: [...state.past, snapshot(state)], future: [] } : state;
  }
  if (action.authoringId) {
    const amount = actionReviewValue(state.actionSetup, action.authoringId, state.amountInputs[action.authoringId], state.bridgeNetworkInputs[action.authoringId], state.cryptoSelections[action.authoringId]);
    if (amount === undefined || amount !== action.authoringAmount) return state;
    if (state.actionSetup?.id === action.authoringId) {
      try {
        if (JSON.stringify(canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, action.authoringId, action.context, state.bridgeNetworkInputs, state.cryptoSelections)) !== JSON.stringify(action.command)) return state;
      } catch { return state; }
    } else {
      const target = amountCommandTarget(action.command, state.editor.workflow, action.authoringId);
      if (target?.id !== action.authoringId || target.amount !== state.amountInputs[action.authoringId]) return state;
      const selection = state.cryptoSelections[action.authoringId];
      if (selection && (action.command.type !== 'SET_CRYPTO_ACTION' || JSON.stringify(action.command.input.selection) !== JSON.stringify(selection))) return state;
      const networks = state.bridgeNetworkInputs[action.authoringId];
      if (networks && (action.command.type !== 'SET_ROUTER_BRIDGE' || action.command.input.source !== networks.source || action.command.input.destination !== networks.destination)) return state;
    }
  }
  const editor = editorReducer(state.editor, action.command, action.context);
  if (editor.error) return { ...state, editor };
  const amountInputs = { ...state.amountInputs };
  const bridgeNetworkInputs = { ...state.bridgeNetworkInputs };
  const cryptoSelections = { ...state.cryptoSelections };
  if (action.authoringId) delete cryptoSelections[action.authoringId];
  if (action.authoringId) delete amountInputs[action.authoringId];
  if (action.authoringId) delete bridgeNetworkInputs[action.authoringId];
  for (const id of Object.keys(amountInputs)) {
    const node = editor.workflow.nodes.find(node => node.nodeId === id);
    if (!node || !canEditCanvasAmount(node, action.context, state.editor.workflow)) delete amountInputs[id];
  }
  for (const id of Object.keys(bridgeNetworkInputs)) {
    if (amountInputs[id] === undefined || !editor.workflow.nodes.some(node => node.nodeId === id && routerDetails(node))) delete bridgeNetworkInputs[id];
  }
  for (const id of Object.keys(cryptoSelections)) {
    const node = editor.workflow.nodes.find(node => node.nodeId === id);
    if (!node || !canSelectCryptoAssets(node, editor.workflow)) delete cryptoSelections[id];
  }
  const actionSetup = state.actionSetup?.id === action.authoringId ? null : state.actionSetup;
  if (editor.workflow === state.editor.workflow && actionSetup === state.actionSetup && Object.keys(amountInputs).length === Object.keys(state.amountInputs).length) return { ...state, editor };
  let layout = state.layout;
  const position = action.position ?? (state.actionSetup && state.actionSetup.id === action.authoringId ? state.layout[state.actionSetup.id] : undefined);
  if (position) {
    const added = editor.workflow.nodes.find(node => !state.editor.workflow.nodes.some(previous => previous.nodeId === node.nodeId));
    if (added) layout = { ...layout, [added.nodeId]: { ...position, actionType: added.actionType } };
  }
  if (state.actionSetup && !actionSetup) { const nextLayout = { ...layout }; delete nextLayout[state.actionSetup.id]; layout = nextLayout; }
  return { ...state, editor, layout, actionSetup, amountInputs, bridgeNetworkInputs, cryptoSelections, past: [...state.past, snapshot(state)], future: [] };
}

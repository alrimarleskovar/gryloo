// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';
import type { Command } from './commands';
import { canvasAddCommand } from './canvas-authoring';
import { swapDetails } from './swap-authoring';
import { createRouterNode, routerDetails, routerInputOf } from './router-authoring';
import { createBridgeNode, bridgeDetails } from './bridge-authoring';
import { shellChainLabel } from './product-shell';
import { editorReducer, type EditorState } from './editor';

/** Required-field authoring only, never an executable node or alternate workflow. */
export type CanvasActionSetup = { readonly id: string; readonly action: 'swap' | 'bridge'; readonly amount: string };
export type CanvasAmountInputs = Readonly<Record<string, string>>;

export function amountCommandTarget(command: Command) {
  if (command.type === 'SET_SWAP_AMOUNT') return { id: command.nodeId, amount: command.amount };
  if (command.type === 'SET_ROUTER_BRIDGE' || command.type === 'SET_BRIDGE') return { id: command.nodeId, amount: command.input.amount };
  return null;
}

export function canvasAuthoringIncomplete(setup: CanvasActionSetup | null, inputs: CanvasAmountInputs) {
  return setup !== null || Object.keys(inputs).length > 0;
}

export function canEditCanvasAmount(node: Workflow['nodes'][number], context: ReviewContext) {
  return !node.lockedParameters.length && Boolean(swapDetails(node, context) || routerDetails(node) ||
    (bridgeDetails(node) && !node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE') && !node.dependencies.length));
}

export function canvasAmountCommand(state: EditorState, setup: CanvasActionSetup | null, inputs: CanvasAmountInputs, id: string, context: ReviewContext) {
  let command: Command;
  if (setup?.id === id) command = canvasAddCommand(setup.action, state.workflow.revision, null, setup.amount);
  else {
    const node = state.workflow.nodes.find(item => item.nodeId === id);
    if (!node || !canEditCanvasAmount(node, context) || inputs[id] === undefined) throw new Error('Select an editable action.');
    const amount = inputs[id];
    const base = { nodeId: id, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
    const router = routerDetails(node), bridge = bridgeDetails(node);
    command = router ? { ...base, type: 'SET_ROUTER_BRIDGE', input: { ...routerInputOf(router), amount } }
      : bridge ? { ...base, type: 'SET_BRIDGE', input: { amount, slippageBps: String(bridge.slippageBps) } }
        : { ...base, type: 'SET_SWAP_AMOUNT', amount };
  }
  // Surface the existing constructor's field error before the command guard reduces it to INVALID_COMMAND.
  if (command.type === 'ADD_ROUTER_BRIDGE' || command.type === 'SET_ROUTER_BRIDGE') createRouterNode('node-preview', command.input);
  if (command.type === 'SET_BRIDGE') createBridgeNode('node-preview', command.input);
  const preview = editorReducer(state, command, context);
  if (preview.error) throw new Error(preview.error);
  // An unfinished new card must never silently replace already-authored actions on acceptance.
  if (setup?.id === id && state.workflow.nodes.some(node => !node.actionType.startsWith('mock-') &&
    !preview.workflow.nodes.some(candidate => candidate.nodeId === node.nodeId))) throw new Error('ACTION_REQUIRES_SEPARATE_WORKFLOW');
  return command;
}

export function canvasAmountMessage(cause: unknown) {
  const code = cause instanceof Error ? cause.message : '';
  if (/AMOUNT|PRECISION/.test(code)) return 'Enter a valid amount greater than 0.';
  if (/LOCK|PROTECTED/.test(code)) return 'This amount is protected.';
  if (/STALE/.test(code)) return 'The workflow changed. Review this amount again.';
  return 'This action cannot be combined with the current workflow. Check its settings or use a separate workflow.';
}

/** Known authoring choices, without manufacturing a temporary canonical action. */
export function setupSummary(setup: CanvasActionSetup, context: ReviewContext) {
  return { action: setup.action === 'swap' ? 'Swap' : 'Bridge',
    provider: setup.action === 'swap' ? 'Uniswap' : 'Router',
    chain: setup.action === 'swap' ? shellChainLabel(context.assets.USDC.asset.chainId) : 'Base Sepolia → Arbitrum Sepolia',
    amount: `${setup.amount || '0'} USDC`, detail: setup.action === 'swap' ? 'USDC → WETH' : undefined,
    bridgePair: setup.action === 'bridge' ? 'USDC → USDC' : undefined, linked: false, risk: undefined };
}

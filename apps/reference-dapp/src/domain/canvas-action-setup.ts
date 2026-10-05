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
import { createAuthoredSupply, createAuthoredBorrow, createAuthoredRepay, createAuthoredWithdraw, supplyDetails, borrowDetails, repayDetails, withdrawDetails } from './supply-authoring';
import { lendingDetails, lendingNodeInput } from './lending-authoring';
import { singleAmountProposalTarget } from './composer-presentation';

/** Required-field authoring only, never an executable node or alternate workflow. */
export type CanvasActionSetup = { readonly id: string; readonly amount: string } &
  ({ readonly action: 'swap' | 'bridge' | 'withdraw' } | { readonly action: 'supply' | 'borrow' | 'repay'; readonly beneficiary: string });
export type CanvasAmountInputs = Readonly<Record<string, string>>;

export function amountCommandTarget(command: Command, workflow?: Workflow, preferredId?: string) {
  if (command.type === 'SET_SWAP_AMOUNT') return { id: command.nodeId, amount: command.amount };
  if (command.type === 'SET_ROUTER_BRIDGE' || command.type === 'SET_BRIDGE') return { id: command.nodeId, amount: command.input.amount };
  if (command.type === 'SET_SUPPLY' || command.type === 'SET_BORROW' || command.type === 'SET_REPAY' || command.type === 'SET_WITHDRAW') return { id: command.nodeId, amount: command.input.amount };
  if (command.type === 'AUTHOR_LENDING' && workflow) {
    const id = singleAmountProposalTarget(workflow, command, preferredId);
    if (id) return { id, amount: id === 'lending-supply' ? command.input.supply : command.input.borrow };
  }
  return null;
}

export function canvasAuthoringIncomplete(setup: CanvasActionSetup | null, inputs: CanvasAmountInputs) {
  return setup !== null || Object.keys(inputs).length > 0;
}

export function canEditCanvasAmount(node: Workflow['nodes'][number], context: ReviewContext, workflow?: Workflow) {
  if (node.lockedParameters.length) return false;
  if (workflow && lendingDetails(workflow) && ['lending-supply', 'lending-borrow'].includes(node.nodeId)) return true;
  return Boolean(supplyDetails(node as Parameters<typeof supplyDetails>[0]) || borrowDetails(node as Parameters<typeof borrowDetails>[0]) || repayDetails(node as Parameters<typeof repayDetails>[0]) || withdrawDetails(node as Parameters<typeof withdrawDetails>[0]) || swapDetails(node, context) || routerDetails(node) ||
    (bridgeDetails(node) && !node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE') && !node.dependencies.length));
}

export function canvasAmountCommand(state: EditorState, setup: CanvasActionSetup | null, inputs: CanvasAmountInputs, id: string, context: ReviewContext) {
  let command: Command;
  if (setup?.id === id) command = canvasAddCommand(setup.action, state.workflow.revision, 'beneficiary' in setup ? setup.beneficiary : null, setup.amount);
  else {
    const node = state.workflow.nodes.find(item => item.nodeId === id);
    if (!node || !canEditCanvasAmount(node, context, state.workflow) || inputs[id] === undefined) throw new Error('Select an editable action.');
    const amount = inputs[id];
    const base = { nodeId: id, source: 'CANVAS' as const, baseRevision: state.workflow.revision };
    const lending = lendingDetails(state.workflow);
    const router = routerDetails(node), bridge = bridgeDetails(node), supply = lending ? null : supplyDetails(node as Parameters<typeof supplyDetails>[0]), borrow = lending ? null : borrowDetails(node as Parameters<typeof borrowDetails>[0]), repay = repayDetails(node as Parameters<typeof repayDetails>[0]), withdraw = withdrawDetails(node as Parameters<typeof withdrawDetails>[0]);
    command = lending && (id === 'lending-supply' || id === 'lending-borrow')
      ? { type: 'AUTHOR_LENDING', input: lendingNodeInput(state.workflow, id, amount), source: 'CANVAS', baseRevision: state.workflow.revision }
      : borrow ? { ...base, type: 'SET_BORROW', input: { ...borrow, amount } }
      : repay ? { ...base, type: 'SET_REPAY', input: { ...repay, amount } }
      : withdraw ? { ...base, type: 'SET_WITHDRAW', input: { ...withdraw, amount } }
      : supply ? { ...base, type: 'SET_SUPPLY', input: { ...supply, amount } }
      : router ? { ...base, type: 'SET_ROUTER_BRIDGE', input: { ...routerInputOf(router), amount } }
      : bridge ? { ...base, type: 'SET_BRIDGE', input: { amount, slippageBps: String(bridge.slippageBps) } }
        : { ...base, type: 'SET_SWAP_AMOUNT', amount };
  }
  // Surface the existing constructor's field error before the command guard reduces it to INVALID_COMMAND.
  if (command.type === 'ADD_ROUTER_BRIDGE' || command.type === 'SET_ROUTER_BRIDGE') createRouterNode('node-preview', command.input);
  if (command.type === 'SET_BRIDGE') createBridgeNode('node-preview', command.input);
  if (command.type === 'SET_SUPPLY' || command.type === 'ADD_SUPPLY') createAuthoredSupply('node-preview', command.input);
  if (command.type === 'SET_BORROW' || command.type === 'ADD_BORROW') createAuthoredBorrow('node-preview', command.input);
  if (command.type === 'SET_REPAY' || command.type === 'ADD_REPAY') createAuthoredRepay('node-preview', command.input);
  if (command.type === 'SET_WITHDRAW' || command.type === 'ADD_WITHDRAW') createAuthoredWithdraw('node-preview', command.input);
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
  return { action: setup.action === 'swap' ? 'Swap' : setup.action === 'bridge' ? 'Bridge' : setup.action[0]!.toUpperCase() + setup.action.slice(1),
    provider: setup.action === 'swap' ? 'Uniswap' : setup.action === 'bridge' ? 'Router' : 'Aave V3',
    chain: setup.action === 'swap' ? shellChainLabel(context.assets.USDC.asset.chainId) : setup.action === 'bridge' ? 'Base Sepolia → Arbitrum Sepolia' : 'Base Sepolia',
    amount: `${setup.amount || '0'} USDC`, detail: setup.action === 'swap' ? 'USDC → WETH' : undefined,
    bridgePair: setup.action === 'bridge' ? 'USDC → USDC' : undefined, linked: false, risk: undefined };
}

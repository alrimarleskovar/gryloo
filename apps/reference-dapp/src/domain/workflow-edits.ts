// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { LENDING_NODE_IDS } from '@defi-workflow-engine/workflow-contracts';
import type { Command } from './commands';
import type { Workflow } from './initial-workflow';
import { parseHumanAmount } from './swap-authoring';
import { workflowSteps, type WorkflowStep } from './workflow-steps';

/**
 * BUILD-COPILOT-002: typed edit commands for existing steps. AI-agnostic. The caller first validates the new values as a
 * complete authoring command for the same kind of step (the Copilot does so through the exact grammar); this module only
 * maps that validated input onto the edit command the canvas already uses for that node. The editor reducer still owns
 * every IR change, and nothing changes until the user applies the resulting proposal.
 */
export type EditRefusal = 'UNKNOWN_STEP' | 'STEP_NOT_EDITABLE' | 'STEP_KIND_MISMATCH' | 'SWAP_TOKENS_OR_NETWORK_FIXED' | 'ONE_CHANGE_AT_A_TIME' | 'NO_CHANGE'
  | 'FIRST_STEP_PROTECTED' | 'LAST_STEP_PROTECTED' | 'COMPOSITION_STEP_PROTECTED' | 'STEP_HAS_DEPENDANTS' | 'STEP_LOCKED';
export type EditPlan = { readonly ok: true; readonly command: Command } | { readonly ok: false; readonly code: EditRefusal };
const refuse = (code: EditRefusal): EditPlan => ({ ok: false, code });

/** The edit command (or AUTHOR_LENDING re-authoring) that applies `authoring`'s validated input to step `nodeId`. */
export function editCommandFor(workflow: Workflow, context: ReviewContext, nodeId: string, authoring: Command): EditPlan {
  const step = workflowSteps(workflow, context).find(item => item.nodeId === nodeId);
  if (!step) return refuse('UNKNOWN_STEP');
  const base = { source: authoring.source, baseRevision: authoring.baseRevision };
  const detail = step.detail;
  switch (detail.type) {
    case 'LENDING_COMPOSITION': return authoring.type === 'AUTHOR_LENDING' ? { ok: true, command: authoring } : refuse('STEP_KIND_MISMATCH');
    case 'AAVE': {
      const expected = { SUPPLY: 'ADD_SUPPLY', BORROW: 'ADD_BORROW', REPAY: 'ADD_REPAY' }[detail.operation];
      if (authoring.type !== expected || !('input' in authoring)) return refuse('STEP_KIND_MISMATCH');
      const type = ({ SUPPLY: 'SET_SUPPLY', BORROW: 'SET_BORROW', REPAY: 'SET_REPAY' } as const)[detail.operation];
      return { ok: true, command: { ...base, type, nodeId, input: (authoring as Extract<Command, { type: 'ADD_SUPPLY' }>).input } };
    }
    case 'AAVE_WITHDRAW': return authoring.type === 'ADD_WITHDRAW' ? { ok: true, command: { ...base, type: 'SET_WITHDRAW', nodeId, input: authoring.input } } : refuse('STEP_KIND_MISMATCH');
    case 'SOLANA_SWAP': return authoring.type === 'ADD_SOLANA_SWAP' ? { ok: true, command: { ...base, type: 'SET_SOLANA_SWAP', nodeId, input: authoring.input } } : refuse('STEP_KIND_MISMATCH');
    case 'ROUTER': return authoring.type === 'ADD_ROUTER_BRIDGE' ? { ok: true, command: { ...base, type: 'SET_ROUTER_BRIDGE', nodeId, input: authoring.input } } : refuse('STEP_KIND_MISMATCH');
    case 'UNISWAP_LIQUIDITY': return authoring.type === 'ADD_UNISWAP_LIQUIDITY' ? { ok: true, command: { ...base, type: 'SET_UNISWAP_LIQUIDITY', nodeId, input: authoring.input } }
      : refuse('STEP_KIND_MISMATCH');
    case 'ORCA_LIQUIDITY': return authoring.type === 'ADD_SOLANA_LIQUIDITY' ? { ok: true, command: { ...base, type: 'SET_SOLANA_LIQUIDITY', nodeId, input: authoring.input } }
      : refuse('STEP_KIND_MISMATCH');
    case 'EVM_SWAP': return evmSwapEdit(step, detail, authoring, context, base);
    default: return refuse('STEP_NOT_EDITABLE');
  }
}

/** A Base or Base Sepolia swap node can change its amount or its slippage, one per proposal; never its tokens or network. */
function evmSwapEdit(step: WorkflowStep, detail: Extract<WorkflowStep['detail'], { type: 'EVM_SWAP' }>, authoring: Command, context: ReviewContext,
  base: Pick<Command, 'source' | 'baseRevision'>): EditPlan {
  if (authoring.type !== 'ADD_SWAP' && authoring.type !== 'ADD_TESTNET_SWAP') return refuse('STEP_KIND_MISMATCH');
  const testnet = detail.network === 'Base Sepolia';
  if ((authoring.type === 'ADD_TESTNET_SWAP') !== testnet || authoring.direction !== `${detail.from}_TO_${detail.to}`) return refuse('SWAP_TOKENS_OR_NETWORK_FIXED');
  const units = (amount: string) => parseHumanAmount(amount, detail.from, testnet ? createBaseSepoliaReviewContext() : context);
  const amountChanged = units(authoring.amount) !== units(detail.amount), slippageChanged = Number(authoring.slippage) !== Number(detail.slippage);
  if (amountChanged && slippageChanged) return refuse('ONE_CHANGE_AT_A_TIME');
  if (amountChanged) return { ok: true, command: { ...base, type: 'SET_SWAP_AMOUNT', nodeId: step.nodeId, amount: authoring.amount } };
  if (slippageChanged) return { ok: true, command: { ...base, type: 'SET_SLIPPAGE', nodeId: step.nodeId, slippage: authoring.slippage } };
  return refuse('NO_CHANGE');
}

/** `REMOVE` for a step the canvas could delete, or the reason it cannot be removed. */
export function removeCommandFor(workflow: Workflow, context: ReviewContext, nodeId: string, baseRevision: number): EditPlan {
  const step = workflowSteps(workflow, context).find(item => item.nodeId === nodeId);
  if (!step) return refuse('UNKNOWN_STEP');
  if (step.removable) return { ok: true, command: { type: 'REMOVE', nodeId, source: 'CHAT', baseRevision } };
  if ((LENDING_NODE_IDS as readonly string[]).includes(nodeId)) return refuse('COMPOSITION_STEP_PROTECTED');
  if (nodeId === 'node-001') return refuse('FIRST_STEP_PROTECTED');
  if (workflow.nodes.length <= 1) return refuse('LAST_STEP_PROTECTED');
  if (workflow.nodes.some(node => node.dependencies.includes(nodeId))) return refuse('STEP_HAS_DEPENDANTS');
  return refuse('STEP_LOCKED');
}

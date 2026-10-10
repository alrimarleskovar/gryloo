// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: "Automate this workflow" — the exact workflow already in the Canvas, expressed as the automation steps FloFi's
 * engine reproduces node for node. Nothing is rebuilt or reinterpreted:
 *
 *   - each action node must be a swap whose canonical route step (asset, side, network, amount, slippage), composed by FloFi's own
 *     engine, yields a node semantically IDENTICAL to the Canvas node (the comparison AUTOMATION-001 already uses for saved workflows:
 *     action, chain, inputs, constraints, protocols, failure policy, authorization class);
 *   - only the canonical routes are tried, and the match is verified, never guessed; any other node, or any difference, is refused;
 *   - steps keep the Canvas order, and a node may depend only on earlier ones.
 *
 * The result is the same route step the Automations form and the chat draft produce, so every surface compiles through one path to
 * one workflow hash. Pure: no IO, no authority.
 */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { composeWorkflowBound } from '../engine/strategy-engine.ts';
import { EXECUTION_ROUTES, routeStrategy, type RouteAction, type Side } from './assets.ts';
import { nodeSemantics } from './binding.ts';

type Node = SemanticWorkflow['nodes'][number];
export const MAX_AUTOMATION_STEPS = 4;
export type AutomationStep = { readonly index: number; readonly nodeId: string; readonly actionType: string; readonly chainId: string; readonly route: RouteAction | null };
export type AutomationSteps = { readonly ok: true; readonly steps: readonly (AutomationStep & { readonly route: RouteAction })[] }
  | { readonly ok: false; readonly code: string; readonly steps: readonly AutomationStep[] };
const SIDES: readonly Side[] = ['BUY', 'SELL'];
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function quantityIn(node: Node): { readonly amount: string; readonly decimals: number } | null {
  const input = (node.inputs as readonly unknown[]).find(i => record(i) && i.name === 'amount-in' && i.kind === 'QUANTITY') as { value?: unknown } | undefined;
  const value = input?.value;
  if (!record(value) || !record(value.asset) || typeof value.amount !== 'string' || !/^[1-9][0-9]{0,38}$/.test(value.amount)) return null;
  const decimals = value.asset.decimals;
  return typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? { amount: value.amount, decimals } : null;
}
function slippageOf(node: Node): number | null {
  const c = (node.userConstraints as readonly unknown[]).find(x => record(x) && x.kind === 'MAXIMUM_SLIPPAGE_BPS') as { maximumBps?: unknown } | undefined;
  return typeof c?.maximumBps === 'number' && Number.isInteger(c.maximumBps) && c.maximumBps >= 0 ? c.maximumBps : null;
}
/** Native units → the exact decimal string (no trailing zeros). */
function decimal(units: string, decimals: number): string {
  if (decimals === 0) return units;
  const padded = units.padStart(decimals + 1, '0'), whole = padded.slice(0, -decimals), fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** The canonical route step whose engine composition reproduces this Canvas node exactly, or null. */
export function routeOfNode(node: Node): RouteAction | null {
  if (node.actionType !== 'asset.swap.exact-input') return null;
  const quantity = quantityIn(node), slippageBps = slippageOf(node);
  if (!quantity || slippageBps === null) return null;
  const amount = decimal(quantity.amount, quantity.decimals), target = nodeSemantics(node);
  for (const [asset, routes] of Object.entries(EXECUTION_ROUTES) as [RouteAction['asset'], typeof EXECUTION_ROUTES[keyof typeof EXECUTION_ROUTES]][]) {
    for (const route of routes) for (const side of SIDES) {
      const action: RouteAction = { asset, side, network: route.network, amount, slippageBps };
      const strategy = routeStrategy(action);
      if (!strategy.ok) continue;
      const composed = composeWorkflowBound(strategy.strategy, undefined);
      if (!composed.ok || composed.steps.length !== 1) continue;
      const reproduced = composed.steps[0]!.workflow.nodes.filter(n => !n.actionType.startsWith('mock-'));
      if (reproduced.length === 1 && nodeSemantics(reproduced[0]!) === target) return action;
    }
  }
  return null;
}

/** The exact Canvas workflow → its automation steps, or a closed refusal that still lists every action node. */
export function automationSteps(workflow: unknown): AutomationSteps {
  if (!record(workflow) || !Array.isArray(workflow.nodes) || workflow.nodes.length > 64) return { ok: false, code: 'AUTOMATION_WORKFLOW_INVALID', steps: [] };
  const all = workflow.nodes as readonly Node[];
  if (!all.every(n => record(n) && typeof n.nodeId === 'string' && typeof n.actionType === 'string' && typeof n.chainId === 'string'
    && Array.isArray(n.inputs) && Array.isArray(n.userConstraints) && Array.isArray(n.dependencies))) return { ok: false, code: 'AUTOMATION_WORKFLOW_INVALID', steps: [] };
  const nodes = all.filter(n => !n.actionType.startsWith('mock-'));
  const steps: AutomationStep[] = nodes.map((n, index) => ({ index, nodeId: n.nodeId, actionType: n.actionType, chainId: n.chainId, route: routeOfNode(n) }));
  if (!nodes.length) return { ok: false, code: 'AUTOMATION_WORKFLOW_EMPTY', steps };
  if (nodes.length > MAX_AUTOMATION_STEPS) return { ok: false, code: 'AUTOMATION_WORKFLOW_TOO_LONG', steps };
  // Steps run in Canvas order, so a node may depend only on nodes before it.
  const earlier = new Set<string>();
  for (const n of nodes) {
    if ((n.dependencies as readonly unknown[]).some(d => typeof d !== 'string' || (!earlier.has(d) && nodes.some(m => m.nodeId === d)))) return { ok: false, code: 'AUTOMATION_WORKFLOW_ORDER_UNSUPPORTED', steps };
    earlier.add(n.nodeId);
  }
  if (steps.some(s => !s.route)) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE', steps };
  return { ok: true, steps: steps as (AutomationStep & { readonly route: RouteAction })[] };
}

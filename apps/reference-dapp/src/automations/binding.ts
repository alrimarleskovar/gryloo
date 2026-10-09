// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: what an automation proposes, and why it can never change silently.
 *
 * An automation's action is BOUND BY VALUE to one canonical StrategySpec and its workflow hash (the same composition, IR and hash
 * as FloFi's app, MCP, the Developer API and Channels), together with the engine version that composed it. When it was created from
 * a saved workflow (migration 0008), the binding also records that document's id, hash and version — as provenance and as a tripwire,
 * never as a live reference:
 *
 *   saved workflow edited (hash or version differs) or gone   →  WORKFLOW_CHANGED: no proposal until the owner rebinds explicitly
 *   the engine no longer reproduces the bound hash             →  STRATEGY_STALE: no proposal until the owner rebinds
 *
 * So "weekly buy 50" can never become "weekly buy 500" because somebody edited the saved workflow: the automation keeps proposing 50
 * (or nothing, while flagged), and only the owner's rebind — re-checked against the limits — changes the binding.
 *
 * A saved workflow can be bound when it is exactly one EVM swap FloFi's engine reproduces node for node (`strategyOfSavedWorkflow`);
 * anything else is `AUTOMATION_WORKFLOW_NOT_REPRESENTABLE` and nothing nearby is substituted.
 */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { reviewContextForChain } from '@defi-workflow-engine/reference-linter';
import { savedWorkflowHash } from '../domain/saved-workflow.ts';
import { SWAP_ACTION, swapDetails } from '../domain/swap-authoring';
import { composeWorkflowBound, dappReviewContext } from '../engine/strategy-engine';
import type { StrategySpec } from '../engine/strategy-spec';
import { ENGINE_VERSION } from '../platform/index.ts';

export type WorkflowSource = { readonly workflowId: string; readonly workflowHash: string; readonly version: number };
export type Binding = { readonly strategy: StrategySpec; readonly workflowHash: string; readonly engineVersion: string; readonly source: WorkflowSource | null };
type Refused = { readonly ok: false; readonly code: string };

/** The canonical form and hash of an automatable action (one swap step), or a closed refusal. */
export function bindStrategy(input: unknown, source: WorkflowSource | null = null): { readonly ok: true; readonly binding: Binding } | Refused {
  const composed = composeWorkflowBound(input, undefined);
  if (!composed.ok) return { ok: false, code: composed.code };
  if (composed.steps.length !== 1) return { ok: false, code: 'AUTOMATION_ACTION_UNSUPPORTED' };
  const step = composed.steps[0]!;
  if (step.strategy.action !== 'swap') return { ok: false, code: 'AUTOMATION_ACTION_UNSUPPORTED' };
  return { ok: true, binding: { strategy: step.strategy, workflowHash: step.workflowHash, engineVersion: ENGINE_VERSION, source } };
}
/** The binding still reproduces with the current engine (same hash), or STRATEGY_STALE. */
export function verifyBinding(binding: Pick<Binding, 'strategy' | 'workflowHash'>): { readonly ok: true } | Refused {
  const composed = composeWorkflowBound(binding.strategy, binding.workflowHash);
  return composed.ok && composed.steps.length === 1 ? { ok: true } : { ok: false, code: 'STRATEGY_STALE' };
}
/** WORKFLOW_CHANGED when the source saved workflow is gone or no longer the exact document the automation was bound to. */
export function sourceDrift(source: WorkflowSource | null, current: { readonly workflowHash: string; readonly version: number } | null): string | null {
  if (!source) return null;
  return current && current.workflowHash === source.workflowHash && current.version === source.version ? null : 'WORKFLOW_CHANGED';
}

const SWAP_NETWORKS: Readonly<Record<string, Extract<StrategySpec, { action: 'swap' }>['network']>> = Object.freeze({ 'eip155:8453': 'base', 'eip155:84532': 'base-sepolia', 'eip155:11155111': 'ethereum-sepolia' });
/** Key-order-independent JSON (a stored document comes back from JSONB with its keys reordered). */
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v);
const semantics = (node: Readonly<SemanticWorkflow['nodes'][number]> | Parameters<typeof swapDetails>[0]) => canonical({ actionType: node.actionType, chainId: node.chainId, inputs: node.inputs,
  userConstraints: node.userConstraints, adapterConstraints: node.adapterConstraints, requiredCapabilities: node.requiredCapabilities,
  failurePolicy: node.failurePolicy, requiredAuthorizationClass: node.requiredAuthorizationClass });
/**
 * The StrategySpec a saved workflow expresses, when it is exactly one EVM swap and FloFi's engine reproduces that node exactly
 * (asset identities, amount, slippage, protocols, failure policy and authorization class), plus the document's own hash.
 */
export function strategyOfSavedWorkflow(workflow: SemanticWorkflow): { readonly ok: true; readonly strategy: StrategySpec; readonly documentHash: string } | Refused {
  const actions = workflow.nodes.filter(n => !n.actionType.startsWith('mock-'));
  const node = actions.length === 1 ? actions[0]! : null;
  if (!node || node.actionType !== SWAP_ACTION) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' };
  const network = SWAP_NETWORKS[node.chainId];
  if (!network) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' };
  const context = network === 'base' ? dappReviewContext() : reviewContextForChain(node.chainId, dappReviewContext());
  const details = swapDetails(node as Parameters<typeof swapDetails>[0], context);
  if (!details || details.slippage === null) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' };
  const strategy: StrategySpec = { version: 1, action: 'swap', network, inputAsset: details.from, outputAsset: details.to, amount: details.amount, slippageBps: details.slippage };
  const composed = composeWorkflowBound(strategy, undefined);
  if (!composed.ok || composed.steps.length !== 1) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' };
  const reproduced = composed.steps[0]!.workflow.nodes.filter(n => !n.actionType.startsWith('mock-'));
  if (reproduced.length !== 1 || semantics(reproduced[0]!) !== semantics(node)) return { ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' };
  return { ok: true, strategy: composed.steps[0]!.strategy, documentHash: savedWorkflowHash(workflow) };
}

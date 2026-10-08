// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, parseArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateAuthoringWorkflow, createReviewContext, reviewContextForChain } from '@defi-workflow-engine/reference-linter';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
export type WorkflowOwner = { namespace: 'eip155' | 'solana'; address: string };
export const WORKFLOW_OWNER_HEADER = 'x-flofi-workflow-owner';
export function workflowOwner(value: unknown): WorkflowOwner | null {
  if (typeof value !== 'string') return null;
  const match = /^(eip155):(0x[0-9a-f]{40})$|^(solana):([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(value);
  return match ? { namespace: (match[1] ?? match[3]) as WorkflowOwner['namespace'], address: (match[2] ?? match[4])! } : null;
}
export function validateSavedWorkflow(value: unknown): SemanticWorkflow {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 262_144) throw Error('WORKFLOW_INVALID');
  const workflow = parseArtifactBytes(bytes, 'semantic-workflow');
  if (!workflow.nodes.some(n => !n.actionType.startsWith('mock-'))) throw Error('WORKFLOW_EMPTY');
  const base = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id,
    actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
  const chain = workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input')?.chainId;
  return validateAuthoringWorkflow(workflow, chain ? reviewContextForChain(chain, base) : base);
}
export const savedWorkflowHash = (workflow: SemanticWorkflow) => hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
export type SavedWorkflow = { workflowId: string; name: string; workflow: SemanticWorkflow; revision: number; version: number; createdAt: string; updatedAt: string };
export type OwnerWorkflow = { workflowId: string; name: string | null; saved: boolean; version: number | null; updatedAt: string;
  runCount: number; lastRunId: string | null; lastStatus: string | null; hasEvidence: boolean };
export type WorkflowList = { items: OwnerWorkflow[]; hasMore: boolean };
export type WorkflowDocument = { workflowId: string; name: string | null; workflow: SemanticWorkflow; version: number | null };

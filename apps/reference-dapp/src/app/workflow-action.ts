// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { SavedWorkflow, WorkflowDocument, WorkflowList, WorkflowOwner } from '../domain/saved-workflow';
import { workflowOperation } from '../server/workflow-persistence';
export async function listWorkflows(owner: WorkflowOwner) { return workflowOperation<WorkflowList>('list', [], owner); }
export async function openWorkflow(owner: WorkflowOwner, workflowId: string) { return workflowOperation<WorkflowDocument>('get', [workflowId], owner); }
export async function saveWorkflow(owner: WorkflowOwner, workflow: SemanticWorkflow, name: string, expectedVersion: number) {
  return workflowOperation<SavedWorkflow>('save', [{ workflow, name, expectedVersion }], owner);
}

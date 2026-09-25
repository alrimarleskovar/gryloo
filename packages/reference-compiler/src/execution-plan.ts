// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { payloadIdentity } from './payload.js';
import { MODE_A_ADAPTER, type CompileContext } from './policy.js';
import { FORK_CHAIN_REF } from './profile.js';
export function compileExecutionPlan(context: CompileContext, manifestHash: string,
  approveBytes: Uint8Array, swapBytes: Uint8Array): { readonly plan: ExecutionPlan; readonly executionPlanHash: string } {
  const plan = validateArtifact('execution-plan', {
    schemaVersion: '1.0.0', executionPlanId: `FORK.plan.r${context.revision}.b${context.forkBlock}`,
    semanticWorkflowHash: context.semanticWorkflowHash, manifestHash,
    segments: [{ segmentId: 'seg-fork-31337', chainId: FORK_CHAIN_REF, dependencies: [], steps: [
      { stepId: 'step-approve', nodeId: context.nodeId, chainId: FORK_CHAIN_REF,
        adapter: MODE_A_ADAPTER, dependencies: [], requiredAuthorizationClass: 'MODE_A',
        executionKind: 'DIRECT_TRANSACTION', payloadHash: payloadIdentity(approveBytes).payloadHash },
      { stepId: 'step-swap', nodeId: context.nodeId, chainId: FORK_CHAIN_REF,
        adapter: MODE_A_ADAPTER, dependencies: ['step-approve'], requiredAuthorizationClass: 'MODE_A',
        executionKind: 'DIRECT_TRANSACTION', payloadHash: payloadIdentity(swapBytes).payloadHash },
    ] }], checkpointIds: ['swap-minimum-output'], enforcement: 'NOT_ENFORCED',
  });
  return { plan, executionPlanHash: hashArtifactBytes('execution-plan', new TextEncoder().encode(JSON.stringify(plan))) };
}

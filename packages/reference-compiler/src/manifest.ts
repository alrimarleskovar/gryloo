// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, type AuthorizationPolicy, type StrategyManifest } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { type CompileContext, forkTimestamp } from './policy.js';
import { FORK_CHAIN_REF } from './profile.js';
export function compileManifest(context: CompileContext, policy: AuthorizationPolicy, policyHash: string): {
  readonly manifest: StrategyManifest; readonly manifestHash: string; readonly executionId: string;
} {
  if (policy.semanticWorkflowHash !== context.semanticWorkflowHash || policy.artifactSetHash !== context.artifactSetHash
    || policy.simulationHash !== context.simulationHash || policy.requiredAuthorizationClass !== 'MODE_A') throw new Error('ARTIFACT_LINK_MISMATCH');
  const manifest = validateArtifact('strategy-manifest', {
    schemaVersion: '1.0.0', manifestId: `FORK.manifest.r${context.revision}.b${context.forkBlock}`,
    semanticWorkflowRevision: context.revision, semanticWorkflowHash: context.semanticWorkflowHash,
    artifactSetHash: context.artifactSetHash, simulationHash: context.simulationHash, policyHash,
    authorizationMode: 'MODE_A', owner: { chainId: FORK_CHAIN_REF, address: context.owner }, executor: null,
    expiresAt: forkTimestamp(context.deadline), nonce: context.nonce.toString(), revocationEpoch: 0,
    spendLimits: policy.spendLimits, maximumSlippageBps: policy.maximumSlippageBps,
    gasBudgets: policy.gasBudgets, feeBudgets: policy.feeBudgets, providers: policy.providers,
    recovery: policy.recovery, enforcement: 'NOT_ENFORCED',
  });
  const manifestHash = hashArtifactBytes('strategy-manifest', new TextEncoder().encode(JSON.stringify(manifest)));
  return { manifest, manifestHash, executionId: `exec-${manifestHash.slice(2, 26)}` };
}

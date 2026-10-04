// SPDX-License-Identifier: Apache-2.0
import type { SemanticWorkflow } from './semantic-workflow.js';
import type { StrategyManifest } from './strategy-manifest.js';
import { hashArtifactValue } from './canonical.js';

/** Additive, hash-covered v1 capability policy; no change to frozen artifact schemas. */
export const CLOAK_PRIVACY_CAPABILITY = 'privacy.required.cloak';
export const CLOAK_CHANGE_CAPABILITY = 'privacy.output.public-with-private-change';
export const CLOAK_ADAPTER = Object.freeze({ id: 'cloak.solana', version: '0.2.5' });
export const CLOAK_PRIVACY_POLICY = Object.freeze({ mode: 'required', provider: 'cloak', output: 'public-with-private-change' } as const);
export type PrivacyPolicy = typeof CLOAK_PRIVACY_POLICY;
type Node = { readonly requiredCapabilities: readonly string[]; readonly adapterConstraints: {
  readonly adapters: readonly { readonly id: string; readonly version: string }[]; readonly protocols: readonly string[] } };

/** Partial or inconsistent privacy declarations never become public execution. */
export function privacyRequirement(node: Node): PrivacyPolicy | null {
  const { adapters, protocols } = node.adapterConstraints;
  const marked = node.requiredCapabilities.some(c => c.startsWith('privacy.')) ||
    adapters.some(a => a.id.startsWith('cloak.')) || protocols.includes('cloak');
  if (!marked) return null;
  if (node.requiredCapabilities.length !== 3 || new Set(node.requiredCapabilities).size !== 3 ||
      !['swap.direct-transaction', CLOAK_PRIVACY_CAPABILITY, CLOAK_CHANGE_CAPABILITY].every(c => node.requiredCapabilities.includes(c)) ||
      adapters.length !== 1 || adapters[0]?.id !== CLOAK_ADAPTER.id || adapters[0]?.version !== CLOAK_ADAPTER.version ||
      protocols.length !== 1 || protocols[0] !== 'cloak') throw new Error('PRIVACY_REQUIREMENT_INVALID');
  return CLOAK_PRIVACY_POLICY;
}

export function requireCloakPrivacy(node: Node): PrivacyPolicy {
  return privacyRequirement(node) ?? (() => { throw new Error('PRIVACY_REQUIREMENT_MISSING'); })();
}

export function assertPublicWorkflow(workflow: { readonly nodes: readonly Node[] }): void {
  for (const node of workflow.nodes) if (privacyRequirement(node)) throw new Error('PRIVACY_PUBLIC_FALLBACK_DENIED');
}

/** Manifest displays privacy from the bound IR, never from an unhashed UI toggle. */
export function assertPrivacyManifest(workflow: SemanticWorkflow, workflowHash: string, manifest: StrategyManifest): PrivacyPolicy {
  if (workflow.nodes.length !== 1 || hashArtifactValue('semantic-workflow', workflow) !== workflowHash || manifest.semanticWorkflowHash !== workflowHash ||
      manifest.semanticWorkflowRevision !== workflow.revision || manifest.authorizationMode !== 'MODE_A' ||
      manifest.owner.chainId !== workflow.nodes[0]?.chainId || manifest.executor !== null ||
      manifest.providers.kind !== 'FIXED' || manifest.providers.providerId !== 'cloak')
    throw new Error('PRIVACY_MANIFEST_MISMATCH');
  return requireCloakPrivacy(workflow.nodes[0]!);
}

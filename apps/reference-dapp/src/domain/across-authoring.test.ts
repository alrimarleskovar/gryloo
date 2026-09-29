// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createAcrossWorkflow } from './across-authoring';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
describe('direct Across semantic bridge', () => {
  it('uses the shared IR with one fixed Across adapter and Arbitrum USDC output', () => {
    const workflow = createAcrossWorkflow('workflow-local', 1, { amount: '1', slippageBps: '50' });
    expect(validateAuthoringWorkflow(workflow, context)).toEqual(workflow);
    expect(workflow.nodes[0]?.adapterConstraints.adapters[0]?.id).toBe('across.direct');
    expect(workflow.nodes[0]?.expectedOutputs[0]?.asset.chainId).toBe('eip155:42161');
  });
});

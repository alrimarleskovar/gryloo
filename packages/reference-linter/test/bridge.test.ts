import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '../src/index.js';
import { createBridgeNode } from '../../../apps/reference-dapp/src/domain/bridge-authoring.js';
const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
describe('bridge declaration', () => {
  it('refuses destination-chain substitution', () => {
    const node = createBridgeNode('node-002', { amount: '1', slippageBps: '50' });
    const workflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, nodes: [node], resourceEdges: [] };
    expect(validateAuthoringWorkflow(workflow, context)).toBeTruthy();
    const bad = { ...node, inputs: node.inputs.map(x => x.name === 'asset-out' && x.kind === 'ASSET'
      ? { ...x, value: { ...x.value, chainId: 'eip155:1' } } : x) };
    expect(() => validateAuthoringWorkflow({ ...workflow, nodes: [bad] }, context)).toThrow();
  });
});

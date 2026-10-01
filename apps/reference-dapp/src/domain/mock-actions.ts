// SPDX-License-Identifier: AGPL-3.0-only
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { ActionDefinition } from '@defi-workflow-engine/action-registry';

export const actionKinds = ['read', 'transform', 'condition', 'bridge', 'pool', 'lending', 'borrow'] as const;
export type ActionKind = typeof actionKinds[number];
export const mockActions = actionKinds.slice(0, 3).map((kind): ActionDefinition => ({
  id: `mock-${kind}`, version: '1.0.0',
  nodeClass: kind === 'read' ? 'READ' : 'LOGIC',
  inputs: [{ name: 'amount', type: 'AMOUNT_UNITS', required: true }],
  outputs: [{ name: 'result', type: 'AMOUNT_UNITS', required: true }],
  constraints: { arbitraryTargetsAllowed: false, financialAmountEncoding: 'NATIVE_UNIT_DECIMAL_STRINGS' },
  requiredCapability: { id: 'mock-authoring', version: '1.0.0' },
  executionKinds: [], authorizationModes: [],
}));

export function createMockNode(nodeId: string, kind: ActionKind): SemanticWorkflow['nodes'][number] {
  const asset = { chainId: 'mock:local', nativeId: 'sample', decimals: 6 };
  return {
    nodeId, actionType: `mock-${kind}`, actionSchemaVersion: '1.0.0', chainId: 'mock:local',
    requiredCapabilities: [], adapterConstraints: { adapters: [], protocols: [] },
    inputs: [{ name: 'amount', kind: 'QUANTITY', value: { asset, amount: '1000000' } }],
    expectedOutputs: [{ outputId: 'result', asset: { ...asset }, minimumAmount: '0' }],
    dependencies: [], userConstraints: [], failurePolicy: 'ABORT',
    requiredAuthorizationClass: 'NONE', lockedParameters: [], editableBounds: [],
  };
}

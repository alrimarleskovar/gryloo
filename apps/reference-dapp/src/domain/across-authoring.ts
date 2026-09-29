// SPDX-License-Identifier: AGPL-3.0-only
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBridgeNode, type BridgeInput } from './bridge-authoring';
import { ARBITRUM, ARBITRUM_USDC } from './bridge-swap-authoring';
export const ACROSS_ADAPTER = { id: 'across.direct', version: '1.0.0' } as const;
export function createAcrossWorkflow(workflowId: string, revision: number, input: BridgeInput): SemanticWorkflow {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('ACROSS_REVISION_INVALID');
  const old = createBridgeNode(`node-${String(revision + 1).padStart(3, '0')}`, input);
  const destination = { chainId: ARBITRUM, address: ARBITRUM_USDC, decimals: 6 };
  const bridge = { ...old, adapterConstraints: { adapters: [ACROSS_ADAPTER], protocols: ['across'] },
    inputs: [old.inputs[0]!, { name: 'asset-out', kind: 'ASSET' as const, value: destination }],
    expectedOutputs: [{ outputId: 'amount-out', asset: destination, minimumAmount: '0' }] };
  return { schemaVersion: '1.0.0', workflowId, revision, nodes: [bridge], resourceEdges: [] };
}

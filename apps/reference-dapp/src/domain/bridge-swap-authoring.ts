// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-009's separate Base → Arbitrum bridge → swap profile over the shared IR. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBridgeNode, type BridgeInput } from './bridge-authoring';
export const ARBITRUM = 'eip155:42161';
export const ARBITRUM_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
export const ARBITRUM_WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
export type BridgeSwapInput = BridgeInput & { readonly swapSlippageBps: string };
export function createBridgeSwapWorkflow(workflowId: string, revision: number, input: BridgeSwapInput): SemanticWorkflow {
  const bps = Number(input.swapSlippageBps);
  if (!Number.isInteger(bps) || bps < 1 || bps > 300 || String(bps) !== input.swapSlippageBps
    || !Number.isSafeInteger(revision) || revision < 1) throw new Error('BRIDGE_SWAP_INPUT_INVALID');
  const usdc = { chainId: ARBITRUM, address: ARBITRUM_USDC, decimals: 6 };
  const weth = { chainId: ARBITRUM, address: ARBITRUM_WETH, decimals: 18 };
  const old = createBridgeNode('build009-bridge', input);
  const bridge = { ...old, inputs: [old.inputs[0]!, { name: 'asset-out', kind: 'ASSET' as const, value: usdc }],
    expectedOutputs: [{ outputId: 'amount-out', asset: usdc, minimumAmount: '0' }] };
  const swap: SemanticWorkflow['nodes'][number] = {
    nodeId: 'build009-swap', actionType: 'asset.swap.exact-input', actionSchemaVersion: '1.0.0', chainId: ARBITRUM,
    requiredCapabilities: ['swap.direct-transaction'],
    adapterConstraints: { adapters: [{ id: 'lifi.rest', version: '1.0.0' }], protocols: ['lifi'] },
    inputs: [{ name: 'amount-in', kind: 'OUTPUT_REFERENCE', value: { nodeId: bridge.nodeId, outputId: 'amount-out' } },
      { name: 'asset-out', kind: 'ASSET', value: weth }],
    expectedOutputs: [{ outputId: 'amount-out', asset: weth, minimumAmount: '0' }],
    dependencies: [bridge.nodeId], userConstraints: [{ kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: bps }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [],
  };
  return { schemaVersion: '1.0.0', workflowId, revision, nodes: [bridge, swap],
    resourceEdges: [{ fromNodeId: bridge.nodeId, outputId: 'amount-out', toNodeId: swap.nodeId, inputName: 'amount-in' }] };
}

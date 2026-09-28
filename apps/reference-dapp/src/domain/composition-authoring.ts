// SPDX-License-Identifier: AGPL-3.0-only
/** One revisioned two-node BUILD-007 authoring profile. Runtime quotes and balances stay outside the IR. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateCompositionWorkflow, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { createSwapNode } from './swap-authoring';
import { createLiquidityNode, type LiquidityInput } from './liquidity-authoring';

export type CompositionInput = { readonly swapUSDC: string; readonly slippageBps: string; readonly mint: LiquidityInput };
export function createCompositionWorkflow(workflowId: string, revision: number, safe: string, input: CompositionInput,
  context: ReviewContext): SemanticWorkflow {
  if (!/^0x[0-9a-f]{40}$/.test(safe) || safe !== input.mint.recipient ||
      !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error('COMPOSITION_AUTHORING_INVALID');
  const swap = createSwapNode('composition-swap', 'USDC_TO_WETH', input.swapUSDC, input.slippageBps, context);
  const mint = createLiquidityNode('composition-mint', input.mint, context);
  const workflow: SemanticWorkflow = {
    schemaVersion: '1.0.0', workflowId, revision,
    nodes: [{ ...swap, requiredAuthorizationClass: 'MODE_B' }, {
      ...mint, requiredAuthorizationClass: 'MODE_B', dependencies: [swap.nodeId],
      inputs: [...mint.inputs, { name: 'weth-from-swap', kind: 'OUTPUT_REFERENCE', value: { nodeId: swap.nodeId, outputId: 'amount-out' } }],
    }],
    resourceEdges: [{ fromNodeId: swap.nodeId, outputId: 'amount-out', toNodeId: mint.nodeId, inputName: 'weth-from-swap' }],
  };
  validateCompositionWorkflow(workflow, context);
  return workflow;
}

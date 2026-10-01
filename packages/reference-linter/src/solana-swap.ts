// SPDX-License-Identifier: AGPL-3.0-only
import { readExactInputSwap, EXACT_INPUT_SWAP_ACTION, createExactInputSwapNode, type SemanticWorkflow, type ExactInputSwapFields } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET as profile, solanaTokenByMint } from '@defi-workflow-engine/action-registry';

export const isSolanaSwapNode = (node: { actionType: string; chainId: string }) =>
  node.actionType === EXACT_INPUT_SWAP_ACTION && node.chainId.startsWith('solana:');

/** The canonical swap on the one verified Jupiter Solana profile: one isolated node, allowlisted mints. */
export function validateSolanaSwapWorkflow(workflow: SemanticWorkflow): ExactInputSwapFields {
  const nodes = workflow.nodes.filter(isSolanaSwapNode);
  const id = nodes[0]?.nodeId ?? '';
  if (nodes.length !== 1 || workflow.nodes.some(n => n.nodeId !== id && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === id || e.toNodeId === id) ||
      workflow.nodes.some(n => n.dependencies.includes(id))) throw new Error('SOLANA_SWAP_ISOLATED_ONLY');
  const node = nodes[0]!;
  const fields = readExactInputSwap(node);
  const input = solanaTokenByMint(fields.input.address), output = solanaTokenByMint(fields.output.address);
  if (fields.chain !== profile.chain) throw new Error('SOLANA_CLUSTER_UNSUPPORTED');
  if (!input || !output || input === output || input.decimals !== fields.input.decimals || output.decimals !== fields.output.decimals)
    throw new Error('SOLANA_MINT_UNSUPPORTED');
  if (fields.protocols.length !== 1 || fields.protocols[0] !== profile.protocol) throw new Error('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
  if (fields.slippageBps < 1 || fields.slippageBps > profile.maximumSlippageBps) throw new Error('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  if (BigInt(fields.amount) > BigInt(input.maximumAmount) || fields.maximumAmount !== input.maximumAmount) throw new Error('AMOUNT_OUT_OF_RANGE');
  // Closed declaration: the node must be byte-equivalent to the canonical construction.
  const canonical = createExactInputSwapNode(node.nodeId, fields);
  const sorted = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
  if (sorted(node) !== sorted(canonical)) throw new Error('SOLANA_SWAP_DECLARATION_INVALID');
  return fields;
}

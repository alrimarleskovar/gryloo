// SPDX-License-Identifier: AGPL-3.0-only
import { readNativeTransferNode, TRANSFER_ACTION, type NativeTransferFields, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { NATIVE_TRANSFER_PROFILES } from '@defi-workflow-engine/action-registry';
/**
 * One isolated native self-transfer on a public test network with a transfer profile (RH-DEMO-001 Robinhood Testnet,
 * BUILD-ETHEREUM-001 Ethereum Sepolia); templates may coexist, nothing may connect. Any other chain, Mainnet included, is refused.
 */
export function validateNativeTransferWorkflow(workflow: SemanticWorkflow): NativeTransferFields {
  const nodes = workflow.nodes.filter(n => n.actionType === TRANSFER_ACTION);
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== TRANSFER_ACTION && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('TRANSFER_ISOLATED_ONLY');
  const fields = readNativeTransferNode(nodes[0]!);
  const profile = NATIVE_TRANSFER_PROFILES.find(item => item.chain === fields.chain);
  if (!profile) throw new Error('TRANSFER_NETWORK_UNSUPPORTED');
  if (BigInt(fields.amount) > BigInt(profile.maximumValueWei)) throw new Error('TRANSFER_AMOUNT_OUT_OF_RANGE');
  return fields;
}

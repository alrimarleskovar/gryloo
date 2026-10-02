// SPDX-License-Identifier: AGPL-3.0-only
import { readNativeTransferNode, TRANSFER_ACTION, type NativeTransferFields, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
/** RH-DEMO-001: one isolated native self-transfer on Robinhood Testnet; templates may coexist, nothing may connect. */
export function validateNativeTransferWorkflow(workflow: SemanticWorkflow): NativeTransferFields {
  const nodes = workflow.nodes.filter(n => n.actionType === TRANSFER_ACTION);
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== TRANSFER_ACTION && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('TRANSFER_ISOLATED_ONLY');
  const fields = readNativeTransferNode(nodes[0]!);
  if (fields.chain !== profile.chain) throw new Error('TRANSFER_NETWORK_UNSUPPORTED');
  if (BigInt(fields.amount) > BigInt(profile.maximumValueWei)) throw new Error('TRANSFER_AMOUNT_OUT_OF_RANGE');
  return fields;
}

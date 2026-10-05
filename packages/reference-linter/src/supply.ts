// SPDX-License-Identifier: AGPL-3.0-only
import { readSupplyNode, readBorrowNode, readRepayNode, readWithdrawNode, SUPPLY_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_LENDING_PROFILES } from '@defi-workflow-engine/action-registry';
export function validateSupplyWorkflow(workflow: SemanticWorkflow) {
  const action = workflow.nodes.some(n=>n.actionType==='withdraw') ? 'withdraw' : workflow.nodes.some(n => n.actionType === 'repay') ? 'repay' : workflow.nodes.some(n => n.actionType === 'borrow') ? 'borrow' : SUPPLY_ACTION;
  const nodes = workflow.nodes.filter(n => n.actionType === action);
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== action && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('SUPPLY_ISOLATED_ONLY');
  const fields = action === 'withdraw' ? readWithdrawNode(nodes[0]!) : action === 'repay' ? readRepayNode(nodes[0]!) : action === 'borrow' ? readBorrowNode(nodes[0]!) : readSupplyNode(nodes[0]!);
  // The authored chain selects the profile; the asset must be that profile's exact asset (chain + address + decimals).
  const profile = AAVE_V3_LENDING_PROFILES.find(item => item.chain === fields.chain);
  if (!profile || fields.asset.chainId !== profile.chain || fields.asset.address !== profile.asset || fields.asset.decimals !== profile.decimals)
    throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  return fields;
}

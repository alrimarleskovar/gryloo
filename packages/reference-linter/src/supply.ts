// SPDX-License-Identifier: AGPL-3.0-only
import { readSupplyNode, SUPPLY_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as profile } from '@defi-workflow-engine/action-registry';
export function validateSupplyWorkflow(workflow: SemanticWorkflow): ReturnType<typeof readSupplyNode> {
  const nodes = workflow.nodes.filter(n => n.actionType === SUPPLY_ACTION);
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== SUPPLY_ACTION && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('SUPPLY_ISOLATED_ONLY');
  const fields = readSupplyNode(nodes[0]!);
  if (fields.chain !== profile.chain || fields.asset.address !== profile.asset || fields.asset.decimals !== profile.decimals)
    throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  return fields;
}

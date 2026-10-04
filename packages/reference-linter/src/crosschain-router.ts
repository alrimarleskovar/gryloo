// SPDX-License-Identifier: AGPL-3.0-only
import { isRouterBridgeNode, readRouterBridgeNode, type RouterBridgeFields, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

/**
 * BUILD-ROUTER-001: one isolated canonical bridge node routed by the Cross-chain Router. The node must be exactly the
 * canonical construction of its fields (supported pair, bounded amount and slippage, recipient, provider preference).
 */
export function validateRouterBridgeWorkflow(workflow: SemanticWorkflow): RouterBridgeFields & { readonly nodeId: string } {
  const node = workflow.nodes[0];
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length !== 0 || !node || node.dependencies.length !== 0) throw new Error('ROUTER_ISOLATED_ONLY');
  if (!isRouterBridgeNode(node)) throw new Error('ROUTER_NODE_INVALID');
  return { ...readRouterBridgeNode(node), nodeId: node.nodeId };
}

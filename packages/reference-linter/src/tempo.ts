// SPDX-License-Identifier: AGPL-3.0-only
import { readTokenPaymentNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { TEMPO_PAYMENT as p } from '@defi-workflow-engine/action-registry';
export function validateTempoWorkflow(w: SemanticWorkflow) {
  const nodes = w.nodes.filter(n => n.actionType === 'asset.transfer');
  if (nodes.length !== 1 || w.resourceEdges.length || w.nodes.some(n => n.dependencies.length ||
      n.actionType !== 'asset.transfer' && !n.actionType.startsWith('mock-')) || new Set(w.nodes.map(n => n.nodeId)).size !== w.nodes.length)
    throw new Error('TEMPO_ISOLATED_ONLY');
  const f = readTokenPaymentNode(nodes[0]!);
  if (f.chain !== p.chain || f.token !== p.token || f.feeToken !== p.token || f.decimals !== 6 || f.adapterId !== p.adapterId ||
      BigInt(f.amount) > BigInt(p.maximumAmount) || BigInt(f.maximumFee) > BigInt(p.maximumFee) ||
      f.recipient.startsWith('0x20c0') || f.recipient === p.feeManager || f.recipient === p.policyRegistry) throw new Error('TEMPO_PROFILE_UNSUPPORTED');
  return f;
}

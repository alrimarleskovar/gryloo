// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import { createSupplyNode, type SupplyFields } from './supply.js';
import { createBorrowNode } from './borrow.js';
import { createExactInputSwapNode, type TokenAsset } from './swap.js';
import type { SemanticWorkflow } from './semantic-workflow.js';

export type LendingCompositionFields = {
  chain: string; collateral: TokenAsset; borrowed: TokenAsset; output: TokenAsset;
  supplyAmount: string; borrowAmount: string; slippageBps: number; owner: string;
};
export const LENDING_NODE_IDS = ['lending-supply', 'lending-borrow', 'lending-swap'] as const;
export function isLendingComposition(workflow: {readonly nodes:readonly {readonly actionType:string}[]}): boolean {
  return workflow.nodes.some(n => n.actionType === 'supply') && workflow.nodes.some(n => n.actionType === 'borrow');
}
/** A finite three-node graph; the health check is a policy checkpoint, never a transaction. */
export function createLendingCompositionWorkflow(workflowId: string, revision: number, f: LendingCompositionFields): SemanticWorkflow {
  if (canonicalJson(f.collateral) !== canonicalJson(f.borrowed) || !Number.isSafeInteger(revision) || revision < 0 ||
      f.slippageBps < 1 || f.slippageBps > 300) throw new Error('LENDING_FIELDS_INVALID');
  const base: SupplyFields = { chain: f.chain, asset: f.collateral, amount: f.supplyAmount, beneficiary: f.owner };
  const supply = createSupplyNode(LENDING_NODE_IDS[0], base);
  const borrow = createBorrowNode(LENDING_NODE_IDS[1], { ...base, asset: f.borrowed, amount: f.borrowAmount, interestRateMode: 2 });
  borrow.dependencies = [supply.nodeId];
  borrow.expectedOutputs = [{ outputId: 'borrowed-amount', asset: f.borrowed, minimumAmount: f.borrowAmount }];
  const swap = createExactInputSwapNode(LENDING_NODE_IDS[2], { chain: f.chain, input: f.borrowed, output: f.output,
    amount: f.borrowAmount, maximumAmount: f.borrowAmount, slippageBps: f.slippageBps, protocols: ['uniswap'] });
  swap.inputs[0] = { name: 'amount-in', kind: 'OUTPUT_REFERENCE', value: { nodeId: borrow.nodeId, outputId: 'borrowed-amount' } };
  swap.dependencies = [borrow.nodeId];
  swap.editableBounds = [];
  return { schemaVersion: '1.0.0', workflowId, revision, nodes: [supply, borrow, swap],
    resourceEdges: [{ fromNodeId: borrow.nodeId, outputId: 'borrowed-amount', toNodeId: swap.nodeId, inputName: 'amount-in' }] };
}
export function readLendingComposition(workflow: SemanticWorkflow): LendingCompositionFields {
  const [s, b, w] = workflow.nodes;
  const sq = s?.inputs.find(i => i.name === 'amount'), bq = b?.inputs.find(i => i.name === 'amount');
  const owner = s?.inputs.find(i => i.name === 'beneficiary'), output = w?.inputs.find(i => i.name === 'asset-out');
  const slip = w?.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (!s || !b || !w || sq?.kind !== 'QUANTITY' || bq?.kind !== 'QUANTITY' || owner?.kind !== 'ACCOUNT' ||
      output?.kind !== 'ASSET' || !('address' in sq.value.asset) || !('address' in bq.value.asset) ||
      !('address' in output.value) || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS') throw new Error('LENDING_GRAPH_INVALID');
  const f: LendingCompositionFields = { chain: s.chainId, collateral: sq.value.asset, borrowed: bq.value.asset,
    output: output.value, supplyAmount: sq.value.amount, borrowAmount: bq.value.amount, owner: owner.value.address, slippageBps: slip.maximumBps };
  if (canonicalJson(workflow) !== canonicalJson(createLendingCompositionWorkflow(workflow.workflowId, workflow.revision, f)))
    throw new Error('LENDING_GRAPH_INVALID');
  return f;
}

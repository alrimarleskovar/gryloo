// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import { createBorrowNode, readBorrowNode, type BorrowFields } from './borrow.js';
import type { SupplyNode } from './supply.js';
export const REPAY_ACTION = 'repay';
export type RepayFields = BorrowFields;
/** Canonical lending action; beneficiary denotes Aave's onBehalfOf. */
export function createRepayNode(nodeId: string, fields: RepayFields): SupplyNode {
  if (fields.interestRateMode !== 2) throw new Error('REPAY_RATE_MODE_INVALID');
  if (BigInt(fields.amount) === (1n << 256n) - 1n) throw new Error('REPAY_EXACT_AMOUNT_REQUIRED');
  const base = createBorrowNode(nodeId, fields);
  return { ...base, actionType: REPAY_ACTION, requiredCapabilities: ['aave-v3.repay'] };
}
export function readRepayNode(node: SupplyNode): RepayFields {
  const fields = readBorrowNode({ ...node, actionType: 'borrow', requiredCapabilities: ['aave-v3.borrow'] });
  const ordered = (n: SupplyNode) => ({ ...n, inputs: [...n.inputs].sort((a,b) => a.name.localeCompare(b.name)) });
  if (canonicalJson(ordered(node)) !== canonicalJson(ordered(createRepayNode(node.nodeId, fields)))) throw new Error('REPAY_DECLARATION_INVALID');
  return fields;
}

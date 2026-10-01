// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import { createSupplyNode, type SupplyFields, type SupplyNode } from './supply.js';
export const BORROW_ACTION = 'borrow';
export type BorrowFields = SupplyFields & { interestRateMode: 2 };
/** Environment-independent semantic action. Beneficiary is Aave's onBehalfOf. */
export function createBorrowNode(nodeId: string, fields: BorrowFields): SupplyNode {
  if (fields.interestRateMode !== 2) throw new Error('BORROW_RATE_MODE_INVALID');
  const base = createSupplyNode(nodeId, fields);
  return { ...base, actionType: BORROW_ACTION, requiredCapabilities: ['aave-v3.borrow'],
    inputs: [...base.inputs, { name: 'interest-rate-mode', kind: 'INTEGER', value: 2 }] };
}
export function readBorrowNode(node: SupplyNode): BorrowFields {
  const quantity = node.inputs.find(p => p.name === 'amount'), beneficiary = node.inputs.find(p => p.name === 'beneficiary');
  const rate = node.inputs.find(p => p.name === 'interest-rate-mode');
  if (quantity?.kind !== 'QUANTITY' || !('address' in quantity.value.asset) || beneficiary?.kind !== 'ACCOUNT' ||
      beneficiary.value.chainId !== node.chainId || rate?.kind !== 'INTEGER' || rate.value !== 2) throw new Error('BORROW_PORTS_INVALID');
  const fields: BorrowFields = { chain: node.chainId, asset: quantity.value.asset, amount: quantity.value.amount,
    beneficiary: beneficiary.value.address, interestRateMode: 2 };
  const ordered = (n: SupplyNode) => ({ ...n, inputs: [...n.inputs].sort((a,b) => a.name.localeCompare(b.name)) });
  if (canonicalJson(ordered(node)) !== canonicalJson(ordered(createBorrowNode(node.nodeId, fields)))) throw new Error('BORROW_DECLARATION_INVALID');
  return fields;
}

// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import type { SemanticWorkflow } from './semantic-workflow.js';
/** Token payments stay the chain-neutral asset.transfer action. No new IR schema. */
export type TokenPaymentFields = { chain: string; token: string; decimals: number; amount: string;
  recipient: string; memo: string; feeToken: string; maximumFee: string; adapterId: string };
type Node = SemanticWorkflow['nodes'][number];
export function createTokenPaymentNode(nodeId: string, f: TokenPaymentFields): Node {
  if (!/^eip155:[1-9][0-9]*$/.test(f.chain) || !/^[1-9][0-9]{0,77}$/.test(f.amount) || BigInt(f.amount) >= 1n << 256n ||
      !/^[1-9][0-9]{0,77}$/.test(f.maximumFee) || BigInt(f.maximumFee) >= 1n << 256n ||
      ![f.token, f.recipient, f.feeToken].every(a => /^0x[0-9a-f]{40}$/.test(a) && BigInt(a) !== 0n) ||
      !/^0x[0-9a-f]{64}$/.test(f.memo) || !Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 255) throw new Error('PAYMENT_FIELDS_INVALID');
  const quantity = { asset: { chainId: f.chain, address: f.token, decimals: f.decimals }, amount: f.amount };
  return { nodeId, actionType: 'asset.transfer', actionSchemaVersion: '1.0.0', chainId: f.chain,
    requiredCapabilities: [f.adapterId], adapterConstraints: { adapters: [{ id: f.adapterId, version: '1.0.0' }], protocols: ['tip20'] },
    inputs: [{ name: 'amount', kind: 'QUANTITY', value: quantity },
      { name: 'recipient', kind: 'ACCOUNT', value: { chainId: f.chain, address: f.recipient } },
      { name: 'memo', kind: 'IDENTIFIER', value: f.memo },
      { name: 'fee-budget', kind: 'QUANTITY', value: { asset: { chainId: f.chain, address: f.feeToken, decimals: f.decimals }, amount: f.maximumFee } }],
    expectedOutputs: [], dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [] };
}
export function readTokenPaymentNode(node: Node): TokenPaymentFields {
  const amount = node.inputs.find(p => p.name === 'amount'), recipient = node.inputs.find(p => p.name === 'recipient'),
    memo = node.inputs.find(p => p.name === 'memo'), fee = node.inputs.find(p => p.name === 'fee-budget');
  if (amount?.kind !== 'QUANTITY' || !('address' in amount.value.asset) || recipient?.kind !== 'ACCOUNT' || memo?.kind !== 'IDENTIFIER' ||
      fee?.kind !== 'QUANTITY' || !('address' in fee.value.asset)) throw new Error('PAYMENT_PORTS_INVALID');
  const fields = { chain: node.chainId, token: amount.value.asset.address, decimals: amount.value.asset.decimals, amount: amount.value.amount,
    recipient: recipient.value.address, memo: memo.value, feeToken: fee.value.asset.address, maximumFee: fee.value.amount,
    adapterId: node.adapterConstraints.adapters[0]?.id ?? '' };
  if (canonicalJson(node) !== canonicalJson(createTokenPaymentNode(node.nodeId, fields))) throw new Error('PAYMENT_DECLARATION_INVALID');
  return fields;
}

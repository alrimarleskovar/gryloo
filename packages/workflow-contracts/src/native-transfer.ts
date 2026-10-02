// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import type { SemanticWorkflow } from './semantic-workflow.js';
/** Chain-neutral transfer of an asset; the adapter decides how it executes. */
export const TRANSFER_ACTION = 'asset.transfer';
export const NATIVE_TRANSFER_ADAPTER = 'evm.native-transfer';
export type NativeTransferFields = { chain: string; amount: string; recipient: 'CONNECTED_OWNER' };
type Node = SemanticWorkflow['nodes'][number];
/** Owner binding is session state: authored intent names the connected owner, never an address. */
export function createNativeTransferNode(nodeId: string, fields: NativeTransferFields): Node {
  if (!/^eip155:[1-9][0-9]{0,18}$/.test(fields.chain) || !/^[1-9][0-9]{0,77}$/.test(fields.amount) ||
      BigInt(fields.amount) >= 1n << 256n || fields.recipient !== 'CONNECTED_OWNER') throw new Error('TRANSFER_FIELDS_INVALID');
  const quantity = { asset: { chainId: fields.chain, nativeId: 'ETH', decimals: 18 }, amount: fields.amount };
  return { nodeId, actionType: TRANSFER_ACTION, actionSchemaVersion: '1.0.0', chainId: fields.chain,
    requiredCapabilities: [NATIVE_TRANSFER_ADAPTER],
    adapterConstraints: { adapters: [{ id: NATIVE_TRANSFER_ADAPTER, version: '1.0.0' }], protocols: ['native'] },
    inputs: [{ name: 'amount', kind: 'QUANTITY', value: quantity }, { name: 'recipient', kind: 'IDENTIFIER', value: 'CONNECTED_OWNER' }],
    expectedOutputs: [], dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [] };
}
/** Closed semantic declaration: any extra port, constraint, lock or dependency is refused. */
export function readNativeTransferNode(node: Node): NativeTransferFields {
  const amount = node.inputs.find(p => p.name === 'amount'), recipient = node.inputs.find(p => p.name === 'recipient');
  if (amount?.kind !== 'QUANTITY' || !('nativeId' in amount.value.asset) || recipient?.kind !== 'IDENTIFIER' ||
      recipient.value !== 'CONNECTED_OWNER') throw new Error('TRANSFER_PORTS_INVALID');
  const fields: NativeTransferFields = { chain: node.chainId, amount: amount.value.amount, recipient: 'CONNECTED_OWNER' };
  const ordered = (n: Node) => ({ ...n, inputs: [...n.inputs].sort((a, b) => a.name.localeCompare(b.name)) });
  if (canonicalJson(ordered(node)) !== canonicalJson(ordered(createNativeTransferNode(node.nodeId, fields)))) throw new Error('TRANSFER_DECLARATION_INVALID');
  return fields;
}

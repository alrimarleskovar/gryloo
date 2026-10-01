// SPDX-License-Identifier: Apache-2.0
import { canonicalJson, hashRawBytes } from './canonical.js';
import type { SemanticWorkflow } from './semantic-workflow.js';
import type { Asset } from './common.js';
export const SUPPLY_ACTION = 'supply';
export const SUPPLY_PROTOCOL = 'aave-v3';
export type SupplyFields = { chain: string; asset: Asset & { address: string }; amount: string; beneficiary: string };
export type SupplyNode = SemanticWorkflow['nodes'][number];
export function supplyAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) throw new Error('SUPPLY_ADDRESS_INVALID');
  return value.toLowerCase();
}
export function createSupplyNode(nodeId: string, fields: SupplyFields): SupplyNode {
  if (!/^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/.test(fields.chain) || fields.asset.chainId !== fields.chain ||
      !Number.isInteger(fields.asset.decimals) || fields.asset.decimals < 0 || fields.asset.decimals > 255 ||
      !/^[1-9][0-9]{0,77}$/.test(fields.amount) || BigInt(fields.amount) >= 1n << 256n) throw new Error('SUPPLY_FIELDS_INVALID');
  const asset = { chainId: fields.chain, address: supplyAddress(fields.asset.address), decimals: fields.asset.decimals };
  const quantity = { asset, amount: fields.amount };
  return { nodeId, actionType: SUPPLY_ACTION, actionSchemaVersion: '1.0.0', chainId: fields.chain,
    requiredCapabilities: ['aave-v3.supply'], adapterConstraints: { adapters: [{ id: SUPPLY_PROTOCOL, version: '1.0.0' }], protocols: [SUPPLY_PROTOCOL] },
    inputs: [{ name: 'amount', kind: 'QUANTITY', value: quantity },
      { name: 'beneficiary', kind: 'ACCOUNT', value: { chainId: fields.chain, address: supplyAddress(fields.beneficiary) } }],
    expectedOutputs: [], dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [] };
}
/** Closed semantic declaration: no extra ports, connections, locks or constraints. */
export function readSupplyNode(node: SupplyNode): SupplyFields {
  const amount = node.inputs.find(p => p.name === 'amount');
  const beneficiary = node.inputs.find(p => p.name === 'beneficiary');
  if (amount?.kind !== 'QUANTITY' || !('address' in amount.value.asset) || beneficiary?.kind !== 'ACCOUNT' ||
      beneficiary.value.chainId !== node.chainId) throw new Error('SUPPLY_PORTS_INVALID');
  const fields = { chain: node.chainId, asset: amount.value.asset, amount: amount.value.amount, beneficiary: beneficiary.value.address };
  const canonical = createSupplyNode(node.nodeId, fields);
  const sorted = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
  // Input order is not semantic; all other structure is fixed by this action.
  if (sorted({ ...node, inputs: [...node.inputs].sort((a,b) => a.name.localeCompare(b.name)) }) !==
      sorted({ ...canonical, inputs: [...canonical.inputs].sort((a,b) => a.name.localeCompare(b.name)) })) throw new Error('SUPPLY_DECLARATION_INVALID');
  return fields;
}

/** Deterministic Supply review and transaction commitments using the frozen hash domains. */
export function hashSupplyValue(value:unknown,kind:'raw-response'|'payload'='raw-response'):string {
  return hashRawBytes(kind,new TextEncoder().encode(canonicalJson(value)));
}

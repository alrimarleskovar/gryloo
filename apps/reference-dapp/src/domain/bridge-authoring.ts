// SPDX-License-Identifier: AGPL-3.0-only
import { BRIDGE_ACTION, BRIDGE_SOURCE, BRIDGE_DESTINATION, BRIDGE_SOURCE_USDC, BRIDGE_DESTINATION_USDC,
  type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { parseSlippage } from './swap-authoring';
import type { Workflow } from './initial-workflow';

export type BridgeInput = { readonly amount: string; readonly slippageBps: string };
export function parseBridgeAmount(value: string): string {
  if (!/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) || value.length > 40) throw new Error('BRIDGE_AMOUNT_INVALID');
  const [whole = '', fraction = ''] = value.split('.');
  if (fraction.length > 6) throw new Error('BRIDGE_AMOUNT_PRECISION');
  const units = BigInt(whole + fraction.padEnd(6, '0'));
  if (units < 1n || units > 1_000_000_000_000n) throw new Error('BRIDGE_AMOUNT_OUT_OF_RANGE');
  return units.toString();
}
export function bridgeDetails(node: Workflow['nodes'][number]): { amount: string; units: string; slippageBps: number } | null {
  // BUILD-ROUTER-001 router nodes have their own details (recipient, routing policy); this reader is for BUILD-008/009/010 bridges.
  if (node.actionType !== BRIDGE_ACTION || node.adapterConstraints.adapters[0]?.id === 'flofi.router') return null;
  const input = node.inputs.find(p => p.name === 'amount-in');
  const slip = node.userConstraints.find(p => p.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (input?.kind !== 'QUANTITY' || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS') return null;
  const units = input.value.amount.padStart(7, '0');
  return { amount: units.slice(0, -6) + (units.slice(-6).replace(/0+$/, '') ? '.' + units.slice(-6).replace(/0+$/, '') : ''),
    units: input.value.amount, slippageBps: slip.maximumBps };
}
export function createBridgeNode(nodeId: string, input: BridgeInput): SemanticWorkflow['nodes'][number] {
  const units = parseBridgeAmount(input.amount);
  const slippage = parseSlippage(input.slippageBps);
  if (slippage < 1 || slippage > 300) throw new Error('BRIDGE_SLIPPAGE_OUT_OF_RANGE');
  const source = { chainId: BRIDGE_SOURCE, address: BRIDGE_SOURCE_USDC, decimals: 6 };
  const destination = { chainId: BRIDGE_DESTINATION, address: BRIDGE_DESTINATION_USDC, decimals: 6 };
  return {
    nodeId, actionType: BRIDGE_ACTION, actionSchemaVersion: '1.0.0', chainId: BRIDGE_SOURCE,
    requiredCapabilities: ['bridge.direct-transaction'],
    adapterConstraints: { adapters: [{ id: 'lifi.rest', version: '1.0.0' }], protocols: ['lifi'] },
    inputs: [{ name: 'amount-in', kind: 'QUANTITY', value: { asset: source, amount: units } },
      { name: 'asset-out', kind: 'ASSET', value: destination }],
    expectedOutputs: [{ outputId: 'amount-out', asset: destination, minimumAmount: '0' }],
    dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: source, amount: units } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: slippage }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [],
    editableBounds: [{ parameterName: 'amount-in', asset: source, minimumAmount: '1', maximumAmount: '1000000000000' }],
  };
}

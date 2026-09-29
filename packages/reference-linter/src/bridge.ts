// SPDX-License-Identifier: AGPL-3.0-only
import { BRIDGE_ACTION, BRIDGE_SOURCE, BRIDGE_DESTINATION, BRIDGE_SOURCE_USDC, BRIDGE_DESTINATION_USDC,
  type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
const fail = (): never => { throw new Error('INVALID_BRIDGE_DECLARATION'); };
const A = 'eip155:42161', A_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
export function validateBridgeWorkflow(workflow: SemanticWorkflow): void {
  if (workflow.nodes.length !== 1 || workflow.resourceEdges.length !== 0) fail();
  const node = workflow.nodes[0]!;
  const across = node.adapterConstraints.adapters[0]?.id === 'across.direct';
  if (node.actionType !== BRIDGE_ACTION || node.actionSchemaVersion !== '1.0.0' || node.chainId !== BRIDGE_SOURCE
    || node.requiredCapabilities.length !== 1 || node.requiredCapabilities[0] !== 'bridge.direct-transaction'
    || node.adapterConstraints.adapters.length !== 1 || node.adapterConstraints.adapters[0]?.id !== (across ? 'across.direct' : 'lifi.rest')
    || node.adapterConstraints.adapters[0]?.version !== '1.0.0'
    || node.adapterConstraints.protocols.length !== 1 || node.adapterConstraints.protocols[0] !== (across ? 'across' : 'lifi')
    || node.requiredAuthorizationClass !== 'MODE_A' || node.failurePolicy !== 'ABORT'
    || node.dependencies.length || node.inputs.length !== 2 || node.expectedOutputs.length !== 1
    || node.userConstraints.length !== 2 || node.lockedParameters.length !== 0 || node.editableBounds.length !== 1) fail();
  const amount = node.inputs.find(x => x.name === 'amount-in');
  const out = node.inputs.find(x => x.name === 'asset-out');
  const max = node.userConstraints.find(x => x.kind === 'MAXIMUM_INPUT');
  const slip = node.userConstraints.find(x => x.kind === 'MAXIMUM_SLIPPAGE_BPS');
  const bound = node.editableBounds[0];
  const source = amount?.kind === 'QUANTITY' ? amount.value.asset : null;
  const destination = out?.kind === 'ASSET' ? out.value : null;
  if (amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || max?.kind !== 'MAXIMUM_INPUT'
    || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' || !source || !destination
    || !('address' in source) || !('address' in destination)
    || source.chainId !== BRIDGE_SOURCE || source.address !== BRIDGE_SOURCE_USDC || source.decimals !== 6
    || destination.chainId !== (across ? A : BRIDGE_DESTINATION) || destination.address !== (across ? A_USDC : BRIDGE_DESTINATION_USDC) || destination.decimals !== 6
    || !/^[1-9][0-9]*$/.test(amount.value.amount) || BigInt(amount.value.amount) > 1_000_000_000_000n
    || JSON.stringify(max.quantity) !== JSON.stringify(amount.value)
    || slip.maximumBps < 1 || slip.maximumBps > 300
    || node.expectedOutputs[0]?.outputId !== 'amount-out'
    || JSON.stringify(node.expectedOutputs[0]?.asset) !== JSON.stringify(destination)
    || node.expectedOutputs[0]?.minimumAmount !== '0'
    || bound?.parameterName !== 'amount-in' || JSON.stringify(bound.asset) !== JSON.stringify(source)
    || bound.minimumAmount !== '1' || bound.maximumAmount !== '1000000000000') fail();
}

// SPDX-License-Identifier: AGPL-3.0-only
import { BRIDGE_SOURCE, BRIDGE_SOURCE_USDC, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
const A = 'eip155:42161', USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const WETH = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
const fail = (): never => { throw new Error('BRIDGE_SWAP_GRAPH_INVALID'); };
export function validateBridgeSwapWorkflow(w: SemanticWorkflow): void {
  if (w.nodes.length !== 2 || w.resourceEdges.length !== 1) fail();
  const b = w.nodes.find(n => n.actionType === 'asset.bridge');
  const s = w.nodes.find(n => n.actionType === 'asset.swap.exact-input');
  if (!b || !s) throw new Error('BRIDGE_SWAP_GRAPH_INVALID');
  if (b.nodeId === s.nodeId || b.chainId !== BRIDGE_SOURCE || s.chainId !== A
    || b.actionSchemaVersion !== '1.0.0' || s.actionSchemaVersion !== '1.0.0'
    || b.requiredCapabilities.join() !== 'bridge.direct-transaction' || s.requiredCapabilities.join() !== 'swap.direct-transaction'
    || b.adapterConstraints.adapters.length !== 1 || b.adapterConstraints.adapters[0]?.id !== 'lifi.rest'
    || s.adapterConstraints.adapters.length !== 1 || s.adapterConstraints.adapters[0]?.id !== 'lifi.rest'
    || b.adapterConstraints.protocols.join() !== 'lifi' || s.adapterConstraints.protocols.join() !== 'lifi'
    || b.requiredAuthorizationClass !== 'MODE_A' || s.requiredAuthorizationClass !== 'MODE_A'
    || b.failurePolicy !== 'ABORT' || s.failurePolicy !== 'ABORT' || b.dependencies.length !== 0
    || s.dependencies.join() !== b.nodeId || b.inputs.length !== 2 || s.inputs.length !== 2
    || b.expectedOutputs.length !== 1 || s.expectedOutputs.length !== 1 || b.userConstraints.length !== 2
    || s.userConstraints.length !== 1 || b.lockedParameters.length || s.lockedParameters.length
    || b.editableBounds.length !== 1 || s.editableBounds.length !== 0) fail();
  const bi = b.inputs.find(i => i.name === 'amount-in'); const bo = b.inputs.find(i => i.name === 'asset-out');
  const si = s.inputs.find(i => i.name === 'amount-in'); const so = s.inputs.find(i => i.name === 'asset-out');
  const bridgeSlip = b.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  const swapSlip = s.userConstraints[0]; const max = b.userConstraints.find(c => c.kind === 'MAXIMUM_INPUT');
  const src = { chainId: BRIDGE_SOURCE, address: BRIDGE_SOURCE_USDC, decimals: 6 };
  const usdc = { chainId: A, address: USDC, decimals: 6 }; const weth = { chainId: A, address: WETH, decimals: 18 };
  if (bi?.kind !== 'QUANTITY' || bo?.kind !== 'ASSET' || si?.kind !== 'OUTPUT_REFERENCE' || so?.kind !== 'ASSET'
    || JSON.stringify(bi.value.asset) !== JSON.stringify(src) || JSON.stringify(bo.value) !== JSON.stringify(usdc)
    || JSON.stringify(so.value) !== JSON.stringify(weth) || !/^[1-9][0-9]*$/.test(bi.value.amount)
    || BigInt(bi.value.amount) > 1_000_000_000_000n || max?.kind !== 'MAXIMUM_INPUT'
    || JSON.stringify(max.quantity) !== JSON.stringify(bi.value)
    || bridgeSlip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' || bridgeSlip.maximumBps < 1 || bridgeSlip.maximumBps > 300
    || swapSlip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' || swapSlip.maximumBps < 1 || swapSlip.maximumBps > 300
    || si.value.nodeId !== b.nodeId || si.value.outputId !== 'amount-out'
    || b.expectedOutputs[0]?.outputId !== 'amount-out' || s.expectedOutputs[0]?.outputId !== 'amount-out'
    || JSON.stringify(b.expectedOutputs[0]?.asset) !== JSON.stringify(usdc)
    || JSON.stringify(s.expectedOutputs[0]?.asset) !== JSON.stringify(weth)
    || b.expectedOutputs[0]?.minimumAmount !== '0' || s.expectedOutputs[0]?.minimumAmount !== '0'
    || b.editableBounds[0]?.parameterName !== 'amount-in' || JSON.stringify(b.editableBounds[0]?.asset) !== JSON.stringify(src)
    || b.editableBounds[0]?.minimumAmount !== '1' || b.editableBounds[0]?.maximumAmount !== '1000000000000') fail();
  const edge = w.resourceEdges[0]!;
  if (edge.fromNodeId !== b.nodeId || edge.toNodeId !== s.nodeId || edge.outputId !== 'amount-out' || edge.inputName !== 'amount-in') fail();
}

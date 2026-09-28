// SPDX-License-Identifier: AGPL-3.0-only
/** Strict additive BUILD-007 graph profile over the frozen v1 IR. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { assetSymbol, type ReviewContext } from './context.js';
import { LIQUIDITY_ACTION, parseTick, POSITION_MANAGER_ASSET } from './liquidity.js';

export type CompositionDetails = { readonly swapId: string; readonly mintId: string; readonly inputUSDC: bigint;
  readonly maxWETH: bigint; readonly maxUSDC: bigint; readonly minWETH: bigint; readonly minUSDC: bigint;
  readonly tickLower: number; readonly tickUpper: number; readonly slippageBps: number; readonly recipient: string };
const decimal = (v: unknown): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v)) throw new Error('COMPOSITION_AMOUNT_INVALID');
  const n = BigInt(v);
  if (n >= 1n << 256n) throw new Error('COMPOSITION_AMOUNT_INVALID');
  return n;
};
export function validateCompositionWorkflow(workflow: SemanticWorkflow, context: ReviewContext): CompositionDetails {
  const reject = (): never => { throw new Error('COMPOSITION_GRAPH_INVALID'); };
  if (workflow.nodes.length !== 2 || workflow.resourceEdges.length !== 1) return reject();
  const swap = workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input');
  const mint = workflow.nodes.find(n => n.actionType === LIQUIDITY_ACTION);
  if (!swap || !mint || swap.nodeId === mint.nodeId || swap.chainId !== 'eip155:8453' || mint.chainId !== 'eip155:8453' ||
      swap.actionSchemaVersion !== '1.0.0' || mint.actionSchemaVersion !== '1.0.0' ||
      swap.requiredAuthorizationClass !== 'MODE_B' || mint.requiredAuthorizationClass !== 'MODE_B' ||
      swap.requiredCapabilities.length !== 1 || swap.requiredCapabilities[0] !== 'swap.direct-transaction' ||
      mint.requiredCapabilities.length !== 1 || mint.requiredCapabilities[0] !== 'liquidity.position-direct' ||
      swap.adapterConstraints.adapters.length || mint.adapterConstraints.adapters.length ||
      swap.adapterConstraints.protocols.length !== 1 || swap.adapterConstraints.protocols[0] !== 'uniswap' ||
      mint.adapterConstraints.protocols.length !== 1 || mint.adapterConstraints.protocols[0] !== 'uniswap-v3' ||
      swap.failurePolicy !== 'ABORT' || mint.failurePolicy !== 'ABORT' || swap.dependencies.length ||
      mint.dependencies.length !== 1 || mint.dependencies[0] !== swap.nodeId ||
      swap.lockedParameters.length || mint.lockedParameters.length || mint.editableBounds.length ||
      swap.editableBounds.length !== 1 || swap.editableBounds[0]?.parameterName !== 'amount-in') return reject();
  const edge = workflow.resourceEdges[0]!;
  if (edge.fromNodeId !== swap.nodeId || edge.outputId !== 'amount-out' || edge.toNodeId !== mint.nodeId || edge.inputName !== 'weth-from-swap') return reject();
  if (swap.inputs.length !== 2 || mint.inputs.length !== 9 || new Set(mint.inputs.map(i => i.name)).size !== 9) return reject();
  const si = new Map(swap.inputs.map(i => [i.name, i]));
  const mi = new Map(mint.inputs.map(i => [i.name, i]));
  const from = si.get('amount-in'), out = si.get('asset-out'), ref = mi.get('weth-from-swap');
  if (from?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || ref?.kind !== 'OUTPUT_REFERENCE' ||
      assetSymbol(from.value.asset, context) !== 'USDC' || assetSymbol(out.value, context) !== 'WETH' ||
      ref.value.nodeId !== swap.nodeId || ref.value.outputId !== 'amount-out' ||
      swap.expectedOutputs.length !== 1 || swap.expectedOutputs[0]?.outputId !== 'amount-out' ||
      assetSymbol(swap.expectedOutputs[0].asset, context) !== 'WETH' || swap.expectedOutputs[0].minimumAmount !== '0') return reject();
  if (mint.expectedOutputs.length !== 1 || mint.expectedOutputs[0]?.outputId !== 'position-nft' ||
      JSON.stringify(mint.expectedOutputs[0].asset) !== JSON.stringify(POSITION_MANAGER_ASSET) ||
      mint.expectedOutputs[0].minimumAmount !== '1') return reject();
  const q = (name: string, symbol: 'WETH' | 'USDC') => {
    const i = mi.get(name);
    if (i?.kind !== 'QUANTITY' || assetSymbol(i.value.asset, context) !== symbol) return reject();
    return decimal(i.value.amount);
  };
  const maxWETH = q('amount0-max', 'WETH'), maxUSDC = q('amount1-max', 'USDC');
  const minWETH = q('amount0-min', 'WETH'), minUSDC = q('amount1-min', 'USDC');
  const lower = mi.get('tick-lower'), upper = mi.get('tick-upper'), fee = mi.get('fee-tier'), recipient = mi.get('recipient');
  if (lower?.kind !== 'IDENTIFIER' || upper?.kind !== 'IDENTIFIER' || fee?.kind !== 'INTEGER' || fee.value !== 500 ||
      recipient?.kind !== 'ACCOUNT' || recipient.value.chainId !== 'eip155:8453' || !/^0x[0-9a-f]{40}$/.test(recipient.value.address)) return reject();
  const tickLower = parseTick(lower.value), tickUpper = parseTick(upper.value);
  if (tickLower >= tickUpper || tickLower % 10 || tickUpper % 10) return reject();
  const inputUSDC = decimal(from.value.amount);
  const bound = swap.editableBounds[0]!;
  if (assetSymbol(bound.asset, context) !== 'USDC' || decimal(bound.minimumAmount) < 1n ||
      decimal(bound.minimumAmount) > inputUSDC || decimal(bound.maximumAmount) < inputUSDC ||
      decimal(bound.maximumAmount) > decimal(context.assets.USDC.maximumAmountUnits)) return reject();
  if (!inputUSDC || !maxWETH || !maxUSDC || !minWETH || !minUSDC || minWETH > maxWETH || minUSDC > maxUSDC ||
      inputUSDC > decimal(context.assets.USDC.maximumAmountUnits) ||
      inputUSDC + maxUSDC > decimal(context.assets.USDC.maximumAmountUnits) ||
      maxUSDC > decimal(context.assets.USDC.maximumAmountUnits) || maxWETH > decimal(context.assets.WETH.maximumAmountUnits)) return reject();
  if (swap.userConstraints.length !== 2 || swap.userConstraints[0]?.kind !== 'MAXIMUM_INPUT' ||
      assetSymbol(swap.userConstraints[0].quantity.asset, context) !== 'USDC' ||
      swap.userConstraints[0].quantity.amount !== from.value.amount || swap.userConstraints[1]?.kind !== 'MAXIMUM_SLIPPAGE_BPS') return reject();
  const slippageBps = swap.userConstraints[1].maximumBps;
  if (!Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 300) return reject();
  const constraints = mint.userConstraints;
  if (constraints.length !== 2 || constraints.some(c => c.kind !== 'MAXIMUM_INPUT') ||
      !constraints.some(c => c.kind === 'MAXIMUM_INPUT' && assetSymbol(c.quantity.asset, context) === 'WETH' && c.quantity.amount === maxWETH.toString()) ||
      !constraints.some(c => c.kind === 'MAXIMUM_INPUT' && assetSymbol(c.quantity.asset, context) === 'USDC' && c.quantity.amount === maxUSDC.toString())) return reject();
  return { swapId: swap.nodeId, mintId: mint.nodeId, inputUSDC, maxWETH, maxUSDC, minWETH, minUSDC,
    tickLower, tickUpper, slippageBps, recipient: recipient.value.address };
}

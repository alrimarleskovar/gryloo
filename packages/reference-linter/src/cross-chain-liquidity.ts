// SPDX-License-Identifier: AGPL-3.0-only
/** Closed BUILD-011C-1 graph profile; no calldata or provider fallback is accepted. */
import { BRIDGE_SOURCE, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { parseTick } from './liquidity.js';
const A = 'eip155:42161';
const usdc = { chainId: A, address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 };
const weth = { chainId: A, address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', decimals: 18 };
const nft = { chainId: A, address: '0xc36442b4a4522e871399cd717abdd847ab11fe88', decimals: 0 };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (): never => { throw new Error('CROSS_CHAIN_LIQUIDITY_GRAPH_INVALID'); };
export type CrossChainLiquidityDetails = { readonly bridgeProvider: 'lifi.rest' | 'across.direct'; readonly noSwap: boolean;
  readonly tickLower: number; readonly tickUpper: number; readonly recipient: string; readonly bridgeAmount: string;
  readonly bridgeSlippageBps: number; readonly swapSlippageBps: number };
export function validateCrossChainLiquidityWorkflow(workflow: SemanticWorkflow): CrossChainLiquidityDetails {
  const bridge = workflow.nodes.find(n => n.actionType === 'asset.bridge');
  const prep = workflow.nodes.find(n => n.actionType === 'asset.liquidity.prepare');
  const swap = workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input');
  const mint = workflow.nodes.find(n => n.actionType === 'asset.liquidity.uniswap-v3');
  if (!bridge || !prep || !mint) return fail();
  const noSwap = !swap;
  if (workflow.nodes.length !== (noSwap ? 3 : 4) ||
      workflow.resourceEdges.length !== (noSwap ? 3 : 4) ||
      new Set(workflow.nodes.map(n => n.nodeId)).size !== workflow.nodes.length || bridge.chainId !== BRIDGE_SOURCE ||
      prep.chainId !== A || mint.chainId !== A || swap && swap.chainId !== A) fail();
  const provider = bridge.adapterConstraints.adapters[0]?.id;
  if (provider !== 'lifi.rest' && provider !== 'across.direct') fail();
  if (bridge.actionSchemaVersion !== '1.0.0' || bridge.requiredCapabilities.join() !== 'bridge.direct-transaction' ||
      bridge.adapterConstraints.adapters.length !== 1 || bridge.adapterConstraints.adapters[0]?.version !== '1.0.0' ||
      !same(bridge.adapterConstraints.protocols, [provider === 'across.direct' ? 'across' : 'lifi']) ||
      bridge.requiredAuthorizationClass !== 'MODE_A' || bridge.failurePolicy !== 'ABORT' || bridge.dependencies.length ||
      bridge.inputs.length !== 2 || bridge.inputs[0]?.name !== 'amount-in' || bridge.inputs[0].kind !== 'QUANTITY' ||
      bridge.inputs[1]?.name !== 'asset-out' || bridge.inputs[1].kind !== 'ASSET' || !same(bridge.inputs[1].value, usdc) ||
      bridge.expectedOutputs.length !== 1 || bridge.expectedOutputs[0]?.outputId !== 'amount-out' ||
      bridge.expectedOutputs[0].minimumAmount !== '0' || bridge.userConstraints.length !== 2 ||
      bridge.lockedParameters.length || bridge.editableBounds.length !== 1) fail();
  const bridgeAmount = bridge.inputs.find(i => i.name === 'amount-in');
  const bridgeSlip = bridge.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (bridgeAmount?.kind !== 'QUANTITY' || bridgeSlip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' ||
      !same(bridge.expectedOutputs[0]?.asset, usdc)) fail();
  const input = prep.inputs;
  if (prep.actionSchemaVersion !== '1.0.0' || prep.actionType !== 'asset.liquidity.prepare' ||
      prep.requiredCapabilities.length || prep.adapterConstraints.adapters.length ||
      !same(prep.adapterConstraints.protocols, ['uniswap-v3']) || prep.requiredAuthorizationClass !== 'MODE_A' ||
      prep.failurePolicy !== 'ABORT' || !same(prep.dependencies, [bridge.nodeId]) || prep.userConstraints.length ||
      prep.lockedParameters.length || prep.editableBounds.length || input.length !== 4 ||
      input[0]?.name !== 'amount-in' || input[0].kind !== 'OUTPUT_REFERENCE' ||
      !same(input[0].value, { nodeId: bridge.nodeId, outputId: 'amount-out' }) ||
      input[1]?.name !== 'tick-lower' || input[1].kind !== 'IDENTIFIER' ||
      input[2]?.name !== 'tick-upper' || input[2].kind !== 'IDENTIFIER' ||
      input[3]?.name !== 'fee-tier' || input[3].kind !== 'INTEGER' || input[3].value !== 500 ||
      !same(prep.expectedOutputs, [{ outputId: 'swap-input', asset: usdc, minimumAmount: '0' },
        { outputId: 'liquidity-usdc', asset: usdc, minimumAmount: '0' },
        ...(noSwap ? [{ outputId: 'liquidity-weth', asset: weth, minimumAmount: '0' }] : [])])) fail();
  const tickLower = parseTick(input[1]!.value as string), tickUpper = parseTick(input[2]!.value as string);
  if (tickLower >= tickUpper || tickLower % 10 || tickUpper % 10) fail();
  let swapSlippageBps = 0;
  if (swap) {
    const swapSlip = swap.userConstraints[0];
    if (swap.actionSchemaVersion !== '1.0.0' || swap.requiredCapabilities.join() !== 'swap.direct-transaction' ||
        !same(swap.adapterConstraints.adapters, [{ id: 'lifi.rest', version: '1.0.0' }]) ||
        !same(swap.adapterConstraints.protocols, ['lifi']) || swap.requiredAuthorizationClass !== 'MODE_A' ||
        swap.failurePolicy !== 'ABORT' || !same(swap.dependencies, [prep.nodeId]) || swap.inputs.length !== 2 ||
        swap.inputs[0]?.name !== 'amount-in' || swap.inputs[0].kind !== 'OUTPUT_REFERENCE' ||
        !same(swap.inputs[0].value, { nodeId: prep.nodeId, outputId: 'swap-input' }) ||
        swap.inputs[1]?.name !== 'asset-out' || swap.inputs[1].kind !== 'ASSET' || !same(swap.inputs[1].value, weth) ||
        !same(swap.expectedOutputs, [{ outputId: 'amount-out', asset: weth, minimumAmount: '0' }]) ||
        swap.userConstraints.length !== 1 || swapSlip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' ||
        swapSlip.maximumBps < 1 || swapSlip.maximumBps > 300 || swap.lockedParameters.length || swap.editableBounds.length) fail();
    swapSlippageBps = (swapSlip as { maximumBps: number }).maximumBps;
  }
  const mintInput = mint.inputs;
  const recipient = mintInput[7];
  if (mint.actionSchemaVersion !== '1.0.0' || mint.requiredCapabilities.join() !== 'liquidity.position-direct' ||
      mint.adapterConstraints.adapters.length || !same(mint.adapterConstraints.protocols, ['uniswap-v3']) ||
      mint.requiredAuthorizationClass !== 'MODE_A' || mint.failurePolicy !== 'ABORT' ||
      !same(mint.dependencies, noSwap ? [prep.nodeId] : [prep.nodeId, swap!.nodeId]) ||
      mintInput.length !== 8 || mintInput[0]?.name !== 'amount0-max' || mintInput[0].kind !== 'OUTPUT_REFERENCE' ||
      !same(mintInput[0].value, { nodeId: noSwap ? prep.nodeId : swap!.nodeId, outputId: noSwap ? 'liquidity-weth' : 'amount-out' }) ||
      mintInput[1]?.name !== 'amount1-max' || mintInput[1].kind !== 'OUTPUT_REFERENCE' ||
      !same(mintInput[1].value, { nodeId: prep.nodeId, outputId: 'liquidity-usdc' }) ||
      !same(mintInput[2], { name: 'amount0-min', kind: 'QUANTITY', value: { asset: weth, amount: '0' } }) ||
      !same(mintInput[3], { name: 'amount1-min', kind: 'QUANTITY', value: { asset: usdc, amount: '0' } }) ||
      !same(mintInput[4], input[1]) || !same(mintInput[5], input[2]) || !same(mintInput[6], input[3]) ||
      recipient?.name !== 'recipient' || recipient.kind !== 'ACCOUNT' || recipient.value.chainId !== A ||
      !/^0x[0-9a-f]{40}$/.test(recipient.value.address) || !same(mint.expectedOutputs, [{ outputId: 'position-nft', asset: nft, minimumAmount: '1' },
        { outputId: 'residual-weth', asset: weth, minimumAmount: '0' },
        { outputId: 'residual-usdc', asset: usdc, minimumAmount: '0' }]) ||
      mint.userConstraints.length || mint.lockedParameters.length || mint.editableBounds.length) fail();
  const edges = [{ fromNodeId: bridge.nodeId, outputId: 'amount-out', toNodeId: prep.nodeId, inputName: 'amount-in' },
    ...(!noSwap ? [{ fromNodeId: prep.nodeId, outputId: 'swap-input', toNodeId: swap!.nodeId, inputName: 'amount-in' }] : []),
    { fromNodeId: prep.nodeId, outputId: 'liquidity-usdc', toNodeId: mint.nodeId, inputName: 'amount1-max' },
    { fromNodeId: noSwap ? prep.nodeId : swap!.nodeId, outputId: noSwap ? 'liquidity-weth' : 'amount-out',
      toNodeId: mint.nodeId, inputName: 'amount0-max' }];
  if (!same(workflow.resourceEdges, edges)) fail();
  return { bridgeProvider: provider as 'lifi.rest' | 'across.direct', noSwap, tickLower, tickUpper,
    recipient: (recipient as { value: { address: string } }).value.address,
    bridgeAmount: (bridgeAmount as { value: { amount: string } }).value.amount,
    bridgeSlippageBps: (bridgeSlip as { maximumBps: number }).maximumBps, swapSlippageBps };
}

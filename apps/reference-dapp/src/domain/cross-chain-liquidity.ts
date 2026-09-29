// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-011C-1 typed bridge → preparation → optional swap → v3 mint graph. */
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBridgeSwapWorkflow, ARBITRUM, ARBITRUM_USDC, ARBITRUM_WETH } from './bridge-swap-authoring';
import { createAcrossWorkflow } from './across-authoring';
import { parseTick } from '@defi-workflow-engine/reference-linter';
import { parseBridgeAmount } from './bridge-authoring';
import { parseSlippage } from './swap-authoring';

const usdc = { chainId: ARBITRUM, address: ARBITRUM_USDC, decimals: 6 };
const weth = { chainId: ARBITRUM, address: ARBITRUM_WETH, decimals: 18 };
const nft = { chainId: ARBITRUM, address: '0xc36442b4a4522e871399cd717abdd847ab11fe88', decimals: 0 };
export type CrossChainLiquidityInput = { readonly amount: string; readonly bridgeSlippageBps: string;
  readonly swapSlippageBps: string; readonly tickLower: string; readonly tickUpper: string;
  readonly recipient: string; readonly provider: 'lifi.rest' | 'across.direct'; readonly noSwap: boolean };
export function createCrossChainLiquidityWorkflow(workflowId: string, revision: number, input: CrossChainLiquidityInput): SemanticWorkflow {
  parseBridgeAmount(input.amount);
  const bridgeBps = parseSlippage(input.bridgeSlippageBps), swapBps = parseSlippage(input.swapSlippageBps);
  const lower = parseTick(`tick:${input.tickLower}`), upper = parseTick(`tick:${input.tickUpper}`);
  if (bridgeBps < 1 || bridgeBps > 300 || swapBps < 1 || swapBps > 300 || lower >= upper || lower % 10 || upper % 10 ||
      !/^0x[0-9a-f]{40}$/.test(input.recipient) || !Number.isSafeInteger(revision) || revision < 1)
    throw new Error('CROSS_CHAIN_LIQUIDITY_INPUT_INVALID');
  const bridgeInput = { amount: input.amount, slippageBps: input.bridgeSlippageBps };
  const base = input.provider === 'lifi.rest'
    ? createBridgeSwapWorkflow(workflowId, revision, { ...bridgeInput, swapSlippageBps: input.swapSlippageBps }).nodes[0]!
    : input.provider === 'across.direct' ? createAcrossWorkflow(workflowId, revision, bridgeInput).nodes[0]!
      : (() => { throw new Error('CROSS_CHAIN_PROVIDER_INVALID'); })();
  const bridge = { ...base, nodeId: 'build011c-bridge' };
  const prepare: SemanticWorkflow['nodes'][number] = {
    nodeId: 'build011c-prepare', actionType: 'asset.liquidity.prepare', actionSchemaVersion: '1.0.0', chainId: ARBITRUM,
    requiredCapabilities: [], adapterConstraints: { adapters: [], protocols: ['uniswap-v3'] },
    inputs: [{ name: 'amount-in', kind: 'OUTPUT_REFERENCE', value: { nodeId: bridge.nodeId, outputId: 'amount-out' } },
      { name: 'tick-lower', kind: 'IDENTIFIER', value: `tick:${lower}` },
      { name: 'tick-upper', kind: 'IDENTIFIER', value: `tick:${upper}` },
      { name: 'fee-tier', kind: 'INTEGER', value: 500 }],
    expectedOutputs: [{ outputId: 'swap-input', asset: usdc, minimumAmount: '0' },
      { outputId: 'liquidity-usdc', asset: usdc, minimumAmount: '0' }],
    dependencies: [bridge.nodeId], userConstraints: [], failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A',
    lockedParameters: [], editableBounds: [],
  };
  const swap: SemanticWorkflow['nodes'][number] = {
    nodeId: 'build011c-swap', actionType: 'asset.swap.exact-input', actionSchemaVersion: '1.0.0', chainId: ARBITRUM,
    requiredCapabilities: ['swap.direct-transaction'], adapterConstraints: { adapters: [{ id: 'lifi.rest', version: '1.0.0' }], protocols: ['lifi'] },
    inputs: [{ name: 'amount-in', kind: 'OUTPUT_REFERENCE', value: { nodeId: prepare.nodeId, outputId: 'swap-input' } },
      { name: 'asset-out', kind: 'ASSET', value: weth }],
    expectedOutputs: [{ outputId: 'amount-out', asset: weth, minimumAmount: '0' }], dependencies: [prepare.nodeId],
    userConstraints: [{ kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: swapBps }], failurePolicy: 'ABORT',
    requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [],
  };
  const mint: SemanticWorkflow['nodes'][number] = {
    nodeId: 'build011c-mint', actionType: 'asset.liquidity.uniswap-v3', actionSchemaVersion: '1.0.0', chainId: ARBITRUM,
    requiredCapabilities: ['liquidity.position-direct'], adapterConstraints: { adapters: [], protocols: ['uniswap-v3'] },
    inputs: [{ name: 'amount0-max', kind: 'OUTPUT_REFERENCE', value: { nodeId: input.noSwap ? prepare.nodeId : swap.nodeId,
      outputId: input.noSwap ? 'liquidity-weth' : 'amount-out' } },
      { name: 'amount1-max', kind: 'OUTPUT_REFERENCE', value: { nodeId: prepare.nodeId, outputId: 'liquidity-usdc' } },
      { name: 'amount0-min', kind: 'QUANTITY', value: { asset: weth, amount: '0' } },
      { name: 'amount1-min', kind: 'QUANTITY', value: { asset: usdc, amount: '0' } },
      { name: 'tick-lower', kind: 'IDENTIFIER', value: `tick:${lower}` },
      { name: 'tick-upper', kind: 'IDENTIFIER', value: `tick:${upper}` },
      { name: 'fee-tier', kind: 'INTEGER', value: 500 },
      { name: 'recipient', kind: 'ACCOUNT', value: { chainId: ARBITRUM, address: input.recipient } }],
    expectedOutputs: [{ outputId: 'position-nft', asset: nft, minimumAmount: '1' },
      { outputId: 'residual-weth', asset: weth, minimumAmount: '0' },
      { outputId: 'residual-usdc', asset: usdc, minimumAmount: '0' }],
    dependencies: input.noSwap ? [prepare.nodeId] : [prepare.nodeId, swap.nodeId],
    userConstraints: [], failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [],
  };
  if (input.noSwap) {
    // Explicitly model zero WETH as a deterministic preparation output for a USDC-only range.
    prepare.expectedOutputs.push({ outputId: 'liquidity-weth', asset: weth, minimumAmount: '0' });
  }
  const nodes = input.noSwap ? [bridge, prepare, mint] : [bridge, prepare, swap, mint];
  const edges = [{ fromNodeId: bridge.nodeId, outputId: 'amount-out', toNodeId: prepare.nodeId, inputName: 'amount-in' },
    ...(!input.noSwap ? [{ fromNodeId: prepare.nodeId, outputId: 'swap-input', toNodeId: swap.nodeId, inputName: 'amount-in' }] : []),
    { fromNodeId: prepare.nodeId, outputId: 'liquidity-usdc', toNodeId: mint.nodeId, inputName: 'amount1-max' },
    { fromNodeId: input.noSwap ? prepare.nodeId : swap.nodeId, outputId: input.noSwap ? 'liquidity-weth' : 'amount-out',
      toNodeId: mint.nodeId, inputName: 'amount0-max' }];
  return { schemaVersion: '1.0.0', workflowId, revision, nodes, resourceEdges: edges };
}

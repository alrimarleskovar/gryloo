// SPDX-License-Identifier: AGPL-3.0-only
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { LIQUIDITY_ACTION, LIQUIDITY_CAPABILITY, POSITION_MANAGER_ASSET, parseTick, validateLiquidityNode,
  type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { parseHumanAmount } from './swap-authoring';
export { LIQUIDITY_ACTION };
export type LiquidityInput = { readonly weth: string; readonly usdc: string; readonly tickLower: string;
  readonly tickUpper: string; readonly recipient: string; readonly minimumWeth: string; readonly minimumUsdc: string };
export function createLiquidityNode(nodeId: string, input: LiquidityInput, context: ReviewContext): SemanticWorkflow['nodes'][number] {
  const weth = parseHumanAmount(input.weth, 'WETH', context);
  const usdc = parseHumanAmount(input.usdc, 'USDC', context);
  const minWeth = input.minimumWeth === '0' ? '0' : parseHumanAmount(input.minimumWeth, 'WETH', context);
  const minUsdc = input.minimumUsdc === '0' ? '0' : parseHumanAmount(input.minimumUsdc, 'USDC', context);
  if (BigInt(minWeth) > BigInt(weth) || BigInt(minUsdc) > BigInt(usdc)) throw new Error('LIQUIDITY_MINIMUM_EXCEEDS_MAXIMUM');
  const lower = parseTick(`tick:${input.tickLower}`), upper = parseTick(`tick:${input.tickUpper}`);
  if (lower >= upper || lower % 10 !== 0 || upper % 10 !== 0) throw new Error('LIQUIDITY_RANGE_INVALID');
  if (!/^0x[0-9a-f]{40}$/.test(input.recipient)) throw new Error('LIQUIDITY_RECIPIENT_INVALID');
  const token0 = context.assets.WETH.asset, token1 = context.assets.USDC.asset;
  const node: SemanticWorkflow['nodes'][number] = {
    nodeId, actionType: LIQUIDITY_ACTION, actionSchemaVersion: '1.0.0', chainId: 'eip155:8453',
    requiredCapabilities: [LIQUIDITY_CAPABILITY], adapterConstraints: { adapters: [], protocols: ['uniswap-v3'] },
    inputs: [
      { name: 'amount0-max', kind: 'QUANTITY', value: { asset: { ...token0 }, amount: weth } },
      { name: 'amount1-max', kind: 'QUANTITY', value: { asset: { ...token1 }, amount: usdc } },
      { name: 'amount0-min', kind: 'QUANTITY', value: { asset: { ...token0 }, amount: minWeth } },
      { name: 'amount1-min', kind: 'QUANTITY', value: { asset: { ...token1 }, amount: minUsdc } },
      { name: 'tick-lower', kind: 'IDENTIFIER', value: `tick:${lower}` },
      { name: 'tick-upper', kind: 'IDENTIFIER', value: `tick:${upper}` },
      { name: 'fee-tier', kind: 'INTEGER', value: 500 },
      { name: 'recipient', kind: 'ACCOUNT', value: { chainId: 'eip155:8453', address: input.recipient } },
    ],
    expectedOutputs: [{ outputId: 'position-nft', asset: { ...POSITION_MANAGER_ASSET }, minimumAmount: '1' }],
    dependencies: [], userConstraints: [
      { kind: 'MAXIMUM_INPUT', quantity: { asset: { ...token0 }, amount: weth } },
      { kind: 'MAXIMUM_INPUT', quantity: { asset: { ...token1 }, amount: usdc } },
    ], failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [],
  };
  validateLiquidityNode(node, context);
  return node;
}

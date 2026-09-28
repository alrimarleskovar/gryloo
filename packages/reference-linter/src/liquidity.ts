// SPDX-License-Identifier: AGPL-3.0-only
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { assetSymbol, type ReviewContext } from './context.js';
type Immutable<T> = T extends readonly (infer V)[] ? readonly Immutable<V>[] : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type LiquidityNode = Immutable<SemanticWorkflow['nodes'][number]>;
export const LIQUIDITY_ACTION = 'asset.liquidity.uniswap-v3';
export const LIQUIDITY_CAPABILITY = 'liquidity.position-direct';
export const POSITION_MANAGER_ASSET = Object.freeze({ chainId: 'eip155:8453', address: '0x03a520b32c04bf3beef7beb72e919cf822ed34f1', decimals: 0 });
const TICK = /^tick:((?:0|[1-9][0-9]{0,5}|-[1-9][0-9]{0,5}))$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
export function parseTick(value: string): number {
  const match = TICK.exec(value);
  if (!match) throw new Error('LIQUIDITY_TICK_INVALID');
  const tick = Number(match[1]);
  if (!Number.isSafeInteger(tick) || Math.abs(tick) > 887272) throw new Error('LIQUIDITY_TICK_INVALID');
  return tick;
}
export type LiquidityDetails = { readonly nodeId: string; readonly amountWeth: string; readonly amountUsdc: string; readonly minimumWeth: string; readonly minimumUsdc: string;
  readonly tickLower: number; readonly tickUpper: number; readonly fee: 500; readonly recipient: string };
export function liquidityDetails(node: LiquidityNode, context: ReviewContext): LiquidityDetails | null {
  if (node.actionType !== LIQUIDITY_ACTION) return null;
  const byName = new Map(node.inputs.map(input => [input.name, input]));
  const weth = byName.get('amount0-max'), usdc = byName.get('amount1-max');
  const minWeth = byName.get('amount0-min'), minUsdc = byName.get('amount1-min');
  const lower = byName.get('tick-lower'), upper = byName.get('tick-upper');
  const fee = byName.get('fee-tier'), recipient = byName.get('recipient');
  if (node.inputs.length !== 8 || weth?.kind !== 'QUANTITY' || usdc?.kind !== 'QUANTITY' || minWeth?.kind !== 'QUANTITY' || minUsdc?.kind !== 'QUANTITY' ||
      lower?.kind !== 'IDENTIFIER' || upper?.kind !== 'IDENTIFIER' || fee?.kind !== 'INTEGER' ||
      recipient?.kind !== 'ACCOUNT' || assetSymbol(weth.value.asset, context) !== 'WETH' ||
      assetSymbol(usdc.value.asset, context) !== 'USDC' || assetSymbol(minWeth.value.asset, context) !== 'WETH' || assetSymbol(minUsdc.value.asset, context) !== 'USDC' || fee.value !== 500 ||
      recipient.value.chainId !== 'eip155:8453' || !ADDRESS.test(recipient.value.address)) return null;
  try { return { nodeId: node.nodeId, amountWeth: weth.value.amount, amountUsdc: usdc.value.amount, minimumWeth: minWeth.value.amount, minimumUsdc: minUsdc.value.amount,
    tickLower: parseTick(lower.value), tickUpper: parseTick(upper.value), fee: 500, recipient: recipient.value.address }; }
  catch { return null; }
}
export function validateLiquidityNode(node: LiquidityNode, context: ReviewContext): LiquidityDetails {
  const details = liquidityDetails(node, context);
  if (!details || node.actionSchemaVersion !== '1.0.0' || node.chainId !== 'eip155:8453' ||
      node.requiredCapabilities.length !== 1 || node.requiredCapabilities[0] !== LIQUIDITY_CAPABILITY ||
      node.adapterConstraints.adapters.length !== 0 || node.adapterConstraints.protocols.length !== 1 ||
      node.adapterConstraints.protocols[0] !== 'uniswap-v3' || node.requiredAuthorizationClass !== 'MODE_A' ||
      node.failurePolicy !== 'ABORT' || node.dependencies.length !== 0 ||
      node.lockedParameters.length !== 0 || node.editableBounds.length !== 0 ||
      details.tickLower >= details.tickUpper || details.tickLower % 10 !== 0 || details.tickUpper % 10 !== 0 ||
      details.amountWeth === '0' || details.amountUsdc === '0' ||
      BigInt(details.minimumWeth) > BigInt(details.amountWeth) || BigInt(details.minimumUsdc) > BigInt(details.amountUsdc) ||
      BigInt(details.amountWeth) > BigInt(context.assets.WETH.maximumAmountUnits) ||
      BigInt(details.amountUsdc) > BigInt(context.assets.USDC.maximumAmountUnits)) throw new Error('INVALID_LIQUIDITY_DECLARATION');
  const expected = node.expectedOutputs;
  if (expected.length !== 1 || expected[0]?.outputId !== 'position-nft' ||
      JSON.stringify(expected[0].asset) !== JSON.stringify(POSITION_MANAGER_ASSET) || expected[0].minimumAmount !== '1')
    throw new Error('INVALID_LIQUIDITY_OUTPUT');
  if (node.userConstraints.length !== 2 || node.userConstraints.some(c => c.kind !== 'MAXIMUM_INPUT') ||
      !node.userConstraints.some(c => c.kind === 'MAXIMUM_INPUT' && assetSymbol(c.quantity.asset, context) === 'WETH' && c.quantity.amount === details.amountWeth) ||
      !node.userConstraints.some(c => c.kind === 'MAXIMUM_INPUT' && assetSymbol(c.quantity.asset, context) === 'USDC' && c.quantity.amount === details.amountUsdc))
    throw new Error('INVALID_LIQUIDITY_CONSTRAINT');
  return details;
}

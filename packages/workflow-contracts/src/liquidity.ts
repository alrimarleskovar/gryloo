// SPDX-License-Identifier: Apache-2.0
import type { SemanticWorkflow } from './semantic-workflow.js';
import type { TokenAsset } from './swap.js';

/**
 * The canonical concentrated-liquidity position. Chain and provider never change its semantic shape: a token pair,
 * per-token maxima and minima, an immutable tick range, the pool fee tier and one position output.
 *
 * `asset.liquidity.uniswap-v3` (BUILD-006) is the earlier, provider-pinned spelling of the same semantics with an
 * explicit EVM recipient and no slippage constraint. Accepted BUILD-006/007/011C evidence binds those exact bytes, so
 * it stays valid and is read by the same reader. New runtimes use the neutral action; the protocol constraint
 * selects the provider (`uniswap-v3`, `orca-whirlpools`).
 */
export const CONCENTRATED_LIQUIDITY_ACTION = 'asset.liquidity.concentrated';
export const UNISWAP_V3_LIQUIDITY_ACTION = 'asset.liquidity.uniswap-v3';
export const LIQUIDITY_POSITION_CAPABILITY = 'liquidity.position-direct';
export type ConcentratedLiquidityNode = SemanticWorkflow['nodes'][number];
export type ConcentratedLiquidityFields = {
  chain: string; token0: TokenAsset; token1: TokenAsset;
  amount0Max: string; amount1Max: string; amount0Min: string; amount1Min: string;
  tickLower: number; tickUpper: number;
  /** Pool fee in hundredths of a basis point (Uniswap 500 = 0.05%, Orca 2000 = 0.20%). */
  feeTier: number;
  /** Required on the neutral action; the BUILD-006 spelling relies on explicit minimums instead. */
  slippageBps: number | null;
  protocols: readonly string[];
  /** Explicit recipient (BUILD-006 only). `null` means the executing owner, bound at Review. */
  recipient: { chainId: string; address: string } | null;
  /** The position-issuing contract or program; the position itself is a unit (decimals 0) of it. */
  positionAsset: TokenAsset;
};

const TICK = /^tick:(0|-?[1-9][0-9]{0,5})$/;
const UNITS = /^(0|[1-9][0-9]{0,77})$/;
const CHAIN = /^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/;
export const MAX_LIQUIDITY_TICK = 887_272;
export function parseLiquidityTick(value: unknown): number {
  const match = typeof value === 'string' ? TICK.exec(value) : null;
  const tick = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(tick) || Math.abs(tick) > MAX_LIQUIDITY_TICK) throw new Error('LIQUIDITY_TICK_INVALID');
  return tick;
}
const sameAsset = (a: unknown, b: TokenAsset) => !!a && typeof a === 'object' && 'address' in a &&
  (a as TokenAsset).chainId === b.chainId && (a as TokenAsset).address === b.address && (a as TokenAsset).decimals === b.decimals;

/** Build the canonical neutral node. Ranges are immutable ticks; pricing and alignment happen before authoring. */
export function createConcentratedLiquidityNode(nodeId: string, fields: ConcentratedLiquidityFields): ConcentratedLiquidityNode {
  const f = fields;
  if (!CHAIN.test(f.chain) || f.token0.chainId !== f.chain || f.token1.chainId !== f.chain || f.positionAsset.chainId !== f.chain ||
      f.positionAsset.decimals !== 0 || f.token0.address === f.token1.address ||
      ![f.amount0Max, f.amount1Max, f.amount0Min, f.amount1Min].every(v => UNITS.test(v)) ||
      f.amount0Max === '0' && f.amount1Max === '0' || BigInt(f.amount0Min) > BigInt(f.amount0Max) || BigInt(f.amount1Min) > BigInt(f.amount1Max) ||
      !Number.isSafeInteger(f.tickLower) || !Number.isSafeInteger(f.tickUpper) || f.tickLower >= f.tickUpper ||
      Math.abs(f.tickLower) > MAX_LIQUIDITY_TICK || Math.abs(f.tickUpper) > MAX_LIQUIDITY_TICK ||
      !Number.isSafeInteger(f.feeTier) || f.feeTier < 0 || f.feeTier > 1_000_000 ||
      f.slippageBps === null || !Number.isSafeInteger(f.slippageBps) || f.slippageBps < 0 || f.slippageBps > 10_000 ||
      f.protocols.length !== 1 || f.recipient !== null) throw new Error('LIQUIDITY_FIELDS_INVALID');
  const q = (asset: TokenAsset, amount: string) => ({ asset: { ...asset }, amount });
  return {
    nodeId, actionType: CONCENTRATED_LIQUIDITY_ACTION, actionSchemaVersion: '1.0.0', chainId: f.chain,
    requiredCapabilities: [LIQUIDITY_POSITION_CAPABILITY], adapterConstraints: { adapters: [], protocols: [...f.protocols] },
    inputs: [
      { name: 'amount0-max', kind: 'QUANTITY', value: q(f.token0, f.amount0Max) },
      { name: 'amount1-max', kind: 'QUANTITY', value: q(f.token1, f.amount1Max) },
      { name: 'amount0-min', kind: 'QUANTITY', value: q(f.token0, f.amount0Min) },
      { name: 'amount1-min', kind: 'QUANTITY', value: q(f.token1, f.amount1Min) },
      { name: 'tick-lower', kind: 'IDENTIFIER', value: `tick:${f.tickLower}` },
      { name: 'tick-upper', kind: 'IDENTIFIER', value: `tick:${f.tickUpper}` },
      { name: 'fee-tier', kind: 'INTEGER', value: f.feeTier },
    ],
    expectedOutputs: [{ outputId: 'position-nft', asset: { ...f.positionAsset }, minimumAmount: '1' }],
    dependencies: [],
    userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: q(f.token0, f.amount0Max) }, { kind: 'MAXIMUM_INPUT', quantity: q(f.token1, f.amount1Max) },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: f.slippageBps }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [],
  };
}

/**
 * Chain-neutral reader for both spellings of the concentrated-liquidity semantics. Provider-specific validation
 * (pool identity, tick spacing, caps) is layered on top by each runtime.
 */
export function readConcentratedLiquidity(node: ConcentratedLiquidityNode): ConcentratedLiquidityFields {
  const neutral = node.actionType === CONCENTRATED_LIQUIDITY_ACTION;
  if (!neutral && node.actionType !== UNISWAP_V3_LIQUIDITY_ACTION || node.actionSchemaVersion !== '1.0.0') throw new Error('LIQUIDITY_ACTION_INVALID');
  const port = (name: string) => node.inputs.find(p => p.name === name);
  const max0 = port('amount0-max'), max1 = port('amount1-max'), min0 = port('amount0-min'), min1 = port('amount1-min');
  const lower = port('tick-lower'), upper = port('tick-upper'), fee = port('fee-tier'), recipient = port('recipient');
  if (node.inputs.length !== (neutral ? 7 : 8) || max0?.kind !== 'QUANTITY' || max1?.kind !== 'QUANTITY' || min0?.kind !== 'QUANTITY' ||
      min1?.kind !== 'QUANTITY' || lower?.kind !== 'IDENTIFIER' || upper?.kind !== 'IDENTIFIER' || fee?.kind !== 'INTEGER' ||
      (neutral ? recipient !== undefined : recipient?.kind !== 'ACCOUNT') ||
      !('address' in max0.value.asset) || !('address' in max1.value.asset)) throw new Error('LIQUIDITY_PORTS_INVALID');
  const token0 = max0.value.asset as TokenAsset, token1 = max1.value.asset as TokenAsset;
  const maxima = node.userConstraints.filter(c => c.kind === 'MAXIMUM_INPUT'), slippage = node.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  const output = node.expectedOutputs[0];
  if (!sameAsset(min0.value.asset, token0) || !sameAsset(min1.value.asset, token1) || token0.chainId !== node.chainId || token1.chainId !== node.chainId ||
      maxima.length !== 2 || node.userConstraints.length !== (neutral ? 3 : 2) || slippage.length !== (neutral ? 1 : 0) ||
      !maxima.some(c => c.kind === 'MAXIMUM_INPUT' && sameAsset(c.quantity.asset, token0) && c.quantity.amount === max0.value.amount) ||
      !maxima.some(c => c.kind === 'MAXIMUM_INPUT' && sameAsset(c.quantity.asset, token1) && c.quantity.amount === max1.value.amount) ||
      node.expectedOutputs.length !== 1 || output?.outputId !== 'position-nft' || !('address' in output.asset) || output.minimumAmount !== '1')
    throw new Error('LIQUIDITY_PORTS_INVALID');
  const slip = slippage[0];
  return { chain: node.chainId, token0: { ...token0 }, token1: { ...token1 }, amount0Max: max0.value.amount, amount1Max: max1.value.amount,
    amount0Min: min0.value.amount, amount1Min: min1.value.amount, tickLower: parseLiquidityTick(lower.value), tickUpper: parseLiquidityTick(upper.value),
    feeTier: fee.value, slippageBps: slip?.kind === 'MAXIMUM_SLIPPAGE_BPS' ? slip.maximumBps : null, protocols: [...node.adapterConstraints.protocols],
    recipient: recipient?.kind === 'ACCOUNT' ? { ...recipient.value } : null, positionAsset: { ...output.asset as TokenAsset } };
}

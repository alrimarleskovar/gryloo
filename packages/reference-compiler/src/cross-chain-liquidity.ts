// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic destination preparation for a reconciled Base → Arbitrum USDC bridge. */
import { ARBITRUM_LIQUIDITY, Q96, rangeComposition, sqrtRatioAtTick, verifyPoolState, type PoolState } from './liquidity.js';

const Q192 = Q96 * Q96;
const decimal = (value: bigint, name: string) => {
  if (typeof value !== 'bigint' || value < 0n || value >= (1n << 256n)) throw new Error(name + '_INVALID');
  return value;
};
export type CrossChainCosts = {
  readonly sourceGasEth: bigint; readonly bridgeProviderFeeUsdc: bigint; readonly destinationGasReserveEth: bigint;
  readonly destinationSwapGasEth: bigint; readonly liquidityGasEth: bigint;
};
export type CrossChainPreparation = {
  readonly estimatedBridgeUsdc: bigint; readonly actualBridgeUsdc: bigint; readonly bridgeAmountDeltaUsdc: bigint;
  readonly swapInputUsdc: bigint; readonly swapPoolFeeUsdc: bigint; readonly estimatedSwapWeth: bigint;
  readonly liquidityUsdcBeforeMint: bigint; readonly liquidityWethBeforeMint: bigint;
  readonly expectedDepositUsdc: bigint; readonly expectedDepositWeth: bigint;
  readonly residualUsdc: bigint; readonly residualWeth: bigint;
  readonly swapRequired: boolean; readonly rangeState: 'BELOW_RANGE' | 'IN_RANGE' | 'ABOVE_RANGE';
  readonly costs: CrossChainCosts;
};
export type CrossChainPreparationInput = {
  readonly expectedBridgeUsdc: bigint; readonly actualBridgeUsdc: bigint; readonly maximumAuthorizedSourceUsdc: bigint;
  readonly destinationEthBalance: bigint; readonly existingDestinationWeth: bigint;
  readonly tickLower: number; readonly tickUpper: number; readonly pool: PoolState; readonly nowMs: number;
  readonly costs: CrossChainCosts;
};
/** Spot output is only a simulation estimate; the live swap requires a fresh exact-input quote. */
export function estimateDestinationSwapWeth(pool: PoolState, inputUsdc: bigint): bigint {
  decimal(inputUsdc, 'SWAP_INPUT');
  verifyPoolState(pool, pool.observedAtMs);
  return inputUsdc * BigInt(1_000_000 - pool.fee) * Q192 / (1_000_000n * pool.sqrtPriceX96 * pool.sqrtPriceX96);
}
export function planCrossChainPreparation(input: CrossChainPreparationInput): CrossChainPreparation {
  const { pool, costs } = input;
  verifyPoolState(pool, input.nowMs);
  if (pool.sourceChainId !== ARBITRUM_LIQUIDITY.chainId || pool.fee !== ARBITRUM_LIQUIDITY.fee ||
      pool.tickSpacing !== ARBITRUM_LIQUIDITY.tickSpacing) throw new Error('DESTINATION_POOL_INVALID');
  for (const [key, value] of Object.entries(costs)) decimal(value, key);
  const actual = decimal(input.actualBridgeUsdc, 'BRIDGE_ACTUAL');
  const expected = decimal(input.expectedBridgeUsdc, 'BRIDGE_ESTIMATED');
  const sourceMaximum = decimal(input.maximumAuthorizedSourceUsdc, 'SOURCE_BUDGET');
  const existingWeth = decimal(input.existingDestinationWeth, 'DESTINATION_WETH');
  const destinationEth = decimal(input.destinationEthBalance, 'DESTINATION_ETH');
  if (!actual || !expected || !sourceMaximum || actual > sourceMaximum ||
      destinationEth < costs.destinationGasReserveEth ||
      costs.destinationGasReserveEth < costs.destinationSwapGasEth + costs.liquidityGasEth)
    throw new Error('CROSS_CHAIN_BUDGET_INVALID');
  const lower = sqrtRatioAtTick(input.tickLower), upper = sqrtRatioAtTick(input.tickUpper);
  if (input.tickLower >= input.tickUpper || input.tickLower % pool.tickSpacing || input.tickUpper % pool.tickSpacing)
    throw new Error('DESTINATION_RANGE_INVALID');
  const spot = pool.sqrtPriceX96;
  let swapInputUsdc = 0n;
  if (spot <= lower) {
    // The approved range consumes WETH only. All bridged USDC must be swapped.
    swapInputUsdc = actual;
  } else if (spot < upper) {
    // Balance the two liquidity constraints at the observed spot price. All math is integer/native units.
    let low = 0n, high = actual;
    const wethLiquidity = (usdcSwap: bigint) => {
      const weth = existingWeth + estimateDestinationSwapWeth(pool, usdcSwap);
      return weth * spot * upper / ((upper - spot) * Q96);
    };
    const usdcLiquidity = (usdcSwap: bigint) => (actual - usdcSwap) * Q96 / (spot - lower);
    while (low < high) {
      const middle = (low + high) / 2n;
      if (wethLiquidity(middle) < usdcLiquidity(middle)) low = middle + 1n;
      else high = middle;
    }
    swapInputUsdc = low;
  }
  const estimatedSwapWeth = estimateDestinationSwapWeth(pool, swapInputUsdc);
  const availableWeth = existingWeth + estimatedSwapWeth, availableUsdc = actual - swapInputUsdc;
  if (swapInputUsdc > actual || (!availableWeth && !availableUsdc)) throw new Error('DESTINATION_SPEND_INVALID');
  const range = rangeComposition(pool, input.tickLower, input.tickUpper, availableWeth, availableUsdc, input.nowMs);
  return { estimatedBridgeUsdc: expected, actualBridgeUsdc: actual, bridgeAmountDeltaUsdc: actual - expected,
    swapInputUsdc, swapPoolFeeUsdc: swapInputUsdc - swapInputUsdc * BigInt(1_000_000 - pool.fee) / 1_000_000n,
    estimatedSwapWeth, liquidityUsdcBeforeMint: availableUsdc, liquidityWethBeforeMint: availableWeth,
    expectedDepositUsdc: range.amount1, expectedDepositWeth: range.amount0,
    residualUsdc: availableUsdc - range.amount1, residualWeth: availableWeth - range.amount0,
    swapRequired: swapInputUsdc > 0n, rangeState: range.state, costs };
}
/** Recompute mint bounds only from a separately reconciled swap output. */
export function finalizeLiquidityInputs(preparation: CrossChainPreparation, actualSwapWeth: bigint,
  pool: PoolState, tickLower: number, tickUpper: number, nowMs: number) {
  decimal(actualSwapWeth, 'SWAP_ACTUAL');
  if (!preparation.swapRequired && actualSwapWeth !== 0n) throw new Error('UNEXPECTED_SWAP_OUTPUT');
  if (preparation.swapRequired && actualSwapWeth === 0n) throw new Error('SWAP_NOT_RECONCILED');
  const weth = preparation.liquidityWethBeforeMint - preparation.estimatedSwapWeth + actualSwapWeth;
  const usdc = preparation.liquidityUsdcBeforeMint;
  if (weth < 0n) throw new Error('SWAP_OUTPUT_INVALID');
  const range = rangeComposition(pool, tickLower, tickUpper, weth, usdc, nowMs);
  return { amountWethDesired: weth, amountUsdcDesired: usdc, expectedWethDeposit: range.amount0,
    expectedUsdcDeposit: range.amount1, residualWeth: weth - range.amount0, residualUsdc: usdc - range.amount1 };
}

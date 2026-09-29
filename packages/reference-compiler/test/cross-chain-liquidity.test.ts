// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ARBITRUM_LIQUIDITY, BASE_LIQUIDITY, encodeLiquidityCall, sqrtRatioAtTick, type PoolState } from '../src/liquidity.js';
import { finalizeLiquidityInputs, planCrossChainPreparation } from '../src/cross-chain-liquidity.js';
const h = '0x' + 'a'.repeat(64);
const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
  pool: '0xc6962004f452be9203591991d15f6b388e09e8d0', factory: ARBITRUM_LIQUIDITY.factory,
  positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
  fee: 500, tickSpacing: 10, tick: -200000, sqrtPriceX96: sqrtRatioAtTick(-200000),
  poolCodeHash: h, positionManagerCodeHash: h, observedAtMs: 1000, expiresAtMs: 61000 };
const costs = { sourceGasEth: 100n, bridgeProviderFeeUsdc: 2000n, destinationGasReserveEth: 300n,
  destinationSwapGasEth: 100n, liquidityGasEth: 200n };
const input = { expectedBridgeUsdc: 1_000_000_000n, actualBridgeUsdc: 900_000_000n,
  maximumAuthorizedSourceUsdc: 1_000_000_000n, destinationEthBalance: 300n,
  existingDestinationWeth: 0n, tickLower: -200100, tickUpper: -199900, pool, nowMs: 2000, costs };
describe('BUILD-011C-1 Arbitrum destination preparation', () => {
  it('uses reconciled bridge units, pool ratio and actual swap output', () => {
    const p = planCrossChainPreparation(input);
    expect(p.actualBridgeUsdc).toBe(900_000_000n);
    expect(p.bridgeAmountDeltaUsdc).toBe(-100_000_000n);
    expect(p.swapInputUsdc).toBeGreaterThan(0n);
    expect(p.swapInputUsdc).toBeLessThan(p.actualBridgeUsdc);
    expect(p.swapInputUsdc).not.toBe(450_000_000n);
    expect(p.swapInputUsdc + p.liquidityUsdcBeforeMint).toBe(p.actualBridgeUsdc);
    const final = finalizeLiquidityInputs(p, p.estimatedSwapWeth - 1_000_000n, pool, input.tickLower, input.tickUpper, 2000);
    expect(final.amountWethDesired).toBe(p.estimatedSwapWeth - 1_000_000n);
    expect(final.expectedWethDeposit + final.residualWeth).toBe(final.amountWethDesired);
    expect(final.expectedUsdcDeposit + final.residualUsdc).toBe(p.liquidityUsdcBeforeMint);
  });
  it('preserves independent destination ETH gas and rejects missing reserve or stale pool', () => {
    expect(() => planCrossChainPreparation({ ...input, destinationEthBalance: 299n })).toThrow('CROSS_CHAIN_BUDGET_INVALID');
    expect(() => planCrossChainPreparation({ ...input, nowMs: 61000 })).toThrow('LIQUIDITY_POOL_STATE_INVALID');
    expect(() => planCrossChainPreparation({ ...input, actualBridgeUsdc: 1_000_000_001n })).toThrow('CROSS_CHAIN_BUDGET_INVALID');
    expect(() => planCrossChainPreparation({ ...input, pool: { ...pool, token1: BASE_LIQUIDITY.usdc } })).toThrow();
  });
  it('supports one-sided no-swap and all-swap ranges', () => {
    const above = planCrossChainPreparation({ ...input, tickLower: -200200, tickUpper: -200100 });
    expect(above.swapInputUsdc).toBe(0n);
    expect(above.expectedDepositWeth).toBe(0n);
    expect(above.expectedDepositUsdc).toBeGreaterThan(0n);
    const below = planCrossChainPreparation({ ...input, tickLower: -199900, tickUpper: -199800 });
    expect(below.swapInputUsdc).toBe(input.actualBridgeUsdc);
    expect(below.expectedDepositUsdc).toBe(0n);
  });
  it('uses the same Uniswap call encoder with Arbitrum deployment and keeps Base default intact', () => {
    const call = { kind: 'MINT' as const, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
      fee: 500, tickLower: -200100, tickUpper: -199900, amount0Desired: 1n, amount1Desired: 2n,
      amount0Min: 0n, amount1Min: 0n, recipient: '0x1111111111111111111111111111111111111111', deadline: 1000n };
    expect(encodeLiquidityCall(call, ARBITRUM_LIQUIDITY).to).toBe(ARBITRUM_LIQUIDITY.positionManager);
    expect(() => encodeLiquidityCall(call)).toThrow('LIQUIDITY_MINT_INVALID');
    expect(BASE_LIQUIDITY.chainId).toBe(8453);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCrossChainLiquidityWorkflow } from '../../../apps/reference-dapp/src/domain/cross-chain-liquidity';
import { ARBITRUM_LIQUIDITY, sqrtRatioAtTick, type PoolState } from '../src/liquidity.js';
import { compileCrossChainLiquidityArtifacts } from '../src/cross-chain-liquidity-artifacts.js';
import { planCrossChainPreparation } from '../src/cross-chain-liquidity.js';
const h = '0x' + 'a'.repeat(64), owner = '0x1111111111111111111111111111111111111111';
const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, { amount: '1000', bridgeSlippageBps: '50',
  swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: owner,
  provider: 'lifi.rest', noSwap: false });
const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
  pool: '0xc6962004f452be9203591991d15f6b388e09e8d0', factory: ARBITRUM_LIQUIDITY.factory,
  positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
  fee: 500, tickSpacing: 10, tick: -200000, sqrtPriceX96: sqrtRatioAtTick(-200000),
  poolCodeHash: h, positionManagerCodeHash: h, observedAtMs: 1000, expiresAtMs: 61000 };
const costs = { sourceGasEth: 100n, bridgeProviderFeeUsdc: 2000n, destinationGasReserveEth: 300n,
  destinationSwapGasEth: 100n, liquidityGasEth: 200n };
const plan = planCrossChainPreparation({ expectedBridgeUsdc: 1_000_000_000n, actualBridgeUsdc: 900_000_000n,
  maximumAuthorizedSourceUsdc: 1_000_000_000n, destinationEthBalance: 300n,
  existingDestinationWeth: 0n, tickLower: -200100, tickUpper: -199900, pool, nowMs: 2000, costs });
const input = { nowMs: 2000, owner, provider: 'lifi.rest' as const, bridgeTarget: '0x2222222222222222222222222222222222222222', sourceBlockNumber: 7,
  bridgePayloadHash: h, bridgeFunctionId: '0x12345678', bridgeQuoteHash: h, sourceUsdcAmount: 1_000_000_000n,
  bridgeExpectedUsdc: 1_000_000_000n, bridgeMinimumUsdc: 800_000_000n, actualBridgeUsdc: 900_000_000n,
  pool, tickLower: -200100, tickUpper: -199900, destinationEthBalance: 300n, existingDestinationWeth: 0n,
  swapTarget: '0x3333333333333333333333333333333333333333', swapPayloadHash: h, swapFunctionId: '0xabcdef12', swapQuoteHash: h,
  swapInputUsdc: plan.swapInputUsdc, swapExpectedWeth: plan.estimatedSwapWeth,
  swapMinimumWeth: plan.estimatedSwapWeth - 1_000_000n, liquidityPayloadHash: h, costs,
  observedAt: new Date(2000).toISOString(), expiresAt: new Date(5000).toISOString() };
describe('BUILD-011C-1 chained canonical artifacts', () => {
  it('binds the full graph, propagated outputs, shared budgets and fixed provider to one Manifest', () => {
    const compiled = compileCrossChainLiquidityArtifacts(flow, input);
    expect(compiled.quotes).toHaveLength(3);
    expect(compiled.quotes[0]?.chainPosition).toEqual({ kind: 'BLOCK', height: 7 });
    expect(compiled.quotes[1]?.chainPosition).toEqual({ kind: 'BLOCK', height: 1 });
    expect(compiled.quotes[1]?.fees[0]?.amount).toBe(compiled.preparation.swapPoolFeeUsdc.toString());
    expect(compiled.simulation.propagatedOutputs).toHaveLength(4);
    expect(compiled.manifest.semanticWorkflowHash).toBe(compiled.hashes.workflow);
    expect(compiled.manifest.providers).toEqual({ kind: 'FIXED', providerId: 'lifi.rest' });
    expect(compiled.policy.spendLimits[1]?.maximumCumulativeAmount).toBe('900000000');
    expect(compiled.executionPlan.segments).toHaveLength(3);
    expect(compiled.preparation.swapInputUsdc + compiled.preparation.liquidityUsdcBeforeMint).toBe(900_000_000n);
    expect(compiled.simulation.uncertainty.some(u => u.code === 'CROSS_CHAIN_SETTLEMENT_ESTIMATE')).toBe(true);
  });
  it('refreshes the destination Manifest for a favorable reconciled amount within policy', () => {
    const favorable = planCrossChainPreparation({ expectedBridgeUsdc: 900_000_000n, actualBridgeUsdc: 950_000_000n,
      maximumAuthorizedSourceUsdc: 1_000_000_000n, destinationEthBalance: 300n,
      existingDestinationWeth: 0n, tickLower: -200100, tickUpper: -199900, pool, nowMs: 2000, costs });
    const compiled = compileCrossChainLiquidityArtifacts(flow, { ...input, bridgeExpectedUsdc: 900_000_000n,
      actualBridgeUsdc: 950_000_000n, swapInputUsdc: favorable.swapInputUsdc,
      swapExpectedWeth: favorable.estimatedSwapWeth, swapMinimumWeth: favorable.estimatedSwapWeth - 1_000_000n });
    expect(compiled.preparation.actualBridgeUsdc).toBe(950_000_000n);
    expect(compiled.policy.spendLimits[1]?.maximumCumulativeAmount).toBe('950000000');
  });
  it('invalidates a stale swap input, expired quote and material provider change', () => {
    expect(() => compileCrossChainLiquidityArtifacts(flow, { ...input, nowMs: 5000 })).toThrow();
    expect(() => compileCrossChainLiquidityArtifacts(flow, { ...input, swapInputUsdc: 1_000_000_000n })).toThrow();
    expect(() => compileCrossChainLiquidityArtifacts(flow, { ...input, provider: 'across.direct' })).toThrow();
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCrossChainLiquidityWorkflow } from '../../../apps/reference-dapp/src/domain/cross-chain-liquidity';
import { ARBITRUM_LIQUIDITY, sqrtRatioAtTick, planCrossChainPreparation,
  compileCrossChainLiquidityArtifacts, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { beginCrossChainRun, submitCrossChainBridge, reconcileCrossChainBridge, reviewCrossChainPreparation,
  reconcileCrossChainSwap, submitCrossChainLiquidity, reconcileCrossChainPosition } from '../../../packages/reference-executor/src/cross-chain-liquidity';
import { buildCrossChainLiquidityEvidence } from '../src/cross-chain-liquidity.js';
const h = '0x' + 'a'.repeat(64), tx = '0x' + 'b'.repeat(64), owner = '0x1111111111111111111111111111111111111111';
const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
  pool: '0xc6962004f452be9203591991d15f6b388e09e8d0', factory: ARBITRUM_LIQUIDITY.factory,
  positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
  fee: 500, tickSpacing: 10, tick: -200000, sqrtPriceX96: sqrtRatioAtTick(-200000),
  poolCodeHash: h, positionManagerCodeHash: h, observedAtMs: 1000, expiresAtMs: 61000 };
const costs = { sourceGasEth: 100n, bridgeProviderFeeUsdc: 2000n, destinationGasReserveEth: 300n,
  destinationSwapGasEth: 100n, liquidityGasEth: 200n };
const flow = createCrossChainLiquidityWorkflow('workflow-local', 1, { amount: '1000', bridgeSlippageBps: '50',
  swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: owner,
  provider: 'lifi.rest', noSwap: false });
const plan = planCrossChainPreparation({ expectedBridgeUsdc: 1_000_000_000n, actualBridgeUsdc: 900_000_000n,
  maximumAuthorizedSourceUsdc: 1_000_000_000n, destinationEthBalance: 300n,
  existingDestinationWeth: 0n, tickLower: -200100, tickUpper: -199900, pool, nowMs: 2000, costs });
const artifactInput = { nowMs: 2000, owner, provider: 'lifi.rest' as const, bridgeTarget: '0x2222222222222222222222222222222222222222', sourceBlockNumber: 7,
  bridgePayloadHash: h, bridgeFunctionId: '0x12345678', bridgeQuoteHash: h, sourceUsdcAmount: 1_000_000_000n,
  bridgeExpectedUsdc: 1_000_000_000n, bridgeMinimumUsdc: 800_000_000n,
  actualBridgeUsdc: 900_000_000n, pool, tickLower: -200100, tickUpper: -199900,
  destinationEthBalance: 300n, existingDestinationWeth: 0n,
  swapTarget: '0x3333333333333333333333333333333333333333', swapPayloadHash: h, swapFunctionId: '0xabcdef12', swapQuoteHash: h,
  swapInputUsdc: plan.swapInputUsdc, swapExpectedWeth: plan.estimatedSwapWeth,
  swapMinimumWeth: plan.estimatedSwapWeth - 1_000_000n, liquidityPayloadHash: h,
  costs, observedAt: new Date(2000).toISOString(), expiresAt: new Date(5000).toISOString() };
const artifacts = compileCrossChainLiquidityArtifacts(flow, artifactInput);
function complete() {
  let run = beginCrossChainRun({ workflowId: flow.workflowId, owner, provider: 'lifi.rest',
    workflowHash: artifacts.hashes.workflow, executionPlanHash: artifacts.hashes.executionPlan,
    sourceManifestHash: artifacts.hashes.manifest, expectedBridgeUsdc: 1_000_000_000n,
    minimumBridgeUsdc: 800_000_000n, maximumSourceUsdc: 1_000_000_000n, pool,
    tickLower: -200100, tickUpper: -199900, destinationEthBalance: 300n,
    existingDestinationWeth: 0n, costs });
  run = submitCrossChainBridge(run, tx);
  run = reconcileCrossChainBridge(run, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.usdc,
    sourceHash: tx, destinationHash: h, status: 1, before: 0n, after: 900_000_000n }, 2000);
  run = reviewCrossChainPreparation(run, artifacts.hashes.manifest, { inputUsdc: plan.swapInputUsdc,
    minimumWeth: plan.estimatedSwapWeth - 1_000_000n, expectedWeth: plan.estimatedSwapWeth,
    expiresAtMs: 5000, provider: 'lifi.rest', quoteHash: h }, 2000);
  run = reconcileCrossChainSwap(run, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.weth,
    transactionHash: h, status: 1, before: 0n, after: plan.estimatedSwapWeth,
    beforeUsdc: 900_000_000n, afterUsdc: 900_000_000n - plan.swapInputUsdc }, 2000);
  run = submitCrossChainLiquidity(run, tx, 2000);
  const amount = run.liquidityInputs!;
  return reconcileCrossChainPosition(run, { owner, chainId: 42161, transactionHash: tx,
    status: 1, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
    fee: 500, tickLower: -200100, tickUpper: -199900, beforeWeth: amount.amountWethDesired,
    afterWeth: amount.residualWeth + 1n, beforeUsdc: amount.amountUsdcDesired,
    afterUsdc: amount.residualUsdc + 1n, remainingWethAllowance: 0n,
    remainingUsdcAllowance: 0n, liquidityGasEth: 150n });
}
describe('BUILD-011C-1 final evidence', () => {
  it('links every stage and reports position, allowances, gas and residual wallet assets as MOCKED', () => {
    const result = buildCrossChainLiquidityEvidence(artifacts, complete(), new Date(6000).toISOString());
    expect(result.bundle.environment).toBe('MOCKED');
    expect(result.bundle.outcome).toBe('RECONCILED');
    expect(result.bundle.receipts.map(r => r.receiptId)).toEqual(expect.arrayContaining([
      expect.stringContaining('destination-reconciliation'), expect.stringContaining('destination-swap'),
      expect.stringContaining('final-reconciliation')]));
    expect(result.bundle.reconciliation.positions[0]?.amount).toBe('77');
    expect(result.bundle.reconciliation.residualAssets).toHaveLength(2);
    expect(result.bundle.evidence.some(e => e.evidenceId.includes('residual-weth'))).toBe(true);
    expect(result.bundle.evidence.some(e => e.evidenceId.includes('residual-usdc'))).toBe(true);
    expect(result.bundle.evidence.some(e => e.evidenceId === 'destination-manifest')).toBe(true);
  });
  it('rejects missing final reconciliation stage', () => {
    const run = complete();
    expect(() => buildCrossChainLiquidityEvidence(artifacts, { ...run, observations: run.observations.slice(0, -1) },
      new Date(6000).toISOString())).toThrow('CROSS_CHAIN_EVIDENCE_INCOMPLETE');
  });
});

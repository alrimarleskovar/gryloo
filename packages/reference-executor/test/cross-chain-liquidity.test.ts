// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ARBITRUM_LIQUIDITY, sqrtRatioAtTick, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { beginCrossChainRun, submitCrossChainBridge, reconcileCrossChainBridge,
  reviewCrossChainPreparation, reconcileCrossChainSwap, submitCrossChainLiquidity, reconcileCrossChainPosition } from '../src/cross-chain-liquidity.js';
const h = '0x' + 'a'.repeat(64), tx = '0x' + 'b'.repeat(64), swapTx = '0x' + 'c'.repeat(64);
const owner = '0x1111111111111111111111111111111111111111';
const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
  pool: '0xc6962004f452be9203591991d15f6b388e09e8d0', factory: ARBITRUM_LIQUIDITY.factory,
  positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
  fee: 500, tickSpacing: 10, tick: -200000, sqrtPriceX96: sqrtRatioAtTick(-200000), poolCodeHash: h,
  positionManagerCodeHash: h, observedAtMs: 1000, expiresAtMs: 61000 };
const start = (expectedBridgeUsdc = 1_000_000_000n) => beginCrossChainRun({ workflowId: 'workflow-local', owner, provider: 'lifi.rest', workflowHash: h,
  executionPlanHash: h, sourceManifestHash: h, expectedBridgeUsdc, minimumBridgeUsdc: 800_000_000n,
  maximumSourceUsdc: 1_000_000_000n, pool, tickLower: -200100, tickUpper: -199900,
  destinationEthBalance: 300n, existingDestinationWeth: 0n,
  costs: { sourceGasEth: 100n, bridgeProviderFeeUsdc: 2000n, destinationGasReserveEth: 300n,
    destinationSwapGasEth: 100n, liquidityGasEth: 200n } });
const arrive = () => reconcileCrossChainBridge(submitCrossChainBridge(start(), tx), { owner, chainId: 42161,
  token: ARBITRUM_LIQUIDITY.usdc, sourceHash: tx, destinationHash: h, status: 1,
  before: 100n, after: 900_000_100n }, 2000);
describe('BUILD-011C-1 canonical happy-path journal', () => {
  it('uses actual bridge output, fresh partial quote, independently reconciled swap and LP', () => {
    const arrived = arrive();
    expect(arrived.plan?.actualBridgeUsdc).toBe(900_000_000n);
    expect(arrived.plan?.swapInputUsdc).not.toBe(450_000_000n);
    expect(arrived.produced[0]?.amount).toBe('900000000');
    expect(arrived.journal.entries.at(-1)?.toState).toBe('COMPLETED');
    expect(arrived.journal.entries.filter(e => e.level === 'workflow').every(e => e.toState !== 'COMPLETED')).toBe(true);
    const expected = arrived.plan!.estimatedSwapWeth;
    const reviewed = reviewCrossChainPreparation(arrived, h, { inputUsdc: arrived.plan!.swapInputUsdc,
      minimumWeth: expected - 2_000_000n, expectedWeth: expected, expiresAtMs: 5000,
      provider: 'lifi.rest', quoteHash: swapTx }, 2000);
    const swapped = reconcileCrossChainSwap(reviewed, { owner, chainId: 42161,
      token: ARBITRUM_LIQUIDITY.weth, transactionHash: swapTx, status: 1,
      before: 0n, after: expected - 1_000_000n, beforeUsdc: arrived.plan!.actualBridgeUsdc,
      afterUsdc: arrived.plan!.liquidityUsdcBeforeMint }, 2000);
    expect(() => reconcileCrossChainSwap(reviewed, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.weth,
      transactionHash: swapTx, status: 1, before: 0n, after: expected,
      beforeUsdc: arrived.plan!.actualBridgeUsdc, afterUsdc: arrived.plan!.actualBridgeUsdc }, 2000)).toThrow('SWAP_RECONCILIATION_INVALID');
    expect(swapped.produced.find(x => x.outputId === 'amount-out' && x.nodeId === 'build011c-swap')?.amount)
      .toBe((expected - 1_000_000n).toString());
    const sent = submitCrossChainLiquidity(swapped, tx, 2000);
    const inputs = sent.liquidityInputs!;
    const completed = reconcileCrossChainPosition(sent, { owner, chainId: 42161, transactionHash: tx,
      status: 1, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
      fee: 500, tickLower: -200100, tickUpper: -199900, beforeWeth: inputs.amountWethDesired,
      afterWeth: inputs.residualWeth + 1n, beforeUsdc: inputs.amountUsdcDesired,
      afterUsdc: inputs.residualUsdc + 1n, remainingWethAllowance: 0n,
      remainingUsdcAllowance: 0n, liquidityGasEth: 150n });
    expect(completed.stage).toBe('COMPLETED'); expect(completed.final?.tokenId).toBe(77n);
    expect(completed.produced.find(x => x.outputId === 'residual-weth')?.amount).toBe(completed.final?.residualWeth.toString());
    expect(completed.produced.find(x => x.outputId === 'residual-usdc')?.amount).toBe(completed.final?.residualUsdc.toString());
    expect(completed.location).toEqual(['LIQUIDITY_POSITION', 'RESIDUAL_WALLET_BALANCE']);
    expect(completed.journal.entries.filter(e => e.level === 'workflow').at(-1)?.toState).toBe('COMPLETED');
    expect(completed.journal.entries.some(e => e.level === 'attempt' && e.stepId === 'destination-swap')).toBe(true);
  });
  it('uses a favorable reconciled output above the estimate only within the source spend ceiling', () => {
    const submitted = submitCrossChainBridge(start(900_000_000n), tx);
    const observed = { owner, chainId: 42161 as const, token: ARBITRUM_LIQUIDITY.usdc, sourceHash: tx,
      destinationHash: h, status: 1 as const, before: 0n, after: 950_000_000n };
    const arrived = reconcileCrossChainBridge(submitted, observed, 2000);
    expect(arrived.plan?.actualBridgeUsdc).toBe(950_000_000n);
    expect(arrived.plan?.bridgeAmountDeltaUsdc).toBe(50_000_000n);
    expect(() => reconcileCrossChainBridge(submitted, { ...observed, after: 1_000_000_001n }, 2000)).toThrow('DESTINATION_AMOUNT_OUT_OF_BOUNDS');
  });
  it('refuses stale quote, double spend, unreviewed mint and transaction-only completion', () => {
    const arrived = arrive();
    expect(() => reviewCrossChainPreparation(arrived, h, { inputUsdc: arrived.plan!.actualBridgeUsdc,
      minimumWeth: 1n, expectedWeth: 2n, expiresAtMs: 5000, provider: 'lifi.rest', quoteHash: h }, 2000)).toThrow();
    expect(() => submitCrossChainLiquidity(arrived, tx, 2000)).toThrow();
    expect(() => reviewCrossChainPreparation(arrived, h, { inputUsdc: arrived.plan!.swapInputUsdc,
      minimumWeth: 1n, expectedWeth: arrived.plan!.estimatedSwapWeth, expiresAtMs: 2000,
      provider: 'lifi.rest', quoteHash: h }, 2000)).toThrow('DESTINATION_REVIEW_INVALID');
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCrossChainRunStore } from '../src/cross-chain-liquidity-store.js';
import { ARBITRUM_LIQUIDITY, sqrtRatioAtTick, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { beginCrossChainRun, submitCrossChainBridge, reconcileCrossChainBridge, reviewCrossChainPreparation,
  reconcileCrossChainSwap, reconcileCrossChainSwapRevert, prepareCrossChainLiquidity, submitCrossChainLiquidity,
  reconcileCrossChainMintRevert, markCrossChainMintUnknown, reconcileCrossChainMintUnknown,
  pauseCrossChainDestination, crossChainRecoveryOptions, selectCrossChainManualIntervention,
  crossChainManualSummary, proposeCrossChainCompensation, authorizeCrossChainCompensation,
  reconcileCrossChainCompensation, prepareCrossChainMintRetry, reconcileCrossChainPosition,
  requestCrossChainMint, recoverCrossChainMintAfterRestart } from '../src/cross-chain-liquidity.js';
import type { RecoveryEvidence } from '../src/recovery.js';
const h = '0x' + 'a'.repeat(64), bridgeTx = '0x' + 'b'.repeat(64), swapTx = '0x' + 'c'.repeat(64), mintTx = '0x' + 'd'.repeat(64);
const owner = '0x1111111111111111111111111111111111111111';
const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
  pool: ARBITRUM_LIQUIDITY.pool, factory: ARBITRUM_LIQUIDITY.factory,
  positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth,
  token1: ARBITRUM_LIQUIDITY.usdc, fee: 500, tickSpacing: 10, tick: -200000,
  sqrtPriceX96: sqrtRatioAtTick(-200000), poolCodeHash: h, positionManagerCodeHash: h,
  observedAtMs: 1000, expiresAtMs: 61000 };
const start = () => beginCrossChainRun({ workflowId: 'workflow-recovery', owner, provider: 'lifi.rest',
  workflowHash: h, executionPlanHash: h, sourceManifestHash: h, expectedBridgeUsdc: 950_000_000n,
  minimumBridgeUsdc: 800_000_000n, maximumSourceUsdc: 1_000_000_000n, pool,
  tickLower: -200100, tickUpper: -199900, destinationEthBalance: 300n, existingDestinationWeth: 0n,
  costs: { sourceGasEth: 100n, bridgeProviderFeeUsdc: 2000n, destinationGasReserveEth: 300n,
    destinationSwapGasEth: 100n, liquidityGasEth: 200n } });
const bridged = () => reconcileCrossChainBridge(submitCrossChainBridge(start(), bridgeTx), {
  owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.usdc, sourceHash: bridgeTx,
  destinationHash: h, status: 1, before: 0n, after: 900_000_000n }, 2000);
const reviewed = () => {
  const arrived = bridged(), expected = arrived.plan!.estimatedSwapWeth;
  return reviewCrossChainPreparation(arrived, h, { inputUsdc: arrived.plan!.swapInputUsdc,
    minimumWeth: expected - 2_000_000n, expectedWeth: expected, expiresAtMs: 5000,
    provider: 'lifi.rest', quoteHash: h }, 2000);
};
const swapped = () => {
  const run = reviewed();
  return reconcileCrossChainSwap(run, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.weth,
    transactionHash: swapTx, status: 1, before: 0n, after: run.plan!.estimatedSwapWeth - 1_000_000n,
    beforeUsdc: run.plan!.actualBridgeUsdc, afterUsdc: run.plan!.liquidityUsdcBeforeMint }, 2000);
};
const known = (hash: string): RecoveryEvidence => ({ payloadNonce: 4n, latestNonce: 5n, scannedBlocks: 2,
  scanComplete: true, matchingNonceTransactions: [{ hash, exactPayload: true, confirmed: true }],
  txpoolChecked: true, txpoolContainsNonce: false, waitedMs: 30_000, observedBlocks: 2,
  receiptLookup: { status: 1 }, transactionLookup: { hash }, deadlineNear: false });
const missing = (): RecoveryEvidence => ({ ...known(mintTx), latestNonce: 4n, matchingNonceTransactions: [],
  receiptLookup: null, transactionLookup: null });
describe('BUILD-011C-2 non-atomic recovery', () => {
  it('preserves bridge and destination USDC after a reverted swap', () => {
    const run = reviewed();
    const failed = reconcileCrossChainSwapRevert(run, { owner, chainId: 42161,
      transactionHash: swapTx, status: 0, usdc: 900_000_000n, weth: 0n, gasEth: 70n }, 2000);
    expect(failed.stage).toBe('PARTIALLY_COMPLETED');
    expect(failed.location).toEqual(['DESTINATION_WALLET']);
    expect(failed.recovery?.usdc).toBe(900_000_000n);
    expect(failed.produced.some(v => v.nodeId === 'build011c-bridge')).toBe(true);
    expect(failed.journal.entries.filter(e => e.stepId === 'bridge-submission' && e.level === 'attempt')).toHaveLength(3);
    expect(failed.journal.entries.filter(e => e.level === 'workflow').at(-1)?.toState).toBe('PARTIALLY_COMPLETED');
    expect(failed.journal.entries.some(e => e.toState === 'REVERTED' && e.stepId === 'destination-swap')).toBe(true);
    expect(crossChainRecoveryOptions(failed, 2000).find(o => o.action === 'RETRY')?.status).toBe('BLOCKED');
    const manual = selectCrossChainManualIntervention(failed);
    expect(crossChainManualSummary(manual, 2000)).toMatchObject({ localExecutionPaused: true,
      authorityRevoked: false, balances: { usdc: 900_000_000n, weth: 0n } });
  });
  it('preserves the swap result, failed mint cost and separate compensation authority', () => {
    const sent = submitCrossChainLiquidity(swapped(), mintTx, 2000);
    const input = sent.liquidityInputs!;
    const failed = reconcileCrossChainMintRevert(sent, { owner, chainId: 42161, transactionHash: mintTx,
      status: 0, usdc: input.amountUsdcDesired, weth: input.amountWethDesired, gasEth: 150n }, 2000);
    expect(failed.produced.some(v => v.nodeId === 'build011c-swap')).toBe(true);
    expect(failed.recovery?.destinationGasSpentEth).toBe(250n);
    expect(failed.location).toContain('RESIDUAL_WALLET_BALANCE');
    expect(() => authorizeCrossChainCompensation(failed, h, swapTx, 20n, 2000)).toThrow('COMPENSATION_AUTHORIZATION_REQUIRED');
    const proposed = proposeCrossChainCompensation(failed, h);
    const authorized = authorizeCrossChainCompensation(proposed, bridgeTx, swapTx, 20n, 2000);
    expect(authorized.recovery?.compensation?.attemptId).toBe('compensation-swap.a1');
    const done = reconcileCrossChainCompensation(authorized, { owner, chainId: 42161,
      transactionHash: swapTx, status: 1, beforeWeth: input.amountWethDesired, afterWeth: 0n,
      beforeUsdc: input.amountUsdcDesired, afterUsdc: input.amountUsdcDesired + 100n, gasEth: 15n });
    expect(done.recovery?.destinationGasSpentEth).toBe(265n);
    expect(done.journal.entries.some(e => e.stepId === 'compensation-swap' && e.toState === 'CONFIRMED')).toBe(true);
    expect(done.journal.entries.some(e => e.stepId === 'liquidity-mint' && e.toState === 'REVERTED')).toBe(true);
  });
  it('persists mint attempt before unknown result and finds the LP without a second mint', () => {
    const prepared = prepareCrossChainLiquidity(swapped(), 2000);
    expect(prepared.journal.entries.some(e => e.stepId === 'liquidity-mint' && e.toState === 'PREPARED')).toBe(true);
    const unknown = markCrossChainMintUnknown(prepared);
    const input = unknown.liquidityInputs!;
    expect(() => reconcileCrossChainPosition(unknown, { owner, chainId: 42161,
      transactionHash: mintTx, status: 1, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth,
      token1: ARBITRUM_LIQUIDITY.usdc, fee: 500, tickLower: -200100, tickUpper: -199900,
      beforeWeth: input.amountWethDesired, afterWeth: input.residualWeth,
      beforeUsdc: input.amountUsdcDesired, afterUsdc: input.residualUsdc,
      remainingWethAllowance: 0n, remainingUsdcAllowance: 0n, liquidityGasEth: 150n })).toThrow('LIQUIDITY_RECONCILIATION_INVALID');
    const completed = reconcileCrossChainMintUnknown(unknown, known(mintTx), { owner, chainId: 42161,
      transactionHash: mintTx, status: 1, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth,
      token1: ARBITRUM_LIQUIDITY.usdc, fee: 500, tickLower: -200100, tickUpper: -199900,
      beforeWeth: input.amountWethDesired, afterWeth: input.residualWeth,
      beforeUsdc: input.amountUsdcDesired, afterUsdc: input.residualUsdc,
      remainingWethAllowance: 0n, remainingUsdcAllowance: 0n, liquidityGasEth: 150n }, 2000);
    expect(completed.stage).toBe('COMPLETED');
    expect(completed.final?.tokenId).toBe(77n);
    expect(completed.journal.entries.filter(e => e.stepId === 'liquidity-mint' && e.toState === 'PREPARED')).toHaveLength(1);
    expect(() => submitCrossChainLiquidity(completed, mintTx, 2000)).toThrow();
    const absent = reconcileCrossChainMintUnknown(unknown, missing(), null, 2000);
    expect(absent.recovery?.retryEligible).toBe(true);
    expect(crossChainRecoveryOptions(absent, 2000).find(o => o.action === 'RETRY')?.status).toBe('AVAILABLE');
    expect(() => prepareCrossChainMintRetry(absent, { manifestHash: bridgeTx, provider: 'lifi.rest',
      expectedUsdc: input.amountUsdcDesired, expectedWeth: input.amountWethDesired, nowMs: 2000 })).toThrow('MINT_RETRY_NOT_AUTHORIZED');
    const retry = prepareCrossChainMintRetry(absent, { manifestHash: h, provider: 'lifi.rest',
      expectedUsdc: input.amountUsdcDesired, expectedWeth: input.amountWethDesired, nowMs: 2000 });
    expect(retry.journal.entries.some(e => e.executionAttemptId === 'liquidity-mint.a2' && e.toState === 'PREPARED')).toBe(true);
    expect(retry.journal.entries.filter(e => e.stepId === 'bridge-submission')).toEqual(absent.journal.entries.filter(e => e.stepId === 'bridge-submission'));
    const sentAgain = submitCrossChainLiquidity(retry, mintTx, 2000);
    const recovered = reconcileCrossChainPosition(sentAgain, { owner, chainId: 42161, transactionHash: mintTx,
      status: 1, tokenId: 78n, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
      fee: 500, tickLower: -200100, tickUpper: -199900,
      beforeWeth: input.amountWethDesired, afterWeth: input.residualWeth,
      beforeUsdc: input.amountUsdcDesired, afterUsdc: input.residualUsdc,
      remainingWethAllowance: 0n, remainingUsdcAllowance: 0n, liquidityGasEth: 150n });
    expect(recovered.stage).toBe('COMPLETED');
    expect(recovered.journal.entries.some(e => e.executionAttemptId === 'liquidity-mint.a2' && e.toState === 'CONFIRMED')).toBe(true);
    expect(() => prepareCrossChainMintRetry(recovered, { manifestHash: h, provider: 'lifi.rest',
      expectedUsdc: input.amountUsdcDesired, expectedWeth: input.amountWethDesired, nowMs: 2000 })).toThrow();
    const inconclusive = reconcileCrossChainMintUnknown(unknown, { ...missing(), scanComplete: false }, null, 2000);
    expect(inconclusive.recovery?.outcome).toBe('INCONCLUSIVE');
    expect(crossChainRecoveryOptions(inconclusive, 2000).find(o => o.action === 'RETRY')?.status).toBe('BLOCKED');
  });
  it('reloads the persisted unknown attempt and reconciles without duplicate submission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gryloo-011c2-'));
    try {
      const store = createCrossChainRunStore(directory);
      const before = swapped();
      await expect(requestCrossChainMint(store, before, 2000, async () => {
        const persisted = await createCrossChainRunStore(directory).load(before.workflowId);
        expect(persisted.stage).toBe('LIQUIDITY_SUBMITTING');
        expect(persisted.journal.entries.some(e => e.toState === 'PREPARED' && e.stepId === 'liquidity-mint')).toBe(true);
        throw new Error('transport lost response');
      })).rejects.toThrow('SUBMISSION_RESULT_UNKNOWN');
      const restarted = await createCrossChainRunStore(directory).load(before.workflowId);
      expect(restarted.stage).toBe('SUBMISSION_RESULT_UNKNOWN');
      const input = restarted.liquidityInputs!;
      const completed = await recoverCrossChainMintAfterRestart(createCrossChainRunStore(directory), before.workflowId, known(mintTx), { owner, chainId: 42161,
        transactionHash: mintTx, status: 1, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth,
        token1: ARBITRUM_LIQUIDITY.usdc, fee: 500, tickLower: -200100, tickUpper: -199900,
        beforeWeth: input.amountWethDesired, afterWeth: input.residualWeth,
        beforeUsdc: input.amountUsdcDesired, afterUsdc: input.residualUsdc,
        remainingWethAllowance: 0n, remainingUsdcAllowance: 0n, liquidityGasEth: 150n }, 2000);
      const last = await createCrossChainRunStore(directory).load(before.workflowId);
      expect(last.stage).toBe('COMPLETED');
      expect(last.final?.tokenId).toBe(77n);
      expect(last.journal.entries.filter(e => e.stepId === 'liquidity-mint' && e.toState === 'PREPARED')).toHaveLength(1);
      expect(completed.stage).toBe('COMPLETED');
      await expect(store.save(restarted)).rejects.toThrow('JOURNAL_CORRUPT');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('records late bridge arrival and expired authority without downstream submission', () => {
    const arrived = bridged();
    const paused = pauseCrossChainDestination(arrived, 'POLICY_EXPIRED', 1500);
    expect(paused.recovery?.usdc).toBe(900_000_000n);
    expect(paused.location).toEqual(['DESTINATION_WALLET']);
    expect(crossChainRecoveryOptions(paused, 2000).find(o => o.action === 'RETRY')?.status).toBe('BLOCKED');
    expect(() => reviewCrossChainPreparation(paused, h, null, 2000)).toThrow('DESTINATION_REVIEW_INVALID');
    const stale = pauseCrossChainDestination(arrived, 'ARTIFACT_STALE', 5000);
    expect(stale.recovery?.reason).toBe('ARTIFACT_STALE');
    expect(crossChainRecoveryOptions(stale, 2000).find(o => o.action === 'REQUOTE')?.status).toBe('REQUIRES_NEW_AUTHORIZATION');
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/** Server-side MOCKED acceptance trace for the same canonical compiler, journal and evidence. */
import { ARBITRUM_LIQUIDITY, compileCrossChainLiquidityArtifacts, planCrossChainPreparation, sqrtRatioAtTick,
  type PoolState } from '@defi-workflow-engine/reference-compiler';
import { beginCrossChainRun, submitCrossChainBridge, reconcileCrossChainBridge, reviewCrossChainPreparation,
  reconcileCrossChainSwap, submitCrossChainLiquidity, reconcileCrossChainPosition,
  reconcileCrossChainSwapRevert, reconcileCrossChainMintRevert, prepareCrossChainLiquidity,
  markCrossChainMintUnknown, reconcileCrossChainMintUnknown, pauseCrossChainDestination,
  crossChainManualSummary, selectCrossChainManualIntervention, type CrossChainRun } from '@defi-workflow-engine/reference-executor';
import { buildCrossChainLiquidityEvidence, buildCrossChainRecoveryEvidence } from '@defi-workflow-engine/reference-reconciler';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
const h = '0x' + 'a'.repeat(64), sourceTx = '0x' + 'b'.repeat(64), destinationTx = '0x' + 'c'.repeat(64), swapTx = '0x' + 'd'.repeat(64);
const fixtureTarget = '0x2222222222222222222222222222222222222222';
const owner = '0x1111111111111111111111111111111111111111';
const units = (value: bigint, decimals: number) => {
  const negative = value < 0n; const n = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  return `${negative ? '-' : ''}${n.slice(0, -decimals)}.${n.slice(-decimals).replace(/0+$/, '').padEnd(1, '0')}`;
};
export type CrossChainSnapshot = { readonly stage: string; readonly location: string; readonly actual: string | null;
  readonly swapInput: string | null; readonly liquidityUsdc: string | null; readonly liquidityWeth: string | null;
  readonly lp: string | null; readonly residualUsdc: string | null; readonly residualWeth: string | null;
  readonly journalEntries: number };
const snapshot = (run: CrossChainRun): CrossChainSnapshot => ({ stage: run.stage.replaceAll('_', ' '),
  location: run.location.join(' + ').replaceAll('_', ' '),
  actual: run.produced.find(v => v.nodeId === 'build011c-bridge' && v.outputId === 'amount-out')?.amount
    ? units(BigInt(run.produced.find(v => v.nodeId === 'build011c-bridge' && v.outputId === 'amount-out')!.amount), 6) : null,
  swapInput: run.plan ? units(run.plan.swapInputUsdc, 6) : null,
  liquidityUsdc: run.liquidityInputs ? units(run.liquidityInputs.amountUsdcDesired, 6) :
    run.plan ? units(run.plan.liquidityUsdcBeforeMint, 6) : null,
  liquidityWeth: run.liquidityInputs ? units(run.liquidityInputs.amountWethDesired, 18) : null,
  lp: run.final?.tokenId.toString() ?? null,
  residualUsdc: run.final ? units(run.final.residualUsdc, 6) : null,
  residualWeth: run.final ? units(run.final.residualWeth, 18) : null,
  journalEntries: run.journal.entries.length });
export type MockCrossChainFailure = 'NONE' | 'SWAP_REVERT' | 'MINT_REVERT' | 'MINT_UNKNOWN_CONFIRMED' |
  'MINT_UNKNOWN_INCONCLUSIVE' | 'POLICY_EXPIRED' | 'ARTIFACT_STALE' | 'LATE_BRIDGE_SETTLEMENT';
export async function buildMockCrossChainLiquidityScenario(workflow: SemanticWorkflow, failure: MockCrossChainFailure = 'NONE') {
  const details = validateCrossChainLiquidityWorkflow(workflow);
  const nowMs = Date.now();
  const tick = details.noSwap ? details.tickUpper + 10 : Math.floor((details.tickLower + details.tickUpper) / 20) * 10;
  const pool: PoolState = { sourceChainId: 42161, executionChainId: 31337, sourceBlockHash: h, sourceBlockNumber: 1,
    pool: ARBITRUM_LIQUIDITY.pool, factory: ARBITRUM_LIQUIDITY.factory,
    positionManager: ARBITRUM_LIQUIDITY.positionManager, token0: ARBITRUM_LIQUIDITY.weth,
    token1: ARBITRUM_LIQUIDITY.usdc, fee: 500, tickSpacing: 10, tick,
    sqrtPriceX96: sqrtRatioAtTick(tick), poolCodeHash: h, positionManagerCodeHash: h,
    observedAtMs: nowMs, expiresAtMs: nowMs + 60_000 };
  const costs = { sourceGasEth: 100_000_000_000_000n, bridgeProviderFeeUsdc: 100_000n,
    destinationGasReserveEth: 1_000_000_000_000_000n, destinationSwapGasEth: details.noSwap ? 0n : 300_000_000_000_000n,
    liquidityGasEth: 600_000_000_000_000n };
  const source = BigInt(details.bridgeAmount), expected = source * 995n / 1000n,
    minimum = source * 990n / 1000n, actual = (expected + minimum) / 2n;
  const plan = planCrossChainPreparation({ expectedBridgeUsdc: expected, actualBridgeUsdc: actual,
    maximumAuthorizedSourceUsdc: source, destinationEthBalance: costs.destinationGasReserveEth,
    existingDestinationWeth: 0n, tickLower: details.tickLower, tickUpper: details.tickUpper,
    pool, nowMs, costs });
  if (plan.swapRequired === details.noSwap) throw new Error('MOCKED_RANGE_PATH_MISMATCH');
  const swapExpected = plan.swapRequired ? plan.estimatedSwapWeth : null;
  const swapMinimum = swapExpected === null ? null : swapExpected * 99n / 100n;
  const sourcePlan = planCrossChainPreparation({ expectedBridgeUsdc: expected, actualBridgeUsdc: expected,
    maximumAuthorizedSourceUsdc: source, destinationEthBalance: costs.destinationGasReserveEth,
    existingDestinationWeth: 0n, tickLower: details.tickLower, tickUpper: details.tickUpper,
    pool, nowMs, costs });
  const sourceSwapExpected = sourcePlan.swapRequired ? sourcePlan.estimatedSwapWeth : null;
  const artifactInput = { nowMs, owner, provider: details.bridgeProvider, sourceBlockNumber: 2,
    bridgeTarget: fixtureTarget, bridgePayloadHash: h, bridgeFunctionId: '0x12345678', bridgeQuoteHash: h,
    sourceUsdcAmount: source, bridgeExpectedUsdc: expected, bridgeMinimumUsdc: minimum, actualBridgeUsdc: actual as bigint | null,
    pool, tickLower: details.tickLower, tickUpper: details.tickUpper,
    destinationEthBalance: costs.destinationGasReserveEth, existingDestinationWeth: 0n,
    swapTarget: plan.swapRequired ? fixtureTarget : null, swapPayloadHash: plan.swapRequired ? h : null,
    swapFunctionId: plan.swapRequired ? '0xabcdef12' : null, swapQuoteHash: plan.swapRequired ? h : null,
    swapInputUsdc: plan.swapRequired ? plan.swapInputUsdc : null,
    swapExpectedWeth: swapExpected, swapMinimumWeth: swapMinimum, liquidityPayloadHash: h, costs,
    observedAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + 60_000).toISOString() };
  const sourceArtifacts = compileCrossChainLiquidityArtifacts(workflow, { ...artifactInput, actualBridgeUsdc: null,
    swapInputUsdc: sourcePlan.swapRequired ? sourcePlan.swapInputUsdc : null,
    swapExpectedWeth: sourceSwapExpected, swapMinimumWeth: sourceSwapExpected === null ? null : sourceSwapExpected * 99n / 100n });
  const artifacts = compileCrossChainLiquidityArtifacts(workflow, artifactInput);
  const finish = (value: CrossChainRun, steps: CrossChainSnapshot[], evidenceHash: string) => {
    const recovery = value.recovery ? crossChainManualSummary(value, nowMs) : null;
    return { format: 'gryloo.build011c.mocked.v1' as const, provider: details.bridgeProvider,
      sourceUsdc: units(source, 6), estimatedBridgeUsdc: units(expected, 6), minimumBridgeUsdc: units(minimum, 6),
      estimatedSwapWeth: units(plan.estimatedSwapWeth, 18), swapPoolFeeUsdc: units(plan.swapPoolFeeUsdc, 6),
      destinationGasReserveEth: units(costs.destinationGasReserveEth, 18), sourceGasEth: units(costs.sourceGasEth, 18),
      bridgeFeeUsdc: units(costs.bridgeProviderFeeUsdc, 6), destinationSwapGasEth: units(costs.destinationSwapGasEth, 18),
      liquidityGasEth: units(costs.liquidityGasEth, 18), pool: pool.pool, tickLower: details.tickLower, tickUpper: details.tickUpper,
      sourceManifestHash: sourceArtifacts.hashes.manifest, hashes: artifacts.hashes, evidenceHash, snapshots: steps,
      expiresAtMs: pool.expiresAtMs, manualEvidenceHash: null as string | null,
      requote: null as null | { readonly artifactSet: string; readonly simulation: string;
        readonly policy: string; readonly manifest: string; readonly review: 'REQUIRES_NEW_AUTHORIZATION' },
      recovery: recovery && { ...recovery, balances: {
        usdc: units(recovery.balances.usdc, 6), weth: units(recovery.balances.weth, 18) },
        sourceGasEth: units(recovery.sourceGasEth, 18), bridgeProviderFeeUsdc: units(recovery.bridgeProviderFeeUsdc, 6),
        destinationGasSpentEth: units(recovery.destinationGasSpentEth, 18) } };
  };
  const partial = (value: CrossChainRun, steps: CrossChainSnapshot[]) => {
    const manual = selectCrossChainManualIntervention(value);
    return { ...finish(value, steps, buildCrossChainRecoveryEvidence(artifacts, value, new Date(nowMs).toISOString()).hash),
      manualEvidenceHash: buildCrossChainRecoveryEvidence(artifacts, manual, new Date(nowMs).toISOString()).hash };
  };
  let run = beginCrossChainRun({ workflowId: workflow.workflowId, owner, provider: details.bridgeProvider,
    workflowHash: artifacts.hashes.workflow, executionPlanHash: artifacts.hashes.executionPlan,
    sourceManifestHash: sourceArtifacts.hashes.manifest, expectedBridgeUsdc: expected, minimumBridgeUsdc: minimum, maximumSourceUsdc: source,
    pool, tickLower: details.tickLower, tickUpper: details.tickUpper,
    destinationEthBalance: costs.destinationGasReserveEth, existingDestinationWeth: 0n, costs });
  const snapshots = [snapshot(run)];
  run = submitCrossChainBridge(run, sourceTx); snapshots.push(snapshot(run));
  run = reconcileCrossChainBridge(run, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.usdc,
    sourceHash: sourceTx, destinationHash: destinationTx, status: 1, before: 0n, after: actual },
    failure === 'LATE_BRIDGE_SETTLEMENT' ? pool.expiresAtMs + 1 : nowMs);
  snapshots.push(snapshot(run));
  if (failure === 'POLICY_EXPIRED' || failure === 'ARTIFACT_STALE' || failure === 'LATE_BRIDGE_SETTLEMENT') {
    const freshPool = { ...pool, sourceBlockHash: '0x' + 'e'.repeat(64), sourceBlockNumber: 2,
      observedAtMs: nowMs + 1_000, expiresAtMs: nowMs + 61_000 };
    const refreshed = failure === 'ARTIFACT_STALE' ? compileCrossChainLiquidityArtifacts(workflow, {
      ...artifactInput, nowMs: nowMs + 1_000, pool: freshPool, swapQuoteHash: plan.swapRequired ? '0x' + 'f'.repeat(64) : null,
      observedAt: new Date(nowMs + 1_000).toISOString(), expiresAt: new Date(nowMs + 61_000).toISOString() }) : null;
    run = pauseCrossChainDestination(run, failure === 'LATE_BRIDGE_SETTLEMENT' ? 'POLICY_EXPIRED' : failure, failure === 'POLICY_EXPIRED' || failure === 'LATE_BRIDGE_SETTLEMENT' ? nowMs - 1 : nowMs + 60_000);
    snapshots.push(snapshot(run));
    const result = partial(run, snapshots);
    return refreshed ? { ...result, requote: { artifactSet: refreshed.hashes.artifactSet,
      simulation: refreshed.hashes.simulation, policy: refreshed.hashes.policy,
      manifest: refreshed.hashes.manifest, review: 'REQUIRES_NEW_AUTHORIZATION' as const } } : result;
  }
  run = reviewCrossChainPreparation(run, artifacts.hashes.manifest, plan.swapRequired ? {
    inputUsdc: plan.swapInputUsdc, minimumWeth: swapMinimum!, expectedWeth: swapExpected!,
    expiresAtMs: pool.expiresAtMs, provider: 'lifi.rest', quoteHash: h } : null, nowMs);
  snapshots.push(snapshot(run));
  if (failure === 'SWAP_REVERT') {
    if (!plan.swapRequired) throw new Error('SWAP_FAILURE_REQUIRES_SWAP');
    run = reconcileCrossChainSwapRevert(run, { owner, chainId: 42161, transactionHash: swapTx, status: 0,
      usdc: actual, weth: 0n, gasEth: costs.destinationSwapGasEth }, nowMs);
    snapshots.push(snapshot(run));
    return partial(run, snapshots);
  }
  if (plan.swapRequired) {
    run = reconcileCrossChainSwap(run, { owner, chainId: 42161, token: ARBITRUM_LIQUIDITY.weth,
      transactionHash: swapTx, status: 1, before: 0n, after: swapMinimum!,
      beforeUsdc: actual, afterUsdc: actual - plan.swapInputUsdc }, nowMs);
    snapshots.push(snapshot(run));
  }
  if (failure === 'MINT_UNKNOWN_CONFIRMED' || failure === 'MINT_UNKNOWN_INCONCLUSIVE') {
    run = markCrossChainMintUnknown(prepareCrossChainLiquidity(run, nowMs)); snapshots.push(snapshot(run));
    if (failure === 'MINT_UNKNOWN_INCONCLUSIVE') {
      run = reconcileCrossChainMintUnknown(run, { payloadNonce: 4n, latestNonce: 4n, scannedBlocks: 0,
        scanComplete: false, matchingNonceTransactions: [], txpoolChecked: false, txpoolContainsNonce: false,
        waitedMs: 0, observedBlocks: 0, receiptLookup: null, transactionLookup: null, deadlineNear: false }, null, nowMs);
      snapshots.push(snapshot(run)); return partial(run, snapshots);
    }
  } else { run = submitCrossChainLiquidity(run, destinationTx, nowMs); snapshots.push(snapshot(run)); }
  const input = run.liquidityInputs!;
  if (failure === 'MINT_REVERT') {
    run = reconcileCrossChainMintRevert(run, { owner, chainId: 42161, transactionHash: destinationTx, status: 0,
      usdc: input.amountUsdcDesired, weth: input.amountWethDesired, gasEth: costs.liquidityGasEth }, nowMs);
    snapshots.push(snapshot(run)); return partial(run, snapshots);
  }
  const position = { owner, chainId: 42161 as const, transactionHash: destinationTx,
    status: 1 as const, tokenId: 77n, token0: ARBITRUM_LIQUIDITY.weth, token1: ARBITRUM_LIQUIDITY.usdc,
    fee: 500 as const, tickLower: run.tickLower, tickUpper: run.tickUpper,
    beforeWeth: input.amountWethDesired, afterWeth: input.residualWeth,
    beforeUsdc: input.amountUsdcDesired, afterUsdc: input.residualUsdc,
    remainingWethAllowance: 0n, remainingUsdcAllowance: 0n, liquidityGasEth: costs.liquidityGasEth };
  run = failure === 'MINT_UNKNOWN_CONFIRMED' ? reconcileCrossChainMintUnknown(run, {
    payloadNonce: 4n, latestNonce: 5n, scannedBlocks: 2, scanComplete: true,
    matchingNonceTransactions: [{ hash: destinationTx, exactPayload: true, confirmed: true }],
    txpoolChecked: true, txpoolContainsNonce: false, waitedMs: 30_000, observedBlocks: 2,
    receiptLookup: { status: 1 }, transactionLookup: { hash: destinationTx }, deadlineNear: false }, position, nowMs)
    : reconcileCrossChainPosition(run, position);
  snapshots.push(snapshot(run));
  const evidence = buildCrossChainLiquidityEvidence(artifacts, run, new Date(nowMs).toISOString());
  return finish(run, snapshots, evidence.hash);
}

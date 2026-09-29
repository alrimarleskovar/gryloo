// SPDX-License-Identifier: AGPL-3.0-only
/** Canonical staged journal for a MOCKED, non-atomic cross-chain liquidity composition. */
import { createJournal, appendJournalState } from './journal.js';
import { hashRawBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { planCrossChainPreparation, finalizeLiquidityInputs, type CrossChainPreparation,
  type CrossChainPreparationInput, type PoolState } from '@defi-workflow-engine/reference-compiler';
const enc = new TextEncoder();
const hash = (value: unknown) => hashRawBytes('raw-response', enc.encode(JSON.stringify(value)));
const H = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
export type AssetLocation = 'SOURCE_WALLET' | 'BRIDGE_IN_FLIGHT' | 'DESTINATION_WALLET' |
  'DESTINATION_SWAP_RESULT' | 'LIQUIDITY_POSITION' | 'RESIDUAL_WALLET_BALANCE';
export type ProducedValue = { readonly nodeId: string; readonly outputId: string; readonly chainId: 'eip155:42161';
  readonly token: string; readonly amount: string; readonly observationHash: string };
export type CrossChainStage = 'SOURCE_PREPARED' | 'BRIDGE_SUBMITTED' | 'DESTINATION_RECONCILED' |
  'PREPARATION_REVIEWED' | 'SWAP_RECONCILED' | 'LIQUIDITY_SUBMITTED' | 'COMPLETED';
export type CrossChainRun = {
  readonly workflowId: string; readonly owner: string; readonly provider: 'lifi.rest' | 'across.direct';
  readonly workflowHash: string; readonly executionPlanHash: string; readonly sourceManifestHash: string;
  readonly destinationManifestHash: string | null; readonly stage: CrossChainStage;
  readonly journal: ExecutionJournal; readonly location: readonly AssetLocation[];
  readonly expectedBridgeUsdc: bigint; readonly minimumBridgeUsdc: bigint; readonly maximumSourceUsdc: bigint;
  readonly sourceHash: string | null; readonly destinationHash: string | null; readonly liquidityHash: string | null;
  readonly pool: PoolState; readonly tickLower: number; readonly tickUpper: number;
  readonly destinationEthBalance: bigint; readonly existingDestinationWeth: bigint;
  readonly costs: CrossChainPreparationInput['costs']; readonly plan: CrossChainPreparation | null;
  readonly swapQuote: { readonly inputUsdc: bigint; readonly minimumWeth: bigint; readonly expectedWeth: bigint;
    readonly expiresAtMs: number; readonly provider: 'lifi.rest'; readonly quoteHash: string } | null;
  readonly actualSwapWeth: bigint | null; readonly liquidityInputs: ReturnType<typeof finalizeLiquidityInputs> | null;
  readonly produced: readonly ProducedValue[]; readonly observations: readonly { readonly step: string; readonly hash: string }[];
  readonly final: null | { readonly tokenId: bigint; readonly depositedWeth: bigint; readonly depositedUsdc: bigint;
    readonly residualWeth: bigint; readonly residualUsdc: bigint; readonly remainingWethAllowance: bigint;
    readonly remainingUsdcAllowance: bigint; readonly liquidityGasEth: bigint };
};
const usdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const weth = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
function record(run: CrossChainRun, segment: string, step: string, state: 'PENDING' | 'COMPLETED',
  attempt: boolean): ExecutionJournal {
  let journal = run.journal;
  const at = new Date().toISOString();
  const completeSegment = step === 'source-preparation' || step === 'destination-swap' ||
    (step === 'destination-preparation' && run.plan?.swapRequired === false) || step === 'final-reconciliation';
  const targets = [
    { level: 'workflow' as const, entityId: run.workflowId, segmentId: null, stepId: null, executionAttemptId: null,
      path: step === 'final-reconciliation' ? ['DRAFT', 'REVIEWED', 'SIMULATED', 'AUTHORIZED', 'EXECUTING', 'RECONCILING', 'COMPLETED'] : ['DRAFT', 'REVIEWED', 'SIMULATED', 'AUTHORIZED', 'EXECUTING'] },
    { level: 'segment' as const, entityId: segment, segmentId: segment, stepId: null, executionAttemptId: null,
      path: completeSegment ? ['PLANNED', 'READY', 'EXECUTING', 'RECONCILING', 'COMPLETED'] : ['PLANNED', 'READY', 'EXECUTING'] },
    { level: 'step' as const, entityId: step, segmentId: segment, stepId: step, executionAttemptId: null,
      path: state === 'COMPLETED' ? ['PLANNED', 'READY', 'EXECUTING', 'RECONCILING', 'COMPLETED'] : ['PLANNED', 'READY', 'EXECUTING'] },
    ...(attempt ? [{ level: 'attempt' as const, entityId: `${step}.a1`, segmentId: segment, stepId: step,
      executionAttemptId: `${step}.a1`, path: state === 'COMPLETED' ? ['PREPARED', 'SUBMITTING', 'CONFIRMED'] : ['PREPARED', 'SUBMITTING', 'PENDING'] }] : []),
  ];
  for (const target of targets) {
    const current = journal.entries.filter(e => e.level === target.level && e.entityId === target.entityId).at(-1)?.toState;
    const index = current ? target.path.indexOf(current) : -1;
    if (current && index < 0) throw new Error('CROSS_CHAIN_JOURNAL_STATE_INVALID');
    for (const toState of target.path.slice(index + 1)) {
      journal = appendJournalState(journal, { level: target.level, entityId: target.entityId,
        segmentId: target.segmentId, stepId: target.stepId, executionAttemptId: target.executionAttemptId,
        toState: toState as 'DRAFT', recordedAt: at }).journal;
    }
  }
  return journal;
}
export function beginCrossChainRun(input: Omit<CrossChainRun, 'stage' | 'journal' | 'location' | 'sourceHash' | 'destinationHash' |
  'destinationManifestHash' | 'liquidityHash' | 'plan' | 'swapQuote' | 'actualSwapWeth' | 'liquidityInputs' | 'produced' | 'observations' | 'final'>): CrossChainRun {
  if (!H(input.workflowHash) || !H(input.executionPlanHash) || !H(input.sourceManifestHash) ||
      !/^0x[0-9a-f]{40}$/.test(input.owner) || input.expectedBridgeUsdc < input.minimumBridgeUsdc ||
      input.minimumBridgeUsdc <= 0n || input.maximumSourceUsdc < input.expectedBridgeUsdc) throw new Error('CROSS_CHAIN_RUN_INVALID');
  let run: CrossChainRun = { ...input, stage: 'SOURCE_PREPARED',
    journal: createJournal({ journalId: `${input.workflowId}.journal`, workflowId: input.workflowId,
      executionPlanHash: input.executionPlanHash, manifestHash: input.sourceManifestHash }),
    location: ['SOURCE_WALLET'], sourceHash: null, destinationHash: null, liquidityHash: null, destinationManifestHash: null,
    plan: null, swapQuote: null, actualSwapWeth: null, liquidityInputs: null, produced: [], observations: [], final: null };
  run = { ...run, journal: record(run, 'source', 'source-preparation', 'COMPLETED', false) };
  return run;
}
export function submitCrossChainBridge(run: CrossChainRun, sourceHash: string): CrossChainRun {
  if (run.stage !== 'SOURCE_PREPARED' || !H(sourceHash)) throw new Error('BRIDGE_SUBMISSION_INVALID');
  return { ...run, stage: 'BRIDGE_SUBMITTED', sourceHash, location: ['BRIDGE_IN_FLIGHT'],
    journal: record(run, 'bridge', 'bridge-submission', 'PENDING', true),
    observations: [...run.observations, { step: 'bridge-submission', hash: hash({ sourceHash }) }] };
}
export type DestinationObservation = { readonly owner: string; readonly chainId: 42161; readonly token: string;
  readonly sourceHash: string; readonly destinationHash: string; readonly status: 1;
  readonly before: bigint; readonly after: bigint };
export function reconcileCrossChainBridge(run: CrossChainRun, observation: DestinationObservation, nowMs: number): CrossChainRun {
  if (run.stage !== 'BRIDGE_SUBMITTED' || observation.owner !== run.owner || observation.chainId !== 42161 ||
      observation.token !== usdc || observation.status !== 1 || observation.sourceHash !== run.sourceHash ||
      !H(observation.destinationHash) || observation.before < 0n || observation.after < observation.before)
    throw new Error('DESTINATION_RECONCILIATION_INVALID');
  const actual = observation.after - observation.before;
  if (actual < run.minimumBridgeUsdc || actual > run.maximumSourceUsdc) throw new Error('DESTINATION_AMOUNT_OUT_OF_BOUNDS');
  const plan = planCrossChainPreparation({ expectedBridgeUsdc: run.expectedBridgeUsdc, actualBridgeUsdc: actual,
    maximumAuthorizedSourceUsdc: run.maximumSourceUsdc, destinationEthBalance: run.destinationEthBalance,
    existingDestinationWeth: run.existingDestinationWeth, tickLower: run.tickLower, tickUpper: run.tickUpper,
    pool: run.pool, nowMs, costs: run.costs });
  const observationHash = hash({ ...observation, before: observation.before.toString(), after: observation.after.toString() });
  return { ...run, stage: 'DESTINATION_RECONCILED', destinationHash: observation.destinationHash, plan,
    location: ['DESTINATION_WALLET'], journal: record(run, 'destination', 'destination-reconciliation', 'COMPLETED', false),
    produced: [...run.produced, { nodeId: 'build011c-bridge', outputId: 'amount-out', chainId: 'eip155:42161',
      token: usdc, amount: actual.toString(), observationHash }],
    observations: [...run.observations, { step: 'destination-reconciliation', hash: observationHash }] };
}
export function reviewCrossChainPreparation(run: CrossChainRun, manifestHash: string, quote: CrossChainRun['swapQuote'], nowMs: number): CrossChainRun {
  if (run.stage !== 'DESTINATION_RECONCILED' || !run.plan || !H(manifestHash) ||
      (run.plan.swapRequired && (!quote || quote.provider !== 'lifi.rest' || quote.inputUsdc !== run.plan.swapInputUsdc ||
        quote.minimumWeth <= 0n || quote.minimumWeth > quote.expectedWeth || quote.expiresAtMs <= nowMs || !H(quote.quoteHash))) ||
      (!run.plan.swapRequired && quote)) throw new Error('DESTINATION_REVIEW_INVALID');
  const preparationHash = hash({ actual: run.plan.actualBridgeUsdc.toString(), swapInput: run.plan.swapInputUsdc.toString(),
    remaining: run.plan.liquidityUsdcBeforeMint.toString(), pool: run.pool.pool, tickLower: run.tickLower,
    tickUpper: run.tickUpper, manifestHash });
  const produced: ProducedValue[] = [
    { nodeId: 'build011c-prepare', outputId: 'swap-input', chainId: 'eip155:42161', token: usdc,
      amount: run.plan.swapInputUsdc.toString(), observationHash: preparationHash },
    { nodeId: 'build011c-prepare', outputId: 'liquidity-usdc', chainId: 'eip155:42161', token: usdc,
      amount: run.plan.liquidityUsdcBeforeMint.toString(), observationHash: preparationHash },
  ];
  if (!run.plan.swapRequired) produced.push({ nodeId: 'build011c-prepare', outputId: 'liquidity-weth',
    chainId: 'eip155:42161', token: weth, amount: run.existingDestinationWeth.toString(), observationHash: preparationHash });
  return { ...run, stage: 'PREPARATION_REVIEWED', destinationManifestHash: manifestHash, swapQuote: quote,
    journal: record(run, 'destination', 'destination-preparation', 'COMPLETED', false),
    produced: [...run.produced, ...produced], observations: [...run.observations, { step: 'destination-preparation', hash: preparationHash }] };
}
export type SwapObservation = { readonly owner: string; readonly chainId: 42161; readonly token: string;
  readonly transactionHash: string; readonly status: 1; readonly before: bigint; readonly after: bigint;
  readonly beforeUsdc: bigint; readonly afterUsdc: bigint };
export function reconcileCrossChainSwap(run: CrossChainRun, observation: SwapObservation, nowMs: number): CrossChainRun {
  if (run.stage !== 'PREPARATION_REVIEWED' || !run.plan?.swapRequired || !run.swapQuote ||
      observation.owner !== run.owner || observation.chainId !== 42161 || observation.token !== weth ||
      observation.status !== 1 || !H(observation.transactionHash) || observation.before < 0n ||
      observation.after < observation.before || observation.beforeUsdc < run.plan.swapInputUsdc ||
      observation.afterUsdc < 0n || observation.beforeUsdc - observation.afterUsdc !== run.plan.swapInputUsdc ||
      run.swapQuote.expiresAtMs <= nowMs)
    throw new Error('SWAP_RECONCILIATION_INVALID');
  const actual = observation.after - observation.before;
  if (actual < run.swapQuote.minimumWeth || actual > run.swapQuote.expectedWeth)
    throw new Error('SWAP_OUTPUT_OUT_OF_BOUNDS');
  const liquidityInputs = finalizeLiquidityInputs(run.plan, actual, run.pool, run.tickLower, run.tickUpper, nowMs);
  const observationHash = hash({ ...observation, before: observation.before.toString(), after: observation.after.toString(),
    beforeUsdc: observation.beforeUsdc.toString(), afterUsdc: observation.afterUsdc.toString() });
  return { ...run, stage: 'SWAP_RECONCILED', actualSwapWeth: actual, liquidityInputs,
    location: ['DESTINATION_SWAP_RESULT'], journal: record(run, 'destination', 'destination-swap', 'COMPLETED', true),
    produced: [...run.produced, { nodeId: 'build011c-swap', outputId: 'amount-out', chainId: 'eip155:42161',
      token: weth, amount: actual.toString(), observationHash }],
    observations: [...run.observations, { step: 'destination-swap', hash: observationHash }] };
}
export function submitCrossChainLiquidity(run: CrossChainRun, transactionHash: string, nowMs: number): CrossChainRun {
  if ((!run.plan?.swapRequired && run.stage !== 'PREPARATION_REVIEWED') ||
      (run.plan?.swapRequired && run.stage !== 'SWAP_RECONCILED') || !H(transactionHash) ||
      !run.destinationManifestHash || !run.plan) throw new Error('LIQUIDITY_SUBMISSION_INVALID');
  const liquidityInputs = run.liquidityInputs ?? finalizeLiquidityInputs(run.plan, 0n, run.pool,
    run.tickLower, run.tickUpper, nowMs);
  if (!liquidityInputs.expectedUsdcDeposit && !liquidityInputs.expectedWethDeposit)
    throw new Error('LIQUIDITY_EMPTY');
  return { ...run, stage: 'LIQUIDITY_SUBMITTED', liquidityInputs, liquidityHash: transactionHash,
    location: ['DESTINATION_WALLET'], journal: record(run, 'liquidity', 'liquidity-mint', 'PENDING', true),
    observations: [...run.observations, { step: 'liquidity-submission', hash: hash({ transactionHash }) }] };
}
export type PositionObservation = { readonly owner: string; readonly chainId: 42161; readonly transactionHash: string;
  readonly status: 1; readonly tokenId: bigint; readonly token0: string; readonly token1: string;
  readonly fee: 500; readonly tickLower: number; readonly tickUpper: number;
  readonly beforeWeth: bigint; readonly afterWeth: bigint; readonly beforeUsdc: bigint; readonly afterUsdc: bigint;
  readonly remainingWethAllowance: bigint; readonly remainingUsdcAllowance: bigint; readonly liquidityGasEth: bigint };
export function reconcileCrossChainPosition(run: CrossChainRun, observation: PositionObservation): CrossChainRun {
  const input = run.liquidityInputs;
  if (run.stage !== 'LIQUIDITY_SUBMITTED' || !input || observation.owner !== run.owner || observation.chainId !== 42161 ||
      observation.status !== 1 || observation.transactionHash !== run.liquidityHash ||
      observation.tokenId <= 0n || observation.token0 !== weth || observation.token1 !== usdc || observation.fee !== 500 ||
      observation.tickLower !== run.tickLower || observation.tickUpper !== run.tickUpper ||
      observation.beforeWeth !== input.amountWethDesired || observation.beforeUsdc !== input.amountUsdcDesired ||
      observation.afterWeth > observation.beforeWeth || observation.afterUsdc > observation.beforeUsdc ||
      observation.afterWeth < 0n || observation.afterUsdc < 0n || observation.remainingWethAllowance < 0n ||
      observation.remainingUsdcAllowance < 0n || observation.liquidityGasEth < 0n ||
      observation.liquidityGasEth > run.costs.liquidityGasEth) throw new Error('LIQUIDITY_RECONCILIATION_INVALID');
  const depositedWeth = observation.beforeWeth - observation.afterWeth;
  const depositedUsdc = observation.beforeUsdc - observation.afterUsdc;
  if (depositedWeth > input.amountWethDesired || depositedUsdc > input.amountUsdcDesired ||
      (!depositedWeth && !depositedUsdc)) throw new Error('LIQUIDITY_DEPOSIT_INVALID');
  const observationHash = hash({ ...observation, tokenId: observation.tokenId.toString(),
    beforeWeth: observation.beforeWeth.toString(), afterWeth: observation.afterWeth.toString(),
    beforeUsdc: observation.beforeUsdc.toString(), afterUsdc: observation.afterUsdc.toString(),
    remainingWethAllowance: observation.remainingWethAllowance.toString(),
    remainingUsdcAllowance: observation.remainingUsdcAllowance.toString(), liquidityGasEth: observation.liquidityGasEth.toString() });
  return { ...run, stage: 'COMPLETED', location: ['LIQUIDITY_POSITION', 'RESIDUAL_WALLET_BALANCE'],
    journal: record(run, 'liquidity', 'final-reconciliation', 'COMPLETED', false),
    produced: [...run.produced, { nodeId: 'build011c-mint', outputId: 'position-nft', chainId: 'eip155:42161',
      token: '0xc36442b4a4522e871399cd717abdd847ab11fe88', amount: observation.tokenId.toString(), observationHash },
      { nodeId: 'build011c-mint', outputId: 'residual-weth', chainId: 'eip155:42161', token: weth,
        amount: observation.afterWeth.toString(), observationHash },
      { nodeId: 'build011c-mint', outputId: 'residual-usdc', chainId: 'eip155:42161', token: usdc,
        amount: observation.afterUsdc.toString(), observationHash }],
    observations: [...run.observations, { step: 'final-reconciliation', hash: observationHash }],
    final: { tokenId: observation.tokenId, depositedWeth, depositedUsdc, residualWeth: observation.afterWeth,
      residualUsdc: observation.afterUsdc, remainingWethAllowance: observation.remainingWethAllowance,
      remainingUsdcAllowance: observation.remainingUsdcAllowance, liquidityGasEth: observation.liquidityGasEth } };
}

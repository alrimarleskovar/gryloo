// SPDX-License-Identifier: AGPL-3.0-only
/** Canonical staged journal for a MOCKED, non-atomic cross-chain liquidity composition. */
import { createJournal, appendJournalState } from './journal.js';
import { classifyUnknownResult, type RecoveryEvidence } from './recovery.js';
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
  'PREPARATION_REVIEWED' | 'SWAP_RECONCILED' | 'LIQUIDITY_PREPARED' | 'LIQUIDITY_SUBMITTING' | 'LIQUIDITY_SUBMITTED' |
  'SUBMISSION_RESULT_UNKNOWN' | 'PARTIALLY_COMPLETED' | 'RECOVERY_REQUIRED' | 'COMPLETED';
export type CrossChainRecovery = { readonly failedStep: 'destination-preparation' | 'destination-swap' | 'liquidity-mint';
  readonly outcome: 'RECONCILED' | 'INCONCLUSIVE' | 'DIVERGENT'; readonly reason: string;
  readonly usdc: bigint; readonly weth: bigint; readonly destinationGasSpentEth: bigint;
  readonly attemptId: string | null; readonly retryEligible: boolean; readonly authorityExpiresAtMs: number;
  readonly manual: boolean; readonly compensation: null | { readonly proposalHash: string;
    readonly manifestHash: string | null; readonly authorizationHash: string | null;
    readonly attemptId: string | null; readonly gasEth: bigint } };
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
  readonly recovery: CrossChainRecovery | null;
};
const usdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const weth = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
function record(run: CrossChainRun, segment: string, step: string, state: 'PENDING' | 'COMPLETED',
  attempt: boolean): ExecutionJournal {
  let journal = run.journal;
  const at = new Date().toISOString();
  const completeSegment = state === 'COMPLETED' && (step === 'source-preparation' || step === 'destination-swap' ||
    (step === 'destination-preparation' && run.plan?.swapRequired === false) || step === 'final-reconciliation');
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
  'destinationManifestHash' | 'liquidityHash' | 'plan' | 'swapQuote' | 'actualSwapWeth' | 'liquidityInputs' | 'produced' | 'observations' | 'final' | 'recovery'>): CrossChainRun {
  if (!H(input.workflowHash) || !H(input.executionPlanHash) || !H(input.sourceManifestHash) ||
      !/^0x[0-9a-f]{40}$/.test(input.owner) || input.expectedBridgeUsdc < input.minimumBridgeUsdc ||
      input.minimumBridgeUsdc <= 0n || input.maximumSourceUsdc < input.expectedBridgeUsdc) throw new Error('CROSS_CHAIN_RUN_INVALID');
  let run: CrossChainRun = { ...input, stage: 'SOURCE_PREPARED',
    journal: createJournal({ journalId: `${input.workflowId}.journal`, workflowId: input.workflowId,
      executionPlanHash: input.executionPlanHash, manifestHash: input.sourceManifestHash }),
    location: ['SOURCE_WALLET'], sourceHash: null, destinationHash: null, liquidityHash: null, destinationManifestHash: null,
    plan: null, swapQuote: null, actualSwapWeth: null, liquidityInputs: null, produced: [], observations: [], final: null,
    recovery: null };
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
  const plan = nowMs >= run.pool.expiresAtMs ? null : planCrossChainPreparation({ expectedBridgeUsdc: run.expectedBridgeUsdc, actualBridgeUsdc: actual,
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
export function prepareCrossChainLiquidity(run: CrossChainRun, nowMs: number): CrossChainRun {
  if ((!run.plan?.swapRequired && run.stage !== 'PREPARATION_REVIEWED') ||
      (run.plan?.swapRequired && run.stage !== 'SWAP_RECONCILED') ||
      !run.destinationManifestHash || !run.plan || run.pool.expiresAtMs <= nowMs ||
      (run.swapQuote && run.swapQuote.expiresAtMs <= nowMs)) throw new Error('LIQUIDITY_PREPARATION_INVALID');
  const liquidityInputs = run.liquidityInputs ?? finalizeLiquidityInputs(run.plan, 0n, run.pool,
    run.tickLower, run.tickUpper, nowMs);
  if (!liquidityInputs.expectedUsdcDeposit && !liquidityInputs.expectedWethDeposit)
    throw new Error('LIQUIDITY_EMPTY');
  let journal = record(run, 'liquidity', 'liquidity-mint', 'PENDING', false);
  journal = appendJournalState(journal, { level: 'attempt', entityId: 'liquidity-mint.a1',
    segmentId: 'liquidity', stepId: 'liquidity-mint', executionAttemptId: 'liquidity-mint.a1',
    toState: 'PREPARED', recordedAt: new Date(nowMs).toISOString() }).journal;
  return { ...run, stage: 'LIQUIDITY_PREPARED', liquidityInputs, journal,
    location: run.plan.swapRequired ? ['DESTINATION_SWAP_RESULT', 'RESIDUAL_WALLET_BALANCE'] : ['DESTINATION_WALLET'] };
}
function mintAttemptId(run: CrossChainRun): string {
  const id = run.journal.entries.filter(e => e.level === 'attempt' && e.stepId === 'liquidity-mint').at(-1)?.executionAttemptId;
  if (!id) throw new Error('MINT_ATTEMPT_MISSING');
  return id;
}
export function submitCrossChainLiquidity(prepared: CrossChainRun, transactionHash: string, nowMs: number): CrossChainRun {
  const run = prepared.stage === 'LIQUIDITY_PREPARED' || prepared.stage === 'LIQUIDITY_SUBMITTING'
    ? prepared : prepareCrossChainLiquidity(prepared, nowMs);
  if (!H(transactionHash)) throw new Error('LIQUIDITY_SUBMISSION_INVALID');
  let journal = run.journal;
  const attemptId = mintAttemptId(run);
  journal = appendCrossChainState(journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'SUBMITTING');
  journal = appendCrossChainState(journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'PENDING');
  return { ...run, stage: 'LIQUIDITY_SUBMITTED', liquidityHash: transactionHash, journal,
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
      observation.status !== 1 || (run.liquidityHash !== null && observation.transactionHash !== run.liquidityHash) || !H(observation.transactionHash) ||
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
  const attemptJournal = appendCrossChainState(run.journal, 'attempt', mintAttemptId(run), 'liquidity', 'liquidity-mint', 'CONFIRMED');
  const priorState = attemptJournal.entries.filter(e => e.level === 'workflow').at(-1)?.toState;
  const finalJournal = priorState === 'PARTIALLY_COMPLETED' || priorState === 'RECOVERY_REQUIRED'
    ? appendCrossChainState(attemptJournal, 'workflow', run.workflowId, null, null, 'RECONCILING') : attemptJournal;
  return { ...run, stage: 'COMPLETED', liquidityHash: observation.transactionHash, recovery: null,
    location: ['LIQUIDITY_POSITION', 'RESIDUAL_WALLET_BALANCE'],
    journal: record({ ...run, journal: finalJournal }, 'liquidity', 'final-reconciliation', 'COMPLETED', false),
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

/** Append an existing runtime transition without rewriting any prior journal entry. */
function appendCrossChainState(journal: ExecutionJournal, level: 'workflow' | 'segment' | 'step' | 'attempt',
  entityId: string, segmentId: string | null, stepId: string | null, toState: 'RECONCILING' | 'RECOVERY_REQUIRED' |
  'PARTIALLY_COMPLETED' | 'SUBMITTING' | 'PENDING' | 'SUBMISSION_RESULT_UNKNOWN' | 'CONFIRMED' | 'REVERTED' |
  'NOT_FOUND' | 'RECONCILIATION_REQUIRED' | 'PAUSED' | 'PREPARED' | 'PLANNED' | 'READY' | 'EXECUTING' | 'COMPLETED'): ExecutionJournal {
  const current = journal.entries.filter(e => e.level === level && e.entityId === entityId).at(-1)?.toState;
  if (current === toState) return journal;
  return appendJournalState(journal, { level, entityId, segmentId, stepId,
    executionAttemptId: level === 'attempt' ? entityId : null, toState,
    recordedAt: new Date().toISOString() }).journal;
}
function partialJournal(run: CrossChainRun, segment: string, step: string, attemptState?: 'REVERTED' | 'RECONCILIATION_REQUIRED' | 'NOT_FOUND') {
  let journal = run.journal;
  if (attemptState) journal = appendCrossChainState(journal, 'attempt', step === 'liquidity-mint' ? mintAttemptId(run) : `${step}.a1`, segment, step, attemptState);
  journal = appendCrossChainState(journal, 'step', step, segment, step, 'RECONCILING');
  journal = appendCrossChainState(journal, 'step', step, segment, step, 'RECOVERY_REQUIRED');
  journal = appendCrossChainState(journal, 'workflow', run.workflowId, null, null, 'RECONCILING');
  return appendCrossChainState(journal, 'workflow', run.workflowId, null, null, 'PARTIALLY_COMPLETED');
}
function recovery(run: CrossChainRun, failedStep: CrossChainRecovery['failedStep'], reason: string,
  usdcBalance: bigint, wethBalance: bigint, gas: bigint, expiry: number, outcome: CrossChainRecovery['outcome'] = 'RECONCILED',
  attemptId: string | null = null): CrossChainRecovery {
  if (usdcBalance < 0n || wethBalance < 0n || gas < 0n || !Number.isFinite(expiry)) throw new Error('RECOVERY_OBSERVATION_INVALID');
  return { failedStep, reason, outcome, usdc: usdcBalance, weth: wethBalance,
    destinationGasSpentEth: gas, authorityExpiresAtMs: expiry, attemptId, retryEligible: false,
    manual: false, compensation: null };
}
/** A reverted destination swap does not undo the independently reconciled bridge. */
export function reconcileCrossChainSwapRevert(run: CrossChainRun, observed: { readonly owner: string;
  readonly chainId: 42161; readonly transactionHash: string; readonly status: 0;
  readonly usdc: bigint; readonly weth: bigint; readonly gasEth: bigint }, nowMs: number): CrossChainRun {
  if (!Number.isFinite(nowMs) || run.stage !== 'PREPARATION_REVIEWED' || !run.plan?.swapRequired || !run.swapQuote ||
    observed.owner !== run.owner || observed.chainId !== 42161 || observed.status !== 0 || !H(observed.transactionHash) ||
    observed.usdc !== run.plan.actualBridgeUsdc || observed.weth !== run.existingDestinationWeth ||
    observed.gasEth < 0n || observed.gasEth > run.costs.destinationSwapGasEth) throw new Error('SWAP_FAILURE_RECONCILIATION_INVALID');
  const pending = { ...run, journal: record(run, 'destination', 'destination-swap', 'PENDING', true) };
  const journal = partialJournal(pending, 'destination', 'destination-swap', 'REVERTED');
  return { ...run, stage: 'PARTIALLY_COMPLETED', journal, location: ['DESTINATION_WALLET'],
    recovery: recovery(run, 'destination-swap', 'DESTINATION_SWAP_REVERTED', observed.usdc, observed.weth,
      observed.gasEth, run.swapQuote.expiresAtMs, 'RECONCILED', 'destination-swap.a1'),
    observations: [...run.observations, { step: 'destination-swap-reverted', hash: hash({
      transactionHash: observed.transactionHash, usdc: observed.usdc.toString(), weth: observed.weth.toString(),
      gasEth: observed.gasEth.toString() }) }] };
}
/** Reverted mint retains the successful swap and observed destination token balances. */
export function reconcileCrossChainMintRevert(run: CrossChainRun, observed: { readonly owner: string;
  readonly chainId: 42161; readonly transactionHash: string; readonly status: 0;
  readonly usdc: bigint; readonly weth: bigint; readonly gasEth: bigint }, nowMs: number): CrossChainRun {
  if (run.stage !== 'LIQUIDITY_SUBMITTED' || !run.liquidityInputs || observed.owner !== run.owner ||
    observed.chainId !== 42161 || observed.status !== 0 || observed.transactionHash !== run.liquidityHash ||
    observed.usdc !== run.liquidityInputs.amountUsdcDesired || observed.weth !== run.liquidityInputs.amountWethDesired ||
    observed.gasEth < 0n || observed.gasEth > run.costs.liquidityGasEth) throw new Error('MINT_FAILURE_RECONCILIATION_INVALID');
  return { ...run, stage: 'PARTIALLY_COMPLETED', location: ['DESTINATION_SWAP_RESULT', 'RESIDUAL_WALLET_BALANCE'],
    journal: partialJournal(run, 'liquidity', 'liquidity-mint', 'REVERTED'),
    recovery: recovery(run, 'liquidity-mint', 'LIQUIDITY_MINT_REVERTED', observed.usdc, observed.weth,
      run.costs.destinationSwapGasEth + observed.gasEth, Math.min(run.pool.expiresAtMs, nowMs + 60_000), 'RECONCILED', mintAttemptId(run)),
    observations: [...run.observations, { step: 'liquidity-mint-reverted', hash: hash({
      transactionHash: observed.transactionHash, usdc: observed.usdc.toString(), weth: observed.weth.toString(),
      gasEth: observed.gasEth.toString() }) }] };
}
/** The prepared attempt is already in the journal before the transport result becomes unknown. */
export function markCrossChainMintSubmitting(prepared: CrossChainRun): CrossChainRun {
  if (prepared.stage !== 'LIQUIDITY_PREPARED') throw new Error('MINT_SUBMISSION_STATE_INVALID');
  const attemptId = mintAttemptId(prepared);
  return { ...prepared, stage: 'LIQUIDITY_SUBMITTING',
    journal: appendCrossChainState(prepared.journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'SUBMITTING') };
}
export function markCrossChainMintUnknown(prepared: CrossChainRun): CrossChainRun {
  if (!['LIQUIDITY_PREPARED', 'LIQUIDITY_SUBMITTING'].includes(prepared.stage)) throw new Error('MINT_UNKNOWN_STATE_INVALID');
  const attemptId = mintAttemptId(prepared);
  let journal = appendCrossChainState(prepared.journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'SUBMITTING');
  journal = appendCrossChainState(journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'SUBMISSION_RESULT_UNKNOWN');
  return { ...prepared, stage: 'SUBMISSION_RESULT_UNKNOWN', journal,
    observations: [...prepared.observations,
      { step: 'liquidity-submission', hash: hash({ attemptId, result: 'UNKNOWN' }) },
      { step: 'liquidity-result-unknown', hash: hash({ attemptId }) }] };
}
/** Use the shared nonce/block/txpool classifier; a missing HTTP response cannot locate assets. */
export function reconcileCrossChainMintUnknown(run: CrossChainRun, evidence: RecoveryEvidence,
  observation: PositionObservation | null, nowMs: number): CrossChainRun {
  if (!Number.isFinite(nowMs) || run.stage !== 'SUBMISSION_RESULT_UNKNOWN' || !run.liquidityInputs) throw new Error('MINT_UNKNOWN_STATE_INVALID');
  const decision = classifyUnknownResult(evidence);
  if (decision.outcome === 'CONFIRMED') {
    if (!observation || evidence.matchingNonceTransactions[0]?.hash !== observation.transactionHash)
      throw new Error('MINT_POSITION_OBSERVATION_REQUIRED');
    return reconcileCrossChainPosition({ ...run, stage: 'LIQUIDITY_SUBMITTED',
      liquidityHash: observation.transactionHash, observations: [...run.observations,
        { step: 'liquidity-reconciliation', hash: hash({ outcome: 'CONFIRMED', transactionHash: observation.transactionHash }) }] },
      observation);
  }
  if (observation) throw new Error('MINT_RECONCILIATION_DIVERGENT');
  const priorUsdc = run.liquidityInputs.amountUsdcDesired, priorWeth = run.liquidityInputs.amountWethDesired;
  const status = decision.outcome === 'NOT_FOUND' ? 'NOT_FOUND' : 'RECONCILIATION_REQUIRED';
  const journal = partialJournal(run, 'liquidity', 'liquidity-mint', status);
  return { ...run, stage: 'RECOVERY_REQUIRED', journal, location: ['DESTINATION_SWAP_RESULT', 'RESIDUAL_WALLET_BALANCE'],
    recovery: { ...recovery(run, 'liquidity-mint', decision.reason, priorUsdc, priorWeth,
      run.costs.destinationSwapGasEth, run.pool.expiresAtMs, decision.outcome === 'DIVERGENT' ? 'DIVERGENT' :
        decision.outcome === 'NOT_FOUND' ? 'RECONCILED' : 'INCONCLUSIVE', mintAttemptId(run)),
      retryEligible: decision.outcome === 'NOT_FOUND' && decision.retryAllowed },
    observations: [...run.observations, { step: 'liquidity-reconciliation', hash: hash({
      outcome: decision.outcome, reason: decision.reason }) }] };
}
/** Expiry and stale artifacts pause downstream activity without hiding settled destination funds. */
export function pauseCrossChainDestination(run: CrossChainRun, reason: 'POLICY_EXPIRED' | 'ARTIFACT_STALE',
  authorityExpiresAtMs: number): CrossChainRun {
  if (run.stage !== 'DESTINATION_RECONCILED') throw new Error('DESTINATION_PAUSE_INVALID');
  const observedUsdc = run.produced.find(v => v.nodeId === 'build011c-bridge' && v.outputId === 'amount-out');
  if (!observedUsdc) throw new Error('DESTINATION_BALANCE_UNKNOWN');
  const step = 'destination-preparation';
  const pending = { ...run, journal: record(run, 'destination', step, 'PENDING', false) };
  return { ...run, stage: 'RECOVERY_REQUIRED', location: ['DESTINATION_WALLET'],
    journal: partialJournal(pending, 'destination', step),
    recovery: recovery(run, step, reason, BigInt(observedUsdc.amount), run.existingDestinationWeth,
      0n, authorityExpiresAtMs),
    observations: [...run.observations, { step: 'destination-paused', hash: hash({ reason, authorityExpiresAtMs }) }] };
}
export type RecoveryOption = { readonly action: 'RETRY' | 'REQUOTE' | 'COMPENSATE' | 'STOP' | 'MANUAL';
  readonly status: 'AVAILABLE' | 'REQUIRES_NEW_AUTHORIZATION' | 'BLOCKED' | 'NOT_SUPPORTED'; readonly reason: string };
export function crossChainRecoveryOptions(run: CrossChainRun, nowMs: number): readonly RecoveryOption[] {
  const r = run.recovery;
  if (!r || !['PARTIALLY_COMPLETED', 'RECOVERY_REQUIRED'].includes(run.stage)) return [];
  const valid = nowMs < r.authorityExpiresAtMs && nowMs < run.pool.expiresAtMs &&
    (!run.swapQuote || nowMs < run.swapQuote.expiresAtMs);
  return [
    { action: 'RETRY', status: r.outcome !== 'RECONCILED' ? 'BLOCKED' : !r.retryEligible ? 'BLOCKED' :
      valid ? 'AVAILABLE' : 'REQUIRES_NEW_AUTHORIZATION', reason: r.retryEligible ?
        valid ? 'Exact attempt not found; current bounds must be checked before submission' : 'Authority or artifact expired' :
        'No independently established, retryable NOT_FOUND attempt' },
    { action: 'REQUOTE', status: 'REQUIRES_NEW_AUTHORIZATION', reason: 'Fresh artifacts and material Manifest review required' },
    { action: 'COMPENSATE', status: r.weth > 0n ? 'REQUIRES_NEW_AUTHORIZATION' : 'NOT_SUPPORTED',
      reason: r.weth > 0n ? 'Separate destination swap proposal, budget and signature required' :
        'No supported compensating action for destination USDC' },
    { action: 'STOP', status: 'AVAILABLE', reason: 'Leave observed assets in the destination wallet' },
    { action: 'MANUAL', status: 'AVAILABLE', reason: 'Stop local continuation and retain evidence for the owner' },
  ];
}
export function selectCrossChainManualIntervention(run: CrossChainRun): CrossChainRun {
  if (!run.recovery || !['PARTIALLY_COMPLETED', 'RECOVERY_REQUIRED'].includes(run.stage)) throw new Error('MANUAL_STATE_INVALID');
  let journal = appendCrossChainState(run.journal, 'workflow', run.workflowId, null, null, 'RECOVERY_REQUIRED');
  journal = appendCrossChainState(journal, 'workflow', run.workflowId, null, null, 'PAUSED');
  return { ...run, journal, recovery: { ...run.recovery, manual: true, retryEligible: false },
    observations: [...run.observations, { step: 'manual-intervention', hash: hash({ executionId: run.workflowId }) }] };
}
export function proposeCrossChainCompensation(run: CrossChainRun, proposalHash: string): CrossChainRun {
  if (!run.recovery || run.recovery.outcome !== 'RECONCILED' || run.recovery.weth <= 0n || !H(proposalHash))
    throw new Error('COMPENSATION_PROPOSAL_INVALID');
  return { ...run, recovery: { ...run.recovery, compensation: { proposalHash, manifestHash: null, authorizationHash: null,
    attemptId: null, gasEth: 0n } }, observations: [...run.observations,
      { step: 'compensation-proposed', hash: hash({ proposalHash, weth: run.recovery.weth.toString() }) }] };
}
/** Compensation has a distinct reviewed Manifest and attempt; original effects remain immutable. */
export function authorizeCrossChainCompensation(run: CrossChainRun, manifestHash: string, authorizationHash: string,
  gasBudgetEth: bigint, nowMs: number): CrossChainRun {
  const r = run.recovery, c = r?.compensation;
  if (!r || !c || c.manifestHash || !H(manifestHash) || !H(authorizationHash) || manifestHash === run.destinationManifestHash ||
    authorizationHash === c.proposalHash || gasBudgetEth <= 0n ||
    nowMs >= r.authorityExpiresAtMs) throw new Error('COMPENSATION_AUTHORIZATION_REQUIRED');
  const attemptId = 'compensation-swap.a1';
  let journal = run.journal;
  for (const state of ['PLANNED', 'READY', 'EXECUTING'] as const)
    journal = appendCrossChainState(journal, 'segment', 'recovery', 'recovery', null, state);
  for (const state of ['PLANNED', 'READY', 'EXECUTING'] as const)
    journal = appendCrossChainState(journal, 'step', 'compensation-swap', 'recovery', 'compensation-swap', state);
  journal = appendCrossChainState(journal, 'attempt', attemptId, 'recovery', 'compensation-swap', 'PREPARED');
  return { ...run, journal, recovery: { ...r, compensation: { ...c, manifestHash, authorizationHash, attemptId, gasEth: gasBudgetEth } },
    observations: [...run.observations, { step: 'compensation-authorized', hash: hash({ manifestHash, authorizationHash, attemptId }) }] };
}
export function crossChainManualSummary(run: CrossChainRun, nowMs: number) {
  const r = run.recovery;
  if (!r) throw new Error('RECOVERY_SUMMARY_UNAVAILABLE');
  return { executionId: run.workflowId, workflowState: run.journal.entries.filter(e => e.level === 'workflow').at(-1)?.toState,
    completed: run.produced.map(v => v.nodeId), failedStep: r.failedStep, chainId: 'eip155:42161',
    location: run.location, balances: { usdc: r.usdc, weth: r.weth }, sourceGasEth: run.costs.sourceGasEth,
    bridgeProviderFeeUsdc: run.costs.bridgeProviderFeeUsdc, destinationGasSpentEth: r.destinationGasSpentEth,
    authority: nowMs >= r.authorityExpiresAtMs ? 'EXPIRED' : 'VALID', manifestHash: run.destinationManifestHash,
    expiresAtMs: r.authorityExpiresAtMs, evidence: r.outcome, options: crossChainRecoveryOptions(run, nowMs),
    localExecutionPaused: r.manual, authorityRevoked: false };
}

/** A new MOCKED destination swap, independently observed and charged to its own budget. */
export function reconcileCrossChainCompensation(run: CrossChainRun, observed: { readonly owner: string;
  readonly chainId: 42161; readonly transactionHash: string; readonly status: 1;
  readonly beforeWeth: bigint; readonly afterWeth: bigint; readonly beforeUsdc: bigint;
  readonly afterUsdc: bigint; readonly gasEth: bigint }): CrossChainRun {
  const r = run.recovery, c = r?.compensation;
  if (!r || !c?.manifestHash || !c.authorizationHash || !c.attemptId || r.outcome !== 'RECONCILED' ||
    observed.owner !== run.owner || observed.chainId !== 42161 || observed.status !== 1 ||
    !H(observed.transactionHash) || observed.beforeWeth !== r.weth || observed.afterWeth !== 0n ||
    observed.beforeUsdc !== r.usdc || observed.afterUsdc <= observed.beforeUsdc ||
    observed.gasEth < 0n || observed.gasEth > c.gasEth) throw new Error('COMPENSATION_RECONCILIATION_INVALID');
  let journal = appendCrossChainState(run.journal, 'attempt', c.attemptId, 'recovery', 'compensation-swap', 'SUBMITTING');
  journal = appendCrossChainState(journal, 'attempt', c.attemptId, 'recovery', 'compensation-swap', 'CONFIRMED');
  journal = appendCrossChainState(journal, 'step', 'compensation-swap', 'recovery', 'compensation-swap', 'RECONCILING');
  journal = appendCrossChainState(journal, 'step', 'compensation-swap', 'recovery', 'compensation-swap', 'COMPLETED');
  journal = appendCrossChainState(journal, 'segment', 'recovery', 'recovery', null, 'RECONCILING');
  journal = appendCrossChainState(journal, 'segment', 'recovery', 'recovery', null, 'COMPLETED');
  const observationHash = hash({ transactionHash: observed.transactionHash,
    beforeWeth: observed.beforeWeth.toString(), afterWeth: observed.afterWeth.toString(),
    beforeUsdc: observed.beforeUsdc.toString(), afterUsdc: observed.afterUsdc.toString(),
    gasEth: observed.gasEth.toString() });
  return { ...run, journal, location: ['DESTINATION_WALLET'],
    recovery: { ...r, usdc: observed.afterUsdc, weth: 0n,
      destinationGasSpentEth: r.destinationGasSpentEth + observed.gasEth,
      compensation: { ...c, gasEth: observed.gasEth } },
    observations: [...run.observations, { step: 'compensation-reconciled', hash: observationHash }] };
}

/** Only an independently proven NOT_FOUND first attempt can create the one bounded retry. */
export function prepareCrossChainMintRetry(run: CrossChainRun, input: { readonly manifestHash: string;
  readonly provider: 'lifi.rest' | 'across.direct'; readonly expectedUsdc: bigint;
  readonly expectedWeth: bigint; readonly nowMs: number }): CrossChainRun {
  const r = run.recovery, prior = run.journal.entries.filter(e => e.level === 'attempt' && e.stepId === 'liquidity-mint');
  if (run.stage !== 'RECOVERY_REQUIRED' || !r || r.failedStep !== 'liquidity-mint' ||
    r.outcome !== 'RECONCILED' || !r.retryEligible || prior.at(-1)?.toState !== 'NOT_FOUND' ||
    prior.at(-1)?.executionAttemptId !== 'liquidity-mint.a1' || !run.liquidityInputs ||
    input.manifestHash !== run.destinationManifestHash || input.provider !== run.provider ||
    input.expectedUsdc !== r.usdc || input.expectedWeth !== r.weth ||
    input.nowMs >= r.authorityExpiresAtMs || input.nowMs >= run.pool.expiresAtMs ||
    (run.swapQuote && input.nowMs >= run.swapQuote.expiresAtMs) ||
    run.destinationEthBalance - r.destinationGasSpentEth < run.costs.liquidityGasEth)
    throw new Error('MINT_RETRY_NOT_AUTHORIZED');
  const attemptId = 'liquidity-mint.a2';
  const journal = appendCrossChainState(run.journal, 'attempt', attemptId, 'liquidity', 'liquidity-mint', 'PREPARED');
  return { ...run, stage: 'LIQUIDITY_PREPARED', journal, liquidityHash: null,
    recovery: { ...r, retryEligible: false, attemptId },
    observations: [...run.observations, { step: 'liquidity-retry-prepared', hash: hash({
      attemptId, manifestHash: input.manifestHash, usdc: r.usdc.toString(), weth: r.weth.toString() }) }] };
}


/** The store fsyncs PREPARED and SUBMITTING before the modeled external send. */
export async function requestCrossChainMint(store: { save(run: CrossChainRun): Promise<void> }, run: CrossChainRun,
  nowMs: number, send: () => Promise<string>): Promise<CrossChainRun> {
  const prepared = run.stage === 'LIQUIDITY_PREPARED' ? run : prepareCrossChainLiquidity(run, nowMs);
  await store.save(prepared);
  const submitting = markCrossChainMintSubmitting(prepared);
  await store.save(submitting);
  let transactionHash: string;
  try { transactionHash = await send(); }
  catch (error) {
    await store.save(markCrossChainMintUnknown(submitting));
    throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause: error });
  }
  try {
    const pending = submitCrossChainLiquidity(submitting, transactionHash, nowMs);
    await store.save(pending);
    return pending;
  } catch (error) {
    await store.save(markCrossChainMintUnknown(submitting));
    throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause: error });
  }
}
/** A process restart never resends a SUBMITTING/UNKNOWN mint; it reconciles first. */
export async function recoverCrossChainMintAfterRestart(store: { load(id: string): Promise<CrossChainRun>;
  save(run: CrossChainRun): Promise<void> }, executionId: string, evidence: RecoveryEvidence,
  observation: PositionObservation | null, nowMs: number): Promise<CrossChainRun> {
  let run = await store.load(executionId);
  if (run.stage === 'LIQUIDITY_SUBMITTING') {
    run = markCrossChainMintUnknown(run);
    await store.save(run);
  }
  const reconciled = reconcileCrossChainMintUnknown(run, evidence, observation, nowMs);
  await store.save(reconciled);
  return reconciled;
}

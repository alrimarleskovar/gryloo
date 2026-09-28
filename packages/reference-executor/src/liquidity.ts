// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-006 Mode A position journal. Each wallet request is independently prepared. */
import { prepareAttemptState, transitionAttemptState, type Attempt } from './attempts.js';
export const LIQUIDITY_STEPS = ['approve-weth', 'approve-usdc', 'mint', 'inspect', 'increase', 'decrease-partial',
  'collect-partial', 'decrease-full', 'collect-final', 'burn', 'reset-weth', 'reset-usdc'] as const;
export type LiquidityStep = typeof LIQUIDITY_STEPS[number];
export type LiquidityAttempt = Attempt & { readonly stepId: LiquidityStep };
export type LiquidityJournal = { readonly format: 'gryloo.liquidity-journal.v1'; readonly executionId: string;
  readonly workflowHash: string; readonly profileHash: string; readonly attempts: readonly LiquidityAttempt[];
  readonly reconciled: readonly LiquidityStep[]; readonly frozen: boolean };
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
export function newLiquidityJournal(executionId: string, workflowHash: string, profileHash: string): LiquidityJournal {
  if (!/^liquidity-[0-9a-f]{24}$/.test(executionId) || !hash(workflowHash) || !hash(profileHash)) throw new Error('LIQUIDITY_JOURNAL_INVALID');
  return { format: 'gryloo.liquidity-journal.v1', executionId, workflowHash, profileHash, attempts: [], reconciled: [], frozen: false };
}
export function prepareLiquidityAttempt(journal: LiquidityJournal, input: { readonly step: LiquidityStep;
  readonly idempotencyKey: string; readonly payloadHash: string; readonly blockNumber: number;
  readonly prerequisite: readonly LiquidityStep[] }): { journal: LiquidityJournal; attempt: LiquidityAttempt } {
  const existing = journal.attempts.find(item => item.stepId === input.step && item.idempotencyKey === input.idempotencyKey);
  if (existing) {
    if (existing.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
    if (existing.state !== 'PREPARED') throw new Error('LIQUIDITY_ATTEMPT_ALREADY_REQUESTED');
    return { journal, attempt: existing };
  }
  if (journal.frozen || !LIQUIDITY_STEPS.includes(input.step) || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)
    || input.prerequisite.some(step => !journal.reconciled.includes(step)) ||
    journal.attempts.some(item => !['REVERTED', 'NOT_FOUND', 'CONFIRMED'].includes(item.state))) throw new Error('LIQUIDITY_NOT_READY');
  if (journal.reconciled.includes(input.step) && input.step !== 'increase' && input.step !== 'inspect') throw new Error('LIQUIDITY_STEP_ALREADY_DONE');
  const result = prepareAttemptState(journal.attempts, { executionId: journal.executionId, stepId: input.step,
    idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash, preparedAtBlock: input.blockNumber,
    priorStepConfirmed: true });
  if (result.kind === 'IDEMPOTENT') {
    if (result.attempt.state !== 'PREPARED') throw new Error('LIQUIDITY_ATTEMPT_ALREADY_REQUESTED');
    return { journal, attempt: result.attempt as LiquidityAttempt };
  }
  const attempt = result.attempt as LiquidityAttempt;
  return { journal: { ...journal, attempts: [...journal.attempts, attempt] }, attempt };
}
export function advanceLiquidityAttempt(journal: LiquidityJournal, attemptId: string, state: Attempt['state'], hashValue: string | null = null): LiquidityJournal {
  const index = journal.attempts.findIndex(item => item.executionAttemptId === attemptId);
  if (index < 0) throw new Error('LIQUIDITY_ATTEMPT_UNKNOWN');
  const current = journal.attempts[index]!;
  const updated = transitionAttemptState(current, state, hashValue ?? current.transactionHash) as LiquidityAttempt;
  return { ...journal, attempts: journal.attempts.map((item, at) => at === index ? updated : item),
    frozen: journal.frozen || state === 'SUBMISSION_RESULT_UNKNOWN' || state === 'RECONCILIATION_REQUIRED' };
}
export function markLiquidityReconciled(journal: LiquidityJournal, step: LiquidityStep, attemptId: string): LiquidityJournal {
  const attempt = journal.attempts.find(item => item.executionAttemptId === attemptId && item.stepId === step);
  if (!attempt || attempt.state !== 'CONFIRMED' || journal.frozen) throw new Error('LIQUIDITY_RECONCILIATION_NOT_READY');
  return { ...journal, reconciled: [...new Set([...journal.reconciled, step])] };
}
/** Unknown requests stay frozen until independent chain and nonce evidence is reviewed. No automatic replacement. */
export function classifyLiquidityUnknown(journal: LiquidityJournal, input: { readonly attemptId: string;
  readonly senderNonce: bigint; readonly reviewedNonce: bigint; readonly matchingTxHash: string | null;
  readonly completeBlockScan: boolean }): { readonly outcome: 'FOUND' | 'NOT_FOUND' | 'INCONCLUSIVE'; readonly journal: LiquidityJournal } {
  const attempt = journal.attempts.find(item => item.executionAttemptId === input.attemptId);
  if (!attempt || attempt.state !== 'SUBMISSION_RESULT_UNKNOWN') throw new Error('LIQUIDITY_UNKNOWN_STATE_INVALID');
  if (input.matchingTxHash && hash(input.matchingTxHash)) {
    return { outcome: 'FOUND', journal: { ...advanceLiquidityAttempt(journal, input.attemptId, 'PENDING', input.matchingTxHash), frozen: false } };
  }
  if (input.completeBlockScan && input.senderNonce === input.reviewedNonce)
    return { outcome: 'NOT_FOUND', journal: { ...advanceLiquidityAttempt(journal, input.attemptId, 'NOT_FOUND'), frozen: false } };
  return { outcome: 'INCONCLUSIVE', journal };
}

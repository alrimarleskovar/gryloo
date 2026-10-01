// SPDX-License-Identifier: AGPL-3.0-only
import { createJournal, appendJournalState } from './journal.js';
import { solanaSwapArtifactHash, solanaSwapHash, type OrcaLiquidityReview } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import type { SolanaSwapAttempt, SolanaSwapAttemptState } from './jupiter.js';
import { SOLANA_SWAP_TERMINAL_STATES } from './jupiter.js';

/**
 * BUILD-015: one owner-signed Solana transaction per liquidity operation (OPEN, DECREASE_PARTIAL, EXIT). The attempt is
 * durable before the wallet is asked; the owner signature (the transaction identity) and the exact signed bytes are durable
 * before the single broadcast. The same attempt states and no-resubmission rules as the canonical Solana swap apply.
 * Each operation is its own idempotent recovery boundary; position identity (the position mint) is part of the reviewed
 * message and therefore survives restart before any signature exists.
 */
export type OrcaLiquidityAttemptState = SolanaSwapAttemptState;
export type OrcaLiquidityAttempt = SolanaSwapAttempt;
export type OrcaLiquidityProvenance = 'PUBLIC_DEVNET' | 'MOCKED';
export type OrcaLiquidityRun = { format: 'gryloo.orca-liquidity-run.v1'; id: string; operation: OrcaLiquidityReview['operation']; positionMint: string;
  review: OrcaLiquidityReview; provenance: OrcaLiquidityProvenance; authorization: string | null; attempt: OrcaLiquidityAttempt | null; journal: ExecutionJournal;
  verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE' | 'NOT_EXECUTED'; ownerInitiated: boolean };
export const ORCA_LIQUIDITY_ID = /^orcalp-[a-f0-9]{32}$/;
const fail = (code: string): never => { throw new Error(code); };
const names = (run: Pick<OrcaLiquidityRun, 'id' | 'operation'>) => {
  const step = `orca-liquidity-${run.operation.toLowerCase().replaceAll('_', '-')}`;
  return { segment: 'orca-liquidity-segment', step, attempt: `${run.id}.${run.operation.toLowerCase()}` };
};

export function createOrcaLiquidityRun(id: string, review: OrcaLiquidityReview, provenance: OrcaLiquidityProvenance): OrcaLiquidityRun {
  if (!ORCA_LIQUIDITY_ID.test(id)) fail('ORCA_LIQUIDITY_ID_INVALID');
  const base = { id, operation: review.operation };
  const { segment, step } = names(base);
  if (review.plan.segments[0]?.steps[0]?.stepId !== step) fail('ORCA_LIQUIDITY_AUTHORIZATION_INVALID');
  let journal = createJournal({ journalId: id, workflowId: review.workflow.workflowId,
    executionPlanHash: solanaSwapArtifactHash('execution-plan', review.plan), manifestHash: solanaSwapArtifactHash('strategy-manifest', review.manifest) });
  const append = (level: 'workflow' | 'segment' | 'step', entityId: string, toState: 'DRAFT' | 'PLANNED' | 'REVIEWED' | 'SIMULATED', stepId: string | null) => {
    journal = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : segment, stepId, executionAttemptId: null,
      toState, recordedAt: new Date().toISOString() }).journal;
  };
  append('workflow', review.workflow.workflowId, 'DRAFT', null);
  append('segment', segment, 'PLANNED', null);
  append('step', step, 'PLANNED', step);
  append('workflow', review.workflow.workflowId, 'REVIEWED', null);
  append('workflow', review.workflow.workflowId, 'SIMULATED', null);
  return { format: 'gryloo.orca-liquidity-run.v1', id, operation: review.operation, positionMint: review.accounts.positionMint, review, provenance,
    authorization: null, attempt: null, journal, verdict: 'PENDING', ownerInitiated: false };
}
export function orcaLiquidityTransition(run: OrcaLiquidityRun, state: OrcaLiquidityAttemptState, patch: Partial<OrcaLiquidityAttempt> = {}): OrcaLiquidityRun {
  const attempt = run.attempt ?? fail('ORCA_LIQUIDITY_ATTEMPT_MISSING');
  if (attempt.signature && patch.signature && patch.signature !== attempt.signature) fail('ORCA_LIQUIDITY_SIGNATURE_DIVERGENT');
  if (attempt.state === state) return { ...run, attempt: { ...attempt, ...patch } };
  const n = names(run);
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: n.attempt, segmentId: n.segment, stepId: n.step,
    executionAttemptId: n.attempt, toState: state, recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt: { ...attempt, ...patch, state } };
}
/** Durable economic intent, persisted by the coordinator BEFORE the wallet is asked to sign. */
export function prepareOrcaLiquidityAttempt(run: OrcaLiquidityRun, blockHeight: number): OrcaLiquidityRun {
  if (run.verdict !== 'PENDING') fail('ORCA_LIQUIDITY_RUN_TERMINAL');
  if (run.attempt) fail('ORCA_LIQUIDITY_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if (run.authorization !== run.review.commitment) fail('ORCA_LIQUIDITY_REVIEW_REQUIRED');
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= run.review.lastValidBlockHeight) fail('ORCA_LIQUIDITY_REVIEW_STALE');
  const attempt: OrcaLiquidityAttempt = { state: 'PREPARED', preparedAtBlockHeight: blockHeight, messageHash: run.review.messageHash,
    signature: null, transaction: null, reconciled: false };
  const n = names(run);
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: n.attempt, segmentId: n.segment, stepId: n.step,
    executionAttemptId: n.attempt, toState: 'PREPARED', recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt, ownerInitiated: true };
}
/** The fully signed bytes and the owner signature become durable before any broadcast. */
export function recordOrcaLiquiditySignature(run: OrcaLiquidityRun, signed: { signature: string; transaction: string }): OrcaLiquidityRun {
  if (run.attempt?.state !== 'PREPARED') fail('ORCA_LIQUIDITY_ATTEMPT_NOT_PREPARED');
  return orcaLiquidityTransition(run, 'SUBMITTING', { signature: signed.signature, transaction: signed.transaction });
}
/** An owner may hold one unresolved liquidity attempt at a time, across runs, tabs and processes. */
export function orcaLiquidityAttemptResolved(run: OrcaLiquidityRun): boolean {
  return !run.attempt || SOLANA_SWAP_TERMINAL_STATES.includes(run.attempt.state) && run.attempt.state !== 'RECONCILIATION_REQUIRED' || run.verdict !== 'PENDING';
}
export function validateOrcaLiquidityRun(run: OrcaLiquidityRun): void {
  const corrupt = 'ORCA_LIQUIDITY_STORE_CORRUPT';
  if (!run || run.format !== 'gryloo.orca-liquidity-run.v1' || !ORCA_LIQUIDITY_ID.test(run.id) || !['MOCKED', 'PUBLIC_DEVNET'].includes(run.provenance) ||
      run.review?.format !== 'gryloo.orca-liquidity-review.v1' || run.operation !== run.review.operation || run.positionMint !== run.review.accounts.positionMint) fail(corrupt);
  const { commitment, ...review } = run.review;
  if (solanaSwapHash(review) !== commitment || solanaSwapArtifactHash('execution-plan', run.review.plan) !== run.journal.executionPlanHash ||
      solanaSwapArtifactHash('strategy-manifest', run.review.manifest) !== run.journal.manifestHash || run.journal.journalId !== run.id ||
      run.journal.workflowId !== run.review.workflow.workflowId || run.authorization !== null && run.authorization !== commitment ||
      typeof run.ownerInitiated !== 'boolean' || run.ownerInitiated !== Boolean(run.attempt) ||
      !['PENDING', 'RECONCILED', 'DIVERGENT', 'INCONCLUSIVE', 'NOT_EXECUTED'].includes(run.verdict)) fail(corrupt);
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const attempt = run.attempt;
  if (!attempt) { if (run.verdict !== 'PENDING') fail(corrupt); return; }
  const n = names(run);
  const entry = [...run.journal.entries].reverse().find(e => e.entityId === n.attempt);
  const signed = !['PREPARED', 'CANCELLED'].includes(attempt.state);
  if (entry?.toState !== attempt.state || attempt.messageHash !== run.review.messageHash || !Number.isSafeInteger(attempt.preparedAtBlockHeight) ||
      signed !== Boolean(attempt.signature && attempt.transaction) || attempt.signature !== null && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(attempt.signature) ||
      typeof attempt.reconciled !== 'boolean' || attempt.reconciled !== (attempt.state === 'CONFIRMED') ||
      run.verdict === 'RECONCILED' && !attempt.reconciled) fail(corrupt);
}

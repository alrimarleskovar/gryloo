// SPDX-License-Identifier: AGPL-3.0-only
import { createJournal, appendJournalState } from './journal.js';
import { jupiterArtifactHash, jupiterHash, type JupiterReview } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

/**
 * One owner-signed Solana transaction per run. The signature is the transaction identity and is
 * durable BEFORE broadcast. A reviewed blockhash that is past its last valid block height without
 * the signature on chain is definitive proof the transaction can never land.
 */
export type JupiterAttemptState = 'PREPARED' | 'CANCELLED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'PENDING' | 'CONFIRMED' |
  'REVERTED' | 'EXPIRED' | 'NOT_FOUND' | 'RECONCILIATION_REQUIRED';
export type JupiterAttempt = { state: JupiterAttemptState; preparedAtBlockHeight: number; messageHash: string;
  signature: string | null; transaction: string | null; reconciled: boolean };
export type JupiterRun = { format: 'gryloo.jupiter-run.v1'; id: string; review: JupiterReview; provenance: 'PUBLIC_MAINNET' | 'MOCKED';
  authorization: string | null; attempt: JupiterAttempt | null; journal: ExecutionJournal;
  verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE' | 'NOT_EXECUTED'; ownerInitiated: boolean };
export const JUPITER_TERMINAL_STATES: readonly JupiterAttemptState[] = ['CANCELLED', 'CONFIRMED', 'REVERTED', 'EXPIRED', 'NOT_FOUND', 'RECONCILIATION_REQUIRED'];
const SEGMENT = 'jupiter-segment', STEP = 'jupiter-swap';
const fail = (code: string): never => { throw new Error(code); };

export function createJupiterRun(id: string, review: JupiterReview, provenance: JupiterRun['provenance']): JupiterRun {
  let journal = createJournal({ journalId: id, workflowId: review.workflow.workflowId,
    executionPlanHash: jupiterArtifactHash('execution-plan', review.plan), manifestHash: jupiterArtifactHash('strategy-manifest', review.manifest) });
  const append = (level: 'workflow' | 'segment' | 'step', entityId: string, toState: 'DRAFT' | 'PLANNED' | 'REVIEWED' | 'SIMULATED', stepId: string | null) => {
    journal = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : SEGMENT, stepId, executionAttemptId: null,
      toState, recordedAt: new Date().toISOString() }).journal;
  };
  append('workflow', review.workflow.workflowId, 'DRAFT', null);
  append('segment', SEGMENT, 'PLANNED', null);
  append('step', STEP, 'PLANNED', STEP);
  append('workflow', review.workflow.workflowId, 'REVIEWED', null);
  append('workflow', review.workflow.workflowId, 'SIMULATED', null);
  return { format: 'gryloo.jupiter-run.v1', id, review, provenance, authorization: null, attempt: null, journal, verdict: 'PENDING', ownerInitiated: false };
}
export function jupiterTransition(run: JupiterRun, state: JupiterAttemptState, patch: Partial<JupiterAttempt> = {}): JupiterRun {
  const attempt = run.attempt ?? fail('JUPITER_ATTEMPT_MISSING');
  if (attempt.signature && patch.signature && patch.signature !== attempt.signature) fail('JUPITER_SIGNATURE_DIVERGENT');
  if (attempt.state === state) return { ...run, attempt: { ...attempt, ...patch } };
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: `${run.id}.swap`, segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: `${run.id}.swap`, toState: state, recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt: { ...attempt, ...patch, state } };
}
/** Durable economic intent, persisted by the coordinator BEFORE the wallet is asked to sign. */
export function prepareJupiterAttempt(run: JupiterRun, blockHeight: number): JupiterRun {
  if (run.verdict !== 'PENDING') fail('JUPITER_RUN_TERMINAL');
  if (run.attempt) fail('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if (run.authorization !== run.review.commitment) fail('JUPITER_REVIEW_REQUIRED');
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= run.review.lastValidBlockHeight) fail('JUPITER_QUOTE_STALE');
  const attempt: JupiterAttempt = { state: 'PREPARED', preparedAtBlockHeight: blockHeight, messageHash: run.review.messageHash,
    signature: null, transaction: null, reconciled: false };
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: `${run.id}.swap`, segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: `${run.id}.swap`, toState: 'PREPARED', recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt, ownerInitiated: true };
}
/** The owner-signed bytes and signature become durable before any broadcast. */
export function recordJupiterSignature(run: JupiterRun, signed: { signature: string; transaction: string }): JupiterRun {
  if (run.attempt?.state !== 'PREPARED') fail('JUPITER_ATTEMPT_NOT_PREPARED');
  return jupiterTransition(run, 'SUBMITTING', { signature: signed.signature, transaction: signed.transaction });
}
export type JupiterObservationDecision = 'FOUND' | 'WAIT' | 'EXPIRED';
/** Absence is conclusive only after finalized block height has passed the reviewed blockhash validity. */
export function jupiterObservationDecision(found: boolean, finalizedBlockHeight: number, lastValidBlockHeight: number): JupiterObservationDecision {
  if (found) return 'FOUND';
  if (!Number.isSafeInteger(finalizedBlockHeight)) fail('SOLANA_RPC_INVALID');
  return finalizedBlockHeight > lastValidBlockHeight ? 'EXPIRED' : 'WAIT';
}
/** An owner may hold one unresolved Jupiter attempt at a time across runs and processes. */
export function jupiterAttemptResolved(run: JupiterRun): boolean {
  return !run.attempt || JUPITER_TERMINAL_STATES.includes(run.attempt.state) && run.attempt.state !== 'RECONCILIATION_REQUIRED' || run.verdict !== 'PENDING';
}
export function validateJupiterRun(run: JupiterRun): void {
  if (run.format !== 'gryloo.jupiter-run.v1' || !/^jupiter-[a-f0-9]{32}$/.test(run.id) || !['PUBLIC_MAINNET', 'MOCKED'].includes(run.provenance)) fail('JUPITER_STORE_CORRUPT');
  const { commitment, ...review } = run.review;
  if (jupiterHash(review) !== commitment || jupiterArtifactHash('execution-plan', run.review.plan) !== run.journal.executionPlanHash ||
      jupiterArtifactHash('strategy-manifest', run.review.manifest) !== run.journal.manifestHash || run.journal.journalId !== run.id ||
      run.journal.workflowId !== run.review.workflow.workflowId || run.authorization !== null && run.authorization !== commitment ||
      typeof run.ownerInitiated !== 'boolean' || run.ownerInitiated !== Boolean(run.attempt) ||
      !['PENDING', 'RECONCILED', 'DIVERGENT', 'INCONCLUSIVE', 'NOT_EXECUTED'].includes(run.verdict)) fail('JUPITER_STORE_CORRUPT');
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const attempt = run.attempt;
  if (!attempt) { if (run.verdict !== 'PENDING') fail('JUPITER_STORE_CORRUPT'); return; }
  const entry = [...run.journal.entries].reverse().find(e => e.entityId === `${run.id}.swap`);
  const signed = !['PREPARED', 'CANCELLED'].includes(attempt.state);
  if (entry?.toState !== attempt.state || attempt.messageHash !== run.review.messageHash || !Number.isSafeInteger(attempt.preparedAtBlockHeight) ||
      signed !== Boolean(attempt.signature && attempt.transaction) || attempt.signature !== null && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(attempt.signature) ||
      typeof attempt.reconciled !== 'boolean' || attempt.reconciled !== (attempt.state === 'CONFIRMED') ||
      run.verdict === 'RECONCILED' && !attempt.reconciled) fail('JUPITER_STORE_CORRUPT');
}

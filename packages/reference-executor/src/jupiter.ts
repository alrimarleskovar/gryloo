// SPDX-License-Identifier: AGPL-3.0-only
import { createJournal, appendJournalState } from './journal.js';
import { requireSolanaSwapRuntime, solanaSwapArtifactHash, solanaSwapHash, type SolanaSwapReview } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

/**
 * One owner-signed Solana transaction per run, shared by every runtime of the canonical swap (Jupiter mainnet-beta,
 * Orca Whirlpools Devnet). The signature is the transaction identity and is durable BEFORE broadcast. A reviewed
 * blockhash past its last valid block height without the signature on chain is definitive proof it can never land.
 */
export type SolanaSwapAttemptState = 'PREPARED' | 'CANCELLED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'PENDING' | 'CONFIRMED' |
  'REVERTED' | 'EXPIRED' | 'NOT_FOUND' | 'RECONCILIATION_REQUIRED';
export type SolanaSwapAttempt = { state: SolanaSwapAttemptState; preparedAtBlockHeight: number; messageHash: string;
  signature: string | null; transaction: string | null; reconciled: boolean };
export type SolanaSwapProvenance = 'PUBLIC_MAINNET' | 'PUBLIC_DEVNET' | 'MOCKED';
export type SolanaSwapRun = { format: 'gryloo.jupiter-run.v1' | 'gryloo.orca-devnet-run.v1'; id: string; review: SolanaSwapReview; provenance: SolanaSwapProvenance;
  authorization: string | null; attempt: SolanaSwapAttempt | null; journal: ExecutionJournal;
  verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE' | 'NOT_EXECUTED'; ownerInitiated: boolean };
export const SOLANA_SWAP_TERMINAL_STATES: readonly SolanaSwapAttemptState[] = ['CANCELLED', 'CONFIRMED', 'REVERTED', 'EXPIRED', 'NOT_FOUND', 'RECONCILIATION_REQUIRED'];
const fail = (code: string): never => { throw new Error(code); };
const runtimeOf = (review: SolanaSwapReview) => requireSolanaSwapRuntime(review.chain);
/** Errors carry the runtime's prefix: JUPITER_* on mainnet-beta, DEVNET_SWAP_* on Devnet. */
const code = (run: Pick<SolanaSwapRun, 'review'>, suffix: string) => `${runtimeOf(run.review).codePrefix}_${suffix}`;
const names = (review: SolanaSwapReview) => { const prefix = runtimeOf(review).idPrefix; return { segment: `${prefix}-segment`, step: `${prefix}-swap` }; };
const formatOf = (review: SolanaSwapReview): SolanaSwapRun['format'] => review.format === 'gryloo.orca-devnet-review.v1' ? 'gryloo.orca-devnet-run.v1' : 'gryloo.jupiter-run.v1';

export function createSolanaSwapRun(id: string, review: SolanaSwapReview, provenance: SolanaSwapProvenance): SolanaSwapRun {
  const { segment, step } = names(review);
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
  return { format: formatOf(review), id, review, provenance, authorization: null, attempt: null, journal, verdict: 'PENDING', ownerInitiated: false };
}
export function solanaSwapTransition(run: SolanaSwapRun, state: SolanaSwapAttemptState, patch: Partial<SolanaSwapAttempt> = {}): SolanaSwapRun {
  const attempt = run.attempt ?? fail(code(run, 'ATTEMPT_MISSING'));
  if (attempt.signature && patch.signature && patch.signature !== attempt.signature) fail(code(run, 'SIGNATURE_DIVERGENT'));
  if (attempt.state === state) return { ...run, attempt: { ...attempt, ...patch } };
  const { segment, step } = names(run.review);
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: `${run.id}.swap`, segmentId: segment, stepId: step,
    executionAttemptId: `${run.id}.swap`, toState: state, recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt: { ...attempt, ...patch, state } };
}
/** Durable economic intent, persisted by the coordinator BEFORE the wallet is asked to sign. */
export function prepareSolanaSwapAttempt(run: SolanaSwapRun, blockHeight: number): SolanaSwapRun {
  if (run.verdict !== 'PENDING') fail(code(run, 'RUN_TERMINAL'));
  if (run.attempt) fail(code(run, 'EXISTING_ATTEMPT_OBSERVE_ONLY'));
  if (run.authorization !== run.review.commitment) fail(code(run, 'REVIEW_REQUIRED'));
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= run.review.lastValidBlockHeight) fail(code(run, 'QUOTE_STALE'));
  const attempt: SolanaSwapAttempt = { state: 'PREPARED', preparedAtBlockHeight: blockHeight, messageHash: run.review.messageHash,
    signature: null, transaction: null, reconciled: false };
  const { segment, step } = names(run.review);
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: `${run.id}.swap`, segmentId: segment, stepId: step,
    executionAttemptId: `${run.id}.swap`, toState: 'PREPARED', recordedAt: new Date().toISOString() }).journal;
  return { ...run, journal, attempt, ownerInitiated: true };
}
/** The owner-signed bytes and signature become durable before any broadcast. */
export function recordSolanaSwapSignature(run: SolanaSwapRun, signed: { signature: string; transaction: string }): SolanaSwapRun {
  if (run.attempt?.state !== 'PREPARED') fail(code(run, 'ATTEMPT_NOT_PREPARED'));
  return solanaSwapTransition(run, 'SUBMITTING', { signature: signed.signature, transaction: signed.transaction });
}
export type SolanaSwapObservationDecision = 'FOUND' | 'WAIT' | 'EXPIRED';
/** Absence is conclusive only after finalized block height has passed the reviewed blockhash validity. */
export function solanaSwapObservationDecision(found: boolean, finalizedBlockHeight: number, lastValidBlockHeight: number): SolanaSwapObservationDecision {
  if (found) return 'FOUND';
  if (!Number.isSafeInteger(finalizedBlockHeight)) fail('SOLANA_RPC_INVALID');
  return finalizedBlockHeight > lastValidBlockHeight ? 'EXPIRED' : 'WAIT';
}
/** An owner may hold one unresolved attempt at a time per runtime, across runs and processes. */
export function solanaSwapAttemptResolved(run: SolanaSwapRun): boolean {
  return !run.attempt || SOLANA_SWAP_TERMINAL_STATES.includes(run.attempt.state) && run.attempt.state !== 'RECONCILIATION_REQUIRED' || run.verdict !== 'PENDING';
}
export function validateSolanaSwapRun(run: SolanaSwapRun): void {
  const runtime = run?.review?.chain ? requireSolanaSwapRuntime(run.review.chain) : fail('SOLANA_SWAP_STORE_CORRUPT');
  const corrupt = `${runtime.codePrefix}_STORE_CORRUPT`;
  if (run.format !== formatOf(run.review) || !new RegExp(`^${runtime.idPrefix}-[a-f0-9]{32}$`).test(run.id) ||
      !['MOCKED', runtime.provenance].includes(run.provenance)) fail(corrupt);
  const { commitment, ...review } = run.review;
  if (solanaSwapHash(review) !== commitment || solanaSwapArtifactHash('execution-plan', run.review.plan) !== run.journal.executionPlanHash ||
      solanaSwapArtifactHash('strategy-manifest', run.review.manifest) !== run.journal.manifestHash || run.journal.journalId !== run.id ||
      run.journal.workflowId !== run.review.workflow.workflowId || run.authorization !== null && run.authorization !== commitment ||
      typeof run.ownerInitiated !== 'boolean' || run.ownerInitiated !== Boolean(run.attempt) ||
      !['PENDING', 'RECONCILED', 'DIVERGENT', 'INCONCLUSIVE', 'NOT_EXECUTED'].includes(run.verdict)) fail(corrupt);
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const attempt = run.attempt;
  if (!attempt) { if (run.verdict !== 'PENDING') fail(corrupt); return; }
  const entry = [...run.journal.entries].reverse().find(e => e.entityId === `${run.id}.swap`);
  const signed = !['PREPARED', 'CANCELLED'].includes(attempt.state);
  if (entry?.toState !== attempt.state || attempt.messageHash !== run.review.messageHash || !Number.isSafeInteger(attempt.preparedAtBlockHeight) ||
      signed !== Boolean(attempt.signature && attempt.transaction) || attempt.signature !== null && !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(attempt.signature) ||
      typeof attempt.reconciled !== 'boolean' || attempt.reconciled !== (attempt.state === 'CONFIRMED') ||
      run.verdict === 'RECONCILED' && !attempt.reconciled) fail(corrupt);
}

// BUILD-014 names for the same shared lifecycle.
export type JupiterAttemptState = SolanaSwapAttemptState;
export type JupiterAttempt = SolanaSwapAttempt;
export type JupiterRun = SolanaSwapRun;
export type JupiterObservationDecision = SolanaSwapObservationDecision;
export const JUPITER_TERMINAL_STATES = SOLANA_SWAP_TERMINAL_STATES;
export const createJupiterRun = createSolanaSwapRun;
export const jupiterTransition = solanaSwapTransition;
export const prepareJupiterAttempt = prepareSolanaSwapAttempt;
export const recordJupiterSignature = recordSolanaSwapSignature;
export const jupiterObservationDecision = solanaSwapObservationDecision;
export const jupiterAttemptResolved = solanaSwapAttemptResolved;
export const validateJupiterRun = validateSolanaSwapRun;

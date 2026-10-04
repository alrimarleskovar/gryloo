// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-TEMPO-001 durable run for one owner-signed TIP-20 memo payment. One run has at most one attempt,
 * so it can make at most one economic submission. Recovery only reads; no send function exists here.
 */
import { createJournal, appendJournalState } from './journal.js';
import { supplyArtifactHash, supplyHash, rpcRecord, rpcUint, rpcHash, supplyHex,
  type TempoReview, type TempoTransaction, type TempoRpc } from '@defi-workflow-engine/reference-compiler';
import { TEMPO_PAYMENT as profile } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

export type TempoAttemptState = 'PREPARED' | 'CANCELLED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'NOT_FOUND' | 'PENDING' |
  'CONFIRMED' | 'REVERTED' | 'RECONCILIATION_REQUIRED';
export type TempoAttempt = { state: TempoAttemptState; nonce: string; preparedAtBlock: number; transaction: TempoTransaction;
  transactionHash: string | null; reconciled: boolean };
export type TempoRun = { format: 'flofi.tempo-payment-run.v1'; id: string; review: TempoReview; provenance: 'PUBLIC_TESTNET' | 'MOCKED';
  authorization: string | null; attempt: TempoAttempt | null; journal: ExecutionJournal; verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT';
  ownerInitiated: boolean };
const SEGMENT = 'tempo-payment-segment', STEP = 'tempo-payment';
const entity = (run: Pick<TempoRun, 'id'>) => `${run.id}.TRANSFER`;
export const TEMPO_RUN_ID = /^tempo-[a-f0-9]{32}$/;

export function createTempoRun(id: string, review: TempoReview, provenance: TempoRun['provenance'], now = new Date()): TempoRun {
  if (!TEMPO_RUN_ID.test(id)) throw new Error('TEMPO_RUN_ID_INVALID');
  let journal = createJournal({ journalId: id, workflowId: review.workflow.workflowId,
    executionPlanHash: supplyArtifactHash('execution-plan', review.plan), manifestHash: supplyArtifactHash('strategy-manifest', review.manifest) });
  const append = (level: 'workflow' | 'segment' | 'step', entityId: string, toState: 'DRAFT' | 'PLANNED' | 'REVIEWED' | 'SIMULATED', stepId: string | null) => {
    journal = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : SEGMENT, stepId, executionAttemptId: null,
      toState, recordedAt: now.toISOString() }).journal;
  };
  append('workflow', review.workflow.workflowId, 'DRAFT', null);
  append('segment', SEGMENT, 'PLANNED', null);
  append('step', STEP, 'PLANNED', STEP);
  append('workflow', review.workflow.workflowId, 'REVIEWED', null);
  append('workflow', review.workflow.workflowId, 'SIMULATED', null);
  return { format: 'flofi.tempo-payment-run.v1', id, review, provenance, authorization: null, attempt: null, journal, verdict: 'PENDING', ownerInitiated: false };
}
/** Appends the attempt transition to the shared journal and mirrors it on the run. */
export function tempoTransition(run: TempoRun, state: TempoAttemptState, now = new Date()): TempoRun {
  if (!run.attempt) throw new Error('TEMPO_ATTEMPT_MISSING');
  if (run.attempt.state === state) return run;
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: entity(run), segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: entity(run), toState: state, recordedAt: now.toISOString() }).journal;
  return { ...run, journal, attempt: { ...run.attempt, state } };
}
/** Pure preparation. The coordinator persists PREPARED before any wallet request is released. */
export function prepareTempoAttempt(run: TempoRun, block: number, nonce: string, now = new Date()): TempoRun {
  if (run.verdict !== 'PENDING' || run.authorization !== run.review.commitment) throw new Error('TEMPO_REVIEW_REQUIRED');
  // One run, one attempt: every existing attempt, including unknown or refused ones, is observation-only.
  if (run.attempt) throw new Error('TEMPO_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if (nonce !== run.review.nonce || !Number.isSafeInteger(block) || block < run.review.state.block) throw new Error('TEMPO_NONCE_CHANGED');
  const attempt: TempoAttempt = { state: 'PREPARED', nonce, preparedAtBlock: block, transaction: run.review.transaction, transactionHash: null, reconciled: false };
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: entity(run), segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: entity(run), toState: 'PREPARED', recordedAt: now.toISOString() }).journal;
  return { ...run, ownerInitiated: true, attempt, journal };
}
/** Candidate match only; the reconciler independently proves inclusion, amounts and balances. */
export function matchTempoTransaction(attempt: Pick<TempoAttempt, 'nonce' | 'transaction'>, value: unknown): boolean {
  const tx = rpcRecord(value), expected = attempt.transaction;
  return typeof tx.from === 'string' && tx.from.toLowerCase() === expected.from && rpcUint(tx.nonce) === BigInt(attempt.nonce) &&
    rpcUint(tx.chainId) === BigInt(profile.chainId) && tx.type === '0x76';
}
/**
 * Read-only discovery of the transaction that consumed the reviewed nonce. The owner's nonce is monotonic,
 * so a binary search on eth_getTransactionCount finds the inclusion block without scanning. No send path.
 */
export async function discoverTempoByNonce(attempt: Pick<TempoAttempt, 'nonce' | 'transaction' | 'preparedAtBlock' | 'transactionHash'>, rpc: TempoRpc):
  Promise<{ hash: string | null; mismatch: boolean; consumed: boolean }> {
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(profile.chainId)) throw new Error('TEMPO_WRONG_CHAIN');
  if (attempt.transactionHash) return { hash: attempt.transactionHash, mismatch: false, consumed: true };
  const owner = attempt.transaction.from, nonce = BigInt(attempt.nonce);
  const count = async (block: number) => rpcUint(await rpc('eth_getTransactionCount', [owner, supplyHex(block)]));
  const latest = Number(rpcUint(await rpc('eth_blockNumber', [])));
  if (!Number.isSafeInteger(latest) || latest < attempt.preparedAtBlock) throw new Error('TEMPO_RPC_INVALID');
  if (await count(latest) <= nonce) return { hash: null, mismatch: false, consumed: false };
  if (await count(attempt.preparedAtBlock) > nonce) throw new Error('TEMPO_NONCE_CONSUMED_BEFORE_PREPARATION');
  let low = attempt.preparedAtBlock, high = latest;
  while (high - low > 1) { const middle = low + Math.floor((high - low) / 2); if (await count(middle) > nonce) high = middle; else low = middle; }
  const block = rpcRecord(await rpc('eth_getBlockByNumber', [supplyHex(high), true]));
  if (!Array.isArray(block.transactions)) throw new Error('TEMPO_RPC_INVALID');
  const found = block.transactions.map(rpcRecord).find(tx => typeof tx.from === 'string' && tx.from.toLowerCase() === owner && rpcUint(tx.nonce) === nonce);
  if (!found) throw new Error('TEMPO_DISCOVERY_INCONSISTENT');
  return { hash: rpcHash(found.hash), mismatch: !matchTempoTransaction(attempt, found), consumed: true };
}
/** Structural validation of a persisted run; any inconsistency fails closed. */
export function validateTempoRun(run: TempoRun): void {
  const { commitment, ...review } = run.review;
  if (run.format !== 'flofi.tempo-payment-run.v1' || !TEMPO_RUN_ID.test(run.id) || !['PUBLIC_TESTNET', 'MOCKED'].includes(run.provenance) ||
      supplyHash(review) !== commitment || supplyArtifactHash('execution-plan', run.review.plan) !== run.journal.executionPlanHash ||
      supplyArtifactHash('strategy-manifest', run.review.manifest) !== run.journal.manifestHash || run.journal.journalId !== run.id ||
      run.authorization !== null && run.authorization !== commitment || run.ownerInitiated !== Boolean(run.attempt) ||
      !['PENDING', 'RECONCILED', 'DIVERGENT'].includes(run.verdict)) throw new Error('TEMPO_STORE_CORRUPT');
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const attempts = run.journal.entries.filter(e => e.level === 'attempt');
  if (new Set(attempts.map(e => e.entityId)).size > 1 || attempts.filter(e => e.toState === 'SUBMITTING').length > 1) throw new Error('TEMPO_STORE_CORRUPT');
  const a = run.attempt;
  if (!a) { if (attempts.length) throw new Error('TEMPO_STORE_CORRUPT'); return; }
  if (attempts.at(-1)?.toState !== a.state || a.nonce !== run.review.nonce || JSON.stringify(a.transaction) !== JSON.stringify(run.review.transaction) ||
      !Number.isSafeInteger(a.preparedAtBlock) || a.preparedAtBlock < run.review.state.block ||
      a.transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(a.transactionHash) || a.reconciled && (a.state !== 'CONFIRMED' || !a.transactionHash) ||
      run.verdict === 'RECONCILED' && !a.reconciled) throw new Error('TEMPO_STORE_CORRUPT');
}

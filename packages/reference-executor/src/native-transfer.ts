// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 durable run for one owner-signed native self-transfer. One run has at most one attempt,
 * so it can make at most one economic submission. Recovery only reads; no send function exists here.
 * The chain is always the reviewed transaction's own chain (Robinhood Testnet or Ethereum Sepolia).
 */
import { createJournal, appendJournalState } from './journal.js';
import { supplyArtifactHash, supplyHash, rpcRecord, rpcUint, rpcHash, supplyHex,
  type NativeTransferReview, type NativeTransferTransaction, type TransferRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

export type TransferAttemptState = 'PREPARED' | 'CANCELLED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'NOT_FOUND' | 'PENDING' |
  'CONFIRMED' | 'REVERTED' | 'RECONCILIATION_REQUIRED';
export type TransferAttempt = { state: TransferAttemptState; nonce: string; preparedAtBlock: number; transaction: NativeTransferTransaction;
  transactionHash: string | null; reconciled: boolean };
export type TransferRun = { format: 'gryloo.native-transfer-run.v1'; id: string; review: NativeTransferReview; provenance: 'PUBLIC_TESTNET' | 'MOCKED';
  authorization: string | null; attempt: TransferAttempt | null; journal: ExecutionJournal; verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT';
  ownerInitiated: boolean };
const SEGMENT = 'native-transfer-segment', STEP = 'native-transfer';
const entity = (run: Pick<TransferRun, 'id'>) => `${run.id}.TRANSFER`;
export const TRANSFER_RUN_ID = /^rhx-[a-f0-9]{32}$/;

export function createTransferRun(id: string, review: NativeTransferReview, provenance: TransferRun['provenance'], now = new Date()): TransferRun {
  if (!TRANSFER_RUN_ID.test(id)) throw new Error('TRANSFER_RUN_ID_INVALID');
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
  return { format: 'gryloo.native-transfer-run.v1', id, review, provenance, authorization: null, attempt: null, journal, verdict: 'PENDING', ownerInitiated: false };
}
/** Appends the attempt transition to the shared journal and mirrors it on the run. */
export function transferTransition(run: TransferRun, state: TransferAttemptState, now = new Date()): TransferRun {
  if (!run.attempt) throw new Error('TRANSFER_ATTEMPT_MISSING');
  if (run.attempt.state === state) return run;
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: entity(run), segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: entity(run), toState: state, recordedAt: now.toISOString() }).journal;
  return { ...run, journal, attempt: { ...run.attempt, state } };
}
/** Pure preparation. The coordinator persists PREPARED before any wallet request is released. */
export function prepareTransferAttempt(run: TransferRun, block: number, nonce: string, now = new Date()): TransferRun {
  if (run.verdict !== 'PENDING' || run.authorization !== run.review.commitment) throw new Error('TRANSFER_REVIEW_REQUIRED');
  // One run, one attempt: every existing attempt, including unknown or refused ones, is observation-only.
  if (run.attempt) throw new Error('TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if (nonce !== run.review.nonce || !Number.isSafeInteger(block) || block < run.review.state.block) throw new Error('TRANSFER_NONCE_CHANGED');
  const attempt: TransferAttempt = { state: 'PREPARED', nonce, preparedAtBlock: block, transaction: run.review.transaction, transactionHash: null, reconciled: false };
  const journal = appendJournalState(run.journal, { level: 'attempt', entityId: entity(run), segmentId: SEGMENT, stepId: STEP,
    executionAttemptId: entity(run), toState: 'PREPARED', recordedAt: now.toISOString() }).journal;
  return { ...run, ownerInitiated: true, attempt, journal };
}
/** Candidate match only; the reconciler independently proves inclusion, amounts and balances. */
export function matchTransferTransaction(attempt: Pick<TransferAttempt, 'nonce' | 'transaction'>, value: unknown): boolean {
  const tx = rpcRecord(value), expected = attempt.transaction;
  return typeof tx.from === 'string' && typeof tx.to === 'string' && tx.from.toLowerCase() === expected.from && tx.to.toLowerCase() === expected.to &&
    rpcUint(tx.value) === BigInt(expected.value) && tx.input === '0x' && rpcUint(tx.nonce) === BigInt(attempt.nonce) &&
    rpcUint(tx.chainId) === BigInt(expected.chainId);
}
/**
 * Read-only discovery of the transaction that consumed the reviewed nonce. The owner's nonce is monotonic,
 * so a binary search on eth_getTransactionCount finds the inclusion block without scanning. No send path.
 */
export async function discoverTransferByNonce(attempt: Pick<TransferAttempt, 'nonce' | 'transaction' | 'preparedAtBlock' | 'transactionHash'>, rpc: TransferRpc):
  Promise<{ hash: string | null; mismatch: boolean; consumed: boolean }> {
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(attempt.transaction.chainId)) throw new Error('TRANSFER_WRONG_CHAIN');
  if (attempt.transactionHash) return { hash: attempt.transactionHash, mismatch: false, consumed: true };
  const owner = attempt.transaction.from, nonce = BigInt(attempt.nonce);
  const count = async (block: number) => rpcUint(await rpc('eth_getTransactionCount', [owner, supplyHex(block)]));
  const latest = Number(rpcUint(await rpc('eth_blockNumber', [])));
  if (!Number.isSafeInteger(latest) || latest < attempt.preparedAtBlock) throw new Error('TRANSFER_RPC_INVALID');
  if (await count(latest) <= nonce) return { hash: null, mismatch: false, consumed: false };
  if (await count(attempt.preparedAtBlock) > nonce) throw new Error('TRANSFER_NONCE_CONSUMED_BEFORE_PREPARATION');
  let low = attempt.preparedAtBlock, high = latest;
  while (high - low > 1) { const middle = low + Math.floor((high - low) / 2); if (await count(middle) > nonce) high = middle; else low = middle; }
  const block = rpcRecord(await rpc('eth_getBlockByNumber', [supplyHex(high), true]));
  if (!Array.isArray(block.transactions)) throw new Error('TRANSFER_RPC_INVALID');
  const found = block.transactions.map(rpcRecord).find(tx => typeof tx.from === 'string' && tx.from.toLowerCase() === owner && rpcUint(tx.nonce) === nonce);
  if (!found) throw new Error('TRANSFER_DISCOVERY_INCONSISTENT');
  return { hash: rpcHash(found.hash), mismatch: !matchTransferTransaction(attempt, found), consumed: true };
}
/** Structural validation of a persisted run; any inconsistency fails closed. */
export function validateTransferRun(run: TransferRun): void {
  const { commitment, ...review } = run.review;
  if (run.format !== 'gryloo.native-transfer-run.v1' || !TRANSFER_RUN_ID.test(run.id) || !['PUBLIC_TESTNET', 'MOCKED'].includes(run.provenance) ||
      supplyHash(review) !== commitment || supplyArtifactHash('execution-plan', run.review.plan) !== run.journal.executionPlanHash ||
      supplyArtifactHash('strategy-manifest', run.review.manifest) !== run.journal.manifestHash || run.journal.journalId !== run.id ||
      run.authorization !== null && run.authorization !== commitment || run.ownerInitiated !== Boolean(run.attempt) ||
      !['PENDING', 'RECONCILED', 'DIVERGENT'].includes(run.verdict)) throw new Error('TRANSFER_STORE_CORRUPT');
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const attempts = run.journal.entries.filter(e => e.level === 'attempt');
  if (new Set(attempts.map(e => e.entityId)).size > 1 || attempts.filter(e => e.toState === 'SUBMITTING').length > 1) throw new Error('TRANSFER_STORE_CORRUPT');
  const a = run.attempt;
  if (!a) { if (attempts.length) throw new Error('TRANSFER_STORE_CORRUPT'); return; }
  if (attempts.at(-1)?.toState !== a.state || a.nonce !== run.review.nonce || JSON.stringify(a.transaction) !== JSON.stringify(run.review.transaction) ||
      !Number.isSafeInteger(a.preparedAtBlock) || a.preparedAtBlock < run.review.state.block ||
      a.transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(a.transactionHash) || a.reconciled && (a.state !== 'CONFIRMED' || !a.transactionHash) ||
      run.verdict === 'RECONCILED' && !a.reconciled) throw new Error('TRANSFER_STORE_CORRUPT');
}

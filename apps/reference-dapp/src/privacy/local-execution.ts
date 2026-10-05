// SPDX-License-Identifier: AGPL-3.0-only
/** LOCAL harness. The isolated product demo may use it; it never replaces the live acceptance gate. */
import { verifyCloakLocalReview, type CloakLocalReview } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { reconcileCloakSwap, type CloakPublicObservation, type CloakReconciliation } from '@defi-workflow-engine/reference-reconciler';
import type { UtxoSwapResult } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME, persistCloakResult, restorePrivateNote } from './cloak-adapter';
import { PrivateStateVault, type PrivateStateIdentity, type VaultReference } from './vault';
import { guardPrivacyWallet } from './wallet-guard';
import type { SolanaSession } from '../wallet/solana-wallet';

const fail = (code: string): never => { throw new Error(code); };
const manifestHash = (review: CloakLocalReview) => hashArtifactBytes('strategy-manifest', new TextEncoder().encode(JSON.stringify(review.manifest)));
export const cloakLocalReviewDigest = (review: CloakLocalReview) => digestRawResponse(new TextEncoder().encode(JSON.stringify(review)));
const reservationKeys = (review: CloakLocalReview) => {
  const r = review.route;
  return Promise.all([['nonce', r.owner, r.genesisHash, r.programId, r.nonce],
    ...r.inputCommitments.map(c => ['note', r.genesisHash, r.programId, c])]
    .map(v => digestRawResponse(new TextEncoder().encode(JSON.stringify(v)))));
};
type Authorization = { environment: 'LOCAL'; owner: string; reviewDigest: string };
const authorizations = new WeakMap<Authorization, Authorization>();
type Preparation = { format: 'flofi.cloak-local-preparation.v1'; review: CloakLocalReview; reviewDigest: string; notes: VaultReference };
type Submission = { result: UtxoSwapResult; chain: CloakPublicObservation; reviewDigest: string };

/** Closed in-process ledger. It has no RPC, relay, signing or network hooks. Its observations are always MOCKED. */
export class CloakLocalLedger {
  private readonly attempts = new Map<string, Submission>();
  private readonly consumedInputs = new Set<string>();
  private readonly consumedNonces = new Set<string>();
  private nextIndex = 10;
  submissions = 0;
  async submit(identity: PrivateStateIdentity, preparation: Preparation, vault: PrivateStateVault): Promise<Submission> {
    if (this.attempts.has(identity.runId)) fail('CLOAK_LOCAL_REPLAY');
    const state = await vault.load(preparation.notes);
    const change = await restorePrivateNote(state.outputNotes[0]!); change.index = this.nextIndex++;
    const r = preparation.review.route;
    const nonce = JSON.stringify([identity.owner, identity.genesisHash, identity.programId, r.nonce]);
    const inputs = r.inputCommitments.map(c => JSON.stringify([identity.genesisHash, identity.programId, c]));
    // The independent mocked chain also denies double spends if a local reservation catalogue was lost.
    if (this.attempts.has(identity.runId) || this.consumedNonces.has(nonce) || inputs.some(key => this.consumedInputs.has(key)))
      fail('CLOAK_LOCAL_LEDGER_DOUBLE_SPEND');
    const result = { outputUtxos: [change], refund: { ...state.refund }, swapStatePda: '11111111111111111111111111111111',
      signature: '1'.repeat(88) } as UtxoSwapResult;
    const chain: CloakPublicObservation = { ...identity, tx1: 'FINALIZED', tx2: 'FINALIZED', settlement: 'SWAPPED',
      recipientAta: r.recipientAta, outputMint: r.outputMint, outputAmount: preparation.review.expectedOutput, inputNullifiersSpent: true,
      privateOutputs: [{ commitment: r.changeCommitment, index: change.index, amount: change.amount.toString(), mint: change.mintAddress, state: 'UNSPENT' }] };
    const submission = { result, chain, reviewDigest: preparation.reviewDigest };
    this.consumedNonces.add(nonce); for (const key of inputs) this.consumedInputs.add(key);
    this.attempts.set(identity.runId, structuredClone(submission)); this.submissions++;
    return structuredClone(submission);
  }
  async inspect(runId: string): Promise<Submission | null> { return structuredClone(this.attempts.get(runId) ?? null); }
}

function assertIdentity(identity: PrivateStateIdentity, review: CloakLocalReview): void {
  if (identity.owner !== review.route.owner || identity.programId !== CLOAK_RUNTIME.programId ||
      identity.genesisHash !== CLOAK_RUNTIME.genesisHash || identity.manifestHash !== manifestHash(review))
    fail('CLOAK_LOCAL_IDENTITY_MISMATCH');
}
async function assertNotes(vault: PrivateStateVault, reference: VaultReference, review: CloakLocalReview): Promise<void> {
  const state = await vault.load(reference);
  if (reference.checkpoint !== 'prepared') fail('CLOAK_PREPARED_STATE_REQUIRED');
  assertIdentity(state, review);
  const inputs = await Promise.all(state.inputNotes.map(restorePrivateNote)), outputs = await Promise.all(state.outputNotes.map(restorePrivateNote));
  const r = review.route;
  if (state.inputNotes.map(n => n.commitment).join() !== r.inputCommitments.join() ||
      inputs.some(n => n.mintAddress !== r.inputMint || n.amount <= 0n || n.index === undefined) ||
      inputs.reduce((sum, n) => sum + n.amount, 0n).toString() !== r.inputTotal || outputs.length !== 1 ||
      outputs[0]!.mintAddress !== r.inputMint || outputs[0]!.amount.toString() !== review.privateChange ||
      state.outputNotes[0]!.commitment !== r.changeCommitment || outputs[0]!.index !== undefined)
    fail('CLOAK_LOCAL_NOTE_BINDING_MISMATCH');
}

/** Bind all artifacts, route, privacy, fees, recipient, expiry and recovery to an explicit LOCAL review acknowledgment. */
export async function authorizeCloakLocal(reviewInput: CloakLocalReview, session: SolanaSession,
  acknowledgedDigest: string, nowMs: number): Promise<Authorization> {
  const review = structuredClone(reviewInput), guard = guardPrivacyWallet(session);
  try {
    guard.assertCurrent(); verifyCloakLocalReview(review, nowMs);
    const reviewDigest = await cloakLocalReviewDigest(review); guard.assertCurrent();
    if (session.account.address !== review.route.owner || acknowledgedDigest !== reviewDigest) fail('CLOAK_LOCAL_AUTHORIZATION_MISMATCH');
    const receipt: Authorization = Object.freeze({ environment: 'LOCAL', owner: review.route.owner, reviewDigest });
    authorizations.set(receipt, { ...receipt }); return receipt;
  } finally { guard.close(); }
}

export async function prepareCloakLocalExecution(vault: PrivateStateVault, notesInput: VaultReference,
  reviewInput: CloakLocalReview, nowMs: number): Promise<void> {
  const notes = structuredClone(notesInput);
  const review = structuredClone(reviewInput); verifyCloakLocalReview(review, nowMs); assertIdentity(notes, review);
  await assertNotes(vault, notes, review);
  const preparation: Preparation = { format: 'flofi.cloak-local-preparation.v1', review, reviewDigest: await cloakLocalReviewDigest(review), notes };
  await vault.saveExecution(notes, 'execution.prepared', preparation);
}

async function loadPreparation(vault: PrivateStateVault, identity: PrivateStateIdentity): Promise<Preparation> {
  const value = await vault.loadExecution(identity, 'execution.prepared');
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 'flofi.cloak-local-preparation.v1') fail('CLOAK_LOCAL_CHECKPOINT_MISSING');
  const preparation = value as Preparation;
  // Recovery may happen after quote expiry; validate original snapshot at its observation time, without authorizing a new submission.
  verifyCloakLocalReview(preparation.review, Date.parse(preparation.review.route.observedAt));
  assertIdentity(identity, preparation.review);
  if (JSON.stringify({ ...identity, checkpoint: preparation.notes.checkpoint, ciphertextHash: preparation.notes.ciphertextHash }) !== JSON.stringify(preparation.notes) ||
      await cloakLocalReviewDigest(preparation.review) !== preparation.reviewDigest) fail('CLOAK_LOCAL_CHECKPOINT_INVALID');
  await assertNotes(vault, preparation.notes, preparation.review);
  return preparation;
}

/** A current explicit review is required; a durable intent makes this run inspection-only forever. */
export async function executeCloakLocal(vault: PrivateStateVault, identityInput: PrivateStateIdentity, reviewInput: CloakLocalReview,
  authorization: Authorization, session: SolanaSession, ledger: CloakLocalLedger, nowMs: number): Promise<CloakLocalOutcome> {
  const identity = structuredClone(identityInput), review = structuredClone(reviewInput), guard = guardPrivacyWallet(session);
  try {
    guard.assertCurrent(); verifyCloakLocalReview(review, nowMs); assertIdentity(identity, review);
    const bound = authorizations.get(authorization), digest = await cloakLocalReviewDigest(review); guard.assertCurrent();
    if (!bound || bound.owner !== session.account.address || bound.owner !== identity.owner || bound.reviewDigest !== digest) fail('CLOAK_LOCAL_AUTHORIZATION_MISMATCH');
    const prepared = await loadPreparation(vault, identity); guard.assertCurrent();
    if (prepared.reviewDigest !== digest) fail('CLOAK_LOCAL_REVIEW_INVALIDATED');
    if (await vault.loadExecution(identity, 'execution.intent') !== null) fail('CLOAK_LOCAL_REPLAY');
    const reservations = await reservationKeys(review);
    guard.assertCurrent();
    await vault.saveExecution(identity, 'execution.intent', { reviewDigest: digest, authorization: bound, notes: prepared.notes }, reservations);
    guard.assertCurrent();
    // Only this closed local ledger is callable here. The live financial gate remains unconditional.
    if (Object.getPrototypeOf(ledger) !== CloakLocalLedger.prototype) fail('CLOAK_LOCAL_LEDGER_REQUIRED');
    await ledger.submit(identity, prepared, vault);
    guard.assertCurrent();
    const outcome = await recoverCloakLocal(vault, identity, ledger); guard.assertCurrent(); return outcome;
  } finally { guard.close(); }
}

export type CloakLocalOutcome = { environment: 'LOCAL'; evidence: 'MOCKED'; state: 'READY_FOR_REVIEW' | 'RECOVERY_REQUIRED' | 'RECONCILED';
  reason: string; reconciliation: CloakReconciliation | null };
const outcome = (state: CloakLocalOutcome['state'], reason: string, reconciliation: CloakReconciliation | null = null): CloakLocalOutcome =>
  ({ environment: 'LOCAL', evidence: 'MOCKED', state, reason, reconciliation });

/** Inspection only: no signing, regeneration, consolidation or resubmission, including an absent ledger attempt. */
export async function recoverCloakLocal(vault: PrivateStateVault, identityInput: PrivateStateIdentity, ledger: CloakLocalLedger): Promise<CloakLocalOutcome> {
  const identity = structuredClone(identityInput);
  const prepared = await loadPreparation(vault, identity);
  const intent = await vault.loadExecution(identity, 'execution.intent');
  if (intent === null) {
    if (await vault.hasExecutionReservation(await reservationKeys(prepared.review)) || await ledger.inspect(identity.runId) !== null ||
        await vault.existingResult(identity) !== null || await vault.loadExecution(identity, 'execution.submitted') !== null ||
        await vault.loadExecution(identity, 'execution.reconciled') !== null) fail('CLOAK_LOCAL_INTENT_MISSING');
    return outcome('READY_FOR_REVIEW', 'CLOAK_LOCAL_NOT_SUBMITTED');
  }
  if (!intent || typeof intent !== 'object' || !('reviewDigest' in intent) || intent.reviewDigest !== prepared.reviewDigest ||
      !('authorization' in intent) || JSON.stringify(intent.authorization) !== JSON.stringify({ environment: 'LOCAL', owner: identity.owner, reviewDigest: prepared.reviewDigest }) ||
      !('notes' in intent) || JSON.stringify(intent.notes) !== JSON.stringify(prepared.notes)) fail('CLOAK_LOCAL_INTENT_INVALID');
  const submission = await ledger.inspect(identity.runId);
  if (!submission) return outcome('RECOVERY_REQUIRED', 'CLOAK_LOCAL_SUBMISSION_UNCERTAIN');
  if (submission.reviewDigest !== prepared.reviewDigest) fail('CLOAK_LOCAL_SUBMISSION_BINDING_MISMATCH');
  // Quarantine the exact SDK hand-off, including malformed/divergent recovery authority, before decoding it.
  const rawResult: unknown = JSON.parse(JSON.stringify(submission.result, (_, value) => typeof value === 'bigint'
    ? { encoding: 'bigint-decimal', value: value.toString() } : value));
  const handoff = { reviewDigest: prepared.reviewDigest, encoding: 'tagged-json-v1', rawResult, chain: submission.chain };
  const priorHandoff = await vault.loadExecution(identity, 'execution.handoff');
  if (priorHandoff === null) await vault.saveExecution(identity, 'execution.handoff', handoff);
  else if (!priorHandoff || typeof priorHandoff !== 'object' || !('rawResult' in priorHandoff) || !('reviewDigest' in priorHandoff) ||
      priorHandoff.reviewDigest !== prepared.reviewDigest || JSON.stringify(priorHandoff.rawResult) !== JSON.stringify(rawResult))
    fail('CLOAK_LOCAL_HANDOFF_CHANGED');
  // Persist returned state BEFORE comparing it; valid divergent notes/refund authority stay recoverable.
  let reference: VaultReference;
  const prior = await vault.loadExecution(identity, 'execution.submitted');
  if (prior === null) {
    // A crash can leave a result checkpoint without the submission evidence record.
    try { reference = await persistCloakResult(vault, prepared.notes, submission.result); }
    catch (error) {
      const state = await vault.loadExecution(identity, 'execution.submitted');
      if (state) throw error;
      // Locate the existing immutable result by its ciphertext digest, without recreating notes.
      const existing = await vault.existingResult(identity);
      if (!existing) throw error;
      reference = existing;
    }
    await vault.saveExecution(identity, 'execution.submitted', { reviewDigest: prepared.reviewDigest, reference, chain: submission.chain });
  } else {
    if (!prior || typeof prior !== 'object' || !('reference' in prior) || !('reviewDigest' in prior) || prior.reviewDigest !== prepared.reviewDigest) throw new Error('CLOAK_LOCAL_SUBMITTED_INVALID');
    reference = prior.reference as VaultReference;
  }
  const state = await vault.load(reference);
  if (state.checkpoint !== 'result' || JSON.stringify({ ...identity, checkpoint: reference.checkpoint, ciphertextHash: reference.ciphertextHash }) !== JSON.stringify(reference))
    fail('CLOAK_LOCAL_RESULT_LINK_MISMATCH');
  const notes = await Promise.all(state.outputNotes.map(async n => ({ ...n, note: await restorePrivateNote(n) })));
  const outputs = notes.flatMap(n => n.index === null ? [] : [{ commitment: n.commitment, index: n.index, amount: n.note.amount.toString(), mint: n.note.mintAddress }]);
  const r = prepared.review.route;
  const refundRetained = JSON.stringify(state.refund) === JSON.stringify((await vault.load(prepared.notes)).refund);
  const verdict = reconcileCloakSwap({ ...identity, recipientAta: r.recipientAta, outputMint: r.outputMint, minimumOutput: prepared.review.minimumOutput,
    change: { commitment: r.changeCommitment, amount: prepared.review.privateChange, mint: r.inputMint } }, submission.chain,
    { ...identity, reloadVerified: outputs.length === state.outputNotes.length, refundRetained, outputs });
  if (verdict.verdict !== 'RECONCILED') return outcome('RECOVERY_REQUIRED', verdict.reason, verdict);
  const evidence = { reviewDigest: prepared.reviewDigest, reference, chain: submission.chain, verdict, evidence: 'MOCKED' };
  const priorEvidence = await vault.loadExecution(identity, 'execution.reconciled');
  if (priorEvidence === null) await vault.saveExecution(identity, 'execution.reconciled', evidence);
  else if (JSON.stringify(priorEvidence) !== JSON.stringify(evidence)) fail('CLOAK_LOCAL_RECONCILIATION_CHANGED');
  return outcome('RECONCILED', verdict.reason, verdict);
}

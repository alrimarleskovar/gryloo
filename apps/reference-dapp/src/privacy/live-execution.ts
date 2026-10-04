// SPDX-License-Identifier: AGPL-3.0-only
/** Genuine protocol submission/recovery plumbing. The existing financial release gate remains mandatory. */
import { addressBytes, canonicalJson, computeUtxoCommitment, computeUtxoNullifier, createCloakRpc, registerViewingKey, toAddress, type RelayAuthPreimage } from '@cloak.dev/sdk';
import type { SemanticWorkflow, JournalEntry, JournalLevel } from '@defi-workflow-engine/workflow-contracts';
import { digestArtifact, digestPayload, digestCloakFinancialArtifact, digestRawResponse } from '@defi-workflow-engine/reference-linter';
import { reconcileCloakSwap } from '@defi-workflow-engine/reference-reconciler';
import { assertCloakFinancialExecutionAvailable, CLOAK_RUNTIME, encodePrivateNote, restorePrivateNote } from './cloak-adapter';
import { assertCloakAuth, bytesBase64, cloakRequestDigest, decodeExactBase64, fieldHex, type CloakSwapRequest } from './provider-contract';
import { assertVerifiedCloakProof, CLOAK_READ_RPC, readCloakFee, type CloakPreparedProof } from './live-proof';
import { assertCloakLiveReview, reconstructCloakLiveReview, type CloakLiveReview } from './live-review';
import { inspectCloakMainnet } from './live-observer';
import { appendCloakJournal, cloakJournalIdentity, loadCloakJournal, saveCloakJournal } from './live-journal';
import { guardPrivacyWallet } from './wallet-guard';
import { PrivateStateVault, type PrivateState, type PrivateStateIdentity, type VaultReference } from './vault';
import type { SolanaSession } from '../wallet/solana-wallet';

const fail = (code: string): never => { throw new Error(code); };
const requireRelease: () => void = assertCloakFinancialExecutionAvailable;
type Preparation = { format: 'flofi.cloak-live-preparation.v1'; workflow: SemanticWorkflow; review: CloakLiveReview;
  reference: VaultReference; body: CloakSwapRequest; proofMetadata: Pick<CloakPreparedProof, 'circuitDigests' | 'sourceSlot'>;
  auth: Omit<RelayAuthPreimage, 'message'> & { message: string } };
const authRestore = (auth: Preparation['auth']): RelayAuthPreimage => ({ ...auth, message: Uint8Array.from(atob(auth.message), c => c.charCodeAt(0)) });
export async function cloakLiveReservations(review: CloakLiveReview, commitments: string[]): Promise<string[]> {
  const p = review.properties;
  return Promise.all([['nonce', p.owner, p.genesisHash, p.programId, review.manifest.nonce],
    ...commitments.map(c => ['note', p.genesisHash, p.programId, c])].map(key => digestRawResponse(new TextEncoder().encode(JSON.stringify(key)))));
}
async function verifyOwnerSignature(owner: string, message: Uint8Array, signature: Uint8Array): Promise<void> {
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(addressBytes(toAddress(owner))), { name: 'Ed25519' }, false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, Uint8Array.from(signature), Uint8Array.from(message))) fail('CLOAK_OWNER_SIGNATURE_INVALID');
}
async function ownerMessageSignature(session: SolanaSession, message: Uint8Array): Promise<Uint8Array> {
  const feature = session.wallet.features['solana:signMessage'] as { signMessage(...inputs: { account: SolanaSession['account']; message: Uint8Array }[]): Promise<{
    signature: Uint8Array; signedMessage: Uint8Array; account?: { address: string } }[]> };
  const [result] = await feature.signMessage({ account: session.account, message: message.slice() });
  if (!result || result.account && result.account.address !== session.account.address || !ArrayBuffer.isView(result.signature) || result.signature.byteLength !== 64 ||
      !ArrayBuffer.isView(result.signedMessage) || bytesBase64(new Uint8Array(result.signedMessage)) !== bytesBase64(message)) fail('CLOAK_OWNER_SIGNATURE_INVALID');
  const signature = Uint8Array.from(result!.signature);
  await verifyOwnerSignature(session.account.address, message, signature);
  return signature;
}
/** Explicit, separate owner action. Sends a viewing key only to the pinned provider, never private spend keys. */
export async function cloakViewingKeyReceipt(state: PrivateState) {
  const nk = Uint8Array.from(state.viewingKeyNk.match(/../g)!, h => parseInt(h, 16));
  return { format: 'flofi.cloak-viewing-registration.v1', provider: 'cloak', relayUrl: CLOAK_RUNTIME.relayUrl,
    owner: state.owner, genesisHash: state.genesisHash, programId: state.programId, keyDigest: await digestRawResponse(nk) };
}
export async function registerCloakRecoveryViewingKey(vault: PrivateStateVault, reference: VaultReference, session: SolanaSession): Promise<void> {
  requireRelease(); const guard = guardPrivacyWallet(session);
  try {
    const state = await vault.load(reference); guard.assertCurrent();
    if (state.owner !== session.account.address) fail('CLOAK_OWNER_CHANGED');
    const receipt = await cloakViewingKeyReceipt(state), previous = await vault.loadExecution(reference, 'execution.viewing');
    if (previous !== null) { if (canonicalJson(previous) !== canonicalJson(receipt)) fail('CLOAK_VIEWING_REGISTRATION_CHANGED'); return; }
    const nk = Uint8Array.from(state.viewingKeyNk.match(/../g)!, h => parseInt(h, 16));
    await registerViewingKey(CLOAK_RUNTIME.relayUrl, toAddress(state.owner), nk, async message => {
      guard.assertCurrent(); const signature = await ownerMessageSignature(session, message); guard.assertCurrent(); return signature;
    });
    guard.assertCurrent();
    await vault.saveExecution(reference, 'execution.viewing', receipt); guard.assertCurrent();
  } finally { guard.close(); }
}
export async function checkpointCloakLiveReview(vault: PrivateStateVault, reference: VaultReference, review: CloakLiveReview,
  prepared: CloakPreparedProof, auth: RelayAuthPreimage, workflow: SemanticWorkflow): Promise<void> {
  await assertCloakLiveReview(review, prepared, auth, workflow, review.reviewDigest);
  const state = await vault.load(reference);
  if (state.checkpoint !== 'prepared' || state.owner !== review.properties.owner || reference.manifestHash !== review.manifestHash ||
      state.outputNotes[0]!.commitment !== review.properties.privateChange.commitment) fail('CLOAK_LIVE_NOTE_CHECKPOINT_CHANGED');
  const record: Preparation = { format: 'flofi.cloak-live-preparation.v1', workflow: structuredClone(workflow), review: structuredClone(review),
    reference: structuredClone(reference), body: structuredClone(prepared.body), proofMetadata: { circuitDigests: { ...prepared.circuitDigests }, sourceSlot: prepared.sourceSlot },
    auth: { ...auth, message: bytesBase64(auth.message) } };
  await vault.saveExecution(reference, 'execution.prepared', record);
  let journal = cloakJournalIdentity(reference, workflow.workflowId, await digestCloakFinancialArtifact('execution-plan', review.plan));
  await saveCloakJournal(vault, reference, journal);
  for (const [level, next] of [['workflow', 'DRAFT'], ['segment', 'PLANNED'], ['step', 'PLANNED'], ['attempt', 'PREPARED'],
    ['workflow', 'REVIEWED'], ['workflow', 'SIMULATED']] as const) {
    journal = await appendCloakJournal(journal, level, next, new Date().toISOString()); await saveCloakJournal(vault, reference, journal);
  }
}
async function readPreparation(vault: PrivateStateVault, identity: PrivateStateIdentity): Promise<Preparation> {
  const record = await vault.loadExecution(identity, 'execution.prepared') as Preparation | null;
  if (!record || record.format !== 'flofi.cloak-live-preparation.v1' || record.reference.manifestHash !== identity.manifestHash ||
      record.reference.runId !== identity.runId || record.review.manifestHash !== identity.manifestHash ||
      record.review.properties.owner !== identity.owner || record.review.properties.programId !== identity.programId ||
      record.review.properties.genesisHash !== identity.genesisHash || record.reference.checkpoint !== 'prepared' ||
      await digestCloakFinancialArtifact('strategy-manifest', record.review.manifest) !== identity.manifestHash) fail('CLOAK_LIVE_CHECKPOINT_INVALID');
  const valid = record!, r = valid.review, p = r.properties;
  const step = r.plan.segments[0]?.steps[0];
  if (valid.reference.owner !== identity.owner || valid.reference.programId !== identity.programId || valid.reference.genesisHash !== identity.genesisHash ||
      r.environment !== 'LIVE' || valid.workflow.revision !== r.manifest.semanticWorkflowRevision ||
      await digestArtifact('semantic-workflow', valid.workflow) !== r.manifest.semanticWorkflowHash ||
      await digestArtifact('quote-state-artifact', r.quote) !== r.artifactSet.artifacts[0]?.artifactHash ||
      await digestArtifact('artifact-set', r.artifactSet) !== r.manifest.artifactSetHash ||
      await digestArtifact('simulation-bundle', r.simulation) !== r.manifest.simulationHash ||
      await digestCloakFinancialArtifact('authorization-policy', r.policy) !== r.manifest.policyHash ||
      r.plan.manifestHash !== identity.manifestHash || step?.executionKind !== 'DIRECT_TRANSACTION' || step.payloadHash !== await digestPayload(authRestore(valid.auth).message) ||
      r.requestDigest !== await cloakRequestDigest(valid.body, p.owner)) fail('CLOAK_LIVE_CHECKPOINT_INVALID');
  const { reviewDigest, ...reviewValue } = r;
  if (reviewDigest !== await digestRawResponse(new TextEncoder().encode(canonicalJson(reviewValue)))) fail('CLOAK_LIVE_CHECKPOINT_INVALID');
  const expectedReview = await reconstructCloakLiveReview(valid.workflow, { ...valid.proofMetadata, properties: p, body: valid.body }, authRestore(valid.auth), p.reviewedAt);
  if (canonicalJson(expectedReview) !== canonicalJson(r)) fail('CLOAK_LIVE_CHECKPOINT_INVALID');
  await assertCloakAuth(p, valid.body, authRestore(valid.auth), p.reviewedAt);
  const state = await vault.load(valid.reference), inputs = await Promise.all(state.inputNotes.map(restorePrivateNote)), change = await restorePrivateNote(state.outputNotes[0]!);
  if (state.checkpoint !== 'prepared' || state.owner !== p.owner || state.outputNotes.length !== 1 ||
      change.amount.toString() !== p.privateChange.amount || change.mintAddress !== p.inputMint || state.outputNotes[0]!.commitment !== p.privateChange.commitment ||
      inputs.some(n => n.mintAddress !== p.inputMint || n.index === undefined || n.amount <= 0n) ||
      inputs.reduce((sum, n) => sum + n.amount, 0n) !== BigInt(p.grossInputLamports) + change.amount ||
      JSON.stringify(await Promise.all(inputs.map(async n => fieldHex(await computeUtxoNullifier(n))))) !== JSON.stringify(p.inputNullifiers) ||
      state.refund.publicKey.replace(/^0x/, '') !== p.refundPublicKey || state.refund.blinding.replace(/^0x/, '') !== p.refundBlinding || !state.refund.derivedFromNk)
    fail('CLOAK_LIVE_NOTE_CHECKPOINT_CHANGED');
  return valid;
}
/** One owner approval, one immutable request, one POST. A durable intent permanently makes restart inspection-only. */
export async function executeCloakLive(vault: PrivateStateVault, reference: VaultReference, review: CloakLiveReview, prepared: CloakPreparedProof,
  auth: RelayAuthPreimage, workflow: SemanticWorkflow, acknowledgedDigest: string, session: SolanaSession,
  currentWorkflow: () => SemanticWorkflow = () => workflow): Promise<CloakLiveOutcome> {
  requireRelease(); const guard = guardPrivacyWallet(session);
  try {
    guard.assertCurrent(); assertVerifiedCloakProof(prepared);
    await assertCloakLiveReview(review, prepared, auth, currentWorkflow(), acknowledgedDigest); guard.assertCurrent();
    const record = await readPreparation(vault, reference), state = await vault.load(reference); guard.assertCurrent();
    if (canonicalJson(await vault.loadExecution(reference, 'execution.viewing')) !== canonicalJson(await cloakViewingKeyReceipt(state)))
      fail('CLOAK_OWNER_VIEWING_REGISTRATION_REQUIRED');
    if (session.account.address !== reference.owner || canonicalJson(record.body) !== canonicalJson(prepared.body) ||
        record.review.reviewDigest !== review.reviewDigest || bytesBase64(auth.message) !== record.auth.message ||
        await vault.loadExecution(reference, 'execution.restore') !== null || await vault.loadExecution(reference, 'execution.intent') !== null)
      fail('CLOAK_LIVE_REPLAY_OR_REVIEW_CHANGED');
    const fee = await readCloakFee(createCloakRpc(CLOAK_READ_RPC), BigInt(review.properties.grossInputLamports)); guard.assertCurrent();
    if (BigInt(fee.fee) > BigInt(review.properties.maximumProtocolFeeLamports)) fail('CLOAK_REVIEWED_FEE_CHANGED');
    await assertCloakLiveReview(review, prepared, auth, currentWorkflow(), acknowledgedDigest); guard.assertCurrent();
    await vault.saveExecution(reference, 'execution.intent', { format: 'flofi.cloak-live-intent.v1', reviewDigest: review.reviewDigest,
      reference, auth: record.auth, requestDigest: review.requestDigest }, await cloakLiveReservations(review, state.inputNotes.map(n => n.commitment)));
    guard.assertCurrent();
    let journal = await loadCloakJournal(vault, reference); if (!journal) return fail('CLOAK_JOURNAL_CHECKPOINT_MISSING');
    // An explicit UI click and exact digest are the only entry to the owner's wallet. Never sign with an agent-held key.
    const signature = await ownerMessageSignature(session, auth.message); guard.assertCurrent();
    await assertCloakLiveReview(review, prepared, auth, currentWorkflow(), acknowledgedDigest); guard.assertCurrent();
    const body = { ...structuredClone(prepared.body), sender: auth.sender, auth_issued_at: auth.auth_issued_at,
      auth_nonce: auth.auth_nonce, auth_signature: bytesBase64(signature) };
    await vault.saveExecution(reference, 'execution.signed', { reviewDigest: review.reviewDigest, body }); guard.assertCurrent();
    for (const [level, next] of [['workflow', 'AUTHORIZED'], ['workflow', 'EXECUTING'], ['segment', 'READY'], ['segment', 'EXECUTING'],
      ['step', 'READY'], ['step', 'EXECUTING'], ['attempt', 'SUBMITTING']] as const) {
      journal = await appendCloakJournal(journal, level, next, new Date().toISOString()); await saveCloakJournal(vault, reference, journal); guard.assertCurrent();
    }
    await assertCloakLiveReview(review, prepared, auth, currentWorkflow(), acknowledgedDigest); guard.assertCurrent();
    let handoff: unknown;
    try {
      const response = await fetch(CLOAK_RUNTIME.relayUrl + '/transact_swap', { method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
      const text = await response.text(); if (text.length > 1_048_576) fail('CLOAK_RELAY_RESPONSE_TOO_LARGE');
      handoff = { format: 'flofi.cloak-live-response.v1', status: response.status, text, requestDigest: review.requestDigest };
    } catch { handoff = { format: 'flofi.cloak-live-response.v1', status: null, text: null, requestDigest: review.requestDigest, uncertainty: 'SUBMISSION_OUTCOME_UNKNOWN' }; }
    // Preserve the exact response before parsing or asking whether the owner changed. It may contain recovery coordinates.
    await vault.saveExecution(reference, 'execution.handoff', handoff);
    guard.assertCurrent();
    journal = await appendCloakJournal(journal, 'attempt', 'SUBMISSION_RESULT_UNKNOWN', new Date().toISOString()); await saveCloakJournal(vault, reference, journal);
    const outcome = await recoverCloakLive(vault, reference); guard.assertCurrent(); return outcome;
  } finally { guard.close(); }
}
export type CloakLiveOutcome = { state: 'REVIEW_REQUIRED' | 'RECOVERY_REQUIRED' | 'RECONCILED' | 'REFUND_RECOVERED'; reason: string;
  sourceSignature?: string; settlementSignature?: string; resultReference?: VaultReference };
/** Inspection only, even when there is no response/request ID, the review expired, or a checkpoint write was lost. */
export async function recoverCloakLive(vault: PrivateStateVault, identity: PrivateStateIdentity): Promise<CloakLiveOutcome> {
  const record = await readPreparation(vault, identity), state = await vault.load(record.reference);
  const intent = await vault.loadExecution(identity, 'execution.intent') as { format?: string; reviewDigest?: string; requestDigest?: string } | null;
  const restored = await vault.loadExecution(identity, 'execution.restore') !== null;
  const observed = await inspectCloakMainnet(state, record.review.properties, record.body);
  if (intent === null && !restored) {
    if (observed.state !== 'UNKNOWN' || await vault.hasExecutionReservation(await cloakLiveReservations(record.review, state.inputNotes.map(n => n.commitment))) ||
        await vault.loadExecution(identity, 'execution.signed') !== null || await vault.existingResult(identity) !== null)
      fail('CLOAK_LIVE_INTENT_MISSING');
    return { state: 'REVIEW_REQUIRED', reason: 'CLOAK_LIVE_NOT_SUBMITTED' };
  }
  if (intent && (intent.format !== 'flofi.cloak-live-intent.v1' || intent.reviewDigest !== record.review.reviewDigest || intent.requestDigest !== record.review.requestDigest))
    fail('CLOAK_LIVE_INTENT_INVALID');
  const signed = await vault.loadExecution(identity, 'execution.signed') as { reviewDigest?: string; body?: Record<string, unknown> } | null;
  // Chain matching alone cannot prove that this owner authorized this Manifest. The signed checkpoint is mandatory.
  if (!signed || signed.reviewDigest !== record.review.reviewDigest || !signed.body || !intent)
    return { state: 'RECOVERY_REQUIRED', reason: 'CLOAK_LIVE_AUTHORIZATION_CHECKPOINT_MISSING' };
  const expectedSignedBody = { ...record.body, sender: record.auth.sender, auth_issued_at: record.auth.auth_issued_at,
    auth_nonce: record.auth.auth_nonce, auth_signature: signed.body.auth_signature };
  if (canonicalJson(signed.body) !== canonicalJson(expectedSignedBody)) fail('CLOAK_LIVE_SIGNED_REQUEST_CHANGED');
  await verifyOwnerSignature(identity.owner, authRestore(record.auth).message, decodeExactBase64(signed.body.auth_signature, 64));
  const recoveredJournal = await loadCloakJournal(vault, identity);
  if (!recoveredJournal || !recoveredJournal.entries.some(e => e.level === 'workflow' && e.toState === 'AUTHORIZED') ||
      !recoveredJournal.entries.some(e => e.level === 'attempt' && e.toState === 'SUBMITTING'))
    return { state: 'RECOVERY_REQUIRED', reason: 'CLOAK_LIVE_AUTHORIZED_JOURNAL_MISSING' };
  if (observed.state !== 'SWAPPED' && observed.state !== 'REFUNDED' || !observed.change || !observed.sourceSignature || !observed.settlementSignature)
    return { state: 'RECOVERY_REQUIRED', reason: restored ? 'CLOAK_RESTORED_ATTEMPT_INSPECTION_ONLY' : 'CLOAK_LIVE_SUBMISSION_OR_SETTLEMENT_UNCERTAIN' };
  let resultReference = await vault.existingResult(identity);
  if (!resultReference) resultReference = await vault.save({ ...state, checkpoint: 'result', signature: observed.sourceSignature, swapStatePda: observed.swapState,
    outputNotes: await Promise.all([observed.change, ...observed.refundNote ? [observed.refundNote] : []].map(encodePrivateNote)) });
  const result = await vault.load(resultReference), notes = await Promise.all(result.outputNotes.map(restorePrivateNote));
  const outputs = notes.map(n => ({ commitment: n.commitment!.toString(16).padStart(64, '0'), index: n.index!, amount: n.amount.toString(), mint: n.mintAddress }));
  const p = record.review.properties;
  if (result.signature !== observed.sourceSignature || result.swapStatePda !== observed.swapState || JSON.stringify(result.refund) !== JSON.stringify(state.refund) ||
      outputs.some(n => n.index === undefined) || outputs.length !== (observed.state === 'REFUNDED' ? 2 : 1)) fail('CLOAK_LIVE_RESULT_DIVERGENT');
  let next: CloakLiveOutcome;
  if (observed.state === 'SWAPPED') {
    const verdict = reconcileCloakSwap({ ...identity, recipientAta: p.recipientAta, outputMint: p.outputMint, minimumOutput: p.minimumOutput, change: p.privateChange },
      observed.publicObservation, { ...identity, reloadVerified: true, refundRetained: true, outputs });
    if (verdict.verdict !== 'RECONCILED') return { state: 'RECOVERY_REQUIRED', reason: verdict.reason, resultReference };
    next = { state: 'RECONCILED', reason: verdict.reason, resultReference, sourceSignature: observed.sourceSignature, settlementSignature: observed.settlementSignature };
  } else {
    const refund = observed.refundNote;
    if (!refund || outputs[0]!.commitment !== p.privateChange.commitment || outputs[0]!.amount !== p.privateChange.amount || outputs[0]!.index !== observed.change.index ||
        outputs[1]!.commitment !== fieldHex(await computeUtxoCommitment(refund)) || outputs[1]!.amount !== refund.amount.toString() || outputs[1]!.index !== refund.index ||
        outputs.some(n => n.mint !== p.inputMint)) fail('CLOAK_PRIVATE_REFUND_RESULT_DIVERGENT');
    next = { state: 'REFUND_RECOVERED', reason: 'CLOAK_TIMEOUT_REFUND_AND_PRIVATE_CHANGE_RELOADED', resultReference,
      sourceSignature: observed.sourceSignature, settlementSignature: observed.settlementSignature };
  }
  const evidence = { reviewDigest: record.review.reviewDigest, resultReference, outcome: next, routing: p.routing,
    observation: { ...observed, change: null, refundNote: null } };
  const prior = await vault.loadExecution(identity, 'execution.submitted');
  if (prior === null) await vault.saveExecution(identity, 'execution.submitted', evidence);
  else if (canonicalJson((prior as { outcome: unknown }).outcome) !== canonicalJson(next)) fail('CLOAK_LIVE_SUBMISSION_EVIDENCE_DIVERGENT');
  let journal = await loadCloakJournal(vault, identity); if (!journal) return fail('CLOAK_JOURNAL_CHECKPOINT_MISSING');
  const transition = async (level: JournalLevel, nextState: JournalEntry['toState']) => {
    if ([...journal!.entries].reverse().find(e => e.level === level)?.toState === nextState) return;
    journal = await appendCloakJournal(journal!, level, nextState, new Date().toISOString()); await saveCloakJournal(vault, identity, journal);
  };
  const attempt = [...journal.entries].reverse().find(e => e.level === 'attempt')?.toState;
  if (attempt === 'SUBMITTING') await transition('attempt', 'SUBMISSION_RESULT_UNKNOWN');
  if (['SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(String([...journal.entries].reverse().find(e => e.level === 'attempt')?.toState))) {
    await transition('attempt', 'CONFIRMED');
  }
  if ([...journal.entries].reverse().find(e => e.level === 'attempt')?.toState === 'CONFIRMED') await transition('attempt', 'RECONCILIATION_REQUIRED');
  if ([...journal.entries].reverse().find(e => e.level === 'workflow')?.toState === 'EXECUTING') {
    await transition('workflow', 'RECONCILING');
  }
  if ([...journal.entries].reverse().find(e => e.level === 'workflow')?.toState === 'RECONCILING') {
    if ([...journal.entries].reverse().find(e => e.level === 'segment')?.toState === 'EXECUTING') await transition('segment', 'RECONCILING');
    if ([...journal.entries].reverse().find(e => e.level === 'step')?.toState === 'EXECUTING') await transition('step', 'RECONCILING');
    await transition('step', next.state === 'RECONCILED' ? 'COMPLETED' : 'PARTIALLY_COMPLETED');
    await transition('segment', next.state === 'RECONCILED' ? 'COMPLETED' : 'PARTIALLY_COMPLETED');
    await transition('workflow', next.state === 'RECONCILED' ? 'COMPLETED' : 'PARTIALLY_COMPLETED');
  }
  if (await vault.loadExecution(identity, 'execution.reconciled') === null) await vault.saveExecution(identity, 'execution.reconciled', evidence);
  return next;
}

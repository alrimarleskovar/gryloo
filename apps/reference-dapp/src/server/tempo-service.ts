// SPDX-License-Identifier: AGPL-3.0-only
/** One adapter coordinator on Flofi storage ports, shared journal, fenced leases and cloud worker. */
import { randomBytes } from 'node:crypto';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateTempoPayment, readTempoState, assertTempoReview, preflightTempoTransaction, rpcRecord, rpcUint, rpcHash, supplyHex } from '@defi-workflow-engine/reference-compiler';
import { createTempoRun, prepareTempoAttempt, tempoTransition, validateTempoRun, discoverTempoByNonce, utf8,
  type TempoRun, type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { reconcileTempoPayment, buildTempoEvidence, type TempoEvidence, type TempoObservation } from '@defi-workflow-engine/reference-reconciler';
import type { TempoRpc } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type TempoRecord = TempoRun & { evidence: TempoEvidence | null; observations: TempoObservation[]; error: string | null; recoveryOf?: string; expiredUnusedNonce?: { finalizedBlock: number; finalizedHash: string; timestamp: string } };
const ID = /^tempo-[0-9a-f]{32}$/;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validateTempoLog(bytes: Uint8Array) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\n') || bytes.length > 16_777_216) throw new Error('TEMPO_STORE_CORRUPT');
  let previous: TempoRecord | null = null;
  for (const line of text.trimEnd().split('\n')) {
    const r = JSON.parse(line) as TempoRecord; validateTempoRun(r);
    if (r.evidence && r.verdict !== 'RECONCILED' || r.verdict === 'RECONCILED' && !r.evidence || r.expiredUnusedNonce && (r.attempt?.state !== 'CANCELLED' || r.authorization !== null)) throw new Error('TEMPO_STORE_CORRUPT');
    if (previous && (r.id !== previous.id || r.recoveryOf !== previous.recoveryOf || previous.expiredUnusedNonce && !same(r.expiredUnusedNonce, previous.expiredUnusedNonce) || !same(r.review, previous.review) || r.provenance !== previous.provenance ||
      previous.verdict !== 'PENDING' && r.verdict !== previous.verdict || previous.attempt && !r.attempt ||
      previous.attempt?.transactionHash && previous.attempt.transactionHash !== r.attempt?.transactionHash ||
      previous.attempt && r.attempt && (previous.attempt.nonce !== r.attempt.nonce || previous.attempt.preparedAtBlock !== r.attempt.preparedAtBlock ||
        previous.attempt.reconciled && !r.attempt.reconciled) ||
      !same(r.journal.entries.slice(0, previous.journal.entries.length), previous.journal.entries) ||
      !same(r.observations.slice(0, previous.observations.length), previous.observations) || previous.evidence && !same(r.evidence, previous.evidence))) throw new Error('TEMPO_STORE_CORRUPT');
    previous = r;
  }
}
export function createTempoService(input: { storage: ExecutionStorage; rpc: TempoRpc; provenance: 'MOCKED' | 'PUBLIC_TESTNET'; now?: () => number }) {
  const { log, leases } = input.storage, now = input.now ?? Date.now;
  const path = (id: string) => { if (!ID.test(id)) throw new Error('TEMPO_ID_INVALID'); return id + '.jsonl'; };
  const load = async (id: string): Promise<TempoRecord> => {
    const bytes = await log.read(path(id)); if (!bytes) throw new Error('TEMPO_RUN_NOT_FOUND'); validateTempoLog(bytes);
    const r = JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!) as TempoRecord;
    if (r.provenance !== input.provenance) throw new Error('TEMPO_PROVENANCE_MISMATCH'); return r;
  };
  const save = async (r: TempoRecord) => {
    const prior = utf8(await log.read(path(r.id)));
    await log.extend(path(r.id), new TextEncoder().encode(prior + JSON.stringify(r) + '\n'), validateTempoLog); return r;
  };
  const locked = <T,>(id: string, fn: () => Promise<T>) => { path(id); return leases.hold(id, fn); };
  async function fresh(r: TempoRecord, workflow: SemanticWorkflow, account: string) {
    try {
      const state = await readTempoState(input.rpc, account, r.review.fields.recipient, now());
      assertTempoReview(r.review, workflow, account, state, now());
      await preflightTempoTransaction(input.rpc, r.review.transaction, r.review.fields, state);
      if (now() >= Date.parse(r.review.expiresAt)) throw new Error('TEMPO_REVIEW_STALE');
      return state;
    } catch (e) { await save({ ...r, authorization: null, error: 'TEMPO_FRESH_SIMULATION_REQUIRED' }); throw e; }
  }
  async function simulate(workflowInput: unknown, account: string, recoveryOf?: string) {
    const workflow = validateAuthoringWorkflow(workflowInput, createBaseSepoliaReviewContext());
    const review = await simulateTempoPayment(workflow, account, input.rpc, now());
    const r: TempoRecord = { ...createTempoRun('tempo-' + randomBytes(16).toString('hex'), review, input.provenance, new Date(now())),
      evidence: null, observations: [], error: null, ...recoveryOf ? { recoveryOf } : {} };
    return save(r);
  }
  async function reserveNonce(r: TempoRecord) {
    const key = `42431-${r.review.account}-${r.review.nonce}.intent`;
    await leases.hold(key, async () => {
      const prior = await log.read(key), line = JSON.stringify({ id: r.id, commitment: r.review.commitment }) + '\n';
      if (!prior) {
        if (!await log.create(key, new TextEncoder().encode(line))) throw new Error('TEMPO_NONCE_RESERVED');
        return;
      }
      const previousId = (JSON.parse(utf8(prior).trimEnd().split('\n').at(-1)!) as { id: string }).id;
      if (r.recoveryOf !== previousId) throw new Error('TEMPO_NONCE_RESERVED');
      const previous = await load(previousId);
      if (!previous.expiredUnusedNonce || previous.review.account !== r.review.account || previous.review.nonce !== r.review.nonce)
        throw new Error('TEMPO_NONCE_RESERVED');
      await log.extend(key, new TextEncoder().encode(utf8(prior) + line), bytes => {
        const ids = utf8(bytes).trimEnd().split('\n').map(v => (JSON.parse(v) as { id: string }).id);
        if (ids.some(id => !ID.test(id)) || new Set(ids).size !== ids.length) throw new Error('TEMPO_STORE_CORRUPT');
      });
    });
  }
  return {
    load, simulate: (workflow: unknown, account: string) => simulate(workflow, account),
    /** Only on-chain expiry PLUS finalized unused protocol nonce can retire an uncertain signature. */
    async recoverReview(id: string, workflowInput?: unknown) { return locked(id, async () => {
      let r = await load(id);
      if (!r.attempt || r.verdict !== 'PENDING') throw new Error('TEMPO_RECOVERY_OBSERVE_ONLY');
      const finalized = rpcRecord(await input.rpc('eth_getBlockByNumber', ['finalized', false]));
      const finalBlock = Number(rpcUint(finalized.number)), finalHash = rpcHash(finalized.hash);
      const state = await readTempoState(input.rpc, r.review.account, r.review.fields.recipient, now());
      const finalNonce = rpcUint(await input.rpc('eth_getTransactionCount', [r.review.account, supplyHex(rpcUint(finalized.number))]));
      if (now() < Date.parse(r.review.expiresAt) || rpcUint(finalized.timestamp) < BigInt(r.review.transaction.validBefore) ||
          state.nonce !== r.review.nonce || state.pendingNonce !== r.review.nonce || finalNonce !== BigInt(r.review.nonce) ||
          !Number.isSafeInteger(finalBlock) || finalBlock < r.review.state.block || finalBlock > state.block ||
          rpcUint(finalized.timestamp) > BigInt(state.blockTimestamp) ||
          rpcHash(rpcRecord(await input.rpc('eth_getBlockByNumber', [supplyHex(finalBlock), false])).hash) !== finalHash)
        throw new Error('TEMPO_RECOVERY_OBSERVE_ONLY');
      if (!r.expiredUnusedNonce) {
        if (r.attempt.state === 'SUBMITTING') r = { ...r, ...tempoTransition(r, 'PENDING', new Date(now())) };
        if (!['PREPARED', 'PENDING'].includes(r.attempt!.state)) throw new Error('TEMPO_RECOVERY_OBSERVE_ONLY');
        r = await save({ ...r, ...tempoTransition(r, 'CANCELLED', new Date(now())), authorization: null, error: 'TEMPO_EXPIRED_UNUSED_NONCE',
          expiredUnusedNonce: { finalizedBlock: finalBlock, finalizedHash: finalHash, timestamp: String(finalized.timestamp) } });
      }
      // Expiry changed the payload: fresh simulation, Review and wallet authorization are mandatory.
      const recovered = await simulate(workflowInput ?? r.review.workflow, r.review.account, id);
      if (recovered.review.nonce !== r.review.nonce) throw new Error('TEMPO_RECOVERY_STATE_CHANGED');
      return recovered;
    }); },
    async review(id: string, commitment: string, workflow: SemanticWorkflow) { return locked(id, async () => {
      const r = await load(id);
      if (r.attempt || r.error || r.review.commitment !== commitment) throw new Error('TEMPO_FRESH_SIMULATION_REQUIRED');
      await fresh(r, workflow, r.review.account); return save({ ...r, authorization: commitment });
    }); },
    async invalidate(id: string) { return locked(id, async () => { const r = await load(id); return save({ ...r, authorization: null, error: 'TEMPO_FRESH_SIMULATION_REQUIRED' }); }); },
    async begin(id: string, account: string, workflow: SemanticWorkflow) { return locked(id, async () => {
      const r = await load(id);
      if (r.attempt) throw new Error('TEMPO_EXISTING_ATTEMPT_OBSERVE_ONLY');
      if (r.error || r.authorization !== r.review.commitment) throw new Error('TEMPO_REVIEW_REQUIRED');
      const state = await fresh(r, workflow, account);
      await reserveNonce(r);
      const prepared = await save({ ...r, ...prepareTempoAttempt(r, state.block, state.nonce, new Date(now())) });
      return { record: prepared, transaction: r.review.transaction };
    }); },
    /** Browser verifies signed bytes first; persist their hash before it can broadcast. No signed bytes enter the server. */
    async handoff(id: string, hash: string, workflow: SemanticWorkflow) { return locked(id, async () => {
      const r = await load(id);
      if (!/^0x[0-9a-f]{64}$/.test(hash) || r.attempt?.state !== 'PREPARED' || r.authorization !== r.review.commitment) throw new Error('TEMPO_HANDOFF_DENIED');
      await fresh(r, workflow, r.review.account);
      const next = tempoTransition(r, 'SUBMITTING', new Date(now()));
      return save({ ...r, ...next, attempt: { ...next.attempt!, transactionHash: hash } });
    }); },
    async report(id: string) { return locked(id, async () => {
      const r = await load(id); if (r.attempt?.state !== 'SUBMITTING') return r;
      return save({ ...r, ...tempoTransition(r, 'PENDING', new Date(now())) });
    }); },
    async observe(id: string) { return locked(id, async () => {
      let r = await load(id);
      if (!r.attempt || ['PREPARED', 'CANCELLED'].includes(r.attempt.state) || r.verdict !== 'PENDING') return r;
      if (!r.attempt.transactionHash) {
        const found = await discoverTempoByNonce(r.attempt, input.rpc);
        if (!found.hash) return r;
        r = { ...r, attempt: { ...r.attempt, transactionHash: found.hash } };
      }
      if (r.attempt!.state === 'SUBMITTING') r = { ...r, ...tempoTransition(r, 'PENDING', new Date(now())) };
      const o = await reconcileTempoPayment(r.review, r.attempt!, input.rpc);
      if (o.verdict === 'INCONCLUSIVE') return save({ ...r, error: o.reason });
      if (o.verdict === 'DIVERGENT') return save({ ...r, ...tempoTransition(r, o.reason === 'TEMPO_REVERTED' ? 'REVERTED' : 'RECONCILIATION_REQUIRED', new Date(now())),
        authorization: null, verdict: 'DIVERGENT', observations: [...r.observations, o], error: o.reason });
      const confirmed = tempoTransition(r, 'CONFIRMED', new Date(now()));
      return save({ ...r, ...confirmed, attempt: { ...confirmed.attempt!, reconciled: true }, verdict: 'RECONCILED', observations: [...r.observations, o], error: null,
        evidence: buildTempoEvidence({ id, review: r.review, journal: confirmed.journal, provenance: input.provenance, ownerInitiated: r.ownerInitiated, observation: o, observedAt: new Date(now()).toISOString() }) });
    }); },
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 coordinator for one owner-signed native self-transfer on a public test network with a transfer profile
 * (Robinhood Testnet; BUILD-ETHEREUM-001 adds Ethereum Sepolia). It never holds a key, never signs and never sends:
 * the owner's wallet does, after this service has durably recorded PREPARED and then SUBMITTING. An owner+nonce lease
 * is never released by uncertainty, so a reload or restart cannot create a second economic attempt. Unknown results
 * are observation-only. The reviewed chain selects the profile and its own read client; no chain falls back to another.
 */
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { assertNativeTransferReview, readTransferState, simulateNativeTransfer, nativeTransferProfile, ROBINHOOD_TESTNET_TRANSFER,
  type NativeTransferReview, type NativeTransferTransaction, type TransferRpc } from '@defi-workflow-engine/reference-compiler';
import { createTransferRun, discoverTransferByNonce, prepareTransferAttempt, transferTransition, validateTransferRun, createFileExecutionStorage,
  logMissing, utf8, TRANSFER_RUN_ID, type ExecutionStorage, type TransferRun } from '@defi-workflow-engine/reference-executor';
import { buildNativeTransferEvidence, reconcileNativeTransfer, type NativeTransferEvidence, type TransferObservation } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

export type TransferWalletDiagnostic = { invoked: boolean; rejectionCode?: number; code: string;
  calls: { method: string; submission?: boolean; result?: unknown; error?: unknown }[] };
export type TransferRecord = TransferRun & { observations: TransferObservation[]; evidence: NativeTransferEvidence | null; error: string | null;
  notSubmitted?: boolean; recoveryOf?: string; walletDiagnostic?: TransferWalletDiagnostic };
export type TransferBegin = { record: TransferRecord; transaction: NativeTransferTransaction };
/** Wallet error codes that prove the request was refused before any broadcast. */
const REFUSALS = [4001, 4100, 4200];
const idCheck = (id: string) => { if (!TRANSFER_RUN_ID.test(id)) throw new Error('TRANSFER_ID_INVALID'); return id; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const prefix = (before: readonly unknown[], after: readonly unknown[]) => after.length >= before.length && same(after.slice(0, before.length), before);

/**
 * `rpc` is the Robinhood Testnet read client; `rpcs` adds one chain-bound read client per further transfer profile (CAIP-2
 * keyed). A network without a client is not enabled in this deployment, and its runs fail closed.
 */
export function createRobinhoodTransferService(input: { rpc?: TransferRpc; rpcs?: Readonly<Partial<Record<string, TransferRpc>>>; journalDir?: string;
  storage?: ExecutionStorage; provenance: 'PUBLIC_TESTNET' | 'MOCKED'; now?: () => number }) {
  // Local mode keeps the original journal directory; cloud mode supplies shared durable storage instead.
  if (!input.storage && (!input.journalDir || !isAbsolute(input.journalDir) || input.journalDir.includes('/.git/'))) throw new Error('TRANSFER_STORAGE_INVALID');
  const { log, leases } = input.storage ?? createFileExecutionStorage(input.journalDir!, 'TRANSFER_BUSY');
  const now = input.now ?? Date.now, at = () => new Date(now());
  const rpcFor = (chain: string): TransferRpc => {
    const rpc = input.rpcs?.[chain] ?? (chain === ROBINHOOD_TESTNET_TRANSFER.chain ? input.rpc : undefined);
    if (!rpc) throw new Error('TRANSFER_NETWORK_UNAVAILABLE');
    return rpc;
  };
  const stateOf = (review: NativeTransferReview, account: string) => readTransferState(rpcFor(review.chain), nativeTransferProfile(review.chain), account, now());
  const path = (id: string) => idCheck(id) + '.jsonl';
  /** Append-only history: every line is a valid run and never rewrites what an earlier line established. */
  const validate = (bytes: Uint8Array) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || bytes.length > 16_777_216) throw new Error('TRANSFER_STORE_CORRUPT');
    let prior: TransferRecord | null = null;
    for (const line of text.trimEnd().split('\n')) {
      const record = JSON.parse(line) as TransferRecord; validateTransferRun(record);
      if (record.provenance !== input.provenance || record.recoveryOf !== undefined && idCheck(record.recoveryOf) === record.id) throw new Error('TRANSFER_STORE_CORRUPT');
      if (record.evidence && record.verdict !== 'RECONCILED') throw new Error('TRANSFER_STORE_CORRUPT');
      if (prior) {
        const a = prior.attempt, b = record.attempt;
        if (record.id !== prior.id || record.review.commitment !== prior.review.commitment || record.recoveryOf !== prior.recoveryOf ||
            !prefix(prior.journal.entries, record.journal.entries) || !prefix(prior.observations, record.observations) ||
            prior.ownerInitiated && !record.ownerInitiated || prior.verdict !== 'PENDING' && record.verdict !== prior.verdict ||
            prior.notSubmitted && !record.notSubmitted || prior.evidence && !same(prior.evidence, record.evidence) ||
            a && (!b || a.nonce !== b.nonce || a.preparedAtBlock !== b.preparedAtBlock || !same(a.transaction, b.transaction) ||
              a.transactionHash && a.transactionHash !== b.transactionHash || a.reconciled && !b.reconciled)) throw new Error('TRANSFER_STORE_CORRUPT');
      }
      prior = record;
    }
  };
  const load = async (id: string): Promise<TransferRecord> => {
    const bytes = await log.read(path(id)); if (!bytes) throw logMissing(path(id)); validate(bytes);
    return JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!) as TransferRecord;
  };
  const save = async (record: TransferRecord) => {
    const prior = utf8(await log.read(path(record.id)));
    await log.extend(path(record.id), new TextEncoder().encode(prior + JSON.stringify(record) + '\n'), validate);
    return record;
  };
  /** Cross-process exclusive section: the original PID lock directory locally, a fenced lease in shared storage. */
  const locked = <T,>(key: string, action: () => Promise<T>): Promise<T> => leases.hold(key, action);
  /** Permanent economic identity of (owner, nonce). Only a proven pre-broadcast refusal lets a fresh Review reuse it. */
  async function reserveNonce(record: TransferRecord): Promise<void> {
    // Owner nonces are per chain. Robinhood Testnet keeps its original lease names; any other chain is qualified by its CAIP-2 id.
    const owner = `${record.review.account}-${record.review.nonce}`;
    const key = record.review.chain === ROBINHOOD_TESTNET_TRANSFER.chain ? owner : `${record.review.chain.replace(':', '-')}-${owner}`, lease = key + '.intent';
    await locked(key, async () => {
      const entry = JSON.stringify({ id: record.id, transaction: record.review.transaction }) + '\n';
      const existing = await log.read(lease), prior = existing === null ? null : utf8(existing);
      if (prior === null) {
        if (!await log.create(lease, new TextEncoder().encode(entry))) throw new Error('TRANSFER_NONCE_ALREADY_RESERVED');
      } else {
        const last = JSON.parse(prior.trimEnd().split('\n').at(-1)!) as { id: string };
        if (!record.recoveryOf || last.id !== record.recoveryOf || !(await load(record.recoveryOf)).notSubmitted) throw new Error('TRANSFER_NONCE_ALREADY_RESERVED');
        await log.extend(lease, new TextEncoder().encode(prior + entry), bytes => {
          const ids = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd().split('\n').map(line => (JSON.parse(line) as { id: string }).id);
          if (ids.some(id => !TRANSFER_RUN_ID.test(id)) || new Set(ids).size !== ids.length) throw new Error('TRANSFER_STORE_CORRUPT');
        });
      }
    });
  }
  const fresh = async (workflowInput: unknown, account: string, recoveryOf?: { id: string; nonce: string }): Promise<TransferRecord> => {
    const workflow = validateAuthoringWorkflow(workflowInput, createBaseSepoliaReviewContext());
    const chain = workflow.nodes.find(node => node.actionType === 'asset.transfer')?.chainId;
    if (!chain) throw new Error('TRANSFER_ISOLATED_ONLY');
    const review = await simulateNativeTransfer(workflow, account, rpcFor(chain), now());
    // A fresh Review may only re-authorize the SAME unconsumed nonce; anything else means the chain moved on.
    if (recoveryOf && review.nonce !== recoveryOf.nonce) throw new Error('TRANSFER_RECOVERY_STATE_CHANGED_OBSERVE_EXISTING');
    const record: TransferRecord = { ...createTransferRun('rhx-' + randomBytes(16).toString('hex'), review, input.provenance, at()),
      observations: [], evidence: null, error: null, ...recoveryOf ? { recoveryOf: recoveryOf.id } : {} };
    return save(record);
  };
  return {
    load,
    /** Read-only: chain state and the exact transaction are simulated; nothing is signed or sent. */
    simulate: (workflowInput: unknown, account: string) => fresh(workflowInput, account),
    async review(id: string, commitment: string, workflow: SemanticWorkflow): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt || record.verdict !== 'PENDING' || record.review.commitment !== commitment) throw new Error('TRANSFER_AUTHORIZATION_REPLACED');
      if (now() >= Date.parse(record.review.expiresAt)) throw new Error('TRANSFER_REVIEW_EXPIRED');
      assertNativeTransferReview(record.review, workflow, record.review.account, await stateOf(record.review, record.review.account), now());
      return save({ ...record, authorization: commitment, error: null });
    }); },
    async invalidate(id: string): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      return record.authorization ? save({ ...record, authorization: null, error: 'TRANSFER_SEMANTIC_EDIT_REQUIRES_REVIEW' }) : record;
    }); },
    /** Re-verifies the Review against fresh state, reserves the nonce, then persists PREPARED before any wallet request. */
    async begin(id: string, account: string, workflow: SemanticWorkflow): Promise<TransferBegin> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.authorization !== record.review.commitment) throw new Error('TRANSFER_REVIEW_REQUIRED');
      if (record.attempt) throw new Error('TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY');
      if (now() >= Date.parse(record.review.expiresAt)) throw new Error('TRANSFER_REVIEW_EXPIRED');
      const state = await stateOf(record.review, account);
      assertNativeTransferReview(record.review, workflow, account, state, now());
      await reserveNonce(record);
      const prepared = await save({ ...record, ...prepareTransferAttempt(record, state.block, state.nonce, at()), error: null });
      return { record: prepared, transaction: prepared.attempt!.transaction };
    }); },
    /** The handoff boundary: SUBMITTING is durable before the browser calls the wallet. */
    async handoff(id: string): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt?.state !== 'PREPARED' || record.authorization !== record.review.commitment || now() >= Date.parse(record.review.expiresAt))
        throw new Error('TRANSFER_WALLET_HANDOFF_NOT_AUTHORIZED');
      const state = await stateOf(record.review, record.review.account);
      if (state.nonce !== record.attempt.nonce || state.pendingNonce !== record.attempt.nonce) throw new Error('TRANSFER_NONCE_CHANGED');
      return save({ ...record, ...transferTransition(record, 'SUBMITTING', at()) });
    }); },
    async report(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id), attempt = record.attempt;
      if (!attempt) throw new Error('TRANSFER_ATTEMPT_MISSING');
      if (result.kind === 'HASH') {
        if (!/^0x[0-9a-f]{64}$/.test(result.hash)) throw new Error('TRANSFER_HASH_INVALID');
        if (attempt.transactionHash && attempt.transactionHash !== result.hash) throw new Error('TRANSFER_HASH_DIVERGENT');
        if (attempt.transactionHash || !['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) return record;
        const hashed = { ...record, attempt: { ...attempt, transactionHash: result.hash } };
        return save({ ...hashed, ...transferTransition(hashed, 'PENDING', at()), error: null });
      }
      if (attempt.state !== 'SUBMITTING') return record;
      return save({ ...record, ...transferTransition(record, 'SUBMISSION_RESULT_UNKNOWN', at()),
        error: result.kind === 'REJECTED' ? 'TRANSFER_REJECTED' : 'TRANSFER_SUBMISSION_UNKNOWN' });
    }); },
    /** Records a proven pre-broadcast refusal. Anything that may have reached the network stays observation-only. */
    async walletFailure(id: string, diagnostic: TransferWalletDiagnostic): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id), attempt = record.attempt;
      if (JSON.stringify(diagnostic).length > 65_536 || typeof diagnostic.invoked !== 'boolean' || !Array.isArray(diagnostic.calls) ||
          !/^TRANSFER_[A-Z0-9_]{2,70}$/.test(diagnostic.code)) throw new Error('TRANSFER_DIAGNOSTIC_INVALID');
      const send = diagnostic.calls.find(c => c.submission === true), error = send?.error as { code?: unknown } | undefined;
      const refused = diagnostic.invoked && send !== undefined && send.result === undefined && typeof error?.code === 'number' &&
        error.code === diagnostic.rejectionCode && REFUSALS.includes(error.code);
      if ((diagnostic.invoked || send) && !refused || attempt?.transactionHash || attempt?.reconciled) throw new Error('TRANSFER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
      let next: TransferRecord = record;
      if (attempt) {
        if (attempt.state === 'PREPARED') next = { ...next, ...transferTransition(next, 'CANCELLED', at()) };
        else if (['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) {
          next = { ...next, ...transferTransition(next, 'SUBMISSION_RESULT_UNKNOWN', at()) };
          next = { ...next, ...transferTransition(next, 'NOT_FOUND', at()) };
        } else if (!['CANCELLED', 'NOT_FOUND'].includes(attempt.state)) throw new Error('TRANSFER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
      }
      return save({ ...next, authorization: null, error: diagnostic.code, walletDiagnostic: diagnostic, notSubmitted: Boolean(attempt) || record.notSubmitted === true });
    }); },
    /** Read-only observation and reconciliation. There is no send path here. */
    async observe(id: string): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      let record = await load(id);
      const attempt = record.attempt;
      if (!attempt || record.verdict !== 'PENDING' || record.notSubmitted) return record;
      if (attempt.state === 'PREPARED') {
        // The browser stopped before the durable handoff: no wallet request can have been made for this attempt.
        return save({ ...record, ...transferTransition(record, 'CANCELLED', at()), authorization: null, notSubmitted: true, error: 'TRANSFER_WALLET_NOT_SUBMITTED',
          walletDiagnostic: { invoked: false, calls: [], code: 'TRANSFER_WALLET_NOT_SUBMITTED' } });
      }
      if (!attempt.transactionHash) {
        const found = await discoverTransferByNonce(attempt, rpcFor(record.review.chain));
        if (!found.consumed || !found.hash) return save({ ...record, error: 'TRANSFER_TRANSACTION_NOT_OBSERVED' });
        record = { ...record, attempt: { ...attempt, transactionHash: found.hash } };
        record = { ...record, ...transferTransition(record, 'PENDING', at()), error: null };
        if (found.mismatch) {
          // The reviewed nonce was consumed by a different transaction; the reviewed transfer can never execute.
          return save({ ...record, ...transferTransition(record, 'RECONCILIATION_REQUIRED', at()), verdict: 'DIVERGENT', error: 'TRANSFER_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION' });
        }
        record = await save(record);
      }
      const current = record.attempt!;
      const observation = await reconcileNativeTransfer(record.review, current, rpcFor(record.review.chain));
      if (observation.verdict === 'INCONCLUSIVE') return save({ ...record, error: observation.reason });
      const observations = [...record.observations, observation];
      if (observation.verdict === 'DIVERGENT') {
        const terminal = transferTransition(record, observation.reason === 'TRANSFER_REVERTED' ? 'REVERTED' : 'RECONCILIATION_REQUIRED', at());
        return save({ ...record, ...terminal, observations, verdict: 'DIVERGENT', error: observation.reason });
      }
      const confirmed = transferTransition(record, 'CONFIRMED', at());
      const reconciled: TransferRecord = { ...record, ...confirmed, attempt: { ...confirmed.attempt!, reconciled: true }, observations, verdict: 'RECONCILED', error: null };
      return save({ ...reconciled, evidence: buildNativeTransferEvidence({ id: record.id, review: record.review, journal: reconciled.journal,
        provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation, observedAt: at().toISOString() }) });
    }); },
    /** A fresh explicit Review for the SAME intent and nonce, only after a proven pre-broadcast refusal. */
    async recoverReview(id: string): Promise<TransferRecord> { return locked(idCheck(id), async () => {
      const record = await load(id), attempt = record.attempt;
      if (!record.notSubmitted || record.verdict !== 'PENDING' || !attempt || attempt.transactionHash) throw new Error('TRANSFER_RECOVERY_OBSERVE_ONLY');
      return fresh(record.review.workflow, record.review.account, { id, nonce: attempt.nonce });
    }); },
  };
}
export type RobinhoodTransferService = ReturnType<typeof createRobinhoodTransferService>;

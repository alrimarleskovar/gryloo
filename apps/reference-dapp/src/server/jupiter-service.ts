// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateJupiterSwap, assertJupiterReview, verifySignedJupiterTransaction, solanaAddress, type JupiterHttp, type SolanaRpc } from '@defi-workflow-engine/reference-compiler';
import { createJupiterRun, prepareJupiterAttempt, recordJupiterSignature, jupiterTransition, jupiterObservationDecision, jupiterAttemptResolved,
  validateJupiterRun, writeExtendingFile, type JupiterRun } from '@defi-workflow-engine/reference-executor';
import { reconcileJupiterAttempt, buildJupiterEvidence, classifyJupiterEvidence, type JupiterObservation, type JupiterEvidenceClass } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

export type JupiterWalletDiagnostic = { stage: 'CONNECT' | 'SIGN' | 'PREFLIGHT'; code: string; error: unknown };
export type JupiterRecord = JupiterRun & { observations: JupiterObservation[]; evidence: ReturnType<typeof buildJupiterEvidence> | null; error: string | null;
  evidenceClass: JupiterEvidenceClass; notSubmitted?: boolean; submissionError?: string; walletDiagnostic?: JupiterWalletDiagnostic };
export type JupiterBegin = { record: JupiterRecord; unsignedTransaction: string; walletChain: string };
const idCheck = (id: string) => { if (!/^jupiter-[a-f0-9]{32}$/.test(id)) throw new Error('JUPITER_ID_INVALID'); return id; };
const code = (cause: unknown, fallback: string) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : fallback;

export function createJupiterService(input: { rpc: SolanaRpc; http: JupiterHttp; journalDir: string; provenance: 'PUBLIC_MAINNET' | 'MOCKED';
  executionEnabled: boolean; now?: () => number }) {
  if (!isAbsolute(input.journalDir) || input.journalDir.includes('/.git/')) throw new Error('JUPITER_STORAGE_INVALID');
  const now = input.now ?? Date.now;
  const path = (id: string) => join(input.journalDir, idCheck(id) + '.jsonl');
  const validate = (bytes: Uint8Array) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || bytes.length > 16_777_216) throw new Error('JUPITER_STORE_CORRUPT');
    let prior: JupiterRecord | null = null;
    for (const line of text.trimEnd().split('\n')) {
      const record = JSON.parse(line) as JupiterRecord;
      validateJupiterRun(record);
      if (record.provenance !== input.provenance || record.evidenceClass !== classifyJupiterEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation: record.observations.at(-1) ?? null }) ||
          record.notSubmitted && (record.attempt?.signature || record.attempt && record.attempt.state !== 'CANCELLED')) throw new Error('JUPITER_STORE_CORRUPT');
      if (prior) {
        const prefix = (a: unknown[], b: unknown[]) => b.length >= a.length && JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a);
        if (record.id !== prior.id || record.review.commitment !== prior.review.commitment || !prefix(prior.journal.entries, record.journal.entries) ||
            !prefix(prior.observations, record.observations) || prior.attempt && !record.attempt || prior.verdict !== 'PENDING' && record.verdict !== prior.verdict ||
            prior.attempt?.signature && prior.attempt.signature !== record.attempt?.signature || prior.attempt?.transaction && prior.attempt.transaction !== record.attempt?.transaction ||
            prior.evidence && JSON.stringify(prior.evidence) !== JSON.stringify(record.evidence)) throw new Error('JUPITER_STORE_CORRUPT');
      }
      prior = record;
    }
  };
  const load = async (id: string): Promise<JupiterRecord> => {
    const bytes = await readFile(path(id)); validate(bytes);
    return JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!) as JupiterRecord;
  };
  const save = async (record: JupiterRecord) => {
    const next = { ...record, evidenceClass: classifyJupiterEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation: record.observations.at(-1) ?? null }) };
    let prior = ''; try { prior = await readFile(path(record.id), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await writeExtendingFile(path(record.id), new TextEncoder().encode(prior + JSON.stringify(next) + '\n'), validate);
    return next;
  };
  async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    await mkdir(input.journalDir, { recursive: true, mode: 0o700 });
    const directory = join(input.journalDir, key + '.lock');
    try { await mkdir(directory, { mode: 0o700 }); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const before = await stat(directory);
      let pid: number; try { pid = Number(await readFile(join(directory, 'pid'), 'utf8')); } catch (cause) { throw new Error('JUPITER_BUSY', { cause }); }
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('JUPITER_BUSY', { cause: e });
      try { process.kill(pid, 0); throw new Error('JUPITER_BUSY', { cause: e }); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
      const after = await stat(directory); if (before.ino !== after.ino) throw new Error('JUPITER_BUSY', { cause: e });
      await unlink(join(directory, 'pid')); await rmdir(directory); await mkdir(directory, { mode: 0o700 });
    }
    const handle = await open(join(directory, 'pid'), 'wx', 0o600);
    try { await handle.writeFile(String(process.pid)); await handle.sync(); } finally { await handle.close(); }
    try { return await action(); } finally { await unlink(join(directory, 'pid')); await rmdir(directory); }
  }
  const blockHeight = async (commitment: 'confirmed' | 'finalized') => {
    const height = await input.rpc('getBlockHeight', [{ commitment }]);
    if (!Number.isSafeInteger(height)) throw new Error('SOLANA_RPC_INVALID');
    return height as number;
  };
  /** One unresolved attempt per owner across runs, tabs and restarts. The lease history is append-only. */
  async function acquireOwnerLease(owner: string, id: string): Promise<void> {
    await locked('owner-' + owner, async () => {
      const lease = join(input.journalDir, owner + '.jupiter-lease');
      let prior = ''; try { prior = await readFile(lease, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const holders = prior.trimEnd().split('\n').filter(Boolean);
      const holder = holders.at(-1);
      if (holder && holder !== id && !jupiterAttemptResolved(await load(holder))) throw new Error('JUPITER_OWNER_ATTEMPT_IN_PROGRESS');
      if (holder === id) throw new Error('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
      await writeExtendingFile(lease, new TextEncoder().encode(prior + id + '\n'), bytes => {
        if (!new TextDecoder().decode(bytes).trimEnd().split('\n').every(line => /^jupiter-[a-f0-9]{32}$/.test(line))) throw new Error('JUPITER_STORE_CORRUPT');
      });
    });
  }
  return {
    load,
    executionEnabled: input.executionEnabled,
    async simulate(workflowInput: unknown, owner: string): Promise<JupiterRecord> {
      const workflow = validateAuthoringWorkflow(workflowInput, createBaseSepoliaReviewContext());
      const review = await simulateJupiterSwap(workflow, solanaAddress(owner), input.http, input.rpc, now());
      const id = 'jupiter-' + randomBytes(16).toString('hex');
      return save({ ...createJupiterRun(id, review, input.provenance), observations: [], evidence: null, error: null, evidenceClass: 'PUBLIC_READ_ONLY' });
    },
    async review(id: string, commitment: string, workflow: SemanticWorkflow): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt || record.review.commitment !== commitment) throw new Error('JUPITER_AUTHORIZATION_REPLACED');
      assertJupiterReview(record.review, workflow, record.review.owner, await blockHeight('confirmed'), now());
      return save({ ...record, authorization: commitment, error: null });
    }); },
    async invalidate(id: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      return record.authorization ? save({ ...record, authorization: null, error: 'JUPITER_SEMANTIC_EDIT_REQUIRES_REVIEW' }) : record;
    }); },
    async begin(id: string, owner: string, workflow: SemanticWorkflow): Promise<JupiterBegin> { return locked(idCheck(id), async () => {
      if (!input.executionEnabled) throw new Error('JUPITER_MAINNET_EXECUTION_NOT_ENABLED');
      const record = await load(id);
      if (record.authorization !== record.review.commitment) throw new Error('JUPITER_REVIEW_REQUIRED');
      if (record.attempt) throw new Error('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
      const height = await blockHeight('confirmed');
      assertJupiterReview(record.review, workflow, solanaAddress(owner), height, now());
      await acquireOwnerLease(record.review.owner, id);
      const prepared = await save({ ...record, ...prepareJupiterAttempt(record, height), error: null }); // Durable BEFORE the wallet is asked to sign.
      return { record: prepared, unsignedTransaction: record.review.unsignedTransaction, walletChain: 'solana:mainnet' };
    }); },
    /** The wallet never returned signed bytes: no transaction can exist. */
    async walletFailure(id: string, diagnostic: JupiterWalletDiagnostic): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (JSON.stringify(diagnostic).length > 16_384 || !/^JUPITER_[A-Z0-9_]{2,70}$/.test(diagnostic.code)) throw new Error('JUPITER_DIAGNOSTIC_INVALID');
      if (record.attempt && record.attempt.state !== 'PREPARED') throw new Error('JUPITER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
      const cancelled = record.attempt ? jupiterTransition(record, 'CANCELLED') : record;
      return save({ ...record, ...cancelled, authorization: null, notSubmitted: Boolean(record.attempt), walletDiagnostic: diagnostic, error: diagnostic.code, submissionError: diagnostic.code });
    }); },
    /** Verify exact reviewed bytes and owner signature, persist the signature, then broadcast once. */
    async submit(id: string, signedTransaction: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt?.state !== 'PREPARED' || record.authorization !== record.review.commitment) throw new Error('JUPITER_WALLET_HANDOFF_NOT_AUTHORIZED');
      let signed: ReturnType<typeof verifySignedJupiterTransaction>;
      try {
        signed = verifySignedJupiterTransaction(record.review, signedTransaction);
        if (now() >= Date.parse(record.review.expiresAt) || await blockHeight('confirmed') >= record.review.lastValidBlockHeight) throw new Error('JUPITER_QUOTE_STALE');
      } catch (cause) {
        const failure = code(cause, 'JUPITER_TRANSACTION_CHANGED');
        // Gryloo never broadcasts modified, mis-signed or stale bytes; the reviewed blockhash bounds any copy's validity.
        return save({ ...record, ...jupiterTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, error: failure, submissionError: failure,
          walletDiagnostic: { stage: 'SIGN', code: failure, error: { message: failure } } });
      }
      const submitting = await save({ ...record, ...recordJupiterSignature(record, signed), error: null });
      try {
        const result = await input.rpc('sendTransaction', [signed.transaction, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 10 }]);
        if (result !== signed.signature) throw new Error('JUPITER_SUBMISSION_RESULT_MISMATCH');
        return save({ ...submitting, ...jupiterTransition(submitting, 'PENDING') });
      } catch (cause) {
        // The signature is already durable. Observation by signature resolves this; there is never a second swap.
        return save({ ...submitting, ...jupiterTransition(submitting, 'SUBMISSION_RESULT_UNKNOWN'), error: 'JUPITER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING',
          submissionError: code(cause, 'JUPITER_RPC_SUBMISSION_FAILED') });
      }
    }); },
    async observe(id: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      let record = await load(id);
      const attempt = record.attempt;
      if (!attempt || record.verdict !== 'PENDING') return record;
      if (attempt.state === 'PREPARED') {
        const diagnostic: JupiterWalletDiagnostic = { stage: 'SIGN', code: 'JUPITER_WALLET_NOT_SUBMITTED', error: { message: 'No signed transaction was returned before recovery.' } };
        return save({ ...record, ...jupiterTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, walletDiagnostic: diagnostic, error: diagnostic.code });
      }
      if (attempt.state === 'CANCELLED') return record;
      // Height before status: if finalized height is past validity and the signature is still unknown, it can never land.
      const finalizedHeight = await blockHeight('finalized');
      const observation = await reconcileJupiterAttempt(record.review, attempt, input.rpc);
      const decision = jupiterObservationDecision(observation.found, finalizedHeight, record.review.lastValidBlockHeight);
      if (decision === 'WAIT') return save({ ...record, error: observation.reason === 'TRANSACTION_NOT_OBSERVED' ? 'JUPITER_TRANSACTION_NOT_OBSERVED' : observation.reason });
      if (decision === 'EXPIRED') {
        let next: JupiterRun = record;
        if (attempt.state === 'SUBMITTING') next = jupiterTransition(next, 'SUBMISSION_RESULT_UNKNOWN');
        next = jupiterTransition(next, next.attempt!.state === 'PENDING' ? 'EXPIRED' : 'NOT_FOUND');
        return save({ ...record, ...next, verdict: 'NOT_EXECUTED', authorization: null, error: 'JUPITER_TRANSACTION_EXPIRED_NOT_EXECUTED' });
      }
      if (['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) record = { ...record, ...jupiterTransition(record, 'PENDING') };
      if (observation.verdict === 'INCONCLUSIVE') return save({ ...record, error: observation.reason });
      const reverted = observation.reason === 'JUPITER_SWAP_FAILED', reconciled = observation.verdict === 'RECONCILED';
      const state = reconciled ? 'CONFIRMED' : reverted ? 'REVERTED' : 'RECONCILIATION_REQUIRED';
      const next = { ...record, ...jupiterTransition(record, state, { reconciled }), observations: [...record.observations, observation],
        verdict: reconciled ? 'RECONCILED' as const : 'DIVERGENT' as const, error: reconciled ? null : observation.reason };
      return save(reconciled ? { ...next, evidence: buildJupiterEvidence({ id: next.id, review: next.review, journal: next.journal, provenance: next.provenance,
        ownerInitiated: next.ownerInitiated, observation }) } : next);
    }); },
  };
}
export type JupiterService = ReturnType<typeof createJupiterService>;

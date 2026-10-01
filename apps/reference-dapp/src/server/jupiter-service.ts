// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateJupiterSwap, assertJupiterReview, verifySignedJupiterTransaction, simulateOrcaDevnetSwap, assertOrcaDevnetReview, verifySignedOrcaDevnetTransaction,
  requireSolanaSwapRuntime, solanaAddress, type JupiterHttp, type JupiterReview, type OrcaDevnetReview, type SolanaRpc, type SolanaSwapReview } from '@defi-workflow-engine/reference-compiler';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, type SolanaSwapRuntime } from '@defi-workflow-engine/action-registry';
import { createSolanaSwapRun, prepareSolanaSwapAttempt, recordSolanaSwapSignature, solanaSwapTransition, solanaSwapObservationDecision, solanaSwapAttemptResolved,
  validateSolanaSwapRun, writeExtendingFile, type SolanaSwapProvenance, type SolanaSwapRun } from '@defi-workflow-engine/reference-executor';
import { reconcileSolanaSwapAttempt, buildSolanaSwapEvidence, classifySolanaSwapEvidence, type JupiterObservation, type SolanaSwapEvidenceClass } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

export type JupiterWalletDiagnostic = { stage: 'CONNECT' | 'SIGN' | 'PREFLIGHT'; code: string; error: unknown };
export type SolanaSwapWalletDiagnostic = JupiterWalletDiagnostic;
export type JupiterRecord = SolanaSwapRun & { observations: JupiterObservation[]; evidence: ReturnType<typeof buildSolanaSwapEvidence> | null; error: string | null;
  evidenceClass: SolanaSwapEvidenceClass; notSubmitted?: boolean; submissionError?: string; walletDiagnostic?: JupiterWalletDiagnostic };
export type SolanaSwapRecord = JupiterRecord;
export type JupiterBegin = { record: JupiterRecord; unsignedTransaction: string; walletChain: string };
const code = (cause: unknown, fallback: string) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : fallback;

/** A runtime's provider-specific steps; journal, lease, signature handoff, recovery and reconciliation are shared. */
export type SolanaSwapAdapter = { runtime: SolanaSwapRuntime;
  simulate(workflow: SemanticWorkflow, owner: string, rpc: SolanaRpc, now: number): Promise<SolanaSwapReview>;
  assertReview(review: SolanaSwapReview, workflow: SemanticWorkflow, owner: string, blockHeight: number, now: number): void;
  verifySigned(review: SolanaSwapReview, signed: unknown): { signature: string; transaction: string } };
const reviewOf = <T extends SolanaSwapReview['format']>(review: SolanaSwapReview, format: T, prefix: string) =>
  review.format === format ? review as Extract<SolanaSwapReview, { format: T }> : (() => { throw new Error(prefix + '_AUTHORIZATION_INVALID'); })();
export const jupiterAdapter = (http: JupiterHttp): SolanaSwapAdapter => ({ runtime: requireSolanaSwapRuntime(JUPITER_SOLANA_MAINNET.chain),
  simulate: (workflow, owner, rpc, now) => simulateJupiterSwap(workflow, owner, http, rpc, now),
  assertReview: (review, workflow, owner, height, now) => assertJupiterReview(reviewOf(review, 'gryloo.jupiter-review.v1', 'JUPITER') as JupiterReview, workflow, owner, height, now),
  verifySigned: (review, signed) => verifySignedJupiterTransaction(reviewOf(review, 'gryloo.jupiter-review.v1', 'JUPITER') as JupiterReview, signed) });
export const orcaDevnetAdapter = (): SolanaSwapAdapter => ({ runtime: requireSolanaSwapRuntime(ORCA_WHIRLPOOLS_DEVNET.chain),
  simulate: (workflow, owner, rpc, now) => simulateOrcaDevnetSwap(workflow, owner, rpc, now),
  assertReview: (review, workflow, owner, height, now) => assertOrcaDevnetReview(reviewOf(review, 'gryloo.orca-devnet-review.v1', 'DEVNET_SWAP') as OrcaDevnetReview, workflow, owner, height, now),
  verifySigned: (review, signed) => verifySignedOrcaDevnetTransaction(reviewOf(review, 'gryloo.orca-devnet-review.v1', 'DEVNET_SWAP') as OrcaDevnetReview, signed) });

export function createJupiterService(input: { rpc: SolanaRpc; http: JupiterHttp; journalDir: string; provenance: 'PUBLIC_MAINNET' | 'MOCKED';
  executionEnabled: boolean; now?: () => number }) {
  return createSolanaSwapService({ ...input, adapter: jupiterAdapter(input.http) });
}
/** Solana Devnet through Orca Whirlpools with valueless test tokens. Execution still requires Review, Execute and the owner's wallet signature. */
export function createSolanaDevnetService(input: { rpc: SolanaRpc; journalDir: string; provenance: 'PUBLIC_DEVNET' | 'MOCKED'; executionEnabled: boolean; now?: () => number }) {
  return createSolanaSwapService({ ...input, adapter: orcaDevnetAdapter() });
}

export function createSolanaSwapService(input: { adapter: SolanaSwapAdapter; rpc: SolanaRpc; journalDir: string; provenance: SolanaSwapProvenance;
  executionEnabled: boolean; now?: () => number }) {
  const { runtime } = input.adapter, X = runtime.codePrefix;
  if (input.provenance !== 'MOCKED' && input.provenance !== runtime.provenance) throw new Error(`${X}_PROVENANCE_INVALID`);
  if (!isAbsolute(input.journalDir) || input.journalDir.includes('/.git/')) throw new Error(`${X}_STORAGE_INVALID`);
  const idPattern = new RegExp(`^${runtime.idPrefix}-[a-f0-9]{32}$`);
  const idCheck = (id: string) => { if (typeof id !== 'string' || !idPattern.test(id)) throw new Error(`${X}_ID_INVALID`); return id; };
  const now = input.now ?? Date.now;
  const path = (id: string) => join(input.journalDir, idCheck(id) + '.jsonl');
  const validate = (bytes: Uint8Array) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || bytes.length > 16_777_216) throw new Error(`${X}_STORE_CORRUPT`);
    let prior: JupiterRecord | null = null;
    for (const line of text.trimEnd().split('\n')) {
      const record = JSON.parse(line) as JupiterRecord;
      validateSolanaSwapRun(record);
      if (record.provenance !== input.provenance || record.evidenceClass !== classifySolanaSwapEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation: record.observations.at(-1) ?? null }) ||
          record.notSubmitted && (record.attempt?.signature || record.attempt && record.attempt.state !== 'CANCELLED')) throw new Error(`${X}_STORE_CORRUPT`);
      if (prior) {
        const prefix = (a: unknown[], b: unknown[]) => b.length >= a.length && JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a);
        if (record.id !== prior.id || record.review.commitment !== prior.review.commitment || !prefix(prior.journal.entries, record.journal.entries) ||
            !prefix(prior.observations, record.observations) || prior.attempt && !record.attempt || prior.verdict !== 'PENDING' && record.verdict !== prior.verdict ||
            prior.attempt?.signature && prior.attempt.signature !== record.attempt?.signature || prior.attempt?.transaction && prior.attempt.transaction !== record.attempt?.transaction ||
            prior.evidence && JSON.stringify(prior.evidence) !== JSON.stringify(record.evidence)) throw new Error(`${X}_STORE_CORRUPT`);
      }
      prior = record;
    }
  };
  const load = async (id: string): Promise<JupiterRecord> => {
    const bytes = await readFile(path(id)); validate(bytes);
    return JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!) as JupiterRecord;
  };
  const save = async (record: JupiterRecord) => {
    const next = { ...record, evidenceClass: classifySolanaSwapEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation: record.observations.at(-1) ?? null }) };
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
      let pid: number; try { pid = Number(await readFile(join(directory, 'pid'), 'utf8')); } catch (cause) { throw new Error(`${X}_BUSY`, { cause }); }
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`${X}_BUSY`, { cause: e });
      try { process.kill(pid, 0); throw new Error(`${X}_BUSY`, { cause: e }); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
      const after = await stat(directory); if (before.ino !== after.ino) throw new Error(`${X}_BUSY`, { cause: e });
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
      const lease = join(input.journalDir, owner + `.${runtime.idPrefix}-lease`);
      let prior = ''; try { prior = await readFile(lease, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      const holders = prior.trimEnd().split('\n').filter(Boolean);
      const holder = holders.at(-1);
      if (holder && holder !== id && !solanaSwapAttemptResolved(await load(holder))) throw new Error(`${X}_OWNER_ATTEMPT_IN_PROGRESS`);
      if (holder === id) throw new Error(`${X}_EXISTING_ATTEMPT_OBSERVE_ONLY`);
      await writeExtendingFile(lease, new TextEncoder().encode(prior + id + '\n'), bytes => {
        if (!new TextDecoder().decode(bytes).trimEnd().split('\n').every(line => idPattern.test(line))) throw new Error(`${X}_STORE_CORRUPT`);
      });
    });
  }
  return {
    load,
    executionEnabled: input.executionEnabled,
    async simulate(workflowInput: unknown, owner: string): Promise<JupiterRecord> {
      const workflow = validateAuthoringWorkflow(workflowInput, createBaseSepoliaReviewContext());
      const review = await input.adapter.simulate(workflow, solanaAddress(owner), input.rpc, now());
      const id = `${runtime.idPrefix}-` + randomBytes(16).toString('hex');
      return save({ ...createSolanaSwapRun(id, review, input.provenance), observations: [], evidence: null, error: null, evidenceClass: 'PUBLIC_READ_ONLY' });
    },
    async review(id: string, commitment: string, workflow: SemanticWorkflow): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt || record.review.commitment !== commitment) throw new Error(`${X}_AUTHORIZATION_REPLACED`);
      input.adapter.assertReview(record.review, workflow, record.review.owner, await blockHeight('confirmed'), now());
      return save({ ...record, authorization: commitment, error: null });
    }); },
    async invalidate(id: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      return record.authorization ? save({ ...record, authorization: null, error: `${X}_SEMANTIC_EDIT_REQUIRES_REVIEW` }) : record;
    }); },
    async begin(id: string, owner: string, workflow: SemanticWorkflow): Promise<JupiterBegin> { return locked(idCheck(id), async () => {
      if (!input.executionEnabled) throw new Error(runtime.realFunds ? `${X}_MAINNET_EXECUTION_NOT_ENABLED` : `${X}_EXECUTION_NOT_ENABLED`);
      const record = await load(id);
      if (record.authorization !== record.review.commitment) throw new Error(`${X}_REVIEW_REQUIRED`);
      if (record.attempt) throw new Error(`${X}_EXISTING_ATTEMPT_OBSERVE_ONLY`);
      const height = await blockHeight('confirmed');
      input.adapter.assertReview(record.review, workflow, solanaAddress(owner), height, now());
      await acquireOwnerLease(record.review.owner, id);
      const prepared = await save({ ...record, ...prepareSolanaSwapAttempt(record, height), error: null }); // Durable BEFORE the wallet is asked to sign.
      return { record: prepared, unsignedTransaction: record.review.unsignedTransaction, walletChain: runtime.walletChain };
    }); },
    /** The wallet never returned signed bytes: no transaction can exist. */
    async walletFailure(id: string, diagnostic: JupiterWalletDiagnostic): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (JSON.stringify(diagnostic).length > 16_384 || !new RegExp(`^${X}_[A-Z0-9_]{2,70}$`).test(diagnostic.code)) throw new Error(`${X}_DIAGNOSTIC_INVALID`);
      if (record.attempt && record.attempt.state !== 'PREPARED') throw new Error(`${X}_DIAGNOSTIC_NOT_PRE_SUBMISSION`);
      const cancelled = record.attempt ? solanaSwapTransition(record, 'CANCELLED') : record;
      return save({ ...record, ...cancelled, authorization: null, notSubmitted: Boolean(record.attempt), walletDiagnostic: diagnostic, error: diagnostic.code, submissionError: diagnostic.code });
    }); },
    /** Verify exact reviewed bytes and owner signature, persist the signature, then broadcast once. */
    async submit(id: string, signedTransaction: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt?.state !== 'PREPARED' || record.authorization !== record.review.commitment) throw new Error(`${X}_WALLET_HANDOFF_NOT_AUTHORIZED`);
      let signed: { signature: string; transaction: string };
      try {
        signed = input.adapter.verifySigned(record.review, signedTransaction);
        if (now() >= Date.parse(record.review.expiresAt) || await blockHeight('confirmed') >= record.review.lastValidBlockHeight) throw new Error(`${X}_QUOTE_STALE`);
      } catch (cause) {
        const failure = code(cause, `${X}_TRANSACTION_CHANGED`);
        // Gryloo never broadcasts modified, mis-signed or stale bytes; the reviewed blockhash bounds any copy's validity.
        return save({ ...record, ...solanaSwapTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, error: failure, submissionError: failure,
          walletDiagnostic: { stage: 'SIGN', code: failure, error: { message: failure } } });
      }
      const submitting = await save({ ...record, ...recordSolanaSwapSignature(record, signed), error: null });
      try {
        const result = await input.rpc('sendTransaction', [signed.transaction, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 10 }]);
        if (result !== signed.signature) throw new Error(`${X}_SUBMISSION_RESULT_MISMATCH`);
        return save({ ...submitting, ...solanaSwapTransition(submitting, 'PENDING') });
      } catch (cause) {
        // The signature is already durable. Observation by signature resolves this; there is never a second swap.
        return save({ ...submitting, ...solanaSwapTransition(submitting, 'SUBMISSION_RESULT_UNKNOWN'), error: `${X}_SUBMISSION_UNKNOWN_OBSERVE_EXISTING`,
          submissionError: code(cause, `${X}_RPC_SUBMISSION_FAILED`) });
      }
    }); },
    async observe(id: string): Promise<JupiterRecord> { return locked(idCheck(id), async () => {
      let record = await load(id);
      const attempt = record.attempt;
      if (!attempt || record.verdict !== 'PENDING') return record;
      if (attempt.state === 'PREPARED') {
        const diagnostic: JupiterWalletDiagnostic = { stage: 'SIGN', code: `${X}_WALLET_NOT_SUBMITTED`, error: { message: 'No signed transaction was returned before recovery.' } };
        return save({ ...record, ...solanaSwapTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, walletDiagnostic: diagnostic, error: diagnostic.code });
      }
      if (attempt.state === 'CANCELLED') return record;
      // Height before status: if finalized height is past validity and the signature is still unknown, it can never land.
      const finalizedHeight = await blockHeight('finalized');
      const observation = await reconcileSolanaSwapAttempt(record.review, attempt, input.rpc);
      const decision = solanaSwapObservationDecision(observation.found, finalizedHeight, record.review.lastValidBlockHeight);
      if (decision === 'WAIT') return save({ ...record, error: observation.reason === 'TRANSACTION_NOT_OBSERVED' ? `${X}_TRANSACTION_NOT_OBSERVED` : observation.reason });
      if (decision === 'EXPIRED') {
        let next: SolanaSwapRun = record;
        if (attempt.state === 'SUBMITTING') next = solanaSwapTransition(next, 'SUBMISSION_RESULT_UNKNOWN');
        next = solanaSwapTransition(next, next.attempt!.state === 'PENDING' ? 'EXPIRED' : 'NOT_FOUND');
        return save({ ...record, ...next, verdict: 'NOT_EXECUTED', authorization: null, error: `${X}_TRANSACTION_EXPIRED_NOT_EXECUTED` });
      }
      if (['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) record = { ...record, ...solanaSwapTransition(record, 'PENDING') };
      if (observation.verdict === 'INCONCLUSIVE') return save({ ...record, error: observation.reason });
      const reverted = observation.reason === `${X}_SWAP_FAILED`, reconciled = observation.verdict === 'RECONCILED';
      const state = reconciled ? 'CONFIRMED' : reverted ? 'REVERTED' : 'RECONCILIATION_REQUIRED';
      const next = { ...record, ...solanaSwapTransition(record, state, { reconciled }), observations: [...record.observations, observation],
        verdict: reconciled ? 'RECONCILED' as const : 'DIVERGENT' as const, error: reconciled ? null : observation.reason };
      return save(reconciled ? { ...next, evidence: buildSolanaSwapEvidence({ id: next.id, review: next.review, journal: next.journal, provenance: next.provenance,
        ownerInitiated: next.ownerInitiated, observation }) } : next);
    }); },
  };
}
export type JupiterService = ReturnType<typeof createSolanaSwapService>;
export type SolanaSwapService = JupiterService;

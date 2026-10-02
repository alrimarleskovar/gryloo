// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile, assertOrcaLiquidityReview, inspectOrcaPosition, readOrcaLiquidityPrice, simulateOrcaLiquidity,
  solanaAddress, verifySignedOrcaLiquidityTransaction, type OrcaLiquidityOperation, type SolanaRpc } from '@defi-workflow-engine/reference-compiler';
import { createOrcaLiquidityRun, orcaLiquidityAttemptResolved, orcaLiquidityTransition, prepareOrcaLiquidityAttempt, recordOrcaLiquiditySignature,
  solanaSwapObservationDecision, validateOrcaLiquidityRun, writeExtendingFile, ORCA_LIQUIDITY_ID, type OrcaLiquidityRun, type OrcaLiquidityProvenance } from '@defi-workflow-engine/reference-executor';
import { buildOrcaLiquidityEvidence, classifyOrcaLiquidityEvidence, reconcileOrcaLiquidityAttempt, type OrcaLiquidityEvidenceClass,
  type OrcaLiquidityObservation } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

/**
 * BUILD-015 Orca Whirlpools liquidity on Solana Devnet. Simulation and Review are read-only. Each lifecycle operation
 * (OPEN, DECREASE_PARTIAL, EXIT) is one reviewed transaction that needs the owner's Execute click and wallet signature;
 * OPEN also carries the client-side position-mint signature, whose secret never reaches this server.
 *
 * Durability: the run is persisted before the wallet is asked; the owner's position registry records the position mint
 * when an OPEN attempt is prepared (before any signature), so a restart always recovers the real position and never
 * creates a second one; the fully signed bytes are persisted before the single broadcast; ambiguous submissions are
 * only ever observed, never resubmitted.
 */
export type OrcaLiquidityWalletDiagnostic = { stage: 'CONNECT' | 'SIGN' | 'PREFLIGHT'; code: string; error: unknown };
export type OrcaLiquidityRecord = OrcaLiquidityRun & { observations: OrcaLiquidityObservation[]; evidence: ReturnType<typeof buildOrcaLiquidityEvidence> | null;
  error: string | null; evidenceClass: OrcaLiquidityEvidenceClass; notSubmitted?: boolean; submissionError?: string; walletDiagnostic?: OrcaLiquidityWalletDiagnostic };
export type OrcaPositionEntry = { positionMint: string; runs: { id: string; operation: OrcaLiquidityOperation; state: string | null; verdict: string; signature: string | null }[];
  status: 'OPEN_PENDING' | 'ACTIVE' | 'EMPTY' | 'CLOSED' | 'NOT_CREATED'; liquidity: string | null; tickLower: number | null; tickUpper: number | null;
  feeOwedA: string | null; feeOwedB: string | null; slot: number | null };
type RegistryLine = { positionMint: string; id: string; operation: OrcaLiquidityOperation };
const code = (cause: unknown, fallback: string) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : fallback;
const X = 'ORCA_LIQUIDITY';

export function createOrcaLiquidityService(input: { rpc: SolanaRpc; journalDir: string; provenance: OrcaLiquidityProvenance; executionEnabled: boolean; now?: () => number }) {
  if (!isAbsolute(input.journalDir) || input.journalDir.includes('/.git/')) throw new Error(`${X}_STORAGE_INVALID`);
  const now = input.now ?? Date.now;
  const idCheck = (id: string) => { if (typeof id !== 'string' || !ORCA_LIQUIDITY_ID.test(id)) throw new Error(`${X}_ID_INVALID`); return id; };
  const path = (id: string) => join(input.journalDir, idCheck(id) + '.jsonl');
  const registryPath = (owner: string) => join(input.journalDir, solanaAddress(owner) + '.orcalp-positions');
  const classify = (record: OrcaLiquidityRecord) => classifyOrcaLiquidityEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated,
    observation: record.observations.at(-1) ?? null });
  const validate = (bytes: Uint8Array) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || bytes.length > 33_554_432) throw new Error(`${X}_STORE_CORRUPT`);
    let prior: OrcaLiquidityRecord | null = null;
    for (const line of text.trimEnd().split('\n')) {
      const record = JSON.parse(line) as OrcaLiquidityRecord;
      validateOrcaLiquidityRun(record);
      if (record.provenance !== input.provenance || record.evidenceClass !== classify(record) ||
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
  const load = async (id: string): Promise<OrcaLiquidityRecord> => {
    const bytes = await readFile(path(id)); validate(bytes);
    return JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!) as OrcaLiquidityRecord;
  };
  const save = async (record: OrcaLiquidityRecord) => {
    const next = { ...record, evidenceClass: classify(record) };
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
  const readRegistry = async (owner: string): Promise<RegistryLine[]> => {
    let text = ''; try { text = await readFile(registryPath(owner), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return text.trimEnd().split('\n').filter(Boolean).map(line => {
      const value = JSON.parse(line) as RegistryLine;
      if (!ORCA_LIQUIDITY_ID.test(value.id) || !['OPEN', 'DECREASE_PARTIAL', 'EXIT'].includes(value.operation)) throw new Error(`${X}_STORE_CORRUPT`);
      solanaAddress(value.positionMint);
      return value;
    });
  };
  const appendRegistry = async (owner: string, line: RegistryLine) => {
    let prior = ''; try { prior = await readFile(registryPath(owner), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await writeExtendingFile(registryPath(owner), new TextEncoder().encode(prior + JSON.stringify(line) + '\n'), bytes => {
      const text = new TextDecoder().decode(bytes);
      if (!text.endsWith('\n')) throw new Error(`${X}_STORE_CORRUPT`);
      for (const l of text.trimEnd().split('\n')) { const v = JSON.parse(l) as RegistryLine; if (!ORCA_LIQUIDITY_ID.test(v.id)) throw new Error(`${X}_STORE_CORRUPT`); }
    });
  };
  /** One unresolved liquidity attempt per owner across runs, tabs and restarts. The lease history is append-only. */
  async function acquireOwnerLease(owner: string, id: string): Promise<void> {
    const lease = join(input.journalDir, owner + '.orcalp-lease');
    let prior = ''; try { prior = await readFile(lease, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const holder = prior.trimEnd().split('\n').filter(Boolean).at(-1);
    if (holder && holder !== id && !orcaLiquidityAttemptResolved(await load(holder))) throw new Error(`${X}_OWNER_ATTEMPT_IN_PROGRESS`);
    if (holder === id) throw new Error(`${X}_EXISTING_ATTEMPT_OBSERVE_ONLY`);
    await writeExtendingFile(lease, new TextEncoder().encode(prior + id + '\n'), bytes => {
      if (!new TextDecoder().decode(bytes).trimEnd().split('\n').every(line => ORCA_LIQUIDITY_ID.test(line))) throw new Error(`${X}_STORE_CORRUPT`);
    });
  }
  /** Every Gryloo-created position of this owner, with each operation's journal state and the position's current chain state. */
  async function positions(ownerInput: string): Promise<OrcaPositionEntry[]> {
    const owner = solanaAddress(ownerInput), lines = await readRegistry(owner);
    const mints = [...new Set(lines.map(l => l.positionMint))];
    const result: OrcaPositionEntry[] = [];
    for (const positionMint of mints) {
      const runs = await Promise.all(lines.filter(l => l.positionMint === positionMint).map(async l => {
        const r = await load(l.id);
        return { id: r.id, operation: r.operation, state: r.attempt?.state ?? null, verdict: r.verdict, signature: r.attempt?.signature ?? null, record: r };
      }));
      const chain = await inspectOrcaPosition(input.rpc, owner, positionMint);
      const open = runs.find(r => r.operation === 'OPEN');
      const pendingOpen = open && !orcaLiquidityAttemptResolved(open.record);
      const status: OrcaPositionEntry['status'] = chain.exists ? BigInt(chain.position.liquidity) > 0n ? 'ACTIVE' : 'EMPTY'
        : pendingOpen ? 'OPEN_PENDING' : runs.some(r => r.operation === 'EXIT' && r.verdict === 'RECONCILED') ? 'CLOSED' : 'NOT_CREATED';
      result.push({ positionMint, runs: runs.map(r => ({ id: r.id, operation: r.operation, state: r.state, verdict: r.verdict, signature: r.signature })), status, liquidity: chain.exists ? chain.position.liquidity : null,
        tickLower: chain.exists ? chain.position.tickLowerIndex : null, tickUpper: chain.exists ? chain.position.tickUpperIndex : null,
        feeOwedA: chain.exists ? chain.position.feeOwedA : null, feeOwedB: chain.exists ? chain.position.feeOwedB : null, slot: chain.slot });
    }
    return result;
  }
  const lifecycleOf = async (owner: string, positionMint: string) => ({ positionMint, operations: await Promise.all((await readRegistry(owner))
    .filter(l => l.positionMint === positionMint).map(async l => { const r = await load(l.id);
      return { id: r.id, operation: r.operation, verdict: r.verdict, state: r.attempt?.state ?? null, signature: r.attempt?.signature ?? null }; })) });
  return {
    load, positions, executionEnabled: input.executionEnabled,
    async price() { return readOrcaLiquidityPrice(input.rpc); },
    async inspect(owner: string, positionMint: string) { return inspectOrcaPosition(input.rpc, solanaAddress(owner), solanaAddress(positionMint)); },
    async simulate(workflowInput: unknown, ownerInput: string, request: { operation: OrcaLiquidityOperation; positionMint: string; partBps?: number }): Promise<OrcaLiquidityRecord> {
      const workflow = validateAuthoringWorkflow(workflowInput, createBaseSepoliaReviewContext());
      const owner = solanaAddress(ownerInput), positionMint = solanaAddress(request.positionMint);
      const known = await positions(owner);
      if (request.operation === 'OPEN') {
        // Recover the real position rather than create another: one Gryloo position per owner on this pool.
        if (known.some(p => p.status === 'OPEN_PENDING' || p.status === 'ACTIVE' || p.status === 'EMPTY')) throw new Error(`${X}_POSITION_ALREADY_OPEN`);
        if (known.some(p => p.positionMint === positionMint)) throw new Error('ORCA_POSITION_MINT_IN_USE');
      } else {
        const entry = known.find(p => p.positionMint === positionMint);
        if (!entry) throw new Error('ORCA_POSITION_UNKNOWN');
        if (entry.status === 'OPEN_PENDING') throw new Error(`${X}_OPEN_UNRESOLVED`);
        if (entry.status === 'CLOSED' || entry.status === 'NOT_CREATED') throw new Error('ORCA_POSITION_NOT_FOUND');
      }
      const review = await simulateOrcaLiquidity(workflow, owner, { operation: request.operation, positionMint, ...request.partBps === undefined ? {} : { partBps: request.partBps } },
        input.rpc, now());
      const id = 'orcalp-' + randomBytes(16).toString('hex');
      return save({ ...createOrcaLiquidityRun(id, review, input.provenance), observations: [], evidence: null, error: null, evidenceClass: 'PUBLIC_READ_ONLY' });
    },
    async review(id: string, commitment: string, workflow: SemanticWorkflow): Promise<OrcaLiquidityRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt || record.review.commitment !== commitment) throw new Error(`${X}_AUTHORIZATION_REPLACED`);
      assertOrcaLiquidityReview(record.review, workflow, record.review.owner, await blockHeight('confirmed'), now());
      return save({ ...record, authorization: commitment, error: null });
    }); },
    async invalidate(id: string): Promise<OrcaLiquidityRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      return record.authorization ? save({ ...record, authorization: null, error: `${X}_SEMANTIC_EDIT_REQUIRES_REVIEW` }) : record;
    }); },
    async begin(id: string, ownerInput: string, workflow: SemanticWorkflow) { return locked(idCheck(id), async () => {
      if (!input.executionEnabled) throw new Error(`${X}_EXECUTION_NOT_ENABLED`);
      const record = await load(id);
      if (record.authorization !== record.review.commitment) throw new Error(`${X}_REVIEW_REQUIRED`);
      if (record.attempt) throw new Error(`${X}_EXISTING_ATTEMPT_OBSERVE_ONLY`);
      const height = await blockHeight('confirmed');
      assertOrcaLiquidityReview(record.review, workflow, solanaAddress(ownerInput), height, now());
      return locked('owner-' + record.review.owner, async () => {
        // Re-checked under the owner lock: another reviewed OPEN may have created a position since this one was simulated.
        if (record.operation === 'OPEN' && (await positions(record.review.owner)).some(p => p.positionMint !== record.positionMint &&
            ['OPEN_PENDING', 'ACTIVE', 'EMPTY'].includes(p.status))) throw new Error(`${X}_POSITION_ALREADY_OPEN`);
        await acquireOwnerLease(record.review.owner, id);
        // Position identity is durable before any signature exists.
        await appendRegistry(record.review.owner, { positionMint: record.positionMint, id, operation: record.operation });
        const prepared = await save({ ...record, ...prepareOrcaLiquidityAttempt(record, height), error: null }); // Durable BEFORE the wallet is asked to sign.
        return { record: prepared, unsignedTransaction: record.review.unsignedTransaction, walletChain: profile.walletChain, signers: record.review.signers };
      });
    }); },
    /** The wallet (or the client-side position key) never produced complete signed bytes: no transaction can exist. */
    async walletFailure(id: string, diagnostic: OrcaLiquidityWalletDiagnostic): Promise<OrcaLiquidityRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (JSON.stringify(diagnostic).length > 16_384 || !new RegExp(`^${X}_[A-Z0-9_]{2,70}$`).test(diagnostic.code)) throw new Error(`${X}_DIAGNOSTIC_INVALID`);
      if (record.attempt && record.attempt.state !== 'PREPARED') throw new Error(`${X}_DIAGNOSTIC_NOT_PRE_SUBMISSION`);
      const cancelled = record.attempt ? orcaLiquidityTransition(record, 'CANCELLED') : record;
      return save({ ...record, ...cancelled, authorization: null, notSubmitted: Boolean(record.attempt), walletDiagnostic: diagnostic, error: diagnostic.code, submissionError: diagnostic.code });
    }); },
    /** Verify exact reviewed bytes and every reviewed signature, persist the signature and bytes, then broadcast once. */
    async submit(id: string, signedTransaction: string): Promise<OrcaLiquidityRecord> { return locked(idCheck(id), async () => {
      const record = await load(id);
      if (record.attempt?.state !== 'PREPARED' || record.authorization !== record.review.commitment) throw new Error(`${X}_WALLET_HANDOFF_NOT_AUTHORIZED`);
      let signed: { signature: string; transaction: string };
      try {
        signed = verifySignedOrcaLiquidityTransaction(record.review, signedTransaction);
        if (now() >= Date.parse(record.review.expiresAt) || await blockHeight('confirmed') >= record.review.lastValidBlockHeight) throw new Error(`${X}_REVIEW_STALE`);
      } catch (cause) {
        const failure = code(cause, `${X}_TRANSACTION_CHANGED`);
        // Gryloo never broadcasts modified, mis-signed or stale bytes; the reviewed blockhash bounds any copy's validity.
        return save({ ...record, ...orcaLiquidityTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, error: failure, submissionError: failure,
          walletDiagnostic: { stage: 'SIGN', code: failure, error: { message: failure } } });
      }
      const submitting = await save({ ...record, ...recordOrcaLiquiditySignature(record, signed), error: null });
      try {
        const result = await input.rpc('sendTransaction', [signed.transaction, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 10 }]);
        if (result !== signed.signature) throw new Error(`${X}_SUBMISSION_RESULT_MISMATCH`);
        return save({ ...submitting, ...orcaLiquidityTransition(submitting, 'PENDING') });
      } catch (cause) {
        // The signature is already durable. Observation by signature resolves this; there is never a second transaction.
        return save({ ...submitting, ...orcaLiquidityTransition(submitting, 'SUBMISSION_RESULT_UNKNOWN'), error: `${X}_SUBMISSION_UNKNOWN_OBSERVE_EXISTING`,
          submissionError: code(cause, `${X}_RPC_SUBMISSION_FAILED`) });
      }
    }); },
    async observe(id: string): Promise<OrcaLiquidityRecord> { return locked(idCheck(id), async () => {
      let record = await load(id);
      const attempt = record.attempt;
      if (!attempt || record.verdict !== 'PENDING') return record;
      if (attempt.state === 'PREPARED') {
        const diagnostic: OrcaLiquidityWalletDiagnostic = { stage: 'SIGN', code: `${X}_WALLET_NOT_SUBMITTED`, error: { message: 'No signed transaction was returned before recovery.' } };
        return save({ ...record, ...orcaLiquidityTransition(record, 'CANCELLED'), authorization: null, notSubmitted: true, walletDiagnostic: diagnostic, error: diagnostic.code });
      }
      if (attempt.state === 'CANCELLED') return record;
      // Height before status: if finalized height is past validity and the signature is still unknown, it can never land.
      const finalizedHeight = await blockHeight('finalized');
      const observation = await reconcileOrcaLiquidityAttempt(record.review, attempt, input.rpc);
      const decision = solanaSwapObservationDecision(observation.found, finalizedHeight, record.review.lastValidBlockHeight);
      if (decision === 'WAIT') return save({ ...record, error: observation.reason === 'TRANSACTION_NOT_OBSERVED' ? `${X}_TRANSACTION_NOT_OBSERVED` : observation.reason });
      if (decision === 'EXPIRED') {
        let next: OrcaLiquidityRun = record;
        if (attempt.state === 'SUBMITTING') next = orcaLiquidityTransition(next, 'SUBMISSION_RESULT_UNKNOWN');
        next = orcaLiquidityTransition(next, next.attempt!.state === 'PENDING' ? 'EXPIRED' : 'NOT_FOUND');
        return save({ ...record, ...next, verdict: 'NOT_EXECUTED', authorization: null, error: `${X}_TRANSACTION_EXPIRED_NOT_EXECUTED` });
      }
      if (['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) record = { ...record, ...orcaLiquidityTransition(record, 'PENDING') };
      if (observation.verdict === 'INCONCLUSIVE') return save({ ...record, error: observation.reason });
      const reconciled = observation.verdict === 'RECONCILED';
      const state = reconciled ? 'CONFIRMED' : observation.transactionFailed ? 'REVERTED' : 'RECONCILIATION_REQUIRED';
      const next = { ...record, ...orcaLiquidityTransition(record, state, { reconciled }), observations: [...record.observations, observation],
        verdict: reconciled ? 'RECONCILED' as const : 'DIVERGENT' as const, error: reconciled ? null : observation.reason };
      if (!reconciled) return save(next);
      const lifecycle = await lifecycleOf(record.review.owner, record.positionMint);
      return save({ ...next, evidence: buildOrcaLiquidityEvidence({ id: next.id, review: next.review, journal: next.journal, provenance: next.provenance,
        ownerInitiated: next.ownerInitiated, observation, lifecycle }) });
    }); },
    /** Restart recovery: every journal in the store, newest last (bounded). */
    async runIds(): Promise<string[]> {
      let names: string[] = []; try { names = await readdir(input.journalDir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      return names.filter(n => /^orcalp-[a-f0-9]{32}\.jsonl$/.test(n)).map(n => n.slice(0, -6)).slice(0, 512);
    },
  };
}
export type OrcaLiquidityService = ReturnType<typeof createOrcaLiquidityService>;

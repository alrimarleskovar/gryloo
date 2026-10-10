// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the delegated executor — one generic state machine for every workflow, run by the `delegation.execute` work item of a
 * DELEGATED occurrence (at-least-once delivery, fenced leases; every transition a compare-and-set, so duplicates and competing workers are
 * no-ops). No owner signature is requested at any point:
 *
 *   QUEUED → AUTHORITY_VERIFIED   the whole authority chain, before anything else: authorization ACTIVE at its signed revision; the workflow
 *                                 still the authorized one (a rebind or edit stops here); the Manifest re-validates against the re-composed
 *                                 workflow; the owner's ONE passkey assertion verifies over the exact envelope; every step resolves to its
 *                                 pinned grant; each grant's owner-signed enrollment anchors that same passkey; every grant re-verifies
 *                                 read-only on its chain (not disabled / not revoked / not expired)
 *   → RESERVED                    atomic budget reservation inside the authorization's row lock (`pg-store.reserve`)
 *   → RUNNING (step by step)      fresh simulation → deterministic policy check vs the Manifest → the grant's own scope check → sign →
 *                                 SUBMISSION_PREPARED committed (authorization and grant re-checked in that transaction) → broadcast → reconcile
 *   → SETTLED                     reservations become what reconciliation proved spent; evidence names the credential and grant of every step
 *
 * Failures: BLOCKED (nothing submitted; reservation released), HALTED (a later step could not proceed after an irreversible one; funds rest
 * in the owner's own account; attention), UNCERTAIN (outcome unknown; reservation kept), FAILED (reconciled failure). Recovery only re-reads
 * state, re-broadcasts the persisted bytes and reconciles; it never signs a second, different transaction for a step.
 */
import { erc7710, fromBase64, parseTransaction, verifyEd25519 } from '@defi-workflow-engine/reference-compiler';
import type { AutomationStore, OccurrenceRecord, RuleRecord } from '../automations/store.ts';
import { verifyAssertion } from '../passkeys/webauthn.ts';
import { ADAPTERS, delegationOf, passkeyAnchor } from './adapters.ts';
import { resolveAuthorityGraph, type StepBinding } from './authority.ts';
import { digestBytes } from './canonical.ts';
import type { ChainTransport } from './chains.ts';
import type { DelegationConfig } from './config.ts';
import { driverFor, type SignerUser, type StepContext, type StepDriver } from './drivers.ts';
import { authorizationDigest, credentialCommitments, executionSpend, manifestHash, manifestProblem, sameArtifact, type DelegatedAuthorizationManifest } from './manifest.ts';
import type { DelegationStore, ExecutionRecord, GrantRecord, RevisionRecord, StepRecord } from './pg-store.ts';
import { periodStarts, reservationViolation, stepPolicyViolation, type StepPlan } from './policy.ts';
import type { ExecutionState } from './state-machine.ts';
import { assetKey, workflowRequirement, type WorkflowRequirement } from './steps.ts';

export type ExecutorDeps = {
  readonly store: DelegationStore; readonly automations: Pick<AutomationStore, 'occurrenceById' | 'ruleById'>; readonly config: DelegationConfig;
  /** Executor transport (read + session-signed submission) of a chain, or null when the chain is not enabled here. */
  readonly transport: (chain: string) => ChainTransport | null;
  readonly signer: SignerUser; readonly now: () => Date; readonly newId: (prefix: 'dex') => string;
  readonly log: (event: string, fields: Readonly<Record<string, string | number | boolean | null>>) => void;
  readonly drivers?: readonly StepDriver[];
};
export type ExecutionOutcome = { readonly executionId: string | null; readonly state: ExecutionState | 'SKIPPED'; readonly code: string | null; readonly retryMs: number | null };
type Chain = { readonly requirement: WorkflowRequirement; readonly manifest: DelegatedAuthorizationManifest; readonly bindings: readonly StepBinding[];
  readonly grants: ReadonlyMap<string, GrantRecord> };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const codeOf = (cause: unknown, fallback: string) => cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback;
const PENDING_RETRY_MS = 15_000;
const bigintJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x: unknown) => typeof x === 'bigint' ? x.toString() : x)) as Record<string, unknown>;
const planOf = (stored: Readonly<Record<string, unknown>> | null): StepPlan | null => {
  if (!stored?.plan) return null;
  const p = stored.plan as Record<string, unknown>;
  const amounts = (xs: unknown) => (xs as { asset: string; amount: string }[]).map(x => ({ asset: x.asset, amount: BigInt(x.amount) }));
  return { ...(p as unknown as StepPlan), spend: amounts(p.spend), minimumReceive: amounts(p.minimumReceive), expectedReceive: amounts(p.expectedReceive) };
};

/** The whole authority chain of one execution (see the module comment). Read-only except grant re-verification bookkeeping. */
async function verifyAuthorityChain(deps: ExecutorDeps, rule: RuleRecord, occurrence: OccurrenceRecord, revision: RevisionRecord): Promise<{ ok: true; chain: Chain } | { ok: false; code: string }> {
  const now = deps.now(), m = revision.manifest;
  if (revision.state !== 'ACTIVE' || !revision.envelope || !revision.assertion || !revision.passkeyId) return { ok: false, code: 'AUTHORIZATION_NOT_ACTIVE' };
  if (!rule.binding || rule.binding.workflowHash !== revision.workflowHash || occurrence.workflowHash !== revision.workflowHash) return { ok: false, code: 'AUTHORIZATION_WORKFLOW_MISMATCH' };
  const req = workflowRequirement(occurrence.strategy, revision.workflowHash);
  if (!req.ok) return { ok: false, code: req.code === 'STRATEGY_WORKFLOW_HASH_MISMATCH' ? 'AUTHORIZATION_WORKFLOW_MISMATCH' : req.code };
  if (manifestHash(m) !== revision.manifestHash || m.revision !== revision.revision || m.authorizationId !== revision.authorizationId) return { ok: false, code: 'MANIFEST_INTEGRITY' };
  const problem = manifestProblem(m, req.value);
  if (problem) return { ok: false, code: problem };
  if (m.owner !== `${rule.owner.namespace}:${rule.owner.address}`) return { ok: false, code: 'AUTHORIZATION_OWNER_MISMATCH' };
  // The owner's ONE signature: the passkey assertion over the exact envelope, which commits to this manifest, environment and grants.
  const envelope = revision.envelope, digest = authorizationDigest(envelope);
  if (digest !== revision.envelopeDigest || envelope.manifestHash !== revision.manifestHash || envelope.workflowHash !== revision.workflowHash
    || envelope.environment.tenant !== deps.config.tenantId || envelope.environment.origin !== deps.config.passkeyOrigin || envelope.passkeyId !== revision.passkeyId
    || envelope.owner !== m.owner || !sameArtifact(envelope.credentials, credentialCommitments(m))) return { ok: false, code: 'AUTHORIZATION_ENVELOPE_MISMATCH' };
  const passkey = await deps.store.passkey(rule.owner, revision.passkeyId);
  if (!passkey || passkey.revokedAt) return { ok: false, code: 'PASSKEY_REVOKED' };
  try {
    verifyAssertion(revision.assertion as never, { challenge: digestBytes(digest), origin: deps.config.passkeyOrigin, rpId: passkey.rpId, credentialId: passkey.credentialId,
      publicKeySpki: passkey.publicKeySpki, signCount: 0 });
  } catch { return { ok: false, code: 'AUTHORIZATION_SIGNATURE_INVALID' }; }
  // Every step → its pinned grant; each grant must anchor the same passkey through the owner's own enrollment signature.
  const grants = new Map<string, GrantRecord>();
  for (const c of m.credentials) {
    const g = await deps.store.grantById(c.grantId);
    if (!g || g.owner.namespace !== rule.owner.namespace || g.owner.address !== rule.owner.address) return { ok: false, code: 'CREDENTIAL_NOT_FOUND' };
    if (g.commitment !== c.grantCommitment || g.walletAddress !== c.walletAddress) return { ok: false, code: 'GRANT_COMMITMENT_MISMATCH' };
    if (g.passkeyId !== passkey.passkeyId) return { ok: false, code: 'GRANT_PASSKEY_MISMATCH' };
    const anchor = passkeyAnchor({ owner: m.owner, grantId: g.grantId, chain: g.chain, walletAddress: g.walletAddress, passkeyId: passkey.passkeyId, publicKeySpki: passkey.publicKeySpki });
    if (!anchoredBy(g, anchor)) return { ok: false, code: 'GRANT_ANCHOR_MISMATCH' };
    grants.set(g.grantId, g);
  }
  const graph = resolveAuthorityGraph(req.value, [...grants.values()], deps.config.mode, now.getTime(), m.credentials);
  if (!graph.ok) return { ok: false, code: graph.failures[0]!.code };
  // Read-only on-chain re-verification of every grant before anything is reserved (external revocation, expiry, account change).
  for (const g of grants.values()) {
    const transport = deps.transport(g.chain);
    if (!transport) return { ok: false, code: 'DELEGATION_CHAIN_UNAVAILABLE' };
    const state = await ADAPTERS[g.mechanism].reconcileAuthorityState(g, transport, now);
    if (state.state !== 'ACTIVE') { await deps.store.reverify(g.grantId, state, now).catch(() => false); return { ok: false, code: `CREDENTIAL_${state.state}` }; }
  }
  return { ok: true, chain: { requirement: req.value, manifest: m, bindings: graph.bindings, grants } };
}
/** Whether the owner-signed enrollment of `g` commits to `anchor` (EVM: the signed delegation's salt; Solana: the signed memo). */
function anchoredBy(g: GrantRecord, anchor: string): boolean {
  try {
    if (g.mechanism === 'EVM_ERC7710_METAMASK_V1_3') {
      const d = delegationOf(g.grantPayload?.delegation);
      const chainId = Number(g.chain.slice('eip155:'.length));
      return d.salt === BigInt(anchor) && erc7710.recoverDigestSigner(erc7710.delegationDigest(chainId, d), d.signature) === g.walletAddress
        && erc7710.delegationHash(d) === g.commitment;
    }
    const message = fromBase64(g.enrollment.message, 1_232 * 2), wire = parseTransaction(fromBase64(g.grantPayload?.signedTransaction, 1_232 * 2));
    return g.enrollment.memo === `flofi:grant:v1:${anchor.slice(2)}` && Buffer.from(message).includes(Buffer.from(String(g.enrollment.memo)))
      && Buffer.compare(Buffer.from(wire.message), Buffer.from(message)) === 0 && verifyEd25519(wire.signatures[0]!, message, g.walletAddress);
  } catch { return false; }
}

/** Drives one DELEGATED occurrence as far as it can go now. Throws only for infrastructure failures (the work item retries). */
export async function executeOccurrence(deps: ExecutorDeps, occurrenceId: string, authorizationId: string): Promise<ExecutionOutcome> {
  const occurrence = await deps.automations.occurrenceById(occurrenceId);
  if (!occurrence || occurrence.state !== 'DELEGATED' || !occurrence.strategy) return { executionId: null, state: 'SKIPPED', code: 'OCCURRENCE_NOT_DELEGATED', retryMs: null };
  const rule = await deps.automations.ruleById(occurrence.ruleId);
  if (!rule || rule.executionMode !== 'DELEGATED_WITH_LIMITS' || rule.authorizationId !== authorizationId) return { executionId: null, state: 'SKIPPED', code: 'RULE_NOT_DELEGATED', retryMs: null };
  const authorization = await deps.store.authorizationById(authorizationId);
  if (!authorization) return { executionId: null, state: 'SKIPPED', code: 'AUTHORIZATION_NOT_FOUND', retryMs: null };
  const revisionNumber = authorization.activeRevision ?? authorization.latestRevision;
  const revision = await deps.store.revision(authorizationId, revisionNumber);
  if (!revision) return { executionId: null, state: 'SKIPPED', code: 'AUTHORIZATION_NOT_FOUND', retryMs: null };
  let e = await deps.store.ensureExecution({ executionId: deps.newId('dex'), authorizationId, revision: revisionNumber, owner: rule.owner, ruleId: rule.ruleId, occurrenceId,
    workflowHash: revision.workflowHash, manifestHash: revision.manifestHash, stepCount: revision.manifest.workflow.stepCount }, deps.now());
  const log = (event: string, extra: Readonly<Record<string, string | number | boolean | null>> = {}) => deps.log(event, { execution: e.executionId, state: e.state, ...extra });
  const move = async (to: ExecutionState, patch: Parameters<DelegationStore['transition']>[3] = {}): Promise<boolean> => {
    const next = await deps.store.transition(e.executionId, { version: e.version, from: [e.state] }, to, patch, deps.now());
    if (!next) { e = (await deps.store.executionById(e.executionId))!; return false; }
    e = next; log('delegation.execution_transition', { code: patch.code ?? null });
    return true;
  };
  const outcome = (retryMs: number | null = null): ExecutionOutcome => ({ executionId: e.executionId, state: e.state, code: e.code, retryMs });
  if (['SETTLED', 'BLOCKED', 'FAILED', 'HALTED'].includes(e.state)) return outcome();

  // Every pass re-establishes the authority chain (nothing is cached across passes or processes).
  const verified = await verifyAuthorityChain(deps, rule, occurrence, revision);
  if (e.state === 'QUEUED') {
    if (!verified.ok || revision.revision !== e.revision) { await move('BLOCKED', { code: verified.ok ? 'AUTHORIZATION_REVISION_CHANGED' : verified.code }); return outcome(); }
    if (!await move('AUTHORITY_VERIFIED')) return outcome(PENDING_RETRY_MS);
  }
  if (e.state === 'AUTHORITY_VERIFIED') {
    if (!verified.ok) { await move('BLOCKED', { code: verified.code }); return outcome(); }
    const chain = verified.chain, now = deps.now(), spend = executionSpend(chain.requirement);
    const starts = periodStarts(chain.manifest, now.getTime());
    const reserved = await deps.store.reserve({ executionId: e.executionId, expectedVersion: e.version, revision: e.revision, now,
      periods: { DAY: new Date(starts.DAY), WEEK: new Date(starts.WEEK), MONTH: new Date(starts.MONTH) },
      entries: chain.requirement.steps.flatMap(s => s.inputs.map(i => ({ stepIndex: s.index, asset: assetKey(i), amount: i.amount }))),
      steps: chain.bindings.map(b => ({ stepIndex: b.stepIndex, credentialId: b.credentialId, grantId: b.grantId, mechanism: b.mechanism, chain: b.chain,
        grantCommitment: b.grantCommitment })),
      check: usage => reservationViolation(chain.manifest, spend, usage, now.getTime()) });
    if (!reserved.ok) {
      e = (await deps.store.executionById(e.executionId))!;
      if (e.state === 'AUTHORITY_VERIFIED') await move('BLOCKED', { code: reserved.code });
      return outcome();
    }
    e = reserved.execution; log('delegation.reserved');
  }
  if (e.state === 'RESERVED') {
    if (!verified.ok) { await deps.store.settleBudget(e.executionId, [], Array.from({ length: e.stepCount }, (_, i) => i)); await move('BLOCKED', { code: verified.code }); return outcome(); }
    if (!await move('RUNNING', { currentStep: 0 })) return outcome(PENDING_RETRY_MS);
  }
  if (e.state === 'RUNNING' || e.state === 'UNCERTAIN') return run(deps, e, verified, move, outcome, log);
  return outcome();
}

async function run(deps: ExecutorDeps, start: ExecutionRecord, verified: Awaited<ReturnType<typeof verifyAuthorityChain>>,
  move: (to: ExecutionState, patch?: Parameters<DelegationStore['transition']>[3]) => Promise<boolean>, outcome: (retryMs?: number | null) => ExecutionOutcome,
  log: (event: string, extra?: Readonly<Record<string, string | number | boolean | null>>) => void): Promise<ExecutionOutcome> {
  let e = start;
  const current = async () => (e = (await deps.store.executionById(e.executionId))!);
  const steps = new Map((await deps.store.steps(e.executionId)).map(s => [s.stepIndex, s]));
  const release = (from: number) => deps.store.settleBudget(e.executionId, [], Array.from({ length: e.stepCount - from }, (_, i) => from + i));
  const anyIrreversible = (k: number) => [...steps.values()].some(s => s.stepIndex < k && s.state === 'RECONCILED');
  /** A step stopped before anything was submitted: BLOCKED when nothing irreversible happened yet, else HALTED with attention. */
  async function stopBefore(k: number, code: string): Promise<ExecutionOutcome> {
    await deps.store.stepTransition(e.executionId, k, ['PENDING', 'SIMULATED', 'POLICY_VERIFIED'], 'BLOCKED', { code });
    await release(k);
    await current();
    if (e.state === 'UNCERTAIN') return outcome(PENDING_RETRY_MS);
    await move(anyIrreversible(k) ? 'HALTED' : 'BLOCKED', { code, attention: anyIrreversible(k) });
    log('delegation.step_blocked', { step: k, code });
    return outcome();
  }
  for (let k = e.currentStep; k < e.stepCount; k++) {
    let step = steps.get(k);
    if (!step) return outcome(PENDING_RETRY_MS);
    const grant = await deps.store.grantById(step.grantId);
    const transport = grant ? deps.transport(grant.chain) : null;
    if (!grant || !transport) {
      if (['PENDING', 'SIMULATED', 'POLICY_VERIFIED'].includes(step.state)) return stopBefore(k, 'DELEGATION_CHAIN_UNAVAILABLE');
      return outcome(PENDING_RETRY_MS);
    }
    const binding = verified.ok ? verified.chain.bindings.find(b => b.stepIndex === k) : null;
    // Before anything new is submitted the whole chain must still verify (revocation, expiry, edits, external disable).
    if (['PENDING', 'SIMULATED', 'POLICY_VERIFIED'].includes(step.state)) {
      if (!verified.ok || !binding) return stopBefore(k, verified.ok ? 'STEP_BINDING_MISSING' : verified.code);
      const ctx: StepContext = { step: verified.chain.requirement.steps[k]!, binding, grant, transport, now: deps.now };
      const driver = driverFor(ctx, deps.config.mode);
      if (!driver || (deps.drivers && !deps.drivers.includes(driver))) return stopBefore(k, 'DELEGATED_STEP_DRIVER_UNAVAILABLE');
      let simulated: Awaited<ReturnType<StepDriver['simulate']>>;
      try { simulated = await driver.simulate(ctx); } catch (cause) { return stopBefore(k, codeOf(cause, 'SIMULATION_FAILED')); }
      const stored = bigintJson({ plan: simulated.plan, prepared: simulated.prepared, driver: driver.id });
      const sim = await deps.store.stepTransition(e.executionId, k, ['PENDING', 'SIMULATED', 'POLICY_VERIFIED'], 'SIMULATED', { plan: stored });
      if (!sim) return outcome(PENDING_RETRY_MS);
      const violation = stepPolicyViolation(verified.chain.manifest, ctx.step, binding, simulated.plan, deps.now().getTime())
        ?? await driver.authorize(ctx, simulated.prepared).catch(cause => codeOf(cause, 'GRANT_SCOPE_EXCEEDED'));
      if (violation) return stopBefore(k, violation);
      if (!await deps.store.stepTransition(e.executionId, k, ['SIMULATED'], 'POLICY_VERIFIED', {})) return outcome(PENDING_RETRY_MS);
      let signed: Awaited<ReturnType<StepDriver['sign']>>;
      try { signed = await driver.sign(ctx, simulated.prepared, deps.signer); } catch (cause) { return stopBefore(k, codeOf(cause, 'SIGNING_FAILED')); }
      const prepared = await deps.store.prepareSubmission(e.executionId, k, bigintJson({ ...signed.submission, driver: driver.id }), { calls: signed.calls, nextNonce: signed.nextNonce },
        deps.now());
      if (!prepared.ok) return stopBefore(k, prepared.code);
      step = prepared.step;
      log('delegation.submission_prepared', { step: k });
    }
    const ctx: StepContext | null = binding && verified.ok ? { step: verified.chain.requirement.steps[k]!, binding, grant, transport, now: deps.now } : null;
    // After a submission is prepared, recovery needs only the persisted plan and submission (authority changes can no longer undo it).
    const recoveryCtx = ctx ?? recoveryContext(step, grant, transport, deps);
    const driver = recoveryCtx ? driverFor(recoveryCtx, deps.config.mode) : null;
    if (!recoveryCtx || !driver) { await deps.store.stepTransition(e.executionId, k, ['SUBMISSION_PREPARED', 'SUBMITTED'], 'UNCERTAIN', { code: 'RECOVERY_CONTEXT_UNAVAILABLE' }); await enterUncertain(); return outcome(PENDING_RETRY_MS); }
    if (step.state === 'SUBMISSION_PREPARED') {
      let broadcastFailure: unknown = null;
      try { await driver.broadcast(recoveryCtx, step.submission!); } catch (cause) { broadcastFailure = cause; }
      if (broadcastFailure !== null) {
        await deps.store.stepTransition(e.executionId, k, ['SUBMISSION_PREPARED'], 'UNCERTAIN', { code: codeOf(broadcastFailure, 'SUBMISSION_BROADCAST_FAILED') });
        await enterUncertain(); return outcome(PENDING_RETRY_MS);
      }
      const submitted = await deps.store.stepTransition(e.executionId, k, ['SUBMISSION_PREPARED'], 'SUBMITTED', {});
      if (!submitted) return outcome(PENDING_RETRY_MS);
      step = submitted;
    }
    if (step.state === 'SUBMITTED' || step.state === 'UNCERTAIN') {
      const plan = (step.plan?.prepared ?? {}) as Record<string, unknown>;
      let r: Awaited<ReturnType<StepDriver['reconcile']>>;
      try { r = await driver.reconcile(recoveryCtx, step.submission!, plan); }
      catch (cause) {
        await deps.store.stepTransition(e.executionId, k, ['SUBMITTED'], 'UNCERTAIN', { code: codeOf(cause, 'RECONCILIATION_FAILED') });
        await enterUncertain(true); return outcome(PENDING_RETRY_MS);
      }
      if (r.status === 'PENDING') {
        // Not final yet (or dropped by a node): re-broadcast exactly the persisted bytes — idempotent, never a new transaction — and keep
        // the reservation until reconciliation decides.
        await driver.broadcast(recoveryCtx, step.submission!).catch(() => undefined);
        return outcome(PENDING_RETRY_MS);
      }
      const reconciliation = bigintJson({ status: r.status, spent: r.spent, received: r.received, evidence: r.evidence });
      if (r.status === 'REVERTED') {
        await deps.store.stepTransition(e.executionId, k, ['SUBMITTED', 'UNCERTAIN'], 'REVERTED', { reconciliation, code: 'SUBMISSION_REVERTED' });
        await deps.store.settleBudget(e.executionId, r.spent.map(s => ({ stepIndex: k, asset: s.asset, amount: s.amount })).filter(s => s.amount > 0n),
          Array.from({ length: e.stepCount - k }, (_, i) => k + i));
        await settleEarlier(k);
        await current();
        if (e.state === 'UNCERTAIN') await move('RUNNING');
        await move(anyIrreversible(k) ? 'HALTED' : 'FAILED', { code: 'SUBMISSION_REVERTED', attention: anyIrreversible(k), evidence: await evidenceOf() });
        return outcome();
      }
      const reconciled = await deps.store.stepTransition(e.executionId, k, ['SUBMITTED', 'UNCERTAIN'], 'RECONCILED', { reconciliation });
      if (!reconciled) return outcome(PENDING_RETRY_MS);
      steps.set(k, reconciled);
      log('delegation.step_reconciled', { step: k });
      await current();
      if (e.state === 'UNCERTAIN') await move('RUNNING');
      if (k + 1 < e.stepCount) await move('RUNNING', { currentStep: k + 1 });
    }
  }
  // Every step reconciled: settle what was proved spent, release nothing that might have been spent.
  const all = await deps.store.steps(e.executionId);
  if (all.length !== e.stepCount || all.some(s => s.state !== 'RECONCILED')) return outcome(PENDING_RETRY_MS);
  await settleEarlier(e.stepCount);
  await current();
  if (e.state === 'UNCERTAIN') await move('RUNNING');
  await move('SETTLED', { settled: true, evidence: await evidenceOf() });
  log('delegation.settled');
  return outcome();

  async function enterUncertain(attention = false) { await current(); if (e.state === 'RUNNING') await move('UNCERTAIN', { code: 'SUBMISSION_UNCERTAIN', attention }); }
  /** Reconciled steps before `k`: their reservations become exactly what reconciliation proved spent (zero → released). */
  async function settleEarlier(k: number) {
    const reconciled = (await deps.store.steps(e.executionId)).filter(s => s.stepIndex < k && s.state === 'RECONCILED');
    const spent = reconciled.flatMap(s => ((s.reconciliation?.spent ?? []) as { asset: string; amount: string }[]).map(x => ({ stepIndex: s.stepIndex, asset: x.asset, amount: BigInt(x.amount) })));
    const entries = await deps.store.budget(e.authorizationId, e.executionId);
    const zero = entries.filter(x => x.state === 'RESERVED' && x.stepIndex < k && !spent.some(s => s.stepIndex === x.stepIndex && s.asset === x.asset && s.amount > 0n));
    await deps.store.settleBudget(e.executionId, spent.filter(s => s.amount > 0n), [...new Set(zero.map(x => x.stepIndex))]);
  }
  async function evidenceOf(): Promise<Record<string, unknown>> {
    const list = await deps.store.steps(e.executionId);
    const provenance = new Set(list.map(s => String((s.reconciliation?.evidence as { provenance?: string } | undefined)?.provenance ?? 'UNKNOWN')));
    return { kind: 'flofi.delegated-execution-evidence', version: 1, executionId: e.executionId, authorizationId: e.authorizationId, revision: e.revision,
      workflowHash: e.workflowHash, manifestHash: e.manifestHash,
      // Never above the weakest transport: one MOCKED step makes the whole execution MOCKED evidence.
      evidenceLevel: provenance.has('MOCKED') || provenance.has('UNKNOWN') ? 'MOCKED' : 'PUBLIC_UNVERIFIED',
      steps: list.map(s => ({ step: s.stepIndex, state: s.state, credentialId: s.credentialId, grantId: s.grantId, mechanism: s.mechanism, chain: s.chain,
        grantCommitment: s.grantCommitment, driver: s.plan?.driver ?? null, submissions: (s.submission?.hashes ?? []) as unknown[],
        spent: s.reconciliation?.spent ?? [], received: s.reconciliation?.received ?? [], provenance: (s.reconciliation?.evidence as { provenance?: string } | undefined)?.provenance ?? null })) };
  }
}
/** The context to finish a step whose submission was already prepared, from persisted facts only. */
function recoveryContext(step: StepRecord, grant: GrantRecord, transport: ChainTransport, deps: ExecutorDeps): StepContext | null {
  const stored = step.plan, plan = planOf(stored);
  if (!stored || !plan) return null;
  const prepared = stored.prepared as Record<string, unknown> | undefined;
  const scope = grant.scope;
  let need: StepBinding['need'];
  if (scope.mechanism === 'EVM_ERC7710_METAMASK_V1_3') {
    const calls = (prepared?.calls ?? []) as { target: string; data: string }[];
    const swap = calls.find(c => c.data.startsWith(erc7710.EXACT_INPUT_SINGLE_METHOD));
    if (!swap) return null;
    const words = swap.data.slice(10);
    need = { kind: 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE', router: swap.target, tokenIn: '0x' + words.slice(24, 64), tokenOut: '0x' + words.slice(88, 128),
      amountIn: BigInt('0x' + words.slice(256, 320)) };
  } else {
    const mint = plan.spend[0]?.asset.split('/token:')[1];
    if (!mint) return null;
    const account = scope.accounts.find(a => a.mint === mint);
    need = { kind: 'SOLANA_SPL_SPEND', mint, decimals: account?.decimals ?? 0, amount: plan.spend[0]!.amount, programs: plan.targets.filter(t => t !== mint) };
  }
  const output = plan.minimumReceive[0]?.asset.split(/\/(?:erc20|token):/)[1] ?? '';
  return { grant, transport, now: deps.now,
    binding: { stepIndex: step.stepIndex, credentialId: step.credentialId, grantId: step.grantId, mechanism: step.mechanism, chain: step.chain,
      walletAddress: grant.walletAddress, grantCommitment: step.grantCommitment, need },
    step: { index: step.stepIndex, chain: step.chain, outputs: [{ chain: step.chain, address: output, decimals: 0, symbol: '' }], slippageBps: plan.slippageBps,
      adapterId: plan.adapterId } as unknown as StepContext['step'] };
}

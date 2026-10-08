// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the trusted approval handoff service — the bridge from any requester (an MCP chat today; the Developer API
 * and channels later) to the owner's own wallet in FloFi. Moved from BUILD-MCP-002's `src/mcp/handoff/service.ts` (which now
 * re-exports this module) behind a requester-neutral boundary; MCP's behaviour is unchanged. Each surface brings its own requester,
 * approval-link scheme (`approval-links.ts`) and rules; the handoff model, its persistence and `/approve` (`approve.ts`) are shared.
 *
 *   requestApproval  re-compose the strategy, require the same workflow hash, evaluate the four facts, refuse review blockers,
 *                    rate-limit, store a PENDING handoff and return an approval object with authority NONE and a FloFi URL whose
 *                    fragment carries the secret
 *   /approve         (FloFi origin) shows the external proposal; after the owner proves a wallet, everything is re-verified and
 *                    the re-composed authoring command enters FloFi's existing proposal flow
 *
 * Nothing here holds or derives a key, builds a transaction, signs, submits or authorizes. The owner still runs a fresh
 * simulation, reviews the Strategy Manifest, approves explicitly and signs with their own wallet in the existing flow panels.
 */
import type { Command } from '../domain/commands';
import type { Workflow } from '../domain/initial-workflow';
import { composeWorkflow, composeWorkflowBound, semanticWorkflowHash, type Composition, type WorkflowComposition } from '../engine/strategy-engine';
import { ENGINE_VERSION, evaluateWorkflowGates, handoffFindings, type ExecutionPlan, type Gates, type HandoffPolicy, type PlanStep } from '../mcp/execution.ts';
import { assertSafeOutput } from '../mcp/simulation.ts';
import { newId } from '../mcp/oauth/crypto.ts';
import type { McpRuntime as EngineRuntime } from '../mcp/runtime.ts';
import { mintApprovalSecret, type ApprovalLinkScheme } from './approval-links.ts';
import { REQUESTER_REF, type ApprovalRequesterKind, type HandoffRecord, type HandoffStore, type RequesterScope, type WalletRef } from './handoff-store.ts';
import { refuse } from './refusal.ts';

export const HANDOFF_SECONDS = 900;
export const CLAIM_SECONDS = 600;
export const APPROVAL_SESSION_SECONDS = 300;
export const MAX_PENDING_HANDOFFS = 5;
export const HANDOFF_RATE: readonly [number, number] = Object.freeze([20, 3_600]);
export const APPROVAL_REQUIRES = Object.freeze(['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'] as const);
export const AUTHORITY_NONE = 'NONE' as const;

/**
 * Who asks for the owner's approval. A requester is never an owner and never authority: it only scopes the handoff (who may read its
 * status, open approval sessions for it or withdraw it) and names its origin on /approve. One model for every kind:
 *   MCP_ACCOUNT           an OAuth grant of a pseudonymous FloFi account (BUILD-MCP-002); `ref` is the account id
 *   DEVELOPER_PROJECT     a developer project (BUILD-DEVELOPER-001, not yet served)
 *   CHANNEL_CONVERSATION  a conversation on a messaging channel (BUILD-CHANNELS-001, not yet served)
 * `context` holds immutable, non-secret facts the kind's claim policy needs on /approve (e.g. an intended wallet); MCP has none.
 */
export type ApprovalRequester =
  | { readonly kind: 'MCP_ACCOUNT'; readonly ref: string; readonly grantId: string; readonly clientId: string; readonly displayName: string }
  | { readonly kind: Exclude<ApprovalRequesterKind, 'MCP_ACCOUNT'>; readonly ref: string; readonly clientId: string; readonly displayName: string;
      readonly context?: Readonly<Record<string, unknown>> };
export const requesterScope = (requester: ApprovalRequester): RequesterScope => ({ kind: requester.kind, ref: requester.ref });
/** A fixed-window abuse limit: true while `bucket` stays within `limit` per `windowSeconds`. */
export type WindowLimit = (bucket: string, limit: number, windowSeconds: number, now: Date) => Promise<boolean>;
/** One surface's handoff rules: how long a request waits, how many may be open, how many per window, and whether a newer request
 * for the same workflow supersedes the older one. */
export type HandoffRules = { readonly handoffSeconds: number; readonly maxPending: number; readonly rate: readonly [number, number];
  readonly supersedeSameWorkflow: boolean };
/**
 * What the approval service needs from its host surface: the FloFi origin approval URLs point to, the surface's approval-link scheme
 * (its key digests secrets; the secret is never stored), the durable handoff store, the abuse limiter, the deployment runtime, the
 * surface's handoff policy and rules, and the clock.
 */
export type ApprovalDeps = { readonly origin: string; readonly scheme: ApprovalLinkScheme; readonly handoffs: HandoffStore; readonly allow: WindowLimit;
  readonly runtime: EngineRuntime; readonly policy: HandoffPolicy; readonly rules: HandoffRules; readonly now: Date };
export type Failure = { readonly ok: false; readonly code: string; readonly extra?: Readonly<Record<string, unknown>> };
export const approvalUrl = (origin: string, secret: string) => `${origin}/approve#${secret}`;
/** The wallet namespace whose proof a plan needs (every network of one workflow is one namespace today). */
export const planNamespace = (plan: Pick<ExecutionPlan, 'networks'>): WalletRef['namespace'] => plan.networks.every(n => n.startsWith('solana')) ? 'solana' : 'eip155';
const stepView = (s: PlanStep) => ({ index: s.index, action: s.action, network: s.network, destinationNetwork: s.destinationNetwork, kind: s.kind, protocol: s.protocol,
  fundsClass: s.fundsClass, environment: s.environment, flow: s.flow, stepWorkflowHash: s.workflowHash });
const gateView = (g: Gates) => ({ supportedByCode: g.supportedByCode, enabledByDeployment: g.enabledByDeployment, enabledByPolicy: g.enabledByPolicy,
  demonstratedEvidence: g.demonstratedEvidence });
/** Abuse-limit buckets are named per requester (an MCP account's bucket keeps its BUILD-MCP-002 name). */
const BUCKET_SEGMENT: Readonly<Record<ApprovalRequesterKind, string>> = Object.freeze({ MCP_ACCOUNT: 'account', DEVELOPER_PROJECT: 'project', CHANNEL_CONVERSATION: 'conversation' });
const requestBucket = (requester: ApprovalRequester) => `handoff:${BUCKET_SEGMENT[requester.kind]}:${requester.ref}`;
/** A requester the store can persist: a well-formed ref and names, and a small, non-secret context (MCP: none). */
function requesterValid(requester: ApprovalRequester): boolean {
  const context = requester.kind === 'MCP_ACCOUNT' ? {} : requester.context ?? {};
  if (!REQUESTER_REF.test(requester.ref) || requester.clientId.length < 8 || requester.clientId.length > 512 || requester.displayName.length < 1
    || requester.displayName.length > 128 || !context || typeof context !== 'object' || Array.isArray(context)) return false;
  try { assertSafeOutput(context); return Buffer.byteLength(JSON.stringify(context), 'utf8') <= 4_096; } catch { return false; }
}

/**
 * A PENDING handoff for this requester, or a classified refusal: the composition's code (with issues), a gate reason (with every
 * gate fact), `REVIEW_BLOCKED`, `HANDOFF_RATE_LIMITED` or `HANDOFF_PENDING_LIMIT`.
 */
export async function requestApproval(deps: ApprovalDeps, requester: ApprovalRequester, strategy: unknown, workflowHash: string) {
  // A surface may only mint links for the requester kinds its scheme serves, for a requester the store can persist.
  if (!deps.scheme.kinds.includes(requester.kind) || !requesterValid(requester)) return { ok: false, code: 'APPROVAL_REQUESTER_INVALID' } satisfies Failure;
  const workflow = composeWorkflowBound(strategy, workflowHash);
  if (!workflow.ok) return { ok: false, code: workflow.code, extra: { issues: workflow.issues } } satisfies Failure;
  // A general sequence of steps is refused here (MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED) with every step's facts reported.
  const gates = await evaluateWorkflowGates(workflow, deps.runtime, deps.policy);
  if (!gates.handoff.allowed) return { ok: false, code: gates.handoff.reason!, extra: { gates: gateView(gates), executionPlan: gates.plan.kind, steps: gates.plan.steps.map(stepView) } } satisfies Failure;
  const composition = workflow.steps[0]!;
  const { blockers, preExecution } = handoffFindings(composition);
  if (blockers.length) return { ok: false, code: 'REVIEW_BLOCKED', extra: { blockers: blockers.map(b => ({ code: b.code, message: b.message })) } } satisfies Failure;
  if (!await deps.allow(requestBucket(requester), deps.rules.rate[0], deps.rules.rate[1], deps.now)) return { ok: false, code: 'HANDOFF_RATE_LIMITED' } satisfies Failure;
  // Bounded retention, opportunistically (handoffs older than 30 days).
  if (Math.random() < 0.02) await deps.handoffs.purge(deps.now).catch(() => undefined);
  const { secret, digest } = mintApprovalSecret(deps.scheme), handoffId = newId('apr'), expiresAt = new Date(deps.now.getTime() + deps.rules.handoffSeconds * 1000);
  const created = await deps.handoffs.create({ handoffId, requester: requesterScope(requester), grantId: requester.kind === 'MCP_ACCOUNT' ? requester.grantId : null,
    requesterContext: requester.kind === 'MCP_ACCOUNT' ? {} : requester.context ?? {}, clientId: requester.clientId, clientName: requester.displayName,
    secretDigest: digest, strategy: composition.strategy, workflowHash: composition.workflowHash, engineVersion: ENGINE_VERSION,
    networkEnvironment: gates.plan.networkEnvironment, fundsClass: gates.plan.fundsClass, plan: gates.plan, expiresAt },
  deps.now, { maxPending: deps.rules.maxPending, supersedeSameWorkflow: deps.rules.supersedeSameWorkflow });
  if (!created.ok) return { ok: false, code: created.code } satisfies Failure;
  return { ok: true as const, value: { approvalId: handoffId, approvalUrl: approvalUrl(deps.origin, secret), workflowHash: composition.workflowHash,
    expiresAt: expiresAt.toISOString(), status: 'PENDING', networkEnvironment: gates.plan.networkEnvironment, fundsClass: gates.plan.fundsClass,
    executionPlan: gates.plan.kind, steps: gates.plan.steps.map(stepView), authority: AUTHORITY_NONE, requires: [...APPROVAL_REQUIRES],
    walletNamespace: planNamespace(gates.plan), gates: gateView(gates), summary: composition.summary,
    // What FloFi's flow still requires of the owner before anything can be signed (cleared by the fresh simulation and Review).
    preExecution } };
}

/** One of this requester's handoffs (never another requester's), with lazy expiry, or `APPROVAL_NOT_FOUND`. */
export async function approvalForRequester(handoffs: HandoffStore, requester: ApprovalRequester, approvalId: string, now: Date): Promise<HandoffRecord> {
  return await handoffs.forRequester(approvalId, requesterScope(requester), now) ?? refuse('APPROVAL_NOT_FOUND');
}

/** Mobile wallets open FloFi in their own in-app browser, where their provider is injected. The fragment stays inside the encoded URL. */
export function walletDeepLinks(url: string, origin: string) {
  return { phantom: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
    metamask: `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}` };
}
/**
 * A fresh, short-lived FloFi link for one of this requester's open handoffs (for the signing window or a wallet in-app browser). It
 * replaces the previous session secret and only shows the proposal; it authorizes nothing. Refusals: `APPROVAL_NOT_FOUND`,
 * `APPROVAL_<STATUS>` for a handoff that is no longer PENDING or CLAIMED.
 */
export async function openApprovalSession(deps: Pick<ApprovalDeps, 'origin' | 'scheme' | 'handoffs'>, requester: ApprovalRequester, approvalId: string) {
  if (!deps.scheme.kinds.includes(requester.kind)) return refuse('APPROVAL_NOT_FOUND');
  const { secret, digest } = mintApprovalSecret(deps.scheme), expiresAt = new Date(Date.now() + APPROVAL_SESSION_SECONDS * 1000);
  const h = await deps.handoffs.openSession(approvalId, requesterScope(requester), digest, expiresAt, new Date());
  if (!h) return refuse('APPROVAL_NOT_FOUND');
  if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return refuse(`APPROVAL_${h.status}`);
  const url = approvalUrl(deps.origin, secret);
  return { approvalId: h.handoffId, approvalUrl: url, expiresAt: expiresAt.toISOString(), authority: AUTHORITY_NONE, walletLinks: walletDeepLinks(url, deps.origin) };
}

/** What a handoff looks like to the requester that created it (never the wallet that claimed it unless the owner shares). */
export function approvalStatus(h: HandoffRecord) {
  return { approvalId: h.handoffId, status: h.status, workflowHash: h.workflowHash, expiresAt: h.expiresAt.toISOString(), networkEnvironment: h.networkEnvironment,
    fundsClass: h.fundsClass, executionPlan: h.plan.kind, steps: h.plan.steps.map(stepView), claimed: h.claimed !== null, applied: h.appliedAt !== null,
    statusShared: h.shareStatus, authority: AUTHORITY_NONE };
}

export type Verified = { readonly ok: true; readonly composition: Composition; readonly workflow: WorkflowComposition; readonly gates: Gates & { readonly plan: ExecutionPlan } }
  | Failure & { readonly stale?: boolean };
/**
 * Re-verifies a stored proposal now: it must still compose to the same workflow hash with the current engine (otherwise it is
 * STALE), and the deployment and policy must still allow handing it to its owner.
 */
export async function verifyHandoff(h: HandoffRecord, runtime: EngineRuntime, policy: HandoffPolicy): Promise<Verified> {
  const workflow = composeWorkflow(h.strategy);
  if (!workflow.ok || workflow.workflowHash !== h.workflowHash) return { ok: false, code: 'HANDOFF_STALE', stale: true };
  const gates = await evaluateWorkflowGates(workflow, runtime, policy);
  if (!gates.handoff.allowed) return { ok: false, code: gates.handoff.reason! };
  return { ok: true, composition: workflow.steps[0]!, workflow, gates };
}

/**
 * Who is looking at /approve: the wallets this browser proved, and the requester this browser itself is, if any (an MCP account's own
 * browser, from its account cookie). `accountId` is the BUILD-MCP-002 form of an MCP-account viewer.
 */
export type ApprovalViewer = { readonly wallets: readonly WalletRef[]; readonly requester?: RequesterScope | null; readonly accountId?: string | null };
const viewerScope = (viewer: ApprovalViewer): RequesterScope | null =>
  viewer.requester ?? (viewer.accountId ? { kind: 'MCP_ACCOUNT', ref: viewer.accountId } : null);
/** The public view of a handoff on /approve, for whoever holds its secret. Never a key, a transaction, calldata or the requester's context. */
export function approvalView(h: HandoffRecord, verified: Verified | null, viewer: ApprovalViewer) {
  const claimedByViewer = h.claimed !== null && viewer.wallets.some(w => w.namespace === h.claimed!.namespace && w.address === h.claimed!.address);
  const own = viewerScope(viewer), sameRequester = own !== null && own.kind === h.requesterKind && own.ref === h.requesterRef;
  return { approvalId: h.handoffId, status: h.status, clientName: h.clientName, requesterKind: h.requesterKind, external: true, createdAt: h.createdAt.toISOString(),
    expiresAt: h.expiresAt.toISOString(),
    networkEnvironment: h.networkEnvironment, fundsClass: h.fundsClass, workflowHash: h.workflowHash, executionPlan: h.plan.kind, steps: h.plan.steps.map(stepView),
    walletNamespace: planNamespace(h.plan), summary: verified?.ok ? verified.composition.summary : null, explanation: verified?.ok ? verified.composition.explanation : [],
    notes: verified?.ok ? verified.composition.notes : [], gates: verified?.ok ? gateView(verified.gates) : null, refusal: verified && !verified.ok ? verified.code : null,
    claimedByYou: claimedByViewer, claimedByAnotherWallet: h.claimed !== null && !claimedByViewer, sameAccount: sameRequester,
    statusShared: h.shareStatus, authorized: false, authority: AUTHORITY_NONE, requires: [...APPROVAL_REQUIRES] };
}
export type ApprovalView = ReturnType<typeof approvalView>;
/** `workflowId` is the identity of the draft the proposal was composed on; the claimant's pristine draft adopts it so the hash can match. */
export type ClaimedProposal = { readonly view: ApprovalView; readonly command: Command; readonly workflowHash: string; readonly workflowId: string };

/** The workflow a flow record reviewed, wherever the flow keeps it (review, workflow, or the first of several reviews). */
function reviewedWorkflows(record: unknown): unknown[] {
  const r = record && typeof record === 'object' ? record as { review?: { workflow?: unknown }; workflow?: unknown; reviews?: { workflow?: unknown }[] } : {};
  return [r.review?.workflow, r.workflow, Array.isArray(r.reviews) ? r.reviews[0]?.workflow : undefined].filter(w => w && typeof w === 'object');
}
export type RunProgress = { readonly executionId: string; readonly flow: string; readonly status: string; readonly reconciled: boolean; readonly terminal: boolean;
  readonly errorCode: string | null; readonly evidenceEnvironment: string | null; readonly evidenceOutcome: string | null; readonly evidenceBundleHash: string | null;
  readonly updatedAt: string };
/**
 * The runs started from an APPLIED handoff whose owner chose to share them: runs of the claimant wallet, on the plan's flow, created
 * after the claim, whose reviewed workflow hashes EXACTLY to the handoff's workflow hash (an edited strategy is not this proposal).
 * Everything is read server-side as the owner; only public facts leave (ids, states, evidence environment and bundle hash).
 */
export async function sharedRuns(h: HandoffRecord, runtime: EngineRuntime, handoffs: HandoffStore): Promise<readonly RunProgress[] | null> {
  if (h.status !== 'APPLIED' || !h.shareStatus || !h.claimed || !h.claimedAt || !h.plan.flow || !runtime.runs || !runtime.record) return null;
  const flow = h.plan.flow, owner = h.claimed.address, listed = await runtime.runs(flow, owner);
  if (!listed.ok) return [];
  const candidates = listed.value.filter(r => Date.parse(r.updatedAt) >= h.claimedAt!.getTime() - 1_000).slice(0, 8);
  const out: RunProgress[] = [];
  for (const candidate of candidates) {
    const run = await runtime.run(candidate.runId, owner);
    if (!run.ok || !run.value || Date.parse(run.value.createdAt) < h.claimedAt.getTime() - 1_000) continue;
    const record = await runtime.record(flow, candidate.runId, owner);
    if (!record.ok || !reviewedWorkflows(record.value).some(w => { try { return semanticWorkflowHash(w as Workflow) === h.workflowHash; } catch { return false; } })) continue;
    let evidence: { environment: string; outcome: string; bundleHash: string } | null = null;
    if (run.value.hasEvidence) { const e = await runtime.evidence(flow, candidate.runId, owner); if (e.ok && e.value) evidence = { environment: e.value.environment, outcome: e.value.outcome, bundleHash: e.value.bundleHash }; }
    out.push({ executionId: run.value.runId, flow: run.value.flow, status: run.value.status, reconciled: run.value.hasEvidence, errorCode: run.value.errorCode,
      terminal: !run.value.needsObservation && (run.value.hasEvidence || run.value.errorCode !== null), evidenceEnvironment: evidence?.environment ?? null,
      evidenceOutcome: evidence?.outcome ?? null, evidenceBundleHash: evidence?.bundleHash ?? null, updatedAt: run.value.updatedAt });
  }
  const known = new Set(h.runIds), fresh = out.map(r => r.executionId).filter(id => !known.has(id));
  if (fresh.length) await handoffs.bindRuns(h.handoffId, fresh);
  return out;
}
/** The approval's status for its requester, with the shared runs when the owner shares them. */
export async function approvalProgress(h: HandoffRecord, runtime: EngineRuntime, handoffs: HandoffStore) {
  const runs = await sharedRuns(h, runtime, handoffs);
  return { ...approvalStatus(h), runs: runs ?? [], runsVisible: runs !== null,
    note: h.status === 'APPLIED' && !h.shareStatus ? 'The owner has not shared the status of runs started from this proposal.' : null };
}

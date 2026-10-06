// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the trusted approval handoff — the bridge from a chat to the owner's own wallet in FloFi.
 *
 *   request_user_approval  (MCP, OAuth account)  re-compose the strategy, require the same workflow hash, refuse review blockers,
 *                                                 evaluate the four facts, rate-limit, store a PENDING handoff, return an approval
 *                                                 object with authority NONE and a FloFi URL whose fragment carries the secret
 *   /approve               (FloFi origin)        show the external proposal; after the owner proves a wallet, re-verify everything
 *                                                 and CLAIM; the re-composed authoring command enters FloFi's existing proposal flow
 *
 * Nothing here holds or derives a key, builds a transaction, signs, submits or authorizes. The owner still runs a fresh
 * simulation, reviews the Strategy Manifest, approves explicitly and signs with their own wallet in the existing flow panels.
 */
import type { Workflow } from '../../domain/initial-workflow';
import { composeWorkflow, composeWorkflowBound, semanticWorkflowHash, type Composition, type WorkflowComposition } from '../../engine/strategy-engine';
import type { Command } from '../../domain/commands';
import type { McpOAuthPrincipal } from '../config.ts';
import { ENGINE_VERSION, evaluateWorkflowGates, handoffFindings, type ExecutionPlan, type Gates, type HandoffPolicy, type PlanStep } from '../execution.ts';
import type { OAuthConfig } from '../oauth/config.ts';
import { credentialDigest, newCredential, newId } from '../oauth/crypto.ts';
import type { McpState } from '../oauth/state.ts';
import type { McpRuntime } from '../runtime.ts';
import type { HandoffRecord, WalletRef } from './store.ts';

export const HANDOFF_SECONDS = 900;
export const CLAIM_SECONDS = 600;
export const APPROVAL_SESSION_SECONDS = 300;
export const MAX_PENDING_HANDOFFS = 5;
export const HANDOFF_RATE: readonly [number, number] = Object.freeze([20, 3_600]);
export const APPROVAL_REQUIRES = Object.freeze(['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'] as const);
export const AUTHORITY_NONE = 'NONE' as const;

export type ApprovalDeps = { readonly config: OAuthConfig; readonly state: McpState; readonly runtime: McpRuntime; readonly policy: HandoffPolicy; readonly now: Date };
export type Failure = { readonly ok: false; readonly code: string; readonly extra?: Readonly<Record<string, unknown>> };
export const approvalUrl = (config: OAuthConfig, secret: string) => `${config.origin}/approve#${secret}`;
/** The wallet namespace whose proof a plan needs (every network of one workflow is one namespace today). */
export const planNamespace = (plan: Pick<ExecutionPlan, 'networks'>): WalletRef['namespace'] => plan.networks.every(n => n.startsWith('solana')) ? 'solana' : 'eip155';
const stepView = (s: PlanStep) => ({ index: s.index, action: s.action, network: s.network, destinationNetwork: s.destinationNetwork, kind: s.kind, protocol: s.protocol,
  fundsClass: s.fundsClass, environment: s.environment, flow: s.flow, stepWorkflowHash: s.workflowHash });
const gateView = (g: Gates) => ({ supportedByCode: g.supportedByCode, enabledByDeployment: g.enabledByDeployment, enabledByPolicy: g.enabledByPolicy,
  demonstratedEvidence: g.demonstratedEvidence });

/** `request_user_approval`: a PENDING handoff for this account, or a classified refusal. */
export async function requestApproval(deps: ApprovalDeps, principal: McpOAuthPrincipal, strategy: unknown, workflowHash: string) {
  const workflow = composeWorkflowBound(strategy, workflowHash);
  if (!workflow.ok) return { ok: false, code: workflow.code, extra: { issues: workflow.issues } } satisfies Failure;
  // A general sequence of steps is refused here (MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED) with every step's facts reported.
  const gates = await evaluateWorkflowGates(workflow, deps.runtime, deps.policy);
  if (!gates.handoff.allowed) return { ok: false, code: gates.handoff.reason!, extra: { gates: gateView(gates), executionPlan: gates.plan.kind, steps: gates.plan.steps.map(stepView) } } satisfies Failure;
  const composition = workflow.steps[0]!;
  const { blockers, preExecution } = handoffFindings(composition);
  if (blockers.length) return { ok: false, code: 'REVIEW_BLOCKED', extra: { blockers: blockers.map(b => ({ code: b.code, message: b.message })) } } satisfies Failure;
  if (!await deps.state.oauth.allow(`handoff:account:${principal.accountId}`, HANDOFF_RATE[0], HANDOFF_RATE[1], deps.now)) return { ok: false, code: 'MCP_HANDOFF_RATE_LIMITED' } satisfies Failure;
  const secret = newCredential('handoff'), handoffId = newId('apr'), expiresAt = new Date(deps.now.getTime() + HANDOFF_SECONDS * 1000);
  const created = await deps.state.handoffs.create({ handoffId, accountId: principal.accountId, grantId: principal.id, clientId: principal.clientId,
    clientName: principal.clientName, secretDigest: credentialDigest(deps.config.keys.handoff, secret), strategy: composition.strategy,
    workflowHash: composition.workflowHash, engineVersion: ENGINE_VERSION, networkEnvironment: gates.plan.networkEnvironment, fundsClass: gates.plan.fundsClass,
    plan: gates.plan, expiresAt }, deps.now, MAX_PENDING_HANDOFFS);
  if (!created.ok) return { ok: false, code: created.code } satisfies Failure;
  return { ok: true as const, value: { approvalId: handoffId, approvalUrl: approvalUrl(deps.config, secret), workflowHash: composition.workflowHash,
    expiresAt: expiresAt.toISOString(), status: 'PENDING', networkEnvironment: gates.plan.networkEnvironment, fundsClass: gates.plan.fundsClass,
    executionPlan: gates.plan.kind, steps: gates.plan.steps.map(stepView), authority: AUTHORITY_NONE, requires: [...APPROVAL_REQUIRES],
    walletNamespace: planNamespace(gates.plan), gates: gateView(gates), summary: composition.summary,
    // What FloFi's flow still requires of the owner before anything can be signed (cleared by the fresh simulation and Review).
    preExecution } };
}

/** What a handoff looks like to the account that created it (never the wallet that claimed it unless the owner shares). */
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
export async function verifyHandoff(h: HandoffRecord, runtime: McpRuntime, policy: HandoffPolicy): Promise<Verified> {
  const workflow = composeWorkflow(h.strategy);
  if (!workflow.ok || workflow.workflowHash !== h.workflowHash) return { ok: false, code: 'HANDOFF_STALE', stale: true };
  const gates = await evaluateWorkflowGates(workflow, runtime, policy);
  if (!gates.handoff.allowed) return { ok: false, code: gates.handoff.reason! };
  return { ok: true, composition: workflow.steps[0]!, workflow, gates };
}

/** The public view of a handoff on /approve, for whoever holds its secret. Never a key, a transaction or calldata. */
export function approvalView(h: HandoffRecord, verified: Verified | null, viewer: { readonly wallets: readonly WalletRef[]; readonly accountId: string | null }) {
  const claimedByViewer = h.claimed !== null && viewer.wallets.some(w => w.namespace === h.claimed!.namespace && w.address === h.claimed!.address);
  return { approvalId: h.handoffId, status: h.status, clientName: h.clientName, external: true, createdAt: h.createdAt.toISOString(), expiresAt: h.expiresAt.toISOString(),
    networkEnvironment: h.networkEnvironment, fundsClass: h.fundsClass, workflowHash: h.workflowHash, executionPlan: h.plan.kind, steps: h.plan.steps.map(stepView),
    walletNamespace: planNamespace(h.plan), summary: verified?.ok ? verified.composition.summary : null, explanation: verified?.ok ? verified.composition.explanation : [],
    notes: verified?.ok ? verified.composition.notes : [], gates: verified?.ok ? gateView(verified.gates) : null, refusal: verified && !verified.ok ? verified.code : null,
    claimedByYou: claimedByViewer, claimedByAnotherWallet: h.claimed !== null && !claimedByViewer, sameAccount: viewer.accountId === h.accountId,
    statusShared: h.shareStatus, authorized: false, authority: AUTHORITY_NONE, requires: [...APPROVAL_REQUIRES] };
}
export type ApprovalView = ReturnType<typeof approvalView>;
export type ClaimedProposal = { readonly view: ApprovalView; readonly command: Command; readonly workflowHash: string };

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
export async function sharedRuns(h: HandoffRecord, runtime: McpRuntime, handoffs: McpState['handoffs']): Promise<readonly RunProgress[] | null> {
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
/** The approval's status for its account, with the shared runs when the owner shares them. */
export async function approvalProgress(h: HandoffRecord, runtime: McpRuntime, handoffs: McpState['handoffs']) {
  const runs = await sharedRuns(h, runtime, handoffs);
  return { ...approvalStatus(h), runs: runs ?? [], runsVisible: runs !== null,
    note: h.status === 'APPLIED' && !h.shareStatus ? 'The owner has not shared the status of runs started from this proposal.' : null };
}

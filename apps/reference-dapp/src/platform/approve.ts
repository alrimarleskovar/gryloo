// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: FloFi's approval surface (`/approve`), for every requester kind — moved out of the BUILD-MCP-002 server actions
 * so it no longer presumes an MCP requester or MCP OAuth. The page's server actions are thin adapters over these functions.
 *
 * A browser holds an approval secret (from the URL fragment, never sent in a URL to a server). It may SEE the proposal. To CLAIM it, the
 * browser must hold a proven wallet session of the namespace the workflow needs (EIP-4361 or Sign-In With Solana, verified server-side
 * from HttpOnly cookies — never a client-supplied address), and the requester kind's claim policy must accept that wallet. The
 * stored strategy is re-composed with the current engine and must reproduce its workflow hash; the requester kind's handoff policy
 * and the deployment are re-evaluated. The result is the same authoring command FloFi's own chat produces, which then enters FloFi's
 * existing proposal → flow → fresh simulation → Strategy Manifest Review → wallet signature path. Nothing here builds, signs or sends.
 *
 * A deployment's surface is assembled from per-surface CONTRIBUTIONS (each: an approval-link scheme and the profiles of the requester
 * kinds it serves); a requester kind without a profile, or a secret no registered scheme owns, is simply not found.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import type { Workflow } from '../domain/initial-workflow';
import { semanticWorkflowHash } from '../engine/strategy-engine';
import type { HandoffPolicy } from '../mcp/execution.ts';
import type { McpRuntime as EngineRuntime } from '../mcp/runtime.ts';
import { resolveApprovalSecret, type ApprovalLinkScheme } from './approval-links.ts';
import { approvalView, CLAIM_SECONDS, planNamespace, verifyHandoff, type ApprovalView, type ClaimedProposal } from './approvals.ts';
import type { ApprovalRequesterKind, HandoffRecord, HandoffStore, RequesterScope, WalletRef } from './handoff-store.ts';
import { refuse } from './refusal.ts';

/** A requester kind's own rule for who may claim its handoffs (e.g. only an intended wallet). Evaluated on the handoff's immutable data. */
export type ClaimPolicy = (handoff: HandoffRecord, wallet: WalletRef) => Promise<ClaimVerdict> | ClaimVerdict;
export type ClaimVerdict = { readonly ok: true } | { readonly ok: false; readonly code: string };
/** How /approve treats one requester kind. */
export type ApprovalKindProfile = {
  /** The kind's handoff policy (test funds, mainnet networks), re-evaluated whenever its handoff is viewed or claimed. */
  readonly policy: HandoffPolicy;
  /** An extra claim rule of this kind; none means any proven wallet of the workflow's namespace may claim. */
  readonly claimPolicy?: ClaimPolicy;
  /** The requester this browser itself is, if any (an MCP account's own browser): its status sharing defaults on. */
  readonly viewerRequester?: () => Promise<RequesterScope | null>;
};
export type ApprovalContribution = { readonly scheme: ApprovalLinkScheme; readonly profiles: Partial<Readonly<Record<ApprovalRequesterKind, ApprovalKindProfile>>> };
/** Where the deployment's approval handoffs live, and how a contribution reads this request's cookies (its own sign-in cookie, if any). */
export type ApprovalHost = { readonly db: Database; readonly tenantId: string };
export type CookieReader = (name: string) => string | undefined;
/** One FloFi surface's part of /approve, built per request; `null` from its factory when the surface is not enabled. */
export type ApprovalContributor = (host: ApprovalHost, cookie: CookieReader) => ApprovalContribution;
export type ApprovalSurface = { readonly schemes: readonly ApprovalLinkScheme[]; readonly profiles: Partial<Readonly<Record<ApprovalRequesterKind, ApprovalKindProfile>>>;
  readonly handoffs: HandoffStore; readonly runtime: EngineRuntime };

/**
 * One surface from the deployment's contributions. Every scheme prefix and every requester kind is owned by exactly one contribution,
 * and a contribution may only describe kinds its own scheme serves; anything else is `APPROVAL_SURFACE_INVALID` (fail closed).
 */
export function assembleApprovalSurface(contributions: readonly ApprovalContribution[], handoffs: HandoffStore, runtime: EngineRuntime): ApprovalSurface {
  const prefixes = new Set<string>(), kinds = new Set<string>(), profiles: Partial<Record<ApprovalRequesterKind, ApprovalKindProfile>> = {};
  for (const { scheme, profiles: own } of contributions) {
    if (prefixes.has(scheme.prefix)) throw new Error('APPROVAL_SURFACE_INVALID');
    prefixes.add(scheme.prefix);
    for (const kind of scheme.kinds) { if (kinds.has(kind)) throw new Error('APPROVAL_SURFACE_INVALID'); kinds.add(kind); }
    for (const [kind, profile] of Object.entries(own) as [ApprovalRequesterKind, ApprovalKindProfile][]) {
      if (!scheme.kinds.includes(kind)) throw new Error('APPROVAL_SURFACE_INVALID');
      profiles[kind] = profile;
    }
  }
  return Object.freeze({ schemes: Object.freeze(contributions.map(c => c.scheme)), profiles: Object.freeze(profiles), handoffs, runtime });
}

type Located = { readonly handoff: HandoffRecord; readonly digest: Buffer; readonly kinds: readonly ApprovalRequesterKind[]; readonly profile: ApprovalKindProfile };
/** The handoff behind a presented secret, limited to the kinds of the scheme that owns the secret; unknown in every other case. */
async function locate(surface: ApprovalSurface, secret: unknown, now: Date): Promise<Located> {
  const resolved = resolveApprovalSecret(surface.schemes, secret) ?? refuse('HANDOFF_NOT_FOUND');
  const handoff = await surface.handoffs.bySecret(resolved.digest, now, resolved.kinds) ?? refuse('HANDOFF_NOT_FOUND');
  const profile = surface.profiles[handoff.requesterKind] ?? refuse('HANDOFF_NOT_FOUND');
  return { handoff, digest: resolved.digest, kinds: resolved.kinds, profile };
}
const viewerOf = async (profile: ApprovalKindProfile, wallets: readonly WalletRef[]) => ({ wallets, requester: await profile.viewerRequester?.() ?? null });
const claimantOf = (h: HandoffRecord, wallets: readonly WalletRef[]) =>
  wallets.find(w => w.namespace === h.claimed?.namespace && w.address === h.claimed.address) ?? refuse('HANDOFF_NOT_FOUND');

/** The proposal behind a secret, re-verified now. Seeing it grants nothing. */
export async function viewApproval(surface: ApprovalSurface, secret: unknown, wallets: readonly WalletRef[], now = new Date()): Promise<ApprovalView> {
  const { handoff: h, profile } = await locate(surface, secret, now);
  const verified = h.status === 'PENDING' || h.status === 'CLAIMED' || h.status === 'APPLIED' ? await verifyHandoff(h, surface.runtime, profile.policy) : null;
  return approvalView(h, verified, await viewerOf(profile, wallets));
}

/**
 * Claims the proposal for the wallet this browser proved (the namespace the workflow needs) and returns the re-composed authoring
 * command. `share` is the owner's choice to let the requester see the status of runs started from it.
 */
export async function claimApproval(surface: ApprovalSurface, secret: unknown, wallets: readonly WalletRef[], share: boolean, now = new Date()): Promise<ClaimedProposal> {
  const { handoff: current, digest, kinds, profile } = await locate(surface, secret, now);
  const namespace = planNamespace(current.plan);
  const wallet = wallets.find(w => w.namespace === namespace) ?? refuse(namespace === 'solana' ? 'SOLANA_WALLET_PROOF_REQUIRED' : 'EVM_WALLET_PROOF_REQUIRED');
  const verified = await verifyHandoff(current, surface.runtime, profile.policy);
  // The requester's own rule reads only the handoff's immutable requester data, so deciding it before the row lock is exact.
  const rule = profile.claimPolicy ? await profile.claimPolicy(current, wallet) : { ok: true } as const;
  const claimed = await surface.handoffs.claim(digest, wallet, now, CLAIM_SECONDS, h => h.workflowHash !== current.workflowHash ? { ok: false, code: 'HANDOFF_STALE', stale: true }
    : !verified.ok ? { ok: false, code: verified.code, ...'stale' in verified && verified.stale ? { stale: true } : {} }
      : !rule.ok ? { ok: false, code: rule.code } : { ok: true, share: share === true }, kinds);
  if (!claimed.ok) return refuse(claimed.code);
  if (!verified.ok) return refuse(verified.code);
  const view = approvalView(claimed.handoff, verified, await viewerOf(profile, wallets));
  return { view, command: verified.composition.command, workflowHash: verified.composition.workflowHash };
}

/**
 * The claimant applied the proposal: the workflow now in its FloFi editor must hash (canonically, on the server) to exactly the
 * proposal's workflow hash. Anything else — an edit, another proposal — is a mismatch and the handoff stays CLAIMED.
 */
export async function applyApproval(surface: ApprovalSurface, secret: unknown, wallets: readonly WalletRef[], workflow: unknown, now = new Date()): Promise<ApprovalView> {
  const { handoff: current, digest, kinds, profile } = await locate(surface, secret, now);
  let appliedHash: string;
  try { appliedHash = semanticWorkflowHash(workflow as Workflow); } catch { appliedHash = ''; }
  if (appliedHash !== current.workflowHash) refuse('HANDOFF_WORKFLOW_MISMATCH');
  const applied = await surface.handoffs.apply(digest, claimantOf(current, wallets), now, kinds);
  if (!applied.ok) return refuse(applied.code);
  return approvalView(applied.handoff, await verifyHandoff(applied.handoff, surface.runtime, profile.policy), await viewerOf(profile, wallets));
}

/** The claimant turns status sharing with the requester on or off. */
export async function shareApproval(surface: ApprovalSurface, secret: unknown, wallets: readonly WalletRef[], share: boolean, now = new Date()): Promise<{ statusShared: boolean }> {
  const { handoff: current, digest, kinds } = await locate(surface, secret, now);
  const updated = await surface.handoffs.setSharing(digest, claimantOf(current, wallets), share === true, now, kinds) ?? refuse('HANDOFF_NOT_FOUND');
  return { statusShared: updated.shareStatus };
}

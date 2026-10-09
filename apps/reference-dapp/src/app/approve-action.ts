// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-MCP-002 → BUILD-DEVELOPER-001: server actions of `/approve`, the FloFi-controlled page where an external proposal meets its
 * owner — for every requester kind this deployment serves (`src/server/approval-surface.ts`), not only MCP.
 *
 * The browser holds the approval secret (from the URL fragment, never sent in a URL to any server). It may SEE the proposal. To
 * CLAIM it, the browser must hold a proven wallet session of the namespace the workflow needs (EIP-4361 or Sign-In With Solana,
 * verified server-side from HttpOnly cookies — never a client-supplied address) that the requester's claim rule accepts. The server
 * re-composes the stored strategy with the current engine, requires the same workflow hash and re-evaluates deployment and policy;
 * the result is the same authoring command the FloFi chat would produce, which then enters FloFi's existing proposal → flow → Review
 * → signature path. These actions only read this request's cookies and delegate to the shared platform (`src/platform/approve.ts`).
 * BUILD-AUTOMATION-001: on the remote runtime (production: Vercel → Railway API) an automation link (`flofi_auhs_`) is served by the
 * API, which holds the automation state and keys: the same platform functions, called there with the wallets this request proved
 * (`server/automation-operation.ts`). Every other link is unchanged.
 */
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { developerApprovalChanged } from '../developer/dispatch';
import { applyApproval, claimApproval, openBrowserApproval, resumeApproval, shareApproval, viewApproval, type ApprovalView, type ClaimedProposal } from '../platform/index';
import { approvalSurface } from '../server/approval-surface';
import { remoteApproval, remoteAutomationApproval } from '../server/automation-operation';
import { currentWalletPrincipals } from '../server/session-principal';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown): { ok: false; code: string } => ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : 'APPROVAL_FAILED' });
async function surface() {
  const jar = await cookies();
  return approvalSurface(process.env, name => jar.get(name)?.value);
}
/**
 * BUILD-DEVELOPER-001: after a transition, a developer approval's webhook events are derived and its project's notifications delivered
 * (a no-op for every other link). It runs after the response and never changes the transition.
 */
const notify = (secret: string) => after(() => developerApprovalChanged(process.env, secret).catch(() => undefined));

export async function openBrowserApprovalHandoff(approvalId: string): Promise<Result<{ approvalUrl: string }>> {
  try { return { ok: true, value: await openBrowserApproval(await surface(), approvalId, process.env.FLOFI_PUBLIC_ORIGIN!) }; }
  catch (cause) { return failure(cause); }
}
export async function resumeApprovalHandoff(approvalId: string): Promise<Result<ClaimedProposal>> {
  try { return { ok: true, value: await resumeApproval(await surface(), approvalId, await currentWalletPrincipals()) }; }
  catch (cause) { return failure(cause); }
}

/** The proposal behind a secret, re-verified now. Seeing it grants nothing. */
export async function approvalHandoffView(secret: string): Promise<Result<ApprovalView>> {
  try {
    if (remoteAutomationApproval(secret)) return { ok: true, value: await remoteApproval<ApprovalView>('view', [secret]) };
    return { ok: true, value: await viewApproval(await surface(), secret, await currentWalletPrincipals()) };
  } catch (cause) { return failure(cause); }
}

/**
 * Claims the proposal for the wallet this browser proved (the namespace the workflow needs) and returns the re-composed authoring
 * command. `share` is the owner's choice to let the requester see the status of runs started from it.
 */
export async function claimApprovalHandoff(secret: string, share: boolean): Promise<Result<ClaimedProposal>> {
  try {
    if (remoteAutomationApproval(secret)) return { ok: true, value: await remoteApproval<ClaimedProposal>('claim', [secret, share === true]) };
    const value = await claimApproval(await surface(), secret, await currentWalletPrincipals(), share === true); notify(secret); return { ok: true, value };
  } catch (cause) { return failure(cause); }
}

/**
 * The claimant applied the proposal: the workflow now in its FloFi editor must hash (canonically, on the server) to exactly the
 * proposal's workflow hash. Anything else — an edit, another proposal — is a mismatch and the handoff stays CLAIMED.
 */
export async function markApprovalApplied(secret: string, workflow: unknown): Promise<Result<ApprovalView>> {
  try {
    if (remoteAutomationApproval(secret)) return { ok: true, value: await remoteApproval<ApprovalView>('apply', [secret, workflow]) };
    const value = await applyApproval(await surface(), secret, await currentWalletPrincipals(), workflow); notify(secret); return { ok: true, value };
  } catch (cause) { return failure(cause); }
}

/** The claimant turns status sharing with the requester on or off. */
export async function setApprovalSharing(secret: string, share: boolean): Promise<Result<{ statusShared: boolean }>> {
  try {
    if (remoteAutomationApproval(secret)) return { ok: true, value: await remoteApproval<{ statusShared: boolean }>('share', [secret, share === true]) };
    const value = await shareApproval(await surface(), secret, await currentWalletPrincipals(), share === true); notify(secret); return { ok: true, value };
  } catch (cause) { return failure(cause); }
}

// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-MCP-002: server actions of `/approve`, the FloFi-controlled page where an external proposal meets its owner.
 *
 * The browser holds the handoff secret (from the URL fragment, never sent in a URL to any server). It may SEE the proposal. To
 * CLAIM it, the browser must hold a proven wallet session of the namespace the workflow needs (EIP-4361 or Sign-In With Solana,
 * verified server-side from HttpOnly cookies — never a client-supplied address). The server re-composes the stored strategy with
 * the current engine, requires the same workflow hash and re-evaluates deployment and policy; the result is the same authoring
 * command the FloFi chat would produce, which then enters FloFi's existing proposal → flow → Review → signature path.
 */
import { cookies } from 'next/headers';
import type { Workflow } from '../domain/initial-workflow';
import { semanticWorkflowHash } from '../engine/strategy-engine';
import { readHandoffPolicy } from '../mcp/execution';
import { approvalView, CLAIM_SECONDS, planNamespace, verifyHandoff, type ApprovalView, type ClaimedProposal } from '../mcp/handoff/service';
import { readOAuthConfig, type OAuthConfig } from '../mcp/oauth/config';
import { credentialDigest, credentialOf, unsealValue } from '../mcp/oauth/crypto';
import { ACCOUNT_COOKIE } from '../mcp/oauth/server';
import { mcpState, type McpState } from '../mcp/oauth/state';
import { deploymentRuntime } from '../mcp/runtime';
import { currentWalletPrincipals } from '../server/session-principal';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown): { ok: false; code: string } => ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : 'APPROVAL_FAILED' });
function fail(code: string): never { throw new Error(code); }

async function context() {
  const config = readOAuthConfig(process.env);
  if (!config.enabled) fail('MCP_OAUTH_NOT_ENABLED');
  const state = await mcpState(process.env);
  return { config: config as OAuthConfig, state, runtime: deploymentRuntime(process.env), policy: readHandoffPolicy(process.env) };
}
const digestOf = (config: OAuthConfig, secret: unknown) => credentialDigest(config.keys.handoff, credentialOf('handoff', secret) ?? fail('HANDOFF_NOT_FOUND'));
/** The pseudonymous FloFi account of this browser (the OAuth consent cookie), if it is still active here. */
async function browserAccount(config: OAuthConfig, state: McpState): Promise<string | null> {
  const value = unsealValue<{ a: string; d: string; e: number }>('ma1', (await cookies()).get(ACCOUNT_COOKIE)?.value, config.keys.account, Math.floor(Date.now() / 1000));
  if (!value || value.d !== new URL(config.origin).host || !/^mcpacct_[a-z2-7]{26}$/.test(value.a)) return null;
  return await state.oauth.accountActive(value.a) ? value.a : null;
}

/** The proposal behind a secret, re-verified now. Seeing it grants nothing. */
export async function approvalHandoffView(secret: string): Promise<Result<ApprovalView>> {
  try {
    const { config, state, runtime, policy } = await context(), now = new Date();
    const h = await state.handoffs.bySecret(digestOf(config, secret), now) ?? fail('HANDOFF_NOT_FOUND');
    const verified = h.status === 'PENDING' || h.status === 'CLAIMED' || h.status === 'APPLIED' ? await verifyHandoff(h, runtime, policy) : null;
    return { ok: true, value: approvalView(h, verified, { wallets: await currentWalletPrincipals(), accountId: await browserAccount(config, state) }) };
  } catch (cause) { return failure(cause); }
}

/**
 * Claims the proposal for the wallet this browser proved (the namespace the workflow needs) and returns the re-composed authoring
 * command. `share` is the owner's choice to let the requesting account see the status of runs started from it.
 */
export async function claimApprovalHandoff(secret: string, share: boolean): Promise<Result<ClaimedProposal>> {
  try {
    const { config, state, runtime, policy } = await context(), now = new Date(), digest = digestOf(config, secret);
    const current = await state.handoffs.bySecret(digest, now) ?? fail('HANDOFF_NOT_FOUND');
    const namespace = planNamespace(current.plan), wallets = await currentWalletPrincipals();
    const wallet = wallets.find(w => w.namespace === namespace) ?? fail(namespace === 'solana' ? 'SOLANA_WALLET_PROOF_REQUIRED' : 'EVM_WALLET_PROOF_REQUIRED');
    const verified = await verifyHandoff(current, runtime, policy);
    const claimed = await state.handoffs.claim(digest, wallet, now, CLAIM_SECONDS, h => h.workflowHash !== current.workflowHash ? { ok: false, code: 'HANDOFF_STALE', stale: true }
      : verified.ok ? { ok: true, share: share === true } : { ok: false, code: verified.code, ...'stale' in verified && verified.stale ? { stale: true } : {} });
    if (!claimed.ok) fail(claimed.code);
    if (!verified.ok) fail(verified.code);
    const view = approvalView(claimed.handoff, verified, { wallets, accountId: await browserAccount(config, state) });
    return { ok: true, value: { view, command: verified.composition.command, workflowHash: verified.composition.workflowHash } };
  } catch (cause) { return failure(cause); }
}

/**
 * The claimant applied the proposal: the workflow now in its FloFi editor must hash (canonically, on the server) to exactly the
 * proposal's workflow hash. Anything else — an edit, another proposal — is a mismatch and the handoff stays CLAIMED.
 */
export async function markApprovalApplied(secret: string, workflow: unknown): Promise<Result<ApprovalView>> {
  try {
    const { config, state, runtime, policy } = await context(), now = new Date(), digest = digestOf(config, secret);
    const current = await state.handoffs.bySecret(digest, now) ?? fail('HANDOFF_NOT_FOUND');
    let appliedHash: string;
    try { appliedHash = semanticWorkflowHash(workflow as Workflow); } catch { appliedHash = ''; }
    if (appliedHash !== current.workflowHash) fail('HANDOFF_WORKFLOW_MISMATCH');
    const wallets = await currentWalletPrincipals(), wallet = wallets.find(w => w.namespace === current.claimed?.namespace && w.address === current.claimed.address);
    if (!wallet) fail('HANDOFF_NOT_FOUND');
    const applied = await state.handoffs.apply(digest, wallet!, now);
    if (!applied.ok) fail(applied.code);
    return { ok: true, value: approvalView(applied.handoff, await verifyHandoff(applied.handoff, runtime, policy), { wallets, accountId: await browserAccount(config, state) }) };
  } catch (cause) { return failure(cause); }
}

/** The claimant turns status sharing with the requesting account on or off. */
export async function setApprovalSharing(secret: string, share: boolean): Promise<Result<{ statusShared: boolean }>> {
  try {
    const { config, state } = await context(), now = new Date(), digest = digestOf(config, secret);
    const current = await state.handoffs.bySecret(digest, now) ?? fail('HANDOFF_NOT_FOUND');
    const wallet = (await currentWalletPrincipals()).find(w => w.namespace === current.claimed?.namespace && w.address === current.claimed.address) ?? fail('HANDOFF_NOT_FOUND');
    const updated = await state.handoffs.setSharing(digest, wallet, share === true, now) ?? fail('HANDOFF_NOT_FOUND');
    return { ok: true, value: { statusShared: updated.shareStatus } };
  } catch (cause) { return failure(cause); }
}

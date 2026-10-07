// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-MCP-002: server actions of `/connections`, where the owner of a pseudonymous FloFi account (the browser that holds the
 * OAuth consent cookie) manages what MCP clients may see: wallet links (create with a fresh wallet proof and an explicit click;
 * revoke) and approval requests (withdraw one that is still open). Nothing here signs or authorizes a transaction.
 */
import { cookies } from 'next/headers';
import { LINK_DAYS } from '../mcp/handoff/links';
import { readOAuthConfig, type OAuthConfig } from '../mcp/oauth/config';
import { unsealValue } from '../mcp/oauth/crypto';
import { ACCOUNT_COOKIE } from '../mcp/oauth/server';
import { mcpState, type McpState } from '../mcp/oauth/state';
import { currentWalletPrincipals, type WalletPrincipal } from '../server/session-principal';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown): { ok: false; code: string } => ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : 'CONNECTIONS_FAILED' });
function fail(code: string): never { throw new Error(code); }
export type ConnectionsView = {
  readonly account: string | null; readonly proven: readonly WalletPrincipal[]; readonly linkDays: number;
  readonly links: readonly { linkId: string; namespace: string; address: string; createdAt: string; expiresAt: string }[];
  readonly approvals: readonly { approvalId: string; client: string; status: string; fundsClass: string; networkEnvironment: string; createdAt: string; statusShared: boolean }[];
};

async function context(): Promise<{ config: OAuthConfig; state: McpState; account: string | null }> {
  const config = readOAuthConfig(process.env);
  if (!config.enabled) fail('MCP_OAUTH_NOT_ENABLED');
  const state = await mcpState(process.env);
  const value = unsealValue<{ a: string; d: string; e: number }>('ma1', (await cookies()).get(ACCOUNT_COOKIE)?.value, config.keys.account, Math.floor(Date.now() / 1000));
  const candidate = value && value.d === new URL(config.origin).host && /^mcpacct_[a-z2-7]{26}$/.test(value.a) ? value.a : null;
  return { config, state, account: candidate && await state.oauth.accountActive(candidate) ? candidate : null };
}
async function viewOf(state: McpState, account: string | null): Promise<ConnectionsView> {
  const now = new Date(), proven = await currentWalletPrincipals();
  if (!account) return { account: null, proven, links: [], approvals: [], linkDays: LINK_DAYS };
  const [links, approvals] = await Promise.all([state.links.active(account, now), state.handoffs.listForAccount(account, now, 20)]);
  return { account, proven, linkDays: LINK_DAYS, links: links.map(l => ({ linkId: l.linkId, namespace: l.namespace, address: l.address, createdAt: l.createdAt.toISOString(),
    expiresAt: l.expiresAt.toISOString() })), approvals: approvals.map(h => ({ approvalId: h.handoffId, client: h.clientName, status: h.status, fundsClass: h.fundsClass,
    networkEnvironment: h.networkEnvironment, createdAt: h.createdAt.toISOString(), statusShared: h.shareStatus })) };
}

export async function connectionsView(): Promise<Result<ConnectionsView>> {
  try { const { state, account } = await context(); return { ok: true, value: await viewOf(state, account) }; } catch (cause) { return failure(cause); }
}
/** Links the wallet proven in THIS browser (server-verified session) to the account of THIS browser. The click is the consent. */
export async function linkProvenWallet(namespace: 'eip155' | 'solana'): Promise<Result<ConnectionsView>> {
  try {
    const { state, account } = await context();
    if (!account) fail('MCP_ACCOUNT_REQUIRED');
    const wallet = (await currentWalletPrincipals()).find(w => w.namespace === namespace) ?? fail('WALLET_PROOF_REQUIRED');
    const linked = await state.links.link(account, wallet, new Date());
    if (!linked.ok) fail(linked.code);
    return { ok: true, value: await viewOf(state, account) };
  } catch (cause) { return failure(cause); }
}
export async function revokeWalletLink(linkId: string): Promise<Result<ConnectionsView>> {
  try {
    const { state, account } = await context();
    if (!account) fail('MCP_ACCOUNT_REQUIRED');
    if (typeof linkId !== 'string' || !/^wlk_[a-z2-7]{26}$/.test(linkId) || !await state.links.revoke(account, linkId, new Date())) fail('WALLET_LINK_NOT_FOUND');
    return { ok: true, value: await viewOf(state, account) };
  } catch (cause) { return failure(cause); }
}
export async function withdrawApproval(approvalId: string): Promise<Result<ConnectionsView>> {
  try {
    const { state, account } = await context();
    if (!account) fail('MCP_ACCOUNT_REQUIRED');
    if (typeof approvalId !== 'string' || !/^apr_[a-z2-7]{26}$/.test(approvalId) || !await state.handoffs.revoke(approvalId, account, new Date())) fail('APPROVAL_NOT_FOUND');
    return { ok: true, value: await viewOf(state, account) };
  } catch (cause) { return failure(cause); }
}

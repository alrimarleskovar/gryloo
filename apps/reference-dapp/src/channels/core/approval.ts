// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: a channel conversation on FloFi's ONE approval model (`src/platform`, migration 0006). A conversation is a
 * first-class `CHANNEL_CONVERSATION` requester — never an MCP account, never a wallet. It brings only what the shared model asks of
 * each surface:
 *
 *   link scheme   `flofi_chs_` + 256 bits, digested with the channel's own key (HKDF of FLOFI_CHANNEL_SECRET); the platform stores
 *                 only the digest and the secret travels only in the /approve URL fragment
 *   rules         15-minute window, at most 3 open requests and 20 per hour per conversation, no automatic supersession: the channel
 *                 revokes its previous live link itself whenever the pending proposal is materially replaced
 *   claim policy  when the strategy names an address (beneficiary, owner, recipient), only a PROVEN wallet equal to it may claim
 *
 * The approval link grants view and claim only. Claiming still needs the wallet's own proof on FloFi, then the fresh simulation, the
 * Strategy Manifest Review and the owner's wallet signatures in FloFi's existing flow. Nothing here signs, submits or authorizes.
 */
import { approvalLinkScheme, approvalProgress, requestApproval, type ApprovalLinkScheme, type ApprovalRequester, type ClaimPolicy, type EngineRuntime,
  type HandoffPolicy, type HandoffRecord, type HandoffRules, type HandoffStore, type RequesterScope, type WalletRef, type WindowLimit } from '../../platform/index.ts';
import type { ChannelKeys } from './crypto.ts';
import type { ChannelStrategy } from './strategy.ts';

export const CHANNEL_APPROVAL_PREFIX = 'flofi_chs_';
export const CHANNEL_HANDOFF_RULES: HandoffRules = Object.freeze({ handoffSeconds: 900, maxPending: 3, rate: [20, 3_600] as const, supersedeSameWorkflow: false });
export const channelApprovalScheme = (keys: ChannelKeys): ApprovalLinkScheme => approvalLinkScheme(CHANNEL_APPROVAL_PREFIX, keys.approval, ['CHANNEL_CONVERSATION']);

/** What the channel needs from the shared platform: the deployment's handoff store, abuse limiter, runtime, the channel policy. */
export type ChannelPlatform = { readonly origin: string; readonly scheme: ApprovalLinkScheme; readonly handoffs: HandoffStore; readonly allow: WindowLimit;
  readonly runtime: EngineRuntime; readonly policy: Extract<HandoffPolicy, { ok: true }> };
/** The requester of one conversation: its id isolates its handoffs; the intended wallet is immutable, non-secret claim context. */
export function channelRequester(source: { readonly clientId: string; readonly displayName: string }, conversationId: string, intendedWallet: WalletRef | null): ApprovalRequester {
  return { kind: 'CHANNEL_CONVERSATION', ref: conversationId, clientId: source.clientId, displayName: source.displayName, context: intendedWallet ? { intendedWallet } : {} };
}
/** A conversation's isolation scope in the shared handoff store: its handoffs only, never another requester's. */
export const conversationScope = (conversationId: string): RequesterScope => ({ kind: 'CHANNEL_CONVERSATION', ref: conversationId });

/** The channel's claim rule: a strategy that names an address can only be claimed by that wallet, proven on FloFi. */
export const intendedWalletPolicy: ClaimPolicy = (handoff, wallet) => {
  const intended = (handoff.requesterContext as { intendedWallet?: WalletRef }).intendedWallet;
  if (!intended) return { ok: true };
  return intended.namespace === wallet.namespace && (wallet.namespace === 'eip155'
    ? intended.address.toLowerCase() === wallet.address.toLowerCase() : intended.address === wallet.address) ? { ok: true }
    : { ok: false, code: 'CHANNEL_INTENDED_WALLET_MISMATCH' };
};

export type ChannelApproval = { readonly ok: true; readonly approvalId: string; readonly approvalUrl: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly code: string; readonly blockers: readonly string[] };
/**
 * A new approval handoff for the pending proposal. The secret-bearing URL is returned once, to be attached to the outgoing message in
 * memory: the channel never logs or stores it.
 */
export async function createChannelApproval(platform: ChannelPlatform, requester: ApprovalRequester, strategy: ChannelStrategy, now: Date): Promise<ChannelApproval> {
  const result = await requestApproval({ origin: platform.origin, scheme: platform.scheme, handoffs: platform.handoffs, allow: platform.allow, runtime: platform.runtime,
    policy: platform.policy, rules: CHANNEL_HANDOFF_RULES, now }, requester, strategy.spec, strategy.workflowHash);
  if (!result.ok) {
    const blockers = ((result.extra?.blockers ?? []) as { message?: unknown }[]).map(b => String(b.message ?? '')).filter(Boolean).slice(0, 3);
    return { ok: false, code: result.code, blockers };
  }
  return { ok: true, approvalId: result.value.approvalId, approvalUrl: result.value.approvalUrl, expiresAt: new Date(result.value.expiresAt) };
}
/** Withdraws one of this conversation's handoffs that is not yet applied (an applied or ended one is left as it is). */
export async function revokeChannelApproval(platform: Pick<ChannelPlatform, 'handoffs'>, conversationId: string, approvalId: string | null, now: Date): Promise<boolean> {
  if (!approvalId) return false;
  const h = await platform.handoffs.revokeForRequester(approvalId, conversationScope(conversationId), now);
  return h?.status === 'REVOKED';
}
/** One of this conversation's handoffs with its shared run progress, or null when it is not this conversation's. */
export async function channelApprovalProgress(platform: Pick<ChannelPlatform, 'handoffs' | 'runtime'>, conversationId: string, approvalId: string, now: Date):
  Promise<{ readonly handoff: HandoffRecord; readonly progress: Awaited<ReturnType<typeof approvalProgress>> } | null> {
  const handoff = await platform.handoffs.forRequester(approvalId, conversationScope(conversationId), now);
  return handoff ? { handoff, progress: await approvalProgress(handoff, platform.runtime, platform.handoffs) } : null;
}

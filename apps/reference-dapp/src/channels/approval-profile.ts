// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the channels' part of FloFi's approval surface (`/approve`, `src/server/approval-surface.ts`):
 *
 *   link scheme   `flofi_chs_` links, digested with the channel key, resolving CHANNEL_CONVERSATION handoffs only
 *   policy        the channel handoff policy (test funds; each mainnet explicitly; none by default), re-checked at view and claim
 *   claim policy  a strategy that names an address may only be claimed by that wallet, proven on FloFi (never by a sender id)
 *
 * No viewer requester: a channel conversation has no browser identity, so status sharing stays the claimant's explicit choice
 * (default off). Contributes only while a channel is enabled (never on a hosted deployment in this build). Model-free.
 */
import type { ApprovalContributor } from '../platform/index.ts';
import { channelApprovalScheme, intendedWalletPolicy } from './core/approval.ts';
import { readChannelDeployment } from './registry.ts';

type Env = Readonly<Record<string, string | undefined>>;
export function channelApprovalContributor(env: Env): ApprovalContributor | null {
  const result = readChannelDeployment(env);
  if (!result.ok) return null;
  const { core } = result.deployment;
  return () => ({ scheme: channelApprovalScheme(core.keys), profiles: { CHANNEL_CONVERSATION: { policy: core.policy, claimPolicy: intendedWalletPolicy } } });
}

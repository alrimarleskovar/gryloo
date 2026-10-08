// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-CHANNELS-001: the `/approve` status ping for proposals that came from a conversational channel (owner decision D5). The page
 * calls it while the approval experience is active; the server checks the channel approval secret, the claimant's proven wallet
 * session (HttpOnly cookies, never a client-supplied address) and the owner's sharing choice, then sends any newly due notification.
 * It authorizes nothing, returns no data beyond whether to keep pinging, and never touches FloFi's execution. Model-free.
 */
import { pingChannelApproval, type PingResult } from '../channels/approval-ping';
import { currentWalletPrincipals } from '../server/session-principal';

export async function channelApprovalPing(secret: string): Promise<PingResult> {
  try { return await pingChannelApproval(process.env, secret, await currentWalletPrincipals()); } catch { return { channel: false, active: false }; }
}

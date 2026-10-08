// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the scheduled dispatch — one bounded sweep of the deployment's channels, triggered by a scheduler (Vercel Cron or
 * any other) through `/api/channels/dispatch`. On the embedded runtime there is no long-running worker (as for the Developer API's
 * webhooks), so this is what makes channel work independent of the next inbound message:
 *
 *   1. stranded      conversations with a pending event and no live lease (a turn that never ran or crashed after the 200): processed
 *                    by their provider's service under a fresh lease, in provider order; a message older than 15 minutes is answered
 *                    "late" and never acted on
 *   2. deliveries    conversations with due retries, interrupted sends or unconfirmed sends (`delivery.ts`): sent, retried, ended,
 *                    withdrawn (an approval link cannot be re-created outside its turn) — never sent twice
 *   3. status        approvals created by recent turns: their progress is turned into notifications ("loaded", "in progress",
 *                    "reconciled ✅ · evidence: …"), each once; an approval is no longer followed once nothing more can follow
 *   4. retention     erase what outlived its window (`store.purge`) — last, so a stranded message is still answered "late" first
 *
 * Every step is idempotent and safe to run concurrently with webhooks, the /approve ping and another dispatch: leases, `SKIP LOCKED`
 * claims and notification keys decide who does what. The sweep stops starting new work at its deadline. Nothing here signs, claims,
 * applies or authorizes anything, and nothing in FloFi's execution waits for it.
 */
import { conversationScope, type ChannelPlatform } from './approval.ts';
import type { ChannelCoreConfig } from './config.ts';
import { open, sealContext } from './crypto.ts';
import { deliverConversation, STALE_SENDING_MS, type DeliveryReport } from './delivery.ts';
import type { ChannelLogger } from './log.ts';
import { notifyChannelHandoff } from './notify.ts';
import type { ChannelService } from './service.ts';
import { parseStateLanguage } from './state-language.ts';
import { RETENTION, type ChannelStore } from './store.ts';
import type { ChannelAdapter, ChannelId } from './types.ts';

export type DispatchContext = {
  readonly core: ChannelCoreConfig; readonly store: ChannelStore; readonly platform: ChannelPlatform; readonly log: ChannelLogger; readonly now: () => Date;
  /** The enabled providers, by channel: their outbound adapters and their turn services (work for a disabled provider waits). */
  readonly adapters: ReadonlyMap<ChannelId, ChannelAdapter>; readonly services: ReadonlyMap<ChannelId, Pick<ChannelService, 'drain'>>;
  /** Test seams for delivery. */
  readonly sleep?: (ms: number) => Promise<void>; readonly random?: () => number;
};
export type DispatchLimits = { readonly conversations: number; readonly handoffs: number; readonly budgetMs: number };
export const DISPATCH_LIMITS: DispatchLimits = Object.freeze({ conversations: 25, handoffs: 25, budgetMs: 45_000 });
export type DispatchSummary = { readonly stranded: number; readonly turns: number; readonly conversations: number; readonly sent: number;
  readonly retrying: number; readonly uncertain: number; readonly failed: number; readonly skipped: number; readonly handoffs: number;
  readonly notified: number; readonly settled: number; readonly purged: boolean; readonly truncated: boolean };

export async function dispatchChannels(ctx: DispatchContext, limits: DispatchLimits = DISPATCH_LIMITS): Promise<DispatchSummary> {
  const deadline = ctx.now().getTime() + limits.budgetMs, open_ = () => ctx.now().getTime() < deadline;
  const summary = { stranded: 0, turns: 0, conversations: 0, sent: 0, retrying: 0, uncertain: 0, failed: 0, skipped: 0, handoffs: 0, notified: 0, settled: 0,
    purged: false, truncated: false };
  const stranded = await ctx.store.strandedConversations(ctx.now(), limits.conversations);
  for (const ref of stranded) {
    if (!open_()) { summary.truncated = true; break; }
    const service = ctx.services.get(ref.channel);
    if (!service) continue;
    summary.stranded++;
    summary.turns += (await service.drain(ref.conversationId).catch(() => ({ processed: 0 }))).processed;
  }

  const now = ctx.now(), due = await ctx.store.dueConversations(now, new Date(now.getTime() - STALE_SENDING_MS), limits.conversations);
  for (const ref of due) {
    if (!open_()) { summary.truncated = true; break; }
    const adapter = ctx.adapters.get(ref.channel);
    if (!adapter) continue;
    const conversation = await ctx.store.conversation(ref.conversationId);
    const state = conversation?.status === 'ACTIVE' ? open(ctx.core.keys.seal, conversation.stateSealed,
      sealContext(ctx.core.tenantId, 'channel_conversations', ref.conversationId, 'state')) : null;
    let report: DeliveryReport;
    try {
      report = await deliverConversation({ tenantId: ctx.core.tenantId, origin: ctx.core.origin, keys: ctx.core.keys, store: ctx.store, adapter,
        handoffs: ctx.platform.handoffs, log: ctx.log, now: ctx.now, ...ctx.sleep ? { sleep: ctx.sleep } : {}, ...ctx.random ? { random: ctx.random } : {} },
      ref.conversationId, { kinds: ['REPLY', 'APPROVAL', 'NOTIFICATION'], language: parseStateLanguage(state, ctx.core.language) });
    } catch { ctx.log.warn('channel.dispatch.delivery_failed', { channel: ref.channel, conversation: ref.conversationId }); continue; }
    summary.conversations++;
    summary.sent += report.sent; summary.retrying += report.retrying; summary.uncertain += report.uncertain; summary.failed += report.failed; summary.skipped += report.skipped;
  }

  const watched = await ctx.store.watchedHandoffs(new Date(ctx.now().getTime() - RETENTION.watchMs), limits.handoffs);
  for (const w of watched) {
    if (!open_()) { summary.truncated = true; break; }
    if (!ctx.adapters.has(w.channel)) continue;
    summary.handoffs++;
    try {
      const handoff = await ctx.platform.handoffs.forRequester(w.handoffId, conversationScope(w.conversationId), ctx.now());
      if (!handoff) { await ctx.store.settleHandoff(w.handoffId); summary.settled++; continue; }
      const { notified, done } = await notifyChannelHandoff({ core: ctx.core, store: ctx.store, platform: ctx.platform, adapters: ctx.adapters, log: ctx.log,
        now: ctx.now }, handoff);
      summary.notified += notified;
      if (done) { await ctx.store.settleHandoff(w.handoffId); summary.settled++; }
    } catch { ctx.log.warn('channel.dispatch.status_failed', { channel: w.channel, conversation: w.conversationId }); }
  }
  summary.purged = await ctx.store.purge(ctx.now()).then(() => true, () => false);
  ctx.log.info('channel.dispatch', { stranded: summary.stranded, turns: summary.turns, conversations: summary.conversations, sent: summary.sent,
    retrying: summary.retrying, uncertain: summary.uncertain, failed: summary.failed, handoffs: summary.handoffs, notified: summary.notified,
    truncated: summary.truncated });
  return summary;
}

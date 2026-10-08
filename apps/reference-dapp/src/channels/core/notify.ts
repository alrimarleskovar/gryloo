// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: progress notifications to the conversation that created a proposal — model-free, so FloFi's approval page can
 * trigger them without loading any interpreter.
 *
 * Two triggers, both idempotent: `/approve` pings while the owner has it open (fast), and the scheduled dispatch follows every recent
 * approval of the deployment (`dispatch.ts`), so status reaches the chat even when nobody keeps the page open. It reads the shared
 * platform's view of the handoff (`approvalProgress`): the approval state, and runs only while the owner shares them. Each notification
 * has a stable key, so repeated checks never send twice. It never waits on, changes or blocks FloFi's execution, reconciliation or
 * evidence: a failed delivery is only a failed message.
 */
import { approvalProgress, type HandoffRecord } from '../../platform/index.ts';
import type { ChannelPlatform } from './approval.ts';
import type { ChannelCoreConfig } from './config.ts';
import { parseStateLanguage } from './state-language.ts';
import { open, sealContext } from './crypto.ts';
import { deliverConversation, newOutboxId, sealReply } from './delivery.ts';
import type { ChannelLogger } from './log.ts';
import { plannedNotifications } from './status.ts';
import type { ChannelStore } from './store.ts';
import type { ChannelAdapter, ChannelId } from './types.ts';

/** `adapters`: the deployment's enabled providers, by channel; a conversation is notified only through its own channel's adapter. */
export type NotifyContext = { readonly core: ChannelCoreConfig; readonly store: ChannelStore; readonly platform: ChannelPlatform;
  readonly adapters: ReadonlyMap<ChannelId, ChannelAdapter>; readonly log: ChannelLogger; readonly now: () => Date };

/** Sends what is newly due for one channel handoff. `done` once nothing more can follow (the pinging page may stop). */
export async function notifyChannelHandoff(ctx: NotifyContext, handoff: HandoffRecord): Promise<{ readonly notified: number; readonly done: boolean }> {
  if (handoff.requesterKind !== 'CHANNEL_CONVERSATION') return { notified: 0, done: true };
  const conversation = await ctx.store.conversation(handoff.requesterRef);
  const adapter = conversation ? ctx.adapters.get(conversation.channel) : undefined;
  if (!conversation || conversation.status !== 'ACTIVE' || !adapter) return { notified: 0, done: true };
  const state = open(ctx.core.keys.seal, conversation.stateSealed, sealContext(ctx.core.tenantId, 'channel_conversations', conversation.conversationId, 'state'));
  const language = parseStateLanguage(state, ctx.core.language);
  const progress = await approvalProgress(handoff, ctx.platform.runtime, ctx.platform.handoffs);
  const { due, done } = plannedNotifications(language, handoff, progress);
  const deliveryCtx = { tenantId: ctx.core.tenantId, origin: ctx.core.origin, keys: ctx.core.keys, store: ctx.store, adapter,
    handoffs: ctx.platform.handoffs, log: ctx.log, now: ctx.now };
  const rows = due.map((n, sequence) => { const outboxId = newOutboxId();
    return { outboxId, dedupeKey: n.key, kind: 'NOTIFICATION' as const, sequence, bodySealed: sealReply(deliveryCtx, outboxId, { text: n.text, choices: [], link: null }),
      handoffId: handoff.handoffId }; });
  const inserted = rows.length ? await ctx.store.enqueue(conversation.conversationId, rows, ctx.now()) : [];
  if (inserted.length) {
    ctx.log.info('channel.notify', { channel: adapter.channel, conversation: conversation.conversationId, count: inserted.length });
    await deliverConversation(deliveryCtx, conversation.conversationId, { kinds: ['REPLY', 'NOTIFICATION'], language });
  }
  return { notified: inserted.length, done };
}

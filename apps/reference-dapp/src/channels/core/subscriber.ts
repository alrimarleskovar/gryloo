// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: Channel Core's provider-neutral subscription hook and subscriber notifications. Another FloFi surface (the
 * Automations module) may let an owner link a conversation to its notifications with a one-time code typed in the chat; Channel Core
 * only recognizes the command (`automations <CODE>`), rate-limits it, hands the code to the hook and replies. STOP ends the link too.
 *
 * A subscriber notification is one NOTIFICATION outbox row (deduplicated by its key) sent through the conversation's own adapter by the
 * ordinary delivery path (retries, dead letters, never resent after an uncertain send). Its only link is an opaque FloFi page — never an
 * approval secret (the output guard enforces it). A failed delivery is only a failed message: it changes nothing anywhere else.
 */
import { open, sealContext } from './crypto.ts';
import { deliverConversation, newOutboxId, sealReply, type DeliveryContext, type DeliveryReport } from './delivery.ts';
import { parseStateLanguage } from './state-language.ts';
import type { ChannelLanguage } from './config.ts';
import type { ChannelAdapter, ChannelId, ChannelReply } from './types.ts';

export type SubscriptionLink = { readonly ok: true; readonly label: string; readonly days: number } | { readonly ok: false; readonly code: string };
export type ChannelSubscriptions = {
  readonly link: (input: { readonly channel: ChannelId; readonly conversationId: string; readonly code: string; readonly now: Date }) => Promise<SubscriptionLink>;
  readonly unlink: (conversationId: string) => Promise<boolean>;
};
/** Subscription attempts per conversation per hour (a wrong code costs one). */
export const SUBSCRIBE_LIMIT: readonly [number, number] = Object.freeze([5, 3_600]);

export type SubscriberResult = { readonly queued: boolean; readonly code: string | null; readonly report: DeliveryReport | null };
/**
 * Queues one notification for an ACTIVE conversation of `adapter`'s channel and delivers what is due. `reply` is built per language
 * (the conversation's own language when known).
 */
export async function notifySubscriber(ctx: Omit<DeliveryContext, 'adapter'> & { readonly adapter: ChannelAdapter; readonly fallbackLanguage: ChannelLanguage },
  conversationId: string, dedupeKey: string, reply: (language: ChannelLanguage) => ChannelReply): Promise<SubscriberResult> {
  const conversation = await ctx.store.conversation(conversationId);
  if (!conversation || conversation.channel !== ctx.adapter.channel) return { queued: false, code: 'SUBSCRIBER_NOT_FOUND', report: null };
  if (conversation.status !== 'ACTIVE') return { queued: false, code: 'SUBSCRIBER_OPTED_OUT', report: null };
  if (!conversation.addressSealed) return { queued: false, code: 'SUBSCRIBER_NO_ADDRESS', report: null };
  const state = open(ctx.keys.seal, conversation.stateSealed, sealContext(ctx.tenantId, 'channel_conversations', conversationId, 'state'));
  const language = parseStateLanguage(state, ctx.fallbackLanguage), outboxId = newOutboxId();
  const inserted = await ctx.store.enqueue(conversationId, [{ outboxId, dedupeKey, kind: 'NOTIFICATION', sequence: 0, bodySealed: sealReply(ctx, outboxId, reply(language), ctx.origin),
    handoffId: null }], ctx.now());
  const report = await deliverConversation(ctx, conversationId, { kinds: ['REPLY', 'NOTIFICATION'], language });
  ctx.log.info('channel.notify', { channel: ctx.adapter.channel, conversation: conversationId, count: inserted.length, kind: 'subscriber' });
  return { queued: true, code: inserted.length ? null : 'SUBSCRIBER_DUPLICATE', report };
}

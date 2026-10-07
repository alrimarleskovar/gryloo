// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: outbound delivery from the transactional outbox, provider-independent and model-free.
 *
 * Each due message is claimed (SENDING), opened, checked by the output guard, sent through the adapter with its outbox id as the
 * correlation id, and recorded: SENT (body erased), a bounded retry for transient provider errors, or FAILED/SKIPPED (body erased).
 * Messages of one conversation leave in order; a transient failure holds the rest. Free-form messages respect the adapter's window
 * (WhatsApp: 24 hours after the user's last message) and are never sent once stale.
 *
 * An approval message's link exists only in the memory of the turn that created the approval: it is attached at send time and never
 * stored. If that memory is gone (a crash between commit and send), the link is not re-created here — the approval is withdrawn and
 * the user is told to send LINK for a fresh one. Delivery never touches FloFi execution: a failed send changes no run, no
 * reconciliation and no evidence.
 */
import type { HandoffStore } from '../../platform/index.ts';
import { revokeChannelApproval } from './approval.ts';
import type { ChannelLanguage } from './config.ts';
import { channelCopy } from './copy.ts';
import { channelRowId, keyedDigest, open, seal, sealContext, type ChannelKeys } from './crypto.ts';
import type { ChannelLogger } from './log.ts';
import { RETENTION, type ChannelStore, type OutboxKind, type OutboxRecord } from './store.ts';
import type { ChannelAdapter, ChannelAddress, ChannelReply } from './types.ts';

export type DeliveryContext = { readonly tenantId: string; readonly origin: string; readonly keys: ChannelKeys; readonly store: ChannelStore; readonly adapter: ChannelAdapter;
  readonly handoffs: Pick<HandoffStore, 'revokeForRequester'>; readonly log: ChannelLogger; readonly now: () => Date };
export type DeliveryOptions = { readonly kinds: readonly OutboxKind[]; readonly links?: ReadonlyMap<string, string>; readonly address?: ChannelAddress | null;
  readonly language?: ChannelLanguage };
export type DeliveryReport = { readonly sent: number; readonly failed: number; readonly skipped: number };

export const MAX_SEND_ATTEMPTS = 5;
const BACKOFF_SECONDS = [5, 30, 120, 600];
const STALE_SENDING_MS = 120_000;
const bodyContext = (ctx: Pick<DeliveryContext, 'tenantId'>, outboxId: string) => sealContext(ctx.tenantId, 'channel_outbox', outboxId, 'body');
export const addressContext = (tenantId: string, conversationId: string) => sealContext(tenantId, 'channel_conversations', conversationId, 'address');

/** A sealed outbound body. An approval reply is sealed WITHOUT its link (the link is attached in memory at send time). */
export function sealReply(ctx: Pick<DeliveryContext, 'tenantId' | 'keys'>, outboxId: string, reply: ChannelReply): Buffer {
  return seal(ctx.keys.seal, JSON.stringify({ ...reply, link: null }), bodyContext(ctx, outboxId));
}
export const newOutboxId = () => channelRowId('cho');

const UNSAFE = [/0x[0-9a-fA-F]{67,}/, /[A-Za-z0-9+/]{200,}={0,2}/, /flofi_(?:at|rt|code|csrf)_/, /\bBearer\s/i, /flofi_[a-z]{0,6}hs_/];
/** The last line before the provider: no calldata-sized hex, no serialized blobs, no credentials, no approval secret outside the one link. */
export function outputSafe(reply: ChannelReply, origin: string): boolean {
  const texts = [reply.text, ...reply.choices.map(c => c.label), reply.link?.label ?? ''];
  if (texts.some(t => UNSAFE.some(pattern => pattern.test(t)))) return false;
  return reply.link === null || (reply.link.url.startsWith(`${origin}/approve#flofi_chs_`) && /^[^\s]+$/.test(reply.link.url));
}

/** Sends a conversation's due messages (limited to `kinds`), in order. */
export async function deliverConversation(ctx: DeliveryContext, conversationId: string, options: DeliveryOptions): Promise<DeliveryReport> {
  const report = { sent: 0, failed: 0, skipped: 0 };
  for (let round = 0; round < 3; round++) {
    const now = ctx.now(), due = await ctx.store.claimDue(conversationId, now, new Date(now.getTime() - STALE_SENDING_MS), 8, options.kinds);
    if (!due.length) break;
    const conversation = await ctx.store.conversation(conversationId);
    let address = options.address ?? null;
    if (!address && conversation?.addressSealed) {
      try { address = JSON.parse(open(ctx.keys.seal, conversation.addressSealed, addressContext(ctx.tenantId, conversationId)) ?? 'null') as ChannelAddress | null; } catch { address = null; }
    }
    const windowOpen = ctx.adapter.windowHours === null || (conversation?.lastInboundAt !== null && conversation?.lastInboundAt !== undefined
      && now.getTime() - conversation.lastInboundAt.getTime() < ctx.adapter.windowHours * 3_600_000);
    let hold = false;
    for (const o of due) {
      if (hold) { await ctx.store.markRetry(o.outboxId, 'ORDER_HELD', new Date(now.getTime() + BACKOFF_SECONDS[0]! * 1000), now); continue; }
      const end = async (status: 'FAILED' | 'SKIPPED', code: string) => {
        await ctx.store.markEnded(o.outboxId, status, code, now);
        report[status === 'FAILED' ? 'failed' : 'skipped']++;
        ctx.log.info('channel.outbound.ended', { channel: ctx.adapter.channel, conversation: conversationId, status, code, kind: o.kind });
      };
      if (now.getTime() - o.createdAt.getTime() > RETENTION.transientMs) { await end('SKIPPED', 'EXPIRED_UNSENT'); continue; }
      if (!windowOpen) { await end('SKIPPED', 'WINDOW_CLOSED'); continue; }
      if (!address) { await end('SKIPPED', 'NO_ADDRESS'); continue; }
      let reply: ChannelReply | null;
      try { reply = JSON.parse(open(ctx.keys.seal, o.bodySealed, bodyContext(ctx, o.outboxId)) ?? 'null') as ChannelReply | null; } catch { reply = null; }
      if (!reply) { await end('FAILED', 'BODY_UNREADABLE'); continue; }
      if (o.kind === 'APPROVAL') {
        const url = options.links?.get(o.outboxId);
        if (!url) { await lostLink(ctx, conversationId, o, options.language ?? 'EN', now); await end('SKIPPED', 'APPROVAL_LINK_LOST'); continue; }
        reply = { ...reply, link: { label: channelCopy(options.language ?? 'EN').linkLabel, url } };
      }
      if (!outputSafe(reply, ctx.origin)) { await end('FAILED', 'OUTPUT_GUARD'); continue; }
      let result;
      try { result = await ctx.adapter.send(address, reply, o.outboxId); } catch { result = { ok: false as const, code: 'PROVIDER_UNAVAILABLE', retryable: true }; }
      if (result.ok) {
        await ctx.store.markSent(o.outboxId, keyedDigest(ctx.keys.provider, result.providerMessageId), now);
        report.sent++;
        ctx.log.info('channel.outbound.sent', { channel: ctx.adapter.channel, conversation: conversationId, kind: o.kind, attempts: o.attempts });
      } else if (result.retryable && o.attempts < MAX_SEND_ATTEMPTS) {
        await ctx.store.markRetry(o.outboxId, result.code, new Date(now.getTime() + (BACKOFF_SECONDS[o.attempts - 1] ?? 600) * 1000), now);
        ctx.log.warn('channel.outbound.retry', { channel: ctx.adapter.channel, conversation: conversationId, code: result.code, attempts: o.attempts });
        hold = true;
      } else await end('FAILED', result.code);
    }
    if (hold) break;
  }
  return report;
}

/** The approval link of an unsent approval message is gone: withdraw the approval and tell the user how to get a fresh one. */
async function lostLink(ctx: DeliveryContext, conversationId: string, o: OutboxRecord, language: ChannelLanguage, now: Date) {
  if (o.handoffId) await revokeChannelApproval({ handoffs: ctx.handoffs as HandoffStore }, conversationId, o.handoffId, now).catch(() => false);
  const outboxId = newOutboxId(), reply: ChannelReply = { text: channelCopy(language).linkLost, choices: [], link: null };
  await ctx.store.enqueue(conversationId, [{ outboxId, dedupeKey: `reply:${o.outboxId}:lost`, kind: 'REPLY', sequence: 0, bodySealed: sealReply(ctx, outboxId, reply),
    handoffId: o.handoffId }], now);
}

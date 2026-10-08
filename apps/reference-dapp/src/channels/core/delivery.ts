// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: outbound delivery from the transactional outbox, provider-independent and model-free.
 *
 * Each due message is claimed (SENDING, `FOR UPDATE SKIP LOCKED`), opened, checked by the output guard, sent through the conversation's
 * adapter with its outbox id as the correlation id, and recorded by the provider's answer class (`SendFailure`):
 *   accepted      SENT (body erased); later provider reports raise it to DELIVERED/READ or FAILED
 *   TRANSIENT /   PENDING again after a backoff (5 s, 20 s, 1 min, 3 min, 7 min, ±20 %, or the provider's retry-after when longer),
 *   RATE_LIMITED  then DEAD (dead letter, body erased) once the attempts are exhausted; later messages of the conversation wait (but
 *                 never an approval message whose link this turn holds)
 *   PERMANENT     FAILED (body erased), never retried
 *   UNCERTAIN     never sent again, so nobody receives a message twice: a provider that echoes our correlation id in its reports
 *                 confirms it within 10 minutes, otherwise it ends FAILED (SEND_OUTCOME_UNKNOWN)
 * A send that was claimed but never finished (a crash) becomes UNCERTAIN the same way. Retries never wait for another inbound message:
 * the scheduled dispatch (`dispatch.ts`) delivers whatever is due. Free-form messages respect the adapter's window (WhatsApp: 24
 * hours after the user's last message); a kind the adapter can send outside it (an approved template) still goes out.
 *
 * An approval message's link exists only in the memory of the turn that created the approval: it is attached at send time and never
 * stored. If it cannot be delivered from that turn — the memory is gone, the provider refused it, its outcome is unknown and cannot be
 * confirmed — the approval is withdrawn and the user is told to send LINK for a fresh one. Delivery never touches FloFi execution: a
 * failed send changes no run, no reconciliation and no evidence.
 */
import type { HandoffStore } from '../../platform/index.ts';
import { revokeChannelApproval } from './approval.ts';
import type { ChannelLanguage } from './config.ts';
import { channelCopy } from './copy.ts';
import { channelRowId, keyedDigest, open, seal, sealContext, type ChannelKeys } from './crypto.ts';
import type { ChannelLogger } from './log.ts';
import { RETENTION, type ChannelStore, type OutboxKind, type OutboxRecord } from './store.ts';
import type { ChannelAdapter, ChannelAddress, ChannelReply, SendResult } from './types.ts';

export type DeliveryContext = { readonly tenantId: string; readonly origin: string; readonly keys: ChannelKeys; readonly store: ChannelStore; readonly adapter: ChannelAdapter;
  readonly handoffs: Pick<HandoffStore, 'revokeForRequester'>; readonly log: ChannelLogger; readonly now: () => Date;
  /** Test seams: the wait between inline approval retries, and the jitter source. */
  readonly sleep?: (ms: number) => Promise<void>; readonly random?: () => number };
export type DeliveryOptions = { readonly kinds: readonly OutboxKind[]; readonly links?: ReadonlyMap<string, string>; readonly address?: ChannelAddress | null;
  readonly language?: ChannelLanguage };
export type DeliveryReport = { readonly sent: number; readonly failed: number; readonly skipped: number; readonly retrying: number; readonly uncertain: number };

export const MAX_SEND_ATTEMPTS = 6;
export const BACKOFF_SECONDS: readonly number[] = Object.freeze([5, 20, 60, 180, 420]);
/** A claimed send older than this never finished. */
export const STALE_SENDING_MS = 120_000;
/** How long a provider that reports deliveries has to confirm an UNCERTAIN send. */
export const CONFIRM_WINDOW_MS = 10 * 60_000;
/** An approval message is retried in place (its link lives only in this memory) at most this often, waiting at most this long. */
const APPROVAL_INLINE_RETRIES = 2, APPROVAL_INLINE_WAIT_MS = 3_000;
/** When a failed attempt is tried again: the backoff with ±20 % jitter, or the provider's retry-after when longer, within the body's lifetime. */
export function retryDelayMs(attempts: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  const base = (BACKOFF_SECONDS[attempts - 1] ?? BACKOFF_SECONDS.at(-1)!) * 1000 * (0.8 + 0.4 * random());
  return Math.round(Math.min(Math.max(base, retryAfterMs ?? 0), RETENTION.transientMs));
}
const confirmBy = (ctx: Pick<DeliveryContext, 'adapter'>, now: Date) => new Date(now.getTime() + (ctx.adapter.confirmsUncertainSends ? CONFIRM_WINDOW_MS : 0));
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

/** Sends a conversation's due messages (limited to `kinds`), in order, after settling interrupted and unconfirmed sends. */
export async function deliverConversation(ctx: DeliveryContext, conversationId: string, options: DeliveryOptions): Promise<DeliveryReport> {
  const report = { sent: 0, failed: 0, skipped: 0, retrying: 0, uncertain: 0 }, language = options.language ?? 'EN';
  const started = ctx.now();
  await ctx.store.settleStale(conversationId, new Date(started.getTime() - STALE_SENDING_MS), confirmBy(ctx, started), started);
  for (const lost of await ctx.store.expireUncertain(conversationId, started)) if (lost.kind === 'APPROVAL') await lostLink(ctx, conversationId, lost, language, started);
  for (let round = 0; round < 3; round++) {
    const now = ctx.now(), due = await ctx.store.claimDue(conversationId, now, 8, options.kinds);
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
      // Later messages wait behind a retrying one — except an approval message whose link is in this memory: it cannot wait.
      if (hold && !(o.kind === 'APPROVAL' && options.links?.has(o.outboxId))) {
        await ctx.store.markRetry(o.outboxId, 'ORDER_HELD', new Date(now.getTime() + BACKOFF_SECONDS[0]! * 1000), now); continue;
      }
      const end = async (status: 'FAILED' | 'DEAD' | 'SKIPPED', code: string) => {
        await ctx.store.markEnded(o.outboxId, status, code, now);
        report[status === 'SKIPPED' ? 'skipped' : 'failed']++;
        ctx.log.info('channel.outbound.ended', { channel: ctx.adapter.channel, conversation: conversationId, status, code, kind: o.kind });
        if (o.kind === 'APPROVAL' && status !== 'SKIPPED') await lostLink(ctx, conversationId, o, language, now);
      };
      if (now.getTime() - o.createdAt.getTime() > RETENTION.transientMs) { await end('SKIPPED', 'EXPIRED_UNSENT'); continue; }
      if (!windowOpen && !ctx.adapter.outsideWindow.includes(o.kind)) { await end('SKIPPED', 'WINDOW_CLOSED'); continue; }
      if (!address) { await end('SKIPPED', 'NO_ADDRESS'); continue; }
      let reply: ChannelReply | null;
      try { reply = JSON.parse(open(ctx.keys.seal, o.bodySealed, bodyContext(ctx, o.outboxId)) ?? 'null') as ChannelReply | null; } catch { reply = null; }
      if (!reply) { await end('FAILED', 'BODY_UNREADABLE'); continue; }
      if (o.kind === 'APPROVAL') {
        const url = options.links?.get(o.outboxId);
        if (!url) { await lostLink(ctx, conversationId, o, language, now); await end('SKIPPED', 'APPROVAL_LINK_LOST'); continue; }
        reply = { ...reply, link: { label: channelCopy(language).linkLabel, url } };
      }
      if (!outputSafe(reply, ctx.origin)) { await end('FAILED', 'OUTPUT_GUARD'); continue; }
      const result = await send(ctx, address, reply, o, windowOpen);
      if (result.ok) {
        await ctx.store.markSent(o.outboxId, keyedDigest(ctx.keys.provider, result.providerMessageId), now);
        report.sent++;
        ctx.log.info('channel.outbound.sent', { channel: ctx.adapter.channel, conversation: conversationId, kind: o.kind, attempts: o.attempts });
      } else if (result.failure === 'UNCERTAIN' && (ctx.adapter.confirmsUncertainSends || o.kind !== 'APPROVAL')) {
        // Never resent. A provider that reports deliveries can still confirm it; otherwise it ends unknown.
        if (ctx.adapter.confirmsUncertainSends) { await ctx.store.markUncertain(o.outboxId, result.code, confirmBy(ctx, now), now); report.uncertain++; }
        else await end('FAILED', 'SEND_OUTCOME_UNKNOWN');
        ctx.log.warn('channel.outbound.uncertain', { channel: ctx.adapter.channel, conversation: conversationId, code: result.code, kind: o.kind });
      } else if ((result.failure === 'TRANSIENT' || result.failure === 'RATE_LIMITED') && o.kind !== 'APPROVAL' && o.attempts < MAX_SEND_ATTEMPTS) {
        await ctx.store.markRetry(o.outboxId, result.code, new Date(now.getTime() + retryDelayMs(o.attempts, result.retryAfterMs, ctx.random)), now);
        report.retrying++;
        ctx.log.warn('channel.outbound.retry', { channel: ctx.adapter.channel, conversation: conversationId, code: result.code, attempts: o.attempts });
        hold = true;
      } else await end(result.failure === 'TRANSIENT' || result.failure === 'RATE_LIMITED' ? (o.kind === 'APPROVAL' ? 'FAILED' : 'DEAD') : 'FAILED',
        result.failure === 'UNCERTAIN' ? 'SEND_OUTCOME_UNKNOWN' : result.code);
    }
    if (hold) break;
  }
  return report;
}

/** One send. An approval message is retried in place a couple of times (briefly), because its link exists only in this memory. */
async function send(ctx: DeliveryContext, address: ChannelAddress, reply: ChannelReply, o: OutboxRecord, windowOpen: boolean): Promise<SendResult> {
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    let result: SendResult;
    try { result = await ctx.adapter.send(address, reply, o.outboxId, { kind: o.kind, windowOpen }); }
    catch { result = { ok: false, code: 'PROVIDER_SEND_FAILED', failure: 'UNCERTAIN', retryAfterMs: null }; }
    if (result.ok || o.kind !== 'APPROVAL' || attempt >= APPROVAL_INLINE_RETRIES || (result.failure !== 'TRANSIENT' && result.failure !== 'RATE_LIMITED')) return result;
    const wait = Math.max(1_000 * (attempt + 1), result.retryAfterMs ?? 0);
    if (wait > APPROVAL_INLINE_WAIT_MS) return result;
    await sleep(wait);
  }
}

/** The approval link of an unsent approval message is gone: withdraw the approval and tell the user how to get a fresh one. */
async function lostLink(ctx: DeliveryContext, conversationId: string, o: OutboxRecord, language: ChannelLanguage, now: Date) {
  if (o.handoffId) await revokeChannelApproval({ handoffs: ctx.handoffs as HandoffStore }, conversationId, o.handoffId, now).catch(() => false);
  const outboxId = newOutboxId(), reply: ChannelReply = { text: channelCopy(language).linkLost, choices: [], link: null };
  await ctx.store.enqueue(conversationId, [{ outboxId, dedupeKey: `reply:${o.outboxId}:lost`, kind: 'REPLY', sequence: 0, bodySealed: sealReply(ctx, outboxId, reply),
    handoffId: o.handoffId }], now);
}

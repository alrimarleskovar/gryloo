// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram Bot API webhook contract (core.telegram.org/bots/api, checked 2026-10-08): authenticity and
 * normalization of `Update` objects into Channel Core's provider-independent events.
 *
 *   POST  `X-Telegram-Bot-Api-Secret-Token` must equal TELEGRAM_WEBHOOK_SECRET (the `secret_token` given to setWebhook), compared in
 *         constant time before anything is parsed; one Update per request, `update_id` is the deduplication key (Telegram redelivers
 *         the same update until it gets a 2xx)
 *
 * Normalization (private chats with people only; groups, channels, bots, edits and inline queries are ignored):
 *   message.text           → TEXT; bot commands keep their word (`/start` → "start", `/stop` → "stop", `/help@FloFiBot` → "help")
 *   message (other kinds)  → UNSUPPORTED (photo, voice, document, sticker, location…: never interpreted)
 *   callback_query.data    → CHOICE (a tap on one of FloFi's own buttons); its id is acknowledged with answerCallbackQuery
 *   my_chat_member kicked  → PROVIDER_OPT_OUT (the user blocked the bot); other member updates are ignored
 * Telegram reports no delivery or read status to bots, so a webhook never carries delivery updates.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { InboundContent, InboundMessage, NormalizedInbound } from '../core/types.ts';
import { telegramUserAllowed, type TelegramConfig } from './config.ts';

export const TELEGRAM_CHANNEL = 'TELEGRAM';
export const MAX_UPDATE_BYTES = 1024 * 1024;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): string | null => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** True only when the secret-token header equals the configured webhook secret. */
export function secretTokenValid(header: string | null, secret: string): boolean {
  if (!header || header.length > 256) return false;
  return timingSafeEqual(digest(header), digest(secret));
}

const COMMAND = /^\/([A-Za-z][A-Za-z0-9_]{0,31})(?:@[A-Za-z0-9_]{1,64})?(?:\s+[\s\S]*)?$/;
const UNSUPPORTED_KINDS = ['photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'document', 'sticker', 'location', 'venue', 'contact', 'poll', 'dice', 'story',
  'game', 'invoice'];
function messageContent(message: Record<string, unknown>): InboundContent {
  if (typeof message.text === 'string') {
    const command = COMMAND.exec(message.text.trim());
    // A bot command carries its word only (a /start deep-link payload is never read).
    return { kind: 'TEXT', text: command ? command[1]!.toLowerCase() : message.text.slice(0, 4_096) };
  }
  return { kind: 'UNSUPPORTED', type: UNSUPPORTED_KINDS.find(kind => kind in message) ?? 'unknown' };
}
type Person = { readonly user: string; readonly chat: string };
/** A private chat with a person (never a bot), where the chat is the user's own. */
function person(from: unknown, chat: unknown): Person | null {
  if (!plain(from) || from.is_bot !== false || !plain(chat) || chat.type !== 'private') return null;
  const user = id(from.id), chatId = id(chat.id);
  return user && chatId && user === chatId ? { user, chat: chatId } : null;
}

/** One Update → Channel Core events. Anything that is not an Update, or not from a private chat with a person, is only counted. */
export function parseUpdate(body: unknown, config: Pick<TelegramConfig, 'botId' | 'allowedUsers'>, receivedAt: Date): NormalizedInbound | null {
  if (!plain(body) || typeof body.update_id !== 'number' || !Number.isSafeInteger(body.update_id) || body.update_id < 0) return null;
  const eventId = `update:${body.update_id}`, none = { messages: [], deliveries: [], ignored: 1, acknowledgements: [] };
  const event = (who: Person, content: InboundContent, sentAt: Date): InboundMessage => ({ channel: TELEGRAM_CHANNEL, eventId,
    subject: { business: config.botId, user: who.user }, sendTo: { kind: 'chat', value: who.chat }, sentAt, content, allowed: telegramUserAllowed(config, who.user) });
  const sent = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? new Date(value * 1000) : null;
  if (plain(body.message)) {
    const who = person(body.message.from, body.message.chat), at = sent(body.message.date);
    if (!who || !at || id(body.message.message_id) === null) return none;
    return { messages: [event(who, messageContent(body.message), at)], deliveries: [], ignored: 0, acknowledgements: [] };
  }
  if (plain(body.callback_query)) {
    const q = body.callback_query, message = plain(q.message) ? q.message : null;
    const who = message ? person(q.from, message.chat) : null;
    const data = typeof q.data === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(q.data) ? q.data : null;
    const ack = typeof q.id === 'string' && /^[0-9]{1,32}$/.test(q.id) ? [q.id] : [];
    if (!who || !data) return { ...none, acknowledgements: ack };
    return { messages: [event(who, { kind: 'CHOICE', id: data, label: data }, receivedAt)], deliveries: [], ignored: 0, acknowledgements: ack };
  }
  if (plain(body.my_chat_member)) {
    const m = body.my_chat_member, who = person(m.from, m.chat), at = sent(m.date);
    if (!who || !at || !plain(m.new_chat_member) || m.new_chat_member.status !== 'kicked') return none;
    return { messages: [event(who, { kind: 'PROVIDER_OPT_OUT' }, at)], deliveries: [], ignored: 0, acknowledgements: [] };
  }
  return none;
}

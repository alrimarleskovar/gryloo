// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp Cloud API webhook contract, as Meta documents it (checked 2026-10-07): subscription verification,
 * payload authenticity and normalization into Channel Core's provider-independent events.
 *
 *   GET   `hub.mode=subscribe`, `hub.verify_token` (constant-time against WHATSAPP_WEBHOOK_VERIFY_TOKEN), `hub.challenge` echoed as text
 *   POST  `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 of the payload under the app secret, verified over the EXACT raw bytes
 *         before anything is parsed (Meta signs the bytes it sends, escapes included); then only `whatsapp_business_account` entries of
 *         this business account, `messages` changes of this phone number id, are read
 *
 * Normalization: text → TEXT; reply-button / list choices → CHOICE; media, voice, location, contacts, orders… → UNSUPPORTED (never
 * interpreted); reactions, system notices and group messages are ignored; statuses → delivery updates. The sender is identified by its
 * business-scoped user id (BSUID) when present, otherwise its phone number — and only ever as a provider id, never as a wallet.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeliveryStatus, DeliveryUpdate, InboundContent, InboundMessage } from '../core/types.ts';
import { senderAllowed, type WhatsAppConfig } from './config.ts';

export const WHATSAPP_CHANNEL = 'WHATSAPP';
export const MAX_WEBHOOK_BYTES = 4 * 1024 * 1024;
const CHALLENGE = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_ID = /^[A-Za-z0-9_.=+/:-]{1,512}$/, PHONE = /^[0-9]{6,20}$/, BSUID = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/, CHOICE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value: string) => createHmac('sha256', 'flofi/whatsapp/compare').update(value, 'utf8').digest();
const sameToken = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

/** The subscription handshake. Anything but an exact `subscribe` with the configured token is refused (403). */
export function verifySubscription(url: URL, config: Pick<WhatsAppConfig, 'verifyToken'>): Response {
  const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token') ?? '', challenge = url.searchParams.get('hub.challenge') ?? '';
  const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (mode !== 'subscribe' || !token || token.length > 256 || !sameToken(token, config.verifyToken) || !CHALLENGE.test(challenge))
    return new Response('forbidden', { status: 403, headers });
  return new Response(challenge, { status: 200, headers });
}

/** True only when `X-Hub-Signature-256` is exactly `sha256=<64 hex>` and equals HMAC-SHA256(raw bytes) under one of the app secrets. */
export function signatureValid(raw: Uint8Array, header: string | null, secrets: readonly string[]): boolean {
  const match = /^sha256=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return false;
  const presented = Buffer.from(match[1]!, 'hex');
  let valid = false;
  for (const secret of secrets) if (timingSafeEqual(createHmac('sha256', secret).update(raw).digest(), presented)) valid = true;
  return valid;
}

export type ParsedWebhook = { readonly messages: readonly InboundMessage[]; readonly deliveries: readonly DeliveryUpdate[]; readonly ignored: number };
const STATUS: Readonly<Record<string, DeliveryStatus>> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', played: 'READ', failed: 'FAILED' };
const IGNORED_TYPES = new Set(['reaction', 'system', 'ephemeral', 'request_welcome']);

function contentOf(message: Record<string, unknown>): InboundContent | null {
  const type = typeof message.type === 'string' ? message.type : '';
  if (IGNORED_TYPES.has(type)) return null;
  if (type === 'text') {
    const body = plain(message.text) && typeof message.text.body === 'string' ? message.text.body : null;
    return body === null ? null : { kind: 'TEXT', text: body.slice(0, 4_096) };
  }
  if (type === 'interactive' && plain(message.interactive)) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    if (plain(reply) && typeof reply.id === 'string' && CHOICE_ID.test(reply.id) && typeof reply.title === 'string') return { kind: 'CHOICE', id: reply.id, label: reply.title.slice(0, 80) };
    return { kind: 'UNSUPPORTED', type: 'interactive' };
  }
  if (type === 'button' && plain(message.button) && typeof message.button.text === 'string') {
    const id = typeof message.button.payload === 'string' && CHOICE_ID.test(message.button.payload) ? message.button.payload : 'button';
    return { kind: 'CHOICE', id, label: message.button.text.slice(0, 80) };
  }
  return { kind: 'UNSUPPORTED', type: /^[a-z_]{1,32}$/.test(type) ? type : 'unknown' };
}

/** Meta's payload → Channel Core events. Entries for another account or number, malformed items and ignored types are only counted. */
export function parseWebhook(body: unknown, config: WhatsAppConfig): ParsedWebhook | null {
  if (!plain(body) || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return null;
  const messages: InboundMessage[] = [], deliveries: DeliveryUpdate[] = [];
  let ignored = 0;
  for (const entry of body.entry) {
    if (!plain(entry) || entry.id !== config.businessAccountId || !Array.isArray(entry.changes)) { ignored++; continue; }
    for (const change of entry.changes) {
      if (!plain(change) || change.field !== 'messages' || !plain(change.value)) { ignored++; continue; }
      const value = change.value;
      if (value.messaging_product !== 'whatsapp' || !plain(value.metadata) || value.metadata.phone_number_id !== config.phoneNumberId) { ignored++; continue; }
      const contacts = Array.isArray(value.contacts) ? value.contacts.filter(plain) : [];
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (!plain(message) || typeof message.id !== 'string' || !MESSAGE_ID.test(message.id) || typeof message.timestamp !== 'string' || !/^[0-9]{1,12}$/.test(message.timestamp)
          || 'group_id' in message) { ignored++; continue; }
        const phone = typeof message.from === 'string' && PHONE.test(message.from) ? message.from : null;
        const contact = contacts.find(c => (phone && c.wa_id === phone) || (typeof message.from_user_id === 'string' && c.user_id === message.from_user_id));
        const bsuidRaw = typeof message.from_user_id === 'string' ? message.from_user_id : contact && typeof contact.user_id === 'string' ? contact.user_id : null;
        const bsuid = bsuidRaw && BSUID.test(bsuidRaw) ? bsuidRaw : null;
        const user = bsuid ?? phone, content = contentOf(message);
        if (!user || !content) { ignored++; continue; }
        messages.push({ channel: WHATSAPP_CHANNEL, eventId: message.id, subject: { business: config.phoneNumberId, user },
          sendTo: bsuid ? { kind: 'bsuid', value: bsuid } : { kind: 'phone', value: phone! }, sentAt: new Date(Number(message.timestamp) * 1000), content,
          allowed: senderAllowed(config, [bsuid, phone]) });
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!plain(status) || typeof status.id !== 'string' || !MESSAGE_ID.test(status.id) || typeof status.status !== 'string' || !STATUS[status.status]) { ignored++; continue; }
        const errors = Array.isArray(status.errors) ? status.errors.filter(plain) : [];
        const code = errors[0] && (typeof errors[0].code === 'number' || typeof errors[0].code === 'string') ? `PROVIDER_${String(errors[0].code).replace(/[^0-9A-Z]/gi, '')}` : null;
        deliveries.push({ channel: WHATSAPP_CHANNEL, providerMessageId: status.id, status: STATUS[status.status]!,
          correlationId: typeof status.biz_opaque_callback_data === 'string' ? status.biz_opaque_callback_data.slice(0, 512) : null, errorCode: code });
      }
    }
  }
  return { messages, deliveries, ignored };
}

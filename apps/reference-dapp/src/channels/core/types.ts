// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the provider-independent boundary of FloFi's conversational channels.
 *
 *   provider adapter (WhatsApp today; Telegram or another permitted channel later)
 *     → InboundMessage / DeliveryUpdate  (authenticated and normalized by the adapter)
 *     → Channel Core                     (conversation, StrategySpec, shared platform, approval handoff, status, outbox)
 *     → ChannelReply                     (FloFi-written text, a few choices, at most one link)
 *     → adapter.send                     (provider formatting and transport)
 *
 * A channel conversation is a CHANNEL_CONVERSATION requester of the shared approval model. Its sender id is never a wallet identity,
 * and nothing a channel carries — a message, a choice, an approval link — is financial authority. Provider ids live only in memory or
 * keyed/encrypted at rest; they are never logged.
 */

/** A channel's stable name: `WHATSAPP` today. A pattern, not an enum, so a new channel needs no schema change. */
export const CHANNEL_ID = /^[A-Z][A-Z0-9_]{1,31}$/;
export type ChannelId = string;

/** Who a message is from, as the provider identifies them: the business account receiving it and the sender's provider id. */
export type ChannelSubject = { readonly business: string; readonly user: string };
/** Where replies go (the provider's own addressing); kept only encrypted at rest and erased once the messaging window has closed. */
export type ChannelAddress = { readonly kind: string; readonly value: string };

export type InboundContent =
  | { readonly kind: 'TEXT'; readonly text: string }
  /** The user tapped one of FloFi's own choices: its id and visible label. */
  | { readonly kind: 'CHOICE'; readonly id: string; readonly label: string }
  /** Media, voice, location, contacts…: never interpreted. `type` is the provider's closed type name. */
  | { readonly kind: 'UNSUPPORTED'; readonly type: string };
export type InboundMessage = {
  readonly channel: ChannelId;
  /** The provider's id of this message: the deduplication key (digested before storage). */
  readonly eventId: string;
  readonly subject: ChannelSubject;
  readonly sendTo: ChannelAddress;
  /** When the provider says the user sent it. Ordering and the messaging window use it; delivery time never does. */
  readonly sentAt: Date;
  readonly content: InboundContent;
  /** The adapter's allowlist verdict (default deny). A sender outside it gets no conversation and no reply. */
  readonly allowed: boolean;
};
export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
/** The provider's report about one outbound message: our correlation id when echoed, its message id and status. */
export type DeliveryUpdate = { readonly channel: ChannelId; readonly correlationId: string | null; readonly providerMessageId: string;
  readonly status: DeliveryStatus; readonly errorCode: string | null };

export type ReplyChoice = { readonly id: string; readonly label: string };
/** What Channel Core asks an adapter to send: FloFi-written text, up to a few choices, and at most one link (the approval link). */
export type ChannelReply = { readonly text: string; readonly choices: readonly ReplyChoice[]; readonly link: { readonly label: string; readonly url: string } | null };
export type SendResult = { readonly ok: true; readonly providerMessageId: string } | { readonly ok: false; readonly code: string; readonly retryable: boolean };

/** One provider, as Channel Core uses it for outbound traffic. Inbound authentication and normalization stay inside the adapter. */
export interface ChannelAdapter {
  readonly channel: ChannelId;
  /** The requester's client id on /approve, e.g. `whatsapp:<phone number id>`. */
  readonly clientId: string;
  /** The name the owner sees on /approve ("proposed via WhatsApp"). */
  readonly displayName: string;
  /** Free-form replies are allowed this many hours after the user's last message; null when the provider has no such window. */
  readonly windowHours: number | null;
  readonly send: (to: ChannelAddress, reply: ChannelReply, correlationId: string) => Promise<SendResult>;
}

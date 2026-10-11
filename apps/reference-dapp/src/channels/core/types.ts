// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the provider-independent boundary of FloFi's conversational channels.
 *
 *   provider (WhatsApp, Telegram, …: `ChannelProvider`)
 *     → authentic(raw bytes, headers) · normalize(payload)   inbound verification and normalization, inside the provider
 *     → InboundMessage / DeliveryUpdate                     provider-neutral events
 *     → Channel Core                                        conversation, StrategySpec, shared platform, approval handoff, status, outbox
 *     → ChannelReply                                        FloFi-written text, a few choices, at most one link
 *     → adapter.send → SendResult                           provider formatting and transport; a closed failure class
 *
 * A channel conversation is a CHANNEL_CONVERSATION requester of the shared approval model. Its sender id is never a wallet identity,
 * and nothing a channel carries — a message, a choice, an approval link — is financial authority. Provider ids live only in memory or
 * keyed/encrypted at rest; they are never logged.
 */
import type { WorkflowVisualModel } from '../../platform/workflow-visual.ts';
import type { VisualLanguage } from '../../platform/workflow-visual-layout.ts';

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
  | { readonly kind: 'UNSUPPORTED'; readonly type: string }
  /** The provider reports that the user stopped the conversation on their side (e.g. blocked the bot): an opt-out, never answered. */
  | { readonly kind: 'PROVIDER_OPT_OUT' };
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
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: a provider-neutral request to show the proposed workflow as a picture next to the text: the
 * shared presentation model of the canonical workflow, and the reply's language. Presentation only — the text and the approval link
 * are the message; the picture is never its authority and never the handoff.
 */
export type ChannelVisual = { readonly model: WorkflowVisualModel; readonly language: VisualLanguage };
/**
 * What Channel Core asks an adapter to send: FloFi-written text, up to a few choices, at most one link (the approval link) and, for a
 * workflow proposal, an optional visual.
 */
export type ChannelReply = { readonly text: string; readonly choices: readonly ReplyChoice[]; readonly link: { readonly label: string; readonly url: string } | null;
  readonly visual?: ChannelVisual | null };
/** A reply's visual, rendered once by the shared renderer: PNG bytes (never a URL) and their text alternative. */
export type ChannelImage = { readonly mimeType: 'image/png'; readonly bytes: Uint8Array; readonly alt: string };
/** The one shared renderer, injected by the channel wiring: a reply's visual as a PNG, or null when it cannot be drawn (text only then). */
export type ChannelVisualRenderer = (visual: ChannelVisual) => Promise<ChannelImage | null>;
/** Why a message is sent: a turn's reply, the approval message carrying the link, or a status notification outside a turn. */
export type ReplyKind = 'REPLY' | 'APPROVAL' | 'NOTIFICATION';

/**
 * How a send failed, as the provider's answer allows Channel Core to know:
 *   TRANSIENT     not accepted, safe to try again (a 5xx with the provider's error body, a connection refused before sending)
 *   RATE_LIMITED  not accepted because of throughput; try again after `retryAfterMs` when the provider says so
 *   PERMANENT     refused for good (authorization, policy, recipient unreachable, invalid request): never retried
 *   UNCERTAIN     the provider may have accepted it (a timeout after sending, a malformed success): never sent again, so a user never
 *                 receives a message twice; a provider that reports deliveries (`confirmsUncertainSends`) can still confirm it
 */
export type SendFailure = 'TRANSIENT' | 'RATE_LIMITED' | 'PERMANENT' | 'UNCERTAIN';
export type SendResult = { readonly ok: true; readonly providerMessageId: string }
  | { readonly ok: false; readonly code: string; readonly failure: SendFailure; readonly retryAfterMs: number | null };
/**
 * The circumstances of one send: what the message is, whether the provider's free-form messaging window is open and, when the reply's
 * visual was rendered, the picture. An adapter that can attach media shows it with the text and the same link; any media problem falls
 * back to the text message, which alone is always complete.
 */
export type SendContext = { readonly kind: ReplyKind; readonly windowOpen: boolean; readonly image?: ChannelImage | null };

/** One provider, as Channel Core uses it for outbound traffic. */
export interface ChannelAdapter {
  readonly channel: ChannelId;
  /** The requester's client id on /approve, e.g. `whatsapp:<phone number id>` or `telegram:<bot id>`. */
  readonly clientId: string;
  /** The name the owner sees on /approve ("proposed via WhatsApp"). */
  readonly displayName: string;
  /** Free-form replies are allowed this many hours after the user's last message; null when the provider has no such window. */
  readonly windowHours: number | null;
  /** Kinds this provider can still send once the window has closed (WhatsApp: notifications, through an approved template). */
  readonly outsideWindow: readonly ReplyKind[];
  /** Statuses the provider reports after accepting a message (WhatsApp: delivered, read, failed; Telegram's Bot API: none). */
  readonly deliveryReports: readonly DeliveryStatus[];
  /** Whether a later provider report can confirm an UNCERTAIN send (it echoes our correlation id). */
  readonly confirmsUncertainSends: boolean;
  /** Whether these choices can be shown as the provider's own buttons; otherwise Channel Core lists them as numbers in the text. */
  readonly choicesFit: (choices: readonly ReplyChoice[]) => boolean;
  readonly send: (to: ChannelAddress, reply: ChannelReply, correlationId: string, context: SendContext) => Promise<SendResult>;
}

/** An authentic provider payload, normalized. */
export type NormalizedInbound = {
  readonly messages: readonly InboundMessage[]; readonly deliveries: readonly DeliveryUpdate[]; readonly ignored: number;
  /** Acknowledgements the provider expects once the events are recorded (Telegram callback queries); opaque, never stored. */
  readonly acknowledgements: readonly string[];
};
export type ProviderMode = 'fixture' | 'live';
/**
 * One configured provider endpoint: inbound verification and normalization plus the outbound adapter. Every provider exposes the
 * same contract, so Channel Core, the webhook boundary (`src/channels/http.ts`) and the scheduled dispatch never branch on a provider.
 */
export interface ChannelProvider {
  /** The webhook's path segment: `/api/channels/<route>`. */
  readonly route: string;
  /** `fixture` records outbound messages and sends nothing; `live` talks to the provider. */
  readonly mode: ProviderMode;
  /** The provider-assigned id of this endpoint (phone number id, bot id): public, part of the conversation key. */
  readonly businessId: string;
  readonly maxBodyBytes: number;
  readonly adapter: ChannelAdapter;
  /** The answer to a non-POST request the provider defines (WhatsApp's subscription handshake); null when there is none (405). */
  readonly handshake: ((url: URL) => Response) | null;
  /** Authenticity of a POST, decided over its exact raw bytes and headers before anything is parsed; constant-time. */
  readonly authentic: (raw: Uint8Array, headers: Headers) => boolean;
  /** The closed code a request that fails `authentic` is refused with (401). */
  readonly authenticationFailure: string;
  /** An authentic payload → events; null when it is not for this endpoint (acknowledged so the provider stops, never processed). */
  readonly normalize: (body: unknown, receivedAt: Date) => NormalizedInbound | null;
  /** Owed acknowledgements, best effort, after the events are recorded; a failure never changes processing. */
  readonly acknowledge: (acknowledgements: readonly string[]) => Promise<void>;
  /** The secrets this provider holds; Channel Core's own secret must differ from each. */
  readonly secrets: readonly string[];
}

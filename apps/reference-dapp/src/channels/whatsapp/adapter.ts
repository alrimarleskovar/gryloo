// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: WhatsApp as a Channel Core adapter — provider concerns only (rendering, transport, error classes, the 24-hour
 * customer service window). Requester identity on /approve: client `whatsapp:<phone number id>`, shown as "WhatsApp".
 *
 * Inside the window every kind is sent free-form. Outside it only a notification may go, through the owner's approved template
 * (`outsideWindow`); without a template nothing is sent then. Meta reports sent/delivered/read/failed for every message and echoes the
 * outbox id (`biz_opaque_callback_data`), so an UNCERTAIN send is confirmed by its status webhook.
 */
import type { ChannelAdapter, ChannelProvider, SendResult } from '../core/types.ts';
import { whatsAppSecrets, type WhatsAppConfig, type WhatsAppTemplate } from './config.ts';
import { choicesFitButtons, renderMessage, renderTemplate } from './render.ts';
import { classifyResponse, fixtureTransport, graphTransport, type WhatsAppTransport } from './transport.ts';
import { MAX_WEBHOOK_BYTES, parseWebhook, signatureValid, verifySubscription, WHATSAPP_CHANNEL } from './webhook.ts';

/** Free-form replies are allowed for 24 hours after the user's last message (Meta's customer service window). */
export const WHATSAPP_WINDOW_HOURS = 24;
export function createWhatsAppAdapter(phoneNumberId: string, transport: WhatsAppTransport, template: WhatsAppTemplate | null = null): ChannelAdapter {
  const adapter: ChannelAdapter = { channel: WHATSAPP_CHANNEL, clientId: `whatsapp:${phoneNumberId}`, displayName: 'WhatsApp', windowHours: WHATSAPP_WINDOW_HOURS,
    outsideWindow: template ? ['NOTIFICATION'] : [], deliveryReports: ['SENT', 'DELIVERED', 'READ', 'FAILED'], confirmsUncertainSends: true,
    choicesFit: choicesFitButtons,
    send: async (to, reply, correlationId, context): Promise<SendResult> => {
      if (context.windowOpen) return classifyResponse(await transport({ body: renderMessage(to, reply, correlationId) }));
      if (context.kind !== 'NOTIFICATION' || !template || reply.link) return { ok: false, code: 'PROVIDER_WINDOW_CLOSED', failure: 'PERMANENT', retryAfterMs: null };
      return classifyResponse(await transport({ body: renderTemplate(to, reply, correlationId, template) }));
    } };
  return Object.freeze(adapter);
}

/** The deployment's transport: the Cloud API only for the live provider (recorded clearance, see config.ts), the recording fixture otherwise. */
export function whatsAppTransport(config: WhatsAppConfig): WhatsAppTransport {
  return config.provider === 'live' && config.accessToken && config.graphVersion
    ? graphTransport({ accessToken: config.accessToken, graphVersion: config.graphVersion, phoneNumberId: config.phoneNumberId }) : fixtureTransport();
}
export function createWhatsAppProvider(config: WhatsAppConfig, transport: WhatsAppTransport = whatsAppTransport(config)): ChannelProvider {
  return Object.freeze({ route: 'whatsapp', mode: config.provider, businessId: config.phoneNumberId, maxBodyBytes: MAX_WEBHOOK_BYTES,
    authenticationFailure: 'WHATSAPP_SIGNATURE_INVALID', adapter: createWhatsAppAdapter(config.phoneNumberId, transport, config.template),
    handshake: (url: URL) => verifySubscription(url, config),
    authentic: (raw: Uint8Array, headers: Headers) => signatureValid(raw, headers.get('x-hub-signature-256'), config.appSecrets),
    normalize: (body: unknown) => { const parsed = parseWebhook(body, config); return parsed && { ...parsed, acknowledgements: [] }; },
    acknowledge: async () => undefined, secrets: whatsAppSecrets(config) });
}

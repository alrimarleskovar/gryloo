// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: WhatsApp as a Channel Core adapter — provider concerns only (rendering, transport, error classes, the 24-hour
 * customer service window). Requester identity on /approve: client `whatsapp:<phone number id>`, shown as "WhatsApp".
 */
import type { ChannelAdapter } from '../core/types.ts';
import { choicesFitButtons, renderMessage } from './render.ts';
import { classifyResponse, type WhatsAppTransport } from './transport.ts';
import { WHATSAPP_CHANNEL } from './webhook.ts';

/** Free-form replies are allowed for 24 hours after the user's last message (Meta's customer service window). */
export const WHATSAPP_WINDOW_HOURS = 24;
export function createWhatsAppAdapter(phoneNumberId: string, transport: WhatsAppTransport): ChannelAdapter {
  const adapter: ChannelAdapter = { channel: WHATSAPP_CHANNEL, clientId: `whatsapp:${phoneNumberId}`, displayName: 'WhatsApp', windowHours: WHATSAPP_WINDOW_HOURS,
    choicesFit: choicesFitButtons,
    send: async (to, reply, correlationId) => classifyResponse(await transport({ body: renderMessage(to, reply, correlationId) })) };
  return Object.freeze(adapter);
}

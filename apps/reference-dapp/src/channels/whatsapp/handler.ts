// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp webhook (`/api/channels/whatsapp`) — the shared provider boundary (`../http.ts`) with WhatsApp's
 * provider: GET subscription verification, POST `X-Hub-Signature-256` over the raw bytes (4 MiB bound), Cloud API payloads of this
 * account and number. Behind the D1 activation guard (`config.ts`): fixture provider only and never hosted until clearance is recorded.
 */
import { handleChannelWebhook, type ChannelWebhookOptions } from '../http.ts';
import type { WhatsAppTransport } from './transport.ts';

export type WhatsAppWebhookOptions = Omit<ChannelWebhookOptions, 'seams'> & { readonly transport?: WhatsAppTransport };
export function handleWhatsAppWebhook(request: Request, options: WhatsAppWebhookOptions = {}): Promise<Response> {
  const { transport, ...rest } = options;
  return handleChannelWebhook('whatsapp', request, { ...rest, ...transport ? { seams: { whatsappTransport: transport } } : {} });
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: `/api/channels/whatsapp` — the WhatsApp Cloud API webhook of FloFi's conversational channel (see
 * `src/channels/whatsapp/handler.ts`). Off unless `FLOFI_WHATSAPP=enabled`; behind owner decision D1 (the WhatsApp Business Messaging
 * Policy prohibits facilitating the exchange of currency): fixture provider only and refused on every hosted deployment until the owner's
 * written clearance is recorded in code (`src/channels/whatsapp/config.ts`).
 */
import { after } from 'next/server';
import { handleWhatsAppWebhook } from '../../../../channels/whatsapp/handler';
import { channelRouteLogger } from '../../../../channels/route-logger';

export const dynamic = 'force-dynamic';
// Turn processing (an interpreter call, a read-only preview) runs after the response, within the function's time bound.
export const maxDuration = 300;

async function serve(request: Request): Promise<Response> {
  return handleWhatsAppWebhook(request, { logger: await channelRouteLogger(), schedule: work => after(work) });
}
export const GET = serve;
export const POST = serve;

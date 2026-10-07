// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: `/api/channels/whatsapp` — the WhatsApp Cloud API webhook of FloFi's conversational channel (see
 * `src/channels/whatsapp/handler.ts`). Off unless `FLOFI_WHATSAPP=enabled`, and in this build refused on every hosted deployment
 * (owner decision D1: the WhatsApp Business Messaging Policy prohibits facilitating the exchange of currency). Fixture provider only.
 */
import { after } from 'next/server';
import { handleWhatsAppWebhook } from '../../../../channels/whatsapp/handler';
import type { ChannelLogSink } from '../../../../channels/core/log';

export const dynamic = 'force-dynamic';
// Turn processing (an interpreter call, a read-only preview) runs after the response, within the function's time bound.
export const maxDuration = 300;

let logger: Promise<ChannelLogSink> | null = null;
const log = () => logger ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-channels' }));

async function serve(request: Request): Promise<Response> {
  return handleWhatsAppWebhook(request, { logger: await log(), schedule: work => after(work) });
}
export const GET = serve;
export const POST = serve;

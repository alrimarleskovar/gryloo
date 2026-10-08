// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: `/api/channels/telegram` — the Telegram Bot API webhook of FloFi's conversational channel (see
 * `src/channels/telegram/handler.ts`). Off unless `FLOFI_TELEGRAM=enabled`; register it with setWebhook (`backend/channels-admin.ts`).
 */
import { after } from 'next/server';
import { handleTelegramWebhook } from '../../../../channels/telegram/handler';
import { channelRouteLogger } from '../../../../channels/route-logger';

export const dynamic = 'force-dynamic';
// Turn processing (an interpreter call, a read-only preview) runs after the response, within the function's time bound.
export const maxDuration = 300;

async function serve(request: Request): Promise<Response> {
  return handleTelegramWebhook(request, { logger: await channelRouteLogger(), schedule: work => after(work) });
}
export const GET = serve;
export const POST = serve;

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: `/api/channels/dispatch` — the channels' scheduled sweep (retries, stranded turns, status notifications,
 * retention), for Vercel Cron (GET) or any scheduler (POST) presenting the bearer whose SHA-256 is FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256.
 * See `src/channels/dispatch-http.ts`.
 */
import { handleChannelDispatch } from '../../../../channels/dispatch-http';
import { channelRouteLogger } from '../../../../channels/route-logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function serve(request: Request): Promise<Response> {
  return handleChannelDispatch(request, { logger: await channelRouteLogger() });
}
export const GET = serve;
export const POST = serve;

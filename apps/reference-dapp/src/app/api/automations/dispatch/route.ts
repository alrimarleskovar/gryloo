// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: `/api/automations/dispatch` — the automations' scheduled pass (expire, discover due rules, evaluate them as durable
 * work items, sync approvals, retention), for Vercel Cron (GET) or any scheduler (POST) presenting the bearer whose SHA-256 is
 * FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256. It only ever writes proposals for owners; it cannot sign or submit. See `src/automations/http.ts`.
 */
import { handleAutomationDispatch } from '../../../../automations/http';
import { automationRouteLogger } from '../../../../automations/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function serve(request: Request): Promise<Response> {
  return handleAutomationDispatch(request, { logger: await automationRouteLogger() as never });
}
export const GET = serve;
export const POST = serve;

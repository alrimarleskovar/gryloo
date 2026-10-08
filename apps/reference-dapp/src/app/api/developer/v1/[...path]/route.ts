// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: `/api/developer/v1/*` — the FloFi Developer API (see `src/developer/http.ts`). Disabled unless
 * `FLOFI_DEVELOPER=enabled`; every request needs a server-side FloFi Developer API key. Work after the response (usage counters,
 * retention) runs in `after()`.
 */
import { after } from 'next/server';
import { handleDeveloperRequest, type DeveloperLogger } from '../../../../../developer/http';

export const dynamic = 'force-dynamic';
// A simulation preview may wait on paced public RPC reads and provider quotes, as the DApp's own Simulate does.
export const maxDuration = 300;

let logger: Promise<DeveloperLogger> | null = null;
// Loaded on first use, like the embedded runtime: the structured, redacting logger of the cloud runtime.
const log = () => logger ??= import('@defi-workflow-engine/cloud-runtime').then(runtime => runtime.createLogger({ service: 'flofi-developer' }));

async function serve(request: Request): Promise<Response> {
  return handleDeveloperRequest(request, { logger: await log(), schedule: work => after(work) });
}
export const GET = serve;
export const POST = serve;
export const DELETE = serve;

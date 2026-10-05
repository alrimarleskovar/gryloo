// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: `GET /api/flofi/readiness[?probe=networks]` — the deployment's non-secret readiness (see
 * `src/server/readiness.ts`). 200 when its runtime is usable, 503 otherwise. No URL, key or upstream message is ever returned.
 */
import { cachedReadiness } from '../../../../server/readiness';

export const dynamic = 'force-dynamic';
// Bounded: each network probe makes at most two 5-second requests, all networks concurrently.
export const maxDuration = 60;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export async function GET(request: Request): Promise<Response> {
  const networks = new URL(request.url).searchParams.get('probe') === 'networks';
  try {
    const report = await cachedReadiness(networks);
    return Response.json(report, { status: report.ok ? 200 : 503, headers });
  } catch {
    return Response.json({ service: 'flofi-web', ok: false, code: 'READINESS_UNAVAILABLE' }, { status: 503, headers });
  }
}

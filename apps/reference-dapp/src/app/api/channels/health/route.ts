// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-CHANNELS-001: `/api/channels/health` — channel readiness for the operator (bearer-protected; see `src/channels/dispatch-http.ts`). */
import { handleChannelHealth } from '../../../../channels/dispatch-http';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleChannelHealth(request);

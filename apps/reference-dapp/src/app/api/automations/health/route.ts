// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-AUTOMATION-001: `/api/automations/health` — bearer-only readiness of automations (see `src/automations/http.ts`). */
import { handleAutomationHealth } from '../../../../automations/http';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) => handleAutomationHealth(request);

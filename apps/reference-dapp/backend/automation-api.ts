// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the Automations routes of the Railway API (`src/automations/api.ts`). Loaded by `main.ts api` only when the API's
 * environment sets FLOFI_AUTOMATIONS=enabled; otherwise neither this module nor the resolution rule is loaded and the API is unchanged.
 * The routes are owner CRUD/state and no-authority approval links on the shared approval model: no flow call, no key, no submission.
 */
import type { Database, Logger, Route } from '@defi-workflow-engine/cloud-runtime';
import type { Backend } from './app.ts';
import { installSourceResolution } from './source-resolution.ts';

type Env = Readonly<Record<string, string | undefined>>;
export async function loadAutomationApi(env: Env, deps: { readonly db: Database; readonly tenantId: string; readonly backend: Backend; readonly logger: Logger }): Promise<Route[]> {
  installSourceResolution();
  const { automationApiRoutes } = await import('../src/automations/api.ts');
  return automationApiRoutes(env, deps);
}

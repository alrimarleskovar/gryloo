// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the delegated-execution owner routes of the Railway API (`src/delegation/api.ts`). Loaded by `main.ts api` only when
 * the API sets FLOFI_DELEGATION=enabled (and FLOFI_AUTOMATIONS=enabled); otherwise nothing here is loaded and the API is unchanged. Owner
 * operations only: the API can create and destroy grant session keys but never sign with them, run the executor or submit anything.
 */
import type { Database, Logger, Route } from '@defi-workflow-engine/cloud-runtime';
import { installSourceResolution } from './source-resolution.ts';

type Env = Readonly<Record<string, string | undefined>>;
export async function loadDelegationApi(env: Env, deps: { readonly db: Database; readonly tenantId: string; readonly logger: Logger }): Promise<Route[]> {
  installSourceResolution();
  const { delegationApiRoutes } = await import('../src/delegation/api.ts');
  return delegationApiRoutes(env, deps);
}

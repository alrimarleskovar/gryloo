// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the delegated executor on the Railway worker. Loaded by `main.ts worker` only when the worker sets
 * FLOFI_DELEGATED_EXECUTION=enabled; it then still needs FLOFI_DELEGATION=enabled and a signer provider, which a hosted deployment cannot
 * configure (no production custody provider exists): in standard production it logs `delegation.worker_disabled` and changes nothing.
 * The worker's flow services keep their observe-only transports (WORKER_SUBMISSION_FORBIDDEN).
 */
import type { Database, Logger } from '@defi-workflow-engine/cloud-runtime';
import { installSourceResolution } from './source-resolution.ts';

type Env = Readonly<Record<string, string | undefined>>;
export async function loadDelegationWorker(env: Env, db: Database, tenantId: string, logger: Logger) {
  installSourceResolution();
  const { delegationWorkerParts } = await import('../src/delegation/worker.ts');
  return delegationWorkerParts(env, db, tenantId, logger);
}

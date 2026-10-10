// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the delegated executor hosted by a worker process (the Railway worker via `backend/delegation-worker.ts`, or an embedded
 * deployment's scheduler drain). It exists only where FLOFI_DELEGATION=enabled AND FLOFI_DELEGATED_EXECUTION=enabled with a signer provider —
 * which a hosted deployment cannot configure (no production custody provider exists), so in standard production this returns `disabled`
 * and nothing changes. The worker's flow services keep their observe-only transports (WORKER_SUBMISSION_FORBIDDEN): the executor uses its own
 * guarded transports and only for session-signed delegated redemptions.
 */
import type { Database, Logger, WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { readDelegationConfig } from './config.ts';
import { delegationRuntime, type DelegationSeams } from './runtime.ts';
import { delegationHandlers, executorDeps, sweepDelegation } from './executor-runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type DelegationWorkerParts = { readonly handlers: Readonly<Record<string, WorkHandler>>; readonly sweep: () => Promise<unknown> };
export function delegationWorkerParts(env: Env, db: Database, tenantId: string, logger: Logger, seams: DelegationSeams = {}):
  DelegationWorkerParts | { readonly disabled: string; readonly reason: string | null } {
  const config = readDelegationConfig(env);
  if (!config.enabled) return { disabled: config.code, reason: 'reason' in config ? config.reason ?? null : null };
  if (config.tenantId !== tenantId) return { disabled: 'DELEGATION_TENANT_MISMATCH', reason: null };
  const rt = delegationRuntime(config, { db, tenantId }, seams);
  const deps = executorDeps(rt, (event, fields) => logger.info(event, fields));
  if ('code' in deps) return { disabled: deps.code, reason: null };
  return { handlers: delegationHandlers(deps), sweep: () => sweepDelegation(rt) };
}

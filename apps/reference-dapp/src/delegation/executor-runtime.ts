// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the executor's wiring — the only place a signer provider's SIGNING half (`SignerUser`) is handed to code, together with
 * the executor transports (session-signed submission). Imported by the worker entry and the optional delegation drain; never by owner
 * operations, the API routes or the BFF (checked by `boundaries.test.ts`).
 */
import type { WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { createPgAutomationStore, DELEGATION_EXECUTE_KIND } from '../automations/pg-store.ts';
import { typedId } from '../platform/ids.ts';
import { executeOccurrence, type ExecutorDeps } from './executor.ts';
import { DELEGATION_WORK_KINDS, signerProvider, signerUser, transportFor, type DelegationRuntime } from './runtime.ts';

/** The executor's dependencies (signing capability included): built only where delegated execution is enabled. */
export function executorDeps(rt: DelegationRuntime, log: ExecutorDeps['log']): ExecutorDeps | { readonly code: string } {
  if (!rt.config.executor) return { code: 'DELEGATED_EXECUTION_NOT_ENABLED_HERE' };
  const provider = signerProvider(rt.config, rt.seams);
  if (!provider) return { code: 'DELEGATED_SIGNER_UNAVAILABLE' };
  return { store: rt.store, automations: createPgAutomationStore(rt.host.db, rt.host.tenantId), config: rt.config, signer: signerUser(provider), now: rt.now,
    transport: chain => transportFor(rt.config, chain, 'executor', rt.seams), newId: prefix => typedId(prefix), log };
}

const ID = /^occ_[a-z2-7]{26}$/, AUTH = /^dau_[a-z2-7]{26}$/;
/** The `delegation.execute` handler: drives one delegated occurrence; waits are retries of the same item (at-least-once, idempotent). */
export function delegationHandlers(deps: ExecutorDeps): Record<(typeof DELEGATION_WORK_KINDS)[number], WorkHandler> {
  return {
    [DELEGATION_EXECUTE_KIND]: async (item, settle) => {
      const occurrenceId = item.payload.occurrenceId, authorizationId = item.payload.authorizationId;
      if (typeof occurrenceId !== 'string' || !ID.test(occurrenceId) || typeof authorizationId !== 'string' || !AUTH.test(authorizationId)) {
        await settle({ outcome: 'DEAD', reason: 'WORK_PAYLOAD_INVALID' }); return;
      }
      const result = await executeOccurrence(deps, occurrenceId, authorizationId);
      deps.log('delegation.executed', { occurrence: occurrenceId, execution: result.executionId, state: result.state, code: result.code });
      await settle(result.retryMs === null ? { outcome: 'DONE' } : { outcome: 'RETRY', delayMs: result.retryMs, reason: 'DELEGATED_EXECUTION_WAITING' });
    },
  } as Record<(typeof DELEGATION_WORK_KINDS)[number], WorkHandler>;
}

/** Sweep: lapse expired authorizations and grants; re-arm executions a crashed worker left mid-way (never HALTED ones, which wait for the owner). */
export async function sweepDelegation(rt: DelegationRuntime): Promise<{ readonly expired: number; readonly rearmed: number }> {
  const now = rt.now(), expired = await rt.store.expireAuthorizations(now, 100);
  await rt.host.db.query(`UPDATE credential_grants SET state = 'EXPIRED', version = version + 1 WHERE tenant_id = $1 AND state = 'ACTIVE' AND expires_at <= $2`,
    [rt.host.tenantId, now]);
  let rearmed = 0;
  for (const e of await rt.store.openExecutions(new Date(now.getTime() - 120_000), 100)) {
    if (e.state === 'HALTED') continue;
    const { rowCount } = await rt.host.db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
      VALUES ($1, $2, $3, NULL, $4::jsonb, 'READY', now()) ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`,
    [rt.host.tenantId, DELEGATION_EXECUTE_KIND, e.occurrenceId, JSON.stringify({ occurrenceId: e.occurrenceId, authorizationId: e.authorizationId })]);
    rearmed += rowCount;
  }
  return { expired, rearmed };
}

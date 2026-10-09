// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: wiring of delegated execution — the store on the deployment's PostgreSQL host (shared with automations), chain
 * transports by purpose, the signer provider, and the executor's work handler and sweep.
 *
 * Signer capabilities are split by role: owner operations receive only `SignerAdmin` (create a session key for a new grant, read its address,
 * destroy it on revocation) and can never sign; only the executor receives `SignerUser`. A production provider (KMS/HSM with that split
 * enforced by key policy) does not exist yet — `none` is the production default and delegated execution reports itself unavailable.
 */
import type { Database, WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { localDisposableSignerProvider, memorySignerProvider, type DelegatedSignerProvider } from '@defi-workflow-engine/reference-executor';
import { DELEGATION_EXECUTE_KIND } from '../automations/pg-store.ts';
import { createPgAutomationStore } from '../automations/pg-store.ts';
import { typedId } from '../platform/ids.ts';
import { guarded, httpRpc, type ChainTransport, type TransportPurpose } from './chains.ts';
import type { DelegationConfig } from './config.ts';
import { executeOccurrence, type ExecutorDeps } from './executor.ts';
import { createPgDelegationStore, type DelegationStore } from './pg-store.ts';

type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type SignerAdmin = Pick<DelegatedSignerProvider, 'id' | 'create' | 'address' | 'destroy'>;
export type SignerUser = Pick<DelegatedSignerProvider, 'signEvmDigest' | 'signSolanaMessage'>;
export type DelegationHost = { readonly db: Database; readonly tenantId: string };
export type DelegationSeams = { readonly rpc?: (chain: string) => Rpc | null; readonly fetch?: typeof fetch; readonly signer?: DelegatedSignerProvider; readonly now?: () => Date };
export const DELEGATION_WORK_KINDS = Object.freeze([DELEGATION_EXECUTE_KIND] as const);

let memory: DelegatedSignerProvider | null = null;
/** This process's signer provider, or null (`none`). The memory provider is one per process (loopback tests on a single server). */
export function signerProvider(config: DelegationConfig, seams: DelegationSeams = {}): DelegatedSignerProvider | null {
  if (seams.signer) return seams.signer;
  if (config.signer.kind === 'memory') return memory ??= memorySignerProvider();
  if (config.signer.kind === 'local-disposable') return localDisposableSignerProvider(config.signer.directory);
  return null;
}
export const signerAdmin = (provider: DelegatedSignerProvider): SignerAdmin => ({ id: provider.id, create: provider.create, address: provider.address, destroy: provider.destroy });
export const signerUser = (provider: DelegatedSignerProvider): SignerUser => ({ signEvmDigest: provider.signEvmDigest, signSolanaMessage: provider.signSolanaMessage });

/** The guarded transport of `chain` for `purpose`, or null when the chain is not enabled on this deployment. */
export function transportFor(config: DelegationConfig, chain: string, purpose: TransportPurpose, seams: DelegationSeams = {}): ChainTransport | null {
  const injected = seams.rpc?.(chain);
  if (injected) return guarded(chain, purpose, config.mode === 'MOCKED_HARNESS' ? 'MOCKED' : 'PUBLIC', injected);
  if (config.mode === 'MOCKED_HARNESS') return guarded(chain, purpose, 'MOCKED', httpRpc(`${config.harnessUrl}/rpc/${encodeURIComponent(chain)}`, seams.fetch));
  const url = config.rpc[chain];
  return url ? guarded(chain, purpose, 'PUBLIC', httpRpc(url, seams.fetch)) : null;
}

export type DelegationRuntime = { readonly config: DelegationConfig; readonly host: DelegationHost; readonly store: DelegationStore; readonly now: () => Date;
  readonly seams: DelegationSeams };
export function delegationRuntime(config: DelegationConfig, host: DelegationHost, seams: DelegationSeams = {}): DelegationRuntime {
  return { config, host, store: createPgDelegationStore(host.db, host.tenantId), now: seams.now ?? (() => new Date()), seams };
}

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

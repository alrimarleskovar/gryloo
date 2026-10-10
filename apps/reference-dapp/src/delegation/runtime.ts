// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: wiring of delegated execution shared by owner operations and the executor — the store on the deployment's PostgreSQL
 * host (shared with automations), chain transports by purpose and the signer provider. The executor's own wiring (signing capability, work
 * handler, sweep) is `executor-runtime.ts`, which owner operations never import.
 *
 * Signer capabilities are split by role: owner operations receive only `SignerAdmin` (create a session key for a new grant, read its address,
 * destroy it on revocation) and can never sign; only the executor receives `SignerUser`. A production provider (KMS/HSM with that split
 * enforced by key policy) does not exist yet — `none` is the production default and delegated execution reports itself unavailable.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { localDisposableSignerProvider, memorySignerProvider, type DelegatedSignerProvider } from '@defi-workflow-engine/reference-executor';
import { DELEGATION_EXECUTE_KIND } from '../automations/pg-store.ts';
import { guarded, httpRpc, type ChainTransport, type TransportPurpose } from './chains.ts';
import type { DelegationConfig } from './config.ts';
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

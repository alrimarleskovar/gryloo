// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the wiring shared by every channel entry point (provider webhooks, the scheduled dispatch, the /approve ping): the
 * deployment's embedded PostgreSQL host (channels never run on memory, files or /tmp), the channel store, and the slice of the shared
 * platform a channel uses (`ChannelPlatform`). Model-free: the interpreter is attached only by the entry points that run turns.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { createPgHandoffStore, deploymentEngineRuntime, type EngineRuntime } from '../platform/index.ts';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { channelApprovalScheme, type ChannelPlatform } from './core/approval.ts';
import type { ChannelCoreConfig } from './core/config.ts';
import { createPgChannelStore } from './core/pg-store.ts';
import type { ChannelStore } from './core/store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type ChannelHost = { readonly db: Database; readonly tenantId: string };
export type ChannelRuntime = { readonly store: ChannelStore; readonly platform: ChannelPlatform };

/** The embedded runtime's database for this deployment's tenant, or a closed code (never a fallback store). */
export async function channelHost(env: Env, core: ChannelCoreConfig, host?: ChannelHost): Promise<ChannelHost | { readonly code: string }> {
  let resolved = host;
  if (!resolved) {
    if (flowRuntimeKind(env) !== 'embedded') return { code: 'CHANNEL_STORE_UNAVAILABLE' };
    try { const runtime = await embeddedRuntime(env); resolved = { db: runtime.db, tenantId: runtime.tenantId }; } catch { return { code: 'CHANNEL_STORE_UNAVAILABLE' }; }
  }
  if (resolved.tenantId !== core.tenantId) return { code: 'CHANNEL_STORE_UNAVAILABLE' };
  const store = createPgChannelStore(resolved.db, resolved.tenantId);
  if (!await store.schemaInstalled().catch(() => false)) return { code: 'CHANNEL_SCHEMA_NOT_INSTALLED' };
  return resolved;
}
export function channelRuntime(env: Env, core: ChannelCoreConfig, host: ChannelHost, runtime?: EngineRuntime): ChannelRuntime {
  const store = createPgChannelStore(host.db, host.tenantId);
  return { store, platform: { origin: core.origin, scheme: channelApprovalScheme(core.keys), handoffs: createPgHandoffStore(host.db, host.tenantId), allow: store.allow,
    runtime: runtime ?? deploymentEngineRuntime(env), policy: core.policy } };
}

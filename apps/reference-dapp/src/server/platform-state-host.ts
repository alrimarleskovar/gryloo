// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server-only durable platform state, independent of where financial flows execute. DATABASE_URL supplies PostgreSQL for
 * Developer projects/keys/approvals/webhooks and MCP OAuth/accounts/handoffs. API_BASE_URL still selects the remote flow runtime.
 * Only the pool/startup promise is cached; every durable fact lives in PostgreSQL. No filesystem or in-memory state fallback.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { embeddedRuntime, flowRuntimeKind } from './flow-runtime.ts';
import { serverlessPostgresConfig } from './postgres-config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type PlatformStateHost = { readonly db: Database; readonly tenantId: string };

async function openHost(config: ReturnType<typeof serverlessPostgresConfig>): Promise<PlatformStateHost> {
  const runtime = await import('@defi-workflow-engine/cloud-runtime');
  const db = runtime.createDatabase({ connectionString: config.databaseUrl, maxConnections: config.maxConnections, applicationName: 'flofi-platform-state' });
  try {
    // Bundled functions check shipped identities without reading migration files or applying migrations.
    await runtime.assertSchemaCurrent(db, runtime.SHIPPED_MIGRATIONS);
    await runtime.ensureTenant(db, config.tenantId);
    return { db, tenantId: config.tenantId };
  } catch (error) { await db.close().catch(() => undefined); throw error; }
}

const HOSTS = Symbol.for('flofi.platform-state');
/** One pool per process/configuration. Failed initialization is closed and evicted so a later request can recover. */
export async function platformStateHost(env: Env = process.env): Promise<PlatformStateHost> {
  if (flowRuntimeKind(env) === 'embedded') {
    const runtime = await embeddedRuntime(env);
    return { db: runtime.db, tenantId: runtime.tenantId };
  }
  const config = serverlessPostgresConfig(env);
  const holder = globalThis as unknown as Record<symbol, Map<string, Promise<PlatformStateHost>> | undefined>;
  const hosts = holder[HOSTS] ??= new Map(), key = JSON.stringify([config.databaseUrl, config.tenantId, config.maxConnections]);
  let host = hosts.get(key);
  if (!host) {
    host = openHost(config).catch(error => { hosts.delete(key); throw error; });
    hosts.set(key, host);
  }
  return host;
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MCP OAuth, account, handoff and wallet-link state uses the shared durable platform state host, including when financial
 * flows run remotely. A missing/unusable PostgreSQL connection fails closed with `MCP_OAUTH_STORE_UNAVAILABLE`.
 */
import { platformStateHost, type PlatformStateHost } from '../../server/platform-state-host.ts';
import { createPgOAuthStore } from './pg-store.ts';
import type { McpOAuthStore } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type McpStateHost = PlatformStateHost;
export const STORE_UNAVAILABLE = 'MCP_OAUTH_STORE_UNAVAILABLE';

/** The deployment's PostgreSQL and tenant, or a thrown `MCP_OAUTH_STORE_UNAVAILABLE`. */
export async function mcpStateHost(env: Env): Promise<McpStateHost> {
  try { return await platformStateHost(env); }
  catch { throw new Error(STORE_UNAVAILABLE); }
}
export async function deploymentOAuthStore(env: Env): Promise<McpOAuthStore> {
  const host = await mcpStateHost(env);
  return createPgOAuthStore(host.db, host.tenantId);
}

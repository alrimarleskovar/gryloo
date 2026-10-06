// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: where the MCP OAuth, handoff and wallet-link state lives. Only the embedded runtime (PostgreSQL inside this
 * deployment, BUILD-CLOUD-PARITY-001) provides it. The remote runtime (API on another host), a local server without a database
 * and an unconfigured hosted deployment fail closed with `MCP_OAUTH_STORE_UNAVAILABLE`: never process memory, `/tmp` or a file.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { embeddedRuntime, flowRuntimeKind } from '../../server/flow-runtime.ts';
import { createPgOAuthStore } from './pg-store.ts';
import type { McpOAuthStore } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type McpStateHost = { readonly db: Database; readonly tenantId: string };
export const STORE_UNAVAILABLE = 'MCP_OAUTH_STORE_UNAVAILABLE';

/** The deployment's PostgreSQL and tenant, or a thrown `MCP_OAUTH_STORE_UNAVAILABLE`. */
export async function mcpStateHost(env: Env): Promise<McpStateHost> {
  if (flowRuntimeKind(env) !== 'embedded') throw new Error(STORE_UNAVAILABLE);
  try { const runtime = await embeddedRuntime(env); return { db: runtime.db, tenantId: runtime.tenantId }; }
  catch { throw new Error(STORE_UNAVAILABLE); }
}
export async function deploymentOAuthStore(env: Env): Promise<McpOAuthStore> {
  const host = await mcpStateHost(env);
  return createPgOAuthStore(host.db, host.tenantId);
}

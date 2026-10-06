// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the durable MCP state of one deployment (OAuth, approval handoffs, wallet links), all on its PostgreSQL and
 * tenant. One object per request; the pool behind it is the embedded runtime's.
 */
import { createPgOAuthStore } from './pg-store.ts';
import { mcpStateHost, type McpStateHost } from './runtime.ts';
import type { McpOAuthStore } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type McpState = { readonly oauth: McpOAuthStore };
export function stateOf(host: McpStateHost): McpState {
  return { oauth: createPgOAuthStore(host.db, host.tenantId) };
}
/** The deployment's state, or a thrown `MCP_OAUTH_STORE_UNAVAILABLE`. */
export async function mcpState(env: Env): Promise<McpState> { return stateOf(await mcpStateHost(env)); }

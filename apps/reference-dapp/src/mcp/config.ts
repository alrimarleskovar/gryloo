// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the MCP gateway's own security boundary — enablement, client credentials and the principal.
 *
 *   FLOFI_MCP=enabled                       explicit opt-in; anything else and the endpoint answers 404 MCP_NOT_ENABLED
 *   FLOFI_MCP_CLIENTS=[{"principal":"dev-alice","tokenSha256":"<64 hex>","wallets":["0x…"]}]
 *                                           SHA-256 digests of high-entropy bearer tokens (the tokens themselves are never
 *                                           stored server-side); `wallets` are the EVM accounts whose runs this credential
 *                                           may read through get_execution_status / get_evidence (owner-granted, optional)
 *   FLOFI_MCP_ALLOWED_ORIGINS=https://…     optional browser origins; any other Origin header is refused (DNS rebinding)
 *
 * This credential is NOT `API_AUTH_TOKEN` (the internal BFF→API bearer): a configured digest equal to its digest is a
 * configuration error, and the gateway never forwards an MCP credential anywhere. It authenticates a developer/partner
 * integration, never a wallet: it grants no financial authority and no wallet session. Any configuration error disables the
 * endpoint (fail closed).
 *
 * BUILD-MCP-002: consumer clients authenticate with OAuth (`FLOFI_MCP_OAUTH=enabled`, `oauth/`), which yields an `mcp-oauth`
 * principal: a pseudonymous FloFi account with scopes. With OAuth enabled `FLOFI_MCP_CLIENTS` becomes optional, and a production
 * deployment refuses static credentials altogether (they remain a development and Preview path).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { deploymentEnvironment, deploymentTenant } from '../server/deployment.ts';
import type { McpScope } from './oauth/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
/** A static developer/partner credential: operator-granted read wallets, no account, so no approval handoffs. */
export type McpCredentialPrincipal = { readonly kind: 'mcp-credential'; readonly id: string; readonly tenantId: string; readonly wallets: readonly string[] };
/**
 * BUILD-MCP-002: an OAuth-connected client acting for a pseudonymous FloFi account. `id` is the grant; `wallets` are the wallets
 * the account linked on FloFi (filled only for `flofi.runs` reads). Neither the account nor a link is wallet ownership.
 */
export type McpOAuthPrincipal = { readonly kind: 'mcp-oauth'; readonly id: string; readonly tenantId: string; readonly accountId: string; readonly clientId: string;
  readonly clientName: string; readonly scopes: readonly McpScope[]; readonly wallets: readonly string[] };
export type McpPrincipal = McpCredentialPrincipal | McpOAuthPrincipal;
/** What a static credential may call: everything read-only of BUILD-MCP-001, never an approval request (it has no account). */
export const CREDENTIAL_SCOPES: readonly McpScope[] = Object.freeze(['flofi.strategy', 'flofi.runs']);
export const principalScopes = (principal: McpPrincipal): readonly McpScope[] => principal.kind === 'mcp-oauth' ? principal.scopes : CREDENTIAL_SCOPES;
type Client = { readonly id: string; readonly digest: Buffer; readonly wallets: readonly string[] };
export type McpConfig =
  | { readonly enabled: true; readonly tenantId: string; readonly clients: readonly Client[]; readonly allowedOrigins: readonly string[] }
  | { readonly enabled: false; readonly code: 'MCP_NOT_ENABLED' | 'MCP_CONFIGURATION_INVALID' };

const PRINCIPAL = /^[a-z0-9][a-z0-9_-]{2,63}$/, DIGEST = /^[0-9a-f]{64}$/, WALLET = /^0x[0-9a-f]{40}$/;
/** A presented token: 32–512 URL/base64 characters. Shorter tokens never authenticate, whatever is configured. */
const TOKEN = /^[A-Za-z0-9._~+/=-]{32,512}$/;
const MAX_CLIENTS = 32, MAX_WALLETS = 16;
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const invalid = { enabled: false, code: 'MCP_CONFIGURATION_INVALID' } as const;

export function readMcpConfig(env: Env): McpConfig {
  if (env.FLOFI_MCP !== 'enabled') return { enabled: false, code: 'MCP_NOT_ENABLED' };
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid; }
  const oauth = env.FLOFI_MCP_OAUTH === 'enabled', configured = (env.FLOFI_MCP_CLIENTS ?? '').trim() !== '';
  // Consumer production traffic authenticates with OAuth only; static credentials are a development and Preview path.
  if (configured && deploymentEnvironment(env) === 'production') return invalid;
  let parsed: unknown;
  if (!configured && oauth) parsed = [];
  else try { parsed = JSON.parse(env.FLOFI_MCP_CLIENTS ?? ''); } catch { return invalid; }
  if (!Array.isArray(parsed) || parsed.length < (oauth ? 0 : 1) || parsed.length > MAX_CLIENTS) return invalid;
  const internal = env.API_AUTH_TOKEN ? sha256(env.API_AUTH_TOKEN) : null, clients: Client[] = [];
  for (const item of parsed as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid;
    const entry = item as Record<string, unknown>, keys = Object.keys(entry);
    if (keys.some(k => !['principal', 'tokenSha256', 'wallets'].includes(k)) || typeof entry.principal !== 'string' || !PRINCIPAL.test(entry.principal) ||
        typeof entry.tokenSha256 !== 'string' || !DIGEST.test(entry.tokenSha256)) return invalid;
    const wallets = entry.wallets ?? [];
    if (!Array.isArray(wallets) || wallets.length > MAX_WALLETS || !wallets.every(w => typeof w === 'string' && WALLET.test(w)) || new Set(wallets).size !== wallets.length) return invalid;
    const digest = Buffer.from(entry.tokenSha256, 'hex');
    // The internal API credential must never double as a client credential.
    if (internal && timingSafeEqual(digest, internal)) return invalid;
    if (clients.some(c => c.id === entry.principal || c.digest.equals(digest))) return invalid;
    clients.push({ id: entry.principal, digest, wallets: Object.freeze([...wallets as string[]]) });
  }
  const origins: string[] = [];
  for (const raw of (env.FLOFI_MCP_ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    let url: URL; try { url = new URL(raw); } catch { return invalid; }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== raw || url.username || url.password) return invalid;
    origins.push(url.origin);
  }
  return { enabled: true, tenantId, clients: Object.freeze(clients), allowedOrigins: Object.freeze(origins) };
}

/**
 * The principal for an `Authorization: Bearer <token>` header, or null. Every configured digest is compared in constant
 * time; the token is hashed immediately and never stored, logged or returned.
 */
export function authenticate(config: Extract<McpConfig, { enabled: true }>, header: string | null): McpCredentialPrincipal | null {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  if (!match || !TOKEN.test(match[1]!)) return null;
  const supplied = sha256(match[1]!);
  let found: Client | null = null;
  for (const client of config.clients) if (timingSafeEqual(client.digest, supplied) && !found) found = client;
  return found ? Object.freeze({ kind: 'mcp-credential', id: found.id, tenantId: config.tenantId, wallets: found.wallets }) : null;
}

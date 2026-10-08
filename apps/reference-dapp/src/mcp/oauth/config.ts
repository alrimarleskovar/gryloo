// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: configuration of FloFi's own OAuth 2.1 authorization server for consumer MCP clients (Claude custom
 * connectors, ChatGPT developer mode). Every error disables OAuth (fail closed); nothing falls back to another credential.
 *
 *   FLOFI_MCP_OAUTH=enabled                 explicit opt-in
 *   FLOFI_PUBLIC_ORIGIN=https://host        the issuer and the resource base; never derived from request headers
 *   FLOFI_MCP_OAUTH_SECRET=<≥ 32 chars>     dedicated key material: refused if equal to API_AUTH_TOKEN or FLOFI_SESSION_SECRET
 *   FLOFI_MCP_OAUTH_ACCESS=invite|open      new accounts need an invite code (default) or not
 *   FLOFI_MCP_OAUTH_INVITES=<sha256>,…      SHA-256 hex digests of invite codes (codes themselves are never configured)
 *   FLOFI_MCP_CIMD_HOSTS=claude.ai,…        hosts whose Client ID Metadata Documents are accepted
 *   FLOFI_MCP_OAUTH_DCR=enabled             narrow dynamic client registration fallback (off by default)
 *   FLOFI_MCP_DCR_REDIRECT_HOSTS=…          redirect hosts a dynamically registered client may use (plus loopback)
 *
 * The resource is `<origin>/api/mcp`. Tokens are bound to it (audience); none of this is financial authority: an OAuth
 * account never proves wallet ownership and never authorizes a transaction.
 */
import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { deploymentEnvironment, deploymentTenant, publicOrigin } from '../../server/deployment.ts';

/** BUILD-DEVELOPER-001: `publicOrigin` moved to the deployment module (every surface uses it); re-exported for existing importers. */
export { publicOrigin } from '../../server/deployment.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const MCP_SCOPES = Object.freeze(['flofi.strategy', 'flofi.approval', 'flofi.runs'] as const);
export type McpScope = (typeof MCP_SCOPES)[number];
/** What a client gets when it asks for nothing specific (the first 401 challenge asks for the same). */
export const DEFAULT_SCOPES: readonly McpScope[] = Object.freeze(['flofi.strategy', 'flofi.approval']);
export const MCP_RESOURCE_PATH = '/api/mcp';

export type OAuthKeys = { readonly token: Buffer; readonly csrf: Buffer; readonly handoff: Buffer; readonly account: Buffer; readonly ip: Buffer };
export type OAuthConfig = {
  readonly enabled: true; readonly tenantId: string; readonly origin: string; readonly issuer: string; readonly resource: string;
  readonly resourceMetadataUrl: string; readonly keys: OAuthKeys; readonly access: 'invite' | 'open'; readonly invites: readonly Buffer[];
  readonly cimdHosts: readonly string[]; readonly dcr: { readonly enabled: boolean; readonly redirectHosts: readonly string[] };
  readonly secureCookies: boolean; readonly production: boolean;
};
export type OAuthConfigResult = OAuthConfig | { readonly enabled: false; readonly code: 'MCP_OAUTH_NOT_ENABLED' | 'MCP_OAUTH_CONFIGURATION_INVALID'; readonly reason?: string };

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const invalid = (reason: string) => ({ enabled: false, code: 'MCP_OAUTH_CONFIGURATION_INVALID', reason } as const);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const sameSecret = (a: string, b: string | undefined) => b !== undefined && b !== '' && timingSafeEqual(sha256(a), sha256(b));
/** One HKDF key per purpose, so a digest made for one purpose can never be replayed as another. */
export const deriveKey = (secret: string, label: string) => Buffer.from(hkdfSync('sha256', secret, 'flofi', `flofi/mcp-oauth/${label}/v1`, 32));

function hostList(raw: string | undefined, fallback: readonly string[]): readonly string[] | null {
  const hosts = raw === undefined || raw.trim() === '' ? [...fallback] : raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return hosts.length <= 16 && hosts.every(h => HOST.test(h)) ? Object.freeze([...new Set(hosts)]) : null;
}

export function readOAuthConfig(env: Env): OAuthConfigResult {
  if (env.FLOFI_MCP_OAUTH !== 'enabled') return { enabled: false, code: 'MCP_OAUTH_NOT_ENABLED' };
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid('TENANT'); }
  const origin = publicOrigin(env);
  if (!origin) return invalid('FLOFI_PUBLIC_ORIGIN');
  const secret = env.FLOFI_MCP_OAUTH_SECRET ?? '';
  if (secret.length < 32 || secret.length > 512) return invalid('FLOFI_MCP_OAUTH_SECRET');
  // The OAuth key must be dedicated: never the internal API bearer, never the wallet-session key.
  if (sameSecret(secret, env.API_AUTH_TOKEN) || sameSecret(secret, env.FLOFI_SESSION_SECRET)) return invalid('FLOFI_MCP_OAUTH_SECRET_REUSED');
  const access = env.FLOFI_MCP_OAUTH_ACCESS ?? 'invite';
  if (access !== 'invite' && access !== 'open') return invalid('FLOFI_MCP_OAUTH_ACCESS');
  const invites = (env.FLOFI_MCP_OAUTH_INVITES ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (invites.length > 64 || !invites.every(d => /^[0-9a-f]{64}$/.test(d))) return invalid('FLOFI_MCP_OAUTH_INVITES');
  const cimdHosts = hostList(env.FLOFI_MCP_CIMD_HOSTS, ['claude.ai', 'chatgpt.com']);
  if (!cimdHosts) return invalid('FLOFI_MCP_CIMD_HOSTS');
  const dcrFlag = env.FLOFI_MCP_OAUTH_DCR ?? '';
  if (dcrFlag !== '' && dcrFlag !== 'enabled' && dcrFlag !== 'disabled') return invalid('FLOFI_MCP_OAUTH_DCR');
  const redirectHosts = hostList(env.FLOFI_MCP_DCR_REDIRECT_HOSTS, ['claude.ai', 'chatgpt.com']);
  if (!redirectHosts) return invalid('FLOFI_MCP_DCR_REDIRECT_HOSTS');
  const keys: OAuthKeys = Object.freeze({ token: deriveKey(secret, 'token'), csrf: deriveKey(secret, 'csrf'), handoff: deriveKey(secret, 'handoff'),
    account: deriveKey(secret, 'account-session'), ip: deriveKey(secret, 'ip') });
  return Object.freeze({ enabled: true, tenantId, origin, issuer: origin, resource: origin + MCP_RESOURCE_PATH,
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`, keys, access,
    invites: Object.freeze(invites.map(d => Buffer.from(d, 'hex'))), cimdHosts,
    dcr: Object.freeze({ enabled: dcrFlag === 'enabled', redirectHosts }), secureCookies: origin.startsWith('https:'),
    production: deploymentEnvironment(env) === 'production' });
}

/** True when `code` is one of the configured invite codes (constant-time against every digest). */
export function inviteAccepted(config: OAuthConfig, code: string): boolean {
  if (typeof code !== 'string' || code.length < 8 || code.length > 128) return false;
  const supplied = sha256(code.trim());
  let found = false;
  for (const digest of config.invites) if (timingSafeEqual(digest, supplied)) found = true;
  return found;
}

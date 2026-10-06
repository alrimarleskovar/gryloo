// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the HTTP boundary of the FloFi Remote MCP Gateway (`POST /api/mcp`).
 *
 * Order of checks, each failing closed before any MCP processing: enablement → Origin allowlist (DNS-rebinding protection for
 * browser clients; server-to-server clients send no Origin) → bearer credential → the official SDK's stateless handler
 * (one fresh server per request, JSON responses, 64 KiB body bound). Nothing is kept between requests, so any serverless
 * instance can serve any request. Logs carry the principal id, tool, outcome code and duration — never the token, arguments,
 * addresses or results.
 *
 * BUILD-MCP-002: with `FLOFI_MCP_OAUTH=enabled` the gateway is also an OAuth protected resource. A `flofi_at_` access token is
 * looked up in PostgreSQL on every request (revocation is immediate) and must be bound to this exact resource (audience). The
 * gateway reads the bounded JSON-RPC body before the SDK so a tool call outside the token's scopes is refused at the HTTP level
 * (403 `insufficient_scope`, which lets the client step up), and an unauthenticated request gets the 401 challenge that points
 * clients to the protected resource metadata.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { authenticate, principalScopes, readMcpConfig, type McpOAuthPrincipal, type McpPrincipal } from './config.ts';
import { readHandoffPolicy } from './execution.ts';
import { DEFAULT_SCOPES, readOAuthConfig, type McpScope, type OAuthConfig } from './oauth/config.ts';
import { credentialDigest, credentialOf } from './oauth/crypto.ts';
import { mcpState, type McpState } from './oauth/state.ts';
import { deploymentRuntime, type McpRuntime } from './runtime.ts';
import { APPROVAL_TOOL_NAMES, createFlofiMcpServer, TOOL_SCOPES } from './tools.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type GatewayLogger = { readonly info: (event: string, fields?: Readonly<Record<string, string | number | boolean | null>>) => void;
  readonly warn: (event: string, fields?: Readonly<Record<string, string | number | boolean | null>>) => void };
export type GatewayOptions = { readonly env?: Env; readonly runtime?: McpRuntime; readonly logger?: GatewayLogger; readonly state?: McpState; readonly now?: () => Date };
export const MCP_MAX_BODY_BYTES = 65_536;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reject = (status: number, code: string, extra: Record<string, string> = {}) =>
  Response.json({ ok: false, code }, { status, headers: { ...HEADERS, ...extra } });

/** RFC 6750 §3 challenge with the RFC 9728 `resource_metadata` pointer and the scopes to ask for. */
function challenge(oauth: OAuthConfig, scopes: readonly McpScope[], error?: 'invalid_token' | 'insufficient_scope'): string {
  return `Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${oauth.resourceMetadataUrl}", scope="${scopes.join(' ')}"`;
}
/**
 * The scopes a JSON-RPC message (or batch) needs: only `tools/call` of a tool that exists for this principal needs one; everything
 * else needs a token. A tool the principal does not have at all (e.g. an approval tool for a static credential) is left to the SDK,
 * which reports it as unknown: a 403 would wrongly suggest that a step-up could grant it.
 */
function requiredScopes(body: string, principal: McpPrincipal): readonly McpScope[] {
  let message: unknown;
  try { message = JSON.parse(body); } catch { return []; }
  const needed = new Set<McpScope>();
  for (const entry of Array.isArray(message) ? message : [message]) {
    if (!entry || typeof entry !== 'object') continue;
    const { method, params } = entry as { method?: unknown; params?: { name?: unknown } };
    const name = method === 'tools/call' && params && typeof params === 'object' && typeof params.name === 'string' ? params.name : null;
    if (!name || !Object.hasOwn(TOOL_SCOPES, name)) continue;
    if (principal.kind !== 'mcp-oauth' && (APPROVAL_TOOL_NAMES as readonly string[]).includes(name)) continue;
    needed.add(TOOL_SCOPES[name as keyof typeof TOOL_SCOPES]);
  }
  return [...needed];
}

export async function handleMcpRequest(request: Request, options: GatewayOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, logger = options.logger, now = options.now?.() ?? new Date();
  const config = readMcpConfig(env), oauthConfig = readOAuthConfig(env);
  if (!config.enabled) {
    if (config.code === 'MCP_CONFIGURATION_INVALID') logger?.warn('mcp.configuration_invalid');
    return reject(config.code === 'MCP_NOT_ENABLED' ? 404 : 503, config.code);
  }
  if (!oauthConfig.enabled && oauthConfig.code === 'MCP_OAUTH_CONFIGURATION_INVALID') {
    logger?.warn('mcp.oauth.configuration_invalid', { reason: oauthConfig.reason ?? null });
    return reject(503, 'MCP_CONFIGURATION_INVALID');
  }
  const oauth = oauthConfig.enabled ? oauthConfig : null;
  const origin = request.headers.get('origin');
  if (origin !== null && !config.allowedOrigins.includes(origin)) return reject(403, 'MCP_ORIGIN_FORBIDDEN');
  const header = request.headers.get('authorization'), bearer = /^Bearer ([^\s]+)$/.exec(header ?? '')?.[1] ?? null;
  let principal: McpPrincipal | null = null, state: McpState | null = null;
  const accessToken = oauth ? credentialOf('access', bearer) : null;
  if (oauth && accessToken) {
    try { state = options.state ?? await mcpState(env); }
    catch { logger?.warn('mcp.oauth.store_unavailable'); return reject(503, 'MCP_OAUTH_STORE_UNAVAILABLE'); }
    const found = await state.oauth.authenticate(credentialDigest(oauth.keys.token, accessToken), now).catch(() => 'UNAVAILABLE' as const);
    if (found === 'UNAVAILABLE') { logger?.warn('mcp.oauth.store_unavailable'); return reject(503, 'MCP_OAUTH_STORE_UNAVAILABLE'); }
    // Audience binding: a token minted for another resource (another origin of a shared database) is not valid here.
    if (found && found.resource === oauth.resource) principal = Object.freeze({ kind: 'mcp-oauth', id: found.grantId, tenantId: oauth.tenantId, accountId: found.accountId,
      clientId: found.clientId, clientName: found.clientName, scopes: found.scopes, wallets: Object.freeze([]) }) satisfies McpOAuthPrincipal;
  } else if (!accessToken) principal = authenticate(config, header);
  if (!principal) {
    logger?.warn('mcp.unauthorized');
    return reject(401, 'MCP_UNAUTHORIZED', { 'www-authenticate': oauth ? challenge(oauth, DEFAULT_SCOPES, bearer ? 'invalid_token' : undefined) : 'Bearer realm="flofi-mcp"' });
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return reject(413, 'MCP_REQUEST_TOO_LARGE');
  const body = request.method === 'POST' ? await request.text() : null;
  if (body !== null && Buffer.byteLength(body, 'utf8') > MCP_MAX_BODY_BYTES) return reject(413, 'MCP_REQUEST_TOO_LARGE');
  const held = principalScopes(principal), missing = body === null ? [] : requiredScopes(body, principal).filter(s => !held.includes(s));
  if (missing.length) {
    logger?.warn('mcp.insufficient_scope', { principal: principal.id, scope: missing.join(' ') });
    return reject(403, 'MCP_INSUFFICIENT_SCOPE', oauth && principal.kind === 'mcp-oauth'
      ? { 'www-authenticate': challenge(oauth, [...new Set([...held, ...missing])], 'insufficient_scope') } : {});
  }
  const runtime = options.runtime ?? deploymentRuntime(env), active = principal;
  const policy = readHandoffPolicy(env);
  const handler = createMcpHandler(() => createFlofiMcpServer({ principal: active, runtime, policy, ...state ? { state } : {}, ...oauth ? { oauth } : {},
    onTool: event => logger?.info('mcp.tool', { principal: active.id, tenant: active.tenantId, tool: event.tool, outcome: event.outcome, duration_ms: event.durationMs }) }),
  // `auto` answers with one JSON body: no tool emits a notification before its result.
  { legacy: 'stateless', maxRequestBodySize: MCP_MAX_BODY_BYTES, onerror: () => logger?.warn('mcp.protocol_error', { principal: active.id }) });
  try {
    // The body was read for the scope check; the SDK gets an identical request.
    const forwarded = new Request(request.url, { method: request.method, headers: request.headers, ...body === null ? {} : { body } });
    // The exchange is complete once the body is read, so the per-request handler can close.
    const response = await handler.fetch(forwarded), text = response.status === 204 || response.status === 202 ? null : await response.text();
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  } finally { await handler.close().catch(() => undefined); }
}

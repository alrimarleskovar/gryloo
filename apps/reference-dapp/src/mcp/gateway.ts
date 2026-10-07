// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the HTTP boundary of the FloFi Remote MCP Gateway (`POST /api/mcp`).
 *
 * Order of checks, each failing closed before any MCP processing: enablement → Origin allowlist (DNS-rebinding protection for
 * browser clients; server-to-server clients send no Origin) → bearer credential → the official SDK's stateless handler
 * (one fresh server per request, JSON responses, 64 KiB body bound). Nothing is kept between requests, so any serverless
 * instance can serve any request. Logs carry the principal id, tool, outcome code and duration — never the token, arguments,
 * addresses or results.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { authenticate, readMcpConfig } from './config.ts';
import { deploymentRuntime, type McpRuntime } from './runtime.ts';
import { createFlofiMcpServer } from './tools.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type GatewayLogger = { readonly info: (event: string, fields?: Readonly<Record<string, string | number | boolean | null>>) => void;
  readonly warn: (event: string, fields?: Readonly<Record<string, string | number | boolean | null>>) => void };
export type GatewayOptions = { readonly env?: Env; readonly runtime?: McpRuntime; readonly logger?: GatewayLogger };
export const MCP_MAX_BODY_BYTES = 65_536;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const reject = (status: number, code: string, extra: Record<string, string> = {}) =>
  Response.json({ ok: false, code }, { status, headers: { ...HEADERS, ...extra } });

export async function handleMcpRequest(request: Request, options: GatewayOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, logger = options.logger;
  const config = readMcpConfig(env);
  if (!config.enabled) {
    if (config.code === 'MCP_CONFIGURATION_INVALID') logger?.warn('mcp.configuration_invalid');
    return reject(config.code === 'MCP_NOT_ENABLED' ? 404 : 503, config.code);
  }
  const origin = request.headers.get('origin');
  if (origin !== null && !config.allowedOrigins.includes(origin)) return reject(403, 'MCP_ORIGIN_FORBIDDEN');
  const principal = authenticate(config, request.headers.get('authorization'));
  if (!principal) {
    logger?.warn('mcp.unauthorized');
    return reject(401, 'MCP_UNAUTHORIZED', { 'www-authenticate': 'Bearer realm="flofi-mcp"' });
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return reject(413, 'MCP_REQUEST_TOO_LARGE');
  const runtime = options.runtime ?? deploymentRuntime(env);
  const handler = createMcpHandler(() => createFlofiMcpServer({ principal, runtime,
    onTool: event => logger?.info('mcp.tool', { principal: principal.id, tenant: principal.tenantId, tool: event.tool, outcome: event.outcome, duration_ms: event.durationMs }) }),
  // `auto` answers with one JSON body: no tool emits a notification before its result.
  { legacy: 'stateless', maxRequestBodySize: MCP_MAX_BODY_BYTES, onerror: () => logger?.warn('mcp.protocol_error', { principal: principal.id }) });
  try {
    // The exchange is complete once the body is read, so the per-request handler can close.
    const response = await handler.fetch(request), body = response.status === 204 || response.status === 202 ? null : await response.text();
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } finally { await handler.close().catch(() => undefined); }
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001 test harness: speaks raw MCP JSON-RPC to the real gateway handler, exactly as a remote client does over HTTP
 * (2025-11-25 stateless Streamable HTTP by default; the 2026-07-28 envelope on request). No network, no model.
 */
import { createHash, randomBytes } from 'node:crypto';
import { handleMcpRequest, type GatewayLogger } from './gateway';
import type { McpState } from './oauth/state';
import type { McpRuntime } from './runtime';

export const credential = () => randomBytes(32).toString('base64url');
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export type Client = { readonly principal: string; readonly token: string; readonly wallets?: readonly string[] };
export function gatewayEnv(clients: readonly Client[], extra: Record<string, string> = {}): Record<string, string> {
  return { FLOFI_MCP: 'enabled', FLOFI_MCP_CLIENTS: JSON.stringify(clients.map(c => ({ principal: c.principal, tokenSha256: digest(c.token), ...c.wallets ? { wallets: c.wallets } : {} }))), ...extra };
}
export type LogLine = { readonly event: string; readonly fields: Readonly<Record<string, unknown>> };
export function memoryLogger(): GatewayLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return { lines, info: (event, fields = {}) => { lines.push({ event, fields }); }, warn: (event, fields = {}) => { lines.push({ event, fields }); } };
}
const MODERN_META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'flofi-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {} };

export type Session = {
  readonly post: (body: unknown, headers?: Record<string, string>) => Promise<{ status: number; headers: Headers; text: string; message: Record<string, unknown> | null }>;
  readonly request: (method: string, params?: Record<string, unknown>, options?: { modern?: boolean }) => Promise<Record<string, unknown>>;
  readonly callTool: (name: string, args: unknown) => Promise<{ isError: boolean; output: Record<string, unknown>; text: string; meta: Record<string, unknown> }>;
};
/** One client of one gateway configuration. `token: null` sends no Authorization header. */
export function session(options: { env: Record<string, string>; token: string | null; runtime?: McpRuntime; logger?: GatewayLogger; state?: McpState;
  now?: () => Date }): Session {
  let id = 0;
  const post: Session['post'] = async (body, headers = {}) => {
    const response = await handleMcpRequest(new Request('https://flofi.test/api/mcp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...options.token === null ? {} : { authorization: `Bearer ${options.token}` }, ...headers } }),
    { env: options.env, ...options.runtime ? { runtime: options.runtime } : {}, ...options.logger ? { logger: options.logger } : {},
      ...options.state ? { state: options.state } : {}, ...options.now ? { now: options.now } : {} });
    const text = await response.text();
    // Legacy stateless serving answers with one SSE `message` event; modern serving answers with a JSON body.
    const json = response.headers.get('content-type')?.startsWith('text/event-stream') ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6) : text;
    let message: Record<string, unknown> | null;
    try { message = json ? JSON.parse(json) as Record<string, unknown> : null; } catch { message = null; }
    return { status: response.status, headers: response.headers, text, message };
  };
  const request: Session['request'] = async (method, params = {}, { modern = false } = {}) => {
    const name = method === 'tools/call' ? { 'mcp-name': String(params.name) } : {};
    const result = await post({ jsonrpc: '2.0', id: ++id, method, params: modern ? { ...params, _meta: MODERN_META } : params },
      modern ? { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...name } : { 'mcp-protocol-version': '2025-11-25' });
    if (!result.message) throw new Error(`MCP_NO_MESSAGE_${result.status}`);
    return result.message;
  };
  return { post, request, async callTool(name, args) {
    const message = await request('tools/call', { name, arguments: args });
    const result = message.result as { content?: { text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> } | undefined;
    if (!result) throw new Error('MCP_TOOL_PROTOCOL_ERROR: ' + JSON.stringify(message.error));
    const text = result.content?.[0]?.text ?? '';
    return { isError: result.isError === true, output: result.structuredContent ?? { text }, text, meta: result._meta ?? {} };
  } };
}

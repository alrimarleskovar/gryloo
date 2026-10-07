// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 browser fixtures: a consumer MCP client and a minimal MCP Apps host, both talking only to the loopback app.
 *
 *   connectViaBrowser  OAuth as a person does it: a dynamically registered public client (loopback callback on the app origin),
 *                      PKCE S256, the consent page in the browser with the test invite code, the code exchanged for a token.
 *   mcpClient          JSON-RPC to /api/mcp with that bearer token (the host's backend in a real deployment).
 *   openHost           a page that frames the FloFi panel exactly as an MCP Apps host does: `srcdoc` in an `allow-scripts` sandbox
 *                      (opaque origin), ui/initialize → tool-input → tool-result, tools/call proxied to /api/mcp, and every
 *                      ui/open-link and ui/update-model-context recorded instead of acted upon.
 */
import { createHash, randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type FrameLocator, type Page } from '@playwright/test';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';
import { MCP_E2E_INVITE } from './mcp-constants';

export const HOST_NAME = 'flofi-e2e-host';
export const CLIENT_NAME = 'FloFi E2E host';
export const CALLBACK = `${APP_ORIGIN}/mcp-e2e-callback`;
export function assertMcpHarness() { if (process.env.GRYLOO_MCP_E2E !== 'EMBEDDED_LOOPBACK_ONLY' || !process.env.FLOFI_E2E_DATABASE_URL) throw new Error('MOCK_RESET_DENIED'); }

/** OAuth through the real consent page. Returns the access token (never put in a URL) and the client id. */
export async function connectViaBrowser(page: Page, request: APIRequestContext, scope = 'flofi.strategy flofi.approval flofi.runs') {
  const registered = await request.post(`${APP_ORIGIN}/oauth/register`, { data: { redirect_uris: [CALLBACK], client_name: CLIENT_NAME, token_endpoint_auth_method: 'none' } });
  expect(registered.status()).toBe(201);
  const clientId = (await registered.json() as { client_id: string }).client_id;
  const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url'), state = randomBytes(8).toString('hex');
  await page.goto(`${APP_ORIGIN}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, state, code_challenge: challenge,
    code_challenge_method: 'S256', scope, resource: `${APP_ORIGIN}/api/mcp` }).toString());
  await expect(page.getByRole('heading', { name: `Connect ${CLIENT_NAME} to FloFi` })).toBeVisible();
  await expect(page.getByText('This connection never moves funds.')).toBeVisible();
  await page.getByLabel('Invite code').fill(MCP_E2E_INVITE);
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL(url => url.pathname === '/mcp-e2e-callback');
  const back = new URL(page.url());
  expect([back.searchParams.get('state'), back.searchParams.get('iss')]).toEqual([state, APP_ORIGIN]);
  const exchanged = await request.post(`${APP_ORIGIN}/oauth/token`, { form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: CALLBACK,
    client_id: clientId, code_verifier: verifier, resource: `${APP_ORIGIN}/api/mcp` } });
  expect(exchanged.status()).toBe(200);
  const tokens = await exchanged.json() as { access_token: string; scope: string };
  expect(tokens.scope).toBe(scope);
  return { accessToken: tokens.access_token, clientId };
}

export type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean; _meta?: Record<string, unknown> };
export function mcpClient(request: APIRequestContext, token: string) {
  let id = 0;
  const call = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await request.post(`${APP_ORIGIN}/api/mcp`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25' }, data: { jsonrpc: '2.0', id: ++id, method, params } });
    const text = await response.text();
    const json = response.headers()['content-type']?.startsWith('text/event-stream') ? text.split('\n').find(l => l.startsWith('data: '))!.slice(6) : text;
    const message = JSON.parse(json) as { result?: unknown; error?: unknown };
    if (!message.result) throw new Error('MCP_CALL_FAILED ' + JSON.stringify(message.error ?? message));
    return message.result;
  };
  const toolResult = async (name: string, args: Record<string, unknown>) => await call('tools/call', { name, arguments: args }) as ToolResult;
  const tool = async (name: string, args: Record<string, unknown>) => (await toolResult(name, args)).structuredContent as Record<string, unknown>;
  return { call, tool, toolResult };
}

const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>MCP Apps test host</title></head><body>
<h1>MCP Apps test host</h1><iframe id="app" title="FloFi approval panel" sandbox="allow-scripts" style="width:760px;height:900px;border:1px solid #888"></iframe>
<script>
const frame = document.getElementById('app');
window.hostLog = { openLinks: [], modelContext: [], toolCalls: [], initialized: false };
const send = message => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...message }, '*');
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow) return;
  const m = event.data;
  if (!m || m.jsonrpc !== '2.0') return;
  const reply = body => send({ id: m.id, ...body });
  if (m.method === 'ui/initialize') reply({ result: { protocolVersion: '2026-01-26', hostInfo: { name: '${HOST_NAME}', version: '1' }, hostCapabilities: {},
    hostContext: { theme: 'light', displayMode: 'inline' } } });
  else if (m.method === 'ui/notifications/initialized') {
    window.hostLog.initialized = true;
    send({ method: 'ui/notifications/tool-input', params: { arguments: window.toolInput } });
    send({ method: 'ui/notifications/tool-result', params: window.toolResult });
  } else if (m.method === 'tools/call') {
    window.hostLog.toolCalls.push(m.params.name);
    try { reply({ result: await window.hostCallTool(m.params.name, m.params.arguments) }); } catch (e) { reply({ error: { code: -32000, message: String(e && e.message) } }); }
  } else if (m.method === 'ui/open-link') { window.hostLog.openLinks.push(m.params.url); reply({ result: {} }); }
  else if (m.method === 'ui/update-model-context') { window.hostLog.modelContext.push(m.params); reply({ result: {} }); }
  else if (m.id !== undefined) reply({ error: { code: -32601, message: 'unsupported in the test host' } });
});
</script></body></html>`;
export type HostLog = { openLinks: string[]; modelContext: { content?: { text: string }[]; structuredContent?: Record<string, unknown> }[]; toolCalls: string[]; initialized: boolean };

/** Loads the panel HTML in the test host with the tool call's input and result. */
export async function openHost(page: Page, client: ReturnType<typeof mcpClient>, panelHtml: string, toolInput: Record<string, unknown>, toolResult: ToolResult): Promise<FrameLocator> {
  await page.exposeFunction('hostCallTool', (name: string, args: Record<string, unknown>) => client.toolResult(name, args));
  await page.setContent(HOST_HTML);
  await page.evaluate(({ html, input, result }) => {
    const w = window as unknown as { toolInput: unknown; toolResult: unknown };
    w.toolInput = input; w.toolResult = result;
    (document.getElementById('app') as HTMLIFrameElement).srcdoc = html;
  }, { html: panelHtml, input: toolInput, result: toolResult });
  return page.frameLocator('#app');
}
export const hostLog = (page: Page) => page.evaluate(() => (window as unknown as { hostLog: HostLog }).hostLog);
export async function panelHtmlOf(client: ReturnType<typeof mcpClient>, uri: string): Promise<string> {
  const read = await client.call('resources/read', { uri }) as { contents: { mimeType: string; text: string }[] };
  expect(read.contents[0]!.mimeType).toBe('text/html;profile=mcp-app');
  return read.contents[0]!.text;
}

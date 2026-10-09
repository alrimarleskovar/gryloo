// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the in-chat MCP App panel as a host sees it — a `ui://` resource with the MCP Apps MIME type and no network,
 * frame or external-resource permission, attached to request_user_approval; its app-only tools hidden from the model. The panel
 * program itself is one self-contained script (parsed here; exercised in a real browser by the mocked-host Playwright suite).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { session } from '../gateway.test-harness.ts';
import { oauthClient, oauthEnv, ORIGIN, signIn } from '../oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from '../oauth/pg-store.ts';
import { stateOf } from '../oauth/state.ts';
import { PANEL_MIME, PANEL_URI, panelHtml } from './panel.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const env = (extra: Record<string, string> = {}) => ({ FLOFI_MCP: 'enabled', ...oauthEnv(extra) });
async function client(extra: Record<string, string> = {}) {
  const tokens = await signIn(oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }));
  return session({ env: env(extra), token: tokens.access_token, state: stateOf({ db: t.db, tenantId: 'default' }) });
}

describe('BUILD-MCP-002 MCP App panel resource', () => {
  it('is one self-contained document: inline style and script, no external resource, no helper the browser lacks', () => {
    const html = panelHtml({ origin: ORIGIN, inFrameProbeHosts: [] });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=|<link |@import|<iframe/i);
    const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/__name\(|_async_to_generator|__awaiter|require\(|import\(|\bimport\s/);
    expect(script).toMatch(/["']ui\/initialize["']/);
    expect(script).toContain('textContent');
    expect(script).not.toMatch(/innerHTML|eval\(|document\.write/);
    // Settings are JSON-embedded with `<` escaped, so no value can close the script element.
    expect(panelHtml({ origin: 'https://x.test/</script><script>alert(1)</script>', inFrameProbeHosts: [] })).not.toContain('</script><script>alert(1)');
  });

  it('is listed and readable with the MCP Apps MIME type and empty CSP domains; request_user_approval points to it', async () => {
    const c = await client();
    const listed = ((await c.request('resources/list')).result as { resources: { uri: string; mimeType: string }[] }).resources;
    expect(listed).toEqual([expect.objectContaining({ uri: PANEL_URI, mimeType: PANEL_MIME })]);
    const read = ((await c.request('resources/read', { uri: PANEL_URI })).result as { contents: { uri: string; mimeType: string; text: string; _meta: Record<string, unknown> }[] }).contents[0]!;
    expect(read).toMatchObject({ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
      prefersBorder: true }, 'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: [ORIGIN, 'https://phantom.com', 'https://metamask.app.link'] } } });
    expect(read.text).toContain(JSON.stringify(ORIGIN));
    const tools = ((await c.request('tools/list')).result as { tools: { name: string; _meta?: Record<string, unknown> }[] }).tools;
    expect(tools.find(x => x.name === 'request_user_approval')?._meta).toMatchObject({ ui: { resourceUri: PANEL_URI }, 'openai/outputTemplate': PANEL_URI,
      securitySchemes: [{ type: 'oauth2', scopes: ['flofi.approval'] }] });
    // App-only tools never reach the model's tool list on a compliant host (visibility ["app"]).
    for (const name of ['open_approval_session', 'get_execution_progress']) expect(tools.find(x => x.name === name)?._meta?.ui).toEqual({ visibility: ['app'] });
  });

  it('can be switched off: no resource and no UI pointer, the approval link still works as text', async () => {
    const c = await client({ FLOFI_MCP_APP: 'disabled' });
    // With no resource registered the server does not advertise resources at all.
    const listed = await c.request('resources/list');
    expect((listed.result as { resources?: unknown[] } | undefined)?.resources ?? []).toEqual([]);
    expect(((await c.request('resources/read', { uri: PANEL_URI })).result)).toBeUndefined();
    const tools = ((await c.request('tools/list')).result as { tools: { name: string; _meta?: { ui?: unknown } }[] }).tools;
    expect(tools.find(x => x.name === 'request_user_approval')?._meta?.ui).toBeUndefined();
  });

  it('offers the in-frame environment probe only on listed hosts, and only as diagnostics', () => {
    const html = panelHtml({ origin: ORIGIN, inFrameProbeHosts: ['claude-desktop'] });
    expect(html).toContain('"inFrameProbeHosts":["claude-desktop"]');
    expect(html).toContain('Diagnostics only: in-frame execution is not enabled');
    expect(html).not.toMatch(/eth_requestAccounts|eth_sendTransaction|signTransaction|signMessage|personal_sign/);
  });
});

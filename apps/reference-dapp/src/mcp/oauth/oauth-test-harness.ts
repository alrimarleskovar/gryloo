// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 test harness: drives FloFi's OAuth endpoints exactly as a browser and an MCP client do over HTTP (consent
 * cookies, form posts, PKCE, token exchange), on a store the test chooses. CIMD documents come from an in-memory map; no
 * network, no model, no wallet.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FetchedDocument } from './cimd.ts';
import { handleOAuthRequest, type OAuthLogger, type OAuthRoute } from './server.ts';
import type { McpOAuthStore } from './store.ts';

export const ORIGIN = 'https://flofi.test';
export const CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata', CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
export const CHATGPT = 'https://chatgpt.com/oauth/BpZIpxL-aggt/client.json', CHATGPT_REDIRECT = 'https://chatgpt.com/connector/oauth/BpZIpxL-aggt';
export const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
export const INVITE = 'flofi-preview-invite-0001';
export const OAUTH_SECRET = 's'.repeat(48);
export const DOCUMENTS: Record<string, unknown> = {
  [CLAUDE]: { client_id: CLAUDE, client_name: 'Claude', client_uri: 'https://claude.ai', redirect_uris: [CLAUDE_REDIRECT],
    grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  [CHATGPT]: { client_id: CHATGPT, client_uri: 'https://chatgpt.com/', redirect_uris: [CHATGPT_REDIRECT], token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'ChatGPT',
    token_endpoint_auth_signing_alg: 'RS256', jwks_uri: 'https://chatgpt.com/oauth/jwks.json' },
  [CLAUDE_CODE]: { client_id: CLAUDE_CODE, client_name: 'Claude Code', client_uri: 'https://claude.ai', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
};
export function oauthEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { FLOFI_MCP_OAUTH: 'enabled', FLOFI_PUBLIC_ORIGIN: ORIGIN, FLOFI_MCP_OAUTH_SECRET: OAUTH_SECRET,
    FLOFI_MCP_OAUTH_INVITES: createHash('sha256').update(INVITE).digest('hex'), ...extra };
}
export function memoryFetcher(fetched: string[] = []) {
  return async (url: URL): Promise<FetchedDocument> => {
    fetched.push(url.href);
    const body = DOCUMENTS[url.href];
    return body ? { status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(body)) } : { status: 404, contentType: 'text/plain', body: Buffer.alloc(0) };
  };
}
export const pkce = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }; };
export type LogLine = { readonly event: string; readonly fields: Readonly<Record<string, unknown>> };
export function memoryOAuthLogger(): OAuthLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return { lines, info: (event, fields = {}) => { lines.push({ event, fields }); }, warn: (event, fields = {}) => { lines.push({ event, fields }); } };
}

/** One browser (a cookie jar) and one OAuth deployment configuration. */
export function oauthClient(options: { env: Record<string, string>; store?: McpOAuthStore; now?: () => Date; logger?: OAuthLogger; fetched?: string[]; ip?: string }) {
  const jar = new Map<string, string>(), ip = options.ip ?? `198.51.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const send = async (route: OAuthRoute, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; browser?: boolean } = {}) => {
    const headers: Record<string, string> = { 'x-forwarded-for': ip, ...init.headers };
    if (init.browser !== false && jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const response = await handleOAuthRequest(route, new Request(ORIGIN + path, { method: init.method ?? 'GET', headers, ...init.body === undefined ? {} : { body: init.body } }),
      { env: options.env, fetcher: memoryFetcher(options.fetched), ...options.store ? { store: options.store } : {}, ...options.now ? { now: options.now } : {},
        ...options.logger ? { logger: options.logger } : {} });
    if (init.browser !== false) for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';'), index = pair!.indexOf('='), name = pair!.slice(0, index), value = pair!.slice(index + 1);
      if (/Max-Age=0/.test(line) || value === '') jar.delete(name); else jar.set(name, value);
    }
    return response;
  };
  const form = (values: Record<string, string>) => new URLSearchParams(values).toString();
  return {
    jar, send,
    authorize: (params: Record<string, string>) => send('authorize', '/oauth/authorize?' + new URLSearchParams(params).toString()),
    decide: (values: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }) =>
      send('authorize', '/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(values) }),
    token: (values: Record<string, string>) => send('token', '/oauth/token', { method: 'POST', browser: false,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(values) }),
    revoke: (values: Record<string, string>) => send('revoke', '/oauth/revoke', { method: 'POST', browser: false,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(values) }),
    register: (body: unknown) => send('register', '/oauth/register', { method: 'POST', browser: false, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}
/** Hidden form values of a consent page. */
export function consentForm(html: string): { request_id: string; csrf: string } {
  const value = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? '';
  return { request_id: value('request_id'), csrf: value('csrf') };
}
/** The full consumer sign-in: authorize → consent (new account with invite, or the browser's account) → code → tokens. */
export async function signIn(client: ReturnType<typeof oauthClient>, options: { clientId?: string; redirectUri?: string; scope?: string; invite?: string | null } = {}) {
  const clientId = options.clientId ?? CLAUDE, redirectUri = options.redirectUri ?? CLAUDE_REDIRECT, { verifier, challenge } = pkce(), state = randomBytes(8).toString('hex');
  const page = await client.authorize({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge,
    code_challenge_method: 'S256', resource: ORIGIN + '/api/mcp', ...options.scope ? { scope: options.scope } : {} });
  if (page.status !== 200) throw new Error(`AUTHORIZE_${page.status}`);
  const decision = await client.decide({ ...consentForm(await page.text()), decision: 'approve', ...options.invite === null ? {} : { invite: options.invite ?? INVITE } });
  if (decision.status !== 303) throw new Error(`CONSENT_${decision.status}`);
  const location = new URL(decision.headers.get('location')!);
  if (location.searchParams.get('state') !== state || location.searchParams.get('iss') !== ORIGIN) throw new Error('REDIRECT_PARAMETERS');
  const code = location.searchParams.get('code')!;
  const response = await client.token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: ORIGIN + '/api/mcp' });
  const tokens = await response.json() as { access_token: string; refresh_token: string; scope: string; expires_in: number; token_type: string };
  if (response.status !== 200) throw new Error('TOKEN_' + JSON.stringify(tokens));
  return { ...tokens, code, verifier, clientId, redirectUri };
}

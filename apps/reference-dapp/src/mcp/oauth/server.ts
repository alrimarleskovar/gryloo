// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: FloFi's OAuth 2.1 authorization server for consumer MCP clients (MCP authorization spec 2026-07-28).
 *
 *   GET  /.well-known/oauth-protected-resource[/api/mcp]   RFC 9728 Protected Resource Metadata (one authorization server)
 *   GET  /.well-known/oauth-authorization-server           RFC 8414 metadata (PKCE S256, public clients, CIMD, RFC 9207 iss)
 *   GET  /oauth/authorize                                  validate → pending request → consent page
 *   POST /oauth/authorize                                  consent decision (CSRF + Origin) → code redirect with state and iss
 *   POST /oauth/token                                      authorization_code (PKCE) and refresh_token (rotation)
 *   POST /oauth/revoke                                     RFC 7009
 *   POST /oauth/register                                   RFC 7591, narrow, only when FLOFI_MCP_OAUTH_DCR=enabled
 *
 * Errors found before the client and its redirect URI are validated are shown on a FloFi page and never redirected. Tokens
 * are opaque, stored as digests, bound to the single resource `<origin>/api/mcp`, and never logged. Nothing issued here is
 * wallet ownership or financial authority.
 */
import { timingSafeEqual } from 'node:crypto';
import { cimdClientId, fetchClientMetadata, redirectMatches, redirectUriAcceptable, isLoopbackRedirect, type DocumentFetcher } from './cimd.ts';
import { consentPage, errorPage, pageHeaders, type ConsentView } from './consent-page.ts';
import { DEFAULT_SCOPES, inviteAccepted, MCP_SCOPES, readOAuthConfig, type McpScope, type OAuthConfig } from './config.ts';
import { credentialDigest, credentialOf, newCredential, newId, PKCE_CHALLENGE, pkceMatches, sealValue, unsealValue } from './crypto.ts';
import { deploymentOAuthStore, STORE_UNAVAILABLE } from './runtime.ts';
import type { ClientRecord, McpOAuthStore, TokenIssue } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Fields = Readonly<Record<string, string | number | boolean | null>>;
export type OAuthLogger = { readonly info: (event: string, fields?: Fields) => void; readonly warn: (event: string, fields?: Fields) => void };
export type OAuthRoute = 'protected-resource' | 'authorization-server' | 'authorize' | 'token' | 'revoke' | 'register';
export type OAuthOptions = { readonly env?: Env; readonly store?: McpOAuthStore; readonly now?: () => Date; readonly fetcher?: DocumentFetcher; readonly logger?: OAuthLogger };

export const ACCESS_TOKEN_SECONDS = 900;
export const REFRESH_FAMILY_SECONDS = 30 * 86_400;
export const AUTHORIZATION_CODE_SECONDS = 60;
export const PENDING_AUTHORIZATION_SECONDS = 600;
export const REFRESH_REUSE_GRACE_MS = 10_000;
export const ACCOUNT_COOKIE = 'flofi_mcp_account';
export const CONSENT_COOKIE = 'flofi_oauth_consent';
const ACCOUNT_SECONDS = 30 * 86_400;
const MAX_FORM_BYTES = 8_192;
/** Abuse limits (fixed windows): [limit, window seconds]. */
// Token requests come from the MCP hosts' servers (all users of one host share their egress addresses), so their limit is higher.
export const LIMITS = Object.freeze({ authorize: [30, 600], consent: [20, 600], invite: [10, 3_600], token: [600, 600], register: [10, 3_600], cimd: [30, 3_600] } as const);

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
  'access-control-max-age': '600' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS, ...extra } });
const oauthError = (error: string, status = 400) => json({ error }, status);
const html = (body: string, status: number, formOrigins: readonly string[] = [], extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...pageHeaders(formOrigins), ...extra } });
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
const later = (now: Date, s: number) => new Date(now.getTime() + s * 1000);

/** RFC 9728 metadata for the MCP endpoint. */
export function protectedResourceMetadata(config: OAuthConfig) {
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [...MCP_SCOPES], bearer_methods_supported: ['header'],
    resource_name: 'FloFi' };
}
/** RFC 8414 metadata. Only public clients with PKCE S256; no implicit, password or client-credentials grants. */
export function authorizationServerMetadata(config: OAuthConfig) {
  return { issuer: config.issuer, authorization_endpoint: `${config.origin}/oauth/authorize`, token_endpoint: `${config.origin}/oauth/token`,
    revocation_endpoint: `${config.origin}/oauth/revoke`, ...config.dcr.enabled ? { registration_endpoint: `${config.origin}/oauth/register` } : {},
    response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...MCP_SCOPES], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true };
}

/** Parameters of a query string or form; a repeated parameter is an error (RFC 6749 §3.1). */
function single(params: URLSearchParams): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const [key, value] of params) { if (out.has(key)) return null; out.set(key, value); }
  return out;
}
function parseScopes(raw: string | undefined): McpScope[] | null {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_SCOPES];
  const asked = raw.split(' ').filter(Boolean);
  // `offline_access` is how some clients ask for a refresh token: FloFi always issues one, so it is accepted and ignored.
  const known = asked.filter(s => s !== 'offline_access');
  if (!known.every(s => (MCP_SCOPES as readonly string[]).includes(s))) return null;
  const scopes = MCP_SCOPES.filter(s => known.includes(s));
  return scopes.length ? scopes : [...DEFAULT_SCOPES];
}
function cookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return out;
}
function cookie(config: OAuthConfig, name: string, value: string, maxAge: number, sameSite: 'Strict' | 'Lax', path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}${config.secureCookies ? '; Secure' : ''}`;
}
/** A digest of the caller's IP for rate limits (never stored in clear). Vercel sets `x-forwarded-for`. */
function ipBucket(config: OAuthConfig, request: Request): string {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
  return credentialDigest(config.keys.ip, ip).toString('hex').slice(0, 32);
}
async function readForm(request: Request): Promise<Map<string, string> | null> {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_FORM_BYTES) return null;
  const text = await request.text();
  return text.length > MAX_FORM_BYTES ? null : single(new URLSearchParams(text));
}

/** The browser's FloFi account, from the sealed account cookie, if it is still an active account of this deployment. */
export async function browserAccount(config: OAuthConfig, store: McpOAuthStore, request: Request, now: Date): Promise<string | null> {
  const value = unsealValue<{ a: string; d: string; e: number }>('ma1', cookies(request).get(ACCOUNT_COOKIE), config.keys.account, seconds(now));
  if (!value || value.d !== new URL(config.origin).host || typeof value.a !== 'string' || !/^mcpacct_[a-z2-7]{26}$/.test(value.a)) return null;
  return await store.accountActive(value.a) ? value.a : null;
}
export const accountCookie = (config: OAuthConfig, accountId: string, now: Date) =>
  cookie(config, ACCOUNT_COOKIE, sealValue('ma1', { a: accountId, d: new URL(config.origin).host, e: seconds(now) + ACCOUNT_SECONDS }, config.keys.account), ACCOUNT_SECONDS, 'Lax');

type Context = { readonly config: OAuthConfig; readonly store: McpOAuthStore; readonly now: Date; readonly fetcher?: DocumentFetcher; readonly logger?: OAuthLogger };

/** A usable client: a cached or freshly fetched CIMD document, or a dynamically registered client. */
async function resolveClient(ctx: Context, clientId: string): Promise<ClientRecord | null> {
  const cached = await ctx.store.getClient(clientId, ctx.now);
  if (cached) return cached;
  const check = cimdClientId(clientId, ctx.config.cimdHosts);
  if (!check.ok) return null;
  if (!await ctx.store.allow(`cimd:host:${check.url.hostname}`, LIMITS.cimd[0], LIMITS.cimd[1], ctx.now)) return null;
  const fetched = await fetchClientMetadata(clientId, ctx.config.cimdHosts, ctx.now, ctx.fetcher);
  if (!fetched.ok) { ctx.logger?.warn('mcp.oauth.cimd_rejected', { reason: fetched.reason, host: check.url.hostname }); return null; }
  await ctx.store.saveClient(fetched.client, ctx.now);
  return fetched.client;
}
/** A 303 back to the client's registered redirect URI with the response parameters and `iss` (RFC 9207). */
function redirectWith(config: OAuthConfig, redirectUri: string, params: Record<string, string>, cookiesToSet: readonly string[] = []): Response {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries({ ...params, iss: config.issuer })) url.searchParams.set(key, value);
  const headers = new Headers({ location: url.href, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const value of cookiesToSet) headers.append('set-cookie', value);
  return new Response(null, { status: 303, headers });
}
const FORM_ORIGIN = (redirectUri: string) => new URL(redirectUri).origin;

async function authorizeGet(ctx: Context, request: Request): Promise<Response> {
  const { config } = ctx, params = single(new URL(request.url).searchParams);
  if (!params) return html(errorPage('Request refused', 'A parameter was repeated.'), 400);
  if (!await ctx.store.allow(`authorize:ip:${ipBucket(config, request)}`, LIMITS.authorize[0], LIMITS.authorize[1], ctx.now))
    return html(errorPage('Too many requests', 'Please wait a few minutes and try again.'), 429);
  const clientId = params.get('client_id') ?? '', redirectUri = params.get('redirect_uri') ?? '';
  const client = clientId ? await resolveClient(ctx, clientId) : null;
  if (!client) return html(errorPage('Unknown application', 'FloFi does not recognise the application that sent you here.'), 400);
  if (!redirectUriAcceptable(redirectUri) || !redirectMatches(client.redirectUris, redirectUri))
    return html(errorPage('Request refused', 'The return address is not registered for this application.'), 400);
  // From here on the client and its redirect URI are known: errors go back to the client (with state and iss).
  const state = params.get('state'), fail = (error: string) => redirectWith(config, redirectUri, { error, ...state ? { state } : {} });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type');
  if (!state || state.length > 512) return fail('invalid_request');
  const challenge = params.get('code_challenge') ?? '';
  if (params.get('code_challenge_method') !== 'S256' || !PKCE_CHALLENGE.test(challenge)) return fail('invalid_request');
  const scopes = parseScopes(params.get('scope'));
  if (!scopes) return fail('invalid_scope');
  const resource = params.get('resource');
  if (resource !== undefined && resource !== config.resource) return fail('invalid_target');
  const requestId = newId('oar'), csrf = newCredential('csrf');
  await ctx.store.createAuthorization({ requestId, clientId: client.clientId, clientName: client.clientName, redirectUri, state, codeChallenge: challenge, scopes,
    resource: config.resource, csrfDigest: credentialDigest(config.keys.csrf, csrf), expiresAt: later(ctx.now, PENDING_AUTHORIZATION_SECONDS) });
  const existing = await browserAccount(config, ctx.store, request, ctx.now);
  const view: ConsentView = { requestId, csrf, clientName: client.clientName, clientId: client.clientId, redirectUri, scopes,
    account: existing ? { existing } : { create: true, inviteRequired: config.access === 'invite' } };
  return html(consentPage(view), 200, [FORM_ORIGIN(redirectUri)],
    { 'set-cookie': cookie(config, CONSENT_COOKIE, `${requestId}.${csrf}`, PENDING_AUTHORIZATION_SECONDS, 'Strict', '/oauth') });
}

async function authorizePost(ctx: Context, request: Request): Promise<Response> {
  const { config } = ctx;
  // A consent decision is only ever posted by FloFi's own page.
  if (request.headers.get('origin') !== config.origin || !['same-origin', null].includes(request.headers.get('sec-fetch-site')))
    return html(errorPage('Request refused', 'This form must be submitted from FloFi.'), 403);
  if (!await ctx.store.allow(`consent:ip:${ipBucket(config, request)}`, LIMITS.consent[0], LIMITS.consent[1], ctx.now))
    return html(errorPage('Too many requests', 'Please wait a few minutes and try again.'), 429);
  const form = await readForm(request);
  const requestId = form?.get('request_id') ?? '', csrf = credentialOf('csrf', form?.get('csrf'));
  const bound = cookies(request).get(CONSENT_COOKIE) ?? '', expected = Buffer.from(`${requestId}.${csrf ?? ''}`), supplied = Buffer.from(bound);
  if (!form || !csrf || !/^oar_[a-z2-7]{26}$/.test(requestId) || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
    return html(errorPage('Request refused', 'This consent form is no longer valid. Start the connection again from your app.'), 403);
  const pending = await ctx.store.getAuthorization(requestId);
  if (!pending || pending.status !== 'PENDING' || pending.expiresAt <= ctx.now)
    return html(errorPage('Request expired', 'This connection request has expired or was already decided. Start it again from your app.'), 400);
  const csrfDigest = credentialDigest(config.keys.csrf, csrf), clearConsent = cookie(config, CONSENT_COOKIE, '', 0, 'Strict', '/oauth');
  if (form.get('decision') === 'deny') {
    const denied = await ctx.store.decide(requestId, csrfDigest, { decision: 'DENY' }, ctx.now);
    if (!denied) return html(errorPage('Request expired', 'This connection request has expired or was already decided.'), 400);
    ctx.logger?.info('mcp.oauth.denied', { client: pending.clientName });
    return redirectWith(config, pending.redirectUri, { error: 'access_denied', state: pending.state }, [clearConsent]);
  }
  if (form.get('decision') !== 'approve') return html(errorPage('Request refused', 'No decision was made.'), 400);
  const existing = await browserAccount(config, ctx.store, request, ctx.now);
  if (!existing && config.access === 'invite') {
    const allowed = await ctx.store.allow(`invite:ip:${ipBucket(config, request)}`, LIMITS.invite[0], LIMITS.invite[1], ctx.now);
    if (!allowed || !inviteAccepted(config, form.get('invite') ?? '')) {
      return html(consentPage({ requestId, csrf, clientName: pending.clientName, clientId: pending.clientId, redirectUri: pending.redirectUri, scopes: pending.scopes,
        account: { create: true, inviteRequired: true }, error: allowed ? 'That invite code was not accepted.' : 'Too many attempts. Please wait and try again.' }),
      allowed ? 400 : 429, [FORM_ORIGIN(pending.redirectUri)]);
    }
  }
  const accountId = existing ?? newId('mcpacct'), code = newCredential('code');
  const decided = await ctx.store.decide(requestId, csrfDigest, { decision: 'APPROVE', accountId, createAccount: !existing, grantId: newId('grt'),
    codeDigest: credentialDigest(config.keys.token, code), codeExpiresAt: later(ctx.now, AUTHORIZATION_CODE_SECONDS) }, ctx.now);
  if (!decided) return html(errorPage('Request expired', 'This connection request has expired or was already decided.'), 400);
  ctx.logger?.info('mcp.oauth.approved', { client: decided.clientName, new_account: !existing });
  return redirectWith(config, decided.redirectUri, { code, state: decided.state }, [clearConsent, accountCookie(config, accountId, ctx.now)]);
}

function tokens(config: OAuthConfig, now: Date, scopes: readonly McpScope[], familyId: string, familyExpiresAt: Date) {
  const access = newCredential('access'), refresh = newCredential('refresh');
  const issue: TokenIssue = { accessDigest: credentialDigest(config.keys.token, access), accessExpiresAt: new Date(Math.min(later(now, ACCESS_TOKEN_SECONDS).getTime(), familyExpiresAt.getTime())),
    refreshDigest: credentialDigest(config.keys.token, refresh), refreshExpiresAt: familyExpiresAt, familyId, familyExpiresAt, scopes, resource: config.resource };
  const body = () => ({ access_token: access, token_type: 'Bearer', expires_in: Math.max(1, seconds(issue.accessExpiresAt) - seconds(now)), refresh_token: refresh,
    scope: issue.scopes.join(' ') });
  return { issue, body };
}

async function token(ctx: Context, request: Request): Promise<Response> {
  const { config } = ctx, form = await readForm(request);
  if (!form) return oauthError('invalid_request');
  const clientId = form.get('client_id') ?? '';
  if (!clientId || clientId.length > 512) return oauthError('invalid_client', 401);
  if (!await ctx.store.allow(`token:ip:${ipBucket(config, request)}`, LIMITS.token[0], LIMITS.token[1], ctx.now)) return oauthError('slow_down', 429);
  const resource = form.get('resource') ?? null;
  if (resource !== null && resource !== config.resource) return oauthError('invalid_target');
  if (Math.random() < 0.02) await ctx.store.purge(ctx.now).catch(() => undefined);
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = credentialOf('code', form.get('code'));
    if (!code) return oauthError('invalid_grant');
    const redirectUri = form.get('redirect_uri') ?? '', verifier = form.get('code_verifier');
    let minted: ReturnType<typeof tokens> | null = null;
    const result = await ctx.store.redeemCode(credentialDigest(config.keys.token, code), ctx.now,
      a => a.clientId !== clientId ? 'CLIENT_MISMATCH' : a.redirectUri !== redirectUri ? 'REDIRECT_MISMATCH' : a.resource !== config.resource ? 'RESOURCE_MISMATCH'
        : pkceMatches(verifier, a.codeChallenge) ? null : 'PKCE_MISMATCH',
      a => (minted = tokens(config, ctx.now, a.scopes, newId('fam'), later(ctx.now, REFRESH_FAMILY_SECONDS))).issue);
    if (!result.ok) { ctx.logger?.warn('mcp.oauth.token_refused', { grant: 'authorization_code', reason: result.reason }); return oauthError(result.error); }
    ctx.logger?.info('mcp.oauth.token_issued', { grant: 'authorization_code' });
    return json((minted as unknown as ReturnType<typeof tokens>).body());
  }
  if (grantType === 'refresh_token') {
    const refresh = credentialOf('refresh', form.get('refresh_token'));
    if (!refresh) return oauthError('invalid_grant');
    const scope = form.get('scope'), scopes = scope === undefined ? null : parseScopes(scope);
    if (scope !== undefined && !scopes) return oauthError('invalid_scope');
    let minted: ReturnType<typeof tokens> | null = null;
    const result = await ctx.store.rotateRefresh(credentialDigest(config.keys.token, refresh), clientId, ctx.now, REFRESH_REUSE_GRACE_MS, { scopes, resource },
      (granted, _resource, familyId, familyExpiresAt) => (minted = tokens(config, ctx.now, granted, familyId, familyExpiresAt)).issue);
    if (!result.ok) {
      ctx.logger?.warn('mcp.oauth.token_refused', { grant: 'refresh_token', reason: result.reason });
      // Clients treat any refresh failure as "sign in again"; scope and target errors keep their own codes.
      return oauthError(result.error);
    }
    return json((minted as unknown as ReturnType<typeof tokens>).body());
  }
  return oauthError(grantType ? 'unsupported_grant_type' : 'invalid_request');
}

async function revoke(ctx: Context, request: Request): Promise<Response> {
  const form = await readForm(request);
  if (!form || !form.get('token')) return oauthError('invalid_request');
  const value = form.get('token')!, credential = credentialOf('refresh', value) ?? credentialOf('access', value), clientId = form.get('client_id') ?? '';
  if (credential && clientId) await ctx.store.revoke(credentialDigest(ctx.config.keys.token, credential), clientId, ctx.now);
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store', ...CORS } });
}

const DISPLAY = /^[\p{L}\p{N} .,'()&+_-]{1,64}$/u;
async function register(ctx: Context, request: Request): Promise<Response> {
  const { config } = ctx;
  if (!config.dcr.enabled) return json({ error: 'invalid_request' }, 404);
  if (!await ctx.store.allow(`register:ip:${ipBucket(config, request)}`, LIMITS.register[0], LIMITS.register[1], ctx.now)) return oauthError('slow_down', 429);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json') || (Number.isFinite(declared) && declared > MAX_FORM_BYTES))
    return oauthError('invalid_client_metadata');
  let meta: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_FORM_BYTES) return oauthError('invalid_client_metadata');
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return oauthError('invalid_client_metadata');
    meta = parsed as Record<string, unknown>;
  } catch { return oauthError('invalid_client_metadata'); }
  const redirects = meta.redirect_uris;
  const allowedRedirect = (uri: string) => isLoopbackRedirect(uri) || config.dcr.redirectHosts.includes(new URL(uri).hostname) && uri.startsWith('https://');
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > 10 || !redirects.every(redirectUriAcceptable) || !(redirects as string[]).every(allowedRedirect))
    return json({ error: 'invalid_redirect_uri' }, 400);
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none') return oauthError('invalid_client_metadata');
  const grants = meta.grant_types ?? ['authorization_code', 'refresh_token'], responses = meta.response_types ?? ['code'];
  if (!Array.isArray(grants) || !grants.includes('authorization_code') || !grants.every(g => g === 'authorization_code' || g === 'refresh_token') ||
      !Array.isArray(responses) || !responses.every(r => r === 'code')) return oauthError('invalid_client_metadata');
  const name = typeof meta.client_name === 'string' && DISPLAY.test(meta.client_name.trim()) ? meta.client_name.trim() : 'Unnamed MCP client';
  const clientId = `flofi_dcr_${newId('oar').slice(4)}`;
  await ctx.store.saveClient({ clientId, kind: 'DCR', clientName: name, redirectUris: [...redirects as string[]], metadataSha256: credentialDigest(config.keys.ip, JSON.stringify(meta)).toString('hex'),
    expiresAt: later(ctx.now, 30 * 86_400) }, ctx.now);
  ctx.logger?.info('mcp.oauth.client_registered', { kind: 'DCR' });
  return json({ client_id: clientId, client_id_issued_at: seconds(ctx.now), client_name: name, redirect_uris: redirects, grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none' }, 201);
}

/** One OAuth endpoint. Disabled or misconfigured → 404/503; the store unavailable → 503 `MCP_OAUTH_STORE_UNAVAILABLE`. */
export async function handleOAuthRequest(route: OAuthRoute, request: Request, options: OAuthOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, config = readOAuthConfig(env);
  if (!config.enabled) {
    if (config.code === 'MCP_OAUTH_CONFIGURATION_INVALID') options.logger?.warn('mcp.oauth.configuration_invalid', { reason: config.reason ?? null });
    return json({ ok: false, code: config.code }, config.code === 'MCP_OAUTH_NOT_ENABLED' ? 404 : 503);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const now = options.now?.() ?? new Date();
  if (route === 'protected-resource' || route === 'authorization-server') {
    if (request.method !== 'GET') return json({ error: 'invalid_request' }, 405, { allow: 'GET' });
    // Public, cacheable discovery documents (no credential involved).
    return new Response(JSON.stringify(route === 'protected-resource' ? protectedResourceMetadata(config) : authorizationServerMetadata(config)),
      { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', ...CORS } });
  }
  let store: McpOAuthStore;
  try { store = options.store ?? await deploymentOAuthStore(env); }
  catch {
    options.logger?.warn('mcp.oauth.store_unavailable');
    return route === 'authorize' ? html(errorPage('FloFi is unavailable', 'Sign-in is not available on this deployment right now.'), 503) : json({ error: 'temporarily_unavailable', code: STORE_UNAVAILABLE }, 503);
  }
  const ctx: Context = { config, store, now, ...options.fetcher ? { fetcher: options.fetcher } : {}, ...options.logger ? { logger: options.logger } : {} };
  try {
    if (route === 'authorize') return request.method === 'GET' ? await authorizeGet(ctx, request) : request.method === 'POST' ? await authorizePost(ctx, request)
      : html(errorPage('Request refused', 'Unsupported method.'), 405);
    if (request.method !== 'POST') return json({ error: 'invalid_request' }, 405, { allow: 'POST' });
    if (route === 'token') return await token(ctx, request);
    if (route === 'revoke') return await revoke(ctx, request);
    return await register(ctx, request);
  } catch {
    options.logger?.warn('mcp.oauth.internal_error', { route });
    return route === 'authorize' ? html(errorPage('Something went wrong', 'Please start the connection again from your app.'), 500) : json({ error: 'server_error' }, 500);
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002 foundations: configuration (fail closed, dedicated key), credentials and digests, PKCE, sealed cookies, and
 * the Client ID Metadata Document checks (SSRF guard, exact redirect matching, the real Claude/ChatGPT documents). Offline.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cimdClientId, fetchClientMetadata, isPublicAddress, parseClientMetadata, pinnedHttpsGet, redirectMatches, redirectUriAcceptable } from './cimd.ts';
import { deriveKey, inviteAccepted, publicOrigin, readOAuthConfig, type OAuthConfig } from './config.ts';
import { credentialDigest, credentialOf, newCredential, newId, pkceMatches, sealValue, TOKEN_PREFIX, unsealValue } from './crypto.ts';

const SECRET = 'o'.repeat(48);
const base = { FLOFI_MCP_OAUTH: 'enabled', FLOFI_PUBLIC_ORIGIN: 'https://flofi.example', FLOFI_MCP_OAUTH_SECRET: SECRET };
const enabled = (env: Record<string, string>) => { const c = readOAuthConfig(env); if (!c.enabled) throw new Error(c.code + ' ' + c.reason); return c as OAuthConfig; };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('BUILD-MCP-002 OAuth configuration', () => {
  it('is off unless explicitly enabled', () => {
    expect(readOAuthConfig({})).toEqual({ enabled: false, code: 'MCP_OAUTH_NOT_ENABLED' });
    expect(readOAuthConfig({ ...base, FLOFI_MCP_OAUTH: 'true' })).toEqual({ enabled: false, code: 'MCP_OAUTH_NOT_ENABLED' });
  });
  it('derives issuer, resource and metadata URLs from FLOFI_PUBLIC_ORIGIN only', () => {
    const c = enabled(base);
    expect([c.issuer, c.resource, c.resourceMetadataUrl]).toEqual(['https://flofi.example', 'https://flofi.example/api/mcp',
      'https://flofi.example/.well-known/oauth-protected-resource/api/mcp']);
    expect(c).toMatchObject({ access: 'invite', cimdHosts: ['claude.ai', 'chatgpt.com'], dcr: { enabled: false, redirectHosts: ['claude.ai', 'chatgpt.com'] }, secureCookies: true });
  });
  it('accepts only an exact HTTPS origin; plain HTTP only on a local loopback server', () => {
    for (const origin of ['https://flofi.example/', 'https://flofi.example/x', 'http://flofi.example', 'https://u:p@flofi.example', 'ftp://flofi.example', 'flofi.example', ''])
      expect(publicOrigin({ FLOFI_PUBLIC_ORIGIN: origin }), origin).toBeNull();
    expect(publicOrigin({ FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100' })).toBe('http://127.0.0.1:3100');
    expect(publicOrigin({ FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100', VERCEL: '1' })).toBeNull();
    expect(enabled({ ...base, FLOFI_PUBLIC_ORIGIN: 'http://localhost:3000' }).secureCookies).toBe(false);
  });
  it('refuses a short secret and any reuse of the internal API token or the wallet-session secret', () => {
    expect(readOAuthConfig({ ...base, FLOFI_MCP_OAUTH_SECRET: 'short' })).toMatchObject({ code: 'MCP_OAUTH_CONFIGURATION_INVALID', reason: 'FLOFI_MCP_OAUTH_SECRET' });
    expect(readOAuthConfig({ ...base, API_AUTH_TOKEN: SECRET })).toMatchObject({ code: 'MCP_OAUTH_CONFIGURATION_INVALID', reason: 'FLOFI_MCP_OAUTH_SECRET_REUSED' });
    expect(readOAuthConfig({ ...base, FLOFI_SESSION_SECRET: SECRET })).toMatchObject({ code: 'MCP_OAUTH_CONFIGURATION_INVALID', reason: 'FLOFI_MCP_OAUTH_SECRET_REUSED' });
    expect(enabled({ ...base, API_AUTH_TOKEN: 'a'.repeat(48), FLOFI_SESSION_SECRET: 'b'.repeat(48) }).enabled).toBe(true);
  });
  it('validates access mode, invites, host lists and the DCR flag', () => {
    for (const [key, value] of [['FLOFI_MCP_OAUTH_ACCESS', 'public'], ['FLOFI_MCP_OAUTH_INVITES', 'not-a-digest'], ['FLOFI_MCP_CIMD_HOSTS', 'http://claude.ai'],
      ['FLOFI_MCP_CIMD_HOSTS', '127.0.0.1'], ['FLOFI_MCP_OAUTH_DCR', 'yes'], ['FLOFI_MCP_DCR_REDIRECT_HOSTS', 'claude.ai/x']] as const)
      expect(readOAuthConfig({ ...base, [key]: value }), `${key}=${value}`).toMatchObject({ code: 'MCP_OAUTH_CONFIGURATION_INVALID' });
    const c = enabled({ ...base, FLOFI_MCP_OAUTH_ACCESS: 'open', FLOFI_MCP_OAUTH_INVITES: `${sha('preview-invite-1')},${sha('preview-invite-2')}`,
      FLOFI_MCP_CIMD_HOSTS: 'Claude.ai', FLOFI_MCP_OAUTH_DCR: 'enabled' });
    expect([c.access, c.cimdHosts, c.dcr.enabled, c.invites.length]).toEqual(['open', ['claude.ai'], true, 2]);
    expect([inviteAccepted(c, 'preview-invite-2'), inviteAccepted(c, ' preview-invite-1 '), inviteAccepted(c, 'preview-invite-3'), inviteAccepted(c, 'x')])
      .toEqual([true, true, false, false]);
  });
  it('keeps one key per purpose, all different from each other', () => {
    const k = enabled(base).keys, all = [k.token, k.csrf, k.handoff, k.account, k.ip].map(b => b.toString('hex'));
    expect(new Set(all).size).toBe(5);
    expect(deriveKey(SECRET, 'token').equals(k.token)).toBe(true);
  });
  it('fails closed on a Preview without a known branch', () => {
    expect(readOAuthConfig({ ...base, VERCEL: '1', VERCEL_ENV: 'preview' })).toMatchObject({ code: 'MCP_OAUTH_CONFIGURATION_INVALID', reason: 'TENANT' });
  });
});

describe('BUILD-MCP-002 credentials', () => {
  it('are 256-bit, prefixed, and recognized only in their own kind', () => {
    const access = newCredential('access'), refresh = newCredential('refresh');
    expect(access).toMatch(/^flofi_at_[A-Za-z0-9_-]{43}$/);
    expect(refresh).toMatch(/^flofi_rt_[A-Za-z0-9_-]{43}$/);
    expect(credentialOf('access', access)).toBe(access);
    expect([credentialOf('access', refresh), credentialOf('refresh', access), credentialOf('access', access + 'x'), credentialOf('access', 42)]).toEqual([null, null, null, null]);
    expect(Object.values(TOKEN_PREFIX).every(p => p.startsWith('flofi_'))).toBe(true);
  });
  it('store keyed digests: the same token under another key is a different digest', () => {
    const token = newCredential('access');
    expect(credentialDigest(deriveKey(SECRET, 'token'), token).equals(credentialDigest(deriveKey(SECRET, 'token'), token))).toBe(true);
    expect(credentialDigest(deriveKey(SECRET, 'token'), token).equals(credentialDigest(deriveKey('p'.repeat(48), 'token'), token))).toBe(false);
  });
  it('identifiers are prefixed base32 with 128 random bits', () => {
    const ids = Array.from({ length: 200 }, () => newId('apr'));
    expect(ids.every(id => /^apr_[a-z2-7]{26}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(200);
  });
  it('PKCE S256 matches RFC 7636 appendix B and refuses everything else', () => {
    expect(pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(true);
    expect(pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXl', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    // `plain` would send the verifier as the challenge: never accepted.
    expect(pkceMatches('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(pkceMatches('short', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
    expect(pkceMatches(undefined, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')).toBe(false);
  });
  it('sealed values reject tampering, another key, another kind and expiry', () => {
    const key = deriveKey(SECRET, 'account-session'), sealed = sealValue('a1', { a: 'mcpacct_x', e: 2_000 }, key);
    expect(unsealValue<{ a: string; e: number }>('a1', sealed, key, 1_000)?.a).toBe('mcpacct_x');
    expect(unsealValue('a1', sealed, key, 2_000)).toBeNull();
    expect(unsealValue('a2', sealed, key, 1_000)).toBeNull();
    expect(unsealValue('a1', sealed, deriveKey(SECRET, 'csrf'), 1_000)).toBeNull();
    const [kind, body, mac] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ a: 'mcpacct_y', e: 2_000 })).toString('base64url');
    expect(unsealValue('a1', `${kind}.${forged}.${mac}`, key, 1_000)).toBeNull();
    expect(unsealValue('a1', `${kind}.${body}`, key, 1_000)).toBeNull();
  });
});

const CHATGPT = 'https://chatgpt.com/oauth/BpZIpxL-aggt/client.json', CLAUDE = 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
/** The live documents as fetched on 2026-10-06 (public client metadata). */
const DOCUMENTS: Record<string, unknown> = {
  [CHATGPT]: { client_id: CHATGPT, client_uri: 'https://chatgpt.com/', redirect_uris: ['https://chatgpt.com/connector/oauth/BpZIpxL-aggt'],
    token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], client_name: 'ChatGPT', logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png', token_endpoint_auth_signing_alg: 'RS256',
    jwks_uri: 'https://chatgpt.com/oauth/jwks.json' },
  [CLAUDE]: { client_id: CLAUDE, client_name: 'Claude', client_uri: 'https://claude.ai', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  [CLAUDE_CODE]: { client_id: CLAUDE_CODE, client_name: 'Claude Code', client_uri: 'https://claude.ai', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
};
const doc = (body: unknown, extra: Partial<{ status: number; contentType: string }> = {}) =>
  ({ status: extra.status ?? 200, contentType: extra.contentType ?? 'application/json; charset=utf-8', body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
const HOSTS = ['claude.ai', 'chatgpt.com'], NOW = new Date('2026-10-06T12:00:00Z');

describe('BUILD-MCP-002 Client ID Metadata Documents', () => {
  it('accepts the real Claude, Claude Code and ChatGPT documents (ChatGPT lists `none` beside private_key_jwt)', async () => {
    for (const [id, body] of Object.entries(DOCUMENTS)) {
      const result = await fetchClientMetadata(id, HOSTS, NOW, async url => { expect(url.href).toBe(id); return doc(body); });
      expect(result.ok, id).toBe(true);
      if (result.ok) expect(result.client).toMatchObject({ clientId: id, kind: 'CIMD', redirectUris: (body as { redirect_uris: string[] }).redirect_uris,
        expiresAt: new Date(NOW.getTime() + 3_600_000) });
    }
  });
  it('refuses any client id outside the narrow URL form before any network access', async () => {
    const never = async () => { throw new Error('fetched'); };
    for (const id of ['http://claude.ai/oauth/x', 'https://claude.ai:8443/oauth/x', 'https://claude.ai/oauth/x?y=1', 'https://claude.ai/oauth/x#f', 'https://u@claude.ai/oauth/x',
      'https://claude.ai/', 'https://evil.example/oauth/x', 'https://claude.ai.evil.example/x', 'https://127.0.0.1/x', 'https://claude.ai/a/../b', 'not a url', 'https://CLAUDE.ai/oauth/x'])
      expect((await fetchClientMetadata(id, HOSTS, NOW, never)).ok, id).toBe(false);
    expect(cimdClientId(CLAUDE, HOSTS).ok).toBe(true);
  });
  it('refuses documents that do not describe the URL, carry unusable redirects, need a secret, or break the transport bounds', () => {
    const url = new URL(CLAUDE), good = DOCUMENTS[CLAUDE] as Record<string, unknown>;
    const cases: [ReturnType<typeof doc>, string][] = [
      [doc({ ...good, client_id: 'https://claude.ai/oauth/other' }), 'CIMD_CLIENT_ID_MISMATCH'],
      [doc({ ...good, redirect_uris: [] }), 'CIMD_REDIRECT_URIS'],
      [doc({ ...good, redirect_uris: ['http://evil.example/cb'] }), 'CIMD_REDIRECT_URIS'],
      [doc({ ...good, redirect_uris: ['https://claude.ai/cb#frag'] }), 'CIMD_REDIRECT_URIS'],
      [doc({ ...good, redirect_uris: ['javascript:alert(1)'] }), 'CIMD_REDIRECT_URIS'],
      [doc({ ...good, token_endpoint_auth_method: 'client_secret_basic' }), 'CIMD_AUTH_METHOD_UNSUPPORTED'],
      [doc({ ...good, token_endpoint_auth_method: 'private_key_jwt' }), 'CIMD_AUTH_METHOD_UNSUPPORTED'],
      [doc({ ...good, grant_types: ['client_credentials'] }), 'CIMD_GRANT_TYPES'],
      [doc({ ...good, response_types: ['token'] }), 'CIMD_RESPONSE_TYPES'],
      [doc(good, { status: 302 }), 'CIMD_HTTP_STATUS'],
      [doc(good, { contentType: 'text/html' }), 'CIMD_CONTENT_TYPE'],
      [doc('{not json'), 'CIMD_NOT_JSON'],
      [doc([good]), 'CIMD_NOT_OBJECT'],
      [doc({ ...good, padding: 'x'.repeat(6_000) }), 'CIMD_TOO_LARGE'],
    ];
    for (const [document, reason] of cases) expect(parseClientMetadata(url, document, NOW), reason).toEqual({ ok: false, reason });
    expect(parseClientMetadata(url, doc({ ...good, client_name: '<script>alert(1)</script>' }), NOW)).toMatchObject({ ok: true, client: { clientName: 'claude.ai' } });
  });
  it('blocks private, loopback, link-local, CGNAT, metadata, multicast, documentation and translated addresses', () => {
    for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.2.1',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:7f00:1::', '2001:db8::1', 'ff02::1', 'localhost', ''])
      expect(isPublicAddress(address), address).toBe(false);
    for (const address of ['8.8.8.8', '1.1.1.1', '160.79.104.10', '2606:4700:4700::1111']) expect(isPublicAddress(address), address).toBe(true);
  });
  it('pins the fetch to a checked public address: a host resolving to loopback is refused before connecting', async () => {
    await expect(pinnedHttpsGet(new URL('https://localhost/oauth/client'))).rejects.toThrow('CIMD_ADDRESS_NOT_PUBLIC');
  });
  it('matches redirect URIs exactly, except the RFC 8252 loopback rule (any port) for a port-less loopback registration', () => {
    const claudeCode = ['http://localhost/callback', 'http://127.0.0.1/callback'];
    expect(redirectMatches(claudeCode, 'http://localhost:53682/callback')).toBe(true);
    expect(redirectMatches(claudeCode, 'http://127.0.0.1:1/callback')).toBe(true);
    expect(redirectMatches(claudeCode, 'http://localhost:53682/callback/x')).toBe(false);
    expect(redirectMatches(claudeCode, 'http://localhost:53682/callback?x=1')).toBe(false);
    expect(redirectMatches(claudeCode, 'http://evil.example:53682/callback')).toBe(false);
    expect(redirectMatches(claudeCode, 'https://localhost:53682/callback')).toBe(false);
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai:443/api/mcp/auth_callback')).toBe(false);
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/AUTH_callback')).toBe(false);
    expect(redirectMatches(['http://localhost:8080/cb'], 'http://localhost:9090/cb')).toBe(false);
    expect([redirectUriAcceptable('https://chatgpt.com/connector_platform_oauth_redirect'), redirectUriAcceptable('http://192.168.1.2/cb'), redirectUriAcceptable(7)])
      .toEqual([true, false, false]);
  });
});

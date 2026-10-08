// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: OAuth Client ID Metadata Documents (CIMD). A client whose `client_id` is an HTTPS URL is described by the
 * JSON document at that URL. Fetching a URL a stranger chose is a server-side request forgery risk, so the fetch is narrow:
 *
 *   - the URL is `https://<allowlisted host>/<path>` exactly (port 443, no credentials, query, fragment or dot segments);
 *   - DNS is resolved once and EVERY address must be public (no private, loopback, link-local, CGNAT, multicast, reserved,
 *     documentation, NAT64/6to4/Teredo or mapped addresses); the connection is pinned to the checked address;
 *   - no redirects, a 5 KiB body cap, a 5 s deadline, `application/json` only, no cookies or credentials sent.
 *
 * The document must name itself (`client_id` equals the URL), list its redirect URIs and allow the `none` token endpoint
 * authentication method (FloFi's server supports public clients only). Accepted documents are cached in PostgreSQL.
 */
import { createHash } from 'node:crypto';
import { pinnedHttpsRequest } from '../../platform/pinned-https.ts';
import type { ClientRecord } from './store.ts';

/** BUILD-DEVELOPER-001: the public-address check and the pinned transport moved to the shared platform (same checks); re-exported. */
export { isPublicAddress } from '../../platform/pinned-https.ts';

export const CIMD_MAX_BYTES = 5_120;
export const CIMD_TIMEOUT_MS = 5_000;
export const CIMD_CACHE_SECONDS = 3_600;
const MAX_REDIRECT_URIS = 10;

export type ClientIdCheck = { readonly ok: true; readonly url: URL } | { readonly ok: false; readonly reason: string };
/** A `client_id` FloFi may fetch: an exact HTTPS URL on an allowlisted host with a path. */
export function cimdClientId(clientId: string, hosts: readonly string[]): ClientIdCheck {
  if (typeof clientId !== 'string' || clientId.length < 12 || clientId.length > 512) return { ok: false, reason: 'CLIENT_ID_LENGTH' };
  let url: URL;
  try { url = new URL(clientId); } catch { return { ok: false, reason: 'CLIENT_ID_NOT_URL' }; }
  if (url.href !== clientId || url.protocol !== 'https:' || url.port !== '' || url.username || url.password || url.search || url.hash) return { ok: false, reason: 'CLIENT_ID_URL_FORM' };
  if (!hosts.includes(url.hostname)) return { ok: false, reason: 'CLIENT_ID_HOST_NOT_ALLOWED' };
  if (url.pathname === '/' || /(^|\/)\.\.?(\/|$)/.test(decodeURIComponent(url.pathname))) return { ok: false, reason: 'CLIENT_ID_PATH' };
  return { ok: true, url };
}

/** A redirect URI a public client may register: HTTPS, or HTTP on a loopback host for native apps (RFC 8252 §7.3). */
export function redirectUriAcceptable(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password || url.href !== value) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
export const isLoopbackRedirect = (value: string) => { const u = new URL(value); return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); };

/**
 * Exact redirect URI matching, with the one standard exception: a registered loopback redirect without a port matches the
 * same scheme, host, path and query on any port (RFC 8252 §7.3; Claude Code registers `http://localhost/callback`).
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try { asked = new URL(requested); } catch { return false; }
  if (asked.protocol !== 'http:' || asked.href !== requested || asked.hash) return false;
  return registered.some(r => {
    const reg = new URL(r);
    return isLoopbackRedirect(r) && reg.port === '' && reg.hostname === asked.hostname && reg.pathname === asked.pathname && reg.search === asked.search;
  });
}

export type FetchedDocument = { readonly status: number; readonly contentType: string; readonly body: Buffer };
/** The network seam: GET a URL whose host was already validated; tests replace it, production uses `pinnedHttpsGet`. */
export type DocumentFetcher = (url: URL) => Promise<FetchedDocument>;

/** GET over HTTPS pinned to a pre-checked public address of the host, with no redirects and hard size/time bounds. */
export const pinnedHttpsGet: DocumentFetcher = url => pinnedHttpsRequest({ url, method: 'GET', headers: { accept: 'application/json', 'user-agent': 'FloFi-MCP-OAuth/1' },
  maxBytes: CIMD_MAX_BYTES, timeoutMs: CIMD_TIMEOUT_MS, errorPrefix: 'CIMD' });

export type MetadataResult = { readonly ok: true; readonly client: ClientRecord } | { readonly ok: false; readonly reason: string };
const DISPLAY = /^[\p{L}\p{N} .,'()&+_-]{1,64}$/u;

/** Validates a fetched CIMD document for `url`. Pure: the caller fetched it. */
export function parseClientMetadata(url: URL, document: FetchedDocument, now: Date): MetadataResult {
  if (document.status !== 200) return { ok: false, reason: 'CIMD_HTTP_STATUS' };
  if (!/^application\/json\s*(;|$)/i.test(document.contentType)) return { ok: false, reason: 'CIMD_CONTENT_TYPE' };
  if (document.body.length > CIMD_MAX_BYTES) return { ok: false, reason: 'CIMD_TOO_LARGE' };
  let json: unknown;
  try { json = JSON.parse(document.body.toString('utf8')); } catch { return { ok: false, reason: 'CIMD_NOT_JSON' }; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'CIMD_NOT_OBJECT' };
  const meta = json as Record<string, unknown>;
  if (meta.client_id !== url.href) return { ok: false, reason: 'CIMD_CLIENT_ID_MISMATCH' };
  const redirects = meta.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length < 1 || redirects.length > MAX_REDIRECT_URIS || !redirects.every(redirectUriAcceptable)) return { ok: false, reason: 'CIMD_REDIRECT_URIS' };
  const method = meta.token_endpoint_auth_method, methods = meta.token_endpoint_auth_methods_supported;
  const publicClient = method === undefined || method === 'none' || (Array.isArray(methods) && methods.includes('none'));
  if (!publicClient) return { ok: false, reason: 'CIMD_AUTH_METHOD_UNSUPPORTED' };
  if (meta.grant_types !== undefined && !(Array.isArray(meta.grant_types) && meta.grant_types.includes('authorization_code'))) return { ok: false, reason: 'CIMD_GRANT_TYPES' };
  if (meta.response_types !== undefined && !(Array.isArray(meta.response_types) && meta.response_types.includes('code'))) return { ok: false, reason: 'CIMD_RESPONSE_TYPES' };
  const name = typeof meta.client_name === 'string' && DISPLAY.test(meta.client_name.trim()) ? meta.client_name.trim() : url.hostname;
  return { ok: true, client: { clientId: url.href, kind: 'CIMD', clientName: name, redirectUris: Object.freeze([...redirects as string[]]),
    metadataSha256: createHash('sha256').update(document.body).digest('hex'), expiresAt: new Date(now.getTime() + CIMD_CACHE_SECONDS * 1000) } };
}

/** Fetches and validates the metadata document of an allowlisted CIMD client. Every failure is a classified reason. */
export async function fetchClientMetadata(clientId: string, hosts: readonly string[], now: Date, fetcher: DocumentFetcher = pinnedHttpsGet): Promise<MetadataResult> {
  const check = cimdClientId(clientId, hosts);
  if (!check.ok) return check;
  let document: FetchedDocument;
  try { document = await fetcher(check.url); }
  catch (error) { return { ok: false, reason: error instanceof Error && /^CIMD_[A-Z_]+$/.test(error.message) ? error.message : 'CIMD_FETCH_FAILED' }; }
  return parseClientMetadata(check.url, document, now);
}

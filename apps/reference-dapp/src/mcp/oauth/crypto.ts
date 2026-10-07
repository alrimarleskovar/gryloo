// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: opaque credentials of the MCP OAuth server. Every credential is 256 random bits with a type prefix
 * (`flofi_at_` access token, `flofi_rt_` refresh token, `flofi_code_` authorization code, `flofi_hs_` handoff secret,
 * `flofi_csrf_` consent token). The server keeps only keyed HMAC-SHA-256 digests; the values themselves are returned once
 * and never logged, stored, put in a URL query or forwarded. Identifiers are random base32 with a type prefix.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { typedId } from '../../platform/ids.ts';

export const TOKEN_PREFIX = Object.freeze({ access: 'flofi_at_', refresh: 'flofi_rt_', code: 'flofi_code_', handoff: 'flofi_hs_', csrf: 'flofi_csrf_' });
export type TokenKind = keyof typeof TOKEN_PREFIX;
const BODY = /^[A-Za-z0-9_-]{43}$/;

export function newCredential(kind: TokenKind): string { return TOKEN_PREFIX[kind] + randomBytes(32).toString('base64url'); }
/** The credential's own body when `value` is a well-formed credential of `kind`, else null (never hashed, never looked up). */
export function credentialOf(kind: TokenKind, value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(TOKEN_PREFIX[kind])) return null;
  return BODY.test(value.slice(TOKEN_PREFIX[kind].length)) ? value : null;
}
/** Keyed digest stored in place of a credential. The key is purpose-specific (see `deriveKey`). */
export function credentialDigest(key: Buffer, value: string): Buffer { return createHmac('sha256', key).update(value, 'utf8').digest(); }

/** `prefix_` + 26 lower-case base32 characters (128 random bits); BUILD-DEVELOPER-001 shares the generator (`src/platform/ids.ts`). */
export function newId(prefix: 'mcpacct' | 'oar' | 'grt' | 'fam' | 'apr' | 'wlk'): string { return typedId(prefix); }

/** PKCE (RFC 7636) S256: the verifier is 43–128 unreserved characters; the challenge is base64url(SHA-256(verifier)). */
export const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier) || !PKCE_CHALLENGE.test(challenge)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier, 'ascii').digest('base64url')), expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** HMAC-sealed, expiring cookie values (`kind.body.mac`), like the wallet session but with the OAuth server's own key. */
export function sealValue(kind: string, payload: Readonly<Record<string, unknown>> & { readonly e: number }, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${kind}.${body}.${createHmac('sha256', key).update(`${kind}.${body}`).digest('base64url')}`;
}
export function unsealValue<T extends { e: number }>(kind: string, token: string | undefined, key: Buffer, nowSeconds: number): T | null {
  if (typeof token !== 'string' || token.length > 2_048) return null;
  const [prefix, body, mac, ...rest] = token.split('.');
  if (prefix !== kind || !body || !mac || rest.length) return null;
  const expected = createHmac('sha256', key).update(`${kind}.${body}`).digest(), supplied = Buffer.from(mac, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let value: T;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
  return value && typeof value === 'object' && Number.isSafeInteger(value.e) && value.e > nowSeconds ? value : null;
}

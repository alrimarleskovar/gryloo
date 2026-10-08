// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: Developer API credentials. A key is `flofi_sk_test_` (sandbox) or `flofi_sk_live_` (production; not issuable in
 * this build) followed by 256 random bits in base64url. The server keeps only `HMAC-SHA-256(api-key key, key)`; the key itself is shown
 * once to the operator and never stored, logged or returned. A key authenticates an integration — never a wallet, never a person —
 * and carries no financial authority.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { DeveloperEnvironment, DeveloperKeys } from './config.ts';

export const API_KEY_PREFIX: Readonly<Record<DeveloperEnvironment, string>> = Object.freeze({ sandbox: 'flofi_sk_test_', production: 'flofi_sk_live_' });
const KEY = /^flofi_sk_(test|live)_([A-Za-z0-9_-]{43})$/;
/** A fresh key and the last four characters shown to identify it. */
export function newApiKey(environment: DeveloperEnvironment): { readonly key: string; readonly hint: string } {
  const body = randomBytes(32).toString('base64url');
  return { key: API_KEY_PREFIX[environment] + body, hint: body.slice(-4) };
}
export type PresentedKey = { readonly ok: true; readonly key: string; readonly environment: DeveloperEnvironment } | { readonly ok: false; readonly reason: 'MISSING' | 'MALFORMED' };
/** The credential of an `Authorization: Bearer <key>` header. Malformed values are refused before any lookup. */
export function presentedKey(header: string | null): PresentedKey {
  if (header === null || header === '') return { ok: false, reason: 'MISSING' };
  const match = /^Bearer ([^\s]+)$/.exec(header), key = match?.[1] ?? '', parsed = KEY.exec(key);
  if (!parsed) return { ok: false, reason: 'MALFORMED' };
  return { ok: true, key, environment: parsed[1] === 'test' ? 'sandbox' : 'production' };
}
export const apiKeyDigest = (config: { readonly keys: Pick<DeveloperKeys, 'apiKey'> }, key: string): Buffer =>
  createHmac('sha256', config.keys.apiKey).update(key, 'utf8').digest();

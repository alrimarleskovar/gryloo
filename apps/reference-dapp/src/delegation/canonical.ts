// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: canonical bytes and domain-separated digests for delegated-authority artifacts. Canonical JSON sorts object keys,
 * keeps array order, renders bigints as decimal strings and refuses anything else that is not plain JSON (undefined, functions,
 * non-finite numbers), so one artifact has exactly one byte representation and one hash.
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('CANONICAL_VALUE_INVALID'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype || typeof value === 'object' && Object.getPrototypeOf(value) === null)
    return '{' + Object.keys(value as object).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  throw new Error('CANONICAL_VALUE_INVALID');
}
/** SHA-256 over `domain ‖ 0x00 ‖ canonical JSON`, as `0x`-hex. Each artifact type has its own domain, so hashes never collide across types. */
export function domainDigest(domain: string, value: unknown): string {
  if (!/^flofi\.[a-z0-9.-]{3,80}\.v[0-9]+$/.test(domain)) throw new Error('CANONICAL_DOMAIN_INVALID');
  return '0x' + createHash('sha256').update(domain).update(Uint8Array.of(0)).update(canonicalJson(value)).digest('hex');
}
export const digestBytes = (digest: string): Uint8Array => Uint8Array.from(Buffer.from(digest.slice(2), 'hex'));

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: approval-link secrets for every requester kind, without copying the approval implementation per surface.
 *
 * A surface that hands proposals to their owners registers one SCHEME: a prefix (`flofi_<tag>hs_`), its own 32-byte HMAC key (derived
 * from that surface's dedicated secret, never shared with another purpose) and the requester kinds whose handoffs it may resolve.
 * Minting draws 256 random bits; only `HMAC-SHA-256(key, secret)` is ever stored. Resolving a presented secret picks the scheme by
 * prefix, validates the body and returns the digest plus the kinds the lookup is restricted to, so one surface's links can never
 * resolve another surface's handoffs. The secret itself is never logged, stored or returned by a resolver.
 *
 * MCP's scheme (`flofi_hs_`, keyed by its OAuth handoff key) yields byte-identical secrets and digests to BUILD-MCP-002, so existing
 * approval links keep working.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { APPROVAL_SCHEME_PREFIX, APPROVAL_SECRET_FORMAT } from './approval-link-format.ts';
import { APPROVAL_REQUESTER_KINDS, type ApprovalRequesterKind } from './handoff-store.ts';

export type ApprovalLinkScheme = { readonly prefix: string; readonly key: Buffer; readonly kinds: readonly ApprovalRequesterKind[] };

/** A validated scheme; any malformed part throws `APPROVAL_SCHEME_INVALID` (fail closed at configuration time). */
export function approvalLinkScheme(prefix: string, key: Buffer, kinds: readonly ApprovalRequesterKind[]): ApprovalLinkScheme {
  if (!APPROVAL_SCHEME_PREFIX.test(prefix) || !Buffer.isBuffer(key) || key.length !== 32 || kinds.length === 0
    || !kinds.every(k => (APPROVAL_REQUESTER_KINDS as readonly string[]).includes(k)) || new Set(kinds).size !== kinds.length) throw new Error('APPROVAL_SCHEME_INVALID');
  return Object.freeze({ prefix, key, kinds: Object.freeze([...kinds]) });
}
/** The keyed digest stored in place of an approval secret. */
export const approvalSecretDigest = (scheme: ApprovalLinkScheme, secret: string): Buffer => createHmac('sha256', scheme.key).update(secret, 'utf8').digest();
/** A fresh approval secret of `scheme` (256 random bits) and the only thing that may be stored: its digest. */
export function mintApprovalSecret(scheme: ApprovalLinkScheme): { readonly secret: string; readonly digest: Buffer } {
  const secret = scheme.prefix + randomBytes(32).toString('base64url');
  return { secret, digest: approvalSecretDigest(scheme, secret) };
}
/** The digest and allowed requester kinds of a presented secret, or null when it is malformed or no registered scheme owns it. */
export function resolveApprovalSecret(schemes: readonly ApprovalLinkScheme[], presented: unknown): { readonly digest: Buffer; readonly kinds: readonly ApprovalRequesterKind[] } | null {
  if (typeof presented !== 'string' || !APPROVAL_SECRET_FORMAT.test(presented)) return null;
  const scheme = schemes.find(s => presented.startsWith(s.prefix) && presented.length === s.prefix.length + 43);
  return scheme ? { digest: approvalSecretDigest(scheme, presented), kinds: scheme.kinds } : null;
}

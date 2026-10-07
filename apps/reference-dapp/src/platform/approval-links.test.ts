// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: approval-link secrets for every requester kind. MCP's scheme stays byte-compatible with BUILD-MCP-002 (same
 * `flofi_hs_` format, same keyed digest), every secret carries 256 random bits and only its 32-byte digest is storable, and a secret
 * resolves only through the scheme that owns its prefix, limited to that scheme's requester kinds. OAuth credentials never parse as
 * approval secrets, and malformed schemes fail closed.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { credentialDigest, newCredential } from '../mcp/oauth/crypto';
import { APPROVAL_SCHEME_PREFIX, APPROVAL_SECRET_FORMAT, approvalLinkScheme, mintApprovalSecret, resolveApprovalSecret, type ApprovalRequesterKind } from './index.ts';

const KEY = randomBytes(32), OTHER = randomBytes(32);
const mcp = approvalLinkScheme('flofi_hs_', KEY, ['MCP_ACCOUNT']);
const channel = approvalLinkScheme('flofi_chs_', OTHER, ['CHANNEL_CONVERSATION']);

describe('BUILD-DEVELOPER-001 approval-link schemes', () => {
  it('keeps MCP links byte-compatible with BUILD-MCP-002: same format, same keyed digest, old secrets resolve', () => {
    const { secret, digest } = mintApprovalSecret(mcp);
    expect(secret).toMatch(/^flofi_hs_[A-Za-z0-9_-]{43}$/);
    expect(digest.equals(credentialDigest(KEY, secret))).toBe(true);
    // A secret minted by the BUILD-MCP-002 code path resolves to exactly the digest that code stored.
    const legacy = newCredential('handoff');
    expect(resolveApprovalSecret([mcp], legacy)).toEqual({ digest: credentialDigest(KEY, legacy), kinds: ['MCP_ACCOUNT'] });
  });

  it('draws 256 random bits per secret and yields only a 32-byte keyed digest to store', () => {
    const minted = Array.from({ length: 512 }, () => mintApprovalSecret(channel));
    expect(new Set(minted.map(m => m.secret)).size).toBe(512);
    for (const { secret, digest } of minted.slice(0, 16)) {
      expect(secret).toMatch(APPROVAL_SECRET_FORMAT);
      expect(Buffer.from(secret.slice('flofi_chs_'.length), 'base64url')).toHaveLength(32);
      expect(digest.equals(createHmac('sha256', OTHER).update(secret).digest())).toBe(true);
      expect(digest.toString('hex')).not.toContain(secret);
    }
  });

  it('resolves a secret only through the scheme that owns its prefix, limited to that scheme\'s requester kinds', () => {
    const c = mintApprovalSecret(channel), m = mintApprovalSecret(mcp);
    expect(resolveApprovalSecret([mcp, channel], c.secret)).toEqual({ digest: c.digest, kinds: ['CHANNEL_CONVERSATION'] });
    expect(resolveApprovalSecret([mcp, channel], m.secret)).toEqual({ digest: m.digest, kinds: ['MCP_ACCOUNT'] });
    expect(resolveApprovalSecret([mcp], c.secret)).toBeNull();
    expect(resolveApprovalSecret([channel], m.secret)).toBeNull();
    expect(resolveApprovalSecret([], m.secret)).toBeNull();
  });

  it('rejects malformed secrets and never treats OAuth tokens, codes or consent tokens as approval secrets', () => {
    const body = randomBytes(32).toString('base64url');
    for (const bad of [undefined, null, 42, '', 'flofi_hs_', `flofi_hs_${body}x`, `flofi_hs_${body.slice(1)}`, `flofi_hs_${body.slice(0, 42)}!`, `FLOFI_HS_${body}`,
      ` flofi_hs_${body}`, `flofi_at_${body}`, `flofi_rt_${body}`, `flofi_code_${body}`, `flofi_csrf_${body}`])
      expect(resolveApprovalSecret([mcp, channel], bad), String(bad)).toBeNull();
    for (const kind of ['access', 'refresh', 'code', 'csrf'] as const) expect(APPROVAL_SECRET_FORMAT.test(newCredential(kind)), kind).toBe(false);
    expect(APPROVAL_SECRET_FORMAT.test(newCredential('handoff'))).toBe(true);
  });

  it('validates a scheme when it is configured (fail closed)', () => {
    const cases: [string, Buffer, readonly string[]][] = [['flofi_at_', KEY, ['MCP_ACCOUNT']], ['flofi_hs', KEY, ['MCP_ACCOUNT']], ['flofi_toolonghs_', KEY, ['MCP_ACCOUNT']],
      ['flofi_HS_', KEY, ['MCP_ACCOUNT']], ['flofi_hs_', randomBytes(16), ['MCP_ACCOUNT']], ['flofi_hs_', KEY, []], ['flofi_hs_', KEY, ['SOMEONE']],
      ['flofi_hs_', KEY, ['MCP_ACCOUNT', 'MCP_ACCOUNT']]];
    for (const [prefix, key, kinds] of cases) expect(() => approvalLinkScheme(prefix, key, kinds as ApprovalRequesterKind[]), `${prefix} ${kinds}`).toThrow('APPROVAL_SCHEME_INVALID');
    for (const prefix of ['flofi_hs_', 'flofi_dhs_', 'flofi_chs_']) expect(APPROVAL_SCHEME_PREFIX.test(prefix), prefix).toBe(true);
  });
});

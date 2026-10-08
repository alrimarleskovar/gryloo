// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: Developer API configuration and credentials. The API is off unless explicitly enabled and fails closed on any
 * configuration error; its secret is dedicated (never another deployment secret) and every purpose gets its own derived key; keys
 * are 256-bit, typed by environment, parsed strictly and stored only as keyed digests.
 */
import { describe, expect, it } from 'vitest';
import { developerKey, readDeveloperConfig, SANDBOX_POLICY, type DeveloperConfig } from './config.ts';
import { API_KEY_PREFIX, apiKeyDigest, newApiKey, presentedKey } from './keys.ts';
import { projectNameValid } from './admin.ts';

const SECRET = 'd'.repeat(48);
const BASE = { FLOFI_DEVELOPER: 'enabled', FLOFI_PUBLIC_ORIGIN: 'https://flofi.example', FLOFI_DEVELOPER_SECRET: SECRET };
const enabled = (env: Record<string, string | undefined>) => {
  const config = readDeveloperConfig(env);
  if (!config.enabled) throw new Error(`expected enabled, got ${config.code} ${config.reason ?? ''}`);
  return config;
};

describe('BUILD-DEVELOPER-001 developer configuration', () => {
  it('is off unless FLOFI_DEVELOPER=enabled, and fails closed on every invalid setting', () => {
    expect(readDeveloperConfig({})).toEqual({ enabled: false, code: 'DEVELOPER_API_NOT_ENABLED' });
    expect(readDeveloperConfig({ ...BASE, FLOFI_DEVELOPER: 'true' })).toEqual({ enabled: false, code: 'DEVELOPER_API_NOT_ENABLED' });
    const reason = (env: Record<string, string | undefined>) => { const c = readDeveloperConfig(env); return c.enabled ? 'ENABLED' : c.reason; };
    expect(reason({ ...BASE, FLOFI_PUBLIC_ORIGIN: undefined })).toBe('FLOFI_PUBLIC_ORIGIN');
    expect(reason({ ...BASE, FLOFI_PUBLIC_ORIGIN: 'https://flofi.example/path' })).toBe('FLOFI_PUBLIC_ORIGIN');
    expect(reason({ ...BASE, FLOFI_PUBLIC_ORIGIN: 'http://flofi.example' })).toBe('FLOFI_PUBLIC_ORIGIN');
    expect(reason({ ...BASE, FLOFI_DEVELOPER_SECRET: 'short' })).toBe('FLOFI_DEVELOPER_SECRET');
    expect(reason({ ...BASE, FLOFI_DEVELOPER_SECRET: 'x'.repeat(513) })).toBe('FLOFI_DEVELOPER_SECRET');
    for (const other of ['API_AUTH_TOKEN', 'FLOFI_SESSION_SECRET', 'FLOFI_MCP_OAUTH_SECRET', 'FLOFI_CHANNEL_SECRET'])
      expect(reason({ ...BASE, [other]: SECRET })).toBe('FLOFI_DEVELOPER_SECRET_REUSED');
    expect(reason({ ...BASE, FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256: 'not-hex' })).toBe('FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256');
    expect(reason({ ...BASE, FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'yes' })).toBe('FLOFI_DEVELOPER_WEBHOOK_LOOPBACK');
    // The loopback webhook seam is local-only: a hosted deployment with it set is misconfigured, not silently permissive.
    expect(reason({ ...BASE, FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY', VERCEL: '1', VERCEL_ENV: 'production' })).toBe('FLOFI_DEVELOPER_WEBHOOK_LOOPBACK_HOSTED');
    expect(reason({ ...BASE, VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('TENANT');
  });

  it('derives one key per purpose from the dedicated secret; the tenant follows the deployment', () => {
    const config = enabled({ ...BASE, FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256: 'a'.repeat(64), FLOFI_DEVELOPER_WEBHOOK_LOOPBACK: 'ALLOW_LOCAL_ONLY' });
    expect(config).toMatchObject({ tenantId: 'default', origin: 'https://flofi.example', webhookLoopback: true });
    expect(config.dispatchTokenDigest?.toString('hex')).toBe('a'.repeat(64));
    const keys = [config.keys.apiKey, config.keys.handoff, config.keys.webhook].map(k => k.toString('hex'));
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(config.keys.apiKey.equals(developerKey(SECRET, 'api-key'))).toBe(true);
    expect(enabled({ ...BASE, FLOFI_DEVELOPER_SECRET: 'e'.repeat(48) }).keys.apiKey.equals(config.keys.apiKey)).toBe(false);
    expect(enabled({ ...BASE, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-developer-001' }).tenantId).toMatch(/^pv-claude-build-developer-001-[0-9a-f]{8}$/);
    // Loopback http origins are local-only (exactly like MCP).
    expect(enabled({ ...BASE, FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100' }).origin).toBe('http://127.0.0.1:3100');
    expect(readDeveloperConfig({ ...BASE, FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100', FLOFI_DEPLOYMENT: 'hosted' }).enabled).toBe(false);
  });

  it('sandbox policy: test funds only, every mainnet off', () => {
    expect(SANDBOX_POLICY).toEqual({ ok: true, testFunds: true, mainnetNetworks: [] });
    expect(Object.isFrozen(SANDBOX_POLICY)).toBe(true);
  });
});

describe('BUILD-DEVELOPER-001 API keys', () => {
  const config = enabled(BASE) as DeveloperConfig;
  it('are 256-bit, typed by environment, and only their keyed digest is meant to be stored', () => {
    const a = newApiKey('sandbox'), b = newApiKey('sandbox');
    expect(a.key).toMatch(/^flofi_sk_test_[A-Za-z0-9_-]{43}$/);
    expect(newApiKey('production').key.startsWith(API_KEY_PREFIX.production)).toBe(true);
    expect(a.key).not.toBe(b.key);
    expect(a.hint).toBe(a.key.slice(-4));
    const digest = apiKeyDigest(config, a.key);
    expect(digest).toHaveLength(32);
    expect(digest.equals(apiKeyDigest(config, a.key))).toBe(true);
    expect(digest.equals(apiKeyDigest(config, b.key))).toBe(false);
    expect(digest.toString('hex')).not.toContain(Buffer.from(a.key).toString('hex').slice(0, 16));
  });

  it('parses only `Bearer flofi_sk_(test|live)_<43>`; anything else is refused before a lookup', () => {
    const { key } = newApiKey('sandbox');
    expect(presentedKey(`Bearer ${key}`)).toEqual({ ok: true, key, environment: 'sandbox' });
    expect(presentedKey(`Bearer ${newApiKey('production').key}`)).toMatchObject({ ok: true, environment: 'production' });
    expect(presentedKey(null)).toEqual({ ok: false, reason: 'MISSING' });
    expect(presentedKey('')).toEqual({ ok: false, reason: 'MISSING' });
    for (const header of [key, `bearer ${key}`, `Bearer  ${key}`, `Bearer ${key} `, `Bearer ${key}x`, `Bearer ${key.slice(0, -1)}`, `Basic ${key}`,
      `Bearer flofi_hs_${'a'.repeat(43)}`, `Bearer flofi_sk_prod_${'a'.repeat(43)}`, `Bearer ${key}\n`, `Bearer ${key.replace('_test_', '_TEST_')}`])
      expect(presentedKey(header)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('project display names are printable, trimmed and short', () => {
    for (const name of ['Acme Wallet', 'a', 'x'.repeat(64), 'Pagamentos Ágeis']) expect(projectNameValid(name)).toBe(true);
    for (const name of ['', ' padded', 'padded ', 'x'.repeat(65), 'line\nbreak', 'tab\there', 'zero​width', 'bidi‮override']) expect(projectNameValid(name)).toBe(false);
  });
});

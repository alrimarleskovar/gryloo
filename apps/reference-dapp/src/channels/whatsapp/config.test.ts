// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp adapter's configuration fails closed, and the D1 activation guard holds whatever the variables say:
 * no hosted deployment and no live provider while no clearance is recorded in code (none is). The live path itself is complete: with a
 * clearance record (a test seam no environment value can reach) it needs the access token and Graph version and may run hosted.
 * Channel Core then refuses a channel secret shared with any provider secret.
 */
import { describe, expect, it } from 'vitest';
import { readChannelDeployment } from '../registry.ts';
import { readWhatsAppConfig, WHATSAPP_POLICY_CLEARANCE } from './config.ts';
import { whatsAppEnv } from './fixtures.test-harness.ts';

const code = (env: Record<string, string | undefined>) => { const c = readWhatsAppConfig(env); return c.enabled ? 'OK' : 'reason' in c ? `${c.code}:${c.reason}` : c.code; };

describe('BUILD-CHANNELS-001 WhatsApp configuration and activation guard', () => {
  it('is off unless enabled, and accepts a complete fixture configuration', () => {
    expect(code({})).toBe('WHATSAPP_NOT_ENABLED');
    expect(code({ ...whatsAppEnv().env, FLOFI_WHATSAPP: 'true' })).toBe('WHATSAPP_NOT_ENABLED');
    expect(code(whatsAppEnv().env)).toBe('OK');
  });

  it('can never be activated on a hosted deployment or with the live provider in this build (D1)', () => {
    for (const hosted of [{ VERCEL: '1', VERCEL_ENV: 'production' }, { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-channels-001' },
      { RAILWAY_PROJECT_ID: 'p' }, { FLOFI_DEPLOYMENT: 'hosted' }])
      expect(code({ ...whatsAppEnv().env, ...hosted }), JSON.stringify(hosted)).toBe('CHANNEL_PROVIDER_NOT_ACTIVATED');
    expect(code({ ...whatsAppEnv().env, FLOFI_WHATSAPP_PROVIDER: 'live', WHATSAPP_ACCESS_TOKEN: 'a'.repeat(40), WHATSAPP_GRAPH_API_VERSION: 'v26.0' }))
      .toBe('WHATSAPP_LIVE_PROVIDER_NOT_CLEARED');
    expect(readChannelDeployment({ ...whatsAppEnv().env, VERCEL: '1', VERCEL_ENV: 'production' })).toMatchObject({ ok: false, status: 404, code: 'CHANNEL_PROVIDER_NOT_ACTIVATED' });
  });

  it('has no recorded clearance, so no variable can turn the live provider on (D1)', () => {
    expect(WHATSAPP_POLICY_CLEARANCE).toBeNull();
    const live = { ...whatsAppEnv().env, FLOFI_WHATSAPP_PROVIDER: 'live', WHATSAPP_ACCESS_TOKEN: 'a'.repeat(40), WHATSAPP_GRAPH_API_VERSION: 'v26.0' };
    for (const clearance of ['', 'META-2026-0001', 'cleared', 'true'])
      expect(code({ ...live, FLOFI_WHATSAPP_POLICY_CLEARANCE: clearance }), clearance).toBe('WHATSAPP_LIVE_PROVIDER_NOT_CLEARED');
    expect(code({ ...live, FLOFI_WHATSAPP_POLICY_CLEARANCE: 'META-2026-0001', VERCEL: '1', VERCEL_ENV: 'production' })).toBe('CHANNEL_PROVIDER_NOT_ACTIVATED');
  });

  it('runs the complete live path once clearance is recorded in code and named by the deployment', () => {
    const record = { reference: 'META-WRITTEN-2026-0001', recordedOn: '2026-10-08', basis: 'test record' };
    const live = { ...whatsAppEnv().env, FLOFI_WHATSAPP_PROVIDER: 'live', WHATSAPP_ACCESS_TOKEN: 'a'.repeat(40), WHATSAPP_GRAPH_API_VERSION: 'v26.0',
      FLOFI_WHATSAPP_POLICY_CLEARANCE: record.reference, VERCEL: '1', VERCEL_ENV: 'production', WHATSAPP_NOTIFICATION_TEMPLATE: 'flofi_status_update:en_US' };
    const config = readWhatsAppConfig(live, record);
    expect(config).toMatchObject({ enabled: true, provider: 'live', accessToken: 'a'.repeat(40), graphVersion: 'v26.0',
      template: { name: 'flofi_status_update', language: 'en_US' } });
    const reason = (env: Record<string, string | undefined>) => { const c = readWhatsAppConfig(env, record); return c.enabled ? 'OK' : 'reason' in c ? c.reason : c.code; };
    expect(reason({ ...live, FLOFI_WHATSAPP_POLICY_CLEARANCE: 'META-OTHER-REFERENCE' })).toBe('CHANNEL_PROVIDER_NOT_ACTIVATED');
    expect(reason({ ...live, WHATSAPP_ACCESS_TOKEN: undefined })).toBe('WHATSAPP_ACCESS_TOKEN');
    expect(reason({ ...live, WHATSAPP_GRAPH_API_VERSION: undefined })).toBe('WHATSAPP_GRAPH_API_VERSION');
    expect(reason({ ...live, WHATSAPP_NOTIFICATION_TEMPLATE: 'Status Update' })).toBe('WHATSAPP_NOTIFICATION_TEMPLATE');
    // The fixture provider never runs hosted, cleared or not.
    expect(reason({ ...live, FLOFI_WHATSAPP_PROVIDER: 'fixture' })).toBe('CHANNEL_PROVIDER_NOT_ACTIVATED');
  });

  it('fails closed on every missing or malformed provider value', () => {
    for (const [name, value] of [['FLOFI_WHATSAPP_PROVIDER', 'mock'], ['WHATSAPP_APP_SECRET', undefined], ['WHATSAPP_APP_SECRET', 'short'],
      ['WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'too-short'], ['WHATSAPP_PHONE_NUMBER_ID', 'abc'], ['WHATSAPP_BUSINESS_ACCOUNT_ID', undefined],
      ['FLOFI_WHATSAPP_ALLOWED_SENDERS', 'not-a-digest'], ['WHATSAPP_GRAPH_API_VERSION', 'v26'], ['WHATSAPP_ACCESS_TOKEN', 'has spaces in it but is long enough to pass']] as const)
      expect(code({ ...whatsAppEnv().env, [name]: value }), name).toMatch(/^WHATSAPP_CONFIGURATION_INVALID:/);
    const f = whatsAppEnv();
    expect(code({ ...f.env, WHATSAPP_WEBHOOK_VERIFY_TOKEN: f.appSecret.repeat(2) })).toBe('OK');
    expect(code({ ...f.env, WHATSAPP_APP_SECRET_PREVIOUS: f.appSecret })).toBe('WHATSAPP_CONFIGURATION_INVALID:WHATSAPP_APP_SECRET_PREVIOUS');
  });

  it('refuses a channel secret equal to a provider secret, and reports the core configuration as unavailable (503)', () => {
    const f = whatsAppEnv();
    expect(readChannelDeployment({ ...f.env, FLOFI_CHANNEL_SECRET: f.verifyToken.padEnd(40, 'x') })).toMatchObject({ ok: true });
    expect(readChannelDeployment({ ...f.env, FLOFI_CHANNEL_SECRET: f.verifyToken })).toMatchObject({ ok: false, status: 503 });
    expect(readChannelDeployment({ ...f.env, FLOFI_CHANNEL_SECRET: undefined })).toMatchObject({ ok: false, status: 503, reason: 'FLOFI_CHANNEL_SECRET' });
    expect(readChannelDeployment({ ...f.env, FLOFI_CHANNEL_PRIVACY_URL: undefined })).toMatchObject({ ok: false, status: 503, reason: 'FLOFI_CHANNEL_PRIVACY_URL' });
  });
});

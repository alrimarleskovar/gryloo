// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 browser suite: the WhatsApp channel configuration the loopback app server and the spec share. The provider is
 * the FIXTURE transport (nothing is ever sent to Meta); the identifiers are synthetic; the secrets are generated per run by
 * playwright.config.ts and inherited by the test workers, never committed.
 */
import { createHash } from 'node:crypto';

export const CHANNEL_E2E = 'FIXTURE_LOOPBACK_ONLY';
export const CHANNEL_E2E_USER = 'BR.FLOFITESTUSER0001';
type Env = Readonly<Record<string, string | undefined>>;

export function channelE2eEnv(env: Env = process.env) {
  const appSecret = env.FLOFI_E2E_WHATSAPP_APP_SECRET, verifyToken = env.FLOFI_E2E_WHATSAPP_VERIFY_TOKEN, channelSecret = env.FLOFI_E2E_CHANNEL_SECRET;
  if (!appSecret || !verifyToken || !channelSecret) throw new Error('CHANNEL_E2E_SECRETS_MISSING');
  return { FLOFI_WHATSAPP: 'enabled', FLOFI_WHATSAPP_PROVIDER: 'fixture', WHATSAPP_APP_SECRET: appSecret, WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken,
    WHATSAPP_PHONE_NUMBER_ID: '106540352242922', WHATSAPP_BUSINESS_ACCOUNT_ID: '102290129340398',
    FLOFI_WHATSAPP_ALLOWED_SENDERS: createHash('sha256').update(CHANNEL_E2E_USER).digest('hex'), FLOFI_CHANNEL_SECRET: channelSecret,
    FLOFI_CHANNEL_COPILOT: 'disabled', FLOFI_CHANNEL_SUPPORT_CONTACT: 'support@flofi.test', FLOFI_CHANNEL_PRIVACY_URL: 'https://flofi.test/privacy' };
}

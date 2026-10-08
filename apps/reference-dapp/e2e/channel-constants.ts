// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 browser suite: the channel configuration the loopback app server and the specs share. WhatsApp uses the FIXTURE
 * transport (nothing is ever sent to Meta); Telegram talks to the loopback Bot API double on 127.0.0.1:8559 (nothing reaches Telegram).
 * The identifiers are synthetic; the secrets and the chat users are generated per run by playwright.config.ts and inherited by the
 * test workers, never committed.
 */
import { createHash } from 'node:crypto';

export const CHANNEL_E2E = 'FIXTURE_LOOPBACK_ONLY';
export const TELEGRAM_DOUBLE = 'http://127.0.0.1:8559';
type Env = Readonly<Record<string, string | undefined>>;

/** Allowed synthetic chat users per channel and run: one per `--repeat-each` repetition, so no repetition meets another's conversation. */
export const CHANNEL_E2E_USER_POOL = 4;
/**
 * The synthetic chat users of repetition `slot` (a WhatsApp BSUID and a Telegram user id), fresh per run: their base comes from
 * playwright.config.ts like the secrets.
 */
export function channelE2eUsers(slot = 0, env: Env = process.env): { readonly whatsapp: string; readonly telegram: number } {
  const whatsapp = env.FLOFI_E2E_WHATSAPP_USER, telegram = env.FLOFI_E2E_TELEGRAM_USER;
  if (!whatsapp || !/^BR\.FLOFIE2E[0-9A-F]{16}$/.test(whatsapp) || !telegram || !/^9[0-9]{8}$/.test(telegram)) throw new Error('CHANNEL_E2E_USERS_MISSING');
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= CHANNEL_E2E_USER_POOL) throw new Error('CHANNEL_E2E_USER_POOL_EXHAUSTED');
  return { whatsapp: `${whatsapp}${slot}`, telegram: Number(telegram) + slot };
}

export function channelE2eEnv(env: Env = process.env) {
  const appSecret = env.FLOFI_E2E_WHATSAPP_APP_SECRET, verifyToken = env.FLOFI_E2E_WHATSAPP_VERIFY_TOKEN, channelSecret = env.FLOFI_E2E_CHANNEL_SECRET;
  const botToken = env.FLOFI_E2E_TELEGRAM_TOKEN, webhookSecret = env.FLOFI_E2E_TELEGRAM_WEBHOOK_SECRET, dispatch = env.FLOFI_E2E_CHANNEL_DISPATCH_TOKEN;
  if (!appSecret || !verifyToken || !channelSecret || !botToken || !webhookSecret || !dispatch) throw new Error('CHANNEL_E2E_SECRETS_MISSING');
  const pool = Array.from({ length: CHANNEL_E2E_USER_POOL }, (_, slot) => channelE2eUsers(slot, env));
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  return { FLOFI_WHATSAPP: 'enabled', FLOFI_WHATSAPP_PROVIDER: 'fixture', WHATSAPP_APP_SECRET: appSecret, WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken,
    WHATSAPP_PHONE_NUMBER_ID: '106540352242922', WHATSAPP_BUSINESS_ACCOUNT_ID: '102290129340398', FLOFI_WHATSAPP_ALLOWED_SENDERS: pool.map(u => digest(u.whatsapp)).join(','),
    FLOFI_TELEGRAM: 'enabled', TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_WEBHOOK_SECRET: webhookSecret, FLOFI_TELEGRAM_API_BASE: TELEGRAM_DOUBLE,
    FLOFI_TELEGRAM_ALLOWED_USERS: pool.map(u => digest(String(u.telegram))).join(','), FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: digest(dispatch),
    FLOFI_CHANNEL_SECRET: channelSecret, FLOFI_CHANNEL_COPILOT: 'disabled', FLOFI_CHANNEL_SUPPORT_CONTACT: 'support@flofi.test',
    FLOFI_CHANNEL_PRIVACY_URL: 'https://flofi.test/privacy' };
}

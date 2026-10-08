// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram adapter's configuration — a plain Telegram bot (Bot API over HTTPS, a webhook, no Mini App), server-
 * only, never `NEXT_PUBLIC_*`. Off unless enabled; every error disables it (fail closed). It may run on a hosted deployment: Telegram is
 * the channel through which the owner performs a real end-to-end test. Its policy review is the owner's (see docs/deploy/TELEGRAM.md).
 *
 *   FLOFI_TELEGRAM=enabled                        explicit opt-in (otherwise 404)
 *   TELEGRAM_BOT_TOKEN=<bot id>:<secret>          from @BotFather; the bot id (before the colon) is public, the rest is the credential
 *   TELEGRAM_WEBHOOK_SECRET=<32–256 [A-Za-z0-9_-]>  the `secret_token` given to setWebhook; Telegram echoes it in
 *                                                 X-Telegram-Bot-Api-Secret-Token on every delivery
 *   FLOFI_TELEGRAM_ALLOWED_USERS=<sha256>,…       SHA-256 hex digests of allowed Telegram user ids (decimal); empty = deny all
 *   FLOFI_TELEGRAM_API_BASE=http://127.0.0.1:<p>  test seam only: a loopback Bot API double; refused on a hosted deployment
 *
 * A Telegram user id is never a wallet identity, and nothing a bot receives is authorization.
 */
import { createHash } from 'node:crypto';
import { isHostedDeployment } from '../../server/deployment.ts';
import { sameSecret } from '../core/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type TelegramConfig = {
  readonly enabled: true; readonly botId: string; readonly token: string; readonly webhookSecret: string; readonly allowedUsers: ReadonlySet<string>;
  /** The Bot API origin: `https://api.telegram.org`, or a loopback double off-hosting (then nothing leaves the machine). */
  readonly apiBase: string; readonly loopback: boolean;
};
export type TelegramConfigResult = TelegramConfig
  | { readonly enabled: false; readonly code: 'TELEGRAM_NOT_ENABLED' }
  | { readonly enabled: false; readonly code: 'TELEGRAM_CONFIGURATION_INVALID'; readonly reason: string };

export const TELEGRAM_API = 'https://api.telegram.org';
const invalid = (reason: string) => ({ enabled: false, code: 'TELEGRAM_CONFIGURATION_INVALID', reason } as const);
const TOKEN = /^([1-9][0-9]{4,15}):[A-Za-z0-9_-]{30,64}$/, WEBHOOK_SECRET = /^[A-Za-z0-9_-]{32,256}$/, DIGEST = /^[0-9a-f]{64}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function readTelegramConfig(env: Env): TelegramConfigResult {
  if (env.FLOFI_TELEGRAM !== 'enabled') return { enabled: false, code: 'TELEGRAM_NOT_ENABLED' };
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '', match = TOKEN.exec(token);
  if (!match) return invalid('TELEGRAM_BOT_TOKEN');
  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';
  if (!WEBHOOK_SECRET.test(webhookSecret) || sameSecret(webhookSecret, token)) return invalid('TELEGRAM_WEBHOOK_SECRET');
  const allowed = (env.FLOFI_TELEGRAM_ALLOWED_USERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 256 || !allowed.every(d => DIGEST.test(d))) return invalid('FLOFI_TELEGRAM_ALLOWED_USERS');
  let apiBase = TELEGRAM_API, loopback = false;
  const override = env.FLOFI_TELEGRAM_API_BASE?.trim() ?? '';
  if (override !== '') {
    let url: URL;
    try { url = new URL(override); } catch { return invalid('FLOFI_TELEGRAM_API_BASE'); }
    // The double exists only for tests on a developer machine or CI: never on a hosted deployment, never off loopback.
    if (isHostedDeployment(env) || url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.origin !== override) return invalid('FLOFI_TELEGRAM_API_BASE');
    apiBase = url.origin; loopback = true;
  }
  return Object.freeze({ enabled: true, botId: match[1]!, token, webhookSecret, allowedUsers: new Set(allowed), apiBase, loopback });
}
/** The secrets this adapter holds, which Channel Core's own secret must differ from. */
export const telegramSecrets = (config: TelegramConfig): string[] => [config.token, config.webhookSecret];
/** The allowlist digest of a Telegram user id (what FLOFI_TELEGRAM_ALLOWED_USERS lists). */
export const telegramUserDigest = (userId: string) => createHash('sha256').update(userId, 'utf8').digest('hex');
/** Default deny: a sender is allowed only when the digest of its user id is listed. */
export const telegramUserAllowed = (config: Pick<TelegramConfig, 'allowedUsers'>, userId: string) => config.allowedUsers.has(telegramUserDigest(userId));

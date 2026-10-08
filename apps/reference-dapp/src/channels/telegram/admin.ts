// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram bot's operator actions (`backend/channels-admin.ts`), on the Bot API with the deployment's own token:
 *
 *   me              getMe: the bot's public id and username (to check the token)
 *   recentSenders   getUpdates while NO webhook is set: the user ids (and their allowlist digests) of people who wrote to the bot in a
 *                   private chat — how the owner learns their own Telegram user id. Message texts are never read out.
 *   setWebhook      setWebhook to `<origin>/api/channels/telegram` with the secret token, only the update kinds FloFi reads, pending
 *                   updates dropped (nothing older than the registration is processed)
 *   webhookInfo     getWebhookInfo: the registered URL, pending updates, the last delivery error (Telegram's own words)
 *   deleteWebhook   deleteWebhook (keeps nothing pending)
 *
 * Every function returns closed results; nothing here logs, and no result carries the token.
 */
import { createHash } from 'node:crypto';
import { botAnswer, type TelegramApi } from './transport.ts';

export const TELEGRAM_ALLOWED_UPDATES = Object.freeze(['message', 'callback_query', 'my_chat_member']);
export type AdminResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly description: string | null };

async function call<T>(api: TelegramApi, method: string, params: Record<string, unknown>): Promise<AdminResult<T>> {
  const result = await api(method, params, 15_000);
  if (result.kind !== 'ANSWER') return { ok: false, code: result.code, description: null };
  const answer = botAnswer(result);
  if (answer?.ok === true) return { ok: true, value: answer.result as T };
  const description = typeof answer?.description === 'string' ? answer.description.slice(0, 300) : null;
  return { ok: false, code: `TELEGRAM_${typeof answer?.error_code === 'number' ? answer.error_code : result.status}`, description };
}

export async function me(api: TelegramApi): Promise<AdminResult<{ id: number; username: string | null; canJoinGroups: boolean | null }>> {
  const r = await call<{ id: number; username?: string; can_join_groups?: boolean }>(api, 'getMe', {});
  return r.ok ? { ok: true, value: { id: r.value.id, username: r.value.username ?? null, canJoinGroups: r.value.can_join_groups ?? null } } : r;
}

export async function recentSenders(api: TelegramApi): Promise<AdminResult<readonly { userId: string; digest: string }[]>> {
  const r = await call<{ message?: { from?: { id?: unknown; is_bot?: unknown }; chat?: { type?: unknown } } }[]>(api, 'getUpdates', { timeout: 0, limit: 100,
    allowed_updates: ['message'] });
  if (!r.ok) return r;
  const ids = new Set<string>();
  for (const update of r.value) {
    const from = update.message?.from;
    if (update.message?.chat?.type === 'private' && from?.is_bot === false && typeof from.id === 'number' && Number.isSafeInteger(from.id)) ids.add(String(from.id));
  }
  return { ok: true, value: [...ids].map(userId => ({ userId, digest: createHash('sha256').update(userId, 'utf8').digest('hex') })) };
}

export function webhookUrl(origin: string): string {
  const url = new URL('/api/channels/telegram', origin);
  if (url.protocol !== 'https:') throw new Error('TELEGRAM_WEBHOOK_REQUIRES_HTTPS: FLOFI_PUBLIC_ORIGIN must be the https origin Telegram can reach');
  return url.toString();
}
export const setWebhook = (api: TelegramApi, origin: string, secret: string) => call<boolean>(api, 'setWebhook', { url: webhookUrl(origin), secret_token: secret,
  allowed_updates: TELEGRAM_ALLOWED_UPDATES, drop_pending_updates: true, max_connections: 10 });
export const deleteWebhook = (api: TelegramApi) => call<boolean>(api, 'deleteWebhook', { drop_pending_updates: true });

export async function webhookInfo(api: TelegramApi): Promise<AdminResult<Record<string, unknown>>> {
  const r = await call<Record<string, unknown>>(api, 'getWebhookInfo', {});
  if (!r.ok) return r;
  const v = r.value, at = (s: unknown) => typeof s === 'number' && s > 0 ? new Date(s * 1000).toISOString() : null;
  return { ok: true, value: { url: v.url ?? '', pendingUpdates: v.pending_update_count ?? 0, lastErrorAt: at(v.last_error_date), lastError: v.last_error_message ?? null,
    maxConnections: v.max_connections ?? null, allowedUpdates: v.allowed_updates ?? null } };
}

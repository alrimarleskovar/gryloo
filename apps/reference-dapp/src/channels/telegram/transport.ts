// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram Bot API over HTTPS (`core/provider-http.ts`): `POST <api>/bot<token>/<method>` with a JSON body,
 * no redirects, a hard timeout, a 64 KiB answer cap. The token is part of the URL path, so no URL is ever logged or returned.
 *
 * `sendMessage` answers become Channel Core's closed failure classes (`SendFailure`), from the Bot API's documented errors:
 *   RATE_LIMITED  429 (`parameters.retry_after` seconds)
 *   PERMANENT     403 (the user blocked the bot or is deactivated), 401/404 (the token is invalid), 400 (chat not found, invalid
 *                 button…), any other 4xx
 *   TRANSIENT     a 5xx carrying the API's error body (`ok: false`); a connection that never reached Telegram
 *   UNCERTAIN     a timeout or lost connection, a 5xx without the API's body, a success without a message id: Telegram may have
 *                 delivered it and reports nothing to bots, so it is never resent
 * The provider message id is `<chat id>:<message id>` (message ids are only unique within a chat). `sendPhoto` (BUILD-WORKFLOW-VISUAL-
 * PRESENTATION-001) answers and is classified exactly like `sendMessage`.
 */
import { multipartBody, providerRequest, type MultipartFile, type ProviderHttpResult } from '../core/provider-http.ts';
import type { SendResult } from '../core/types.ts';

/** A method's parameters: JSON, or multipart fields with one uploaded file (`sendPhoto`). */
export type TelegramUpload = { readonly fields: Readonly<Record<string, string>>; readonly file: MultipartFile };
export type TelegramApi = (method: string, params: Record<string, unknown> | TelegramUpload, timeoutMs?: number) => Promise<ProviderHttpResult>;
const isUpload = (params: Record<string, unknown> | TelegramUpload): params is TelegramUpload =>
  typeof (params as TelegramUpload).file === 'object' && (params as TelegramUpload).file !== null && typeof (params as TelegramUpload).fields === 'object';
export function telegramApi(options: { readonly token: string; readonly apiBase: string }, fetchImpl: typeof fetch = fetch): TelegramApi {
  return (method, params, timeoutMs = 10_000) => {
    if (!/^[A-Za-z]{3,40}$/.test(method)) throw new Error('TELEGRAM_METHOD_INVALID');
    const url = `${options.apiBase}/bot${options.token}/${method}`;
    if (isUpload(params)) {
      const { body, contentType } = multipartBody(params.fields, params.file);
      return providerRequest({ url, body, timeoutMs, headers: { 'content-type': contentType } }, fetchImpl);
    }
    return providerRequest({ url, body: JSON.stringify(params), timeoutMs, headers: { 'content-type': 'application/json' } }, fetchImpl);
  };
}

type BotAnswer = { readonly ok?: unknown; readonly result?: unknown; readonly error_code?: unknown; readonly description?: unknown;
  readonly parameters?: { readonly retry_after?: unknown } };
/** The parsed Bot API envelope, or null when the body is not one. */
export function botAnswer(result: ProviderHttpResult): BotAnswer | null {
  if (result.kind !== 'ANSWER') return null;
  try { const parsed = JSON.parse(result.body) as unknown; return parsed && typeof parsed === 'object' && 'ok' in parsed ? parsed as BotAnswer : null; } catch { return null; }
}
const failed = (code: string, failure: Extract<SendResult, { ok: false }>['failure'], retryAfterMs: number | null = null): SendResult =>
  ({ ok: false, code, failure, retryAfterMs });

/** A sendMessage answer (or network failure) as a closed outcome. */
export function classifySend(result: ProviderHttpResult, chatId: string): SendResult {
  if (result.kind !== 'ANSWER') return failed(result.code, result.kind === 'NOT_SENT' ? 'TRANSIENT' : 'UNCERTAIN');
  const answer = botAnswer(result);
  if (result.status >= 200 && result.status < 300 && answer?.ok === true) {
    const messageId = (answer.result as { message_id?: unknown } | null)?.message_id;
    return typeof messageId === 'number' && Number.isSafeInteger(messageId) && messageId > 0 ? { ok: true, providerMessageId: `${chatId}:${messageId}` }
      : failed('PROVIDER_RESPONSE_INVALID', 'UNCERTAIN');
  }
  const code = typeof answer?.error_code === 'number' ? answer.error_code : result.status;
  if (code === 429) {
    const after = typeof answer?.parameters?.retry_after === 'number' && answer.parameters.retry_after >= 0 ? Math.min(answer.parameters.retry_after, 86_400) * 1000 : null;
    return failed('PROVIDER_THROTTLED', 'RATE_LIMITED', after ?? result.retryAfterMs);
  }
  if (code === 403) return failed('PROVIDER_RECIPIENT_BLOCKED', 'PERMANENT');
  if (code === 401 || code === 404) return failed('PROVIDER_AUTHORIZATION', 'PERMANENT');
  if (code === 400) return failed(typeof answer?.description === 'string' && /chat not found|user not found/i.test(answer.description) ? 'PROVIDER_UNDELIVERABLE'
    : 'PROVIDER_REJECTED', 'PERMANENT');
  if (result.status >= 500) return answer?.ok === false ? failed('PROVIDER_UNAVAILABLE', 'TRANSIENT', result.retryAfterMs) : failed('PROVIDER_GATEWAY_ERROR', 'UNCERTAIN');
  return failed('PROVIDER_REJECTED', 'PERMANENT');
}

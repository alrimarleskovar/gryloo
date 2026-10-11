// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only: Telegram Bot API fixtures shaped like the documented `Update` objects (private messages, bot commands, callback queries,
 * my_chat_member), a Bot API double behind a fake `fetch` that records every call and answers like the API (or as scripted), and
 * secrets generated per test run. No real bot, token or chat is involved, and nothing leaves the process.
 */
import { randomBytes } from 'node:crypto';
import { telegramUserDigest } from './config.ts';

export const BOT_ID = '7000000001';
export const TELEGRAM_USER = 900000001;
export const TELEGRAM_OTHER_USER = 900000002;
let nextUpdate = Math.floor(Date.now() / 1000) % 1_000_000_000;
export const updateId = () => ++nextUpdate;

export function telegramEnv(overrides: Record<string, string | undefined> = {}) {
  const token = `${BOT_ID}:${randomBytes(30).toString('base64url').slice(0, 35)}`, webhookSecret = randomBytes(32).toString('base64url');
  const channelSecret = randomBytes(32).toString('hex');
  const env: Record<string, string | undefined> = { FLOFI_TELEGRAM: 'enabled', TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: webhookSecret,
    FLOFI_TELEGRAM_ALLOWED_USERS: telegramUserDigest(String(TELEGRAM_USER)), FLOFI_CHANNEL_SECRET: channelSecret, FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100',
    FLOFI_CHANNEL_SUPPORT_CONTACT: 'support@flofi.test', FLOFI_CHANNEL_PRIVACY_URL: 'https://flofi.test/privacy', FLOFI_CHANNEL_COPILOT: 'disabled', ...overrides };
  return { env, token, webhookSecret, channelSecret };
}

const person = (id: number) => ({ id, is_bot: false, first_name: 'Test', language_code: 'en' });
const privateChat = (id: number) => ({ id, type: 'private', first_name: 'Test' });
export function textUpdate(text: string, options: { user?: number; update?: number; date?: number; chat?: Record<string, unknown>; from?: Record<string, unknown> } = {}) {
  const user = options.user ?? TELEGRAM_USER;
  return { update_id: options.update ?? updateId(), message: { message_id: Math.floor(Math.random() * 1e6) + 1, from: options.from ?? person(user),
    chat: options.chat ?? privateChat(user), date: options.date ?? Math.floor(Date.now() / 1000), text } };
}
export function callbackUpdate(data: string, options: { user?: number; update?: number } = {}) {
  const user = options.user ?? TELEGRAM_USER;
  return { update_id: options.update ?? updateId(), callback_query: { id: String(4_000_000_000 + Math.floor(Math.random() * 1e6)), from: person(user),
    chat_instance: '1', data, message: { message_id: 7, date: Math.floor(Date.now() / 1000), chat: privateChat(user) } } };
}
export function blockedUpdate(options: { user?: number; status?: string } = {}) {
  const user = options.user ?? TELEGRAM_USER;
  return { update_id: updateId(), my_chat_member: { chat: privateChat(user), from: person(user), date: Math.floor(Date.now() / 1000),
    old_chat_member: { status: 'member', user: { id: Number(BOT_ID), is_bot: true } }, new_chat_member: { status: options.status ?? 'kicked', user: { id: Number(BOT_ID), is_bot: true } } } };
}
/** A webhook delivery as Telegram sends it: one Update, the secret token header. */
export function telegramRequest(update: unknown, secret: string | null, url = 'http://127.0.0.1:3100/api/channels/telegram') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret } },
    body: JSON.stringify(update) });
}

/** One Bot API call; `ok` once the double answered it successfully (a delivered message, for sendMessage and sendPhoto). */
export type BotCall = { readonly method: string; readonly params: Record<string, unknown>; readonly url: string; ok: boolean };
export type BotScript = (call: BotCall) => Response | 'TIMEOUT' | 'REFUSED' | null;
/** An uploaded file of a multipart call, as the double saw it. */
export type BotFile = { readonly filename: string; readonly mimeType: string; readonly bytes: Buffer };
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: a `multipart/form-data` call (`sendPhoto`) as plain params: text fields as strings, JSON
 * fields (`reply_markup`) parsed back, the file as a `BotFile` — so a test reads a photo message like a text message.
 */
export function multipartParams(body: Uint8Array, contentType: string): Record<string, unknown> {
  const boundary = /boundary=([A-Za-z0-9_-]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error('MULTIPART_BOUNDARY_MISSING');
  const params: Record<string, unknown> = {}, raw = Buffer.from(body).toString('latin1');
  for (const part of raw.split(`--${boundary}`).slice(1, -1)) {
    const split = part.indexOf('\r\n\r\n'), head = part.slice(2, split), content = part.slice(split + 4, -2);
    const name = /name="([^"]+)"/.exec(head)?.[1], filename = /filename="([^"]+)"/.exec(head)?.[1], type = /content-type: ([^\r\n]+)/i.exec(head)?.[1];
    if (!name) throw new Error('MULTIPART_PART_INVALID');
    const value = Buffer.from(content, 'latin1');
    params[name] = filename ? { filename, mimeType: type ?? '', bytes: value } satisfies BotFile : name === 'reply_markup' ? JSON.parse(value.toString('utf8')) : value.toString('utf8');
  }
  return params;
}
const MESSAGE_METHODS = new Set(['sendMessage', 'sendPhoto']);
/** A Bot API double: records every call; answers `ok` with an increasing message id unless `script` decides otherwise. */
export function botApi(script: BotScript = () => null) {
  const calls: BotCall[] = [];
  let messageId = 100;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input), method = url.split('/').at(-1)!, contentType = String((init?.headers as Record<string, string> | undefined)?.['content-type'] ?? '');
    const params = contentType.startsWith('multipart/form-data') ? multipartParams(init?.body as Uint8Array, contentType)
      : JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const call: BotCall = { method, params, url, ok: false };
    calls.push(call);
    const scripted = script(call);
    if (scripted === 'TIMEOUT') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    if (scripted === 'REFUSED') throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }) });
    if (scripted) return scripted;
    call.ok = true;
    const chat = { id: Number(params.chat_id), type: 'private' }, date = Math.floor(Date.now() / 1000);
    const result = method === 'sendMessage' ? { message_id: ++messageId, date, chat, text: params.text }
      : method === 'sendPhoto' ? { message_id: ++messageId, date, chat, caption: params.caption, photo: [{ file_id: `photo-${messageId}`, width: 1080, height: 1 }] } : true;
    return Response.json({ ok: true, result });
  }) as unknown as typeof fetch;
  /** Every message attempt — sendMessage or sendPhoto, delivered or not; `delivered` and `texts` (a photo's caption): only the accepted ones. */
  const sent = () => calls.filter(c => MESSAGE_METHODS.has(c.method));
  const delivered = () => sent().filter(c => c.ok);
  const texts = () => delivered().map(c => String(c.method === 'sendPhoto' ? c.params.caption : c.params.text));
  const linkOf = (call: BotCall) => ((call.params.reply_markup as { inline_keyboard?: { url?: string }[][] } | undefined)?.inline_keyboard?.[0]?.[0]?.url) ?? null;
  const lastLink = () => [...delivered()].reverse().map(linkOf).find(Boolean) ?? null;
  return { fetch: fetchImpl, calls, sent, delivered, texts, lastLink, linkOf };
}
export const botError = (status: number, description: string, parameters?: Record<string, unknown>) =>
  Response.json({ ok: false, error_code: status, description, ...parameters ? { parameters } : {} }, { status });

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram adapter's configuration (fails closed; the Bot API double only on loopback and never hosted),
 * webhook authenticity (the secret token, constant-time, before parsing) and normalization of documented Update shapes (private chats
 * with people only; commands keep their word; taps are choices; a blocked bot is an opt-out), rendering within the Bot API's limits,
 * and the closed classification of Bot API answers — including what Telegram does not offer (no delivery receipts, no window, no
 * confirmation of an uncertain send).
 */
import { describe, expect, it } from 'vitest';
import { readChannelDeployment } from '../registry.ts';
import { createTelegramProvider } from './adapter.ts';
import { readTelegramConfig, telegramUserDigest, type TelegramConfig } from './config.ts';
import type { ChannelImage, SendContext } from '../core/types.ts';
import { blockedUpdate, BOT_ID, botApi, botError, callbackUpdate, TELEGRAM_OTHER_USER, TELEGRAM_USER, telegramEnv, textUpdate, type BotFile, type BotScript }
  from './fixtures.test-harness.ts';
import { choicesFitKeyboard, renderSendMessage, renderSendPhoto } from './render.ts';
import { classifySend } from './transport.ts';
import { parseUpdate, secretTokenValid } from './webhook.ts';

const code = (env: Record<string, string | undefined>) => { const c = readTelegramConfig(env); return c.enabled ? 'OK' : 'reason' in c ? `${c.code}:${c.reason}` : c.code; };
const config = (): TelegramConfig => readTelegramConfig(telegramEnv().env) as TelegramConfig;
const NOW = new Date('2026-10-08T12:00:00Z');
const LINK = 'https://flofi.example/approve#flofi_chs_' + 'A'.repeat(43);

describe('BUILD-CHANNELS-001 Telegram configuration', () => {
  it('is off unless enabled, accepts a complete configuration and may run hosted (the live provider)', () => {
    expect(code({})).toBe('TELEGRAM_NOT_ENABLED');
    expect(code({ ...telegramEnv().env, FLOFI_TELEGRAM: 'true' })).toBe('TELEGRAM_NOT_ENABLED');
    const f = telegramEnv();
    expect(readTelegramConfig(f.env)).toMatchObject({ enabled: true, botId: BOT_ID, apiBase: 'https://api.telegram.org', loopback: false });
    expect(code({ ...f.env, VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('OK');
  });

  it('fails closed on every missing or malformed value, and keeps the Bot API double to loopback off-hosting', () => {
    for (const [name, value] of [['TELEGRAM_BOT_TOKEN', undefined], ['TELEGRAM_BOT_TOKEN', 'no-colon'], ['TELEGRAM_BOT_TOKEN', '123:short'],
      ['TELEGRAM_WEBHOOK_SECRET', undefined], ['TELEGRAM_WEBHOOK_SECRET', 'short'], ['TELEGRAM_WEBHOOK_SECRET', 'has spaces in it but is long enough to pass the length'],
      ['FLOFI_TELEGRAM_ALLOWED_USERS', '900000001'], ['FLOFI_TELEGRAM_API_BASE', 'https://api.example.com'], ['FLOFI_TELEGRAM_API_BASE', 'http://10.0.0.1:8081'],
      ['FLOFI_TELEGRAM_API_BASE', 'http://127.0.0.1:8081/path']] as const)
      expect(code({ ...telegramEnv().env, [name]: value }), `${name}=${value}`).toMatch(/^TELEGRAM_CONFIGURATION_INVALID:/);
    const f = telegramEnv();
    expect(code({ ...f.env, TELEGRAM_WEBHOOK_SECRET: f.token.replace(':', '_') })).toBe('OK');
    expect(readTelegramConfig({ ...f.env, FLOFI_TELEGRAM_API_BASE: 'http://127.0.0.1:8081' })).toMatchObject({ apiBase: 'http://127.0.0.1:8081', loopback: true });
    expect(code({ ...f.env, FLOFI_TELEGRAM_API_BASE: 'http://127.0.0.1:8081', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('TELEGRAM_CONFIGURATION_INVALID:FLOFI_TELEGRAM_API_BASE');
  });

  it('runs alongside WhatsApp on one Channel Core, and refuses a channel secret equal to the bot token or webhook secret', () => {
    const f = telegramEnv();
    expect(readChannelDeployment(f.env)).toMatchObject({ ok: true, deployment: { whatsapp: null, telegram: { botId: BOT_ID } } });
    expect(readChannelDeployment(f.env, 'whatsapp')).toMatchObject({ ok: false, status: 404, code: 'WHATSAPP_NOT_ENABLED' });
    expect(readChannelDeployment({ ...f.env, FLOFI_CHANNEL_SECRET: f.webhookSecret })).toMatchObject({ ok: false, status: 503, reason: 'FLOFI_CHANNEL_SECRET_REUSED' });
    // A misconfigured provider stays off on its own route; a working one is unaffected.
    expect(readChannelDeployment({ ...f.env, TELEGRAM_BOT_TOKEN: 'x' }, 'telegram')).toMatchObject({ ok: false, status: 503, code: 'TELEGRAM_CONFIGURATION_INVALID' });
    expect(readChannelDeployment({})).toMatchObject({ ok: false, status: 404, code: 'CHANNELS_NOT_ENABLED' });
  });
});

describe('BUILD-CHANNELS-001 Telegram webhook', () => {
  it('authenticates by the secret token in constant time, before anything is parsed', () => {
    const f = telegramEnv(), provider = createTelegramProvider(readTelegramConfig(f.env) as TelegramConfig, botApi().fetch);
    expect(secretTokenValid(f.webhookSecret, f.webhookSecret)).toBe(true);
    for (const header of [null, '', f.webhookSecret.slice(1), f.webhookSecret + 'x', 'x'.repeat(300)]) expect(secretTokenValid(header, f.webhookSecret)).toBe(false);
    expect(provider.authentic(new Uint8Array(), new Headers({ 'x-telegram-bot-api-secret-token': f.webhookSecret }))).toBe(true);
    expect(provider.authentic(new Uint8Array(), new Headers())).toBe(false);
    expect(provider).toMatchObject({ route: 'telegram', mode: 'live', businessId: BOT_ID, handshake: null, authenticationFailure: 'TELEGRAM_SECRET_TOKEN_INVALID' });
  });

  it('normalizes private text, commands, taps and a blocked bot; the update id is the deduplication key', () => {
    const c = config(), text = textUpdate('bridge 1 USDC from Base Sepolia to Arbitrum Sepolia', { update: 77 });
    expect(parseUpdate(text, c, NOW)).toEqual({ ignored: 0, deliveries: [], acknowledgements: [], messages: [{ channel: 'TELEGRAM', eventId: 'update:77',
      subject: { business: BOT_ID, user: String(TELEGRAM_USER) }, sendTo: { kind: 'chat', value: String(TELEGRAM_USER) }, sentAt: new Date(text.message.date * 1000),
      content: { kind: 'TEXT', text: 'bridge 1 USDC from Base Sepolia to Arbitrum Sepolia' }, allowed: true }] });
    const content = (update: unknown) => parseUpdate(update, c, NOW)!.messages[0]?.content;
    expect(content(textUpdate('/start'))).toEqual({ kind: 'TEXT', text: 'start' });
    expect(content(textUpdate('/start deep-link-payload-never-read'))).toEqual({ kind: 'TEXT', text: 'start' });
    expect(content(textUpdate('/STOP@FloFiBot'))).toEqual({ kind: 'TEXT', text: 'stop' });
    expect(content(textUpdate('/help'))).toEqual({ kind: 'TEXT', text: 'help' });
    const photo = textUpdate('x') as { message: Record<string, unknown> }; delete photo.message.text; photo.message.photo = [{ file_id: 'f' }];
    expect(content(photo)).toEqual({ kind: 'UNSUPPORTED', type: 'photo' });
    const tap = callbackUpdate('c2');
    expect(parseUpdate(tap, c, NOW)).toMatchObject({ messages: [{ content: { kind: 'CHOICE', id: 'c2', label: 'c2' }, sentAt: NOW }],
      acknowledgements: [tap.callback_query.id] });
    expect(content(blockedUpdate())).toEqual({ kind: 'PROVIDER_OPT_OUT' });
  });

  it('ignores groups, channels, bots, other members\' updates, edits and anything that is not an Update, and denies unlisted users', () => {
    const c = config(), ignored = (update: unknown) => parseUpdate(update, c, NOW);
    expect(ignored(textUpdate('hi', { chat: { id: -100123, type: 'supergroup' } }))).toMatchObject({ messages: [], ignored: 1 });
    expect(ignored(textUpdate('hi', { from: { id: TELEGRAM_USER, is_bot: true, first_name: 'Bot' } }))).toMatchObject({ messages: [], ignored: 1 });
    expect(ignored(textUpdate('hi', { chat: { id: TELEGRAM_OTHER_USER, type: 'private' } }))).toMatchObject({ messages: [], ignored: 1 });
    expect(ignored({ update_id: 5, edited_message: textUpdate('edited').message })).toMatchObject({ messages: [], ignored: 1 });
    expect(ignored({ update_id: 6, channel_post: { message_id: 1, date: 1, chat: { id: -1, type: 'channel' }, text: 'x' } })).toMatchObject({ messages: [] });
    expect(ignored(blockedUpdate({ status: 'member' }))).toMatchObject({ messages: [], ignored: 1 });
    expect(ignored(callbackUpdate('has spaces'))).toMatchObject({ messages: [], acknowledgements: [expect.stringMatching(/^[0-9]+$/)] });
    for (const notAnUpdate of [null, [], {}, { update_id: -1 }, { update_id: 1.5 }, { object: 'whatsapp_business_account' }]) expect(ignored(notAnUpdate)).toBeNull();
    expect(parseUpdate(textUpdate('hi', { user: TELEGRAM_OTHER_USER }), c, NOW)!.messages[0]!.allowed).toBe(false);
    expect(telegramUserDigest(String(TELEGRAM_USER))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('BUILD-CHANNELS-001 Telegram outbound', () => {
  it('renders plain text with previews off, one URL button for the approval link, callback buttons for short choices', () => {
    const to = { kind: 'chat', value: String(TELEGRAM_USER) };
    expect(renderSendMessage(to, { text: 'Strategy ready', choices: [], link: { label: 'Open FloFi', url: LINK } })).toEqual({ chat_id: String(TELEGRAM_USER),
      text: 'Strategy ready', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: 'Open FloFi', url: LINK }]] } });
    expect(renderSendMessage(to, { text: 'Which network?', choices: [{ id: 'c1', label: 'Base Sepolia' }, { id: 'c2', label: 'Arbitrum Sepolia' }], link: null }))
      .toMatchObject({ reply_markup: { inline_keyboard: [[{ text: 'Base Sepolia', callback_data: 'c1' }], [{ text: 'Arbitrum Sepolia', callback_data: 'c2' }]] } });
    expect(choicesFitKeyboard(['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id })))).toBe(false);
    expect(choicesFitKeyboard([{ id: 'c1', label: 'x'.repeat(65) }])).toBe(false);
    const long = renderSendMessage(to, { text: 'x'.repeat(5_000), choices: [], link: null }) as { text: string; parse_mode?: string };
    expect(long.text.length).toBe(4_096);
    expect(long.parse_mode).toBeUndefined();
  });

  it('classifies Bot API answers into closed failure classes, with retry_after', () => {
    const answer = (status: number, body: unknown, retryAfterMs: number | null = null) =>
      classifySend({ kind: 'ANSWER', status, body: typeof body === 'string' ? body : JSON.stringify(body), retryAfterMs }, '900000001');
    const fail = (code: string, failure: string, retryAfterMs: number | null = null) => ({ ok: false, code, failure, retryAfterMs });
    expect(answer(200, { ok: true, result: { message_id: 42 } })).toEqual({ ok: true, providerMessageId: '900000001:42' });
    expect(answer(200, { ok: true, result: {} })).toEqual(fail('PROVIDER_RESPONSE_INVALID', 'UNCERTAIN'));
    expect(answer(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } })).toEqual(fail('PROVIDER_THROTTLED', 'RATE_LIMITED', 7_000));
    expect(answer(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })).toEqual(fail('PROVIDER_RECIPIENT_BLOCKED', 'PERMANENT'));
    expect(answer(401, { ok: false, error_code: 401, description: 'Unauthorized' })).toEqual(fail('PROVIDER_AUTHORIZATION', 'PERMANENT'));
    expect(answer(404, { ok: false, error_code: 404, description: 'Not Found' })).toEqual(fail('PROVIDER_AUTHORIZATION', 'PERMANENT'));
    expect(answer(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })).toEqual(fail('PROVIDER_UNDELIVERABLE', 'PERMANENT'));
    expect(answer(400, { ok: false, error_code: 400, description: 'Bad Request: BUTTON_URL_INVALID' })).toEqual(fail('PROVIDER_REJECTED', 'PERMANENT'));
    expect(answer(500, { ok: false, error_code: 500, description: 'Internal Server Error' })).toEqual(fail('PROVIDER_UNAVAILABLE', 'TRANSIENT'));
    expect(answer(502, '<html>Bad Gateway</html>')).toEqual(fail('PROVIDER_GATEWAY_ERROR', 'UNCERTAIN'));
    expect(classifySend({ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' }, '1')).toEqual(fail('PROVIDER_TIMEOUT', 'UNCERTAIN'));
    expect(classifySend({ kind: 'NOT_SENT', code: 'PROVIDER_UNREACHABLE' }, '1')).toEqual(fail('PROVIDER_UNREACHABLE', 'TRANSIENT'));
  });

  it('sends through the Bot API with the token only in the path, and declares what Telegram does not offer', async () => {
    const f = telegramEnv(), api = botApi(), provider = createTelegramProvider(readTelegramConfig(f.env) as TelegramConfig, api.fetch);
    const result = await provider.adapter.send({ kind: 'chat', value: String(TELEGRAM_USER) }, { text: 'hello', choices: [], link: null }, 'cho_x',
      { kind: 'REPLY', windowOpen: true });
    expect(result).toEqual({ ok: true, providerMessageId: `${TELEGRAM_USER}:101` });
    expect(api.calls[0]!.url).toBe(`https://api.telegram.org/bot${f.token}/sendMessage`);
    expect(JSON.stringify(api.calls[0]!.params)).not.toContain(f.token);
    expect(provider.adapter).toMatchObject({ channel: 'TELEGRAM', clientId: `telegram:${BOT_ID}`, displayName: 'Telegram', windowHours: null, deliveryReports: [],
      confirmsUncertainSends: false });
    await provider.acknowledge(['4000000001']);
    expect(api.calls.at(-1)).toMatchObject({ method: 'answerCallbackQuery', params: { callback_query_id: '4000000001' } });
    // An acknowledgement failure changes nothing.
    await createTelegramProvider(readTelegramConfig(f.env) as TelegramConfig, botApi(() => 'TIMEOUT').fetch).acknowledge(['1']);
  });
});

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 Telegram workflow photo', () => {
  const to = { kind: 'chat', value: String(TELEGRAM_USER) };
  const image: ChannelImage = { mimeType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 120 }, (_, i) => i)]),
    alt: 'FloFi workflow: Bridge.' };
  const reply = { text: 'Strategy ready:\n1. Bridge 5 USDC · Base Sepolia → Arbitrum Sepolia\nNothing is authorized yet.', choices: [], link: { label: 'Open FloFi', url: LINK } };
  const approval: SendContext = { kind: 'APPROVAL', windowOpen: true, image };
  const adapter = (script?: BotScript) => {
    const f = telegramEnv(), api = botApi(script);
    return { f, api, adapter: createTelegramProvider(readTelegramConfig(f.env) as TelegramConfig, api.fetch).adapter };
  };

  it('sends a proposal as one photo message: the PNG uploaded as bytes, the whole text as caption, the same Open FloFi button', async () => {
    const { f, api, adapter: telegram } = adapter();
    expect(await telegram.send(to, reply, 'cho_x', approval)).toEqual({ ok: true, providerMessageId: `${TELEGRAM_USER}:101` });
    expect(api.calls.map(c => c.method)).toEqual(['sendPhoto']);
    const call = api.calls[0]!, photo = call.params.photo as BotFile;
    expect(call.url).toBe(`https://api.telegram.org/bot${f.token}/sendPhoto`);
    expect(call.params).toMatchObject({ chat_id: String(TELEGRAM_USER), caption: reply.text, reply_markup: { inline_keyboard: [[{ text: 'Open FloFi', url: LINK }]] } });
    expect(call.params.parse_mode).toBeUndefined();
    expect([photo.filename, photo.mimeType, Buffer.compare(photo.bytes, Buffer.from(image.bytes))]).toEqual(['flofi-workflow.png', 'image/png', 0]);
    expect(JSON.stringify({ ...call.params, photo: null })).not.toContain(f.token);
    // Rendering: multipart fields and one file; choices keep their callback buttons.
    expect(renderSendPhoto(to, { text: 'Which?', choices: [{ id: 'c1', label: 'Base' }], link: null }, image).fields)
      .toEqual({ chat_id: String(TELEGRAM_USER), caption: 'Which?', reply_markup: JSON.stringify({ inline_keyboard: [[{ text: 'Base', callback_data: 'c1' }]] }) });
  });

  it('falls back to the text message: no picture, a caption that would be cut, or a photo Telegram itself rejects', async () => {
    const plain = adapter();
    await plain.adapter.send(to, reply, 'cho_x', { kind: 'APPROVAL', windowOpen: true });
    expect(plain.api.calls.map(c => c.method)).toEqual(['sendMessage']);
    const long = adapter();
    await long.adapter.send(to, { ...reply, text: 'x'.repeat(1_025) }, 'cho_x', approval);
    expect(long.api.calls.map(c => c.method)).toEqual(['sendMessage']);
    for (const rejection of [botError(400, 'Bad Request: IMAGE_PROCESS_FAILED'), botError(413, 'Request Entity Too Large')]) {
      const rejected = adapter(call => call.method === 'sendPhoto' ? rejection : null);
      expect(await rejected.adapter.send(to, reply, 'cho_x', approval)).toEqual({ ok: true, providerMessageId: `${TELEGRAM_USER}:101` });
      expect(rejected.api.calls.map(c => [c.method, c.ok])).toEqual([['sendPhoto', false], ['sendMessage', true]]);
      expect(rejected.api.texts()).toEqual([reply.text]);
      expect(rejected.api.linkOf(rejected.api.delivered()[0]!)).toBe(LINK);
    }
  });

  it('keeps every other outcome\'s class: throttled, unavailable, blocked, unknown chat and uncertain are never resent as text', async () => {
    const cases: [BotScript, Record<string, unknown>][] = [
      [() => botError(429, 'Too Many Requests: retry after 9', { retry_after: 9 }), { failure: 'RATE_LIMITED', code: 'PROVIDER_THROTTLED', retryAfterMs: 9_000 }],
      [() => botError(500, 'Internal Server Error'), { failure: 'TRANSIENT', code: 'PROVIDER_UNAVAILABLE' }],
      [() => botError(403, 'Forbidden: bot was blocked by the user'), { failure: 'PERMANENT', code: 'PROVIDER_RECIPIENT_BLOCKED' }],
      [() => botError(400, 'Bad Request: chat not found'), { failure: 'PERMANENT', code: 'PROVIDER_UNDELIVERABLE' }],
      [() => 'TIMEOUT', { failure: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' }],
      [() => 'REFUSED', { failure: 'TRANSIENT', code: 'PROVIDER_UNREACHABLE' }],
    ];
    for (const [script, expected] of cases) {
      const d = adapter(call => call.method === 'sendPhoto' ? script(call) : null);
      expect(await d.adapter.send(to, reply, 'cho_x', approval)).toMatchObject({ ok: false, ...expected });
      expect(d.api.calls.map(c => c.method)).toEqual(['sendPhoto']);
    }
  });
});

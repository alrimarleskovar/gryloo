// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 — LIVE Telegram provider check (owner-run; never in `pnpm test`, which excludes `*.live.test.ts`, nor in CI).
 * It talks to the real Bot API with the owner's bot and touches no database, no FloFi flow and no wallet:
 *
 *   FLOFI_TELEGRAM_LIVE=SEND_ONE_MESSAGE TELEGRAM_BOT_TOKEN=… FLOFI_TELEGRAM_LIVE_CHAT_ID=<your user id> \
 *     [FLOFI_PUBLIC_ORIGIN=https://<deployment>] pnpm test:channels-live
 *
 *   1. getMe answers for the token (the bot exists and the token is valid);
 *   2. when FLOFI_PUBLIC_ORIGIN is given: the registered webhook is `<origin>/api/channels/telegram`, restricted to the update kinds
 *      FloFi reads, and Telegram reports no delivery error since the last registration;
 *   3. the production adapter sends ONE plain message to the owner's own chat and gets a provider message id back (the chat must have
 *      sent /start to the bot first — Telegram's rule).
 * Skipped unless FLOFI_TELEGRAM_LIVE=SEND_ONE_MESSAGE. Read the secrets from your shell or secret manager, never from a file in Git.
 */
import { describe, expect, it } from 'vitest';
import { me, TELEGRAM_ALLOWED_UPDATES, webhookInfo, webhookUrl } from './admin.ts';
import { createTelegramAdapter } from './adapter.ts';
import { TELEGRAM_API } from './config.ts';
import { telegramApi } from './transport.ts';

const live = process.env.FLOFI_TELEGRAM_LIVE === 'SEND_ONE_MESSAGE';
const token = process.env.TELEGRAM_BOT_TOKEN ?? '', chat = process.env.FLOFI_TELEGRAM_LIVE_CHAT_ID ?? '', origin = process.env.FLOFI_PUBLIC_ORIGIN ?? '';

describe.skipIf(!live)('BUILD-CHANNELS-001 LIVE Telegram provider (owner-run)', () => {
  const api = telegramApi({ token, apiBase: TELEGRAM_API });
  it('authenticates the bot', async () => {
    expect(token).toMatch(/^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/);
    expect(await me(api)).toMatchObject({ ok: true, value: { id: Number(token.split(':')[0]) } });
  });
  it.skipIf(!origin)('has the webhook registered for this deployment, without delivery errors', async () => {
    const info = await webhookInfo(api);
    expect(info).toMatchObject({ ok: true, value: { url: webhookUrl(origin), allowedUpdates: [...TELEGRAM_ALLOWED_UPDATES] } });
    expect(info.ok && info.value.lastError).toBeNull();
  });
  it('delivers one message to the owner\'s own chat through the production adapter', async () => {
    expect(chat).toMatch(/^[1-9][0-9]{4,15}$/);
    const adapter = createTelegramAdapter(token.split(':')[0]!, api);
    const result = await adapter.send({ kind: 'chat', value: chat }, { text: `FloFi live channel check (${new Date().toISOString()}): sendMessage works. Nothing is authorized by this message.`,
      choices: [], link: null }, 'cho_livecheckxxxxxxxxxxxxxxxxx', { kind: 'NOTIFICATION', windowOpen: true });
    expect(result).toMatchObject({ ok: true, providerMessageId: expect.stringMatching(new RegExp(`^${chat}:[0-9]+$`)) });
  });
});

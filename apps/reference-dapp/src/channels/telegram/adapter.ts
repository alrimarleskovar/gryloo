// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Telegram as a Channel Core adapter and provider — provider concerns only. Requester identity on /approve: client
 * `telegram:<bot id>`, shown as "Telegram".
 *
 * What the Bot API offers, and nothing more: no messaging window (a bot may write to a user who started it, until the user blocks it),
 * no delivery or read receipts (a message is SENT when the API accepted it), no idempotency key (an UNCERTAIN send is never confirmed,
 * so it is never resent), throughput limits answered with 429 and `retry_after`, and callback queries that must be answered.
 */
import type { ChannelAdapter, ChannelProvider } from '../core/types.ts';
import { telegramSecrets, type TelegramConfig } from './config.ts';
import { choicesFitKeyboard, renderSendMessage } from './render.ts';
import { classifySend, telegramApi, type TelegramApi } from './transport.ts';
import { MAX_UPDATE_BYTES, parseUpdate, secretTokenValid, TELEGRAM_CHANNEL } from './webhook.ts';

export function createTelegramAdapter(botId: string, api: TelegramApi): ChannelAdapter {
  const adapter: ChannelAdapter = { channel: TELEGRAM_CHANNEL, clientId: `telegram:${botId}`, displayName: 'Telegram', windowHours: null,
    outsideWindow: ['REPLY', 'APPROVAL', 'NOTIFICATION'], deliveryReports: [], confirmsUncertainSends: false, choicesFit: choicesFitKeyboard,
    send: async (to, reply) => classifySend(await api('sendMessage', renderSendMessage(to, reply)), to.value) };
  return Object.freeze(adapter);
}

export function createTelegramProvider(config: TelegramConfig, fetchImpl: typeof fetch = fetch): ChannelProvider {
  const api = telegramApi({ token: config.token, apiBase: config.apiBase }, fetchImpl);
  return Object.freeze({ route: 'telegram', mode: config.loopback ? 'fixture' : 'live', businessId: config.botId, maxBodyBytes: MAX_UPDATE_BYTES,
    authenticationFailure: 'TELEGRAM_SECRET_TOKEN_INVALID', adapter: createTelegramAdapter(config.botId, api), handshake: null,
    authentic: (_raw: Uint8Array, headers: Headers) => secretTokenValid(headers.get('x-telegram-bot-api-secret-token'), config.webhookSecret),
    normalize: (body: unknown, receivedAt: Date) => parseUpdate(body, config, receivedAt),
    // Stops the button's loading indicator; best effort, and nothing depends on it.
    acknowledge: async (ids: readonly string[]) => { for (const id of ids) await api('answerCallbackQuery', { callback_query_id: id }, 3_000).catch(() => undefined); },
    secrets: telegramSecrets(config) });
}

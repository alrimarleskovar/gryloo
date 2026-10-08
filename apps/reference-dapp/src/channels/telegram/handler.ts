// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram webhook (`/api/channels/telegram`) — the shared provider boundary (`../http.ts`) with Telegram's
 * provider: POST only, `X-Telegram-Bot-Api-Secret-Token` checked before parsing (1 MiB bound), one Update per request.
 */
import { handleChannelWebhook, type ChannelWebhookOptions } from '../http.ts';

export type TelegramWebhookOptions = Omit<ChannelWebhookOptions, 'seams'> & { readonly fetch?: typeof fetch };
export function handleTelegramWebhook(request: Request, options: TelegramWebhookOptions = {}): Promise<Response> {
  const { fetch: fetchImpl, ...rest } = options;
  return handleChannelWebhook('telegram', request, { ...rest, ...fetchImpl ? { seams: { telegramFetch: fetchImpl } } : {} });
}

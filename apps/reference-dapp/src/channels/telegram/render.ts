// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core replies as Telegram Bot API `sendMessage` parameters, within the documented limits:
 *
 *   a reply with the approval link   text + an inline keyboard with one URL button (Telegram opens it in the user's browser; the secret
 *                                    stays in the URL fragment, which no server receives)
 *   a reply with ≤ 4 short choices   text + an inline keyboard of callback buttons (callback_data = the choice id, ≤ 64 bytes)
 *   anything else                    text (≤ 4096 characters)
 *
 * Always plain text (no parse_mode, so nothing in FloFi's text is interpreted as markup) and link previews off.
 */
import type { ChannelAddress, ChannelReply, ReplyChoice } from '../core/types.ts';

export const TELEGRAM_LIMITS = Object.freeze({ text: 4_096, buttons: 4, buttonText: 64, callbackData: 64 });
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1)}…`;
/** Whether choices can be callback buttons; otherwise Channel Core lists them as numbers in the text. */
export const choicesFitKeyboard = (choices: readonly ReplyChoice[]) => choices.length > 0 && choices.length <= TELEGRAM_LIMITS.buttons
  && choices.every(c => c.label.length >= 1 && c.label.length <= TELEGRAM_LIMITS.buttonText && /^[A-Za-z0-9_.:-]{1,64}$/.test(c.id));

export function renderSendMessage(to: ChannelAddress, reply: ChannelReply): Record<string, unknown> {
  const base = { chat_id: to.value, text: clip(reply.text, TELEGRAM_LIMITS.text), link_preview_options: { is_disabled: true } };
  if (reply.link) return { ...base, reply_markup: { inline_keyboard: [[{ text: clip(reply.link.label, TELEGRAM_LIMITS.buttonText), url: reply.link.url }]] } };
  if (choicesFitKeyboard(reply.choices)) return { ...base, reply_markup: { inline_keyboard: reply.choices.map(c => [{ text: c.label, callback_data: c.id }]) } };
  return base;
}

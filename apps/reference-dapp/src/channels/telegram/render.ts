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
 *
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: a reply whose workflow picture was rendered, and whose text fits a caption, becomes `sendPhoto`
 * — the PNG uploaded as bytes (multipart, never a URL), the same text as its caption and the same inline keyboard.
 */
import type { MultipartFile } from '../core/provider-http.ts';
import type { ChannelAddress, ChannelImage, ChannelReply, ReplyChoice } from '../core/types.ts';

export const TELEGRAM_LIMITS = Object.freeze({ text: 4_096, caption: 1_024, buttons: 4, buttonText: 64, callbackData: 64 });
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1)}…`;
/** Whether choices can be callback buttons; otherwise Channel Core lists them as numbers in the text. */
export const choicesFitKeyboard = (choices: readonly ReplyChoice[]) => choices.length > 0 && choices.length <= TELEGRAM_LIMITS.buttons
  && choices.every(c => c.label.length >= 1 && c.label.length <= TELEGRAM_LIMITS.buttonText && /^[A-Za-z0-9_.:-]{1,64}$/.test(c.id));

/** The inline keyboard of a reply: its one URL button, or its fitting choices as callback buttons; null when it has neither. */
function keyboard(reply: ChannelReply): Record<string, unknown> | null {
  if (reply.link) return { inline_keyboard: [[{ text: clip(reply.link.label, TELEGRAM_LIMITS.buttonText), url: reply.link.url }]] };
  if (choicesFitKeyboard(reply.choices)) return { inline_keyboard: reply.choices.map(c => [{ text: c.label, callback_data: c.id }]) };
  return null;
}
export function renderSendMessage(to: ChannelAddress, reply: ChannelReply): Record<string, unknown> {
  const base = { chat_id: to.value, text: clip(reply.text, TELEGRAM_LIMITS.text), link_preview_options: { is_disabled: true } }, markup = keyboard(reply);
  return markup ? { ...base, reply_markup: markup } : base;
}
/** Whether a reply's text can be a photo caption unchanged (never clipped: a caption that would lose words is sent as text instead). */
export const captionFits = (reply: ChannelReply) => reply.text.length <= TELEGRAM_LIMITS.caption;
/** `sendPhoto` as multipart fields and the photo file: the caption is the reply's whole text, the keyboard the same as `sendMessage`'s. */
export function renderSendPhoto(to: ChannelAddress, reply: ChannelReply, image: ChannelImage): { readonly fields: Record<string, string>; readonly file: MultipartFile } {
  const markup = keyboard(reply);
  return { fields: { chat_id: to.value, caption: reply.text, ...markup ? { reply_markup: JSON.stringify(markup) } : {} },
    file: { field: 'photo', filename: 'flofi-workflow.png', mimeType: image.mimeType, bytes: image.bytes } };
}

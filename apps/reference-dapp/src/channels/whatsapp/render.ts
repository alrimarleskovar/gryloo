// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core replies as WhatsApp Cloud API message requests (`POST /<version>/<phone number id>/messages`),
 * within Meta's documented limits:
 *
 *   a reply with the approval link   interactive call-to-action URL message (body ≤ 1024, button label ≤ 20); the link opens in the
 *                                    phone's default browser and its secret stays in the URL fragment
 *   a reply with ≤ 3 short choices   interactive reply buttons (≤ 3 buttons, title ≤ 20, id ≤ 256)
 *   anything else                    a text message (≤ 4096) with link previews off
 *   a notification outside the       the owner's approved Utility template (WHATSAPP_NOTIFICATION_TEMPLATE) with the notification as its
 *   24-hour window                   one body variable (no newline, tab or run of spaces, as Meta requires); never an approval link
 *
 * The recipient is the business-scoped user id when known (`recipient`), otherwise the phone number (`to`). Every request carries the
 * outbox id as `biz_opaque_callback_data`, which Meta echoes in status webhooks, so delivery is correlated even after a crash.
 *
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: with an uploaded workflow picture (a media id from `/media`, never a URL), the interactive
 * messages carry it as their image header — the same body text and the same button; a plain reply becomes an image message whose
 * caption is the whole text (only when it fits; otherwise the text message is sent).
 */
import type { ChannelAddress, ChannelReply, ReplyChoice } from '../core/types.ts';
import type { WhatsAppTemplate } from './config.ts';

export const WHATSAPP_LIMITS = Object.freeze({ text: 4_096, interactiveBody: 1_024, buttons: 3, buttonTitle: 20, footer: 60, templateParameter: 900, caption: 1_024 });
const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1)}…`;
/** Whether choices can be reply buttons; otherwise Channel Core lists them as numbers in the text. */
export const choicesFitButtons = (choices: readonly ReplyChoice[]) =>
  choices.length > 0 && choices.length <= WHATSAPP_LIMITS.buttons && choices.every(c => c.label.length >= 1 && c.label.length <= WHATSAPP_LIMITS.buttonTitle);

export function renderMessage(to: ChannelAddress, reply: ChannelReply, correlationId: string, mediaId: string | null = null): Record<string, unknown> {
  const recipient = to.kind === 'bsuid' ? { recipient: to.value } : { to: to.value };
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', ...recipient, biz_opaque_callback_data: correlationId };
  const header = mediaId ? { header: { type: 'image', image: { id: mediaId } } } : {};
  if (reply.link) return { ...base, type: 'interactive', interactive: { type: 'cta_url', ...header, body: { text: clip(reply.text, WHATSAPP_LIMITS.interactiveBody) },
    action: { name: 'cta_url', parameters: { display_text: clip(reply.link.label, WHATSAPP_LIMITS.buttonTitle), url: reply.link.url } } } };
  if (choicesFitButtons(reply.choices)) return { ...base, type: 'interactive', interactive: { type: 'button', ...header, body: { text: clip(reply.text, WHATSAPP_LIMITS.interactiveBody) },
    action: { buttons: reply.choices.map(c => ({ type: 'reply', reply: { id: c.id, title: c.label } })) } } };
  if (mediaId && reply.text.length <= WHATSAPP_LIMITS.caption) return { ...base, type: 'image', image: { id: mediaId, caption: reply.text } };
  return { ...base, type: 'text', text: { body: clip(reply.text, WHATSAPP_LIMITS.text), preview_url: false } };
}

/** A status notification as the approved template, for a recipient whose 24-hour window has closed. Never carries a link. */
export function renderTemplate(to: ChannelAddress, reply: ChannelReply, correlationId: string, template: WhatsAppTemplate): Record<string, unknown> {
  const recipient = to.kind === 'bsuid' ? { recipient: to.value } : { to: to.value };
  const parameter = clip(reply.text.replace(/\s*\n\s*/g, ' · ').replace(/\t/g, ' ').replace(/ {2,}/g, ' ').trim(), WHATSAPP_LIMITS.templateParameter);
  return { messaging_product: 'whatsapp', recipient_type: 'individual', ...recipient, biz_opaque_callback_data: correlationId, type: 'template',
    template: { name: template.name, language: { code: template.language }, components: [{ type: 'body', parameters: [{ type: 'text', text: parameter }] }] } };
}

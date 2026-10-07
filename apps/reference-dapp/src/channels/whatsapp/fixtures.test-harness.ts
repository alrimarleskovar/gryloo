// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only: synthetic WhatsApp Cloud API webhook deliveries, shaped like Meta's documented payloads (text, interactive replies,
 * media, statuses; BSUID and phone identities) and signed in-process with secrets generated per test run. No real number, account,
 * message or Meta endpoint is involved; nothing here is a credential.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const PHONE_NUMBER_ID = '106540352242922', BUSINESS_ACCOUNT_ID = '102290129340398';
export const USER_PHONE = '5511900000001', USER_BSUID = 'BR.FLOFITESTUSER0001';
export const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
/** A complete local configuration with generated secrets (fixture provider; loopback origin). */
export function whatsAppEnv(overrides: Record<string, string | undefined> = {}) {
  const appSecret = randomBytes(16).toString('hex'), verifyToken = randomBytes(24).toString('base64url'), channelSecret = randomBytes(32).toString('hex');
  const env: Record<string, string | undefined> = { FLOFI_WHATSAPP: 'enabled', FLOFI_WHATSAPP_PROVIDER: 'fixture', WHATSAPP_APP_SECRET: appSecret,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: verifyToken, WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
    FLOFI_WHATSAPP_ALLOWED_SENDERS: sha256Hex(USER_BSUID), FLOFI_CHANNEL_SECRET: channelSecret, FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100',
    FLOFI_CHANNEL_SUPPORT_CONTACT: 'support@flofi.test', FLOFI_CHANNEL_PRIVACY_URL: 'https://flofi.test/privacy', ...overrides };
  return { env, appSecret, verifyToken, channelSecret };
}

type Message = { id?: string; text?: string; timestamp?: number; from?: string | null; bsuid?: string | null; type?: string; interactive?: unknown; extra?: Record<string, unknown> };
let counter = 0;
export const messageId = () => `wamid.TEST${Date.now().toString(36)}${(counter++).toString(36)}${randomBytes(4).toString('hex')}`;
/** One inbound message change as Meta delivers it (BSUID and phone by default). */
export function inbound(messages: readonly Message[], options: { phoneNumberId?: string; businessAccountId?: string } = {}) {
  return { object: 'whatsapp_business_account', entry: [{ id: options.businessAccountId ?? BUSINESS_ACCOUNT_ID, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: options.phoneNumberId ?? PHONE_NUMBER_ID },
    contacts: messages.map(m => ({ profile: { name: 'Test User' }, ...m.from === null ? {} : { wa_id: m.from ?? USER_PHONE }, ...m.bsuid === null ? {} : { user_id: m.bsuid ?? USER_BSUID } })),
    messages: messages.map(m => ({ ...m.from === null ? {} : { from: m.from ?? USER_PHONE }, ...m.bsuid === null ? {} : { from_user_id: m.bsuid ?? USER_BSUID },
      id: m.id ?? messageId(), timestamp: String(m.timestamp ?? Math.floor(Date.now() / 1000)), type: m.type ?? 'text',
      ...(m.type ?? 'text') === 'text' ? { text: { body: m.text ?? '' } } : {}, ...m.interactive ? { interactive: m.interactive } : {}, ...m.extra })),
  } }] }] };
}
export function statuses(items: readonly { id: string; status: string; correlation?: string; error?: number }[]) {
  return { object: 'whatsapp_business_account', entry: [{ id: BUSINESS_ACCOUNT_ID, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID }, statuses: items.map(s => ({ id: s.id, status: s.status,
      timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: USER_PHONE, recipient_user_id: USER_BSUID, ...s.correlation ? { biz_opaque_callback_data: s.correlation } : {},
      ...s.error ? { errors: [{ code: s.error, title: 'error' }] } : {} })) } }] }] };
}
/** The exact bytes Meta would send and their `X-Hub-Signature-256` under `secret`. */
export function signed(body: unknown, secret: string, raw = JSON.stringify(body)) {
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex')}` };
}
export function webhookRequest(body: unknown, secret: string, options: { raw?: string; signature?: string | null; contentType?: string; origin?: string } = {}) {
  const s = signed(body, secret, options.raw);
  const headers: Record<string, string> = { 'content-type': options.contentType ?? 'application/json' };
  const signature = options.signature === undefined ? s.signature : options.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return new Request(`${options.origin ?? 'http://127.0.0.1:3100'}/api/channels/whatsapp`, { method: 'POST', headers, body: s.raw });
}

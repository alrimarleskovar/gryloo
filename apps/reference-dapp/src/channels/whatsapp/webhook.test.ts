// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp webhook contract against fixtures shaped like Meta's documentation — subscription verification,
 * signature verification over the exact raw bytes (escaped unicode included), and normalization into Channel Core events with a
 * BSUID-first identity, a default-deny allowlist and unsupported content never interpreted. No network, no Meta endpoint.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readWhatsAppConfig, type WhatsAppConfig } from './config.ts';
import { BUSINESS_ACCOUNT_ID, inbound, PHONE_NUMBER_ID, sha256Hex, signed, statuses, USER_BSUID, USER_PHONE, whatsAppEnv } from './fixtures.test-harness.ts';
import { parseWebhook, signatureValid, verifySubscription } from './webhook.ts';

const setup = () => {
  const fixture = whatsAppEnv(), config = readWhatsAppConfig(fixture.env);
  if (!config.enabled) throw new Error(config.code);
  return { ...fixture, config: config as WhatsAppConfig };
};
const url = (params: Record<string, string>) => new URL(`http://127.0.0.1:3100/api/channels/whatsapp?${new URLSearchParams(params)}`);

describe('BUILD-CHANNELS-001 WhatsApp webhook verification', () => {
  it('answers the subscription challenge only for subscribe with the exact verify token', async () => {
    const { config, verifyToken } = setup();
    const ok = verifySubscription(url({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '1158201444' }), config);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    for (const params of [{ 'hub.mode': 'subscribe', 'hub.verify_token': `${verifyToken}x`, 'hub.challenge': '1' }, { 'hub.mode': 'unsubscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '1' },
      { 'hub.mode': 'subscribe', 'hub.challenge': '1' }, { 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': '<script>' },
      { 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'x'.repeat(200) }])
      expect(verifySubscription(url(params), config).status, JSON.stringify(params)).toBe(403);
  });

  it('accepts a signature only over the exact raw bytes, under a configured app secret', () => {
    const { appSecret } = setup(), body = inbound([{ text: 'Olá, quero trocar 1 USDC' }]);
    // Meta signs the bytes it sends; here they contain escaped unicode, which a re-serialization would change.
    const raw = JSON.stringify(body).replace('Olá', 'Ol\\u00e1'), { signature } = signed(body, appSecret, raw);
    expect(signatureValid(Buffer.from(raw), signature, [appSecret])).toBe(true);
    expect(signatureValid(Buffer.from(JSON.stringify(JSON.parse(raw))), signature, [appSecret])).toBe(false);
    const tampered = Buffer.from(raw); tampered[tampered.length - 3]! ^= 1;
    expect(signatureValid(tampered, signature, [appSecret])).toBe(false);
    expect(signatureValid(Buffer.from(raw), signature, ['another-app-secret-value'])).toBe(false);
    expect(signatureValid(Buffer.from(raw), signature, ['another-app-secret-value', appSecret])).toBe(true); // rotation: previous + current
    for (const header of [null, '', signature.toUpperCase(), signature.replace('sha256=', 'sha1='), `${signature}0`, `sha256=${'0'.repeat(64)}`])
      expect(signatureValid(Buffer.from(raw), header, [appSecret]), String(header)).toBe(false);
    expect(createHmac('sha256', appSecret).update(raw).digest('hex')).toBe(signature.slice(7));
  });
});

describe('BUILD-CHANNELS-001 WhatsApp payload normalization', () => {
  it('normalizes text with a BSUID-first identity, the send address and the provider send time', () => {
    const { config } = setup(), parsed = parseWebhook(inbound([{ id: 'wamid.A1', text: 'swap 1 USDC to WETH on Base Sepolia slippage 50 bps', timestamp: 1_780_000_000 }]), config)!;
    expect(parsed.messages).toEqual([{ channel: 'WHATSAPP', eventId: 'wamid.A1', subject: { business: PHONE_NUMBER_ID, user: USER_BSUID },
      sendTo: { kind: 'bsuid', value: USER_BSUID }, sentAt: new Date(1_780_000_000_000), content: { kind: 'TEXT', text: 'swap 1 USDC to WETH on Base Sepolia slippage 50 bps' },
      allowed: true }]);
  });

  it('falls back to the phone number when no BSUID is present, and denies senders outside the allowlist', () => {
    const { config } = setup();
    const phoneOnly = parseWebhook(inbound([{ bsuid: null, text: 'hi' }]), config)!.messages[0]!;
    expect(phoneOnly).toMatchObject({ subject: { user: USER_PHONE }, sendTo: { kind: 'phone', value: USER_PHONE }, allowed: false });
    const allowedByPhone = readWhatsAppConfig({ ...whatsAppEnv().env, FLOFI_WHATSAPP_ALLOWED_SENDERS: sha256Hex(USER_PHONE) }) as WhatsAppConfig;
    expect(parseWebhook(inbound([{ bsuid: null, text: 'hi' }]), allowedByPhone)!.messages[0]!.allowed).toBe(true);
    const empty = readWhatsAppConfig({ ...whatsAppEnv().env, FLOFI_WHATSAPP_ALLOWED_SENDERS: '' }) as WhatsAppConfig;
    expect(parseWebhook(inbound([{ text: 'hi' }]), empty)!.messages[0]!.allowed).toBe(false);
  });

  it('maps reply choices, never interprets media or voice, and ignores reactions, system notices and group messages', () => {
    const { config } = setup();
    const parsed = parseWebhook(inbound([
      { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'c1', title: 'Base Sepolia' } } },
      { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'c2', title: 'The swap' } } },
      { type: 'audio', extra: { audio: { id: 'media-1' } } }, { type: 'image', extra: { image: { id: 'media-2' } } }, { type: 'location', extra: { location: {} } },
      { type: 'reaction', extra: { reaction: { emoji: '👍' } } }, { type: 'system', extra: { system: {} } }, { text: 'group hello', extra: { group_id: 'G1' } },
    ]), config)!;
    expect(parsed.messages.map(m => m.content)).toEqual([{ kind: 'CHOICE', id: 'c1', label: 'Base Sepolia' }, { kind: 'CHOICE', id: 'c2', label: 'The swap' },
      { kind: 'UNSUPPORTED', type: 'audio' }, { kind: 'UNSUPPORTED', type: 'image' }, { kind: 'UNSUPPORTED', type: 'location' }]);
    expect(parsed.ignored).toBe(3);
  });

  it('reads only this business account and phone number; other entries are counted and dropped', () => {
    const { config } = setup();
    expect(parseWebhook(inbound([{ text: 'x' }], { businessAccountId: '999999' }), config)).toEqual({ messages: [], deliveries: [], ignored: 1 });
    expect(parseWebhook(inbound([{ text: 'x' }], { phoneNumberId: '999999' }), config)).toEqual({ messages: [], deliveries: [], ignored: 1 });
    expect(parseWebhook({ object: 'page', entry: [] }, config)).toBeNull();
    expect(parseWebhook(inbound([{ id: 'bad id with spaces', text: 'x' }]), config)!.messages).toEqual([]);
    expect(BUSINESS_ACCOUNT_ID).toMatch(/^[0-9]+$/);
  });

  it('normalizes delivery statuses with the echoed correlation id and closed error codes', () => {
    const { config } = setup();
    const parsed = parseWebhook(statuses([{ id: 'wamid.S1', status: 'sent', correlation: 'cho_abcdefghijklmnopqrstuvwxyz' }, { id: 'wamid.S2', status: 'failed', error: 131047 },
      { id: 'wamid.S3', status: 'deleted' }]), config)!;
    expect(parsed.deliveries).toEqual([
      { channel: 'WHATSAPP', providerMessageId: 'wamid.S1', status: 'SENT', correlationId: 'cho_abcdefghijklmnopqrstuvwxyz', errorCode: null },
      { channel: 'WHATSAPP', providerMessageId: 'wamid.S2', status: 'FAILED', correlationId: null, errorCode: 'PROVIDER_131047' }]);
    expect(parsed.ignored).toBe(1);
  });
});

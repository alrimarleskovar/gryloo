// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: outbound rendering within WhatsApp's documented limits, the closed classification of provider answers, and the
 * live Graph transport exercised only against a fake `fetch` (one fixed host, the token only in the Authorization header, no
 * redirects, bounded time and size). The fixture transport never calls `fetch`.
 */
import { describe, expect, it, vi } from 'vitest';
import { outputSafe } from '../core/delivery.ts';
import { createWhatsAppAdapter } from './adapter.ts';
import { choicesFitButtons, renderMessage } from './render.ts';
import { classifyResponse, fixtureTransport, graphTransport } from './transport.ts';

const BSUID = { kind: 'bsuid', value: 'BR.FLOFITESTUSER0001' }, PHONE = { kind: 'phone', value: '5511900000001' };
const LINK = 'http://127.0.0.1:3100/approve#flofi_chs_' + 'A'.repeat(43);

describe('BUILD-CHANNELS-001 WhatsApp outbound', () => {
  it('renders the approval reply as a CTA URL message correlated by outbox id, addressed by BSUID', () => {
    const body = renderMessage(BSUID, { text: 'Strategy ready', choices: [], link: { label: 'Open FloFi', url: LINK } }, 'cho_abcdefghijklmnopqrstuvwxyz');
    expect(body).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', recipient: 'BR.FLOFITESTUSER0001', biz_opaque_callback_data: 'cho_abcdefghijklmnopqrstuvwxyz',
      type: 'interactive', interactive: { type: 'cta_url', body: { text: 'Strategy ready' }, action: { name: 'cta_url', parameters: { display_text: 'Open FloFi', url: LINK } } } });
  });

  it('uses reply buttons only within the limits, and plain text with previews off otherwise', () => {
    const buttons = renderMessage(PHONE, { text: 'Which network?', choices: [{ id: 'c1', label: 'Base Sepolia' }], link: null }, 'cho_x') as Record<string, unknown>;
    expect(buttons).toMatchObject({ to: '5511900000001', type: 'interactive', interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id: 'c1', title: 'Base Sepolia' } }] } } });
    expect(choicesFitButtons([{ id: 'c1', label: 'Supply 100 USDC · Aave V3 (composition)' }])).toBe(false);
    expect(choicesFitButtons(['a', 'b', 'c', 'd'].map(id => ({ id, label: id })))).toBe(false);
    const long = renderMessage(PHONE, { text: 'x'.repeat(5_000), choices: [], link: null }, 'cho_x') as { text: { body: string; preview_url: boolean } };
    expect(long.text.body.length).toBe(4_096);
    expect(long.text.preview_url).toBe(false);
  });

  it('refuses unsafe outbound text: calldata-sized hex, serialized blobs, credentials or an approval secret outside the link', () => {
    const origin = 'http://127.0.0.1:3100', safe = { text: 'Supply 100 USDC · bundle 0x1234…abcd', choices: [], link: { label: 'Open FloFi', url: LINK } };
    expect(outputSafe(safe, origin)).toBe(true);
    for (const text of ['0x' + 'ab'.repeat(40), 'A'.repeat(220), 'token flofi_at_abc', 'Authorization: Bearer abc', `copy ${LINK.split('#')[1]}`])
      expect(outputSafe({ ...safe, text }, origin), text.slice(0, 20)).toBe(false);
    expect(outputSafe({ ...safe, link: { label: 'Open', url: 'https://evil.test/approve#flofi_chs_' + 'A'.repeat(43) } }, origin)).toBe(false);
  });

  it('classifies provider answers into closed, retry-aware codes', () => {
    expect(classifyResponse({ status: 200, body: JSON.stringify({ messages: [{ id: 'wamid.OK' }] }) })).toEqual({ ok: true, providerMessageId: 'wamid.OK' });
    const error = (status: number, code: number) => classifyResponse({ status, body: JSON.stringify({ error: { code, message: 'x' } }) });
    expect(error(400, 131047)).toEqual({ ok: false, code: 'PROVIDER_WINDOW_CLOSED', retryable: false });
    expect(error(400, 368)).toEqual({ ok: false, code: 'PROVIDER_POLICY_RESTRICTED', retryable: false });
    expect(error(401, 190)).toEqual({ ok: false, code: 'PROVIDER_AUTHORIZATION', retryable: false });
    expect(error(400, 130429)).toEqual({ ok: false, code: 'PROVIDER_THROTTLED', retryable: true });
    expect(classifyResponse({ status: 429, body: '' })).toEqual({ ok: false, code: 'PROVIDER_THROTTLED', retryable: true });
    expect(classifyResponse({ status: 503, body: '' })).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(classifyResponse({ status: 200, body: '{}' })).toEqual({ ok: false, code: 'PROVIDER_RESPONSE_INVALID', retryable: false });
  });

  it('sends through the fixture transport without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'), transport = fixtureTransport(), adapter = createWhatsAppAdapter('106540352242922', transport);
    const result = await adapter.send(BSUID, { text: 'hello', choices: [], link: null }, 'cho_abcdefghijklmnopqrstuvwxyz');
    expect(result).toMatchObject({ ok: true, providerMessageId: expect.stringMatching(/^wamid\.FIXTURE/) });
    expect(transport.sent).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(adapter).toMatchObject({ channel: 'WHATSAPP', clientId: 'whatsapp:106540352242922', displayName: 'WhatsApp', windowHours: 24 });
  });

  it('keeps the live transport to one host, the token in the header only, no redirects and bounded answers (fake fetch only)', async () => {
    const token = 'T'.repeat(48), calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ messages: [{ id: 'wamid.LIVE' }] }), { status: 200 }); }) as unknown as typeof fetch;
    const send = graphTransport({ accessToken: token, graphVersion: 'v26.0', phoneNumberId: '106540352242922' }, fake);
    expect(classifyResponse(await send({ body: { messaging_product: 'whatsapp' } }))).toEqual({ ok: true, providerMessageId: 'wamid.LIVE' });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v26.0/106540352242922/messages');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(JSON.stringify(calls[0]!.init.body)).not.toContain(token);
    const slow = graphTransport({ accessToken: token, graphVersion: 'v26.0', phoneNumberId: '106540352242922', timeoutMs: 10 },
      (async (_: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' }))))) as unknown as typeof fetch);
    expect(await slow({ body: {} })).toEqual({ status: 504, body: '' });
    expect(() => graphTransport({ accessToken: token, graphVersion: 'latest', phoneNumberId: '1' })).toThrow('WHATSAPP_TRANSPORT_INVALID');
  });
});

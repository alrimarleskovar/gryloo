// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: outbound rendering within WhatsApp's documented limits (free-form inside the 24-hour window, the approved
 * template outside it), the closed classification of provider answers into Channel Core's failure classes, and the live Graph
 * transport exercised only against a fake `fetch` (one fixed host, the token only in the Authorization header, no redirects, bounded
 * time and size, network failures split into certainly-not-sent and maybe-sent). The fixture transport never calls `fetch`.
 */
import { describe, expect, it, vi } from 'vitest';
import { outputSafe } from '../core/delivery.ts';
import { createWhatsAppAdapter } from './adapter.ts';
import { choicesFitButtons, renderMessage, renderTemplate } from './render.ts';
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

  it('classifies provider answers into closed failure classes', () => {
    const answer = (status: number, body: string, retryAfterMs: number | null = null) => classifyResponse({ kind: 'ANSWER', status, body, retryAfterMs });
    const fail = (code: string, failure: string, retryAfterMs: number | null = null) => ({ ok: false, code, failure, retryAfterMs });
    expect(answer(200, JSON.stringify({ messages: [{ id: 'wamid.OK' }] }))).toEqual({ ok: true, providerMessageId: 'wamid.OK' });
    const error = (status: number, code: number) => answer(status, JSON.stringify({ error: { code, message: 'x' } }));
    expect(error(400, 131047)).toEqual(fail('PROVIDER_WINDOW_CLOSED', 'PERMANENT'));
    expect(error(400, 368)).toEqual(fail('PROVIDER_POLICY_RESTRICTED', 'PERMANENT'));
    expect(error(401, 190)).toEqual(fail('PROVIDER_AUTHORIZATION', 'PERMANENT'));
    expect(error(400, 132001)).toEqual(fail('PROVIDER_TEMPLATE_INVALID', 'PERMANENT'));
    expect(error(400, 100)).toEqual(fail('PROVIDER_REJECTED', 'PERMANENT'));
    expect(error(400, 130429)).toEqual(fail('PROVIDER_THROTTLED', 'RATE_LIMITED'));
    expect(error(400, 131056)).toEqual(fail('PROVIDER_THROTTLED', 'RATE_LIMITED'));
    expect(answer(429, '', 30_000)).toEqual(fail('PROVIDER_THROTTLED', 'RATE_LIMITED', 30_000));
    expect(error(500, 131000)).toEqual(fail('PROVIDER_UNAVAILABLE', 'TRANSIENT'));
    expect(error(503, 2)).toEqual(fail('PROVIDER_UNAVAILABLE', 'TRANSIENT'));
    // Meta may have taken these: never resent; its status webhook confirms them.
    expect(answer(502, '<html>bad gateway</html>')).toEqual(fail('PROVIDER_GATEWAY_ERROR', 'UNCERTAIN'));
    expect(answer(200, '{}')).toEqual(fail('PROVIDER_RESPONSE_INVALID', 'UNCERTAIN'));
    expect(classifyResponse({ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' })).toEqual(fail('PROVIDER_TIMEOUT', 'UNCERTAIN'));
    expect(classifyResponse({ kind: 'NOT_SENT', code: 'PROVIDER_UNREACHABLE' })).toEqual(fail('PROVIDER_UNREACHABLE', 'TRANSIENT'));
  });

  it('renders a notification outside the window as the approved template (one plain variable, no link), and nothing else', async () => {
    const template = { name: 'flofi_status_update', language: 'en_US' };
    const body = renderTemplate(PHONE, { text: 'Execution reconciled ✅\n  evidence:\tMOCKED    · bundle 0x1234…abcd', choices: [], link: null }, 'cho_t', template);
    expect(body).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511900000001', biz_opaque_callback_data: 'cho_t', type: 'template',
      template: { name: 'flofi_status_update', language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text',
        text: 'Execution reconciled ✅ · evidence: MOCKED · bundle 0x1234…abcd' }] }] } });
    const sent = fixtureTransport(), withTemplate = createWhatsAppAdapter('106540352242922', sent, template), without = createWhatsAppAdapter('106540352242922', fixtureTransport());
    const closed = { kind: 'NOTIFICATION', windowOpen: false } as const, reply = { text: 'Execution reconciled', choices: [], link: null };
    expect(withTemplate.outsideWindow).toEqual(['NOTIFICATION']);
    expect(await withTemplate.send(PHONE, reply, 'cho_t', closed)).toMatchObject({ ok: true });
    expect(sent.sent[0]!.body).toMatchObject({ type: 'template' });
    expect(without.outsideWindow).toEqual([]);
    expect(await without.send(PHONE, reply, 'cho_t', closed)).toEqual({ ok: false, code: 'PROVIDER_WINDOW_CLOSED', failure: 'PERMANENT', retryAfterMs: null });
    // A reply or an approval link never goes out through a template.
    expect(await withTemplate.send(PHONE, reply, 'cho_t', { kind: 'REPLY', windowOpen: false })).toMatchObject({ ok: false, code: 'PROVIDER_WINDOW_CLOSED' });
    expect(await withTemplate.send(PHONE, { ...reply, link: { label: 'Open', url: LINK } }, 'cho_t', closed)).toMatchObject({ ok: false, code: 'PROVIDER_WINDOW_CLOSED' });
    expect(sent.sent).toHaveLength(1);
  });

  it('sends through the fixture transport without any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'), transport = fixtureTransport(), adapter = createWhatsAppAdapter('106540352242922', transport);
    const result = await adapter.send(BSUID, { text: 'hello', choices: [], link: null }, 'cho_abcdefghijklmnopqrstuvwxyz', { kind: 'REPLY', windowOpen: true });
    expect(result).toMatchObject({ ok: true, providerMessageId: expect.stringMatching(/^wamid\.FIXTURE/) });
    expect(transport.sent).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(adapter).toMatchObject({ channel: 'WHATSAPP', clientId: 'whatsapp:106540352242922', displayName: 'WhatsApp', windowHours: 24, confirmsUncertainSends: true,
      deliveryReports: ['SENT', 'DELIVERED', 'READ', 'FAILED'] });
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
    expect(await slow({ body: {} })).toEqual({ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' });
    // A connection refused never reached Meta (safe to retry); a reset after connecting may have (never resent).
    const failing = (code: string) => graphTransport({ accessToken: token, graphVersion: 'v26.0', phoneNumberId: '106540352242922' },
      (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('x'), { code }) }); }) as unknown as typeof fetch);
    expect(await failing('ECONNREFUSED')({ body: {} })).toEqual({ kind: 'NOT_SENT', code: 'PROVIDER_UNREACHABLE' });
    expect(await failing('ECONNRESET')({ body: {} })).toEqual({ kind: 'UNCERTAIN', code: 'PROVIDER_CONNECTION_LOST' });
    const big = graphTransport({ accessToken: token, graphVersion: 'v26.0', phoneNumberId: '106540352242922' },
      (async () => new Response('x'.repeat(100), { status: 200, headers: { 'content-length': String(10 * 1024 * 1024), 'retry-after': '7' } })) as unknown as typeof fetch);
    expect(await big({ body: {} })).toEqual({ kind: 'ANSWER', status: 200, body: '', retryAfterMs: 7_000 });
    expect(() => graphTransport({ accessToken: token, graphVersion: 'latest', phoneNumberId: '1' })).toThrow('WHATSAPP_TRANSPORT_INVALID');
  });
});

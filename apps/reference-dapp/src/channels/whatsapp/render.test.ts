// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: outbound rendering within WhatsApp's documented limits (free-form inside the 24-hour window, the approved
 * template outside it), the closed classification of provider answers into Channel Core's failure classes, and the live Graph
 * transport exercised only against a fake `fetch` (one fixed host, the token only in the Authorization header, no redirects, bounded
 * time and size, network failures split into certainly-not-sent and maybe-sent). The fixture transport never calls `fetch`.
 */
import { describe, expect, it, vi } from 'vitest';
import { composeWorkflowOrRefuse } from '../../platform/strategy.ts';
import { workflowVisualModel } from '../../platform/workflow-visual.ts';
import { multipartParams } from '../telegram/fixtures.test-harness.ts';
import { outputSafe, visualSafe } from '../core/delivery.ts';
import type { ProviderHttpResult } from '../core/provider-http.ts';
import type { ChannelImage, SendContext } from '../core/types.ts';
import { createWhatsAppAdapter } from './adapter.ts';
import { choicesFitButtons, renderMessage, renderTemplate } from './render.ts';
import { classifyResponse, fixtureTransport, graphTransport, mediaIdOf, type FixtureRecord, type FixtureUpload, type WhatsAppTransport } from './transport.ts';

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

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 WhatsApp workflow picture', () => {
  const image: ChannelImage = { mimeType: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 120 }, (_, i) => i)]),
    alt: 'FloFi workflow: Supply.' };
  const reply = { text: 'Strategy ready:\n1. Supply 1 USDC · Aave V3 · Base Sepolia\nNothing is authorized yet.', choices: [], link: { label: 'Open FloFi', url: LINK } };
  const approval: SendContext = { kind: 'APPROVAL', windowOpen: true, image };
  const ok = (id: string): ProviderHttpResult => ({ kind: 'ANSWER', status: 200, retryAfterMs: null, body: JSON.stringify({ messages: [{ id }] }) });
  const error = (status: number, code: number): ProviderHttpResult => ({ kind: 'ANSWER', status, retryAfterMs: null, body: JSON.stringify({ error: { code } }) });
  /** A `/media` answer: the uploaded picture's id. */
  const media = (id: string): ProviderHttpResult => ({ kind: 'ANSWER', status: 200, retryAfterMs: null, body: JSON.stringify({ id }) });
  /** A transport whose messages and uploads answer as scripted, recording every call. */
  function scripted(message: (body: Record<string, unknown>) => ProviderHttpResult, upload: (() => ProviderHttpResult | Promise<ProviderHttpResult>) | null) {
    const bodies: Record<string, unknown>[] = [];
    let uploads = 0;
    const transport: WhatsAppTransport = Object.assign(async ({ body }: { readonly body: Record<string, unknown> }) => { bodies.push(body); return message(body); },
      upload ? { upload: async () => { uploads++; return upload(); } } : {});
    return { transport, bodies, uploads: () => uploads };
  }
  const header = (body: Record<string, unknown>) => (body.interactive as { header?: unknown } | undefined)?.header ?? null;

  it('renders the uploaded picture as the header of the same interactive message (a media id, never a URL)', () => {
    const cta = renderMessage(BSUID, reply, 'cho_v', '9000000000000000000') as { interactive: Record<string, unknown> };
    expect(cta.interactive).toEqual({ type: 'cta_url', header: { type: 'image', image: { id: '9000000000000000000' } }, body: { text: reply.text },
      action: { name: 'cta_url', parameters: { display_text: 'Open FloFi', url: LINK } } });
    expect((renderMessage(PHONE, { text: 'Which?', choices: [{ id: 'c1', label: 'Base' }], link: null }, 'cho_v', '9') as { interactive: Record<string, unknown> })
      .interactive.header).toEqual({ type: 'image', image: { id: '9' } });
    expect(renderMessage(PHONE, { text: 'Proposal', choices: [], link: null }, 'cho_v', '9')).toMatchObject({ type: 'image', image: { id: '9', caption: 'Proposal' } });
    expect(renderMessage(PHONE, { text: 'x'.repeat(1_025), choices: [], link: null }, 'cho_v', '9')).toMatchObject({ type: 'text' });
    expect(JSON.stringify(cta)).not.toMatch(/https?:\/\/(?!127\.0\.0\.1:3100\/approve#)/);
  });

  it('uploads the PNG, then sends the approval message with it — same text, same Open FloFi button, nothing over the network (fixture)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch'), sent: FixtureRecord[] = [], uploads: FixtureUpload[] = [];
    const adapter = createWhatsAppAdapter('106540352242922', fixtureTransport(sent, uploads));
    expect(await adapter.send(BSUID, reply, 'cho_v', approval)).toMatchObject({ ok: true, providerMessageId: expect.stringMatching(/^wamid\.FIXTURE/) });
    expect(uploads.map(u => [u.mimeType, Buffer.compare(Buffer.from(u.bytes), Buffer.from(image.bytes))])).toEqual([['image/png', 0]]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ biz_opaque_callback_data: 'cho_v', type: 'interactive', interactive: { type: 'cta_url',
      header: { type: 'image', image: { id: uploads[0]!.mediaId } }, body: { text: reply.text }, action: { parameters: { display_text: 'Open FloFi', url: LINK } } } });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sends the text message instead when there is no picture, the transport cannot upload, the upload fails or Meta rejects the picture', async () => {
    const plain = scripted(() => ok('wamid.T'), () => media('9000'));
    await createWhatsAppAdapter('106540352242922', plain.transport).send(BSUID, reply, 'cho_v', { kind: 'APPROVAL', windowOpen: true });
    expect([plain.uploads(), plain.bodies.map(header)]).toEqual([0, [null]]);
    const noUpload = scripted(() => ok('wamid.T'), null);
    await createWhatsAppAdapter('106540352242922', noUpload.transport).send(BSUID, reply, 'cho_v', approval);
    expect(noUpload.bodies.map(header)).toEqual([null]);
    for (const failure of [() => error(400, 131053), () => ({ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' }) as ProviderHttpResult, () => ok('x'),
      () => { throw new Error('boom'); }]) {
      const failed = scripted(() => ok('wamid.T'), failure);
      expect(await createWhatsAppAdapter('106540352242922', failed.transport).send(BSUID, reply, 'cho_v', approval)).toEqual({ ok: true, providerMessageId: 'wamid.T' });
      expect(failed.bodies.map(header)).toEqual([null]);
    }
    const rejected = scripted(body => header(body) ? error(400, 100) : ok('wamid.T'), () => media('9001'));
    expect(await createWhatsAppAdapter('106540352242922', rejected.transport).send(BSUID, reply, 'cho_v', approval)).toEqual({ ok: true, providerMessageId: 'wamid.T' });
    expect(rejected.bodies.map(b => [header(b) !== null, (b.interactive as { body: { text: string } }).body.text, b.biz_opaque_callback_data]))
      .toEqual([[true, reply.text, 'cho_v'], [false, reply.text, 'cho_v']]);
  });

  it('keeps every other outcome\'s class (throttled, unavailable, window closed, policy, uncertain): never resent without the picture', async () => {
    const cases: [ProviderHttpResult, Record<string, unknown>][] = [[error(429, 130429), { failure: 'RATE_LIMITED' }], [error(500, 131000), { failure: 'TRANSIENT' }],
      [error(400, 131047), { failure: 'PERMANENT', code: 'PROVIDER_WINDOW_CLOSED' }], [error(400, 368), { failure: 'PERMANENT', code: 'PROVIDER_POLICY_RESTRICTED' }],
      [{ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' }, { failure: 'UNCERTAIN' }], [ok(''), { failure: 'UNCERTAIN', code: 'PROVIDER_RESPONSE_INVALID' }]];
    for (const [answer, expected] of cases) {
      const t = scripted(() => answer, () => media('9002'));
      expect(await createWhatsAppAdapter('106540352242922', t.transport).send(BSUID, reply, 'cho_v', approval)).toMatchObject({ ok: false, ...expected });
      expect(t.bodies.map(header)).toEqual([{ type: 'image', image: { id: '9002' } }]);
    }
  });

  it('outside the 24-hour window sends only the approved template for a notification: no upload, no picture, never an approval', async () => {
    const template = { name: 'flofi_status_update', language: 'en_US' }, t = scripted(() => ok('wamid.T'), () => media('9003'));
    const adapter = createWhatsAppAdapter('106540352242922', t.transport, template);
    await adapter.send(BSUID, { text: 'Execution reconciled', choices: [], link: null }, 'cho_n', { kind: 'NOTIFICATION', windowOpen: false, image });
    expect(await adapter.send(BSUID, reply, 'cho_v', { ...approval, windowOpen: false })).toMatchObject({ ok: false, code: 'PROVIDER_WINDOW_CLOSED' });
    expect([t.uploads(), t.bodies.map(b => b.type)]).toEqual([0, ['template']]);
  });

  it('uploads through the live transport as multipart bytes to /media, the token in the header only (fake fetch only)', async () => {
    const token = 'T'.repeat(48), calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: '1234567890' }), { status: 200 }); }) as unknown as typeof fetch;
    const transport = graphTransport({ accessToken: token, graphVersion: 'v26.0', phoneNumberId: '106540352242922' }, fake);
    expect(mediaIdOf(await transport.upload!({ mimeType: 'image/png', bytes: image.bytes }))).toBe('1234567890');
    const { url, init } = calls[0]!, headers = init.headers as Record<string, string>;
    expect([url, init.method, init.redirect, headers.authorization]).toEqual(['https://graph.facebook.com/v26.0/106540352242922/media', 'POST', 'error', `Bearer ${token}`]);
    const params = multipartParams(init.body as Uint8Array, headers['content-type']!);
    expect(params).toMatchObject({ messaging_product: 'whatsapp', type: 'image/png', file: { filename: 'flofi-workflow.png', mimeType: 'image/png' } });
    expect(Buffer.compare((params.file as { bytes: Buffer }).bytes, Buffer.from(image.bytes))).toBe(0);
    expect(Buffer.from(init.body as Uint8Array).toString('latin1')).not.toContain(token);
    expect([mediaIdOf(error(400, 100)), mediaIdOf({ kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' }), mediaIdOf({ kind: 'ANSWER', status: 200, retryAfterMs: null,
      body: JSON.stringify({ id: 'https://evil.test/x' }) })]).toEqual([null, null, null]);
  });

  it('guards a reply\'s picture like its text: no full address, link, secret or blob reaches a picture', () => {
    const model = workflowVisualModel(composeWorkflowOrRefuse({ action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC',
      amount: '5', recipient: '0x1111111111111111111111111111111111111111' }, undefined));
    expect(visualSafe({ model, language: 'EN' })).toBe(true);
    const step = model.steps[0]!, tampered = (patch: Record<string, unknown>) => visualSafe({ model: { ...model, steps: [{ ...step, ...patch }] }, language: 'PT' });
    expect(tampered({ provider: 'https://evil.test' })).toBe(false);
    expect(tampered({ provider: LINK.split('#')[1] })).toBe(false);
    expect(tampered({ network: '0x' + 'ab'.repeat(40) })).toBe(false);
    expect(tampered({ toAsset: 'A'.repeat(220) })).toBe(false);
    expect(visualSafe({ model: { ...model, steps: [] }, language: 'EN' })).toBe(false);
    expect(visualSafe({ model: { ...model, workflowHash: 'not-a-hash' }, language: 'EN' })).toBe(false);
  });
});

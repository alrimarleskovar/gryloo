// SPDX-License-Identifier: Apache-2.0
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FloFiWebhookError, verifyWebhook } from '../src/index.js';

const secret = () => 'whsec_' + randomBytes(32).toString('base64');
/** Standard Webhooks signing, as FloFi does it (an independent implementation on node:crypto). */
function signed(key: string, body: string, timestamp = Math.floor(Date.now() / 1000), id = 'evt_' + 'a'.repeat(26)) {
  const signature = createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${signature}` };
}
const EVENT = JSON.stringify({ id: 'evt_' + 'a'.repeat(26), object: 'event', type: 'approval.claimed', apiVersion: 'v1', environment: 'sandbox',
  createdAt: '2026-10-07T00:00:00.000Z', data: { approvalId: 'apr_x' } });
const code = async (work: Promise<unknown>) => { try { await work; return 'VERIFIED'; } catch (e) { return e instanceof FloFiWebhookError ? e.code : 'UNEXPECTED'; } };

describe('FloFi Developer SDK webhook verification', () => {
  it('verifies FloFi\'s Standard Webhooks signature over the raw body and returns the event', async () => {
    const key = secret(), headers = signed(key, EVENT);
    expect(await verifyWebhook({ payload: EVENT, headers, secret: key })).toMatchObject({ id: 'evt_' + 'a'.repeat(26), type: 'approval.claimed', data: { approvalId: 'apr_x' } });
    expect((await verifyWebhook({ payload: new TextEncoder().encode(EVENT), headers: new Headers(headers), secret: key })).type).toBe('approval.claimed');
    // Node's IncomingHttpHeaders shape, with mixed-case names.
    expect((await verifyWebhook({ payload: EVENT, headers: { 'Webhook-Id': headers['webhook-id'], 'webhook-timestamp': [headers['webhook-timestamp']],
      'WEBHOOK-SIGNATURE': `v1,AAAA ${headers['webhook-signature']}` }, secret: key })).id).toBe('evt_' + 'a'.repeat(26));
  });

  it('refuses tampered bodies, wrong secrets, stale or future timestamps and missing headers', async () => {
    const key = secret(), headers = signed(key, EVENT);
    expect(await code(verifyWebhook({ payload: EVENT.replace('apr_x', 'apr_y'), headers, secret: key }))).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await code(verifyWebhook({ payload: EVENT, headers, secret: secret() }))).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await code(verifyWebhook({ payload: EVENT, headers: { ...headers, 'webhook-timestamp': String(Number(headers['webhook-timestamp']) + 1) }, secret: key })))
      .toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await code(verifyWebhook({ payload: EVENT, headers: { ...headers, 'webhook-id': 'evt_' + 'b'.repeat(26) }, secret: key }))).toBe('WEBHOOK_SIGNATURE_INVALID');
    const old = signed(key, EVENT, Math.floor(Date.now() / 1000) - 301), future = signed(key, EVENT, Math.floor(Date.now() / 1000) + 301);
    expect(await code(verifyWebhook({ payload: EVENT, headers: old, secret: key }))).toBe('WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
    expect(await code(verifyWebhook({ payload: EVENT, headers: future, secret: key }))).toBe('WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
    expect(await code(verifyWebhook({ payload: EVENT, headers: old, secret: key, toleranceSeconds: 600 }))).toBe('VERIFIED');
    expect(await code(verifyWebhook({ payload: EVENT, headers: { ...headers, 'webhook-timestamp': 'soon' }, secret: key }))).toBe('WEBHOOK_TIMESTAMP_INVALID');
    expect(await code(verifyWebhook({ payload: EVENT, headers: { 'webhook-id': headers['webhook-id'] }, secret: key }))).toBe('WEBHOOK_HEADERS_MISSING');
    expect(await code(verifyWebhook({ payload: EVENT, headers, secret: 'not-a-secret' }))).toBe('WEBHOOK_SECRET_INVALID');
    expect(await code(verifyWebhook({ payload: EVENT, headers, secret: [] }))).toBe('WEBHOOK_SECRET_INVALID');
    // A correctly signed body that is not this event is refused too.
    const other = JSON.stringify({ ...JSON.parse(EVENT), id: 'evt_' + 'c'.repeat(26) });
    expect(await code(verifyWebhook({ payload: other, headers: signed(key, other), secret: key }))).toBe('WEBHOOK_PAYLOAD_INVALID');
  });

  it('accepts either secret during a rotation', async () => {
    const before = secret(), after = secret();
    for (const key of [before, after]) expect(await code(verifyWebhook({ payload: EVENT, headers: signed(key, EVENT), secret: [before, after] }))).toBe('VERIFIED');
    expect(await code(verifyWebhook({ payload: EVENT, headers: signed(secret(), EVENT), secret: [before, after] }))).toBe('WEBHOOK_SIGNATURE_INVALID');
  });
});

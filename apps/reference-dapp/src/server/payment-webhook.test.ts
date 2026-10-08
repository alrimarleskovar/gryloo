// SPDX-License-Identifier: AGPL-3.0-only
// Woovi webhooks reach a payment run only with a valid signature, and then only as a hint to re-read Woovi's own record.
// Disposable key pairs and fake endpoints only: no network, no credentials, no money.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV, fakeWoovi, NOW, OWNER, request } from '../test-utils/woovi-fake';

type Webhook = typeof import('./payment-webhook');
let webhook: Webhook;
beforeEach(async () => { vi.resetModules(); webhook = await import('./payment-webhook'); });
afterEach(() => { vi.unstubAllGlobals(); });

const LIVE = { ...ENV, GRYLOO_PAYMENT: 'live' };
const CORRELATION = `flofi-${'7'.repeat(48)}`, RUN = `pay-${'5'.repeat(32)}`;
const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = (key: KeyObject) => key.export({ type: 'spki', format: 'pem' }).toString();
const signed = (body: string, key: KeyObject) => sign('RSA-SHA256', Buffer.from(body), key).toString('base64');
const payoutEvent = (correlationID = CORRELATION) => JSON.stringify({ event: 'STABLECOIN_PAYOUT_COMPLETED', stablePayout: { correlationID, status: 'COMPLETED' } });
/** Woovi's published webhook keys endpoint; every other route is unexpected here. */
function keysEndpoint(keys: readonly KeyObject[], status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname !== '/api/v1/webhook/public-keys') throw new Error(`unexpected ${url.pathname}`);
    return new Response(JSON.stringify({ public_keys: keys.map(key => ({ key: pem(key) })) }), { status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
function locator(run: string | null = RUN) {
  const seen: string[] = [];
  return { seen, value: { runForOrder: async (id: string) => { seen.push(`find ${id}`); return run; },
    observe: async (id: string) => { seen.push(`observe ${id}`); return { state: 'PAYMENT_SETTLED' }; } } };
}
const receive = (body: string, signature: string | null, options: { env?: Record<string, string>; fetchImpl: typeof fetch; locate?: ReturnType<typeof locator> }) =>
  webhook.receiveWooviWebhook({ rawBody: body, signature, env: options.env ?? LIVE, fetchImpl: options.fetchImpl,
    locator: async () => (options.locate ?? locator()).value });

describe('Woovi payout webhooks', () => {
  it('refuses unsigned and wrongly signed requests before any run is looked up', async () => {
    const woovi = pair(), attacker = pair(), keys = keysEndpoint([woovi.publicKey]), runs = locator();
    const body = payoutEvent();
    expect(await receive(body, null, { fetchImpl: keys.fetchImpl, locate: runs })).toEqual({ status: 401, code: 'WEBHOOK_SIGNATURE_INVALID' });
    expect(await receive(body, signed(body, attacker.privateKey), { fetchImpl: keys.fetchImpl, locate: runs })).toEqual({ status: 401, code: 'WEBHOOK_SIGNATURE_INVALID' });
    // A body altered after signing fails too.
    expect(await receive(payoutEvent(`flofi-${'8'.repeat(48)}`), signed(body, woovi.privateKey), { fetchImpl: keys.fetchImpl, locate: runs }))
      .toEqual({ status: 401, code: 'WEBHOOK_SIGNATURE_INVALID' });
    expect(runs.seen).toEqual([]);
  });

  it('only re-reads the named FloFi payout after a valid signature', async () => {
    const woovi = pair(), keys = keysEndpoint([woovi.publicKey]), runs = locator();
    const body = payoutEvent();
    expect(await receive(body, signed(body, woovi.privateKey), { fetchImpl: keys.fetchImpl, locate: runs }))
      .toEqual({ status: 200, code: 'WEBHOOK_OBSERVED', state: 'PAYMENT_SETTLED' });
    expect(runs.seen).toEqual([`find ${CORRELATION}`, `observe ${RUN}`]);

    const other = JSON.stringify({ event: 'OPENPIX:CHARGE_COMPLETED', charge: { correlationID: CORRELATION } }), quiet = locator();
    expect(await receive(other, signed(other, woovi.privateKey), { fetchImpl: keys.fetchImpl, locate: quiet })).toEqual({ status: 200, code: 'WEBHOOK_IGNORED' });
    const unknown = locator(null);
    expect(await receive(body, signed(body, woovi.privateKey), { fetchImpl: keys.fetchImpl, locate: unknown })).toEqual({ status: 200, code: 'WEBHOOK_PAYOUT_UNKNOWN' });
    expect([quiet.seen, unknown.seen]).toEqual([[], [`find ${CORRELATION}`]]);
  });

  it('follows a key rotation with one refresh of the published keys', async () => {
    const old = pair(), rotated = pair(), body = payoutEvent();
    let published = [old.publicKey];
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => { calls.push(new URL(String(input)).pathname);
      return new Response(JSON.stringify({ public_keys: published.map(key => ({ key: pem(key) })) }), { status: 200 }); }) as typeof fetch;
    expect((await receive(body, signed(body, old.privateKey), { fetchImpl })).code).toBe('WEBHOOK_OBSERVED');
    published = [rotated.publicKey];
    expect((await receive(body, signed(body, rotated.privateKey), { fetchImpl })).code).toBe('WEBHOOK_OBSERVED');
    expect(calls).toHaveLength(2);
  });

  it('fails closed when payments, the provider or its keys are unavailable', async () => {
    const woovi = pair(), body = payoutEvent(), signature = signed(body, woovi.privateKey), keys = keysEndpoint([woovi.publicKey]);
    expect(await receive(body, signature, { env: ENV, fetchImpl: keys.fetchImpl })).toEqual({ status: 503, code: 'PAYMENT_NOT_ENABLED' });
    expect(await receive(body, signature, { env: { GRYLOO_PAYMENT: 'live' }, fetchImpl: keys.fetchImpl })).toEqual({ status: 503, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    expect(await receive(body, signature, { fetchImpl: keysEndpoint([], 500).fetchImpl })).toEqual({ status: 503, code: 'WEBHOOK_KEYS_UNAVAILABLE' });
    expect(await receive('x'.repeat(webhook.WOOVI_WEBHOOK_MAX_BYTES + 1), signature, { fetchImpl: keys.fetchImpl })).toEqual({ status: 413, code: 'WEBHOOK_TOO_LARGE' });
    const failing = { runForOrder: async () => RUN, observe: async () => { throw new Error('WOOVI_UNREACHABLE'); } };
    expect(await webhook.receiveWooviWebhook({ rawBody: body, signature, env: LIVE, fetchImpl: keys.fetchImpl, locator: async () => failing }))
      .toEqual({ status: 503, code: 'PAYMENT_OBSERVATION_UNAVAILABLE' });
    expect(keys.calls.every(path => path === '/api/v1/webhook/public-keys')).toBe(true);
  });

  it('defers to the runtime that owns the runs and refuses an unconfigured hosted deployment', async () => {
    expect(await webhook.paymentRunLocator({ API_BASE_URL: 'https://api.flofi.example' })).toEqual({ status: 202, code: 'WEBHOOK_DEFERRED_TO_RUNTIME' });
    expect(await webhook.paymentRunLocator({ VERCEL: '1' })).toEqual({ status: 503, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
    expect(await webhook.paymentRunLocator({})).toEqual({ status: 503, code: 'PAYMENT_STORAGE_NOT_CONFIGURED' });
  });

  it('maps a verified payout event to its run through the begin index on the local runtime', async () => {
    // The run is created by the real service on the same journal the webhook's locator opens.
    const { createPaymentFlowService } = await import('./payment-flow-service');
    const dir = mkdtempSync(join(tmpdir(), 'flofi-payment-webhook-')), fake = fakeWoovi();
    const service = createPaymentFlowService({ journalDir: dir, rpc: async method => method === 'eth_chainId' ? '0x2105' : null, adapters: fake.adapters,
      provenance: 'PROVIDER_SANDBOX', executionEnabled: true, now: () => NOW * 1000 });
    const simulated = await service.simulate(request(), OWNER.address);
    await service.review(simulated.id, simulated.commitment);
    const { record } = await service.begin(simulated.id, OWNER.address);
    const woovi = pair(), body = payoutEvent(record.attempt!.order.providerOrderId);
    // The locator's own service reads Base and Woovi through `fetch`: only the keys endpoint and an empty receipt are served.
    vi.stubGlobal('fetch', (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/webhook/public-keys') return new Response(JSON.stringify({ public_keys: [{ key: pem(woovi.publicKey) }] }), { status: 200 });
      const call = JSON.parse(String(init?.body)) as { method: string };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: call.method === 'eth_chainId' ? '0x2105' : null }), { status: 200 });
    }) as typeof fetch);
    const env = { ...LIVE, GRYLOO_PAYMENT_JOURNAL: dir };
    const outcome = await webhook.receiveWooviWebhook({ rawBody: body, signature: signed(body, woovi.privateKey), env, locator: () => webhook.paymentRunLocator(env) });
    // The run has no reported source transaction yet, so observation changes nothing: the webhook cannot advance it.
    expect(outcome).toEqual({ status: 200, code: 'WEBHOOK_OBSERVED', state: 'AUTHORIZED' });
    expect((await service.load(simulated.id)).state).toBe('AUTHORIZED');
  });
});

// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FloFi, FloFiError } from '../src/index.js';

const KEY = 'flofi_sk_test_' + 'A'.repeat(43);
type Seen = { url: string; method: string; headers: Record<string, string>; body: string | null; redirect: string | undefined };
/** A scripted fetch: answers in order and records every request. */
function scripted(...answers: (Response | Error)[]) {
  const seen: Seen[] = [];
  const fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    seen.push({ url: String(input), method: String(init?.method), headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : null, redirect: init?.redirect });
    const next = answers.shift();
    if (!next) throw new Error('UNEXPECTED_REQUEST');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof globalThis.fetch;
  return { seen, fetch };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const failure = (status: number, code: string, reason = code, headers: Record<string, string> = {}) =>
  json(status, { error: { code, reason, message: 'm', requestId: 'req_x', issues: [{ path: '/strategy', rule: 'required' }] } }, headers);
const client = (fetch: typeof globalThis.fetch, extra: Partial<ConstructorParameters<typeof FloFi>[0]> = {}) =>
  new FloFi({ apiKey: KEY, baseUrl: 'https://flofi.example', fetch, maxRetryDelayMs: 50, ...extra });

describe('FloFi Developer SDK client', () => {
  it('sends typed requests with the key as a bearer, to the v1 paths, refusing redirects', async () => {
    const { seen, fetch } = scripted(json(200, { object: 'list', data: [] }), json(201, { id: 'str_1', workflowHash: '0xab' }), json(200, { object: 'strategy_validation' }),
      json(200, { object: 'simulation' }), json(201, { id: 'apr_1' }), json(200, { id: 'apr_1' }), json(200, { id: 'run-1' }), json(200, { object: 'evidence' }),
      json(201, { id: 'whe_1' }), json(200, { deleted: true }));
    const flofi = client(fetch);
    await flofi.capabilities.list({ network: 'base-sepolia' });
    const strategy = await flofi.strategies.create({ strategy: { action: 'bridge' } });
    await flofi.strategies.validate('str_1');
    await flofi.strategies.simulate('str_1', { simulationSubject: '0x' + '1'.repeat(40) });
    await flofi.approvals.create({ strategy: { id: strategy.id, workflowHash: strategy.workflowHash } });
    await flofi.approvals.get('apr_1');
    await flofi.executions.get('run/../1');
    await flofi.executions.evidence('run-1');
    await flofi.webhookEndpoints.create({ url: 'https://hooks.example.com/x' });
    await flofi.webhookEndpoints.delete('whe_1');
    expect(seen.map(s => `${s.method} ${s.url}`)).toEqual([
      'GET https://flofi.example/api/developer/v1/capabilities?network=base-sepolia', 'POST https://flofi.example/api/developer/v1/strategies',
      'POST https://flofi.example/api/developer/v1/strategies/str_1/validate', 'POST https://flofi.example/api/developer/v1/strategies/str_1/simulate',
      'POST https://flofi.example/api/developer/v1/approvals', 'GET https://flofi.example/api/developer/v1/approvals/apr_1',
      'GET https://flofi.example/api/developer/v1/executions/run%2F..%2F1', 'GET https://flofi.example/api/developer/v1/executions/run-1/evidence',
      'POST https://flofi.example/api/developer/v1/webhook-endpoints', 'DELETE https://flofi.example/api/developer/v1/webhook-endpoints/whe_1']);
    expect(seen.every(s => s.headers.authorization === `Bearer ${KEY}` && s.redirect === 'error' && !('origin' in s.headers))).toBe(true);
    expect(JSON.parse(seen[4]!.body!)).toEqual({ strategyId: 'str_1', workflowHash: '0xab' });
    // Creating POSTs carry an idempotency key; reads, validation and simulation do not.
    expect(seen.map(s => s.headers['idempotency-key'] !== undefined)).toEqual([false, true, false, false, true, false, false, false, true, false]);
    expect(seen[1]!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('retries only safe requests, reusing the idempotency key and honouring Retry-After', async () => {
    const a = scripted(new TypeError('socket hang up'), failure(503, 'SERVICE_UNAVAILABLE', 'SIMULATION_BUSY', { 'retry-after': '0' }), json(201, { id: 'str_1' }));
    expect(await client(a.fetch).strategies.create({ strategy: {} }, { idempotencyKey: 'my-key-00000001' })).toEqual({ id: 'str_1' });
    expect(a.seen.map(s => s.headers['idempotency-key'])).toEqual(['my-key-00000001', 'my-key-00000001', 'my-key-00000001']);

    const b = scripted(failure(429, 'RATE_LIMITED', 'REQUESTS_PER_MINUTE', { 'retry-after': '0' }), json(200, { id: 'apr_1' }));
    expect(await client(b.fetch).approvals.get('apr_1')).toEqual({ id: 'apr_1' });
    // Validation and simulation are never retried by the client; a long Retry-After is returned, not waited for.
    const c = scripted(failure(503, 'SERVICE_UNAVAILABLE'));
    await expect(client(c.fetch).strategies.simulate('str_1', { simulationSubject: 'x' })).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(c.seen).toHaveLength(1);
    const d = scripted(failure(429, 'RATE_LIMITED', 'SIMULATIONS_PER_HOUR', { 'retry-after': '1800' }));
    await expect(client(d.fetch).approvals.get('apr_1')).rejects.toMatchObject({ code: 'RATE_LIMITED', reason: 'SIMULATIONS_PER_HOUR', retryAfter: 1800 });
    expect(d.seen).toHaveLength(1);
    const now = { 'retry-after': '0' }, e = scripted(failure(503, 'X', 'X', now), failure(503, 'X', 'X', now), failure(503, 'X', 'X', now), json(200, {}));
    await expect(client(e.fetch, { maxRetries: 2 }).approvals.get('apr_1')).rejects.toMatchObject({ status: 503 });
    expect(e.seen).toHaveLength(3);
    const f = scripted(failure(409, 'IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_IN_PROGRESS', { 'retry-after': '0' }), json(201, { id: 'whe_1' }));
    expect(await client(f.fetch).webhookEndpoints.create({ url: 'https://h.example.com/x' })).toEqual({ id: 'whe_1' });
  });

  it('surfaces FloFi\'s stable errors and its own: never a stack, never the key', async () => {
    const { fetch } = scripted(failure(409, 'STRATEGY_CHANGED', 'WORKFLOW_HASH_MISMATCH'), new Response('<html>', { status: 502 }), json(200, null as unknown as object),
      new Response('not json', { status: 200 }));
    const flofi = client(fetch, { maxRetries: 0 });
    const error = await flofi.approvals.create({ strategyId: 'str_1', workflowHash: '0x1' }).catch(e => e as FloFiError);
    expect(error).toBeInstanceOf(FloFiError);
    expect(error).toMatchObject({ status: 409, code: 'STRATEGY_CHANGED', reason: 'WORKFLOW_HASH_MISMATCH', requestId: 'req_x', issues: [{ path: '/strategy', rule: 'required' }] });
    expect(JSON.stringify(error) + String(error.message)).not.toContain(KEY);
    await expect(flofi.approvals.get('apr_1')).rejects.toMatchObject({ status: 502, code: 'HTTP_502' });
    await expect(flofi.approvals.get('apr_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(flofi.approvals.get('apr_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('times out, and refuses bad configuration and browsers', async () => {
    const hanging = (async (_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof globalThis.fetch;
    await expect(client(hanging, { timeoutMs: 20, maxRetries: 0 }).approvals.get('apr_1')).rejects.toMatchObject({ code: 'TIMEOUT' });
    for (const options of [{ apiKey: 'sk_live_x' }, { apiKey: KEY.slice(0, -1) }, { baseUrl: 'http://flofi.example' }, { baseUrl: 'https://user:pw@flofi.example' },
      { baseUrl: 'not a url' }]) expect(() => new FloFi({ apiKey: KEY, baseUrl: 'https://flofi.example', ...options })).toThrow(FloFiError);
    expect(() => new FloFi({ apiKey: KEY, baseUrl: 'http://127.0.0.1:3100' })).not.toThrow();
    const global = globalThis as { window?: unknown };
    global.window = { document: {} };
    try { expect(() => new FloFi({ apiKey: KEY, baseUrl: 'https://flofi.example' })).toThrow('The FloFi SDK runs on your server only'); }
    finally { delete global.window; }
  });
});

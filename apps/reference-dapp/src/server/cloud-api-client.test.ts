// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { callCloudFlow, cloudApiBaseUrl } from './cloud-api-client';

const env = { API_BASE_URL: 'https://api.flofi.example', API_AUTH_TOKEN: 'server-only-token' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noSleep = async () => undefined;

describe('BUILD-CLOUD-001 BFF forwarding client', () => {
  it('accepts only https (or loopback http) base URLs without credentials', () => {
    expect(cloudApiBaseUrl({})).toBeNull();
    expect(cloudApiBaseUrl({ API_BASE_URL: 'http://127.0.0.1:8080' })?.href).toBe('http://127.0.0.1:8080/');
    for (const bad of ['http://api.flofi.example', 'https://user:pass@api.flofi.example', 'not a url', 'https://api.flofi.example/?x=1'])
      expect(() => cloudApiBaseUrl({ API_BASE_URL: bad })).toThrow('CLOUD_API_CONFIGURATION_INVALID');
  });
  it('forwards the exact contract with bearer token, idempotency key and trace header; retries transport loss with the SAME key', async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    let attempt = 0;
    const transport = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      if (attempt++ === 0) throw new TypeError('socket hang up');
      return json(200, { ok: true, value: { id: 'rhx-1' } });
    }) as unknown as typeof fetch;
    expect(await callCloudFlow('robinhood-transfer', 'begin', ['rhx-1', '0xabc', {}], { env, transport, sleep: noSleep })).toEqual({ ok: true, value: { id: 'rhx-1' } });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://api.flofi.example/v1/flows/robinhood-transfer/begin');
    expect(calls[0]!.body).toEqual({ args: ['rhx-1', '0xabc', {}] });
    expect(calls[0]!.headers.authorization).toBe('Bearer server-only-token');
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(calls[0]!.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
  it('passes domain failures through, waits on an in-progress duplicate, and fails closed on anything unexpected', async () => {
    const sequence = [json(409, { ok: false, code: 'IDEMPOTENCY_IN_PROGRESS' }), json(200, { ok: false, code: 'TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY' })];
    const transport = (async () => sequence.shift()!) as unknown as typeof fetch;
    expect(await callCloudFlow('robinhood-transfer', 'begin', [], { env, transport, sleep: noSleep })).toEqual({ ok: false, code: 'TRANSFER_EXISTING_ATTEMPT_OBSERVE_ONLY' });
    const garbage = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    expect(await callCloudFlow('robinhood-transfer', 'status', ['rhx-1'], { env, transport: garbage, sleep: noSleep })).toEqual({ ok: false, code: 'CLOUD_API_UNAVAILABLE' });
    const leaky = (async () => json(500, { ok: false, code: 'Error: stack trace at db.ts' })) as unknown as typeof fetch;
    expect(await callCloudFlow('robinhood-transfer', 'status', ['rhx-1'], { env, transport: leaky, sleep: noSleep })).toEqual({ ok: false, code: 'CLOUD_API_UNAVAILABLE' });
    const statusCalls: Record<string, string>[] = [];
    const read = (async (_url: URL, init: RequestInit) => { statusCalls.push(init.headers as Record<string, string>); return json(200, { ok: true, value: 1 }); }) as unknown as typeof fetch;
    await callCloudFlow('robinhood-transfer', 'status', ['rhx-1'], { env, transport: read, sleep: noSleep });
    expect(statusCalls[0]!['idempotency-key']).toBeUndefined();
    expect(await callCloudFlow('x', 'status', [], { env: {}, sleep: noSleep })).toEqual({ ok: false, code: 'CLOUD_API_NOT_CONFIGURED' });
  });
});

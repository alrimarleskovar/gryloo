// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_OBSERVATION_PROFILE as P } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { BASE_RPC_URL, LIVE_LIMITS, assertAllowed, observationMode, readBaseQuoteOnServer, referenceContext } from './base-rpc';

const STATE = Symbol.for('gryloo.base-observation.live');
const DEV = { GRYLOO_BASE_OBSERVATION: 'live', NODE_ENV: 'development', GRYLOO_ALCHEMY_API_KEY: 'synthetic1' };
const H = `0x${'ab'.repeat(32)}`;
const context = referenceContext();
const workflow = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'WETH_TO_USDC', amount: '1', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context).workflow;
const input = { workflow, nodeId: 'node-002' };
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
const state = () => (globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>)[STATE];

beforeEach(() => { delete (globalThis as unknown as Record<symbol, unknown>)[STATE]; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('mode configuration (L-3, D-3)', () => {
  it('is off by default and allows live reads only in the Next development phase', () => {
    expect(observationMode({})).toBe('off');
    expect(observationMode({ GRYLOO_BASE_OBSERVATION: 'off' })).toBe('off');
    expect(observationMode({ GRYLOO_BASE_OBSERVATION: 'replay', NODE_ENV: 'production' })).toBe('replay');
    expect(observationMode(DEV)).toBe('live');
    for (const env of [{ GRYLOO_BASE_OBSERVATION: 'live', NODE_ENV: 'production' }, { GRYLOO_BASE_OBSERVATION: 'live', NODE_ENV: 'test' },
      { GRYLOO_BASE_OBSERVATION: 'live' }, { GRYLOO_BASE_OBSERVATION: 'LIVE', NODE_ENV: 'development' }, { GRYLOO_BASE_OBSERVATION: 'mocked' }]) {
      expect(() => observationMode(env)).toThrow('CONFIGURATION_INVALID');
    }
  });

  it('refuses live mode under a production build before any request', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await readBaseQuoteOnServer(input, { env: { GRYLOO_BASE_OBSERVATION: 'live', NODE_ENV: 'production' } }))
      .toEqual({ ok: false, code: 'CONFIGURATION_INVALID', message: 'The Base read configuration is invalid. Live Base reads are for local development only.', requestsSent: 0 });
    expect((await readBaseQuoteOnServer(input, { env: {} })).ok).toBe(false);
    expect(await readBaseQuoteOnServer(input, { env: {} })).toMatchObject({ code: 'OBSERVATION_OFF' });
    expect(fetch).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
  });

  it('rejects missing or malformed server credentials without consuming a request or exposing a value', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const credential of [undefined, '', 'short', 'bad key', 'path/key', 'line\nbreak']) {
      const result = await readBaseQuoteOnServer(input, { env: { ...DEV, GRYLOO_ALCHEMY_API_KEY: credential } });
      expect(result).toMatchObject({ ok: false, code: 'CONFIGURATION_INVALID', requestsSent: 0 });
      if (credential) expect(JSON.stringify(result)).not.toContain(credential);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
  });

  it('rejects invalid input before any attempt is used', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const bad of [null, {}, { workflow }, { ...input, extra: 1 }, { workflow, nodeId: 'node-001' }, { workflow, nodeId: 'node-404' },
      { workflow: { ...workflow, revision: -1 }, nodeId: 'node-002' }, { workflow, nodeId: 'x'.repeat(129) }]) {
      expect(await readBaseQuoteOnServer(bad, { env: DEV })).toMatchObject({ ok: false, code: 'INPUT_INVALID', requestsSent: 0 });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
  });
});

describe('request allowlist, re-checked before every send (plan §3.3)', () => {
  const at = { blockHash: H, requireCanonical: true };
  const request = (method: string, params: unknown[]) => JSON.stringify({ id: 3, jsonrpc: '2.0', method, params });
  const word = (address: string) => address.slice(2).padStart(64, '0');
  it('accepts exactly the read plan shapes', () => {
    const accepted = [
      request('eth_chainId', []), request('eth_getBlockByNumber', ['latest', false]), request('eth_getBlockByNumber', ['0x2625a00', false]),
      request('eth_getCode', [P.contracts.quoter, at]),
      request('eth_call', [{ to: P.contracts.usdc, data: P.selectors.symbol }, at]),
      request('eth_call', [{ to: P.contracts.quoter, data: P.selectors.weth9 }, at]),
      request('eth_call', [{ to: P.contracts.factory, data: `${P.selectors.getPool}${word(P.contracts.weth)}${word(P.contracts.usdc)}${'0'.repeat(61)}1f4` }, at]),
    ];
    for (const text of accepted) expect(() => assertAllowed(text)).not.toThrow();
  });
  it.each([
    ['another method', request('eth_getBalance', [P.contracts.usdc, at])],
    ['gas estimation', request('eth_estimateGas', [{ to: P.contracts.quoter, data: P.selectors.factory }])],
    ['a debug method', request('debug_traceCall', [{ to: P.contracts.quoter, data: P.selectors.factory }, at])],
    ['a from field', request('eth_call', [{ from: P.contracts.weth, to: P.contracts.quoter, data: P.selectors.factory }, at])],
    ['a value field', request('eth_call', [{ to: P.contracts.quoter, data: P.selectors.factory, value: '0x1' }, at])],
    ['a number-pinned read', request('eth_call', [{ to: P.contracts.quoter, data: P.selectors.factory }, '0x2625a00'])],
    ['a tag-pinned read', request('eth_getCode', [P.contracts.quoter, 'latest'])],
    ['requireCanonical false', request('eth_getCode', [P.contracts.quoter, { blockHash: H, requireCanonical: false }])],
    ['a router address', request('eth_call', [{ to: '0x2626664c2603336e57b271c5c0b26f421741e481', data: P.selectors.factory }, at])],
    ['an approve selector', request('eth_call', [{ to: P.contracts.usdc, data: `0x095ea7b3${'0'.repeat(128)}` }, at])],
    ['a selector on the wrong target', request('eth_call', [{ to: P.contracts.quoter, data: P.selectors.decimals }, at])],
    ['a wrong data length', request('eth_call', [{ to: P.contracts.usdc, data: `${P.selectors.decimals}00` }, at])],
    ['a pending block', request('eth_getBlockByNumber', ['pending', false])],
    ['a full block', request('eth_getBlockByNumber', ['latest', true])],
    ['an extra key', `{"extra":1,${request('eth_chainId', []).slice(1)}`],
  ])('rejects %s', (_label, text) => {
    expect(() => assertAllowed(text)).toThrow('INTERNAL_ERROR');
  });
});

describe('live transport and process limits (L-2, L-3)', () => {
  it('sends only to the fixed destination with fixed options', async () => {
    const fetch = vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: '0x1' }));
    vi.stubGlobal('fetch', fetch);
    const result = await readBaseQuoteOnServer(input, { env: DEV, wait: async () => undefined });
    expect(result).toMatchObject({ ok: false, code: 'WRONG_CHAIN', requestsSent: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BASE_RPC_URL);
    expect(new URL(url).host).toBe(P.providerHost);
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${DEV.GRYLOO_ALCHEMY_API_KEY}` }, redirect: 'error', cache: 'no-store', credentials: 'omit' });
    expect(Object.keys(init.headers as object)).toEqual(['content-type', 'Authorization']);
    expect(url).not.toContain(DEV.GRYLOO_ALCHEMY_API_KEY);
    expect(init.body).not.toContain(DEV.GRYLOO_ALCHEMY_API_KEY);
    expect(init.body).toBe('{"id":1,"jsonrpc":"2.0","method":"eth_chainId","params":[]}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['HTTP 429', () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } }), 'PROVIDER_RATE_LIMITED'],
    ['HTTP 503', () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }), 'PROVIDER_ERROR'],
    ['a redirect or network failure', () => { throw new TypeError('fetch failed'); }, 'TRANSPORT_FAILED'],
    ['a wrong content type', () => new Response('{"jsonrpc":"2.0","id":1,"result":"0x2105"}', { status: 200, headers: { 'content-type': 'text/html' } }), 'TRANSPORT_FAILED'],
    ['an oversized streamed body', () => new Response(`{"jsonrpc":"2.0","id":1,"result":"0x${'0'.repeat(P.maximumResponseBytes)}"}`, { status: 200, headers: { 'content-type': 'application/json' } }), 'TRANSPORT_FAILED'],
    ['duplicate keys', () => new Response('{"jsonrpc":"2.0","id":1,"id":1,"result":"0x2105"}', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }), 'RPC_RESPONSE_INVALID'],
    ['invalid UTF-8', () => new Response(new Uint8Array([0x7b, 0xff, 0x7d]), { status: 200, headers: { 'content-type': 'application/json' } }), 'RPC_RESPONSE_INVALID'],
  ])('fails closed on %s, trips the breaker and never retries', async (_label, respond, code) => {
    const fetch = vi.fn(async () => respond());
    vi.stubGlobal('fetch', fetch);
    expect(await readBaseQuoteOnServer(input, { env: DEV, wait: async () => undefined })).toMatchObject({ ok: false, code, requestsSent: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ stopped: code, attempts: 1, requests: 1, inFlight: false });
    expect(await readBaseQuoteOnServer(input, { env: DEV })).toMatchObject({ ok: false, code: 'LIVE_SESSION_STOPPED', requestsSent: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a hash-pinned read with no fallback and stops the session', async () => {
    const now = 1_790_000_000_000;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as { id: number; method: string };
      if (request.method === 'eth_chainId') return json({ jsonrpc: '2.0', id: request.id, result: '0x2105' });
      if (request.method === 'eth_getBlockByNumber') return json({ jsonrpc: '2.0', id: request.id, result: { number: '0x1', hash: H, timestamp: `0x${(now / 1000 - 1).toString(16)}` } });
      return json({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'invalid argument 1' } });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await readBaseQuoteOnServer(input, { env: DEV, now: () => now, wait: async () => undefined })).toMatchObject({ ok: false, code: 'PINNED_READ_REJECTED', requestsSent: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(state()).toMatchObject({ stopped: 'PINNED_READ_REJECTED' });
  });

  it('spaces requests about 400 ms apart and pauses 1 second after the head read (Amendment 1)', async () => {
    expect(LIVE_LIMITS).toMatchObject({ requestSpacingMs: 400, settleMs: 1000, attempts: 3, requests: 63 });
    let now = 1_790_000_000_000;
    const waits: number[] = [], sent: number[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(now);
      const request = JSON.parse(init.body as string) as { id: number; method: string };
      if (request.method === 'eth_chainId') return json({ jsonrpc: '2.0', id: request.id, result: '0x2105' });
      if (request.method === 'eth_getBlockByNumber') return json({ jsonrpc: '2.0', id: request.id, result: { number: '0x1', hash: H, timestamp: `0x${Math.floor(now / 1000 - 1).toString(16)}` } });
      return json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'header not found' } });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await readBaseQuoteOnServer(input, { env: DEV, now: () => now, wait: async (ms) => { waits.push(ms); now += ms; } });
    expect(result).toMatchObject({ ok: false, code: 'PINNED_READ_REJECTED', requestsSent: 3 });
    expect(waits).toEqual([400, 1000]);
    expect(sent.map(at => at - sent[0]!)).toEqual([0, 400, 1400]);
  });

  it('allows one read in flight and at least 10 seconds between live starts', async () => {
    let release: () => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { release = () => resolve(json({ jsonrpc: '2.0', id: 1, result: '0x1' })); }));
    vi.stubGlobal('fetch', fetch);
    let now = 1_000_000;
    const first = readBaseQuoteOnServer(input, { env: DEV, now: () => now, wait: async () => undefined });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(await readBaseQuoteOnServer(input, { env: DEV, now: () => now })).toMatchObject({ code: 'THROTTLED', requestsSent: 0 });
    release();
    await first;
    state()!.stopped = null;
    now += LIVE_LIMITS.intervalMs - 1;
    expect(await readBaseQuoteOnServer(input, { env: DEV, now: () => now })).toMatchObject({ code: 'THROTTLED' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caps a process at 3 attempts and 63 requests, counting before sending', async () => {
    const fetch = vi.fn(async () => json({ jsonrpc: '2.0', id: 1, result: '0x2105' }));
    vi.stubGlobal('fetch', fetch);
    Object.assign((globalThis as unknown as Record<symbol, object>)[STATE] = {}, { attempts: 3, requests: 0, inFlight: false, lastStartMs: null, lastSendMs: null, stopped: null, highestBlock: null });
    expect(await readBaseQuoteOnServer(input, { env: DEV })).toMatchObject({ code: 'LIVE_LIMIT_REACHED', requestsSent: 0 });
    Object.assign(state()!, { attempts: 0, requests: 63 });
    expect(await readBaseQuoteOnServer(input, { env: DEV })).toMatchObject({ code: 'LIVE_LIMIT_REACHED', requestsSent: 0 });
    Object.assign(state()!, { attempts: 0, requests: 62 });
    expect(await readBaseQuoteOnServer(input, { env: DEV, wait: async () => undefined })).toMatchObject({ code: 'LIVE_LIMIT_REACHED' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ requests: 63, attempts: 1 });
  });

  it('keeps the limits across a module re-import', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } })));
    await readBaseQuoteOnServer(input, { env: DEV, wait: async () => undefined });
    vi.resetModules();
    const reloaded = await import('./base-rpc');
    expect(await reloaded.readBaseQuoteOnServer(input, { env: DEV })).toMatchObject({ code: 'LIVE_SESSION_STOPPED' });
  });
});

describe('replay (CI and E2E)', () => {
  it('never calls fetch and fails closed on a missing or malformed recording file', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const dir = mkdtempSync(join(tmpdir(), 'gryloo-replay-'));
    writeFileSync(join(dir, 'bad.json'), '{"format":"gryloo.base-observation-recordings.v1","recordings":[],"recordings":[]}');
    writeFileSync(join(dir, 'empty.json'), '{"format":"gryloo.base-observation-recordings.v1","recordings":[]}');
    for (const file of [join(dir, 'missing.json'), join(dir, 'bad.json'), join(dir, 'empty.json')]) {
      expect(await readBaseQuoteOnServer(input, { env: { GRYLOO_BASE_OBSERVATION: 'replay' }, replayFile: file })).toMatchObject({ ok: false, code: 'REPLAY_MISMATCH' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(state()).toBeUndefined();
  });
});


describe('approved real Base replay fixture', () => {
  it('retains exactly two complete transcripts, matching code pins and canonical hash-pinned responses', () => {
    const bytes = readFileSync(join(process.cwd(), 'apps/reference-dapp/e2e/observations/base-recorded-observations.json'));
    const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    expect(sha(bytes)).toBe('29a4ae63f96d0332450cf083ce627832b01f72fa95186d4b7ad1d59144997d00');
    const fixture = JSON.parse(bytes.toString()) as { format: string; recordings: Array<{ swap: { from: string; to: string; amountIn: string }; exchanges: Array<{ request: string; response: string }> }> };
    expect(fixture.format).toBe('gryloo.base-observation-recordings.v1');
    expect(fixture.recordings).toHaveLength(2);
    const expected = [
      ['WETH', 'USDC', '1000000000000000000', '412609a4e3fcbb53968a2b4440e8a1062049c2abbb19a8ed8262def2e940cc8a'],
      ['USDC', 'WETH', '2500000000', 'a16f2269f393334d381492c7e1316ac42c782a7f2c776e6b2c9216e073070f39'],
    ];
    for (const [index, recording] of fixture.recordings.entries()) {
      const [from, to, amountIn, transcriptHash] = expected[index]!;
      expect(recording.swap).toEqual({ from, to, amountIn });
      expect(sha(Buffer.from(JSON.stringify(recording)))).toBe(transcriptHash);
      expect(recording.exchanges).toHaveLength(21);
      const exchanges = recording.exchanges.map(({ request, response }) => ({
        request: JSON.parse(request) as { method: string; params: unknown[] },
        response: JSON.parse(response) as { result?: unknown; error?: unknown },
      }));
      expect(exchanges[0]!.request.method).toBe('eth_chainId');
      expect(exchanges[1]!.request.method).toBe('eth_getBlockByNumber');
      expect(exchanges[20]!.request.method).toBe('eth_getBlockByNumber');
      const head = exchanges[1]!.response.result as { hash: string };
      const final = exchanges[20]!.response.result as { hash: string };
      expect(final.hash).toBe(head.hash);
      for (const [i, exchange] of exchanges.entries()) {
        expect(exchange.response.error).toBeUndefined();
        expect(() => assertAllowed(recording.exchanges[i]!.request)).not.toThrow();
        if (i >= 2 && i <= 19) {
          expect(exchange.request.params.at(-1)).toEqual({ blockHash: head.hash, requireCanonical: true });
          expect(exchange.request.method).toBe(i <= 5 ? 'eth_getCode' : 'eth_call');
        }
        if (i >= 2 && i <= 5) {
          const label = ['usdc', 'weth', 'factory', 'quoter'][i - 2] as keyof typeof P.codePins;
          const code = exchange.response.result as string;
          expect(`0x${sha(Buffer.from(code.slice(2), 'hex'))}`).toBe(P.codePins[label]);
        }
      }
    }
    expect(bytes.toString()).not.toMatch(/authorization|bearer|api[_-]?key|credential/i);
  });
});

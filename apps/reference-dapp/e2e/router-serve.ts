// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 loopback server (127.0.0.1:8557) for the browser suite, wrapping the same MOCKED in-process Base /
 * Arbitrum chains and provider APIs as the unit and PostgreSQL tests. Never a public network; nothing is broadcast.
 * `/base` and `/arbitrum` are JSON-RPC; `/lifi/v1/*` and `/across/api/*` answer like the providers; `/control` is the
 * scripted owner wallet and test clock.
 */
import { createServer } from 'node:http';
import { createRouterHarness, type RouterHarnessOptions } from './router-harness.ts';

let h = createRouterHarness();
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8557');
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  try {
    if (request.method === 'GET' && (url.pathname.startsWith('/lifi/') || url.pathname.startsWith('/across/'))) {
      try { json(200, await h.http(url.href)); }
      catch (cause) { const status = /^ROUTER_PROVIDER_HTTP_(\d{3})$/.exec(cause instanceof Error ? cause.message : '')?.[1]; json(status ? Number(status) : 500, { message: 'MOCK_PROVIDER_ERROR' }); }
      return;
    }
    if (request.method !== 'POST') { response.writeHead(200, { 'content-type': 'text/plain' }).end('MOCKED Flofi router harness'); return; }
    let body = '';
    for await (const chunk of request) body += chunk;
    const { method, params = [] } = JSON.parse(body) as { method: string; params?: unknown[] };
    const reply = (value: object) => json(200, { jsonrpc: '2.0', id: 1, ...value });
    try {
      if (url.pathname === '/base') { reply({ result: await h.baseRpc(method, params) }); return; }
      if (url.pathname === '/arbitrum') { reply({ result: await h.arbitrumRpc(method, params) }); return; }
      if (url.pathname !== '/control') { json(404, {}); return; }
      if (method === 'MOCK_reset') { h = createRouterHarness((params[0] ?? {}) as RouterHarnessOptions); reply({ result: true }); return; }
      if (method === 'MOCK_send') { reply({ result: h.wallet.send(params[0] as Parameters<typeof h.wallet.send>[0]) }); return; }
      if (method === 'MOCK_sends') { reply({ result: h.counters.sends }); return; }
      if (method === 'MOCK_advance') { h.advance(Number(params[0])); reply({ result: true }); return; }
      if (method === 'MOCK_feeBump') { h.controls.feeBump = BigInt(String(params[0])); reply({ result: true }); return; }
      if (method === 'MOCK_nonce') { reply({ result: await h.baseRpc('eth_getTransactionCount', params) }); return; }
      reply({ error: { code: -32601, message: 'MOCK_METHOD_UNSUPPORTED' } });
    } catch (error) { reply({ error: { code: -32000, message: error instanceof Error ? error.message : 'MOCK_ERROR' } }); }
  } catch { json(400, {}); }
}).listen(8557, '127.0.0.1');

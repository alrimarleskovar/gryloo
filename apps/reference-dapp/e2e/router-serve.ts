// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 loopback server (127.0.0.1:8557) for the browser suite, wrapping the same MOCKED in-process Base /
 * Arbitrum chains and provider APIs as the unit and PostgreSQL tests. Never a public network; nothing is broadcast.
 * `/base` and `/arbitrum` are JSON-RPC; `/lifi/v1/*` and `/across/api/*` answer like the providers; `/control` is the
 * scripted owner wallet and test clock.
 * BUILD-JOURNEY-001: the same paths under `/testnet/*` serve a second harness with the testnet profile (Base Sepolia /
 * Arbitrum Sepolia ids and addresses); `MOCK_reset` takes `{ network: 'testnet', owner, wallets }` for random test wallets.
 */
import { createServer } from 'node:http';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import { createRouterHarness, type RouterHarnessOptions } from './router-harness.ts';

const harnesses = { mainnet: createRouterHarness(), testnet: createRouterHarness({ profile: TESTNET }) };
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8557');
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  const network = url.pathname.startsWith('/testnet/') ? 'testnet' : 'mainnet', path = network === 'testnet' ? url.pathname.slice('/testnet'.length) : url.pathname;
  const h = harnesses[network];
  try {
    if (request.method === 'GET' && (path.startsWith('/lifi/') || path.startsWith('/across/'))) {
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
      if (path === '/base') { reply({ result: await h.baseRpc(method, params) }); return; }
      if (path === '/arbitrum') { reply({ result: await h.arbitrumRpc(method, params) }); return; }
      if (url.pathname !== '/control') { json(404, {}); return; }
      // Control calls name their network in a trailing `{ network }` object or default to mainnet.
      const options = (params[0] ?? {}) as RouterHarnessOptions & { network?: 'mainnet' | 'testnet' };
      const target = harnesses[method === 'MOCK_reset' ? options.network ?? 'mainnet' : (params.at(-1) as { network?: 'mainnet' | 'testnet' } | undefined)?.network ?? 'mainnet'];
      if (method === 'MOCK_reset') {
        const { network: chosen = 'mainnet', ...rest } = options;
        harnesses[chosen] = createRouterHarness({ ...rest, ...chosen === 'testnet' ? { profile: TESTNET } : {} });
        reply({ result: true }); return;
      }
      if (method === 'MOCK_send') { reply({ result: target.wallet.send(params[0] as Parameters<typeof target.wallet.send>[0]) }); return; }
      if (method === 'MOCK_sends') { reply({ result: target.counters.sends }); return; }
      if (method === 'MOCK_advance') { target.advance(Number(params[0])); reply({ result: true }); return; }
      if (method === 'MOCK_feeBump') { target.controls.feeBump = BigInt(String(params[0])); reply({ result: true }); return; }
      if (method === 'MOCK_nonce') { reply({ result: await target.baseRpc('eth_getTransactionCount', params.slice(0, 2)) }); return; }
      reply({ error: { code: -32601, message: 'MOCK_METHOD_UNSUPPORTED' } });
    } catch (error) { reply({ error: { code: -32000, message: error instanceof Error ? error.message : 'MOCK_ERROR' } }); }
  } catch { json(400, {}); }
}).listen(8557, '127.0.0.1');

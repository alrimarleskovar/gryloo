// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC loopback JSON-RPC (127.0.0.1:8556) for the browser suite, wrapping the same MOCKED
 * in-process Base Sepolia chain as the unit and PostgreSQL tests. Never a public network; nothing is broadcast.
 * `MOCK_send` is the scripted owner wallet; `MOCK_reset` starts a fresh chain.
 */
import { createServer } from 'node:http';
import { createUniswapLiquidityChain } from './uniswap-liquidity-harness.ts';

let chain = createUniswapLiquidityChain();
createServer(async (request, response) => {
  if (request.method !== 'POST') { response.writeHead(200, { 'content-type': 'text/plain' }).end('MOCKED Base Sepolia Uniswap harness'); return; }
  let body = '';
  for await (const chunk of request) body += chunk;
  const reply = (value: object) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...value }));
  try {
    const { method, params = [] } = JSON.parse(body) as { method: string; params?: unknown[] };
    if (method === 'MOCK_reset') { chain = createUniswapLiquidityChain({ delegatedOwner: (params[0] as { delegatedOwner?: boolean } | undefined)?.delegatedOwner === true }); reply({ result: true }); return; }
    if (method === 'MOCK_send') { reply({ result: chain.wallet.send(params[0] as Parameters<typeof chain.wallet.send>[0], (params[1] ?? {}) as { hold?: boolean }) }); return; }
    if (method === 'MOCK_sendDelegated') { reply({ result: chain.wallet.sendDelegated(params[0] as Parameters<typeof chain.wallet.sendDelegated>[0]) }); return; }
    if (method === 'MOCK_sends') { reply({ result: chain.counters.sends }); return; }
    reply({ result: await chain.rpc(method, params) });
  } catch (error) { reply({ error: { code: -32000, message: error instanceof Error ? error.message : 'MOCK_ERROR' } }); }
}).listen(8556, '127.0.0.1');

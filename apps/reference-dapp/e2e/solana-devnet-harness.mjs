// SPDX-License-Identifier: AGPL-3.0-only
/** Explicit MOCKED offline Solana Devnet RPC + Orca Whirlpool on loopback. No public transport; never DEVNET_EXECUTED evidence. */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { createMockedSolanaDevnetOrca } from '../../../packages/reference-compiler/dist/index.js';

const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
if (process.argv.includes('--serve')) {
  let options = {}, env = createMockedSolanaDevnetOrca(options);
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.end('MOCKED Solana Devnet / Orca harness'); return; }
      let body = ''; for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1_048_576) throw new Error('MOCK_INPUT_TOO_LARGE'); }
      const value = JSON.parse(body);
      if (req.url === '/control') {
        let result = true;
        if (value.action === 'reset') {
          options = { ...value.options ?? {} }; env = createMockedSolanaDevnetOrca(options);
          env.fund(value.owner, BigInt(value.lamports ?? '3000000000'), BigInt(value.devUsdc ?? '50000000'));
        } else if (value.action === 'advance') env.advance(Number(value.blocks));
        else if (value.action === 'set') Object.assign(options, value.options ?? {});
        else if (value.action === 'sent') result = env.state.sent.length;
        else throw new Error('MOCK_CONTROL_DENIED');
        res.setHeader('content-type', 'application/json'); res.end(json({ result })); return;
      }
      if (req.url !== '/rpc') throw new Error('MOCK_PATH_DENIED');
      try {
        const result = await env.rpc(value.method, value.params ?? []);
        res.setHeader('content-type', 'application/json'); res.end(json({ jsonrpc: '2.0', id: value.id, result }));
      } catch (cause) {
        res.setHeader('content-type', 'application/json');
        res.end(json({ jsonrpc: '2.0', id: value.id, error: { code: cause?.rpc ?? -32000, message: String(cause?.message ?? 'MOCK_RPC_DENIED') } }));
      }
    } catch { res.statusCode = 400; res.end(json({ error: 'MOCK_HARNESS_DENIED' })); }
  });
  server.listen(8552, '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}

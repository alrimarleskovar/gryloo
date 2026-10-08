// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic read-only RPC for browser acceptance. Never signs, prepares a transaction or broadcasts. */
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP } from '../src/domain/public-testnet-swap.ts';

const directory = process.env.FLOFI_SWAP_READ_TLS;
if (process.env.FLOFI_SWAP_READ_E2E !== 'MOCKED_LOOPBACK_ONLY' || !directory?.startsWith('/')) throw Error('READ_HARNESS_DENIED');
const word = (value: bigint) => '0x' + value.toString(16).padStart(64, '0');
const address = (value: string) => '0x' + value.slice(2).padStart(64, '0');
const methods: string[] = [];
createServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, async (request, response) => {
  if (request.method === 'GET') { response.end(JSON.stringify({ environment: 'MOCKED', methods })); return; }
  try {
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 65_536) throw Error('INPUT_TOO_LARGE'); }
    const { id, method, params } = JSON.parse(raw) as { id: unknown; method: string; params: unknown[] };
    methods.push(method);
    const profile = request.url === '/ethereum' ? ETHEREUM_SEPOLIA_SWAP : request.url === '/base' ? BASE_SEPOLIA : null;
    if (!profile) throw Error('PROFILE_REQUIRED');
    let result: unknown;
    if (method === 'eth_chainId') result = profile.chainHex;
    else if (method === 'eth_getBlockByNumber') result = { number: '0x64', hash: '0x' + 'a'.repeat(64), timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) };
    else if (method === 'eth_getCode') result = '0x6000';
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: string }, selector = call.data.slice(0, 10);
      const addresses: Record<string, string> = { '0xc45a0155': profile.factory, '0x4aa4a4fc': profile.weth, '0x1698ee82': profile.pool, '0x0dfe1681': profile.usdc, '0xd21220a7': profile.weth };
      if (addresses[selector]) result = address(addresses[selector]);
      else if (selector === '0x313ce567') result = word(call.to.toLowerCase() === profile.usdc ? 6n : 18n);
      else if (selector === '0xddca3f43') result = word(BigInt(profile.fee));
      else if (selector === '0x1a686502' || selector === '0x3850c7bd') result = word(1n);
      // Deliberately synthetic engineering fixture. The production reader validates and normalizes this response.
      else if (selector === '0xc6a5026a') result = word(BigInt('0x' + call.data.slice(138, 202)) * 500_000_000n);
      else throw Error('READ_METHOD_DENIED');
    } else throw Error('READ_METHOD_DENIED');
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  } catch { response.statusCode = 400; response.end(JSON.stringify({ error: 'READ_METHOD_DENIED' })); }
}).listen(8558, '127.0.0.1');

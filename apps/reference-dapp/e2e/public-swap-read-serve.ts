// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic RPC for browser acceptance. Never signs or broadcasts. Execution controls are opt-in and loopback only. */
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP } from '../src/domain/public-testnet-swap.ts';

const directory = process.env.FLOFI_SWAP_READ_TLS;
if (process.env.FLOFI_SWAP_READ_E2E !== 'MOCKED_LOOPBACK_ONLY' || !directory?.startsWith('/')) throw Error('READ_HARNESS_DENIED');
const word = (value: bigint) => '0x' + value.toString(16).padStart(64, '0');
const address = (value: string) => '0x' + value.slice(2).padStart(64, '0');
const methods: string[] = [];
const execution = process.env.FLOFI_SWAP_EXECUTION_E2E === 'MOCKED_LOOPBACK_ONLY';
type Balances = { allowance: bigint; input: bigint; output: bigint; native: bigint };
const initialBalances = (): Balances => ({ allowance: 0n, input: 10_000_000n, output: 0n, native: 10n ** 18n });
let head = 100, balances = initialBalances();
const history = new Map<number, Balances>([[head, { ...balances }]]);
const transactions: Record<string, unknown>[] = [], receipts = new Map<string, Record<string, unknown>>();
const blockHash = (number: number) => word(BigInt(number));
const at = (block: unknown) => typeof block === 'string' && /^0x[0-9a-f]+$/i.test(block) ? history.get(Number(BigInt(block))) ?? balances : balances;
createServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, async (request, response) => {
  if (request.method === 'GET') { response.end(JSON.stringify({ environment: 'MOCKED', methods, sends: transactions.length })); return; }
  try {
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 65_536) throw Error('INPUT_TOO_LARGE'); }
    const { id, method, params } = JSON.parse(raw) as { id: unknown; method: string; params: unknown[] };
    if (request.url === '/control') {
      if (!execution) throw Error('EXECUTION_CONTROL_DENIED');
      let result: unknown;
      if (method === 'MOCK_reset') {
        head = 100; balances = initialBalances(); history.clear(); history.set(head, { ...balances }); transactions.length = 0; receipts.clear(); methods.length = 0; result = null;
      } else if (method === 'MOCK_sends') result = transactions.length;
      else if (method === 'MOCK_send') {
        const tx = params[0] as { chainId: string; from: string; to: string; data: string; value: string };
        const profile = BASE_SEPOLIA;
        if (tx.chainId !== profile.chainHex || !/^0x[0-9a-f]{40}$/.test(tx.from) || tx.value !== '0x0') throw Error('MOCK_TX_DENIED');
        if (tx.to === profile.usdc && tx.data.slice(0, 10) === '0x095ea7b3' && tx.data.slice(10, 74) === address(profile.router).slice(2)) balances.allowance = BigInt('0x' + tx.data.slice(74));
        else if (tx.to === profile.router && tx.data.slice(0, 10) === '0x04e45aaf') {
          const amount = BigInt('0x' + tx.data.slice(266, 330));
          if (balances.allowance < amount || balances.input < amount) throw Error('MOCK_BALANCE_DENIED');
          balances.input -= amount; balances.output += amount * 500_000_000n; balances.allowance -= amount;
        } else throw Error('MOCK_TX_DENIED');
        const hash = word(BigInt(transactions.length + 1));
        const nonce = '0x' + transactions.length.toString(16);
        head++; balances.native -= 100_000n * 1_000_000_000n; history.set(head, { ...balances });
        transactions.push({ ...tx, hash, input: tx.data, nonce, type: '0x2', blockNumber: '0x' + head.toString(16), blockHash: blockHash(head) });
        receipts.set(hash, { transactionHash: hash, status: '0x1', blockNumber: '0x' + head.toString(16), blockHash: blockHash(head),
          from: tx.from, to: tx.to, gasUsed: '0x186a0', effectiveGasPrice: '0x3b9aca00', l1Fee: '0x0', logs: [] });
        result = hash;
      } else throw Error('EXECUTION_CONTROL_DENIED');
      response.end(JSON.stringify({ jsonrpc: '2.0', id, result })); return;
    }
    methods.push(method);
    const profile = request.url === '/ethereum' ? ETHEREUM_SEPOLIA_SWAP : request.url === '/base' ? BASE_SEPOLIA : null;
    if (!profile) throw Error('PROFILE_REQUIRED');
    let result: unknown;
    if (method === 'eth_chainId') result = profile.chainHex;
    else if (method === 'eth_getBlockByNumber') {
      const number = execution && typeof params[0] === 'string' && /^0x[0-9a-f]+$/i.test(params[0]) ? Number(BigInt(params[0])) : head;
      result = { number: '0x' + number.toString(16), hash: execution ? blockHash(number) : '0x' + 'a'.repeat(64),
        timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), transactions: transactions.filter(tx => tx.blockNumber === '0x' + number.toString(16)).map(tx => tx.hash) };
    }
    else if (method === 'eth_getCode') result = '0x6000';
    else if (execution && method === 'eth_blockNumber') result = '0x' + head.toString(16);
    else if (execution && method === 'eth_gasPrice') result = '0x3b9aca00';
    else if (execution && method === 'eth_estimateGas') result = '0x186a0';
    else if (execution && method === 'eth_getBalance') result = '0x' + at(params[1]).native.toString(16);
    else if (execution && method === 'eth_getTransactionReceipt') result = receipts.get(String(params[0])) ?? null;
    else if (execution && method === 'eth_getTransactionByHash') result = transactions.find(tx => tx.hash === params[0]) ?? null;
    else if (method === 'eth_call') {
      const call = params[0] as { to: string; data: string }, selector = call.data.slice(0, 10);
      const addresses: Record<string, string> = { '0xc45a0155': profile.factory, '0x4aa4a4fc': profile.weth, '0x1698ee82': profile.pool, '0x0dfe1681': profile.usdc, '0xd21220a7': profile.weth };
      if (addresses[selector]) result = address(addresses[selector]);
      else if (selector === '0x313ce567') result = word(call.to.toLowerCase() === profile.usdc ? 6n : 18n);
      else if (selector === '0xddca3f43') result = word(BigInt(profile.fee));
      else if (selector === '0x1a686502' || selector === '0x3850c7bd') result = word(1n);
      // Deliberately synthetic engineering fixture. The production reader validates and normalizes this response.
      else if (selector === '0xc6a5026a') result = word(BigInt('0x' + call.data.slice(138, 202)) * 500_000_000n);
      else if (execution && selector === '0xdd62ed3e') result = word(at(params[1]).allowance);
      else if (execution && selector === '0x70a08231') result = word(call.to.toLowerCase() === profile.usdc ? at(params[1]).input : at(params[1]).output);
      else throw Error('READ_METHOD_DENIED');
    } else throw Error('READ_METHOD_DENIED');
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  } catch { response.statusCode = 400; response.end(JSON.stringify({ error: 'READ_METHOD_DENIED' })); }
}).listen(8558, '127.0.0.1');

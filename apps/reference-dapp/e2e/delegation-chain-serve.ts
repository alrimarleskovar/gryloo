// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002 browser suite: the MOCKED loopback chains of delegated execution on 127.0.0.1:8560 (never a public RPC).
 *
 *   POST /rpc/eip155%3A84532        the Base Sepolia chain double: EIP-7702 MetaMask smart account code, ERC-20 balances, a JS model of
 *                                   the Delegation Framework v1.3.0 enforcers, the Uniswap v3 quoter/router and receipts
 *   POST /rpc/<devnet genesis>      the Solana Devnet double: SPL token accounts with delegation, the MOCKED swap program, signatures
 *   POST /control                   test-only JSON-RPC: world setup and observation (`MOCK_*`)
 *
 * The app reaches the chains only through FLOFI_DELEGATION_HARNESS=MOCKED_LOOPBACK_ONLY (refused on hosted deployments); the spec's
 * injected wallets reach `/control` from the test process. Evidence produced against these doubles is MOCKED, never a public execution.
 */
import { createServer } from 'node:http';
import { associatedTokenAddress, splDelegation } from '@defi-workflow-engine/reference-compiler';
import { createEvmDouble } from '../src/delegation/harness/evm-double.ts';
import { createSolanaDouble, DEVNET_GENESIS } from '../src/delegation/harness/solana-double.ts';

export const DELEGATION_HARNESS_PORT = 8560;
const BASE_SEPOLIA = 'eip155:84532', DEV_USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
let evm = createEvmDouble(84532), sol = createSolanaDouble();
const replacer = (_: string, value: unknown) => typeof value === 'bigint' ? value.toString() : value;

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${DELEGATION_HARNESS_PORT}`);
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value, replacer));
  if (request.method !== 'POST') { response.writeHead(200, { 'content-type': 'text/plain' }).end('MOCKED FloFi delegated-execution chain harness'); return; }
  let body = '';
  for await (const chunk of request) body += chunk;
  let input: { id?: unknown; method?: unknown; params?: unknown };
  try { input = JSON.parse(body) as typeof input; } catch { json(400, {}); return; }
  const method = typeof input.method === 'string' ? input.method : '', params = Array.isArray(input.params) ? input.params : [];
  const reply = (value: object) => json(200, { jsonrpc: '2.0', id: input.id ?? 1, ...value });
  try {
    const chain = url.pathname.startsWith('/rpc/') ? decodeURIComponent(url.pathname.slice(5)) : null;
    if (chain === BASE_SEPOLIA) { reply({ result: await evm.rpc(method, params) }); return; }
    if (chain === DEVNET_GENESIS) { reply({ result: await sol.rpc(method, params) }); return; }
    if (url.pathname !== '/control') { json(404, {}); return; }
    const [a, b, c] = params as string[];
    switch (method) {
      case 'MOCK_reset': evm = createEvmDouble(84532); sol = createSolanaDouble(); reply({ result: true }); return;
      // The owner's EVM account is a MetaMask smart account (EIP-7702) holding test USDC; its Solana wallet holds devUSDC.
      case 'MOCK_evmOwner': evm.control.upgrade(a!); evm.control.fund(a!, 'USDC', BigInt(b!)); reply({ result: true }); return;
      case 'MOCK_solanaOwner': {
        const account = associatedTokenAddress(a!, DEV_USDC, splDelegation.TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM);
        sol.control.mint(DEV_USDC, 6); sol.control.tokenAccount(account, a!, DEV_USDC, BigInt(b!)); reply({ result: account }); return;
      }
      // The owner's own wallet transaction (revocation: `disableDelegation`), as the injected wallet's `eth_sendTransaction`.
      case 'MOCK_ownerSend': reply({ result: evm.control.ownerSend(a!, b!, c!) }); return;
      case 'MOCK_evmBalance': reply({ result: evm.control.balance(a as 'USDC' | 'WETH', b!).toString() }); return;
      case 'MOCK_solanaAccount': reply({ result: sol.control.account(a!) }); return;
      case 'MOCK_sends': reply({ result: { evm: evm.control.sends(), solana: sol.control.sends() } }); return;
      default: reply({ error: { code: -32601, message: 'MOCK_METHOD_UNSUPPORTED' } });
    }
  } catch (error) { reply({ error: { code: -32000, message: error instanceof Error ? error.message.slice(0, 200) : 'MOCK_ERROR' } }); }
}).listen(DELEGATION_HARNESS_PORT, '127.0.0.1');

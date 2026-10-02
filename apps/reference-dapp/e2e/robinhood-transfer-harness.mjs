// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 explicit MOCKED Robinhood Testnet chain for automated tests. Loopback only (127.0.0.1:8553);
 * there is no public transport and nothing is ever broadcast. Transactions are signed with a PUBLIC disposable
 * fixture key (0x52…52) so independent signer recovery is exercised; the key holds nothing anywhere.
 */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { secp256k1 } from '../../../packages/reference-reconciler/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../packages/reference-reconciler/node_modules/@noble/hashes/sha3.js';
import { rlpEncode, rlpInteger, toHex, fromHex } from '../../../packages/reference-compiler/dist/index.js';

const fixtureKey = new Uint8Array(32).fill(0x52), fixturePublic = secp256k1.getPublicKey(fixtureKey, false);
export const TRANSFER_OWNER = toHex(keccak_256(fixturePublic.slice(1)).slice(12));
export const CHAIN_HEX = '0xb626', CHAIN_ID = 46630n, GAS_USED = 23_868n, BASE_FEE = 10_000_000n;
const hex = n => '0x' + BigInt(n).toString(16);
const blockHash = n => '0x' + (BigInt(n) + 0xabc000n).toString(16).padStart(64, '0');

export function signFixtureTransfer(tx) {
  const fields = [rlpInteger(CHAIN_ID), rlpInteger(BigInt(tx.nonce)), rlpInteger(BigInt(tx.maxPriorityFeePerGas)), rlpInteger(BigInt(tx.maxFeePerGas)),
    rlpInteger(BigInt(tx.gas)), fromHex(tx.to), rlpInteger(BigInt(tx.value)), fromHex(tx.data === '0x' ? '0x' : tx.data), []];
  const digest = keccak_256(Uint8Array.of(2, ...rlpEncode(fields))), signature = secp256k1.sign(digest, fixtureKey, { prehash: false });
  const parity = [0, 1].find(i => toHex(secp256k1.Signature.fromBytes(signature).addRecoveryBit(i).recoverPublicKey(digest).toBytes(false)) === toHex(fixturePublic));
  if (parity === undefined) throw new Error('MOCK_SIGNATURE_FAILED');
  const r = BigInt(toHex(signature.slice(0, 32))), s = BigInt(toHex(signature.slice(32)));
  const hash = toHex(keccak_256(Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(BigInt(parity)), rlpInteger(r), rlpInteger(s)]))));
  return { type: '0x2', chainId: CHAIN_HEX, nonce: hex(tx.nonce), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas), maxFeePerGas: hex(tx.maxFeePerGas),
    gasPrice: hex(BASE_FEE), gas: hex(tx.gas), to: tx.to, from: TRANSFER_OWNER, value: hex(tx.value), input: tx.data, accessList: [], v: hex(parity),
    yParity: hex(parity), r: hex(r), s: hex(s), hash };
}
/** Options: owner, balance, nonce, pendingNonce offset, code, chain, and fault injection for adversarial tests. */
export function createRobinhoodTransferChain(options = {}) {
  const state = { owner: options.owner ?? TRANSFER_OWNER, chain: options.chain ?? CHAIN_HEX, block: 1000, balance: BigInt(options.balance ?? 10n ** 16n),
    nonce: Number(options.nonce ?? 7), queued: Number(options.queued ?? 0), code: options.code ?? '0x', staleSeconds: Number(options.staleSeconds ?? 0),
    finalizedLag: Number(options.finalizedLag ?? 10_000), safeLag: Number(options.safeLag ?? 5_000), fault: options.fault ?? null };
  const history = new Map([[state.block, { balance: state.balance, nonce: state.nonce }]]), transactions = [], receipts = new Map();
  const at = tag => {
    const n = ['latest', 'pending'].includes(tag) ? state.block : Number(BigInt(tag));
    if (n >= state.block) return { balance: state.balance, nonce: state.nonce };
    return [...history.entries()].filter(([b]) => b <= n).at(-1)?.[1] ?? { balance: state.balance, nonce: state.nonce };
  };
  const block = (n, full) => ({ number: hex(n), hash: blockHash(n), parentHash: blockHash(n - 1), baseFeePerGas: hex(BASE_FEE),
    timestamp: hex(Math.floor(Date.now() / 1000) - state.staleSeconds), transactions: transactions.filter(t => Number(BigInt(t.blockNumber)) === n).map(t => full ? t : t.hash) });
  async function rpc(method, params = []) {
    switch (method) {
      case 'eth_chainId': return state.chain;
      case 'eth_blockNumber': return hex(state.block);
      case 'eth_gasPrice': return hex(BASE_FEE);
      case 'eth_getBlockByNumber': {
        const tag = params[0];
        const n = tag === 'latest' || tag === 'pending' ? state.block : tag === 'safe' ? state.block - state.safeLag : tag === 'finalized' ? state.block - state.finalizedLag : Number(BigInt(tag));
        return n > state.block ? null : block(n, Boolean(params[1]));
      }
      case 'eth_getBalance': return params[0] === state.owner ? hex(at(params[1]).balance) : '0x0';
      case 'eth_getTransactionCount': return params[0] !== state.owner ? '0x0' : params[1] === 'pending' ? hex(state.nonce + state.queued) : hex(at(params[1]).nonce);
      case 'eth_getCode': return params[0] === state.owner ? state.code : '0x';
      case 'eth_call': { const c = params[0]; if (c.data !== '0x' || BigInt(c.value) > at(params[1]).balance) throw new Error('MOCK_CALL_REVERT'); return '0x'; }
      case 'eth_estimateGas': return hex(GAS_USED);
      case 'eth_getTransactionByHash': return transactions.find(t => t.hash === params[0]) ?? null;
      case 'eth_getTransactionReceipt': return receipts.get(params[0]) ?? null;
      // Harness-only: the mocked wallet "broadcasts" here. A real network is never contacted.
      case 'MOCK_submit': {
        const tx = params[0];
        if (tx.from !== state.owner || tx.chainId !== CHAIN_HEX) throw new Error('MOCK_SUBMISSION_DENIED');
        const fault = state.fault, effective = { ...tx, nonce: state.nonce, maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? '0x0',
          ...fault === 'wrongRecipient' ? { to: '0x' + '2'.repeat(40) } : {}, ...fault === 'wrongValue' ? { value: hex(BigInt(tx.value) + 1n) } : {},
          ...fault === 'highFee' ? { maxFeePerGas: hex(BigInt(tx.maxFeePerGas) * 10n) } : {} };
        const signed = signFixtureTransfer(effective), n = state.block + 1, fee = GAS_USED * BASE_FEE;
        transactions.push({ ...signed, blockNumber: hex(n), blockHash: blockHash(n), transactionIndex: '0x1' });
        receipts.set(signed.hash, { transactionHash: signed.hash, from: state.owner, to: effective.to, blockNumber: hex(n), blockHash: blockHash(n),
          transactionIndex: '0x1', status: fault === 'revert' ? '0x0' : '0x1', gasUsed: hex(GAS_USED), gasUsedForL1: '0xb34', effectiveGasPrice: hex(BASE_FEE),
          cumulativeGasUsed: hex(GAS_USED), logs: fault === 'logs' ? [{ address: state.owner, topics: [], data: '0x' }] : [], type: '0x2' });
        state.balance -= fee + (effective.to === state.owner ? 0n : BigInt(effective.value)) + (fault === 'extraDebit' ? 1n : 0n);
        state.nonce += 1; history.set(n, { balance: state.balance, nonce: state.nonce }); state.block = n + 3;
        return signed.hash;
      }
      case 'MOCK_mine': state.block += Number(params[0] ?? 1); return hex(state.block);
      default: throw new Error('MOCK_RPC_METHOD_DENIED');
    }
  }
  return { state, rpc, transactions, receipts, history };
}
if (process.argv.includes('--serve')) {
  let model = createRobinhoodTransferChain();
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') { res.end('MOCKED Robinhood Testnet transfer harness'); return; }
      let body = ''; for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 1_048_576) throw new Error('MOCK_INPUT_TOO_LARGE'); }
      const value = JSON.parse(body);
      const result = value.method === 'MOCK_reset' ? (model = createRobinhoodTransferChain(value.params?.[0] ?? {}), true) : await model.rpc(value.method, value.params ?? []);
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
    } catch { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'MOCK_RPC_DENIED' } })); }
  });
  server.listen(8553, '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}

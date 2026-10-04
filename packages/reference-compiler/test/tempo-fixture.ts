// SPDX-License-Identifier: AGPL-3.0-only
/** MOCKED in-process chain only. The key below is a public test fixture, never used with a network. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { TEMPO_PAYMENT as p } from '@defi-workflow-engine/action-registry';
import { createTokenPaymentNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { supplyCall, supplyWord, supplyTopic, supplyHex, type TempoTransaction } from '../src/index.js';
import { tempoSigningBytes, tempoUnsignedFields } from '../src/tempo-envelope.js';
import { rlpEncode } from '../src/rlp.js';
const hex = (a: Uint8Array) => '0x' + Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
const key = new Uint8Array(32).fill(7);
export const tempoOwner = hex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
export const tempoRecipient = '0x2222222222222222222222222222222222222222';
export function tempoWorkflow(): SemanticWorkflow {
  return { schemaVersion: '1.0.0', workflowId: 'tempo-fixture', revision: 1, resourceEdges: [], nodes: [createTokenPaymentNode('payment', {
    chain: p.chain, token: p.token, decimals: 6, adapterId: p.adapterId, amount: '1000000', maximumFee: '10000', feeToken: p.token,
    recipient: tempoRecipient, memo: '0x' + '01'.repeat(32) })] };
}
export function signMockTempo(tx: TempoTransaction) {
  const sig = secp256k1.sign(keccak_256(tempoSigningBytes(tx)), key, { prehash: false, format: 'recovered' });
  // Noble recovered format is recovery byte || compact signature; Tempo is r || s || parity.
  const signature = Uint8Array.of(...sig.subarray(1), sig[0]! + 27);
  const raw = Uint8Array.of(0x76, ...rlpEncode([...tempoUnsignedFields(tx), signature]));
  return { raw: hex(raw), hash: hex(keccak_256(raw)) };
}
export function tempoFixture() {
  let now = Math.floor(Date.now() / 1000) * 1000; const blockHash = '0x' + 'aa'.repeat(32), receiptHash = '0x' + 'bb'.repeat(32);
  let mined: ReturnType<typeof signMockTempo> | null = null, transaction: TempoTransaction | null = null;
  const calls: string[] = [];
  const config = { balance: 100_000_000n, price: 1_000_000_000n, policy: 1n, paused: 0n, nonce: 0n,
    wrongChain: false, stale: false, hold: false, badFee: false, reorg: false, extraLog: false, code: '0x', pending: 0n };
  const logs = (fee = false) => [
    { address: p.token, topics: [supplyTopic('Transfer(address,address,uint256)'), '0x' + supplyWord(tempoOwner), '0x' + supplyWord(config.hold ? p.feeManager : tempoRecipient)], data: '0x' + supplyWord(1_000_000n) },
    { address: p.token, topics: [supplyTopic('TransferWithMemo(address,address,uint256,bytes32)'), '0x' + supplyWord(tempoOwner), '0x' + supplyWord(tempoRecipient), '0x' + '01'.repeat(32)], data: '0x' + supplyWord(1_000_000n) },
    ...fee ? [{ address: p.token, topics: [supplyTopic('Transfer(address,address,uint256)'), '0x' + supplyWord(tempoOwner), '0x' + supplyWord(p.feeManager)], data: '0x' + supplyWord(60n) }] : [],
    ...config.extraLog ? [{ address: p.token, topics: [], data: '0x' }] : [],
  ];
  async function rpc(method: string, params: readonly unknown[]): Promise<unknown> {
    calls.push(method);
    if (/send|sign|fund/i.test(method)) throw new Error('MOCK_SUBMISSION_DENIED');
    if (method === 'eth_chainId') return config.wrongChain ? '0x1' : p.chainHex;
    if (method === 'eth_gasPrice') return supplyHex(config.price);
    if (method === 'eth_blockNumber') return supplyHex(mined ? 101 : 100);
    if (method === 'eth_getBlockByNumber') {
      const n = params[0] === 'latest' || params[0] === 'finalized' ? mined ? 101 : 100 : Number(BigInt(String(params[0])));
      return { number: supplyHex(n), hash: n === 101 ? config.reorg ? blockHash : receiptHash : blockHash,
        timestamp: supplyHex(now / 1000 - (config.stale ? 100 : 0)), baseFeePerGas: supplyHex(config.price), transactions: n === 101 && mined ? [mined.hash] : [] };
    }
    if (method === 'eth_getCode') return config.code;
    if (method === 'eth_getTransactionCount') return supplyHex(params[1] === 'pending' ? config.pending : mined && params[1] !== '0x64' ? 1n : config.nonce);
    if (method === 'eth_call') {
      const q = params[0] as { data: string };
      if (q.data === supplyCall('decimals()')) return '0x' + supplyWord(6n);
      if (q.data === supplyCall('currency()')) return '0x' + supplyWord(32n) + supplyWord(3n) + '555344'.padEnd(64, '0');
      if (q.data === supplyCall('paused()')) return '0x' + supplyWord(config.paused);
      if (q.data === supplyCall('transferPolicyId()')) return '0x' + supplyWord(config.policy);
      const after = !!mined && params[1] !== '0x64';
      if (q.data === supplyCall('balanceOf(address)', tempoOwner)) return '0x' + supplyWord(config.balance - (after ? 1_000_060n : 0n));
      if (q.data === supplyCall('balanceOf(address)', tempoRecipient)) return '0x' + supplyWord(after ? 1_000_000n : 0n);
      throw new Error('MOCK_CALL_UNKNOWN');
    }
    if (method === 'eth_estimateGas') return supplyHex(60000);
    if (method === 'eth_simulateV1') return [{ calls: [{ status: '0x1', gasUsed: supplyHex(60000), logs: logs(true) }] }];
    if (method === 'eth_getRawTransactionByHash') return mined && mined.hash === params[0] ? mined.raw : null;
    if (method === 'eth_getTransactionByHash') return mined && mined.hash === params[0] ? { ...transaction, hash: mined.hash, blockNumber: '0x65', blockHash: receiptHash } : null;
    if (method === 'eth_getTransactionReceipt') return mined && mined.hash === params[0] ? { transactionHash: mined.hash, blockNumber: '0x65', blockHash: receiptHash,
      from: tempoOwner, status: '0x1', feeToken: p.token, feePayer: config.badFee ? tempoRecipient : tempoOwner, gasUsed: supplyHex(60000), effectiveGasPrice: supplyHex(config.price), logs: logs(true) } : null;
    throw new Error('MOCK_METHOD_UNKNOWN_' + method);
  }
  return { rpc, get now() { return now; }, advance(ms: number) { now += ms; }, config, calls, logs, mine(tx: TempoTransaction) { transaction = tx; mined = signMockTempo(tx); return mined; } };
}

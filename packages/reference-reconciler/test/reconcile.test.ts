import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { buildModeAPair, rlpDecode, rlpList, rlpEncode, rlpInteger, toHex } from '@defi-workflow-engine/reference-compiler';
import { APPROVAL_TOPIC, TRANSFER_TOPIC, reconcileModeA, type Receipt, type ReconcileInput } from '../src/reconcile.js';
function ephemeralKey(): Uint8Array {
  let key: Uint8Array;
  do { key = randomBytes(32); } while (!secp256k1.utils.isValidSecretKey(key));
  return key;
}
const tokenIn = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const tokenOut = '0x4200000000000000000000000000000000000006';
const router = '0x2626664c2603336e57b271c5c0b26f421741e481';
const topic = (a: string) => '0x' + '0'.repeat(24) + a.slice(2);
const data = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const sign = (unsigned: Uint8Array, key: Uint8Array) => {
  const signature = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key, { prehash: false, format: 'recovered' }), 'recovered');
  const body = rlpEncode([...rlpList(rlpDecode(unsigned.subarray(1))), rlpInteger(BigInt(signature.recovery!)), rlpInteger(signature.r), rlpInteger(signature.s)]);
  const raw = new Uint8Array(1 + body.length); raw[0] = 2; raw.set(body, 1);
  return { raw, hash: toHex(keccak_256(raw)) };
};
function fixture(): ReconcileInput {
  const key = ephemeralKey();
  const owner = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
  const pair = buildModeAPair({ owner, tokenIn, tokenOut, amountIn: 1000n, amountOutMinimum: 100n,
    fee: 500, deadline: 1_790_000_180n, nonce: 7n, approveGasLimit: 60_000n,
    swapGasLimit: 250_000n, maxFeePerGas: 3_000_000n });
  const approve = sign(pair.approveBytes, key); const swap = sign(pair.swapBytes, key);
  key.fill(0);
  return { owner, tokenIn, tokenOut, amountIn: 1000n, minimumOut: 100n, quotedOut: 110n,
    fee: 500, deadline: 1_790_000_180n, nonce: 7n,
    reviewedApprove: pair.approveBytes, reviewedSwap: pair.swapBytes,
    approveRaw: approve.raw, swapRaw: swap.raw, approveHash: approve.hash, swapHash: swap.hash,
    approveReceipt: { transactionHash: approve.hash, blockHash: '0x' + 'a'.repeat(64), status: 1,
      gasUsed: 50_000n, effectiveGasPrice: 1_000_000n, l1Fee: null,
      logs: [{ address: tokenIn, topics: [APPROVAL_TOPIC, topic(owner), topic(router)], data: data(1000n) }] },
    swapReceipt: { transactionHash: swap.hash, blockHash: '0x' + 'b'.repeat(64), status: 1,
      gasUsed: 200_000n, effectiveGasPrice: 1_000_000n, l1Fee: null,
      logs: [{ address: tokenIn, topics: [TRANSFER_TOPIC, topic(owner), topic(router)], data: data(1000n) },
        { address: tokenOut, topics: [TRANSFER_TOPIC, topic(router), topic(owner)], data: data(110n) }] },
    before: { input: 1000n, output: 0n, eth: 1_000_000_000_000_000_000n, allowance: 0n, nonce: 7n },
    afterApproval: { allowance: 1000n, nonce: 8n },
    after: { input: 0n, output: 110n, eth: 999_999_750_000_000_000n, allowance: 0n, nonce: 9n,
      routerInputResidue: 0n, routerOutputResidue: 0n },
    lastReadBlockHash: '0x' + 'c'.repeat(64), consistencyReadBlockHash: '0x' + 'c'.repeat(64) };
}
describe('independent Mode A effects reconciliation', () => {
  it('uses the independently derived ERC-20 event topics', () => {
    expect(TRANSFER_TOPIC).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
    expect(APPROVAL_TOPIC).toBe('0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925');
  });
  it('requires exact signed bytes, signer, logs, balances, allowance and fees', () => {
    expect(reconcileModeA(fixture())).toMatchObject({ outcome: 'RECONCILED', code: 'EXACT', observedOut: 110n });
  });
  it('fails closed on data gaps and inconsistent pinned rereads', () => {
    expect(reconcileModeA({ ...fixture(), swapRaw: null }).outcome).toBe('INCONCLUSIVE');
    expect(reconcileModeA({ ...fixture(), consistencyReadBlockHash: '0x' + 'd'.repeat(64) }).code).toBe('RPC_INCONSISTENT');
  });
  it('classifies tampered owner, receipt, logs, output, allowance, fees and router residue', () => {
    const base = fixture();
    expect(reconcileModeA({ ...base, owner: '0x' + '1'.repeat(40) }).outcome).toBe('DIVERGENT');
    expect(reconcileModeA({ ...base, swapReceipt: { ...base.swapReceipt!, status: 0 } }).code).toBe('TRANSACTION_REVERTED');
    expect(reconcileModeA({ ...base, swapReceipt: { ...base.swapReceipt!, logs: [] } }).code).toBe('TRANSFER_LOG_MISMATCH');
    expect(reconcileModeA({ ...base, after: { ...base.after, output: 99n } }).code).toBe('BALANCE_DELTA_MISMATCH');
    expect(reconcileModeA({ ...base, after: { ...base.after, allowance: 1n } }).code).toBe('ALLOWANCE_MISMATCH');
    expect(reconcileModeA({ ...base, after: { ...base.after, eth: base.after.eth + 1n } }).code).toBe('FEE_MISMATCH');
    expect(reconcileModeA({ ...base, after: { ...base.after, routerInputResidue: 1n } }).code).toBe('ROUTER_RESIDUE');
    expect(reconcileModeA({ ...base, after: { ...base.after, nonce: 8n } }).code).toBe('NONCE_CONSUMPTION_MISMATCH');
    expect(reconcileModeA({ ...base, approveReceipt: { ...base.approveReceipt!, gasUsed: 60_001n } }).code).toBe('FEE_INVALID');
    expect(reconcileModeA({ ...base, approveReceipt: { ...base.approveReceipt!, effectiveGasPrice: 3_000_001n } }).code).toBe('FEE_INVALID');
  });
});

import { reconcileWithScriptedTransport, type ReconcileScriptQuery } from '../src/reconcile.js';
describe('scripted independent chain reconciliation', () => {
  const blocks = { before: '0x' + '1'.repeat(64), afterApproval: '0x' + '2'.repeat(64), after: '0x' + 'c'.repeat(64) };
  function scenario(mutate: (query: ReconcileScriptQuery, value: unknown) => unknown = (_query, value) => value) {
    const source = fixture();
    const calls: ReconcileScriptQuery[] = [];
    const read = async (query: ReconcileScriptQuery): Promise<unknown> => {
      calls.push(query);
      let value: unknown;
      switch (query.kind) {
        case 'CHAIN': value = 31337; break;
        case 'RAW': value = query.transactionHash === source.approveHash ? source.approveRaw : source.swapRaw; break;
        case 'RECEIPT': value = query.transactionHash === source.approveHash ? source.approveReceipt : source.swapReceipt; break;
        case 'BEFORE': value = source.before; break;
        case 'AFTER_APPROVAL': value = source.afterApproval; break;
        case 'AFTER': value = source.after; break;
        case 'CONSISTENCY': value = blocks.after; break;
      }
      return mutate(query, value);
    };
    return { source, calls, read };
  }
  const staticInput = (source: ReconcileInput) => ({ owner: source.owner, tokenIn: source.tokenIn,
    tokenOut: source.tokenOut, amountIn: source.amountIn, minimumOut: source.minimumOut,
    quotedOut: source.quotedOut, fee: source.fee, deadline: source.deadline, nonce: source.nonce,
    reviewedApprove: source.reviewedApprove, reviewedSwap: source.reviewedSwap,
    approveHash: source.approveHash, swapHash: source.swapHash });
  it('uses only independent scripted chain reads and reconciles exact effects', async () => {
    const s = scenario();
    const outcome = await reconcileWithScriptedTransport(staticInput(s.source), s.read, blocks);
    expect(outcome).toMatchObject({ outcome: 'RECONCILED', code: 'EXACT' });
    expect(s.calls.map(query => query.kind)).toEqual(['CHAIN', 'RAW', 'RAW', 'RECEIPT', 'RECEIPT',
      'BEFORE', 'AFTER_APPROVAL', 'AFTER', 'CONSISTENCY']);
    expect(s.calls.slice(-4).map(query => 'blockHash' in query ? query.blockHash : null))
      .toEqual([blocks.before, blocks.afterApproval, blocks.after, blocks.after]);
  });
  it('fails closed on a lying chain, tail, receipt, logs or raw transaction', async () => {
    for (const [change, expected] of [
      [(query: ReconcileScriptQuery, value: unknown) => query.kind === 'CHAIN' ? 8453 : value, 'FORK_CHAIN_MISMATCH'],
      [(query: ReconcileScriptQuery, value: unknown) => query.kind === 'CONSISTENCY' ? blocks.before : value, 'RPC_INCONSISTENT'],
      [(query: ReconcileScriptQuery, value: unknown) => query.kind === 'RECEIPT' ? { ...(value as Receipt), transactionHash: blocks.before } : value, 'RECEIPT_MISMATCH'],
      [(query: ReconcileScriptQuery, value: unknown) => query.kind === 'RECEIPT' && (value as Receipt).logs.some(log => log.topics[0] === TRANSFER_TOPIC) ? { ...(value as Receipt), logs: [] } : value, 'TRANSFER_LOG_MISMATCH'],
      [(query: ReconcileScriptQuery, value: unknown) => query.kind === 'RAW' ? new Uint8Array([2, 1]) : value, 'TX_HASH_MISMATCH'],
    ] as const) {
      const s = scenario(change);
      const outcome = await reconcileWithScriptedTransport(staticInput(s.source), s.read, blocks);
      expect(outcome.code).toBe(expected);
      expect(outcome.outcome).not.toBe('RECONCILED');
    }
  });
});

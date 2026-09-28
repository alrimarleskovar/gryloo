// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { buildLiquidityPayload, LIQUIDITY_WETH, POSITION_MANAGER, rlpDecode, rlpEncode, rlpInteger, rlpList, toHex } from '@defi-workflow-engine/reference-compiler';
import { reconcileLiquidity, type LiquidityReconcileInput } from '../src/liquidity.js';
const key = new Uint8Array(32).fill(1);
const owner = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
const addressTopic = (address: string) => `0x${address.slice(2).padStart(64, '0')}`;
const approvalTopic = toHex(keccak_256(new TextEncoder().encode('Approval(address,address,uint256)')));
const block = `0x${'a'.repeat(64)}`;
function signed(unsigned: Uint8Array) {
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key, { prehash: false, format: 'recovered' }), 'recovered');
  const body = rlpEncode([...rlpList(rlpDecode(unsigned.subarray(1))), rlpInteger(BigInt(sig.recovery!)), rlpInteger(sig.r), rlpInteger(sig.s)]);
  const raw = new Uint8Array(body.length + 1); raw[0] = 2; raw.set(body, 1);
  return { raw, transactionHash: toHex(keccak_256(raw)) };
}
function approval(): LiquidityReconcileInput {
  const call = { kind: 'APPROVE' as const, token: LIQUIDITY_WETH, amount: 100n };
  const nonce = 4n, gasLimit = 150_000n, maxFeePerGas = 3_000_000n;
  const reviewedBytes = buildLiquidityPayload(call, { nonce, gasLimit, maxFeePerGas }).bytes;
  const signature = signed(reviewedBytes);
  const fee = 50_000n * 1_000_000n + 1000n;
  const before = { blockHash: `0x${'b'.repeat(64)}`, owner, nonce, weth: 500n, usdc: 200n,
    eth: 1_000_000_000_000_000_000n, wethAllowance: 0n, usdcAllowance: 0n, position: null };
  const after = { ...before, blockHash: block, nonce: nonce + 1n, eth: before.eth - fee, wethAllowance: call.amount };
  return { call, owner, before, after, consistencyBlockHash: block, reviewedBytes, signedRaw: signature.raw,
    transactionHash: signature.transactionHash, nonce, gasLimit, maxFeePerGas, knownL1Fee: 1000n,
    receipt: { transactionHash: signature.transactionHash, blockHash: block, status: 1, gasUsed: 50_000n,
      effectiveGasPrice: 1_000_000n, l1Fee: 1000n,
      logs: [{ address: LIQUIDITY_WETH, topics: [approvalTopic, addressTopic(owner), addressTopic(POSITION_MANAGER)],
        data: `0x${call.amount.toString(16).padStart(64, '0')}` }] } };
}
describe('independent liquidity reconciliation', () => {
  it('reconciles an exact signed finite approval with nonce, fee, allowance and receipt log', () => {
    expect(reconcileLiquidity(approval())).toMatchObject({ outcome: 'RECONCILED', code: 'EXACT_APPROVAL', remainingWethAllowance: 100n });
  });
  it('fails closed on missing raw bytes, changed approval log, receipt block, nonce and fee', () => {
    const base = approval();
    expect(reconcileLiquidity({ ...base, signedRaw: null }).outcome).toBe('INCONCLUSIVE');
    expect(reconcileLiquidity({ ...base, receipt: { ...base.receipt!, logs: [] } }).code).toBe('APPROVAL_LOG_MISMATCH');
    expect(reconcileLiquidity({ ...base, receipt: { ...base.receipt!, blockHash: `0x${'c'.repeat(64)}` } }).code).toBe('RECEIPT_MISMATCH');
    expect(reconcileLiquidity({ ...base, after: { ...base.after, nonce: base.nonce } }).code).toBe('OWNER_NONCE_MISMATCH');
    expect(reconcileLiquidity({ ...base, after: { ...base.after, eth: base.after.eth + 1n } }).code).toBe('FEE_MISMATCH');
    expect(reconcileLiquidity({ ...base, consistencyBlockHash: `0x${'d'.repeat(64)}` }).code).toBe('RPC_INCONSISTENT');
  });
});

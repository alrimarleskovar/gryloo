// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { fromHex, rlpEncode, rlpInteger, toHex } from '@defi-workflow-engine/reference-compiler';
import { decodeModeBSignedTransaction, reconcileModeB, type ModeBChainEvidence } from '../src/mode-b.js';
const safe = '0xefd6d9fde78f6371c752ae171417aa48c372ca51';
const roles = '0x7063d50cbafc8872af48b3169dc43a03decb49a1';
const executor = '0xa671534ceaa58a67b6f826d5f0188b97faa1e643';
const owner = '0x06033e064fb5515b2ca030e650ee6289e28d9c60';
const target = '0x2626664c2603336e57b271c5c0b26f421741e481';
const digest = '0x' + 'a'.repeat(64);
function evidence(): ModeBChainEvidence {
  return { chainId: 31337, safe, roles, rolesOwner: safe, executor, transactionSigner: executor, target,
    transactionTo: roles, transactionInput: '0x12345678', expectedInput: '0x12345678',
    safeCodeHash: digest, expectedSafeCodeHash: digest, rolesCodeHash: digest, expectedRolesCodeHash: digest,
    owner, expectedOwner: owner, threshold: 1, moduleEnabled: true, roleAssigned: true, allowanceRemaining: 0n,
    transactionReceipt: { status: 1, blockHash: digest }, inputDebited: 100n, outputCredited: 90n,
    amountIn: 100n, minimumOut: 80n, residualTokenAllowance: 0n };
}
describe('independent Mode B reconciliation', () => {
  it('accepts exact bytes, Safe ownership, consumed budget and token deltas', () => {
    expect(reconcileModeB(evidence()).outcome).toBe('RECONCILED');
  });
  it('rejects signer, owner, code, amount, output and budget divergence', () => {
    const base = evidence();
    for (const changed of [
      { transactionSigner: owner }, { rolesOwner: owner }, { safeCodeHash: '0x' + 'b'.repeat(64) },
      { transactionInput: '0x12345679' }, { inputDebited: 99n }, { outputCredited: 79n }, { allowanceRemaining: 1n },
    ]) expect(reconcileModeB({ ...base, ...changed }).outcome).toBe('DIVERGENT');
  });
  it('keeps a missing receipt inconclusive and a revert separate from reconciliation', () => {
    expect(reconcileModeB({ ...evidence(), transactionReceipt: null }).outcome).toBe('INCONCLUSIVE');
    expect(reconcileModeB({ ...evidence(), transactionReceipt: { status: 0, blockHash: digest } }).outcome).toBe('REVERTED');
  });
});
describe('Mode B signed transaction decoding', () => {
  const key = new Uint8Array(32).fill(7);
  const signer = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
  const target = '0x329d16e745216b393c1e6ece8d0e3c9ac5b8e241';
  function sign(overrides: { chainId?: bigint; value?: bigint; accessList?: unknown[] } = {}) {
    const fields = [rlpInteger(overrides.chainId ?? 31337n), rlpInteger(3n), rlpInteger(1_005_000_000n), rlpInteger(2_000_000_000n),
      rlpInteger(3_000_000n), fromHex(target), rlpInteger(overrides.value ?? 0n), fromHex('0x6a761202abcd'), overrides.accessList ?? []];
    const unsigned = Uint8Array.of(2, ...rlpEncode(fields as Parameters<typeof rlpEncode>[0]));
    const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key, { prehash: false, format: 'recovered' }), 'recovered');
    const raw = Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(BigInt(sig.recovery!)), rlpInteger(sig.r), rlpInteger(sig.s)] as Parameters<typeof rlpEncode>[0]));
    return { raw, hash: toHex(keccak_256(raw)) };
  }
  it('accepts wallet-chosen fees and recovers the exact signer, target and calldata', () => {
    const { raw, hash } = sign();
    expect(decodeModeBSignedTransaction(raw, hash)).toMatchObject({ signer, to: target, data: '0x6a761202abcd', nonce: 3n,
      maxPriorityFeePerGas: 1_005_000_000n, maxFeePerGas: 2_000_000_000n, gasLimit: 3_000_000n });
  });
  it('refuses another chain, value, access list, hash or non-canonical bytes', () => {
    const other = sign({ chainId: 8453n });
    expect(() => decodeModeBSignedTransaction(other.raw, other.hash)).toThrow('CHAIN_MISMATCH');
    const valued = sign({ value: 1n });
    expect(() => decodeModeBSignedTransaction(valued.raw, valued.hash)).toThrow('VALUE_NOT_ZERO');
    const listed = sign({ accessList: [[fromHex(target), []]] });
    expect(() => decodeModeBSignedTransaction(listed.raw, listed.hash)).toThrow('ACCESS_LIST_INVALID');
    const good = sign();
    expect(() => decodeModeBSignedTransaction(good.raw, '0x' + '0'.repeat(64))).toThrow('TX_HASH_MISMATCH');
    const padded = Uint8Array.of(...good.raw, 0);
    expect(() => decodeModeBSignedTransaction(padded, toHex(keccak_256(padded)))).toThrow();
  });
});

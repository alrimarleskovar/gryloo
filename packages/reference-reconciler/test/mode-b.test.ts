// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { reconcileModeB, type ModeBChainEvidence } from '../src/mode-b.js';
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

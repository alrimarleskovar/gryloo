// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { fromHex, rlpEncode, rlpInteger, toHex, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '@defi-workflow-engine/reference-compiler';
import { reconcileCompositionMint, type CompositionMintEvidence } from '../src/composition.js';
const safe = '0x1111111111111111111111111111111111111111', roles = '0x2222222222222222222222222222222222222222';
const pool = '0x3333333333333333333333333333333333333333';
const key = new Uint8Array(32).fill(7), signer = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
const digest = '0x' + 'a'.repeat(64), data = '0x6a761202abcd';
const topic = (signature: string) => toHex(keccak_256(new TextEncoder().encode(signature)));
const addressTopic = (address: string) => '0x' + address.slice(2).padStart(64, '0');
function fixture(): CompositionMintEvidence {
  const fields = [rlpInteger(31337n), rlpInteger(3n), rlpInteger(1_000_000n), rlpInteger(2_000_000n),
    rlpInteger(3_000_000n), fromHex(roles), rlpInteger(0n), fromHex(data), []];
  const unsigned = Uint8Array.of(2, ...rlpEncode(fields as Parameters<typeof rlpEncode>[0]));
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key, { prehash: false, format: 'recovered' }), 'recovered');
  const raw = Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(BigInt(sig.recovery!)), rlpInteger(sig.r), rlpInteger(sig.s)] as Parameters<typeof rlpEncode>[0]));
  return { chainId: 31337, transactionHash: toHex(keccak_256(raw)), raw, safe, roles, pool, executor: signer,
    expectedRoleCall: data, expectedSafeCodeHash: digest, actualSafeCodeHash: digest,
    expectedRolesCodeHash: digest, actualRolesCodeHash: digest,
    receipt: { status: 1, blockHash: digest, gasUsed: 500_000n, effectiveGasPrice: 1_000_000n,
      logs: [{ address: POSITION_MANAGER, topics: [topic('Transfer(address,address,uint256)'), '0x' + '0'.repeat(64), addressTopic(safe), '0x' + '0'.repeat(63) + '7'], data: '0x' },
        { address: LIQUIDITY_WETH, topics: [topic('Transfer(address,address,uint256)'), addressTopic(safe), addressTopic(pool)], data: '0x' + (50n).toString(16).padStart(64, '0') },
        { address: LIQUIDITY_USDC, topics: [topic('Transfer(address,address,uint256)'), addressTopic(safe), addressTopic(pool)], data: '0x' + (100n).toString(16).padStart(64, '0') }] },
    stateBlockHash: digest, beforeWETH: 100n, afterWETH: 50n, beforeUSDC: 200n, afterUSDC: 100n,
    remainingMintCalls: 0n, remainingWETHAllowance: 50n, remainingUSDCAllowance: 100n,
    maxWETH: 100n, maxUSDC: 200n, minWETH: 1n, minUSDC: 1n, tickLower: -10, tickUpper: 10,
    desiredWETH: 100n, desiredUSDC: 200n,
    position: { tokenId: 7n, owner: safe, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC,
      fee: 500, tickLower: -10, tickUpper: 10, liquidity: 5n, owed0: 0n, owed1: 0n } };
}
describe('independent composed mint reconciliation', () => {
  it('requires signed Roles call, Safe NFT, exact range, bounded deposits and consumed mint authority', () => {
    expect(reconcileCompositionMint(fixture())).toMatchObject({ outcome: 'RECONCILED', tokenId: '7',
      depositedWETH: '50', depositedUSDC: '100', residualWETH: '50', residualUSDC: '100', earnedFees: 'UNOBSERVED' });
  });
  it('rejects false ownership, unconsumed role, changed bytes and excessive deposit', () => {
    const base = fixture();
    for (const changed of [
      { position: { ...base.position!, owner: roles } }, { remainingMintCalls: 1n },
      { expectedRoleCall: '0x6a761202abce' }, { afterUSDC: -1n },
      { receipt: { ...base.receipt!, logs: [] } },
    ]) expect(reconcileCompositionMint({ ...base, ...changed }).outcome).toBe('DIVERGENT');
    expect(reconcileCompositionMint({ ...base, raw: null }).outcome).toBe('INCONCLUSIVE');
  });
});

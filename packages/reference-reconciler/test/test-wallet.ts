// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001: an arbitrary external wallet for tests. Each call creates a fresh random secp256k1 key that exists only
 * in this process's memory (never written, logged or committed) and signs EIP-191 `personal_sign` messages with it, so the
 * real server-side sign-in verification runs. It holds nothing on any network; loopback MOCKED chains never check signatures.
 * Test code only (never part of the package build): Flofi itself never signs.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { personalSignDigest } from '../src/personal-sign.ts';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
export type TestWallet = { readonly address: string; signMessage(message: string): string };
export function createTestWallet(): TestWallet {
  const signer = secp256k1.utils.randomSecretKey();
  const address = '0x' + hex(keccak_256(secp256k1.getPublicKey(signer, false).subarray(1)).subarray(12));
  return Object.freeze({
    address,
    /** `personal_sign` of a UTF-8 message: 65 bytes r ‖ s ‖ v with v ∈ {27, 28}. */
    signMessage(message: string): string {
      const digest = personalSignDigest(message);
      const recovered = secp256k1.sign(digest, signer, { prehash: false, format: 'recovered' });
      return '0x' + hex(recovered.subarray(1)) + (recovered[0]! + 27).toString(16).padStart(2, '0');
    },
  });
}
/** A `personal_sign` request's first parameter: a 0x-hex UTF-8 message (or a plain string). */
export function personalSignText(param: unknown): string {
  if (typeof param !== 'string') throw new Error('MOCK_SIGN_MESSAGE_INVALID');
  return /^0x(?:[0-9a-fA-F]{2})*$/.test(param) ? Buffer.from(param.slice(2), 'hex').toString('utf8') : param;
}

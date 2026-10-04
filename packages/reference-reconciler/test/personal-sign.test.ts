// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { checksumAddress, recoverPersonalSigner } from '../src/personal-sign.js';
import { createTestWallet } from './test-wallet.ts';

/** BUILD-JOURNEY-001: wallet sign-in verification primitives (recovery only; nothing here signs). */
describe('personal_sign verification', () => {
  it('recovers exactly the signer of a personal_sign message, for v 27/28 and 0/1', () => {
    const wallet = createTestWallet(), signature = wallet.signMessage('Sign in to Flofi');
    expect(recoverPersonalSigner('Sign in to Flofi', signature)).toBe(wallet.address);
    const v = parseInt(signature.slice(130), 16);
    expect(recoverPersonalSigner('Sign in to Flofi', signature.slice(0, 130) + (v - 27).toString(16).padStart(2, '0'))).toBe(wallet.address);
    expect(recoverPersonalSigner('Sign in to Flofi!', signature)).not.toBe(wallet.address);
    expect(createTestWallet().address).not.toBe(wallet.address);
  });
  it('rejects malformed signatures and recovery bytes', () => {
    const signature = createTestWallet().signMessage('x');
    for (const bad of ['0x', signature.slice(0, 128), signature.slice(0, 130) + '1d', signature.slice(0, 130) + '05', '0x' + '00'.repeat(65)])
      expect(() => recoverPersonalSigner('x', bad)).toThrow('WALLET_SIGNATURE_INVALID');
  });
  it('computes EIP-55 checksums', () => {
    expect(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(checksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');
    expect(() => checksumAddress('0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED')).toThrow('WALLET_ADDRESS_INVALID');
  });
});

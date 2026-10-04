// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001: verification primitives for wallet sign-in — EIP-191 `personal_sign` signer recovery and EIP-55
 * checksums. Verification only: nothing here holds a key or signs.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const ACCOUNT = /^0x[0-9a-f]{40}$/, SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
/** EIP-55 mixed-case checksum of a lower-case address. */
export function checksumAddress(address: string): string {
  if (!ACCOUNT.test(address)) throw new Error('WALLET_ADDRESS_INVALID');
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(address.slice(2)))).toString('hex');
  return '0x' + [...address.slice(2)].map((c, i) => parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c).join('');
}
/** keccak256("\x19Ethereum Signed Message:\n" + byte length + message), the digest a wallet signs for `personal_sign`. */
export function personalSignDigest(message: string): Uint8Array {
  const bytes = new TextEncoder().encode(message);
  return keccak_256(Uint8Array.from([...new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`), ...bytes]));
}
/** The lower-case signer of a 65-byte r ‖ s ‖ v `personal_sign` signature (v ∈ {27, 28} or {0, 1}, low-s). Throws `WALLET_SIGNATURE_INVALID`. */
export function recoverPersonalSigner(message: string, signature: string): string {
  if (!SIGNATURE.test(signature)) throw new Error('WALLET_SIGNATURE_INVALID');
  const digest = personalSignDigest(message), raw = Uint8Array.from(Buffer.from(signature.slice(2), 'hex')), v = raw[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) throw new Error('WALLET_SIGNATURE_INVALID');
  try {
    const compact = raw.subarray(0, 64), publicKey = secp256k1.Signature.fromBytes(compact).addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false);
    if (!secp256k1.verify(compact, digest, publicKey, { prehash: false })) throw new Error('WALLET_SIGNATURE_INVALID');
    return '0x' + Buffer.from(keccak_256(publicKey.subarray(1)).subarray(12)).toString('hex');
  } catch (cause) { throw new Error('WALLET_SIGNATURE_INVALID', { cause }); }
}

// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-safe strict envelope verifier. Protocol source: tempoxyz/tempo tempo_transaction.rs. */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { rlpEncode, rlpDecode, rlpList, rlpBytes, rlpInteger, type RlpValue } from './rlp.js';
import type { TempoTransaction } from './tempo.js';
const hex = (bytes: Uint8Array) => '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const bytes = (s: string) => {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(s) || s.length > 16384) throw new Error('TEMPO_SIGNED_BYTES_INVALID');
  return Uint8Array.from(s.slice(2).match(/../g) ?? [], v => parseInt(v, 16));
};
export function tempoUnsignedFields(tx: TempoTransaction): RlpValue[] {
  return [rlpInteger(BigInt(tx.chainId)), rlpInteger(BigInt(tx.maxPriorityFeePerGas)), rlpInteger(BigInt(tx.maxFeePerGas)), rlpInteger(BigInt(tx.gas)),
    tx.calls.map(c => [bytes(c.to), rlpInteger(BigInt(c.value)), bytes(c.data)]), [], rlpInteger(BigInt(tx.nonceKey)), rlpInteger(BigInt(tx.nonce)),
    rlpInteger(BigInt(tx.validBefore)), new Uint8Array(), bytes(tx.feeToken), new Uint8Array(), []];
}
export function tempoSigningBytes(tx: TempoTransaction): Uint8Array { return Uint8Array.of(0x76, ...rlpEncode(tempoUnsignedFields(tx))); }
/** No permissive decoding: every unsigned byte must match, with no sponsorship/AA/key authorization. */
export function verifyTempoSignedEnvelope(raw: string, tx: TempoTransaction): { hash: string; signer: string } {
  const b = bytes(raw);
  if (b[0] !== 0x76) throw new Error('TEMPO_WALLET_ENVELOPE_UNSUPPORTED');
  const fields = rlpList(rlpDecode(b.subarray(1)));
  if (fields.length !== 14 || hex(rlpEncode(fields)) !== hex(b.subarray(1)) ||
      hex(rlpEncode(fields.slice(0, 13))) !== hex(rlpEncode(tempoUnsignedFields(tx)))) throw new Error('TEMPO_SIGNED_PAYLOAD_MISMATCH');
  const signature = rlpBytes(fields[13]!);
  if (signature.length !== 65 || ![0, 1, 27, 28].includes(signature[64]!)) throw new Error('TEMPO_SIGNATURE_UNSUPPORTED');
  const digest = keccak_256(tempoSigningBytes(tx));
  const sig = secp256k1.Signature.fromBytes(signature.subarray(0, 64)).addRecoveryBit(signature[64]! >= 27 ? signature[64]! - 27 : signature[64]!);
  const pub = sig.recoverPublicKey(digest).toBytes(false), signer = hex(keccak_256(pub.subarray(1)).subarray(12));
  if (signer !== tx.from || !secp256k1.verify(sig.toBytes('compact'), digest, pub, { prehash: false })) throw new Error('TEMPO_SIGNER_MISMATCH');
  return { hash: hex(keccak_256(b)), signer };
}

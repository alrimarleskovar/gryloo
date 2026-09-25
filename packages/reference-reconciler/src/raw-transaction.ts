// SPDX-License-Identifier: AGPL-3.0-only
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { decodeUnsignedPayload, parseRlpInteger, rlpBytes, rlpDecode, rlpList, rlpInteger, rlpEncode, toHex, type UnsignedPayload } from '@defi-workflow-engine/reference-compiler';
import { FORK_CHAIN_ID } from '@defi-workflow-engine/reference-compiler';
function fail(code: string): never { throw new Error(code); }
function equal(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function word(value: bigint): Uint8Array {
  if (value <= 0n || value >= 1n << 256n) fail('SIGNATURE_INVALID');
  const bytes = rlpInteger(value);
  const result = new Uint8Array(32); result.set(bytes, 32 - bytes.length); return result;
}
export type SignedTransaction = { readonly rawHash: string; readonly signer: string;
  readonly unsignedBytes: Uint8Array; readonly unsigned: UnsignedPayload;
  readonly yParity: 0 | 1; readonly r: bigint; readonly s: bigint };
/** Decode independent chain bytes; never use a wallet-reported transaction object as evidence. */
export function decodeSignedTransaction(raw: Uint8Array, expectedHash: string): SignedTransaction {
  if (!(raw instanceof Uint8Array) || raw[0] !== 2) fail('TRANSACTION_TYPE_INVALID');
  const rawHash = toHex(keccak_256(raw));
  if (rawHash !== expectedHash) fail('TX_HASH_MISMATCH');
  const fields = rlpList(rlpDecode(raw.subarray(1)));
  if (fields.length !== 12) fail('SIGNED_TRANSACTION_SHAPE');
  const chainId = parseRlpInteger(fields[0]!);
  if (chainId !== BigInt(FORK_CHAIN_ID)) fail('CHAIN_MISMATCH');
  const to = rlpBytes(fields[5]!);
  if (to.length !== 20) fail('TARGET_INVALID');
  if (rlpList(fields[8]!).length !== 0) fail('ACCESS_LIST_INVALID');
  const yParity = parseRlpInteger(fields[9]!);
  if (yParity !== 0n && yParity !== 1n) fail('SIGNATURE_INVALID');
  const r = parseRlpInteger(fields[10]!);
  const s = parseRlpInteger(fields[11]!);
  const unsignedRlp = rlpEncode(fields.slice(0, 9));
  const unsignedBytes = new Uint8Array(1 + unsignedRlp.length);
  unsignedBytes[0] = 2; unsignedBytes.set(unsignedRlp, 1);
  const unsigned = decodeUnsignedPayload(unsignedBytes);
  const signingHash = keccak_256(unsignedBytes);
  const signature = secp256k1.Signature.fromBytes(Uint8Array.of(...word(r), ...word(s))).addRecoveryBit(Number(yParity));
  const pubkey = signature.recoverPublicKey(signingHash).toBytes(false);
  const signer = toHex(keccak_256(pubkey.subarray(1)).subarray(12));
  if (!secp256k1.verify(signature.toBytes('compact'), signingHash, pubkey, { prehash: false })) fail('SIGNATURE_INVALID');
  const reencoded = rlpEncode(fields);
  const canonical = new Uint8Array(1 + reencoded.length); canonical[0] = 2; canonical.set(reencoded, 1);
  if (!equal(raw, canonical)) fail('SIGNED_TRANSACTION_NON_CANONICAL');
  return { rawHash, signer, unsignedBytes, unsigned, yParity: Number(yParity) as 0 | 1, r, s };
}
export function verifySignedPayload(raw: Uint8Array, expectedHash: string, expectedOwner: string,
  reviewedUnsignedBytes: Uint8Array): SignedTransaction {
  const signed = decodeSignedTransaction(raw, expectedHash);
  if (signed.signer !== expectedOwner) fail('SIGNER_MISMATCH');
  if (!equal(signed.unsignedBytes, reviewedUnsignedBytes)) fail('PAYLOAD_FIDELITY_FAILED');
  return signed;
}

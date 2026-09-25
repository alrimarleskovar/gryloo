import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { fromHex, toHex, rlpDecode, rlpList, rlpEncode, rlpInteger, decodeUnsignedPayload, encodeUnsignedPayload, decodeSwap, encodeSwap } from '@defi-workflow-engine/reference-compiler';
import { decodeSignedTransaction, verifySignedPayload } from '../src/raw-transaction.js';
import { randomBytes } from 'node:crypto';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url), 'utf8'));
function ephemeralKey(): Uint8Array {
  let key: Uint8Array;
  do { key = randomBytes(32); } while (!secp256k1.utils.isValidSecretKey(key));
  return key;
}
function signed(unsigned: Uint8Array, key: Uint8Array): Uint8Array {
  const signature = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), key,
    { prehash: false, format: 'recovered' }), 'recovered');
  const fields = rlpList(rlpDecode(unsigned.subarray(1)));
  const body = rlpEncode([...fields, rlpInteger(BigInt(signature.recovery!)), rlpInteger(signature.r), rlpInteger(signature.s)]);
  const raw = new Uint8Array(1 + body.length); raw[0] = 2; raw.set(body, 1); return raw;
}
describe('independent signed transaction fidelity', () => {
  it('recovers signer and compares byte-identical unsigned payload', () => {
    const unsigned = fromHex(vector.approve.unsignedHex);
    const key = ephemeralKey();
    const owner = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
    const raw = signed(unsigned, key);
    key.fill(0);
    const hash = toHex(keccak_256(raw));
    const decoded = verifySignedPayload(raw, hash, owner, unsigned);
    expect(decoded.signer).toBe(owner);
    expect(toHex(decoded.unsignedBytes)).toBe(vector.approve.unsignedHex);
    expect(decoded.rawHash).toBe(hash);
  });
  it('rejects transaction hash, signer, gas and recipient changes', () => {
    const unsigned = fromHex(vector.swap.unsignedHex);
    const key = ephemeralKey();
    const owner = toHex(keccak_256(secp256k1.getPublicKey(key, false).subarray(1)).subarray(12));
    const raw = signed(unsigned, key);
    key.fill(0);
    const hash = toHex(keccak_256(raw));
    expect(() => decodeSignedTransaction(raw, '0x' + '0'.repeat(64))).toThrow('TX_HASH_MISMATCH');
    expect(() => verifySignedPayload(raw, hash, '0x' + '0'.repeat(40), unsigned)).toThrow('SIGNER_MISMATCH');
    const gasChanged = unsigned.slice(); gasChanged[14] ^= 1;
    expect(() => verifySignedPayload(raw, hash, owner, gasChanged)).toThrow('PAYLOAD_FIDELITY_FAILED');
    const decoded = decodeUnsignedPayload(unsigned);
    for (const altered of [
      encodeUnsignedPayload({ ...decoded, maxFeePerGas: decoded.maxFeePerGas + 1n }),
      encodeUnsignedPayload({ ...decoded, nonce: decoded.nonce + 1n }),
      encodeUnsignedPayload({ ...decoded, data: encodeSwap({ ...decodeSwap(decoded.data),
        recipient: '0x' + '3'.repeat(40) }) }),
    ]) expect(() => verifySignedPayload(raw, hash, owner, altered)).toThrow('PAYLOAD_FIDELITY_FAILED');
    const wrongKey = ephemeralKey();
    const alternate = signed(unsigned, wrongKey);
    wrongKey.fill(0);
    expect(() => verifySignedPayload(alternate, toHex(keccak_256(alternate)), owner, unsigned)).toThrow('SIGNER_MISMATCH');
  });
});

import { describe, expect, it } from 'vitest';
import { rlpDecode, rlpEncode, rlpInteger, parseRlpInteger } from '../src/rlp.js';

describe('strict minimal RLP', () => {
  it('round trips byte strings, lists and integer boundaries', () => {
    for (const value of [0n, 1n, 127n, 128n, 255n, 256n, (1n << 256n) - 1n]) {
      expect(parseRlpInteger(rlpDecode(rlpEncode(rlpInteger(value))))).toBe(value);
    }
    expect(rlpEncode([])).toEqual(Uint8Array.of(0xc0));
    expect(rlpEncode(new Uint8Array())).toEqual(Uint8Array.of(0x80));
    expect(rlpEncode(new Uint8Array(56))[0]).toBe(0xb8);
    expect(rlpEncode([new Uint8Array(56)])[0]).toBe(0xf8);
  });
  it.each([
    [0x81, 0x01], [0xb8, 0x01, 0x80], [0xb8, 0x00], [0xc1, 0x80, 0x00],
    [0xf8, 0x01, 0x80], [0xb8, 0x38], [0x80, 0x00], [0x82, 0x01],
  ])('rejects malformed or nonminimal bytes %j', (...bytes) => {
    expect(() => rlpDecode(Uint8Array.from(bytes))).toThrow('RLP_NON_CANONICAL');
  });
  it('rejects zero padded integer', () => {
    expect(() => parseRlpInteger(Uint8Array.of(0, 1))).toThrow('RLP_NON_CANONICAL');
  });
});

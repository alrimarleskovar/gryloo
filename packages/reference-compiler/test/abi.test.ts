import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeApprove, decodeSwap, encodeApprove, encodeSwap, SWAP_ROUTER_02 } from '../src/abi.js';
import { fromHex, toHex } from '../src/payload.js';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url), 'utf8'));

describe('canonical exact-call ABI', () => {
  it('re-encodes the frozen finite approval and one-call multicall byte for byte', () => {
    const approval = decodeApprove(fromHex(vector.approve.data));
    expect(approval).toEqual({ spender: SWAP_ROUTER_02, amount: 1_000_000n });
    expect(toHex(encodeApprove(approval.spender, approval.amount))).toBe(vector.approve.data);
    const swap = decodeSwap(fromHex(vector.swap.data));
    expect(swap).toEqual({ tokenIn: vector.tokenIn, tokenOut: vector.tokenOut, fee: 500,
      recipient: vector.owner, amountIn: 1_000_000n, amountOutMinimum: 100_000_000_000_000n,
      sqrtPriceLimitX96: 0n, deadline: 1_790_000_180n });
    expect(toHex(encodeSwap(swap))).toBe(vector.swap.data);
  });
  it('rejects extra multicall entries, wrong offsets, nonzero padding and unknown selectors', () => {
    const original = fromHex(vector.swap.data);
    for (const [offset, value] of [[4 + 2 * 32 + 31, 2], [4 + 32 + 31, 65],
      [original.length - 1, 1], [0, 0]] as const) {
      const bad = original.slice(); bad[offset] = value;
      expect(() => decodeSwap(bad)).toThrow('ABI_NON_CANONICAL');
    }
    const badApprove = fromHex(vector.approve.data);
    badApprove[4] = 1;
    expect(() => decodeApprove(badApprove)).toThrow('ABI_NON_CANONICAL');
  });
});

import { keccak_256 } from '@noble/hashes/sha3.js';
import { APPROVE_SELECTOR, MULTICALL_SELECTOR, EXACT_INPUT_SINGLE_SELECTOR } from '../src/abi.js';
const mask64 = (1n << 64n) - 1n;
const rotations = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39,
  41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const roundConstants = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const rotate = (value: bigint, n: number) => n === 0 ? value : ((value << BigInt(n)) | (value >> BigInt(64 - n))) & mask64;
/** Independent 256-bit Keccak sponge for short ABI signatures. */
function testKeccak(value: string): string {
  const input = new TextEncoder().encode(value);
  if (input.length >= 136) throw new Error('test signature too long');
  const padded = new Uint8Array(136); padded.set(input); padded[input.length] = 1; padded[135] |= 0x80;
  const lanes = Array<bigint>(25).fill(0n);
  for (let i = 0; i < padded.length; i++) lanes[Math.floor(i / 8)]! ^= BigInt(padded[i]!) << BigInt(8 * (i % 8));
  for (const rc of roundConstants) {
    const column = Array.from({ length: 5 }, (_, x) => lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) lanes[x + 5 * y]! ^= column[(x + 4) % 5]! ^ rotate(column[(x + 1) % 5]!, 1);
    const moved = Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(lanes[x + 5 * y]!, rotations[x + 5 * y]!);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) lanes[x + 5 * y] = (moved[x + 5 * y]! ^ ((~moved[(x + 1) % 5 + 5 * y]!) & moved[(x + 2) % 5 + 5 * y]!)) & mask64;
    lanes[0]! ^= rc;
  }
  const output = new Uint8Array(32);
  for (let i = 0; i < 32; i++) output[i] = Number((lanes[Math.floor(i / 8)]! >> BigInt(8 * (i % 8))) & 255n);
  return toHex(output);
}
describe('independent ABI selector and log topic derivation', () => {
  it('agrees with Noble Keccak and the pinned call selectors and event topics', () => {
    expect(testKeccak('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    for (const [signature, expected] of [
      ['approve(address,uint256)', APPROVE_SELECTOR],
      ['multicall(uint256,bytes[])', MULTICALL_SELECTOR],
      ['exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', EXACT_INPUT_SINGLE_SELECTOR],
      ['Transfer(address,address,uint256)', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
      ['Approval(address,address,uint256)', '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'],
    ]) {
      const derived = testKeccak(signature!);
      expect(derived).toBe(toHex(keccak_256(new TextEncoder().encode(signature!))));
      expect(derived.slice(0, expected!.length)).toBe(expected);
    }
  });
});

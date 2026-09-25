// SPDX-License-Identifier: AGPL-3.0-only
/** Exact SwapRouter02 ABI profile. Decoding requires canonical re-encoding. */
export const SWAP_ROUTER_02 = '0x2626664c2603336e57b271c5c0b26f421741e481';
export const APPROVE_SELECTOR = '0x095ea7b3';
export const MULTICALL_SELECTOR = '0x5ae401dc';
export const EXACT_INPUT_SINGLE_SELECTOR = '0x04e45aaf';
export type SwapArguments = { readonly tokenIn: string; readonly tokenOut: string; readonly fee: 100 | 500 | 3000 | 10000; readonly recipient: string; readonly amountIn: bigint; readonly amountOutMinimum: bigint; readonly sqrtPriceLimitX96: 0n; readonly deadline: bigint };
function fail(): never { throw new Error('ABI_NON_CANONICAL'); }
export function address(value: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(value)) fail();
  return value;
}
function word(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) fail();
  const result = new Uint8Array(32);
  for (let index = 31; index >= 0; index--) { result[index] = Number(value & 255n); value >>= 8n; }
  return result;
}
function addressWord(value: string): Uint8Array {
  const result = new Uint8Array(32);
  result.set(bytes(address(value)), 12);
  return result;
}
function bytes(hex: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(hex)) fail();
  const result = new Uint8Array((hex.length - 2) / 2);
  for (let index = 0; index < result.length; index++) result[index] = Number.parseInt(hex.slice(2 + index * 2, 4 + index * 2), 16);
  return result;
}
function hex(value: Uint8Array): string { return '0x' + Array.from(value, byte => byte.toString(16).padStart(2, '0')).join(''); }
function join(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}
function equals(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((byte, index) => byte === right[index]); }
function readWord(data: Uint8Array, offset: number): bigint {
  if (offset < 0 || offset + 32 > data.length) fail();
  let result = 0n;
  for (const byte of data.subarray(offset, offset + 32)) result = (result << 8n) | BigInt(byte);
  return result;
}
function readAddress(data: Uint8Array, offset: number): string {
  if (readWord(data, offset) >> 160n) fail();
  return hex(data.subarray(offset + 12, offset + 32));
}
export function encodeApprove(spender: string, amount: bigint): Uint8Array {
  return join(bytes(APPROVE_SELECTOR), addressWord(spender), word(amount));
}
export function decodeApprove(data: Uint8Array): { spender: string; amount: bigint } {
  if (data.length !== 68 || hex(data.subarray(0, 4)) !== APPROVE_SELECTOR) fail();
  const spender = readAddress(data, 4);
  const amount = readWord(data, 36);
  if (!equals(data, encodeApprove(spender, amount))) fail();
  return { spender, amount };
}
export function encodeSwap(input: SwapArguments): Uint8Array {
  if (![100, 500, 3000, 10000].includes(input.fee) || input.amountIn <= 0n || input.sqrtPriceLimitX96 !== 0n) fail();
  const inner = join(bytes(EXACT_INPUT_SINGLE_SELECTOR), addressWord(input.tokenIn), addressWord(input.tokenOut),
    word(BigInt(input.fee)), addressWord(input.recipient), word(input.amountIn), word(input.amountOutMinimum), word(0n));
  const pad = new Uint8Array((32 - inner.length % 32) % 32);
  return join(bytes(MULTICALL_SELECTOR), word(input.deadline), word(64n), word(1n), word(32n), word(BigInt(inner.length)), inner, pad);
}
export function decodeSwap(data: Uint8Array): SwapArguments {
  if (data.length < 4 + 5 * 32 || hex(data.subarray(0, 4)) !== MULTICALL_SELECTOR) fail();
  const body = data.subarray(4);
  const deadline = readWord(body, 0);
  if (readWord(body, 32) !== 64n || readWord(body, 64) !== 1n || readWord(body, 96) !== 32n) fail();
  const length = readWord(body, 128);
  if (length !== 228n) fail();
  const inner = body.subarray(160, 160 + Number(length));
  if (inner.length !== 228 || hex(inner.subarray(0, 4)) !== EXACT_INPUT_SINGLE_SELECTOR) fail();
  const fee = readWord(inner, 68);
  if (![100n, 500n, 3000n, 10000n].includes(fee)) fail();
  const input: SwapArguments = {
    tokenIn: readAddress(inner, 4), tokenOut: readAddress(inner, 36), fee: Number(fee) as SwapArguments['fee'],
    recipient: readAddress(inner, 100), amountIn: readWord(inner, 132), amountOutMinimum: readWord(inner, 164),
    sqrtPriceLimitX96: readWord(inner, 196) as 0n, deadline,
  };
  if (input.sqrtPriceLimitX96 !== 0n || !equals(data, encodeSwap(input))) fail();
  return input;
}

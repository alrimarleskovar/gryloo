// SPDX-License-Identifier: AGPL-3.0-only
/** Minimal, strict RLP for the unsigned and signed EIP-1559 profiles. */
export type RlpValue = Uint8Array | readonly RlpValue[];
const LIMIT = 1_048_576;
function fail(): never { throw new Error('RLP_NON_CANONICAL'); }
function lengthBytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > LIMIT) fail();
  if (value === 0) return Uint8Array.of(0);
  const result: number[] = [];
  while (value) { result.unshift(value & 255); value = Math.floor(value / 256); }
  return Uint8Array.from(result);
}
function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { result.set(part, position); position += part.length; }
  return result;
}
export function rlpEncode(value: RlpValue): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length > LIMIT) fail();
    if (value.length === 1 && value[0]! < 0x80) return value.slice();
    if (value.length < 56) return concat(Uint8Array.of(0x80 + value.length), value);
    const len = lengthBytes(value.length);
    return concat(Uint8Array.of(0xb7 + len.length), len, value);
  }
  if (!Array.isArray(value)) fail();
  const body = concat(...value.map(item => rlpEncode(item)));
  if (body.length > LIMIT) fail();
  if (body.length < 56) return concat(Uint8Array.of(0xc0 + body.length), body);
  const len = lengthBytes(body.length);
  return concat(Uint8Array.of(0xf7 + len.length), len, body);
}
function readLength(bytes: Uint8Array, start: number, width: number): number {
  if (width < 1 || width > 4 || start + width > bytes.length || bytes[start] === 0) fail();
  let result = 0;
  for (let index = start; index < start + width; index++) result = result * 256 + bytes[index]!;
  if (result < 56 || result > LIMIT) fail();
  return result;
}
function decodeAt(bytes: Uint8Array, start: number, depth: number): [RlpValue, number] {
  if (depth > 16 || start >= bytes.length) fail();
  const prefix = bytes[start]!;
  if (prefix < 0x80) return [bytes.slice(start, start + 1), start + 1];
  let offset: number;
  let length: number;
  let list = false;
  if (prefix < 0xb8) { offset = start + 1; length = prefix - 0x80; }
  else if (prefix < 0xc0) { const width = prefix - 0xb7; length = readLength(bytes, start + 1, width); offset = start + 1 + width; }
  else if (prefix < 0xf8) { list = true; offset = start + 1; length = prefix - 0xc0; }
  else { list = true; const width = prefix - 0xf7; length = readLength(bytes, start + 1, width); offset = start + 1 + width; }
  const end = offset + length;
  if (end > bytes.length) fail();
  if (!list) {
    if (length === 1 && bytes[offset]! < 0x80) fail();
    return [bytes.slice(offset, end), end];
  }
  const items: RlpValue[] = [];
  while (offset < end) {
    const [item, next] = decodeAt(bytes, offset, depth + 1);
    if (next > end) fail();
    items.push(item); offset = next;
  }
  if (offset !== end) fail();
  return [items, end];
}
export function rlpDecode(input: Uint8Array): RlpValue {
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > LIMIT) fail();
  const [value, end] = decodeAt(input, 0, 0);
  if (end !== input.length) fail();
  return value;
}
export function rlpInteger(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) fail();
  if (value === 0n) return new Uint8Array();
  const result: number[] = [];
  while (value) { result.unshift(Number(value & 255n)); value >>= 8n; }
  return Uint8Array.from(result);
}
export function parseRlpInteger(value: RlpValue): bigint {
  if (!(value instanceof Uint8Array) || value.length > 32 || (value.length > 0 && value[0] === 0)) fail();
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  return result;
}
export function rlpBytes(value: RlpValue): Uint8Array {
  if (!(value instanceof Uint8Array)) fail();
  return value;
}
export function rlpList(value: RlpValue): readonly RlpValue[] {
  if (!Array.isArray(value)) fail();
  return value;
}

// SPDX-License-Identifier: AGPL-3.0-only
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Minimal, dependency-free Solana wire codec for exact message binding. No signing keys exist here. */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = '';
  while (n > 0n) { out = ALPHABET[Number(n % 58n)]! + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out;
}
export function base58Decode(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length === 0 || text.length > 128) throw new Error('SOLANA_BASE58_INVALID');
  let n = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('SOLANA_BASE58_INVALID');
    n = n * 58n + BigInt(digit);
  }
  const body: number[] = [];
  while (n > 0n) { body.unshift(Number(n % 256n)); n /= 256n; }
  let zeros = 0;
  for (const char of text) { if (char !== '1') break; zeros++; }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...body]);
}
export function publicKeyBytes(address: string): Uint8Array {
  let bytes: Uint8Array;
  try { bytes = base58Decode(address); } catch { throw new Error('SOLANA_ADDRESS_INVALID'); }
  if (bytes.length !== 32 || base58Encode(bytes) !== address) throw new Error('SOLANA_ADDRESS_INVALID');
  return bytes;
}
export function solanaAddress(value: unknown): string {
  if (typeof value !== 'string') throw new Error('SOLANA_ADDRESS_INVALID');
  publicKeyBytes(value);
  return value;
}
export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export function fromBase64(text: unknown, limit = 1_232 * 4): Uint8Array {
  if (typeof text !== 'string' || text.length > limit || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('SOLANA_BASE64_INVALID');
  const bytes = Uint8Array.from(Buffer.from(text, 'base64'));
  if (toBase64(bytes) !== text) throw new Error('SOLANA_BASE64_INVALID');
  return bytes;
}
export const sha256Hex = (bytes: Uint8Array): string => '0x' + Buffer.from(sha256(bytes)).toString('hex');

function onCurve(bytes: Uint8Array): boolean {
  try { ed25519.Point.fromBytes(bytes); return true; } catch { return false; }
}
export function findProgramAddress(seeds: readonly Uint8Array[], programId: string): string {
  const program = publicKeyBytes(programId), marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const hash = sha256(Uint8Array.from([...seeds.flatMap(seed => [...seed]), bump, ...program, ...marker]));
    if (!onCurve(hash)) return base58Encode(hash);
  }
  throw new Error('SOLANA_PDA_NOT_FOUND');
}
export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string, associatedProgram: string): string {
  return findProgramAddress([publicKeyBytes(owner), publicKeyBytes(tokenProgram), publicKeyBytes(mint)], associatedProgram);
}
export function verifyEd25519(signature: Uint8Array, message: Uint8Array, owner: string): boolean {
  try { return signature.length === 64 && ed25519.verify(signature, message, publicKeyBytes(owner)); } catch { return false; }
}

function compactU16(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new Error('SOLANA_LENGTH_INVALID');
  const out: number[] = [];
  let rest = value;
  for (;;) { const byte = rest & 0x7f; rest >>= 7; if (rest === 0) { out.push(byte); return out; } out.push(byte | 0x80); }
}
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  byte(): number { if (this.offset >= this.bytes.length) throw new Error('SOLANA_MESSAGE_TRUNCATED'); return this.bytes[this.offset++]!; }
  take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) throw new Error('SOLANA_MESSAGE_TRUNCATED');
    const out = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return out;
  }
  compact(): number {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const byte = this.byte(); value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) { if (shift > 0 && byte === 0) throw new Error('SOLANA_LENGTH_INVALID'); return value; }
    }
    throw new Error('SOLANA_LENGTH_INVALID');
  }
}

export type SolanaAccountMeta = { pubkey: string; isSigner: boolean; isWritable: boolean };
export type SolanaInstruction = { programId: string; accounts: SolanaAccountMeta[]; data: Uint8Array };
export type LookupTables = Readonly<Record<string, readonly string[]>>;
export type CompiledLookup = { table: string; writable: number[]; readonly: number[] };
export type MessageV0 = { header: [number, number, number]; staticKeys: string[]; blockhash: string;
  instructions: { programIdIndex: number; accounts: number[]; data: Uint8Array }[]; lookups: CompiledLookup[] };

/** Compile a v0 message using the same key ordering rules as the Solana runtime libraries. */
export function compileMessageV0(payer: string, instructions: readonly SolanaInstruction[], blockhash: string, tables: LookupTables): MessageV0 {
  publicKeyBytes(blockhash);
  type Meta = { signer: boolean; writable: boolean; invoked: boolean };
  const metas = new Map<string, Meta>();
  const touch = (key: string, patch: Partial<Meta>) => {
    solanaAddress(key);
    const meta = metas.get(key) ?? { signer: false, writable: false, invoked: false };
    metas.set(key, { signer: meta.signer || !!patch.signer, writable: meta.writable || !!patch.writable, invoked: meta.invoked || !!patch.invoked });
  };
  touch(payer, { signer: true, writable: true });
  for (const ix of instructions) {
    touch(ix.programId, { invoked: true });
    for (const account of ix.accounts) touch(account.pubkey, { signer: account.isSigner, writable: account.isWritable });
  }
  const entries = [...metas.entries()];
  const lookups: CompiledLookup[] = [], lookupWritable: string[] = [], lookupReadonly: string[] = [];
  const remaining = new Map(entries);
  for (const [table, addresses] of Object.entries(tables)) {
    solanaAddress(table);
    const lookup: CompiledLookup = { table, writable: [], readonly: [] };
    for (const [key, meta] of [...remaining.entries()]) {
      if (meta.signer || meta.invoked) continue;
      const index = addresses.indexOf(key);
      if (index < 0 || index > 255) continue;
      (meta.writable ? lookup.writable : lookup.readonly).push(index);
      (meta.writable ? lookupWritable : lookupReadonly).push(key);
      remaining.delete(key);
    }
    if (lookup.writable.length || lookup.readonly.length) lookups.push(lookup);
  }
  const statics = [...remaining.entries()];
  const group = (signer: boolean, writable: boolean) => statics.filter(([, m]) => m.signer === signer && m.writable === writable).map(([k]) => k);
  const writableSigners = group(true, true), readonlySigners = group(true, false);
  const staticKeys = [...writableSigners, ...readonlySigners, ...group(false, true), ...group(false, false)];
  if (staticKeys[0] !== payer) throw new Error('SOLANA_PAYER_ORDER_INVALID');
  const all = [...staticKeys, ...lookupWritable, ...lookupReadonly];
  if (all.length > 256) throw new Error('SOLANA_TOO_MANY_ACCOUNTS');
  const indexOf = (key: string) => { const i = all.indexOf(key); if (i < 0) throw new Error('SOLANA_ACCOUNT_MISSING'); return i; };
  return {
    header: [writableSigners.length + readonlySigners.length, readonlySigners.length, group(false, false).length],
    staticKeys, blockhash, lookups,
    instructions: instructions.map(ix => ({ programIdIndex: indexOf(ix.programId), accounts: ix.accounts.map(a => indexOf(a.pubkey)), data: ix.data })),
  };
}
export function serializeMessageV0(message: MessageV0): Uint8Array {
  const out: number[] = [0x80, ...message.header, ...compactU16(message.staticKeys.length)];
  for (const key of message.staticKeys) out.push(...publicKeyBytes(key));
  out.push(...publicKeyBytes(message.blockhash), ...compactU16(message.instructions.length));
  for (const ix of message.instructions) out.push(ix.programIdIndex, ...compactU16(ix.accounts.length), ...ix.accounts, ...compactU16(ix.data.length), ...ix.data);
  out.push(...compactU16(message.lookups.length));
  for (const lookup of message.lookups) out.push(...publicKeyBytes(lookup.table), ...compactU16(lookup.writable.length), ...lookup.writable,
    ...compactU16(lookup.readonly.length), ...lookup.readonly);
  const bytes = Uint8Array.from(out);
  if (bytes.length > 1_232 - 65) throw new Error('SOLANA_TRANSACTION_TOO_LARGE');
  return bytes;
}
export function parseMessageV0(bytes: Uint8Array): MessageV0 {
  const r = new Reader(bytes);
  if (r.byte() !== 0x80) throw new Error('SOLANA_MESSAGE_VERSION_UNSUPPORTED');
  const header: [number, number, number] = [r.byte(), r.byte(), r.byte()];
  const staticKeys = Array.from({ length: r.compact() }, () => base58Encode(r.take(32)));
  const blockhash = base58Encode(r.take(32));
  const instructions = Array.from({ length: r.compact() }, () => ({ programIdIndex: r.byte(),
    accounts: [...r.take(r.compact())], data: r.take(r.compact()) }));
  const lookups = Array.from({ length: r.compact() }, () => ({ table: base58Encode(r.take(32)), writable: [...r.take(r.compact())], readonly: [...r.take(r.compact())] }));
  if (r.offset !== bytes.length || header[0] < 1 || header[0] > staticKeys.length || header[1] >= header[0] ||
      header[2] > staticKeys.length - header[0]) throw new Error('SOLANA_MESSAGE_INVALID');
  return { header, staticKeys, blockhash, instructions, lookups };
}
/** Resolve every instruction against verified lookup-table contents; flags follow the runtime's message rules. */
export function decompileMessageV0(message: MessageV0, tables: LookupTables): SolanaInstruction[] {
  const [signers, readonlySigned, readonlyUnsigned] = message.header, n = message.staticKeys.length;
  const keys = [...message.staticKeys], writable = message.staticKeys.map((_, i) => i < signers ? i < signers - readonlySigned : i < n - readonlyUnsigned);
  const lookupKeys = (pick: 'writable' | 'readonly') => message.lookups.flatMap(l => l[pick].map(i => {
    const key = tables[l.table]?.[i]; if (!key) throw new Error('SOLANA_LOOKUP_MISSING'); return key; }));
  const w = lookupKeys('writable'), ro = lookupKeys('readonly');
  keys.push(...w, ...ro); writable.push(...w.map(() => true), ...ro.map(() => false));
  return message.instructions.map(ix => {
    const programId = keys[ix.programIdIndex];
    if (!programId || ix.programIdIndex >= n) throw new Error('SOLANA_PROGRAM_INDEX_INVALID');
    return { programId, data: ix.data, accounts: ix.accounts.map(i => {
      const pubkey = keys[i]; if (!pubkey) throw new Error('SOLANA_ACCOUNT_INDEX_INVALID');
      return { pubkey, isSigner: i < signers, isWritable: writable[i]! };
    }) };
  });
}
/** One-signer wire transaction. The unsigned form carries a zero signature placeholder for the wallet. */
export function serializeTransaction(signature: Uint8Array | null, message: Uint8Array): Uint8Array {
  if (signature && signature.length !== 64) throw new Error('SOLANA_SIGNATURE_INVALID');
  return Uint8Array.from([1, ...(signature ?? new Uint8Array(64)), ...message]);
}
/** Multi-signer wire transaction, signatures in static-key order. Missing signatures are zero placeholders. */
export function serializeSignedTransaction(signatures: readonly (Uint8Array | null)[], message: Uint8Array): Uint8Array {
  if (signatures.length < 1 || signatures.length > 8 || signatures.some(s => s && s.length !== 64)) throw new Error('SOLANA_SIGNATURE_INVALID');
  const bytes = Uint8Array.from([signatures.length, ...signatures.flatMap(s => [...(s ?? new Uint8Array(64))]), ...message]);
  if (bytes.length > 1_232) throw new Error('SOLANA_TRANSACTION_TOO_LARGE');
  return bytes;
}
export function parseTransaction(bytes: Uint8Array): { signatures: Uint8Array[]; message: Uint8Array } {
  const r = new Reader(bytes);
  const count = r.compact();
  if (count < 1 || count > 8) throw new Error('SOLANA_SIGNATURE_COUNT_INVALID');
  const signatures = Array.from({ length: count }, () => r.take(64));
  return { signatures, message: bytes.slice(r.offset) };
}
/** Address Lookup Table account: 56-byte header, then 32-byte keys. Only active tables are accepted. */
export function decodeLookupTable(data: Uint8Array): { addresses: string[]; active: boolean; authority: string | null } {
  if (data.length < 56 || (data.length - 56) % 32 !== 0 || new DataView(data.buffer, data.byteOffset).getUint32(0, true) !== 1) throw new Error('SOLANA_LOOKUP_TABLE_INVALID');
  const deactivation = new DataView(data.buffer, data.byteOffset).getBigUint64(4, true);
  const addresses: string[] = [];
  for (let at = 56; at < data.length; at += 32) addresses.push(base58Encode(data.slice(at, at + 32)));
  return { addresses, active: deactivation === 0xffffffffffffffffn, authority: data[21] === 1 ? base58Encode(data.slice(22, 54)) : null };
}
export const readU64 = (data: Uint8Array, at: number): bigint => {
  if (at < 0 || at + 8 > data.length) throw new Error('SOLANA_DATA_TRUNCATED');
  return new DataView(data.buffer, data.byteOffset).getBigUint64(at, true);
};
export const readU16 = (data: Uint8Array, at: number): number => {
  if (at < 0 || at + 2 > data.length) throw new Error('SOLANA_DATA_TRUNCATED');
  return new DataView(data.buffer, data.byteOffset).getUint16(at, true);
};
export const u64Bytes = (value: bigint): number[] => {
  const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return [...out];
};
export const u32Bytes = (value: number): number[] => {
  const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return [...out];
};
/** SPL Token account (165 bytes): mint, owner, amount. */
export function decodeTokenAccount(data: Uint8Array): { mint: string; owner: string; amount: bigint } {
  if (data.length !== 165) throw new Error('SOLANA_TOKEN_ACCOUNT_INVALID');
  return { mint: base58Encode(data.slice(0, 32)), owner: base58Encode(data.slice(32, 64)), amount: readU64(data, 64) };
}

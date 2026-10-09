// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: SPL Token delegation — the one Solana mechanism FloFi can scope without moving the owner's funds.
 *
 * `ApproveChecked` lets ONE delegate (a FloFi session key) spend up to `amount` from ONE token account; the owner signs it once (several
 * token accounts can share one transaction) together with a Memo that anchors the owner's authorization passkey. `Revoke` (owner-signed)
 * ends it. The delegate can then sign `TransferChecked` (or act as token authority in a program that accepts a delegate) up to the
 * remaining delegated amount. Nothing else is delegated: the recipient and the program of a delegated spend are NOT enforced on-chain,
 * native SOL cannot be delegated, and no protocol instruction is authorized by a token delegation. Pure codecs; no key lives here.
 */
import { base58Encode, compileMessageV0, publicKeyBytes, readU64, serializeMessageV0, u64Bytes, type SolanaInstruction } from './solana.js';

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const fail = (code: string): never => { throw new Error(code); };
const amountOf = (value: bigint) => value > 0n && value < 1n << 64n ? value : fail('SPL_AMOUNT_INVALID');
const decimalsOf = (value: number) => Number.isInteger(value) && value >= 0 && value <= 18 ? value : fail('SPL_DECIMALS_INVALID');

/** Token instruction 13: accounts [source (w), mint, delegate, owner (signer)]; data [13, amount u64 LE, decimals]. */
export function approveChecked(input: { readonly source: string; readonly mint: string; readonly delegate: string; readonly owner: string;
  readonly amount: bigint; readonly decimals: number }): SolanaInstruction {
  return { programId: TOKEN_PROGRAM, data: Uint8Array.from([13, ...u64Bytes(amountOf(input.amount)), decimalsOf(input.decimals)]), accounts: [
    { pubkey: input.source, isSigner: false, isWritable: true }, { pubkey: input.mint, isSigner: false, isWritable: false },
    { pubkey: input.delegate, isSigner: false, isWritable: false }, { pubkey: input.owner, isSigner: true, isWritable: false }] };
}
/** Token instruction 5: accounts [source (w), owner (signer)]. */
export function revoke(input: { readonly source: string; readonly owner: string }): SolanaInstruction {
  return { programId: TOKEN_PROGRAM, data: Uint8Array.of(5), accounts: [{ pubkey: input.source, isSigner: false, isWritable: true },
    { pubkey: input.owner, isSigner: true, isWritable: false }] };
}
/** Token instruction 12: accounts [source (w), mint, destination (w), authority (signer: owner or delegate)]. */
export function transferChecked(input: { readonly source: string; readonly mint: string; readonly destination: string; readonly authority: string;
  readonly amount: bigint; readonly decimals: number }): SolanaInstruction {
  return { programId: TOKEN_PROGRAM, data: Uint8Array.from([12, ...u64Bytes(amountOf(input.amount)), decimalsOf(input.decimals)]), accounts: [
    { pubkey: input.source, isSigner: false, isWritable: true }, { pubkey: input.mint, isSigner: false, isWritable: false },
    { pubkey: input.destination, isSigner: false, isWritable: true }, { pubkey: input.authority, isSigner: true, isWritable: false }] };
}
/** Memo v2 with the signer listed, so the memo is part of what that signer approved. */
export function memo(text: string, signer: string): SolanaInstruction {
  const data = new TextEncoder().encode(text);
  if (!data.length || data.length > 256 || !/^[\x20-\x7e]+$/.test(text)) fail('SPL_MEMO_INVALID');
  return { programId: MEMO_PROGRAM, data, accounts: [{ pubkey: signer, isSigner: true, isWritable: false }] };
}
/** The exact message bytes the owner signs for a delegation (or revocation) transaction; the owner is the fee payer. */
export function ownerMessage(owner: string, instructions: readonly SolanaInstruction[], blockhash: string): Uint8Array {
  publicKeyBytes(owner);
  if (!instructions.length || instructions.length > 8) fail('SPL_INSTRUCTIONS_INVALID');
  return serializeMessageV0(compileMessageV0(owner, instructions, blockhash, {}));
}

export type TokenAccountState = { readonly mint: string; readonly owner: string; readonly amount: bigint; readonly delegate: string | null;
  readonly state: 'UNINITIALIZED' | 'INITIALIZED' | 'FROZEN'; readonly native: boolean; readonly delegatedAmount: bigint; readonly closeAuthority: string | null };
/** SPL Token account, 165 bytes: mint, owner, amount, COption delegate, state, COption is_native, delegated_amount, COption close_authority. */
export function decodeTokenAccountState(data: Uint8Array): TokenAccountState {
  if (data.length !== 165) fail('SPL_TOKEN_ACCOUNT_INVALID');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const option = (at: number) => { const tag = view.getUint32(at, true); return tag === 0 ? null : tag === 1 ? base58Encode(data.slice(at + 4, at + 36)) : fail('SPL_TOKEN_ACCOUNT_INVALID'); };
  const state = data[108];
  const nativeTag = view.getUint32(109, true);
  if (state === undefined || state > 2 || nativeTag > 1) fail('SPL_TOKEN_ACCOUNT_INVALID');
  return { mint: base58Encode(data.slice(0, 32)), owner: base58Encode(data.slice(32, 64)), amount: readU64(data, 64), delegate: option(72),
    state: (['UNINITIALIZED', 'INITIALIZED', 'FROZEN'] as const)[state as 0 | 1 | 2], native: nativeTag === 1, delegatedAmount: readU64(data, 121), closeAuthority: option(129) };
}
/** Encodes a token account (tests and loopback chain doubles only). */
export function encodeTokenAccountState(s: TokenAccountState): Uint8Array {
  const out = new Uint8Array(165), view = new DataView(out.buffer);
  out.set(publicKeyBytes(s.mint), 0); out.set(publicKeyBytes(s.owner), 32); view.setBigUint64(64, s.amount, true);
  if (s.delegate) { view.setUint32(72, 1, true); out.set(publicKeyBytes(s.delegate), 76); }
  out[108] = ['UNINITIALIZED', 'INITIALIZED', 'FROZEN'].indexOf(s.state);
  view.setBigUint64(121, s.delegatedAmount, true);
  if (s.closeAuthority) { view.setUint32(129, 1, true); out.set(publicKeyBytes(s.closeAuthority), 133); }
  return out;
}
/** Whether a token account currently delegates at least `amount` of `mint` to `delegate` for `owner`. */
export function delegationActive(s: TokenAccountState, expected: { readonly owner: string; readonly mint: string; readonly delegate: string; readonly amount: bigint }): boolean {
  return s.state === 'INITIALIZED' && s.owner === expected.owner && s.mint === expected.mint && s.delegate === expected.delegate && s.delegatedAmount >= expected.amount;
}

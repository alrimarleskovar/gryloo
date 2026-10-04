// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { addressBytes, toAddress } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME } from './cloak-adapter';
import { bytesBase64, type CloakProperties, type CloakSwapRequest } from './provider-contract';
import { cloakRefundEvents, cloakSettlementOutput, decodeCloakInstruction, matchesCloakSource, type CloakChainTransaction } from './live-observer';
const owner = '11111111111111111111111111111111', state = CLOAK_RUNTIME.nativeMint;
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let n = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')), result = '';
  while (n) { result = alphabet[Number(n % 58n)]! + result; n /= 58n; }
  return '1'.repeat(bytes.findIndex(b => b !== 0) < 0 ? bytes.length : bytes.findIndex(b => b !== 0)) + result;
}
const p = { owner, recipientAta: owner, outputMint: CLOAK_RUNTIME.usdcMint, minimumOutput: '1000000' } as CloakProperties;
const body = { proof_bytes: bytesBase64(new Uint8Array(256)), public_inputs: bytesBase64(new Uint8Array(264)),
  output_mint: p.outputMint, recipient_ata: owner, min_output_amount: p.minimumOutput } as CloakSwapRequest;
function transaction(data: Uint8Array): CloakChainTransaction {
  return { slot: 500n, transaction: { message: { accountKeys: [CLOAK_RUNTIME.programId, state, owner],
    instructions: [{ programIdIndex: 0, accounts: [1, 2], data: base58(data) }] } }, meta: { err: null, logMessages: [],
      preTokenBalances: [{ accountIndex: 2, mint: p.outputMint, owner, uiTokenAmount: { amount: '123', decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 2, mint: p.outputMint, owner, uiTokenAmount: { amount: '1000123', decimals: 6 } }] } };
}
function source() {
  const bytes = new Uint8Array(593); bytes[0] = 1; bytes.set(addressBytes(toAddress(p.outputMint)), 521);
  bytes.set(addressBytes(toAddress(owner)), 553); new DataView(bytes.buffer).setBigUint64(585, 1_000_000n, true); return bytes;
}
describe('authoritative Cloak transaction parsing (synthetic chain fixtures)', () => {
  it('matches the exact proof/source fields and v0 loaded account keys', () => {
    const tx = transaction(source()); expect(matchesCloakSource(tx, state, body)).toBe(true);
    tx.transaction.message.accountKeys.pop(); tx.meta!.loadedAddresses = { writable: [owner], readonly: [] };
    expect(matchesCloakSource(tx, state, body)).toBe(true);
  });
  it.each([1, 257, 521, 553, 585])('rejects changed source data at byte %i', offset => {
    const bytes = source(); bytes[offset] = bytes[offset]! ^ 1;
    expect(matchesCloakSource(transaction(bytes), state, body)).toBe(false);
  });
  it('rejects failed, foreign, missing or duplicate source instructions', () => {
    for (const mutate of [(t: CloakChainTransaction) => { t.meta!.err = { failed: true }; },
      (t: CloakChainTransaction) => { t.transaction.message.accountKeys[0] = owner; },
      (t: CloakChainTransaction) => { t.transaction.message.instructions[0]!.accounts = [2]; },
      (t: CloakChainTransaction) => { t.transaction.message.instructions.push(t.transaction.message.instructions[0]!); }]) {
      const tx = transaction(source()); mutate(tx); expect(matchesCloakSource(tx, state, body)).toBe(false);
    }
  });
  it('uses the finalized settlement transaction delta for the exact recipient/mint', () => {
    expect(cloakSettlementOutput(transaction(new Uint8Array([4])), state, p)).toBe('1000000');
  });
  it('rejects a recipient delta contaminated by another instruction in the transaction', () => {
    const tx = transaction(new Uint8Array([4]));
    tx.transaction.message.instructions.push({ programIdIndex: 2, accounts: [2], data: '1' });
    expect(cloakSettlementOutput(tx, state, p)).toBeNull();
  });
  it.each(['recipient', 'mint', 'owner', 'decimals', 'minimum', 'duplicate', 'failed'])('rejects settlement %s mismatch', mode => {
    const tx = transaction(new Uint8Array([4])), balance = tx.meta!.postTokenBalances![0]!;
    if (mode === 'recipient') tx.transaction.message.instructions[0]!.accounts = [1];
    if (mode === 'mint') balance.mint = state;
    if (mode === 'owner') balance.owner = state;
    if (mode === 'decimals') balance.uiTokenAmount.decimals = 9;
    if (mode === 'minimum') balance.uiTokenAmount.amount = '1000122';
    if (mode === 'duplicate') tx.meta!.postTokenBalances!.push(balance);
    if (mode === 'failed') tx.meta!.err = 'failed';
    expect(cloakSettlementOutput(tx, state, p)).toBeNull();
  });
  it('rejects invalid and overlarge instruction encoding', () => {
    for (const text of ['', '0', '1'.repeat(4097)]) expect(() => decodeCloakInstruction(text)).toThrow();
  });
});
describe('authenticated private refund event parsing', () => {
  const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return bytesBase64(b); };
  const commitment = new Uint8Array(32); commitment[31] = 5;
  const event = 'Program data: ' + bytesBase64(new TextEncoder().encode('cloak/refund_leaf/v1')) + ' ' + u64(0n) + ' ' + u64(14_940_000n) + ' ' + bytesBase64(commitment);
  const invoke = `Program ${CLOAK_RUNTIME.programId} invoke [1]`, exit = `Program ${CLOAK_RUNTIME.programId} success`;
  it('retains leaf zero and private refund amount only inside the Cloak program frame', () => {
    expect(cloakRefundEvents([invoke, event, exit])).toEqual([{ index: 0, amount: 14_940_000n, commitment: 5n }]);
    expect(cloakRefundEvents([event])).toEqual([]);
    expect(cloakRefundEvents([invoke, `Program ${owner} invoke [2]`, event, `Program ${owner} success`, exit])).toEqual([]);
  });
  it('rejects incomplete, truncated and malformed events', () => {
    for (const logs of [[invoke, event], [invoke, 'Log truncated', exit], [invoke, event.replace(u64(0n), u64(1n << 32n)), exit],
      [invoke, event.replace(u64(14_940_000n), u64(0n)), exit], [invoke, event, `Program ${owner} success`]])
      expect(() => cloakRefundEvents(logs)).toThrow();
  });
});

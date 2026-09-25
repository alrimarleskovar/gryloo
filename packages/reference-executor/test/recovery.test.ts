import { describe, expect, it } from 'vitest';
import { classifyUnknownResult, decideRetry, type RecoveryEvidence } from '../src/recovery.js';
const base: RecoveryEvidence = { payloadNonce: 7n, latestNonce: 7n, scannedBlocks: 4,
  scanComplete: true, matchingNonceTransactions: [], txpoolChecked: true, txpoolContainsNonce: false,
  waitedMs: 30_000, observedBlocks: 2, receiptLookup: null, transactionLookup: null, deadlineNear: false };
describe('unknown-result recovery', () => {
  it('never treats local null transaction or receipt lookups as NOT_FOUND by themselves', () => {
    const result = classifyUnknownResult({ ...base, scanComplete: false, txpoolChecked: false, waitedMs: 0, observedBlocks: 0 });
    expect(result).toEqual({ outcome: 'INCONCLUSIVE', retryAllowed: false, reason: expect.any(String) });
  });
  it('reconciles broadcast-before-unknown-result without a duplicate authorization', () => {
    const result = classifyUnknownResult({ ...base, latestNonce: 8n, receiptLookup: { status: 1 },
      matchingNonceTransactions: [{ hash: '0x' + 'a'.repeat(64), exactPayload: true, confirmed: true }] });
    expect(result.outcome).toBe('CONFIRMED');
    expect(decideRetry(result, 1)).toBe(false);
  });
  it('requires nonce, complete scan, txpool, wait and a safe deadline for one retry', () => {
    const result = classifyUnknownResult(base);
    expect(result.outcome).toBe('NOT_FOUND');
    expect(decideRetry(result, 1)).toBe(true);
    expect(decideRetry(result, 2)).toBe(false);
    expect(decideRetry(result, -1)).toBe(false);
    for (const changed of [{ ...base, txpoolChecked: false }, { ...base, scanComplete: false },
      { ...base, waitedMs: 0 }, { ...base, scannedBlocks: 0 }, { ...base, deadlineNear: true }]) {
      expect(classifyUnknownResult(changed).retryAllowed).toBe(false);
    }
  });
  it('classifies confirmed, pending, reverted and inconsistent scripted observations', () => {
    const found = { hash: '0x' + 'a'.repeat(64), exactPayload: true, confirmed: true };
    expect(classifyUnknownResult({ ...base, latestNonce: 8n, matchingNonceTransactions: [found],
      receiptLookup: { status: 1 } }).outcome).toBe('CONFIRMED');
    expect(classifyUnknownResult({ ...base, latestNonce: 8n, matchingNonceTransactions: [found],
      receiptLookup: { status: 0 } }).outcome).toBe('REVERTED');
    expect(classifyUnknownResult({ ...base, txpoolContainsNonce: true }).outcome).toBe('PENDING');
    expect(classifyUnknownResult({ ...base, matchingNonceTransactions: [found], receiptLookup: { status: 1 } }).outcome).toBe('INCONCLUSIVE');
    expect(classifyUnknownResult({ ...base, latestNonce: 8n, matchingNonceTransactions: [found],
      transactionLookup: { hash: '0x' + 'b'.repeat(64) } }).outcome).toBe('INCONCLUSIVE');
  });
  it('fails closed on nonce consumption by a divergent transaction', () => {
    expect(classifyUnknownResult({ ...base, latestNonce: 8n,
      matchingNonceTransactions: [{ hash: '0x' + 'a'.repeat(64), exactPayload: false, confirmed: true }] }).outcome).toBe('DIVERGENT');
  });
});

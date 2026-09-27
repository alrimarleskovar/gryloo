// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { advanceLiquidityAttempt, classifyLiquidityUnknown, markLiquidityReconciled, newLiquidityJournal,
  prepareLiquidityAttempt } from '../src/liquidity.js';
const h = (n: string) => `0x${n.repeat(64)}`;
describe('liquidity Mode A journal', () => {
  it('durably prepares unique steps, gates prerequisites and fails closed on unknown results', () => {
    let journal = newLiquidityJournal('liquidity-' + 'a'.repeat(24), h('1'), h('2'));
    const input = { step: 'approve-weth' as const, idempotencyKey: 'approve-weth-1', payloadHash: h('3'), blockNumber: 1, prerequisite: [] };
    const made = prepareLiquidityAttempt(journal, input); journal = made.journal;
    expect(prepareLiquidityAttempt(journal, input).attempt).toEqual(made.attempt);
    expect(() => prepareLiquidityAttempt(journal, { ...input, step: 'mint', idempotencyKey: 'mint-key-1', prerequisite: ['approve-weth'] })).toThrow();
    journal = advanceLiquidityAttempt(journal, made.attempt.executionAttemptId, 'SUBMITTING');
    journal = advanceLiquidityAttempt(journal, made.attempt.executionAttemptId, 'SUBMISSION_RESULT_UNKNOWN');
    expect(() => prepareLiquidityAttempt(journal, input)).toThrow();
    expect(classifyLiquidityUnknown(journal, { attemptId: made.attempt.executionAttemptId, senderNonce: 2n, reviewedNonce: 1n,
      matchingTxHash: null, completeBlockScan: true }).outcome).toBe('INCONCLUSIVE');
    const found = classifyLiquidityUnknown(journal, { attemptId: made.attempt.executionAttemptId, senderNonce: 2n, reviewedNonce: 1n,
      matchingTxHash: h('4'), completeBlockScan: true });
    expect(found.outcome).toBe('FOUND');
    journal = advanceLiquidityAttempt(found.journal, made.attempt.executionAttemptId, 'CONFIRMED', h('4'));
    journal = markLiquidityReconciled(journal, 'approve-weth', made.attempt.executionAttemptId);
    expect(journal.reconciled).toContain('approve-weth');
  });
});

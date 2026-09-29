// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { newAcrossExecution, authorizeAcross, approveAcross, prepareAcrossDeposit, submitAcrossDeposit,
  recheckAcrossDeposit, confirmAcrossSource, progressAcrossFill, delayAcrossFill, fillAcross,
  reconcileAcross, expireAcrossDeposit, pendingAcrossRefund, confirmAcrossRefund } from '../src/across';
import type { AcrossRoute } from '../src/across';
import type { AcrossReview } from '@defi-workflow-engine/reference-compiler';
const NOW = 1_780_000_000_000, OWNER = '0x1111111111111111111111111111111111111111';
const H = '0x' + 'a'.repeat(64);
const quote = { provider: 'across.direct', provenance: 'DETERMINISTIC_FIXTURE', quoteId: 'fixture', rawHash: H,
  owner: OWNER, sourceChainId: 8453, destinationChainId: 42161, inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  outputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', inputAmount: '1000000', expectedOutput: '999000',
  minimumOutput: '999000', allowance: '0', approvalSpender: OWNER,
  approvals: [{ chainId: 8453, to: OWNER, data: '0x095ea7b3', value: '0x0' }],
  deposit: { chainId: 8453, to: OWNER, data: '0x110560ad', value: '0x0', gas: '250000' },
  refundAddress: OWNER, refundOnOrigin: true, feeMaximum: '1000', maximumGasCostWei: '250000000000000', observedAt: new Date(NOW).toISOString(),
  quoteExpiresAt: new Date(NOW + 300_000).toISOString(), expectedFillSeconds: 30 } satisfies AcrossRoute;
const review = { provider: { kind: 'FIXED', providerId: 'across.direct' }, workflowHash: H, quoteHash: H,
  manifestHash: H, approvalHashes: [H], depositHash: H, policy: { owner: OWNER, recipient: OWNER, refundAddress: OWNER,
    sourceChainId: 8453, destinationChainId: 42161, inputToken: quote.inputToken, outputToken: quote.outputToken,
    maximumInput: quote.inputAmount, minimumOutput: quote.minimumOutput, maximumFee: quote.feeMaximum, maximumGasCostWei: quote.maximumGasCostWei,
    quoteExpiresAt: quote.quoteExpiresAt, approvalSpender: OWNER, depositTarget: OWNER, depositValue: '0x0' } } as unknown as AcrossReview;
const workflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, nodes: [], resourceEdges: [] } as never;
function start() { const initial = newAcrossExecution('across-' + '1'.repeat(24), workflow, quote, review, NOW);
  return prepareAcrossDeposit(approveAcross(authorizeAcross(initial, H, NOW), NOW), NOW); }
describe('Across MOCKED lifecycle and recovery', () => {
  it('preserves unknown submission through restart without a second deposit', () => {
    const unknown = submitAcrossDeposit(start(), true, NOW);
    expect(unknown.state).toBe('DEPOSIT_UNKNOWN');
    expect(() => submitAcrossDeposit(unknown, false, NOW)).toThrow();
    const restored = JSON.parse(JSON.stringify(unknown));
    const found = recheckAcrossDeposit(restored, NOW + 1);
    expect(found.state).toBe('DEPOSIT_SUBMITTED');
    expect(found.attempts.filter(a => a.stepId === 'across.deposit')).toHaveLength(1);
    expect(() => recheckAcrossDeposit(found, NOW + 2)).toThrow();
  });
  it('keeps source-confirmed fill pending and delayed before independent reconciliation', () => {
    let run = confirmAcrossSource(submitAcrossDeposit(start(), false, NOW), NOW + 1);
    expect(run.state).toBe('SOURCE_CONFIRMED');
    run = delayAcrossFill(progressAcrossFill(run, NOW + 2), NOW + 40_000);
    expect(run.state).toBe('FILL_DELAYED');
    run = fillAcross(run, NOW + 41_000);
    expect(run.state).toBe('FILLED');
    run = reconcileAcross(run, { owner: OWNER, token: quote.outputToken, sourceHash: run.depositHash!,
      fillHash: run.fillHash!, before: '0', after: quote.minimumOutput }, NOW + 42_000);
    expect(run.state).toBe('RECONCILED');
    expect(run.received).toBe(quote.minimumOutput);
  });
  it('distinguishes expired deposit, refund eligible, pending and confirmed', () => {
    let run = progressAcrossFill(confirmAcrossSource(submitAcrossDeposit(start(), false, NOW), NOW), NOW);
    expect(() => expireAcrossDeposit(run, NOW + 1000)).toThrow();
    run = expireAcrossDeposit(run, run.fillDeadlineMs!);
    expect(run.state).toBe('REFUND_ELIGIBLE');
    run = pendingAcrossRefund(run, NOW + 3_600_001);
    expect(run.state).toBe('REFUND_PENDING');
    run = confirmAcrossRefund(run, NOW + 3_600_002);
    expect(run.state).toBe('REFUNDED');
  });
});

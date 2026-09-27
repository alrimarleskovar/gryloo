// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-003F F1: durable, credential-free fork attempt recovery faults. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attemptStore } from '../../../apps/reference-dapp/e2e/fork/offline-rehearsal.mjs';
import { createAttemptCoordinator } from '../src/attempts.js';
import { classifyUnknownResult, decideRetry, type RecoveryEvidence } from '../src/recovery.js';

const digest = `0x${'ab'.repeat(32)}`;
const input = { executionId: 'f1-execution', stepId: 'step-approve', idempotencyKey: 'request-one',
  payloadHash: digest, preparedAtBlock: 1, priorStepConfirmed: false };
const baseEvidence: RecoveryEvidence = { payloadNonce: 0n, latestNonce: 0n,
  scannedBlocks: 1, scanComplete: false, matchingNonceTransactions: [], txpoolChecked: false,
  txpoolContainsNonce: false, waitedMs: 0, observedBlocks: 0, receiptLookup: null,
  transactionLookup: null, deadlineNear: false };

describe('F1 durable recovery and fail-closed matrix', () => {
  it('blocks a missing or corrupted restart journal before any request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gryloo-f1-restart-'));
    const path = join(directory, 'attempts.jsonl');
    await expect(attemptStore(path, true).read()).rejects.toThrow(/^JOURNAL_CORRUPT$/);
    const coordinator = createAttemptCoordinator(attemptStore(path));
    const prepared = await coordinator.prepare(input);
    expect(prepared.kind).toBe('PREPARED');
    const oldBytes = readFileSync(path);
    writeFileSync(path, oldBytes.subarray(0, oldBytes.length - 1));
    let sent = false;
    await expect(createAttemptCoordinator(attemptStore(path, true)).request(
      prepared.attempt.executionAttemptId, async () => { sent = true; return digest; }))
      .rejects.toThrow(/^JOURNAL_CORRUPT$/);
    expect(sent).toBe(false);
  });

  it('reloads an unknown broadcast and refuses a duplicate effect after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gryloo-f1-unknown-'));
    const path = join(directory, 'attempts.jsonl');
    const coordinator = createAttemptCoordinator(attemptStore(path));
    const prepared = await coordinator.prepare(input);
    let sends = 0;
    await expect(coordinator.request(prepared.attempt.executionAttemptId, async () => {
      sends++;
      throw new Error('response unavailable');
    })).rejects.toThrow(/^SUBMISSION_RESULT_UNKNOWN$/);
    const restarted = createAttemptCoordinator(attemptStore(path, true));
    expect((await attemptStore(path, true).read())[0]?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    await expect(restarted.prepare({ ...input, idempotencyKey: 'request-two' }))
      .rejects.toThrow(/^ATTEMPT_IN_PROGRESS$/);
    expect(sends).toBe(1);
  });

  it('keeps null lookups, replacement, nonce mismatch and incomplete observation fail closed', () => {
    expect(classifyUnknownResult(baseEvidence).outcome).toBe('INCONCLUSIVE');
    expect(classifyUnknownResult({ ...baseEvidence, txpoolChecked: true, txpoolContainsNonce: true }).outcome).toBe('PENDING');
    expect(classifyUnknownResult({ ...baseEvidence, latestNonce: 1n, scanComplete: true }).outcome).toBe('DIVERGENT');
    const replacement = classifyUnknownResult({ ...baseEvidence, latestNonce: 1n, scanComplete: true,
      matchingNonceTransactions: [{ hash: digest, exactPayload: false, confirmed: true }] });
    expect(replacement.outcome).toBe('DIVERGENT');
    expect(decideRetry(replacement, 1)).toBe(false);
    const tooSoon = classifyUnknownResult({ ...baseEvidence, scanComplete: true,
      scannedBlocks: 2, txpoolChecked: true, observedBlocks: 2, waitedMs: 29_999 });
    expect(tooSoon.outcome).toBe('INCONCLUSIVE');
    const deadline = classifyUnknownResult({ ...baseEvidence, scanComplete: true,
      scannedBlocks: 2, txpoolChecked: true, observedBlocks: 2, waitedMs: 30_000, deadlineNear: true });
    expect(deadline.outcome).toBe('INCONCLUSIVE');
  });
});

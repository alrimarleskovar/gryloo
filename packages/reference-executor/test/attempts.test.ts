import { describe, expect, it } from 'vitest';
import { createAttemptCoordinator, prepareAttemptState, transitionAttemptState } from '../src/attempts.js';
const input = { executionId: 'exec-1', stepId: 'step-approve', idempotencyKey: 'request-1',
  payloadHash: '0x' + 'a'.repeat(64), preparedAtBlock: 10, priorStepConfirmed: false };
describe('attempt state', () => {
  it('is idempotent, limits retries and requires an independent NOT_FOUND decision', () => {
    const first = prepareAttemptState([], input).attempt;
    expect(prepareAttemptState([first], input).kind).toBe('IDEMPOTENT');
    expect(() => prepareAttemptState([first], { ...input, idempotencyKey: 'request-2' })).toThrow('ATTEMPT_IN_PROGRESS');
    const submitting = transitionAttemptState(first, 'SUBMITTING');
    const unknown = transitionAttemptState(submitting, 'SUBMISSION_RESULT_UNKNOWN');
    const notFound = transitionAttemptState(unknown, 'NOT_FOUND');
    const retry = prepareAttemptState([notFound], { ...input, idempotencyKey: 'request-2' }).attempt;
    expect(retry.attemptNumber).toBe(2);
    expect(() => prepareAttemptState([notFound, retry], { ...input, idempotencyKey: 'request-3' })).toThrow();
  });
  it('requires approval confirmation before the swap and immutable transaction hash', () => {
    expect(() => prepareAttemptState([], { ...input, stepId: 'step-swap' })).toThrow('STEP_ORDER_INVALID');
    const first = prepareAttemptState([], input).attempt;
    expect(() => transitionAttemptState(first, 'CONFIRMED')).toThrow();
    const submitted = transitionAttemptState(first, 'SUBMITTING');
    const pending = transitionAttemptState(submitted, 'PENDING', '0x' + 'a'.repeat(64));
    expect(() => transitionAttemptState(pending, 'CONFIRMED', '0x' + 'b'.repeat(64))).toThrow('TRANSACTION_HASH_DIVERGENT');
  });
});

describe('scripted attempt coordinator', () => {
  const make = () => {
    let attempts: readonly import('../src/attempts.js').Attempt[] = [];
    const events: string[] = [];
    const store = { read: async () => attempts, write: async (next: typeof attempts) => {
      events.push(`persist:${next.at(-1)?.state}`); attempts = next;
    } };
    return { store, events, state: () => attempts };
  };
  it('prepares concurrently once and persists SUBMITTING before the scripted request', async () => {
    const fixture = make();
    const coordinator = createAttemptCoordinator(fixture.store);
    const [first, second] = await Promise.all([coordinator.prepare(input), coordinator.prepare(input)]);
    expect([first.kind, second.kind]).toEqual(['PREPARED', 'IDEMPOTENT']);
    const pending = await coordinator.request(first.attempt.executionAttemptId, async () => {
      fixture.events.push('request'); return '0x' + 'b'.repeat(64);
    });
    expect(pending.state).toBe('PENDING');
    expect(fixture.events).toEqual(['persist:PREPARED', 'persist:SUBMITTING', 'request', 'persist:PENDING']);
    await expect(coordinator.request(first.attempt.executionAttemptId, async () => '0x' + 'b'.repeat(64))).rejects.toThrow('ATTEMPT_NOT_PREPARED');
  });
  it('blocks requests on failed persistence and records unknown results before retry decisions', async () => {
    const fixture = make();
    const coordinator = createAttemptCoordinator(fixture.store);
    const first = await coordinator.prepare(input);
    const failing = createAttemptCoordinator({ read: fixture.store.read, write: async () => { throw new Error('disk failed'); } });
    let called = false;
    await expect(failing.request(first.attempt.executionAttemptId, async () => { called = true; return '0x' + 'b'.repeat(64); })).rejects.toThrow('disk failed');
    expect(called).toBe(false);
    await expect(coordinator.request(first.attempt.executionAttemptId, async () => { throw new Error('wallet result unknown'); })).rejects.toThrow('SUBMISSION_RESULT_UNKNOWN');
    expect(fixture.state()[0]?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    await expect(coordinator.prepare({ ...input, idempotencyKey: 'request-2' })).rejects.toThrow('ATTEMPT_IN_PROGRESS');
  });
});

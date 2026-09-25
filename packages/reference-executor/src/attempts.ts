// SPDX-License-Identifier: AGPL-3.0-only
import { assertTransition } from '@defi-workflow-engine/workflow-contracts';
export type AttemptState = 'PREPARED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'NOT_FOUND' | 'RECONCILIATION_REQUIRED';
export type Attempt = { readonly executionAttemptId: string; readonly executionId: string;
  readonly stepId: string; readonly idempotencyKey: string; readonly payloadHash: string;
  readonly attemptNumber: number; readonly state: AttemptState; readonly preparedAtBlock: number;
  readonly transactionHash: string | null };
export type PrepareResult = { readonly kind: 'PREPARED' | 'IDEMPOTENT'; readonly attempt: Attempt };
export function prepareAttemptState(existing: readonly Attempt[], input: {
  readonly executionId: string; readonly stepId: string; readonly idempotencyKey: string;
  readonly payloadHash: string; readonly preparedAtBlock: number; readonly priorStepConfirmed: boolean;
}): PrepareResult {
  if (!/^0x[0-9a-f]{64}$/.test(input.payloadHash) || !Number.isSafeInteger(input.preparedAtBlock) || input.preparedAtBlock < 0) throw new Error('ATTEMPT_INPUT_INVALID');
  const sameKey = existing.find(item => item.executionId === input.executionId && item.stepId === input.stepId && item.idempotencyKey === input.idempotencyKey);
  if (sameKey) {
    if (sameKey.payloadHash !== input.payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
    return { kind: 'IDEMPOTENT', attempt: sameKey };
  }
  if (input.stepId === 'step-swap' && !input.priorStepConfirmed) throw new Error('STEP_ORDER_INVALID');
  const history = existing.filter(item => item.executionId === input.executionId && item.stepId === input.stepId);
  if (history.some(item => !['NOT_FOUND', 'REVERTED', 'CONFIRMED', 'RECONCILIATION_REQUIRED'].includes(item.state))) throw new Error('ATTEMPT_IN_PROGRESS');
  if (history.length >= 2) throw new Error('ATTEMPT_LIMIT');
  if (history.length && (history.at(-1)?.state !== 'NOT_FOUND' || history.at(-1)?.payloadHash !== input.payloadHash)) throw new Error('RETRY_NOT_AUTHORIZED');
  const attempt: Attempt = Object.freeze({ executionAttemptId: `${input.executionId}.${input.stepId}.a${history.length + 1}`,
    executionId: input.executionId, stepId: input.stepId, idempotencyKey: input.idempotencyKey,
    payloadHash: input.payloadHash, attemptNumber: history.length + 1, state: 'PREPARED',
    preparedAtBlock: input.preparedAtBlock, transactionHash: null });
  assertTransition('attempt', null, attempt.state);
  return { kind: 'PREPARED', attempt };
}
export function transitionAttemptState(attempt: Attempt, state: AttemptState, transactionHash: string | null = attempt.transactionHash): Attempt {
  assertTransition('attempt', attempt.state, state);
  if (transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(transactionHash)) throw new Error('TRANSACTION_HASH_INVALID');
  if (attempt.transactionHash !== null && transactionHash !== attempt.transactionHash) throw new Error('TRANSACTION_HASH_DIVERGENT');
  if (state === 'CONFIRMED' && transactionHash === null) throw new Error('TRANSACTION_HASH_MISSING');
  return Object.freeze({ ...attempt, state, transactionHash });
}

export type AttemptPreparation = Parameters<typeof prepareAttemptState>[1];
export type AttemptStore = {
  readonly read: () => Promise<readonly Attempt[]>;
  /** Must resolve only after durable persistence. A rejection blocks any request. */
  readonly write: (attempts: readonly Attempt[]) => Promise<void>;
};
/** Serializes preparations in one worker; the store supplies durable, validated state. */
export function createAttemptCoordinator(store: AttemptStore): {
  readonly prepare: (input: AttemptPreparation) => Promise<PrepareResult>;
  readonly request: (attemptId: string, send: () => Promise<string>) => Promise<Attempt>;
} {
  let tail: Promise<void> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = tail.then(action);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    prepare: input => serial(async () => {
      const existing = await store.read();
      const result = prepareAttemptState(existing, input);
      if (result.kind === 'PREPARED') await store.write([...existing, result.attempt]);
      return result;
    }),
    request: (attemptId, send) => serial(async () => {
      const existing = await store.read();
      const index = existing.findIndex(item => item.executionAttemptId === attemptId);
      const prior = existing[index];
      if (!prior || prior.state !== 'PREPARED') throw new Error('ATTEMPT_NOT_PREPARED');
      const submitting = transitionAttemptState(prior, 'SUBMITTING');
      await store.write(existing.map((item, at) => at === index ? submitting : item));
      let transactionHash: string;
      try { transactionHash = await send(); }
      catch (error) {
        await store.write(existing.map((item, at) => at === index
          ? transitionAttemptState(submitting, 'SUBMISSION_RESULT_UNKNOWN') : item));
        throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause: error });
      }
      let pending: Attempt;
      try { pending = transitionAttemptState(submitting, 'PENDING', transactionHash); }
      catch (error) {
        await store.write(existing.map((item, at) => at === index
          ? transitionAttemptState(submitting, 'SUBMISSION_RESULT_UNKNOWN') : item));
        throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause: error });
      }
      try { await store.write(existing.map((item, at) => at === index ? pending : item)); }
      catch (error) { throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause: error }); }
      return pending;
    }),
  };
}

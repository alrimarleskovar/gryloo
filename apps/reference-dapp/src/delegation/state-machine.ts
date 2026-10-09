// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the delegated execution state machines (mirrored by database triggers in migration 0011).
 *
 * Execution: QUEUED → AUTHORITY_VERIFIED → RESERVED → RUNNING → SETTLED, with
 *   BLOCKED   nothing was submitted (before reservation, or every step stopped before submission): its reservation is released
 *   UNCERTAIN a submission's outcome is unknown: the reservation is kept until reconciliation decides
 *   HALTED    an irreversible step completed and a later one cannot proceed: funds rest in the owner's own account, attention needed
 *   FAILED    reconciliation proved a submission failed (reverted / dropped): unspent reservation released
 * Step: PENDING → SIMULATED → POLICY_VERIFIED → SUBMISSION_PREPARED → SUBMITTED → RECONCILED, with BLOCKED (before submission),
 *   UNCERTAIN (outcome unknown) and REVERTED (reconciled failure).
 *
 * SUBMISSION_PREPARED persists the exact signed bytes and their hash BEFORE anything is broadcast; recovery only ever re-broadcasts those
 * bytes. Terminal states never change.
 */
export const EXECUTION_STATES = ['QUEUED', 'AUTHORITY_VERIFIED', 'RESERVED', 'RUNNING', 'SETTLED', 'BLOCKED', 'UNCERTAIN', 'HALTED', 'FAILED'] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];
export const STEP_STATES = ['PENDING', 'SIMULATED', 'POLICY_VERIFIED', 'SUBMISSION_PREPARED', 'SUBMITTED', 'RECONCILED', 'BLOCKED', 'UNCERTAIN', 'REVERTED'] as const;
export type StepState = (typeof STEP_STATES)[number];

const EXECUTION: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = Object.freeze({
  QUEUED: ['AUTHORITY_VERIFIED', 'BLOCKED'],
  AUTHORITY_VERIFIED: ['RESERVED', 'BLOCKED'],
  RESERVED: ['RUNNING', 'BLOCKED'],
  RUNNING: ['RUNNING', 'SETTLED', 'BLOCKED', 'UNCERTAIN', 'HALTED', 'FAILED'],
  UNCERTAIN: ['RUNNING', 'SETTLED', 'HALTED', 'FAILED'],
  HALTED: ['RUNNING'],
  SETTLED: [], BLOCKED: [], FAILED: [],
});
const STEP: Readonly<Record<StepState, readonly StepState[]>> = Object.freeze({
  PENDING: ['SIMULATED', 'BLOCKED'],
  // A simulation can be refreshed (a new quote) until the submission is prepared.
  SIMULATED: ['SIMULATED', 'POLICY_VERIFIED', 'BLOCKED'],
  POLICY_VERIFIED: ['SIMULATED', 'SUBMISSION_PREPARED', 'BLOCKED'],
  SUBMISSION_PREPARED: ['SUBMITTED', 'UNCERTAIN', 'REVERTED'],
  SUBMITTED: ['RECONCILED', 'REVERTED', 'UNCERTAIN'],
  UNCERTAIN: ['SUBMITTED', 'RECONCILED', 'REVERTED'],
  RECONCILED: [], BLOCKED: [], REVERTED: [],
});
export const canMoveExecution = (from: ExecutionState, to: ExecutionState): boolean => EXECUTION[from].includes(to);
export const canMoveStep = (from: StepState, to: StepState): boolean => STEP[from].includes(to);
export const TERMINAL_EXECUTION: readonly ExecutionState[] = Object.freeze(['SETTLED', 'BLOCKED', 'FAILED']);
/** Steps whose submission may have reached a chain: their reservation can never be released without reconciliation. */
export const MAYBE_SUBMITTED: readonly StepState[] = Object.freeze(['SUBMISSION_PREPARED', 'SUBMITTED', 'UNCERTAIN']);

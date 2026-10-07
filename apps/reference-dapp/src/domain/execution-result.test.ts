// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { projectExecutionResult } from './execution-result';
import { reviewFixture } from '../test-utils/review-fixture';

function progress(state: string | null) {
  const fixture = reviewFixture();
  const source = { ...fixture.source, state: { ...fixture.source.state,
    run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}),
      attempts: state ? [{ step: 'swap', state, txHash: null }] : [] },
  } } as unknown as ExecutionLifecycleSource;
  return projectExecutionLifecycle(fixture.workflow, fixture.context, source);
}

describe('current execution result structure', () => {
  it.each([null, 'PENDING', 'HASH'])('keeps %s in readiness or progress', state => {
    expect(projectExecutionResult(progress(state))).toBeNull();
  });
  it('uses confirmed execution steps and recorded networks for the completed summary', () => {
    const result = projectExecutionResult(progress('CONFIRMED'));
    expect(result).toMatchObject({ label: 'Execution completed', completed: 1, total: 1, networks: ['Base Sepolia'] });
  });
  it.each(['UNKNOWN', 'INCONCLUSIVE'])('keeps %s unresolved without claiming success or failure', state => {
    const result = projectExecutionResult(progress(state));
    expect(result).toMatchObject({ label: 'Execution status unresolved', completed: 0, tone: 'attention' });
  });
  it('does not claim the unavailable original workflow completed', () => {
    const current = progress('CONFIRMED'); current.restored = true; current.planUnavailable = true;
    expect(projectExecutionResult(current)).toMatchObject({ label: 'Recorded requests confirmed', countLabel: 'Recorded actions confirmed' });
    expect(projectExecutionResult(current)?.message).toContain('Original workflow details remain unavailable');
  });
  it('does not turn a restored completed record into a reconciliation claim', () => {
    const current = progress('CONFIRMED'); current.restored = true;
    const result = projectExecutionResult(current);
    expect(result?.label).toBe('Execution completed');
    expect(JSON.stringify(result)).not.toMatch(/reconciled|verified/i);
  });
  it('retains the lifecycle projection without mutating it', () => {
    const current = progress('REVERTED'), snapshot = JSON.stringify(current);
    expect(projectExecutionResult(current)?.label).toBe('Execution failed');
    expect(JSON.stringify(current)).toBe(snapshot);
  });
  it('distinguishes a wallet rejection without inventing on-chain failure', () => {
    expect(projectExecutionResult(progress('REJECTED'))).toMatchObject({ label: 'Transaction not submitted' });
  });
  it('shows partial completion when an earlier irreversible action succeeded', () => {
    const current = progress('REVERTED'), confirmed = progress('CONFIRMED').steps[0]!;
    current.steps.unshift({ ...confirmed, id: 'earlier-step' }); current.completed = 1;
    expect(projectExecutionResult(current)).toMatchObject({ label: 'Execution partially completed', completed: 1, total: 2 });
  });
  it('keeps completion with a recorded residual allowance distinct from clean completion', () => {
    const current = progress('CONFIRMED');
    current.evidence = { operations: {}, wallet: null, knownCosts: [], details: [], limitations: [], attention: ['Recorded allowance remains'] };
    expect(projectExecutionResult(current)).toMatchObject({ label: 'Execution completed with attention', tone: 'attention' });
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { projectExecutionRecovery, restoredLocalExecutionKind } from './execution-recovery';
import { initialWorkflow } from './initial-workflow';
import { reviewFixture, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
const hash = '0x' + 'a'.repeat(64);
it('routes restored local records from the fresh Build template without replacing an authored workflow', () => {
  expect(restoredLocalExecutionKind(initialWorkflow(), { composition: true, liquidity: false, cow: false })).toBe('composition');
  expect(restoredLocalExecutionKind(initialWorkflow(), { composition: false, liquidity: true, cow: false })).toBe('fork-pool');
  expect(restoredLocalExecutionKind(initialWorkflow(), { composition: false, liquidity: false, cow: true })).toBe('cow');
  expect(restoredLocalExecutionKind(initialWorkflow(), { composition: false, liquidity: false, cow: false })).toBeNull();
  expect(restoredLocalExecutionKind(reviewFixture().workflow, { composition: true, liquidity: true, cow: true })).toBeNull();
});
const source = (kind: ExecutionLifecycleSource['kind'], state: unknown) => ({ kind, state }) as ExecutionLifecycleSource;
function publicSource(status = 'UNKNOWN', restored = false) {
  const f = reviewFixture();
  return source('public', { ...f.source.state, recoveryOnly: restored, run: { ...('run' in f.source.state ? f.source.state.run : {}), attempts: [{ step: 'approval', state: 'CONFIRMED', txHash: hash, account: reviewOwner }, { step: 'swap', state: status, txHash: status === 'UNKNOWN' ? null : hash, account: reviewOwner }] } });
}
function project(s: ExecutionLifecycleSource, wallet = reviewFixture().wallet) {
  const f = reviewFixture(), progress = projectExecutionLifecycle(f.workflow, f.context, s);
  return { progress, recovery: projectExecutionRecovery(s, progress, wallet) };
}
describe('current execution recovery presentation', () => {
  it('restores the same run and never treats an unknown submission as failure or success', () => {
    const { progress, recovery } = project(publicSource('UNKNOWN', true));
    expect(progress).toMatchObject({ started: true, restored: true, completed: 0, state: 'uncertain' });
    expect(progress.steps[0]?.operations.map(op => op.state)).toEqual(['confirmed', 'uncertain']);
    expect(recovery).toMatchObject({ action: null, operationId: 'swap', label: 'Unable to confirm execution', contextIssue: null });
    expect(recovery.message).not.toMatch(/failed|confirmed whether.*completed successfully/i);
  });
  it('updates the recorded step after reconciliation without restarting the confirmed approval', () => {
    const before = project(publicSource()), after = project(publicSource('CONFIRMED', true));
    expect(before.progress.steps[0]?.operations[0]?.state).toBe('confirmed');
    expect(after.progress).toMatchObject({ completed: 1, state: 'complete', restored: true });
    expect(after.recovery).toMatchObject({ action: null, label: 'Execution recovered' });
  });
  it.each(['PENDING', 'HASH', 'REJECTED', 'REVERTED'] as const)('keeps %s distinct and never offers a generic retry', status => {
    const { progress, recovery } = project(publicSource(status));
    expect(recovery.action).toBe(['PENDING', 'HASH'].includes(status) ? 'observe' : null);
    expect(progress.state).toBe(['REJECTED', 'REVERTED'].includes(status) ? 'attention' : 'active');
    expect(JSON.stringify(recovery)).not.toMatch(/retry|resubmit/i);
  });
  it.each(['wallet', 'network', 'disconnected'] as const)('surfaces %s context while allowing an observation-only status check', change => {
    const wallet = { ...reviewFixture().wallet, ...(change === 'wallet' ? { account: reviewSpender } : change === 'network' ? { chain: 'eip155:42161' } : { account: null }) };
    const { recovery } = project(publicSource(), wallet);
    expect(recovery.contextIssue).toContain(change === 'wallet' ? 'Wallet changed' : change === 'network' ? 'Switch to Base Sepolia' : 'Connect the wallet');
    expect(recovery.action).toBeNull();
  });
  it('does not claim a check is happening just because a transaction is pending', () => {
    const { recovery } = project(publicSource('PENDING'));
    expect(recovery.checking).toBe(false); expect(recovery.label).toBe('Execution in progress');
  });
  it('recognizes a real reconciliation operation and blocks overlapping checks', () => {
    const s = source('fork-pool', { busy: 'Reconciling independent local fork reads', recoveryOnly: true, prepared: { executionId: 'pool', owner: reviewOwner }, status: { journal: { attempts: [{ state: 'PENDING' }] }, transactionHash: hash } });
    const { recovery } = project(s);
    expect(recovery).toMatchObject({ checking: true, action: null, label: 'Checking execution status…' });
  });
  it('uses exact-transaction discovery for an unknown local pool request, never request()', () => {
    const { recovery } = project(source('fork-pool', { busy: false, recoveryOnly: true, prepared: { executionId: 'pool', owner: reviewOwner }, status: { journal: { attempts: [{ state: 'SUBMISSION_RESULT_UNKNOWN' }] }, transactionHash: null } }));
    expect(recovery.action).toBe('recover-unknown');
  });
  it('keeps a divergent local pool verification unresolved even with a confirmed receipt', () => {
    const { progress } = project(source('fork-pool', { busy: false, recoveryOnly: true, prepared: { executionId: 'pool', owner: reviewOwner }, status: { journal: { attempts: [{ state: 'CONFIRMED' }] }, transactionHash: hash, reconciliation: { outcome: 'DIVERGENT' } } }));
    expect(progress.state).toBe('uncertain'); expect(progress.label).not.toBe('Execution confirmed');
  });
  it.each(['POSTING', 'POST_RESULT_UNKNOWN', 'OPEN', 'PARTIALLY_FILLED', 'FULFILLED', 'RECONCILIATION_REQUIRED', 'INCONCLUSIVE', 'RECONCILED', 'CANCELLED'] as const)('preserves signed order %s and chooses its actual read-only capability', status => {
    const { progress, recovery } = project(source('cow', { recoveryOnly: true, busy: false, execution: { record: { executionId: 'order', postingAttemptId: 'post', postCount: 1, state: status, quote: { chainId: 'eip155:31337', owner: reviewOwner } } } }));
    expect(progress.steps[0]?.operations[0]?.hash).toBeNull();
    expect(recovery.action).toBe(['RECONCILIATION_REQUIRED', 'INCONCLUSIVE'].includes(status) ? 'reconcile' : ['RECONCILED', 'CANCELLED', 'FULFILLED'].includes(status) ? null : 'track');
    expect(progress.completed).toBe(status === 'RECONCILED' ? 1 : 0);
  });
  it('only exposes composition known-receipt recovery with its existing Review gate', () => {
    const state = { busy: false, reviewed: true, retired: false, recoveryOnly: false, status: { prepared: { executionId: 'composition', compiled: { permission: { owner: reviewOwner }, installation: [] }, installation: [] }, events: [{ level: 'ATTEMPT', step: 'SWAP', state: 'INCONCLUSIVE', transactionHash: hash }] } };
    const wallet = { ...reviewFixture().wallet, chain: 'eip155:31337' };
    expect(project(source('composition', state), wallet).recovery.action).toBe('recover-known');
    expect(project(source('composition', { ...state, recoveryOnly: true }), wallet).recovery.action).toBe('refresh');
    expect(project(source('composition', state)).recovery.action).toBeNull();
    expect(project(source('composition', { ...state, status: { ...state.status, events: [{ ...state.status.events[0], transactionHash: null }] } }), wallet).recovery.action).toBe('refresh');
  });
});

it('keeps proven non-submission separate from unresolved absence and does not offer replay', () => {
  const f = reviewFixture();
  const state = { busy: false, recovered: true, record: { id: 'supply', provenance: 'PUBLIC_TESTNET', notSubmitted: true, verdict: 'PENDING', review: { workflow: f.workflow, chain: 'eip155:84532', account: reviewOwner }, attempts: [{ step: 'SUPPLY', state: 'NOT_FOUND', transactionHash: null, reconciled: false }] } };
  const proven = project(source('supply', state));
  expect(proven.progress.steps[0]?.operations[0]).toMatchObject({ state: 'not-submitted', label: 'Not submitted' });
  expect(proven.progress.state).toBe('attention'); expect(proven.recovery.action).toBeNull();
  const unresolved = project(source('supply', { ...state, record: { ...state.record, notSubmitted: false } }));
  expect(unresolved.progress.state).toBe('uncertain'); expect(unresolved.recovery.action).toBe('observe');
});
it('distinguishes refreshing a composition record from verifying external state', () => {
  const { recovery } = project(source('composition', { busy: 'Reading fork status', reviewed: false, recoveryOnly: true, status: { prepared: { executionId: 'composition', compiled: { permission: { owner: reviewOwner }, installation: [] }, installation: [] }, events: [{ level: 'ATTEMPT', step: 'SWAP', state: 'INCONCLUSIVE', transactionHash: null }] } }));
  expect(recovery).toMatchObject({ checking: true, recordOnly: true, label: 'Updating recorded status…', action: null });
  expect(recovery.message).toContain('saved execution record');
});

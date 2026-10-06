// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { projectExecutionStepEvidence } from './execution-step-evidence';
import { reviewFixture } from '../test-utils/review-fixture';
import { createRouterNode } from './router-authoring';
import { initialEditor } from './editor';
import type { Workflow } from './initial-workflow';

const hash = '0x' + 'a'.repeat(64);
function project(source: ExecutionLifecycleSource, workflow: Workflow = reviewFixture().workflow) {
  const progress = projectExecutionLifecycle(workflow, reviewFixture().context, source);
  return { progress, evidence: projectExecutionStepEvidence(source, progress) };
}
function source(kind: ExecutionLifecycleSource['kind'], state: unknown) { return { kind, state } as ExecutionLifecycleSource; }
function publicSource(state: string, outcome: unknown = null, restored = false) {
  const fixture = reviewFixture();
  return source('public', { ...fixture.source.state, recoveryOnly: restored,
    run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), outcome,
      attempts: [{ step: 'swap', state, txHash: state === 'CONFIRMED' ? hash : null }] },
  });
}
const first = (result: ReturnType<typeof project>) => Object.values(result.evidence)[0]!;

describe('per-step execution evidence', () => {
  it('shows confirmed without a decorative reconciliation claim or simulated actual values', () => {
    expect(first(project(publicSource('CONFIRMED')))).toMatchObject({ label: 'Confirmed', reconciled: false, recovered: false, comparisons: [] });
  });
  it('compares planned quantities only with actual reconciled execution effects', () => {
    const evidence = first(project(publicSource('CONFIRMED', { inputSpent: '100000000', outputReceived: '24300000000000000', evidence: { outcome: 'RECONCILED' } })));
    expect(evidence.label).toBe('Reconciled');
    expect(evidence.comparisons).toEqual([{ label: 'Input', planned: '100 USDC', actual: '100 USDC' }, { label: 'Output', planned: '0.025 WETH', actual: '0.0243 WETH' }]);
  });
  it.each([null, undefined, '-1', 'not-an-amount'])('omits a comparison when its actual quantity is %s', outputReceived => {
    const evidence = first(project(publicSource('CONFIRMED', { inputSpent: null, outputReceived, evidence: { outcome: 'RECONCILED' } })));
    expect(evidence.comparisons).toEqual([]);
  });
  it('does not turn a restored confirmed snapshot into a recovered or reconciled step', () => {
    expect(first(project(publicSource('CONFIRMED', null, true)))).toMatchObject({ label: 'Confirmed', restored: true, recovered: false, reconciled: false });
  });
  it.each(['UNKNOWN', 'PENDING', 'REVERTED', 'REJECTED'])('retains the real %s step status without comparisons', state => {
    const evidence = first(project(publicSource(state)));
    expect(evidence.comparisons).toEqual([]); expect(evidence.reconciled).toBe(false); expect(evidence.recovered).toBe(false);
    expect(evidence.label).toBe(state === 'UNKNOWN' ? 'Unresolved' : state === 'REJECTED' ? 'Wallet confirmation declined' : state === 'REVERTED' ? 'Failed' : 'Pending confirmation');
  });
  it('ties recovered Supply evidence to the same recorded attempt, not another request', () => {
    const fixture = reviewFixture();
    const current = source('supply', { recovered: true, record: { id: 'supply-run', provenance: 'PUBLIC_TESTNET',
      review: { workflow: fixture.workflow, chain: 'eip155:84532', approvalRequired: false },
      attempts: [{ step: 'SUPPLY', state: 'CONFIRMED', transactionHash: hash, reconciled: true }],
      journal: { entries: [{ level: 'attempt', entityId: 'supply-run.SUPPLY', toState: 'SUBMISSION_RESULT_UNKNOWN' }, { level: 'attempt', entityId: 'supply-run.SUPPLY', toState: 'CONFIRMED' }] },
    } });
    expect(first(project(current))).toMatchObject({ label: 'Reconciled', recovered: true });
    const record = current.kind === 'supply' ? current.state.record! : null;
    record!.journal.entries[0]!.entityId = 'different-attempt';
    expect(first(project(current)).recovered).toBe(false);
  });
  it('shows known-hash composition recovery before claiming reconciliation', () => {
    const events = [{ level: 'ATTEMPT', step: 'SWAP', state: 'INCONCLUSIVE', callHash: hash, transactionHash: hash },
      { level: 'ATTEMPT', step: 'SWAP', state: 'CONFIRMED', callHash: hash, transactionHash: hash }];
    const prepared = { executionId: 'composition', quoteOut: '25000000000000000', compiled: { installation: [] }, installation: [] };
    expect(first(project(source('composition', { recoveryOnly: true, status: { prepared, events } })))).toMatchObject({ label: 'Confirmed', recovered: true, reconciled: false, comparisons: [] });
    const reconciled = [...events, { level: 'ATTEMPT', step: 'SWAP', state: 'RECONCILED', callHash: hash, transactionHash: hash, actualWETH: '24300000000000000' }];
    expect(first(project(source('composition', { recoveryOnly: true, status: { prepared, events: reconciled } })))).toMatchObject({ label: 'Reconciled', recovered: true, comparisons: [{ label: 'Output', planned: '0.025 WETH', actual: '0.0243 WETH' }] });
  });
  it('keeps a confirmed bridge source distinct from reconciled destination settlement', () => {
    const workflow = { ...initialEditor().workflow, revision: 1, resourceEdges: [], nodes: [createRouterNode('bridge', { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '5', recipient: '', slippage: '50', routing: 'AUTO' })] };
    const record = { id: 'bridge', workflow, provenance: 'PUBLIC_TESTNET', phase: 'IN_FLIGHT', verdict: 'PENDING', destination: null,
      review: { nodeId: workflow.nodes[0]!.nodeId, intent: { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614' }, route: { inputToken: { symbol: 'USDC' }, routingProvider: 'across' }, calls: [{ purpose: 'BRIDGE_DEPOSIT' }] },
      attempts: [{ step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: hash, reconciled: true }],
    };
    expect(first(project(source('router', { record }), workflow))).toMatchObject({ label: 'Pending confirmation', reconciled: false });
    expect(first(project(source('router', { record: { ...record, phase: 'RECONCILED', verdict: 'RECONCILED', destination: { transactionHash: hash } } }), workflow))).toMatchObject({ label: 'Reconciled', reconciled: true });
  });
  it.each(['OPEN', 'FULFILLED', 'RECONCILIATION_REQUIRED', 'RECONCILED'])('preserves signed intent %s truth', state => {
    const result = project(source('cow', { recoveryOnly: true, execution: { record: { executionId: 'cow', state, quote: { chainId: 'eip155:31337' }, history: [{ state: 'RECONCILIATION_REQUIRED' }, { state }] } } }));
    expect(first(result).reconciled).toBe(state === 'RECONCILED'); expect(first(result).recovered).toBe(false);
    expect(result.progress.steps[0]!.operations[0]!.hash).toBeNull();
    expect(first(result).label).toBe(state === 'RECONCILED' ? 'Reconciled' : 'Settlement pending');
  });
  it('does not change the runtime or lifecycle snapshot', () => {
    const current = publicSource('CONFIRMED'), progress = projectExecutionLifecycle(reviewFixture().workflow, reviewFixture().context, current);
    const before = JSON.stringify([current, progress]);
    projectExecutionStepEvidence(current, progress);
    expect(JSON.stringify([current, progress])).toBe(before);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { transactionLifecycle, intentLifecycle, executionExplorer, projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { reviewFixture } from '../test-utils/review-fixture';
import { editorReducer, initialEditor } from './editor';
import { createRouterNode } from './router-authoring';
import { canvasAddCommand } from './canvas-authoring';
import { initialWorkflow } from './initial-workflow';
const hash = `0x${'a'.repeat(64)}`;
const fixture = () => reviewFixture();
// Minimal observations in the exact existing store shapes; no submission callbacks.
const source = (kind: ExecutionLifecycleSource['kind'], state: unknown) => ({ kind, state }) as ExecutionLifecycleSource;
const project = (kind: ExecutionLifecycleSource['kind'], state: unknown) => { const f = fixture(); return projectExecutionLifecycle(f.workflow, f.context, source(kind, state)); };
function publicRun(attempts: unknown[]) { const f = fixture(); return { ...f.source.state, run: { ...('run' in f.source.state ? f.source.state.run : {}), attempts } }; }
describe('truthful transaction and order observations', () => {
  it.each([['PREPARED', 'preparing'], ['SUBMITTING', 'submitting'], ['HASH', 'submitted'], ['PENDING', 'pending'], ['CONFIRMED', 'confirmed'], ['REVERTED', 'failed'], ['REJECTED', 'failed'], ['CANCELLED', 'cancelled'], ['SUBMISSION_RESULT_UNKNOWN', 'uncertain'], ['INCONCLUSIVE', 'uncertain'], ['NOT_FOUND', 'uncertain'], ['RECONCILIATION_REQUIRED', 'uncertain']] as const)('maps %s to %s without interpreting absence as success', (raw, expected) => expect(transactionLifecycle(raw, null)).toBe(expected));
  it('claims wallet confirmation only while a real prepared/submitting request is signing', () => {
    expect(transactionLifecycle('SUBMITTING', null, true)).toBe('wallet'); expect(transactionLifecycle('PREPARED', null, true)).toBe('wallet');
    expect(transactionLifecycle(null, null, true)).toBe('waiting'); expect(transactionLifecycle('PENDING', hash, true)).toBe('pending');
    expect(transactionLifecycle('SUBMITTING', hash, true)).toBe('submitted');
  });
  it.each([['SIGNED', 'signed'], ['POSTING', 'submitting'], ['POSTED', 'posted'], ['OPEN', 'settling'], ['PARTIALLY_FILLED', 'partial'], ['FULFILLED', 'settling'], ['RECONCILED', 'confirmed'], ['POST_RESULT_UNKNOWN', 'uncertain'], ['DIVERGENT', 'uncertain']] as const)('keeps order %s as %s without fake transaction semantics', (raw, state) => expect(intentLifecycle(raw)).toBe(state));
  it('only generates existing chain explorer links for valid public transaction identifiers', () => {
    expect(executionExplorer('eip155:84532', hash)).toContain(`/tx/${hash}`);
    expect(executionExplorer('eip155:84532', hash, true)).toBeNull(); expect(executionExplorer('eip155:31337', hash)).toBeNull();
    expect(executionExplorer('eip155:9999999', hash)).toBeNull(); expect(executionExplorer('eip155:84532', 'made-up-hash')).toBeNull();
  });
});
describe('current-run ordered lifecycle projection', () => {
  it('keeps approval separate, preserves the real hash and does not start the swap early', () => {
    const view = project('public', publicRun([{ step: 'approval', state: 'PENDING', txHash: hash, receipt: null }]));
    expect(view).toMatchObject({ started: true, completed: 0, state: 'active', label: 'Execution in progress' });
    expect(view.steps[0]?.operations).toMatchObject([{ title: 'Approve USDC', state: 'pending', approval: true, hash }, { title: 'Swap', state: 'waiting', hash: null }]);
    expect(view.steps[0]?.operations.every(op => op.fee === null)).toBe(true);
  });
  it('confirms the workflow only after the business transaction is confirmed and formats actual receipt cost', () => {
    const view = project('public', publicRun([{ step: 'approval', state: 'CONFIRMED', txHash: hash, receipt: null }, { step: 'swap', state: 'CONFIRMED', txHash: hash, receipt: { gasCostWei: '123000000000000' } }]));
    expect(view).toMatchObject({ completed: 1, state: 'complete' }); expect(view.steps[0]?.operations[1]?.fee).toBe('0.000123 ETH');
  });
  it.each(['UNKNOWN', 'REVERTED', 'REJECTED'] as const)('keeps %s distinct from confirmation and waiting', raw => {
    const view = project('public', publicRun([{ step: 'swap', state: raw, txHash: raw === 'REVERTED' ? hash : null }]));
    expect(view.state).toBe(raw === 'UNKNOWN' ? 'uncertain' : 'attention'); expect(view.completed).toBe(0);
    expect(view.steps[0]?.state).toBe(raw === 'UNKNOWN' ? 'uncertain' : 'failed');
  });
  it('uses the saved workflow for an existing/restored run even when Build now differs', () => {
    const f = fixture(), state = { ...publicRun([{ step: 'swap', state: 'PENDING', txHash: hash }]), recoveryOnly: true };
    const view = projectExecutionLifecycle(initialEditor().workflow, f.context, source('public', state));
    expect(view.steps).toHaveLength(1); expect(view.steps[0]?.input).toBe('100 USDC'); expect(view.restored).toBe(true); expect(view.started).toBe(true);
  });
  it('renders composed actions in workflow order with downstream actions waiting', () => {
    const f = fixture(), workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, f.wallet.account!, '1'), f.context).workflow;
    const nodes = workflow.nodes.filter(node => node.actionType !== 'trigger');
    const ids = ['POOL_APPROVAL', 'SUPPLY', 'BORROW', 'ROUTER_APPROVAL', 'SWAP'];
    const calls = ids.map((id, index) => ({ id, nodeId: nodes[index < 2 ? 0 : index === 2 ? 1 : 2]!.nodeId }));
    const view = projectExecutionLifecycle(workflow, f.context, source('lending', { busy: false, signing: false, recovered: false, record: { id: 'lending-run', provenance: 'PUBLIC_TESTNET', reviews: [{ workflow, manifest: f.manifest, calls }], attempts: [{ id: 'approve', step: 'POOL_APPROVAL', state: 'CONFIRMED', hash, reconciled: true }, { id: 'supply', step: 'SUPPLY', state: 'PENDING', hash, reconciled: false }], observations: [] } }));
    expect(view.steps.map(step => step.action)).toEqual(['Supply', 'Borrow', 'Swap']); expect(view.steps.map(step => step.state)).toEqual(['pending', 'waiting', 'waiting']);
    expect(view.active?.action).toBe('Supply'); expect(view.completed).toBe(0); expect(view.steps[0]?.operations[0]?.approval).toBe(true);
  });
  it('does not label a signed-but-unbroadcast Solana transaction as submitted', () => {
    const f = fixture(), view = project('solana-swap', { signing: false, busy: true, recovered: false, record: { id: 'solana-run', provenance: 'PUBLIC_MAINNET', review: { workflow: f.workflow, chain: 'solana:mainnet-beta' }, attempt: { state: 'SUBMITTING', signature: '1'.repeat(88), reconciled: false } } });
    expect(view.steps[0]?.operations[0]).toMatchObject({ state: 'submitting', label: 'Submitting' });
  });
  it('preserves signed-intent settlement and never fabricates its transaction hash', () => {
    const view = project('cow', { recoveryOnly: true, busy: false, execution: { record: { executionId: 'order', state: 'OPEN', quote: { chainId: 'eip155:31337' } } } });
    expect(view).toMatchObject({ local: true, restored: true, state: 'active' }); expect(view.steps[0]?.operations[0]).toMatchObject({ intent: true, state: 'settling', hash: null });
  });
});

describe('adapter-specific lifecycle boundaries', () => {
  it('keeps restored composition requests visible without inventing the original workflow', () => {
    const state = { busy: false, recoveryOnly: true, status: { prepared: { executionId: 'restored-composition', compiled: { installation: [{}] }, installation: [{ index: 0, hash }] }, events: [{ level: 'ATTEMPT', step: 'SWAP', state: 'INCONCLUSIVE', transactionHash: hash }] } };
    const view = projectExecutionLifecycle(initialWorkflow(), fixture().context, source('composition', state));
    expect(view).toMatchObject({ started: true, restored: true, planUnavailable: true, state: 'uncertain', completed: 0 });
    expect(view.steps.map(step => step.action)).toEqual(['Swap', 'Add liquidity']);
    expect(view.steps.map(step => step.state)).toEqual(['uncertain', 'waiting']);
    expect(view.steps[0]?.operations).toMatchObject([{ state: 'confirmed', hash }, { state: 'uncertain', hash }]);
    expect(view.steps.every(step => step.input === '—' && step.tokens.length === 0)).toBe(true);
    // A different current Build must never supply values for the restored record.
    expect(project('composition', state).steps).toEqual(view.steps);
  });
  it('shows restored local pool and signed order status even when Build is empty', () => {
    const f = fixture();
    const pool = projectExecutionLifecycle(initialWorkflow(), f.context, source('fork-pool', { busy: false, recoveryOnly: true, prepared: { executionId: 'pool' }, status: { journal: { attempts: [{ state: 'SUBMISSION_RESULT_UNKNOWN' }] }, transactionHash: null } }));
    expect(pool.steps[0]).toMatchObject({ action: 'Liquidity transaction', state: 'uncertain' });
    const cow = projectExecutionLifecycle(initialWorkflow(), f.context, source('cow', { busy: false, recoveryOnly: true, execution: { record: { executionId: 'order', state: 'OPEN', quote: { chainId: 'eip155:31337' } } } }));
    expect(cow.steps[0]).toMatchObject({ action: 'Signed order', state: 'settling', provider: 'CoW Protocol' });
    expect(cow.steps[0]?.operations[0]?.hash).toBeNull(); expect(cow.completed).toBe(0);
  });
  it('preserves an uncertain delegated worker result after permission setup is complete', () => {
    const view = project('delegated-swap', { busy: false, unknownSubmission: true, status: { prepared: { executionId: 'unknown-worker', installationStart: 0, installation: [{ index: 0, hash }], compiled: { installation: [{}] }, executionHash: null } } });
    expect(view).toMatchObject({ started: true, state: 'uncertain', completed: 0 });
    expect(view.steps[0]?.operations.map(op => op.state)).toEqual(['confirmed', 'uncertain']);
  });
  it('waits for destination settlement after a confirmed bridge deposit', () => {
    const f = fixture(), workflow = { ...initialEditor().workflow, revision: 1, resourceEdges: [], nodes: [createRouterNode('bridge', { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '5', recipient: '', slippage: '50', routing: 'AUTO' })] };
    const nodeId = workflow.nodes.find(node => node.actionType === 'asset.bridge')!.nodeId;
    const record = { id: 'bridge', workflow, provenance: 'PUBLIC_TESTNET', phase: 'IN_FLIGHT', verdict: 'PENDING', destination: null, review: { nodeId, intent: { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614' }, route: { inputToken: { symbol: 'USDC' }, routingProvider: 'across' }, calls: [{ purpose: 'BRIDGE_DEPOSIT' }] }, attempts: [{ step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: hash, reconciled: true, receipt: null }] };
    const view = projectExecutionLifecycle(workflow, f.context, source('router', { record, busy: false, signing: false, recovered: false }));
    expect(view.steps[0]?.action).toBe('Bridge'); expect(view.steps[0]?.operations).toMatchObject([{ state: 'confirmed' }, { title: 'Destination settlement', state: 'pending', hash: null }]);
    expect(view.completed).toBe(0); expect(view.state).toBe('active');
    const settled = projectExecutionLifecycle(workflow, f.context, source('router', { record: { ...record, phase: 'RECONCILED', verdict: 'RECONCILED', destination: { transactionHash: hash } }, busy: false }));
    expect(settled.completed).toBe(1); expect(settled.steps[0]?.operations[1]?.hash).toBe(hash);
  });
  it('attaches the real signing flag only to the current Supply approval', () => {
    const f = fixture(), workflow = editorReducer(initialEditor(), canvasAddCommand('supply', 0, f.wallet.account, '100'), f.context).workflow;
    const view = projectExecutionLifecycle(workflow, f.context, source('supply', { signing: true, busy: true, record: { id: 'supply', provenance: 'PUBLIC_TESTNET', review: { workflow, approvalRequired: true, chain: 'eip155:84532' }, attempts: [{ step: 'APPROVAL', state: 'SUBMITTING', transactionHash: null, reconciled: false }] } }));
    expect(view.steps[0]?.operations).toMatchObject([{ state: 'wallet', label: 'Confirm in wallet' }, { state: 'waiting' }]); expect(view.active?.action).toBe('Supply');
  });
  it('keeps later permission requests waiting after an uncertain installation', () => {
    const prepared = { executionId: 'permissions', compiled: { installation: [{}, {}, {}] }, installation: [{ index: 0, hash }], installationStart: 0, executionHash: null };
    const view = project('delegated-swap', { status: { prepared }, recoveryOnly: false, busy: false, unknownSubmission: true });
    expect(view.steps[0]?.operations.map(op => op.state)).toEqual(['confirmed', 'uncertain', 'waiting', 'waiting']); expect(view.local).toBe(true);
    expect(view.steps[0]?.operations.every(op => op.explorer === null)).toBe(true);
  });
  it('a worker hash alone proves submission, not confirmation', () => {
    const view = project('delegated-swap', { busy: false, unknownSubmission: false, status: { prepared: { executionId: 'worker', compiled: { installation: [] }, installation: [], installationStart: 0, executionHash: hash, reconciliation: null } } });
    expect(view.steps[0]?.operations[0]).toMatchObject({ state: 'submitted', hash }); expect(view.completed).toBe(0);
  });
  it('an expired Solana signature with non-execution proof is expired rather than still pending', () => {
    const f = fixture(), view = project('solana-swap', { signing: false, busy: false, record: { id: 'expired', provenance: 'PUBLIC_MAINNET', review: { workflow: f.workflow, chain: 'solana:mainnet-beta' }, attempt: { state: 'NOT_FOUND', signature: '1'.repeat(88), reconciled: false }, verdict: 'NOT_EXECUTED' } });
    expect(view.steps[0]?.operations[0]).toMatchObject({ state: 'expired', label: 'Transaction expired' }); expect(view.state).toBe('attention'); expect(view.completed).toBe(0);
  });
  it('a divergent run cannot present a successful workflow even if a receipt was confirmed', () => {
    const f = fixture(), view = project('supply', { signing: false, busy: false, record: { id: 'divergent', provenance: 'PUBLIC_TESTNET', review: { workflow: f.workflow, chain: 'eip155:84532', approvalRequired: false }, attempts: [{ step: 'SUPPLY', state: 'CONFIRMED', transactionHash: hash, reconciled: false }], verdict: 'DIVERGENT' } });
    expect(view.steps[0]?.operations[0]?.state).toBe('confirmed'); expect(view.state).toBe('uncertain'); expect(view.label).not.toBe('Execution confirmed');
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { editorReducer, initialEditor } from './editor';
import { canvasAddCommand } from './canvas-authoring';
import { createCryptoActionNode, selectCryptoNetwork } from './crypto-action-picker';
import { projectReview } from './review-presentation';
import { projectCanvasAction } from './canvas-lifecycle';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { reviewFixture, reviewNow, reviewExpiry } from '../test-utils/review-fixture';
import type { SimulationSource } from './simulation-presentation';
import type { ExecutionControlsState } from '../state/execution-controls';

const controls = { requesting: false, verifying: false, canContinue: false, canCheck: false };
function fixture(kind: 'public' | 'router' | 'supply' | 'solana-swap'): ExecutionControlsState {
  const f = reviewFixture();
  if (kind === 'supply' || kind === 'router') f.workflow = editorReducer(initialEditor(), canvasAddCommand(kind === 'supply' ? 'supply' : 'bridge', 0, f.wallet.account, '100'), f.context).workflow;
  if (kind === 'solana-swap') {
    f.workflow = { ...f.workflow, nodes: [createCryptoActionNode('solana-swap', { selection: selectCryptoNetwork('swap', 'Solana Devnet'), amount: '1', slippage: '50' })]  };
    const chain = f.workflow.nodes[0]!.chainId;
    f.wallet.chain = chain; f.authorization.chain = chain; f.manifest.owner = { ...f.manifest.owner, chainId: chain };
  }
  const digest = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(f.workflow)));
  f.manifest.semanticWorkflowRevision = f.workflow.revision; f.policy.semanticWorkflowHash = digest; f.manifest.semanticWorkflowHash = digest;
  f.manifest.policyHash = hashArtifactBytes('authorization-policy', new TextEncoder().encode(JSON.stringify(f.policy)));
  const q = { workflow: f.workflow, expiresAt: reviewExpiry };
  const states = {
    public: f.source.state,
    supply: { record: { provenance: 'PUBLIC_TESTNET', verdict: 'PENDING', error: null, review: { ...q, amount: '100000000', approvalRequired: false, manifest: f.manifest } } },
    'solana-swap': { record: { provenance: 'PUBLIC_DEVNET', verdict: 'PENDING', error: null, review: { ...q, cluster: 'devnet', input: { symbol: 'USDC', decimals: 6 }, output: { symbol: 'SOL', decimals: 9 }, slippageBps: 50, quote: { outAmount: '100000000', otherAmountThreshold: '99500000', priceImpactPct: '0', routePlan: [] }, estimatedFeeLamports: '5000', simulationResult: { inputSpent: '100000000', outputReceived: '100000000', accountCreationLamports: '0', feeLamports: '5000' } } } },
    router: { record: { workflow: f.workflow, provenance: 'PUBLIC_TESTNET', verdict: 'PENDING', error: null, requote: false, review: { workflowHash: f.manifest.semanticWorkflowHash, revision: f.workflow.revision, nodeId: f.workflow.nodes.at(-1)!.nodeId, expiresAt: reviewExpiry, selection: { selected: 'lifi' }, route: { inputToken: { symbol: 'USDC', decimals: 6 }, outputToken: { symbol: 'USDC', decimals: 6 }, inputAmount: '100000000', underlyingProtocol: 'across', slippageBps: 50, fees: [] }, quote: { expectedOutput: '99000000', minimumOutput: '98500000', feeTotal: '1000000', expiresAt: reviewExpiry }, deadlines: { depositMustLandBy: (reviewNow + 100000) / 1000 }, approvals: [], fees: { totalUpperBoundWei: '1', executionFeeUpperBoundWei: '1', l1FeeUpperBoundWei: '0' } } } },
  };
  return { ...f, source: { kind, state: { busy: false, error: null, retired: false, ...states[kind] } } as unknown as SimulationSource,
    execution: { ready: true, started: false, start: vi.fn(), prompt: '', expiresAt: null, requiresMainnetAcknowledgement: false } };
}
describe('shared Canvas lifecycle across runtime projections', () => {
  it('allows a new edited workflow after completion, while preserving recovery for an unresolved old run', () => {
    const f = fixture('public');
    const state = { ...f.source.state, recoveryOnly: true, retired: true, run: {
      workflow: f.workflow, quote: { executionId: 'saved', nodeId: f.workflow.nodes.at(-1)!.nodeId, chainId: 84532 },
      attempts: [{ step: 'swap', state: 'CONFIRMED', txHash: `0x${'a'.repeat(64)}` }],
    } };
    const source = { kind: 'public', state } as unknown as ExecutionLifecycleSource;
    f.progress = projectExecutionLifecycle(f.workflow, f.context, source);
    expect(projectCanvasAction(f, controls, reviewNow)).toMatchObject({ kind: 'status', label: 'Execution completed' });
    f.workflow = { ...f.workflow, revision: f.workflow.revision + 1 };
    f.source = { kind: 'public', state } as unknown as SimulationSource;
    f.progress = projectExecutionLifecycle(f.workflow, f.context, source);
    expect(projectCanvasAction(f, controls, reviewNow)).toMatchObject({ kind: 'simulate', label: 'Simulate again' });
    state.run.attempts[0]!.state = 'UNKNOWN';
    f.progress = projectExecutionLifecycle(f.workflow, f.context, source);
    expect(projectCanvasAction(f, { ...controls, canCheck: true }, reviewNow)).toMatchObject({ kind: 'recover' });
  });
  it('shows completion without a financial action, and unresolved recovery without a simulation retry', () => {
    const f = fixture('public');
    f.progress = { started: true, restored: true, local: false, steps: [], active: null, completed: 1,
      label: 'Execution completed', message: '', state: 'complete', runKey: 'recorded', fingerprint: 'complete', busy: false };
    expect(projectCanvasAction(f, controls, reviewNow)).toEqual({ kind: 'status', label: 'Execution completed', disabled: true });
    // A legacy saved record without its canonical plan cannot prove that the
    // editor represents a new workflow; keep its completed result closed.
    f.progress.planUnavailable = true; f.progress.matchesWorkflow = false;
    expect(projectCanvasAction(f, controls, reviewNow)).toEqual({ kind: 'status', label: 'Execution completed', disabled: true });
    f.progress.state = 'uncertain'; f.progress.completed = 0;
    expect(projectCanvasAction(f, { ...controls, canCheck: true }, reviewNow)).toEqual({ kind: 'recover', label: 'Recover execution', disabled: false });
    expect(projectCanvasAction(f, controls, reviewNow)).toEqual({ kind: 'status', label: 'Recover execution', disabled: true });
  });
  it.each(['public', 'router', 'supply', 'solana-swap'] as const)('%s uses Simulate → Approve → Execute without invoking authority', kind => {
    const f = fixture(kind), approve = vi.fn(); f.authorization.approve = approve;
    const key = f.authorization.key; f.authorization.key = null;
    expect(projectCanvasAction(f, controls, reviewNow)).toMatchObject({ kind: 'simulate', label: 'Simulate workflow', disabled: false });
    f.authorization.key = key;
    expect(projectCanvasAction(f, controls, reviewNow), projectReview(f.workflow, f.context, f.source, f.authorization, f.wallet, reviewNow).message).toEqual({ kind: 'approve', label: 'Approve & Continue', disabled: false });
    f.authorization.accepted = true;
    expect(projectCanvasAction(f, controls, reviewNow)).toEqual({ kind: 'execute', label: 'Execute workflow', disabled: false });
    expect(projectCanvasAction(f, { ...controls, requesting: true }, reviewNow)).toMatchObject({ kind: 'status', label: 'Waiting for wallet…' });
    expect(projectCanvasAction(f, { ...controls, verifying: true }, reviewNow)).toMatchObject({ kind: 'status', label: 'Reconciling…' });
    expect(projectCanvasAction(f, controls, reviewNow + 120001)).toMatchObject({ kind: 'simulate', label: 'Simulate again' });
    expect(approve).not.toHaveBeenCalled(); expect(f.execution.start).not.toHaveBeenCalled();
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { initialEditor } from './editor';
import { canContinueExecution, projectExecution, startReviewedExecution, type ExecutionWorkspaceState } from './execution-presentation';
import { reviewFixture, reviewNow, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
function fixture(): ExecutionWorkspaceState {
  const data = reviewFixture(); data.authorization.accepted = true;
  return { ...data, execution: { ready: true, started: false, start: vi.fn(), prompt: 'Confirm in your wallet.', expiresAt: null, requiresMainnetAcknowledgement: false } };
}
describe('Execute preflight presentation and explicit start boundary', () => {
  it('uses the reviewed plan and requires both authorization and runtime readiness', () => {
    const data = fixture(), view = projectExecution(data, reviewNow);
    expect(view.canExecute).toBe(true); expect(view.label).toBe('Ready to execute');
    expect(view.steps).toMatchObject([{ number: 1, action: 'Swap', input: '100 USDC', network: 'Base Sepolia' }]);
    expect(data.execution.start).not.toHaveBeenCalled();
    data.authorization.accepted = false;
    expect(projectExecution(data, reviewNow)).toMatchObject({ canExecute: false, label: 'Authorization required' });
    data.authorization.accepted = true; data.execution.ready = false;
    expect(projectExecution(data, reviewNow).canExecute).toBe(false);
  });
  it.each(['amount', 'slippage', 'asset', 'network', 'provider', 'revision', 'policy', 'spend-limit', 'approval-bound'] as const)('blocks %s changes after authorization', change => {
    const data = fixture(); let workflow = data.workflow;
    workflow = { ...workflow, ...(change === 'revision' ? { revision: workflow.revision + 1 } : {}), nodes: workflow.nodes.map(node => ({
      ...node,
      ...(change === 'network' ? { chainId: 'eip155:42161' } : {}),
      ...(change === 'provider' ? { adapterConstraints: { ...node.adapterConstraints, protocols: ['another-provider'] } } : {}),
      inputs: node.inputs.map(input => input.kind === 'QUANTITY' ? { ...input, value: { ...input.value,
        ...(change === 'amount' ? { amount: '101000000' } : {}),
        ...(change === 'asset' && 'address' in input.value.asset ? { asset: { ...input.value.asset, address: reviewSpender } } : {}),
      } } : input),
      userConstraints: node.userConstraints.map(limit => change === 'slippage' && limit.kind === 'MAXIMUM_SLIPPAGE_BPS' ? { ...limit, maximumBps: 75 } : limit),
    })) };
    if (change === 'policy' || change === 'spend-limit') {
      const policy = structuredClone(data.authorization.policy);
      if (change === 'policy') (policy as ReturnType<typeof reviewFixture>['policy']).maximumSlippageBps = 100;
      else (policy as ReturnType<typeof reviewFixture>['policy']).spendLimits[0]!.maximumAmount = '200000000';
      data.authorization.policy = policy;
    }
    if (change === 'approval-bound') {
      // Real stores mark the authorization unavailable when its reviewed call changes.
      data.authorization.ready = false;
      data.authorization.approvals = [{ token: reviewSpender, chain: 'eip155:84532', spender: reviewSpender, amount: '200000000', kind: 'exact' }];
    }
    data.workflow = workflow;
    expect(projectExecution(data, reviewNow).canExecute).toBe(false);
    startReviewedExecution(data, reviewNow); expect(data.execution.start).not.toHaveBeenCalled();
  });
  it.each(['wallet', 'wallet-return', 'network', 'unknown', 'disconnect'] as const)('blocks %s transitions using the shared Review wallet binding', change => {
    const data = fixture();
    data.wallet.changed = true;
    if (change === 'wallet') data.wallet.account = reviewSpender;
    if (change === 'wallet-return') data.wallet.account = reviewOwner;
    if (change === 'network') data.wallet.chain = 'eip155:42161';
    if (change === 'unknown') { data.wallet.chain = null; data.wallet.environment = 'unknown'; }
    if (change === 'disconnect') data.wallet.account = null;
    expect(projectExecution(data, reviewNow).canExecute).toBe(false);
    startReviewedExecution(data, reviewNow); expect(data.execution.start).not.toHaveBeenCalled();
  });
  it('checks expiry at click time even if the visible button has not rerendered', () => {
    const data = fixture(); expect(projectExecution(data, reviewNow).canExecute).toBe(true);
    startReviewedExecution(data, reviewNow + 120_001);
    expect(data.execution.start).not.toHaveBeenCalled();
    expect(projectExecution(data, reviewNow + 120_001)).toMatchObject({ label: 'Simulation expired', canExecute: false });
    data.execution.expiresAt = reviewNow;
    expect(projectExecution(data, reviewNow).canExecute).toBe(false);
  });
  it('requires explicit action and never starts a recorded request again', () => {
    const data = fixture(); projectExecution(data, reviewNow);
    expect(data.execution.start).not.toHaveBeenCalled();
    startReviewedExecution(data, reviewNow); expect(data.execution.start).toHaveBeenCalledOnce();
    data.execution.started = true; startReviewedExecution(data, reviewNow);
    expect(data.execution.start).toHaveBeenCalledOnce(); expect(projectExecution(data, reviewNow).label).toBe('Execution already started');
  });
  it('blocks busy, failed, invalid and missing workflows without inventing readiness', () => {
    for (const transition of ['loading', 'error', 'invalid', 'empty']) {
      const data = fixture();
      if (transition === 'loading') Object.assign(data.source.state, { busy: 'raw_request_id' });
      if (transition === 'error') Object.assign(data.source.state, { error: 'INSUFFICIENT_USDC' });
      if (transition === 'invalid') data.invalidWorkflow = true;
      if (transition === 'empty') data.workflow = initialEditor().workflow;
      const view = projectExecution(data, reviewNow);
      expect(view.canExecute).toBe(false); expect(view.message).not.toMatch(/raw_request_id|INSUFFICIENT_USDC/);
    }
  });
  it('preserves the existing Solana mainnet acknowledgement gate', () => {
    const data = fixture(); data.execution.requiresMainnetAcknowledgement = true;
    expect(projectExecution(data, reviewNow)).toMatchObject({ label: 'Confirmation required', canExecute: false });
    data.acknowledged = true; expect(projectExecution(data, reviewNow).canExecute).toBe(true);
  });
  it('distinguishes a missing review from an unapproved current review', () => {
    const data = fixture(); data.authorization.key = null;
    expect(projectExecution(data, reviewNow)).toMatchObject({ label: 'Review required', canExecute: false });
    data.authorization.key = 'test-review'; data.authorization.accepted = false;
    expect(projectExecution(data, reviewNow)).toMatchObject({ label: 'Authorization required', canExecute: false });
    startReviewedExecution(data, reviewNow); expect(data.execution.start).not.toHaveBeenCalled();
  });
  it.each(['wallet', 'network', 'disconnect'] as const)('keeps the known %s issue visible when review authority is missing', issue => {
    const data = fixture(); data.authorization.key = null;
    if (issue === 'wallet') { data.wallet.account = reviewSpender; data.wallet.changed = true; }
    if (issue === 'network') data.wallet.chain = 'eip155:42161';
    if (issue === 'disconnect') data.wallet.account = null;
    expect(projectExecution(data, reviewNow)).toMatchObject({ canExecute: false, label: issue === 'wallet' ? 'Wallet changed' : issue === 'network' ? 'Network changed' : 'Connect your wallet' });
    startReviewedExecution(data, reviewNow); expect(data.execution.start).not.toHaveBeenCalled();
  });
});

describe('secure explicit continuation', () => {
  it('allows a never-attempted next call after consumed Review readiness, while preserving Review binding', () => {
    const data = fixture(); data.execution.started = true; data.execution.next = vi.fn(); data.authorization.ready = false;
    expect(canContinueExecution(data, reviewNow)).toBe(true);
    expect(projectExecution(data, reviewNow).authorizationLabel).toBe('Reviewed and approved');
    expect(projectExecution(data, reviewNow).canExecute).toBe(false);
    expect(data.execution.next).not.toHaveBeenCalled();
  });
  it.each(['wallet', 'network', 'workflow', 'policy', 'expired', 'busy', 'runtime', 'invalid'] as const)('blocks continuation on %s without a new request', change => {
    const data = fixture(); data.execution.started = true; data.execution.next = vi.fn(); data.authorization.ready = false;
    if (change === 'wallet') data.wallet.changed = true;
    if (change === 'network') data.wallet.chain = 'eip155:42161';
    if (change === 'workflow') data.workflow = { ...data.workflow, revision: data.workflow.revision + 1 };
    if (change === 'policy') data.authorization.policy = { ...reviewFixture().policy, maximumSlippageBps: 100 };
    if (change === 'busy') Object.assign(data.source.state, { busy: true });
    if (change === 'runtime') data.execution.ready = false;
    if (change === 'invalid') data.invalidWorkflow = true;
    expect(canContinueExecution(data, change === 'expired' ? reviewNow + 120_001 : reviewNow)).toBe(false);
    expect(data.execution.next).not.toHaveBeenCalled();
  });
});

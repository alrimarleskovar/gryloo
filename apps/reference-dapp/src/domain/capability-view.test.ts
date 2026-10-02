// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { resolveNodeCapability, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { capabilityBlockMessage, nodeCapabilityLabel, primaryExecutionBlocker, workflowExecutionLabel } from './capability-view';

const swap = {
  nodeId: 'swap-1', actionType: 'asset.swap.exact-input', chainId: 'eip155:8453',
  adapterConstraints: { adapters: [], protocols: ['uniswap'] }, requiredAuthorizationClass: 'MODE_A',
} as unknown as SemanticWorkflow['nodes'][number];

describe('capability explanations', () => {
  it('names unsupported public execution without presenting fork evidence as testnet evidence', () => {
    const publicRun = resolveWorkflowCapability({ nodes: [swap] }, { environment: 'PUBLIC_TESTNET' });
    expect(workflowExecutionLabel(publicRun)).toBe('Testnet unavailable');
    expect(publicRun.capabilities.SIMULATE).toBe(true);
    expect(publicRun.evidenceCeiling).toBeNull();
    expect(capabilityBlockMessage(publicRun.blockers[0]!, publicRun.nodes[0])).toBe(
      'Swap · Public test execution is not available yet.');
  });
  it('explains that a Robinhood Testnet swap has no canonical protocol deployment', () => {
    const result = resolveWorkflowCapability({ nodes: [{ ...swap, chainId: 'eip155:46630' }] }, { environment: 'PUBLIC_TESTNET' });
    expect(workflowExecutionLabel(result)).toBe('Testnet unavailable');
    expect(nodeCapabilityLabel(result.nodes[0]!)).toBe('Unavailable here');
    expect(capabilityBlockMessage(primaryExecutionBlocker(result)!, result.nodes[0])).toBe(
      'Swap · The selected protocol has no canonical deployment on this network.');
  });
  it('keeps a template blocker visible even when another node lacks public execution', () => {
    const borrow = { ...swap, nodeId: 'borrow-1', actionType: 'mock-borrow', chainId: 'mock:local',
      adapterConstraints: { adapters: [], protocols: [] }, requiredAuthorizationClass: 'NONE' } as typeof swap;
    const result = resolveWorkflowCapability({ nodes: [borrow, swap] }, { environment: 'PUBLIC_TESTNET' });
    const blocker = primaryExecutionBlocker(result, 'borrow-1')!;
    expect(blocker).toMatchObject({ nodeId: 'borrow-1', code: 'ACTION_TEMPLATE_ONLY' });
    expect(capabilityBlockMessage(blocker, result.nodes[0])).toBe('Borrow · This action is available for workflow authoring only.');
  });
  it('explains the financial blocker when an isolated authoring template is unselected', () => {
    const read = { ...swap, nodeId: 'read-1', actionType: 'mock-read', chainId: 'mock:local',
      adapterConstraints: { adapters: [], protocols: [] }, requiredAuthorizationClass: 'NONE' } as typeof swap;
    const result = resolveWorkflowCapability({ nodes: [read, swap] }, { environment: 'MOCK' });
    expect(primaryExecutionBlocker(result)?.nodeId).toBe('swap-1');
    expect(primaryExecutionBlocker(result, 'read-1')?.code).toBe('ACTION_TEMPLATE_ONLY');
  });
  it('shows synthetic local-fork support without claiming fork evidence', () => {
    const result = resolveNodeCapability(swap, { environment: 'LOCAL_FORK', runtime: {
      forkAvailable: true, forkEvidence: 'MOCKED',
    } });
    expect(result.evidenceCeiling).toBe('MOCKED');
    expect(nodeCapabilityLabel(result)).toBe('Local fork demo');
  });
  it('distinguishes wallet, network and missing runtime from adapter support', () => {
    const fork = resolveWorkflowCapability({ nodes: [swap] }, { environment: 'LOCAL_FORK',
      runtime: { forkAvailable: true, walletConnected: false } });
    expect(nodeCapabilityLabel(fork.nodes[0]!)).toBe('Fork verified');
    expect(fork.blockers.map(blocker => blocker.code)).toContain('WALLET_NOT_CONNECTED');
    const wrongChain = resolveWorkflowCapability({ nodes: [swap] }, { environment: 'LOCAL_FORK',
      runtime: { forkAvailable: true, walletConnected: true, walletChainId: 'eip155:8453' } });
    expect(wrongChain.blockers.map(blocker => blocker.code)).toContain('WRONG_WALLET_CHAIN');
    const noFork = resolveNodeCapability(swap, { environment: 'LOCAL_FORK' });
    expect(nodeCapabilityLabel(noFork)).toBe('Local fork unavailable');
  });
});

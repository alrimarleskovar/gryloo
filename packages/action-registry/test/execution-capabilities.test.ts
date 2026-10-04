// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { executionCapabilityRegistry, resolveNodeCapability, resolveWorkflowCapability } from '../src/execution-capabilities.js';

type Node = SemanticWorkflow['nodes'][number];
function node(actionType: string, chainId = 'eip155:8453', adapter: string | null = null, protocols: string[] = ['uniswap']): Node {
  return {
    nodeId: actionType, actionType, actionSchemaVersion: '1.0.0', chainId,
    adapterConstraints: { adapters: adapter ? [{ id: adapter, version: '1.0.0' }] : [], protocols },
    requiredAuthorizationClass: actionType.startsWith('mock-') ? 'NONE' : 'MODE_A',
  } as Node;
}
const swap = () => node('asset.swap.exact-input');
const bridge = (adapter = 'lifi.rest') => node('asset.bridge', 'eip155:8453', adapter, [adapter]);
const pool = (chain = 'eip155:8453') => node('asset.liquidity.uniswap-v3', chain, null, ['uniswap-v3']);
const workflow = (...nodes: Node[]) => ({ nodes });

describe('execution capability registry', () => {
  it('keeps semantic actions and exact adapter/chain/environment rows distinct', () => {
    expect(executionCapabilityRegistry.filter(row => row.actionType === 'asset.swap.exact-input').map(row => row.adapterId))
      .toContain('cow.protocol');
    expect(resolveNodeCapability(swap(), { environment: 'LOCAL_FORK', runtime: { forkAvailable: true } }).profile?.evidenceMaturity)
      .toBe('FORK_REPRODUCED');
    expect(resolveNodeCapability(node('asset.swap.exact-input', 'eip155:8453', null, ['uniswap', 'cow-protocol']),
      { environment: 'MOCK' }).profile?.executionKind).toBe('SIGNED_INTENT');
    expect(resolveNodeCapability(node('asset.swap.exact-input', 'eip155:8453', null, ['uniswap', 'cow-protocol']),
      { environment: 'LOCAL_FORK' }).blockers[0]?.code).toBe('ENVIRONMENT_NOT_SUPPORTED');
    expect(resolveNodeCapability(bridge(), { environment: 'MOCK' }).profile?.adapterId).toBe('lifi.rest');
    expect(resolveNodeCapability(bridge('across.direct'), { environment: 'MOCK' }).profile?.adapterId).toBe('across.direct');
  });
  it('fails closed for unknown action, adapter, version, chain and environment', () => {
    expect(resolveNodeCapability(node('asset.fictional'), { environment: 'MOCK' }).blockers[0]?.code).toBe('UNKNOWN_ACTION');
    expect(resolveNodeCapability(bridge('fictional'), { environment: 'MOCK' }).blockers[0]?.code).toBe('ADAPTER_NOT_AVAILABLE');
    const changed = { ...bridge(), adapterConstraints: { adapters: [{ id: 'lifi.rest', version: '2.0.0' }], protocols: ['lifi'] } } as Node;
    expect(resolveNodeCapability(changed, { environment: 'MOCK' }).blockers[0]?.code).toBe('ADAPTER_VERSION_UNSUPPORTED');
    expect(resolveNodeCapability(pool('eip155:10'), { environment: 'MOCK' }).blockers[0]?.code).toBe('CHAIN_NOT_SUPPORTED');
    expect(resolveNodeCapability(swap(), { environment: 'LOCAL_FORK' }).blockers[0]?.code).toBe('RUNTIME_UNAVAILABLE');
    expect(resolveNodeCapability(swap(), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PUBLIC_EXECUTION_NOT_ENABLED');
    expect(resolveNodeCapability(swap(), { environment: 'MAINNET' }).blockers[0]?.code).toBe('MAINNET_EXECUTION_NOT_ENABLED');
    expect(resolveNodeCapability(swap(), { environment: 'INVALID' }).blockers[0]?.code).toBe('ENVIRONMENT_NOT_SUPPORTED');
  });
  it('keeps authoring, simulation, execution, reconciliation and recovery independent', () => {
    const readOnly = resolveNodeCapability(swap(), { environment: 'MOCK' }).capabilities;
    expect([readOnly.AUTHOR, readOnly.QUOTE_OR_READ, readOnly.SIMULATE, readOnly.EXECUTE, readOnly.RECONCILE, readOnly.RECOVER])
      .toEqual([true, true, true, false, false, false]);
    for (const kind of ['supply', 'lending', 'borrow']) {
      const result = resolveNodeCapability(node('mock-' + kind, 'mock:local', null, []), { environment: 'MOCK' });
      expect(result.capabilities.AUTHOR).toBe(true);
      expect(result.capabilities.EXECUTE).toBe(false);
      expect(result.blockers[0]?.code).toBe('ACTION_TEMPLATE_ONLY');
      for (const environment of ['LOCAL_FORK', 'PUBLIC_TESTNET', 'MAINNET'] as const) {
        const unavailable = resolveNodeCapability(node('mock-' + kind, 'mock:local', null, []), { environment });
        expect(unavailable.capabilities.AUTHOR).toBe(true);
        expect(unavailable.capabilities.EXECUTE).toBe(false);
        expect(unavailable.blockers[0]?.code).toBe('ACTION_TEMPLATE_ONLY');
      }
    }
    expect(resolveNodeCapability(pool('eip155:42161'), { environment: 'MOCK' }).evidenceCeiling).toBe('MOCKED');
    expect(resolveNodeCapability(pool(), { environment: 'LOCAL_FORK', runtime: { forkAvailable: true } }).evidenceCeiling)
      .toBe('FORK_REPRODUCED');
  });
  it('blocks the whole workflow at its weakest node and caps composed evidence', () => {
    const result = resolveWorkflowCapability(workflow(swap(), bridge(), pool()), {
      environment: 'LOCAL_FORK', runtime: { forkAvailable: true },
    });
    expect(result.executionSupported).toBe(false);
    const invalidSplit = resolveWorkflowCapability(workflow(bridge(), node('asset.liquidity.prepare', 'eip155:10', null, ['uniswap-v3'])), { environment: 'MOCK' });
    expect(invalidSplit.executionSupported).toBe(false);
    expect(invalidSplit.blockers.map(b => b.code)).toContain('CHAIN_NOT_SUPPORTED');
    expect(result.blockers).toContainEqual({ nodeId: 'asset.bridge', dimension: 'EXECUTE', code: 'ENVIRONMENT_NOT_SUPPORTED' });
    const mockResult = resolveWorkflowCapability(workflow(bridge(), node('asset.swap.exact-input', 'eip155:42161', 'lifi.rest'),
      pool('eip155:42161')), { environment: 'MOCK' });
    expect(mockResult.executionSupported).toBe(true);
    expect(mockResult.evidenceCeiling).toBe('MOCKED');
    expect(resolveNodeCapability(swap(), { environment: 'LOCAL_FORK', runtime: { forkAvailable: true } }).evidenceCeiling)
      .toBe('FORK_REPRODUCED');
  });
  it('records public evidence only for the reconciled Base Sepolia Uniswap swap and the RH-DEMO-001 Robinhood self-transfer', () => {
    const testnetSwap = node('asset.swap.exact-input', 'eip155:84532');
    const profile = resolveNodeCapability(testnetSwap, { environment: 'PUBLIC_TESTNET' });
    expect(profile.profile).toMatchObject({ adapterId: 'uniswap.v3', chainId: 'eip155:84532',
      environment: 'PUBLIC_TESTNET', executionKind: 'DIRECT_TRANSACTION', evidenceMaturity: 'TESTNET_EXECUTED' });
    expect(profile.evidenceCeiling).toBe('TESTNET_EXECUTED');
    expect(profile.capabilities.EXECUTE).toBe(true);
    expect(resolveWorkflowCapability(workflow(testnetSwap), { environment: 'PUBLIC_TESTNET' }).executionReady).toBe(false);
    expect(resolveWorkflowCapability(workflow(testnetSwap), { environment: 'PUBLIC_TESTNET', runtime: {
      quoteProviderAvailable: true, walletConnected: true, walletChainId: 'eip155:84532',
      artifacts: 'CURRENT', simulationReady: true, authorizationReady: true,
    } }).executionReady).toBe(true);
    expect(resolveNodeCapability(testnetSwap, { environment: 'MAINNET' }).capabilities.EXECUTE).toBe(false);
    expect(resolveNodeCapability(pool('eip155:84532'), { environment: 'PUBLIC_TESTNET' }).capabilities.EXECUTE).toBe(false);
    // RH-DEMO-001 added exactly one more demonstrated public path: the independently reconciled Robinhood Testnet self-transfer.
    const robinhoodTransfer = executionCapabilityRegistry.find(row => row.actionType === 'asset.transfer' && row.chainId === 'eip155:46630');
    expect(executionCapabilityRegistry.filter(row => row.environment === 'PUBLIC_TESTNET' && row.evidenceMaturity === 'TESTNET_EXECUTED'))
      .toEqual([profile.profile, robinhoodTransfer]);
    expect(resolveWorkflowCapability(workflow(testnetSwap, bridge()), { environment: 'PUBLIC_TESTNET' }).executionSupported).toBe(false);
  });
  it('keeps isolated authoring templates out of financial execution and evidence', () => {
    const read = node('mock-read', 'mock:local', null, []);
    const result = resolveWorkflowCapability(workflow(read, swap()), { environment: 'LOCAL_FORK', runtime: {
      forkAvailable: true, forkEvidence: 'MOCKED', walletConnected: true, walletChainId: 'eip155:31337',
      artifacts: 'CURRENT', simulationReady: true, authorizationReady: true,
    } });
    expect(result.nodes[0]?.capabilities.EXECUTE).toBe(false);
    expect(result.nodes[0]?.blockers[0]?.code).toBe('ACTION_TEMPLATE_ONLY');
    expect(result.executionSupported).toBe(true);
    expect(result.executionReady).toBe(true);
    expect(result.evidenceCeiling).toBe('MOCKED');
    expect(resolveWorkflowCapability(workflow(read), { environment: 'LOCAL_FORK' }).executionSupported).toBe(false);
  });
  it('separates runtime, wallet, artifact, simulation and authorization blockers', () => {
    const base = { environment: 'LOCAL_FORK', runtime: { forkAvailable: true, artifacts: 'MISSING' as const,
      simulationReady: false, authorizationReady: false } };
    const result = resolveWorkflowCapability(workflow(swap()), base);
    expect(result.executionSupported).toBe(true);
    expect(result.executionReady).toBe(false);
    expect(result.blockers.map(b => b.code)).toEqual(expect.arrayContaining([
      'WALLET_NOT_CONNECTED', 'ARTIFACTS_MISSING', 'SIMULATION_REQUIRED', 'AUTHORIZATION_REQUIRED',
    ]));
    expect(resolveWorkflowCapability(workflow(swap()), { environment: 'LOCAL_FORK', runtime: {
      ...base.runtime, walletConnected: true, walletChainId: 'eip155:8453',
    } }).blockers.map(b => b.code)).toContain('WRONG_WALLET_CHAIN');
    expect(resolveWorkflowCapability(workflow(swap()), { environment: 'LOCAL_FORK', runtime: {
      forkAvailable: true, walletConnected: true, walletChainId: 'eip155:31337', artifacts: 'STALE',
      simulationReady: true, authorizationReady: true,
    } }).blockers.map(b => b.code)).toContain('ARTIFACTS_STALE');
    expect(resolveWorkflowCapability(workflow(swap()), { environment: 'LOCAL_FORK', runtime: {
      forkAvailable: true, forkEvidence: 'MOCKED', walletConnected: true, walletChainId: 'eip155:31337',
      artifacts: 'CURRENT', simulationReady: true, authorizationReady: true,
    } })).toMatchObject({ executionReady: true, evidenceCeiling: 'MOCKED' });
  });
  it('routes the canonical concentrated-liquidity action on Base Sepolia to the public Uniswap v3 runtime without changing fork evidence', () => {
    const concentrated = (chain: string, protocols: string[]) => node('asset.liquidity.concentrated', chain, null, protocols);
    const publicLp = resolveNodeCapability(concentrated('eip155:84532', ['uniswap-v3']), { environment: 'PUBLIC_TESTNET' });
    expect(publicLp.profile).toMatchObject({ adapterId: 'uniswap.v3', chainId: 'eip155:84532', environment: 'PUBLIC_TESTNET',
      authorizationModes: ['A'], executionKind: 'DIRECT_TRANSACTION' });
    // No public evidence is claimed before the owner's wallet-signed acceptance.
    expect(publicLp.evidenceCeiling).toBeNull();
    expect(publicLp.capabilities.EXECUTE).toBe(true);
    // The historical BUILD-006 fork row is unchanged.
    expect(resolveNodeCapability(pool(), { environment: 'LOCAL_FORK', runtime: { forkAvailable: true } }).profile?.evidenceMaturity).toBe('FORK_REPRODUCED');
    // Wrong network, environment, protocol mix or Mode B fails closed.
    expect(resolveNodeCapability(concentrated('eip155:8453', ['uniswap-v3']), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('CHAIN_NOT_SUPPORTED');
    expect(resolveNodeCapability(concentrated('eip155:84532', ['uniswap-v3']), { environment: 'MAINNET' }).blockers[0]?.code).toBe('MAINNET_EXECUTION_NOT_ENABLED');
    expect(resolveNodeCapability(concentrated('eip155:84532', ['uniswap-v3', 'orca-whirlpools']), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('ADAPTER_NOT_AVAILABLE');
    expect(resolveNodeCapability(concentrated('eip155:84532', ['sushiswap']), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('ADAPTER_NOT_AVAILABLE');
    const modeB = { ...concentrated('eip155:84532', ['uniswap-v3']), requiredAuthorizationClass: 'MODE_B' } as Node;
    expect(resolveNodeCapability(modeB, { environment: 'PUBLIC_TESTNET' }).blockers.map(b => b.code)).toContain('AUTHORIZATION_MODE_UNSUPPORTED');
    const ready = resolveWorkflowCapability(workflow(concentrated('eip155:84532', ['uniswap-v3'])), { environment: 'PUBLIC_TESTNET', runtime: {
      quoteProviderAvailable: true, walletConnected: true, walletChainId: 'eip155:84532', artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
    expect(ready.executionReady).toBe(true);
    expect(resolveWorkflowCapability(workflow(concentrated('eip155:84532', ['uniswap-v3'])), { environment: 'PUBLIC_TESTNET', runtime: {
      quoteProviderAvailable: true, walletConnected: true, walletChainId: 'eip155:8453', artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } })
      .blockers.map(b => b.code)).toContain('WRONG_WALLET_CHAIN');
  });
});

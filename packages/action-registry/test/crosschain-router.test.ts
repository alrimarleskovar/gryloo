// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createRouterBridgeNode, ROUTER_PAIRS } from '@defi-workflow-engine/workflow-contracts';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as testnet, CROSSCHAIN_ROUTER_PROFILES,
  routerProfileFor } from '../src/crosschain-router.js';
import { executionCapabilityRegistry, resolveNodeCapability, resolveWorkflowCapability } from '../src/execution-capabilities.js';

const node = createRouterBridgeNode('node-002', { sourceChain: 'eip155:8453', destinationChain: 'eip155:42161', inputToken: profile.source.usdc,
  outputToken: profile.destination.usdc, amount: '1000000', recipient: 'CONNECTED_OWNER', slippageBps: 50, providers: ['lifi', 'across'] });

describe('BUILD-ROUTER-001 router capability', () => {
  it('declares one owner-wallet MAINNET row with no evidence ceiling until an owner run reconciles', () => {
    const rows = executionCapabilityRegistry.filter(row => row.adapterId === 'flofi.router' && row.chainId === 'eip155:8453');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: 'asset.bridge', chainId: 'eip155:8453', environment: 'MAINNET', evidenceMaturity: null,
      authorizationModes: ['A'], executionKind: 'DIRECT_TRANSACTION' });
    expect(rows[0]!.requirements).toEqual(['INJECTED_WALLET', 'QUOTE_PROVIDER', 'REVIEWED_ARTIFACTS']);
    const result = resolveWorkflowCapability({ nodes: [node] }, { environment: 'MAINNET' });
    expect(result.executionSupported).toBe(true);
    expect(result.evidenceCeiling).toBeNull();
    expect(result.blockers.map(b => b.code)).toContain('WALLET_NOT_CONNECTED');
    expect(resolveWorkflowCapability({ nodes: [node] }, { environment: 'MAINNET', runtime: { walletConnected: true, walletChainId: 'eip155:42161' } })
      .blockers.map(b => b.code)).toContain('WRONG_WALLET_CHAIN');
  });
  it('is not executable on other environments and leaves the BUILD-008/010 rows unchanged', () => {
    expect(resolveNodeCapability(node, { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PUBLIC_EXECUTION_NOT_ENABLED');
    expect(resolveNodeCapability(node, { environment: 'MOCK' }).capabilities.EXECUTE).toBe(false);
    expect(executionCapabilityRegistry.filter(row => row.actionType === 'asset.bridge' && row.adapterId !== 'flofi.router')
      .map(row => [row.adapterId, row.environment, row.evidenceMaturity])).toEqual([['lifi.rest', 'MOCK', 'MOCKED'], ['across.direct', 'MOCK', 'MOCKED']]);
  });
  it('profile matches the canonical pair and pins every contract it touches', () => {
    expect(ROUTER_PAIRS[0]!.source.address).toBe(profile.source.usdc);
    expect(ROUTER_PAIRS[0]!.destination.address).toBe(profile.destination.usdc);
    expect(Object.values(profile.codeSha256).every(v => /^[0-9a-f]{64}$/.test(v))).toBe(true);
    for (const value of [profile.source.spokePool, profile.source.lifiDiamond, profile.source.lifiFeeForwarder, profile.destination.spokePool])
      expect(value).toMatch(/^0x[0-9a-f]{40}$/);
  });
  it('BUILD-JOURNEY-001: one PUBLIC_TESTNET row for Base Sepolia → Arbitrum Sepolia, no evidence ceiling, never on mainnet', () => {
    const testnetNode = createRouterBridgeNode('node-002', { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614', inputToken: testnet.source.usdc,
      outputToken: testnet.destination.usdc, amount: '1000000', recipient: 'CONNECTED_OWNER', slippageBps: 50, providers: ['lifi', 'across'] });
    const rows = executionCapabilityRegistry.filter(row => row.adapterId === 'flofi.router' && row.chainId === 'eip155:84532');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionType: 'asset.bridge', environment: 'PUBLIC_TESTNET', evidenceMaturity: null, authorizationModes: ['A'] });
    expect(resolveWorkflowCapability({ nodes: [testnetNode] }, { environment: 'PUBLIC_TESTNET' }).executionSupported).toBe(true);
    expect(resolveNodeCapability(testnetNode, { environment: 'MAINNET' }).blockers[0]?.code).toBe('MAINNET_EXECUTION_NOT_ENABLED');
    expect(resolveNodeCapability(node, { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PUBLIC_EXECUTION_NOT_ENABLED');
  });
  it('BUILD-JOURNEY-001: each pair has exactly one profile whose chains, tokens and pins are distinct and well formed', () => {
    expect(ROUTER_PAIRS.map(p => p.id)).toEqual(CROSSCHAIN_ROUTER_PROFILES.map(p => p.id));
    for (const pair of ROUTER_PAIRS) {
      const p = routerProfileFor(pair.source.chainId, pair.destination.chainId)!;
      expect(p.id).toBe(pair.id);
      expect([p.source.usdc, p.destination.usdc]).toEqual([pair.source.address, pair.destination.address]);
      expect(p.source.chainHex).toBe('0x' + p.source.chainId.toString(16));
      expect(p.destination.chainHex).toBe('0x' + p.destination.chainId.toString(16));
      expect(Object.values(p.codeSha256).every(v => /^[0-9a-f]{64}$/.test(v))).toBe(true);
      for (const value of [p.source.usdc, p.source.spokePool, p.source.lifiDiamond, p.source.lifiFeeForwarder, p.destination.usdc, p.destination.spokePool])
        expect(value).toMatch(/^0x[0-9a-f]{40}$/);
    }
    expect(testnet).toMatchObject({ network: 'TESTNET', environment: 'PUBLIC_TESTNET', source: { chainId: 84532 }, destination: { chainId: 421614 } });
    expect(testnet.providers.across.api).toBe('https://testnet.across.to/api');
    expect(routerProfileFor('eip155:8453', 'eip155:421614')).toBeNull();
    expect(Object.isFrozen(testnet) && Object.isFrozen(testnet.source) && Object.isFrozen(testnet.codeSha256)).toBe(true);
  });
});

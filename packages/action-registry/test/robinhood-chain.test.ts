// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { executionCapabilityRegistry, resolveNodeCapability, resolveWorkflowCapability } from '../src/execution-capabilities.js';
import { ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET, ROBINHOOD_NETWORKS, ROBINHOOD_PROTOCOL_AVAILABILITY,
  robinhoodAddChainParameters, robinhoodDeploymentStatus, robinhoodNetwork } from '../src/robinhood-chain.js';

type Node = SemanticWorkflow['nodes'][number];
function node(actionType: string, chainId: string, adapter: string | null, protocols: string[]): Node {
  return { nodeId: actionType, actionType, actionSchemaVersion: '1.0.0', chainId,
    adapterConstraints: { adapters: adapter ? [{ id: adapter, version: '1.0.0' }] : [], protocols },
    requiredAuthorizationClass: 'MODE_A' } as Node;
}
const swap = (chain: string) => node('asset.swap.exact-input', chain, null, ['uniswap']);

describe('Robinhood Chain network identity', () => {
  it('pins the official chain IDs, CAIP-2 references, RPCs and explorers', () => {
    expect(ROBINHOOD_CHAIN_MAINNET).toMatchObject({ chain: 'eip155:4663', chainId: 4663, chainHex: '0x1237', environment: 'MAINNET',
      rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com' });
    expect(ROBINHOOD_CHAIN_TESTNET).toMatchObject({ chain: 'eip155:46630', chainId: 46630, chainHex: '0xb626', environment: 'PUBLIC_TESTNET',
      rpc: 'https://rpc.testnet.chain.robinhood.com', explorer: 'https://explorer.testnet.chain.robinhood.com' });
    for (const network of ROBINHOOD_NETWORKS) {
      expect(Number.parseInt(network.chainHex, 16)).toBe(network.chainId);
      expect(network.chain).toBe(`eip155:${network.chainId}`);
      expect(network.nativeCurrency).toEqual({ name: 'Ether', symbol: 'ETH', decimals: 18 });
      expect(Object.isFrozen(network) && Object.isFrozen(network.contracts)).toBe(true);
      for (const item of network.contracts) expect(item.address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });
  it('keeps mainnet and testnet contracts distinct; no mainnet token address is reused on testnet', () => {
    const weth = (network: typeof ROBINHOOD_CHAIN_MAINNET) => network.contracts.find(item => item.name === 'WETH')!.address;
    expect(weth(ROBINHOOD_CHAIN_MAINNET)).toBe('0x0bd7d308f8e1639fab988df18a8011f41eacad73');
    expect(weth(ROBINHOOD_CHAIN_TESTNET)).toBe('0x7943e237c7f95da44e0301572d358911207852fa');
    expect(ROBINHOOD_CHAIN_TESTNET.contracts.map(item => item.name)).not.toContain('USDG');
  });
  it('resolves CAIP-2 and hex identifiers only for Robinhood chains', () => {
    expect(robinhoodNetwork('eip155:46630')).toBe(ROBINHOOD_CHAIN_TESTNET);
    expect(robinhoodNetwork('0xB626')).toBe(ROBINHOOD_CHAIN_TESTNET);
    expect(robinhoodNetwork('0x1237')).toBe(ROBINHOOD_CHAIN_MAINNET);
    for (const other of ['eip155:8453', 'eip155:84532', '0x2105', 'eip155:466300', '46630', '', null, undefined])
      expect(robinhoodNetwork(other)).toBeNull();
  });
  it('builds EIP-3085 parameters from the official table', () => {
    expect(robinhoodAddChainParameters(ROBINHOOD_CHAIN_TESTNET)).toEqual({ chainId: '0xb626', chainName: 'Robinhood Chain Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
      blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'] });
  });
});

describe('Robinhood decision gate in the capability registry', () => {
  it('records no canonical testnet deployment for any protocol', () => {
    expect(ROBINHOOD_PROTOCOL_AVAILABILITY.every(row => row.testnet === 'NO_CANONICAL_DEPLOYMENT')).toBe(true);
    expect(robinhoodDeploymentStatus('eip155:4663', 'uniswap.v3')).toBe('CANONICAL_DEPLOYMENT');
    expect(robinhoodDeploymentStatus('eip155:46630', 'uniswap.v3')).toBe('NO_CANONICAL_DEPLOYMENT');
    expect(robinhoodDeploymentStatus('eip155:8453', 'uniswap.v3')).toBeNull();
    expect(robinhoodDeploymentStatus('eip155:46630', 'unknown.adapter')).toBeNull();
  });
  it('adds no execution profile for either Robinhood chain', () => {
    expect(executionCapabilityRegistry.filter(row => robinhoodNetwork(row.chainId))).toEqual([]);
  });
  it('reports a missing testnet deployment precisely, in every environment', () => {
    for (const environment of ['MOCK', 'LOCAL_FORK', 'PUBLIC_TESTNET', 'MAINNET']) {
      const result = resolveNodeCapability(swap('eip155:46630'), { environment });
      expect(result.blockers.map(blocker => blocker.code)).toEqual(['PROTOCOL_NOT_DEPLOYED']);
      expect(result.profile).toBeNull();
      expect(result.evidenceCeiling).toBeNull();
      expect(result.capabilities.EXECUTE || result.capabilities.SIMULATE || result.capabilities.AUTHORIZE).toBe(false);
    }
    const bridge = node('asset.bridge', 'eip155:46630', 'across.direct', ['across']);
    expect(resolveNodeCapability(bridge, { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PROTOCOL_NOT_DEPLOYED');
  });
  it('keeps a canonically deployed mainnet protocol unsupported rather than implying a deployment gap', () => {
    const result = resolveNodeCapability(swap('eip155:4663'), { environment: 'MAINNET' });
    expect(result.blockers[0]?.code).toBe('CHAIN_NOT_SUPPORTED');
    expect(result.capabilities.EXECUTE).toBe(false);
  });
  it('never makes a Robinhood workflow executable or ready, even with a matching wallet and current artifacts', () => {
    for (const [chain, environment] of [['eip155:46630', 'PUBLIC_TESTNET'], ['eip155:4663', 'MAINNET']] as const) {
      const result = resolveWorkflowCapability({ nodes: [swap(chain)] }, { environment, runtime: {
        walletConnected: true, walletChainId: chain, artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
      expect(result.executionSupported).toBe(false);
      expect(result.executionReady).toBe(false);
      expect(result.evidenceCeiling).toBeNull();
    }
  });
  it('leaves existing chains unchanged', () => {
    expect(resolveNodeCapability(node('asset.liquidity.uniswap-v3', 'eip155:10', null, ['uniswap-v3']), { environment: 'MOCK' })
      .blockers[0]?.code).toBe('CHAIN_NOT_SUPPORTED');
    expect(resolveNodeCapability(swap('eip155:84532'), { environment: 'PUBLIC_TESTNET' }).profile?.evidenceMaturity).toBe('TESTNET_EXECUTED');
  });
  it('rejects a Base Sepolia execution while the wallet is on a Robinhood chain', () => {
    for (const walletChainId of ['eip155:46630', 'eip155:4663']) {
      const result = resolveWorkflowCapability({ nodes: [swap('eip155:84532')] }, { environment: 'PUBLIC_TESTNET', runtime: {
        walletConnected: true, walletChainId, artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
      expect(result.executionSupported).toBe(true);
      expect(result.blockers.map(blocker => blocker.code)).toContain('WRONG_WALLET_CHAIN');
      expect(result.executionReady).toBe(false);
    }
  });
});

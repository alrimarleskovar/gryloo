// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow, validateAuthoringWorkflow } from '../src/index.js';

const chain = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const node = (patch: Partial<Parameters<typeof createExactInputSwapNode>[1]> = {}) => createExactInputSwapNode('node-002', { chain,
  input: { chainId: chain, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  output: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, amount: '10000000', slippageBps: 50,
  protocols: ['jupiter'], maximumAmount: '1000000000000', ...patch });
const devnetChain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const devnetNode = (patch: Partial<Parameters<typeof createExactInputSwapNode>[1]> = {}) => createExactInputSwapNode('node-002', { chain: devnetChain,
  input: { chainId: devnetChain, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 },
  output: { chainId: devnetChain, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, amount: '10000000', slippageBps: 50,
  protocols: ['orca-whirlpools'], maximumAmount: '1000000000', ...patch });
const workflow = (nodes: ReturnType<typeof node>[]) => ({ schemaVersion: '1.0.0' as const, workflowId: 'w', revision: 1, nodes, resourceEdges: [] });
describe('Solana canonical swap validation', () => {
  it('accepts the canonical swap on the Jupiter mainnet-beta profile and requires a fresh quote', () => {
    expect(validateAuthoringWorkflow(workflow([node()]), context).nodes[0]!.chainId).toBe(chain);
    expect(lintWorkflow(workflow([node()]), context).findings.map(f => f.code)).toEqual(['SOLANA_SWAP_QUOTE_REQUIRED']);
  });
  it.each([
    ['unsupported mint', { input: { chainId: chain, address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 } }, 'SOLANA_MINT_UNSUPPORTED'],
    ['wrong decimals', { output: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 6 } }, 'SOLANA_MINT_UNSUPPORTED'],
    ['unsupported provider', { protocols: ['uniswap'] }, 'SOLANA_SWAP_PROVIDER_UNSUPPORTED'],
    ['excessive slippage', { slippageBps: 301 }, 'SOLANA_SLIPPAGE_OUT_OF_RANGE'],
  ])('rejects %s', (_n, patch, code) => expect(() => validateAuthoringWorkflow(workflow([node(patch)]), context)).toThrow(code));
  it('rejects wrong-cluster assets, a wrong provider, unknown clusters and composition', () => {
    const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', testnet = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z';
    // Mainnet USDC on Devnet is not the Devnet test asset: identity is cluster + mint + decimals.
    expect(() => validateAuthoringWorkflow(workflow([node({ chain: devnet, input: { chainId: devnet, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      output: { chainId: devnet, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, protocols: ['orca-whirlpools'], maximumAmount: '1000000000' })]), context)).toThrow('SOLANA_MINT_UNSUPPORTED');
    // Jupiter does not route Devnet.
    expect(() => validateAuthoringWorkflow(workflow([devnetNode({ protocols: ['jupiter'] })]), context)).toThrow('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
    // Orca Devnet is not a mainnet provider.
    expect(() => validateAuthoringWorkflow(workflow([node({ protocols: ['orca-whirlpools'] })]), context)).toThrow('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(workflow([node({ chain: testnet, input: { chainId: testnet, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      output: { chainId: testnet, address: 'So11111111111111111111111111111111111111112', decimals: 9 } })]), context)).toThrow('SOLANA_CLUSTER_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(workflow([node(), { ...node(), nodeId: 'node-003' }]), context)).toThrow('SOLANA_SWAP_ISOLATED_ONLY');
  });
  it('accepts the canonical swap on Solana Devnet through Orca Whirlpools with test tokens only', () => {
    expect(validateAuthoringWorkflow(workflow([devnetNode()]), context).nodes[0]!.chainId).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(lintWorkflow(workflow([devnetNode()]), context).findings.map(f => f.code)).toEqual(['SOLANA_SWAP_QUOTE_REQUIRED']);
    expect(() => validateAuthoringWorkflow(workflow([devnetNode({ amount: '1000000001', maximumAmount: '1000000001' })]), context)).toThrow('AMOUNT_OUT_OF_RANGE');
    const capability = resolveWorkflowCapability(workflow([devnetNode()]), { environment: 'PUBLIC_TESTNET', runtime: { walletConnected: true,
      walletChainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
    expect(capability.nodes[0]).toMatchObject({ adapterId: 'orca.whirlpools-devnet', evidenceCeiling: null });
    expect(resolveWorkflowCapability(workflow([devnetNode()]), { environment: 'MAINNET' }).blockers[0]?.code).toBe('MAINNET_EXECUTION_NOT_ENABLED');
  });
  it('resolves Jupiter as a mainnet execution capability with no demonstrated evidence', () => {
    const capability = resolveWorkflowCapability(workflow([node()]), { environment: 'MAINNET', runtime: { walletConnected: true, walletChainId: chain, artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
    expect(capability.nodes[0]).toMatchObject({ adapterId: 'jupiter.swap-v2', evidenceCeiling: null });
    expect(capability.executionReady).toBe(true);
    expect(resolveWorkflowCapability(workflow([node()]), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PUBLIC_EXECUTION_NOT_ENABLED');
  });
});

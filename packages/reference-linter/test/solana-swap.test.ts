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
  it('rejects devnet and composition', () => {
    const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
    expect(() => validateAuthoringWorkflow(workflow([node({ chain: devnet, input: { chainId: devnet, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      output: { chainId: devnet, address: 'So11111111111111111111111111111111111111112', decimals: 9 } })]), context)).toThrow('SOLANA_CLUSTER_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(workflow([node(), { ...node(), nodeId: 'node-003' }]), context)).toThrow('SOLANA_SWAP_ISOLATED_ONLY');
  });
  it('resolves Jupiter as a mainnet execution capability with no demonstrated evidence', () => {
    const capability = resolveWorkflowCapability(workflow([node()]), { environment: 'MAINNET', runtime: { walletConnected: true, walletChainId: chain, artifacts: 'CURRENT', simulationReady: true, authorizationReady: true } });
    expect(capability.nodes[0]).toMatchObject({ adapterId: 'jupiter.swap-v2', evidenceCeiling: null });
    expect(capability.executionReady).toBe(true);
    expect(resolveWorkflowCapability(workflow([node()]), { environment: 'PUBLIC_TESTNET' }).blockers[0]?.code).toBe('PUBLIC_EXECUTION_NOT_ENABLED');
  });
});

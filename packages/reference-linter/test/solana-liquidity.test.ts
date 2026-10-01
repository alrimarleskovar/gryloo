// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createConcentratedLiquidityNode, createExactInputSwapNode, type ConcentratedLiquidityFields } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow, validateAuthoringWorkflow } from '../src/index.js';

const chain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const fields: ConcentratedLiquidityFields = { chain, token0: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  token1: { chainId: chain, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 }, amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0',
  tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100, protocols: ['orca-whirlpools'], recipient: null,
  positionAsset: { chainId: chain, address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', decimals: 0 } };
const node = (patch: Partial<ConcentratedLiquidityFields> = {}) => createConcentratedLiquidityNode('node-002', { ...fields, ...patch });
const workflow = (nodes: ReturnType<typeof node>[]) => ({ schemaVersion: '1.0.0' as const, workflowId: 'w', revision: 1, nodes, resourceEdges: [] });
describe('canonical concentrated liquidity on Solana Devnet (Orca Whirlpools)', () => {
  it('accepts the verified profile, requires simulation, and resolves the Orca liquidity capability', () => {
    expect(validateAuthoringWorkflow(workflow([node()]), context).nodes[0]!.actionType).toBe('asset.liquidity.concentrated');
    expect(lintWorkflow(workflow([node()]), context).findings.map(f => f.code)).toEqual(['SOLANA_LIQUIDITY_SIMULATION_REQUIRED']);
    const capability = resolveWorkflowCapability(workflow([node()]), { environment: 'PUBLIC_TESTNET', runtime: { walletConnected: true, walletChainId: chain } });
    expect(capability.nodes[0]).toMatchObject({ adapterId: 'orca.whirlpools-devnet-liquidity', evidenceCeiling: null });
    expect(capability.executionSupported).toBe(true);
    expect(resolveWorkflowCapability(workflow([node()]), { environment: 'MAINNET' }).nodes[0]!.blockers[0]!.code).toBe('MAINNET_EXECUTION_NOT_ENABLED');
  });
  it.each([
    ['an unknown Solana cluster', { chain: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z', token0: { ...fields.token0, chainId: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' },
      token1: { ...fields.token1, chainId: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' }, positionAsset: { ...fields.positionAsset, chainId: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' } }, 'SOLANA_CLUSTER_UNSUPPORTED'],
    ['an EVM chain on the neutral action', { chain: 'eip155:8453', token0: { ...fields.token0, chainId: 'eip155:8453' }, token1: { ...fields.token1, chainId: 'eip155:8453' },
      positionAsset: { ...fields.positionAsset, chainId: 'eip155:8453' } }, 'LIQUIDITY_RUNTIME_UNSUPPORTED'],
    ['mainnet USDC on Devnet', { token1: { chainId: chain, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 } }, 'SOLANA_MINT_UNSUPPORTED'],
    ['reversed token order', { token0: fields.token1, token1: fields.token0 }, 'SOLANA_MINT_UNSUPPORTED'],
    ['wrong decimals', { token0: { ...fields.token0, decimals: 6 } }, 'SOLANA_MINT_UNSUPPORTED'],
    ['the Uniswap provider', { protocols: ['uniswap-v3'] }, 'SOLANA_LIQUIDITY_PROVIDER_UNSUPPORTED'],
    ['Raydium (out of scope)', { protocols: ['raydium'] }, 'SOLANA_LIQUIDITY_PROVIDER_UNSUPPORTED'],
    ['another fee tier (no verified pool)', { feeTier: 500 }, 'SOLANA_LIQUIDITY_POOL_UNSUPPORTED'],
    ['an unaligned lower tick', { tickLower: -39100 }, 'SOLANA_LIQUIDITY_RANGE_INVALID'],
    ['a tick beyond the Whirlpool bound', { tickLower: -443648 }, 'SOLANA_LIQUIDITY_RANGE_INVALID'],
    ['excessive SOL', { amount0Max: '10000000001' }, 'AMOUNT_OUT_OF_RANGE'],
    ['excessive devUSDC', { amount1Max: '1000000001' }, 'AMOUNT_OUT_OF_RANGE'],
    ['excessive slippage', { slippageBps: 301 }, 'SOLANA_SLIPPAGE_OUT_OF_RANGE'],
    ['zero slippage', { slippageBps: 0 }, 'SOLANA_SLIPPAGE_OUT_OF_RANGE'],
    ['a foreign position asset', { positionAsset: { chainId: chain, address: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', decimals: 0 } }, 'SOLANA_LIQUIDITY_DECLARATION_INVALID'],
  ])('rejects %s', (_name, patch, code) => expect(() => validateAuthoringWorkflow(workflow([node(patch as Partial<ConcentratedLiquidityFields>)]), context)).toThrow(code));
  it('rejects tampered declarations and composition with other financial nodes', () => {
    const tampered = node(); tampered.adapterConstraints.adapters.push({ id: 'x', version: '1.0.0' });
    expect(() => validateAuthoringWorkflow(workflow([tampered]), context)).toThrow('SOLANA_LIQUIDITY_DECLARATION_INVALID');
    const locked = node(); locked.failurePolicy = 'RETRY';
    expect(() => validateAuthoringWorkflow(workflow([locked]), context)).toThrow('SOLANA_LIQUIDITY_DECLARATION_INVALID');
    const swap = createExactInputSwapNode('node-003', { chain, input: fields.token1, output: fields.token0, amount: '1000000', slippageBps: 50, protocols: ['orca-whirlpools'], maximumAmount: '1000000000' });
    expect(() => validateAuthoringWorkflow(workflow([node(), swap as ReturnType<typeof node>]), context)).toThrow(/ISOLATED_ONLY/);
    expect(() => validateAuthoringWorkflow(workflow([node(), { ...node(), nodeId: 'node-004' }]), context)).toThrow('SOLANA_LIQUIDITY_ISOLATED_ONLY');
  });
});

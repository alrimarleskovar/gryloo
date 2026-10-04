// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createConcentratedLiquidityNode, createExactInputSwapNode, type ConcentratedLiquidityFields } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry, resolveWorkflowCapability, UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow, validateAuthoringWorkflow, validateUniswapLiquidityNode } from '../src/index.js';

const chain = 'eip155:84532';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const usdc = { chainId: chain, address: profile.token0.address, decimals: 6 }, weth = { chainId: chain, address: profile.token1.address, decimals: 18 };
const fields: ConcentratedLiquidityFields = { chain, token0: usdc, token1: weth, amount0Max: '10000000', amount1Max: '5000000000000000', amount0Min: '0', amount1Min: '0',
  tickLower: 220_000, tickUpper: 230_000, feeTier: 500, slippageBps: 100, protocols: ['uniswap-v3'], recipient: null,
  positionAsset: { chainId: chain, address: profile.positionManager, decimals: 0 } };
const node = (patch: Partial<ConcentratedLiquidityFields> = {}) => createConcentratedLiquidityNode('node-002', { ...fields, ...patch });
const workflow = (nodes: ReturnType<typeof node>[]) => ({ schemaVersion: '1.0.0' as const, workflowId: 'w', revision: 1, nodes, resourceEdges: [] });

describe('canonical concentrated liquidity on Base Sepolia (Uniswap v3, owner wallet)', () => {
  it('accepts the verified profile, requires simulation and resolves the public Uniswap capability', () => {
    expect(validateAuthoringWorkflow(workflow([node()]), context).nodes[0]!.chainId).toBe(chain);
    expect(validateUniswapLiquidityNode(node({ tickLower: -887_270, tickUpper: 887_270 })).tickUpper).toBe(887_270);
    expect(lintWorkflow(workflow([node()]), context).findings.map(f => f.code)).toEqual(['UNISWAP_LIQUIDITY_SIMULATION_REQUIRED']);
    const capability = resolveWorkflowCapability(workflow([node()]), { environment: 'PUBLIC_TESTNET', runtime: { walletConnected: true, walletChainId: chain } });
    expect(capability.nodes[0]).toMatchObject({ adapterId: 'uniswap.v3', evidenceCeiling: null });
    expect(capability.executionSupported).toBe(true);
  });
  it.each([
    ['reversed token order (Base mainnet order)', { token0: weth, token1: usdc }, 'UNISWAP_TOKEN_ORDER_INVALID'],
    ['an unverified token', { token1: { chainId: chain, address: '0x1111111111111111111111111111111111111111', decimals: 18 } }, 'UNISWAP_TOKEN_UNSUPPORTED'],
    ['wrong decimals', { token0: { ...usdc, decimals: 18 } }, 'UNISWAP_TOKEN_UNSUPPORTED'],
    ['the 0.30% fee tier (no verified pool)', { feeTier: 3000 }, 'UNISWAP_FEE_TIER_UNSUPPORTED'],
    ['the Orca provider on Base Sepolia', { protocols: ['orca-whirlpools'] }, 'UNISWAP_LIQUIDITY_PROVIDER_UNSUPPORTED'],
    ['an unaligned tick', { tickLower: 220_005 }, 'UNISWAP_LIQUIDITY_RANGE_INVALID'],
    ['the unusable protocol extreme tick', { tickLower: -887_272 }, 'UNISWAP_LIQUIDITY_RANGE_INVALID'],
    ['an inverted range', { tickLower: 230_000, tickUpper: 220_000 }, 'LIQUIDITY_FIELDS_INVALID'],
    ['excessive USDC', { amount0Max: '1000000001' }, 'AMOUNT_OUT_OF_RANGE'],
    ['excessive WETH', { amount1Max: '1000000000000000001' }, 'AMOUNT_OUT_OF_RANGE'],
    ['excessive slippage', { slippageBps: 301 }, 'UNISWAP_SLIPPAGE_OUT_OF_RANGE'],
    ['zero slippage', { slippageBps: 0 }, 'UNISWAP_SLIPPAGE_OUT_OF_RANGE'],
    ['authored minimums (derived at Review instead)', { amount0Min: '1' }, 'UNISWAP_LIQUIDITY_DECLARATION_INVALID'],
    ['a foreign position asset', { positionAsset: { chainId: chain, address: profile.pool, decimals: 0 } }, 'UNISWAP_LIQUIDITY_DECLARATION_INVALID'],
  ])('rejects %s', (_name, patch, code) => expect(() => validateAuthoringWorkflow(workflow([node(patch as Partial<ConcentratedLiquidityFields>)]), context)).toThrow(code));
  it('keeps every other EVM chain unsupported and rejects tampering and composition', () => {
    const base = { ...fields, chain: 'eip155:8453', token0: { ...usdc, chainId: 'eip155:8453' }, token1: { ...weth, chainId: 'eip155:8453' },
      positionAsset: { ...fields.positionAsset, chainId: 'eip155:8453' } };
    expect(() => validateAuthoringWorkflow(workflow([createConcentratedLiquidityNode('node-002', base)]), context)).toThrow('LIQUIDITY_RUNTIME_UNSUPPORTED');
    const tampered = node(); tampered.requiredAuthorizationClass = 'MODE_B';
    expect(() => validateUniswapLiquidityNode(tampered)).toThrow('UNISWAP_LIQUIDITY_DECLARATION_INVALID');
    const retry = node(); retry.failurePolicy = 'RETRY';
    expect(() => validateAuthoringWorkflow(workflow([retry]), context)).toThrow('UNISWAP_LIQUIDITY_DECLARATION_INVALID');
    const swap = createExactInputSwapNode('node-003', { chain, input: usdc, output: weth, amount: '1000000', slippageBps: 50, protocols: ['uniswap'], maximumAmount: '1000000000' });
    expect(() => validateAuthoringWorkflow(workflow([node(), swap as ReturnType<typeof node>]), context)).toThrow(/ISOLATED_ONLY/);
    expect(() => validateAuthoringWorkflow(workflow([node(), { ...node(), nodeId: 'node-004' }]), context)).toThrow('UNISWAP_LIQUIDITY_ISOLATED_ONLY');
  });
});

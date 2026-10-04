// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry, UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { sqrtRatioAtTick } from '@defi-workflow-engine/reference-compiler';
import { readConcentratedLiquidity } from '@defi-workflow-engine/workflow-contracts';
import { commandIsValid, parseLocalCommand, summarize } from './commands';
import { editorReducer, initialEditor } from './editor';
import { describeProposal } from './proposal';
import { createUniswapLiquidityNode, parseUniswapLiquidityChat, uniswapBandInput, uniswapLiquidityDetails, uniswapLiquidityInputOf, uniswapPriceAtTick,
  type UniswapLiquidityInput } from './uniswap-liquidity-authoring';
import { solanaLiquidityDetails } from './solana-liquidity-authoring';
import { createLiquidityNode } from './liquidity-authoring';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const canvas: UniswapLiquidityInput = { network: 'Base Sepolia', maxUsdc: '10', maxWeth: '0.005', rangeUnit: 'PRICE', lower: '140', upper: '180', slippage: '100' };

describe('Base Sepolia Uniswap v3 liquidity chat/canvas authoring', () => {
  it('chat and canvas produce the identical canonical asset.liquidity.concentrated IR with deterministically aligned ticks', () => {
    const chat = parseLocalCommand('Add liquidity 10 USDC and 0.005 WETH from 140 to 180 USDC per WETH on Base Sepolia slippage 100 bps', initialEditor().workflow, context);
    expect(chat).toEqual({ type: 'ADD_UNISWAP_LIQUIDITY', input: canvas, source: 'CHAT', baseRevision: 0 });
    const fromChat = editorReducer(initialEditor(), chat, context), fromCanvas = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: 0 }, context);
    expect(fromChat.error).toBeNull();
    expect(fromChat.workflow).toEqual(fromCanvas.workflow);
    const node = fromChat.workflow.nodes.find(n => n.actionType === 'asset.liquidity.concentrated')!;
    const fields = readConcentratedLiquidity(node as Parameters<typeof readConcentratedLiquidity>[0]);
    expect(fields).toMatchObject({ chain: 'eip155:84532', amount0Max: '10000000', amount1Max: '5000000000000000', amount0Min: '0', amount1Min: '0',
      feeTier: 500, slippageBps: 100, protocols: ['uniswap-v3'], recipient: null,
      token0: { address: profile.token0.address, decimals: 6 }, token1: { address: profile.token1.address, decimals: 18 } });
    // Range is aligned outward and contains the requested 140–180 USDC per WETH (token0 per token1: inverted ticks).
    expect(fields.tickLower % 10 === 0 && fields.tickUpper % 10 === 0).toBe(true);
    expect(Number(uniswapPriceAtTick(fields.tickLower))).toBeGreaterThanOrEqual(180);
    expect(Number(uniswapPriceAtTick(fields.tickUpper))).toBeLessThanOrEqual(140);
    const ticks = parseLocalCommand(`add uniswap liquidity 10 USDC and 0.005 WETH ticks ${fields.tickLower} to ${fields.tickUpper} on Base Sepolia`, initialEditor().workflow, context);
    expect(editorReducer(initialEditor(), ticks, context).workflow.nodes).toEqual(fromChat.workflow.nodes);
    expect(summarize(fromChat.workflow)).toContain('Concentrated liquidity on Base Sepolia via Uniswap v3');
    expect(describeProposal(initialEditor(), fromChat, chat, context).join('\n')).toMatch(/each approval and the mint need their own wallet signature/);
  });
  it('derives ±10% around the current price as exact ticks and round-trips the inspector form', () => {
    const sqrt = (sqrtRatioAtTick(225_606) + 1_000n).toString();
    const band = uniswapBandInput(sqrt, 1_000);
    expect(band.rangeUnit).toBe('TICK');
    expect(uniswapBandInput(sqrt, 1_000)).toEqual(band);
    const node = createUniswapLiquidityNode('node-002', { ...canvas, rangeUnit: band.rangeUnit, lower: band.lower, upper: band.upper });
    const details = uniswapLiquidityDetails(node)!;
    expect(details).toMatchObject({ network: 'Base Sepolia', maxUsdc: '10', maxWeth: '0.005', tickLower: Number(band.lower), tickUpper: Number(band.upper),
      lowerPrice: band.lowerPrice, upperPrice: band.upperPrice, pool: profile.pool, feeTier: 500 });
    expect(createUniswapLiquidityNode('node-002', uniswapLiquidityInputOf(details))).toEqual(node);
    expect(JSON.stringify(node)).not.toMatch(/recipient|owner/);
    expect(solanaLiquidityDetails(node)).toBeNull();
  });
  it('allows a single-sided out-of-range position and rejects bad input; commands are validated closed', () => {
    expect(readConcentratedLiquidity(createUniswapLiquidityNode('n', { ...canvas, maxWeth: '0' }))).toMatchObject({ amount1Max: '0' });
    expect(() => createUniswapLiquidityNode('n', { ...canvas, network: 'Base' as 'Base Sepolia' })).toThrow('UNISWAP_LIQUIDITY_NETWORK_UNSUPPORTED');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, maxUsdc: '0', maxWeth: '0' })).toThrow('UNISWAP_LIQUIDITY_ZERO');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, maxUsdc: '1000.000001' })).toThrow('AMOUNT_OUT_OF_RANGE');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, rangeUnit: 'TICK', lower: '220005', upper: '230000' })).toThrow('UNISWAP_LIQUIDITY_RANGE_INVALID');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, lower: '180', upper: '140' })).toThrow('UNISWAP_LIQUIDITY_RANGE_INVALID');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, slippage: '301' })).toThrow('UNISWAP_SLIPPAGE_OUT_OF_RANGE');
    expect(() => createUniswapLiquidityNode('n', { ...canvas, slippage: '0' })).toThrow('UNISWAP_SLIPPAGE_OUT_OF_RANGE');
    expect(parseUniswapLiquidityChat('add liquidity 0.01 SOL and 0.3 devUSDC ticks -64 to 64 on Solana Devnet')).toBeNull();
    expect(commandIsValid({ type: 'ADD_UNISWAP_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: 0 })).toBe(true);
    expect(commandIsValid({ type: 'ADD_UNISWAP_LIQUIDITY', input: { ...canvas, recipient: '0x1111111111111111111111111111111111111111' }, source: 'CANVAS', baseRevision: 0 })).toBe(false);
    const withSwap = editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CANVAS', baseRevision: 0 }, context);
    expect(editorReducer(withSwap, { type: 'ADD_UNISWAP_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: withSwap.workflow.revision }, context).error).toMatch(/ISOLATED_ONLY/);
  });
  it('leaves the BUILD-006 fork authoring bytes and the Base mainnet token order unchanged', () => {
    const evm = createLiquidityNode('node-002', { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0', tickLower: '-100', tickUpper: '100',
      recipient: '0x1111111111111111111111111111111111111111' }, context);
    expect(evm.actionType).toBe('asset.liquidity.uniswap-v3');
    expect(readConcentratedLiquidity(evm)).toMatchObject({ chain: 'eip155:8453', feeTier: 500, protocols: ['uniswap-v3'], slippageBps: null });
    expect(uniswapLiquidityDetails(evm)).toBeNull();
  });
});

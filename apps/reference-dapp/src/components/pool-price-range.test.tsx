// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sqrtRatioAtTick } from '@defi-workflow-engine/reference-compiler';
import { PoolPriceRange, poolPriceBounds, poolPricePresets, type PoolPricePreset } from './pool-price-range';
import { uniswapBandInput, createUniswapLiquidityNode, uniswapLiquidityDetails } from '../domain/uniswap-liquidity-authoring';
import { createSolanaLiquidityNode, solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { initialEditor, editorReducer } from '../domain/editor';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';

describe('Pool symmetric custom price range', () => {
  it('places ±10% handles close to a fixed reference marker and never invents an unavailable price', () => {
    const rendered = renderToStaticMarkup(createElement(PoolPriceRange, { percent: 10, reference: null, onChange: () => {} }));
    expect(rendered).toContain('>--</span>');
    expect(rendered).toContain('left:45%'); expect(rendered).toContain('left:55%');
    expect(rendered).toContain('composer-price-center');
    expect(rendered.match(/role="slider"/g)).toHaveLength(2);
    expect(rendered).toContain('>-10%</span>'); expect(rendered).toContain('>+10%</span>');
    expect(rendered).not.toContain('$2');
    const priced = renderToStaticMarkup(createElement(PoolPriceRange, { percent: 15, reference: { price: '2450.32', quoteToken: 'USDC' }, onChange: () => {} }));
    expect(priced).toContain('2,450.32 USDC'); expect(priced).toContain('left:42.5%'); expect(priced).toContain('left:57.5%');
  });

  it('uses exact decimal bounds for a Solana reference, including fractional percentages', () => {
    expect(poolPriceBounds({ price: '25.123456789' }, 12)).toEqual({ rangeUnit: 'PRICE', lower: '22.10864197432', upper: '28.13827160368' });
    expect(poolPriceBounds({ price: '1.00000001' }, 0.03)).toEqual({ rangeUnit: 'PRICE', lower: '0.999700009997', upper: '1.000300010003' });
    const input = { network: 'Solana Devnet' as const, maxSol: '0.01', maxDevUsdc: '0.3', slippage: '100', ...poolPriceBounds({ price: '25' }, 15) };
    expect(solanaLiquidityDetails(createSolanaLiquidityNode('orca', input))).toMatchObject({ maxSol: '0.01', maxDevUsdc: '0.3' });
  });

  it('uses existing Uniswap band alignment and changes the workflow only through its validated command', () => {
    const reference = { price: '2500', sqrtPriceX96: sqrtRatioAtTick(198080).toString() };
    const bounds = poolPriceBounds(reference, 15);
    const aligned = uniswapBandInput(reference.sqrtPriceX96, 1500);
    expect(bounds).toEqual({ rangeUnit: aligned.rangeUnit, lower: aligned.lower, upper: aligned.upper });
    const input = { network: 'Base Sepolia' as const, maxUsdc: '1', maxWeth: '0.0001', slippage: '50', ...bounds };
    const initial = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: { ...input, ...poolPriceBounds(reference, 10) }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
    expect(initial.error).toBeNull();
    const node = initial.workflow.nodes.find(node => node.actionType === 'asset.liquidity.concentrated')!;
    const before = JSON.stringify(initial.workflow);
    createUniswapLiquidityNode(node.nodeId, input);
    expect(JSON.stringify(initial.workflow)).toBe(before);
    const reviewed = editorReducer(initial, { type: 'SET_UNISWAP_LIQUIDITY', nodeId: node.nodeId, input, source: 'CANVAS', baseRevision: initial.workflow.revision }, createBaseSepoliaReviewContext());
    expect(reviewed.error).toBeNull();
    expect(JSON.stringify(initial.workflow)).toBe(before);
    expect(uniswapLiquidityDetails(reviewed.workflow.nodes.find(item => item.nodeId === node.nodeId)!)).toMatchObject({ tickLower: Number(bounds.lower), tickUpper: Number(bounds.upper) });
    expect(reviewed.workflow.revision).toBe(initial.workflow.revision + 1);
  });

  it.each([
    ['Estável', '2499.25', '2500.75', 40, 60, '-0.03%', '+0.03%'],
    ['Amplo', '1250', '5000', 30, 90, '-50%', '+100%'],
    ['Unilateral inferior', '1250', '2500', 25, 50, '-50%', '0%'],
    ['Unilateral superior', '2500', '5000', 50, 90, '0%', '+100%'],
  ] as const)('projects %s exactly and uses the existing native authoring validation', (name, lower, upper, left, right, lowerLabel, upperLabel) => {
    const preset: PoolPricePreset = name;
    const bounds = poolPriceBounds({ price: '2500' }, 10, preset);
    expect(bounds).toEqual({ rangeUnit: 'PRICE', lower, upper });
    const rendered = renderToStaticMarkup(createElement(PoolPriceRange, { percent: 10, preset, extent: poolPricePresets[preset].extent, reference: null, onChange: () => {} }));
    expect(rendered).toContain(`left:${left}%`); expect(rendered).toContain(`left:${right}%`);
    expect(rendered).toContain(`>${lowerLabel}</span>`); expect(rendered).toContain(`>${upperLabel}</span>`);
    expect(rendered).toContain('>--</span>');
    const uniswapInput = { network: 'Base Sepolia' as const, maxUsdc: '1', maxWeth: '0.0001', slippage: '50', ...bounds };
    const initial = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: { ...uniswapInput, ...poolPriceBounds({ price: '2500' }, 10) }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
    const node = initial.workflow.nodes.find(item => item.actionType === 'asset.liquidity.concentrated')!;
    const before = JSON.stringify(initial.workflow);
    const preview = uniswapLiquidityDetails(createUniswapLiquidityNode(node.nodeId, uniswapInput))!;
    expect(preview.tickLower).toBeLessThan(preview.tickUpper);
    expect(JSON.stringify(initial.workflow)).toBe(before);
    const accepted = editorReducer(initial, { type: 'SET_UNISWAP_LIQUIDITY', nodeId: node.nodeId, input: uniswapInput, source: 'CANVAS', baseRevision: initial.workflow.revision }, createBaseSepoliaReviewContext());
    expect(accepted.error).toBeNull();
    expect(accepted.workflow.revision).toBe(initial.workflow.revision + 1);
    expect(JSON.stringify(initial.workflow)).toBe(before);
    expect(uniswapLiquidityDetails(accepted.workflow.nodes.find(item => item.nodeId === node.nodeId)!)).toMatchObject({ tickLower: preview.tickLower, tickUpper: preview.tickUpper });
    const solanaInput = { network: 'Solana Devnet' as const, maxSol: '0.01', maxDevUsdc: '0.3', slippage: '100', ...poolPriceBounds({ price: '25' }, 10, preset) };
    expect(solanaLiquidityDetails(createSolanaLiquidityNode('orca', solanaInput))).toMatchObject({ maxSol: '0.01', maxDevUsdc: '0.3' });
  });

  it.each([null, { price: '0' }, { price: 'not available' }])('rejects missing or invalid reference %j', reference => {
    expect(() => poolPriceBounds(reference, 10)).toThrow('Reference price unavailable');
  });
  it.each([0, -10, 91, 100, Number.NaN])('rejects invalid percentage %s before authoring', percent => {
    expect(() => poolPriceBounds({ price: '25' }, percent)).toThrow('Choose a range');
  });
});

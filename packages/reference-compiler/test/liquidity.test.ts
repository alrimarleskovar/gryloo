// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, Q96,
  buildLiquidityPayload, encodeLiquidityCall, rangeComposition, sqrtRatioAtTick,
  verifyLiquidityPayload, verifyPoolState, type PoolState,
} from '../src/liquidity.js';

const owner = '0x1234567890123456789012345678901234567890';
const hash = `0x${'a'.repeat(64)}`;
const state: PoolState = {
  sourceChainId: 8453, executionChainId: 31337, sourceBlockHash: hash, sourceBlockNumber: 1,
  pool: '0x1111111111111111111111111111111111111111', factory: LIQUIDITY_FACTORY,
  positionManager: POSITION_MANAGER, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC,
  fee: 500, tickSpacing: 10, tick: 0, sqrtPriceX96: Q96,
  poolCodeHash: hash, positionManagerCodeHash: hash, observedAtMs: 1_000, expiresAtMs: 61_000,
};
const tx = { nonce: 7n, gasLimit: 250_000n, maxFeePerGas: 20_000_000n };

describe('independent v3 liquidity range math', () => {
  it('derives monotonic sqrt ratios and the exact minimum boundary', () => {
    expect(sqrtRatioAtTick(-887272)).toBe(4295128739n);
    expect(sqrtRatioAtTick(-10)).toBeLessThan(Q96);
    expect(sqrtRatioAtTick(0)).toBe(Q96);
    expect(sqrtRatioAtTick(10)).toBeGreaterThan(Q96);
    expect(() => sqrtRatioAtTick(887273)).toThrow('LIQUIDITY_TICK_INVALID');
  });
  it('derives composition from price and range, not a fixed half split', () => {
    const inside = rangeComposition(state, -10, 10, 1_000_000_000_000_000_000n, 1_000_000n, 2_000);
    expect(inside.state).toBe('IN_RANGE');
    expect(inside.amount0).toBeGreaterThan(0n);
    expect(inside.amount1).toBeGreaterThan(0n);
    expect(inside.amount0).toBeLessThanOrEqual(1_000_000_000_000_000_000n);
    expect(inside.amount1).toBeLessThanOrEqual(1_000_000n);
    const below = rangeComposition(state, 10, 20, 1_000_000_000_000_000_000n, 1_000_000n, 2_000);
    const above = rangeComposition(state, -20, -10, 1_000_000_000_000_000_000n, 1_000_000n, 2_000);
    expect([below.state, below.amount1, above.state, above.amount0]).toEqual(['BELOW_RANGE', 0n, 'ABOVE_RANGE', 0n]);
    expect(() => rangeComposition(state, -9, 10, 1n, 1n, 2_000)).toThrow('LIQUIDITY_RANGE_INVALID');
    expect(() => rangeComposition(state, -10, 10, 1n, 1n, 61_000)).toThrow('LIQUIDITY_POOL_STATE_INVALID');
  });
  it('rejects fake source, token, pool, price and stale state', () => {
    for (const changed of [
      { sourceChainId: 1 as 8453 }, { token0: LIQUIDITY_USDC },
      { pool: '0x0000000000000000000000000000000000000000' },
      { sqrtPriceX96: sqrtRatioAtTick(100) }, { positionManager: owner },
    ]) expect(() => verifyPoolState({ ...state, ...changed }, 2_000)).toThrow();
  });
});

describe('exact local Mode A liquidity payloads', () => {
  const mint = { kind: 'MINT' as const, token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
    tickLower: -10, tickUpper: 10, amount0Desired: 10n ** 18n, amount1Desired: 1_000_000n,
    amount0Min: 1n, amount1Min: 1n, recipient: owner, deadline: 1_000n };
  it('binds a canonical mint to exact reviewed bytes, target and hash', () => {
    const built = buildLiquidityPayload(mint, tx);
    const reviewed = verifyLiquidityPayload(built.bytes, mint, tx);
    expect(reviewed.to).toBe(POSITION_MANAGER);
    expect(reviewed.payloadHash).toBe(built.payloadHash);
    expect(reviewed.signingHash).toBe(built.signingHash);
    expect(reviewed.data).toMatch(/^0x88316456/);
    for (const altered of [{ ...mint, recipient: '0x0000000000000000000000000000000000000001' },
      { ...mint, tickUpper: 20 }, { ...mint, amount0Min: 2n }, { ...mint, fee: 3000 }]) {
      expect(() => verifyLiquidityPayload(built.bytes, altered, tx)).toThrow('LIQUIDITY_PAYLOAD_MISMATCH');
    }
    expect(() => verifyLiquidityPayload(built.bytes, mint, { ...tx, nonce: 8n })).toThrow('LIQUIDITY_PAYLOAD_MISMATCH');
  });
  it('uses finite token approval and the fixed Position Manager', () => {
    const approval = { kind: 'APPROVE' as const, token: LIQUIDITY_USDC, amount: 123n };
    const built = buildLiquidityPayload(approval, tx);
    expect(verifyLiquidityPayload(built.bytes, approval, tx).to).toBe(LIQUIDITY_USDC);
    expect(() => encodeLiquidityCall({ ...approval, token: owner })).toThrow('LIQUIDITY_TOKEN_INVALID');
    expect(() => verifyLiquidityPayload(built.bytes, { ...approval, amount: 124n }, tx)).toThrow('LIQUIDITY_PAYLOAD_MISMATCH');
  });
  it('supports increase, decrease, collect and eligible burn as separate payloads', () => {
    const calls = [
      { kind: 'INCREASE' as const, tokenId: 3n, amount0Desired: 10n, amount1Desired: 20n, amount0Min: 1n, amount1Min: 1n, deadline: 1_000n },
      { kind: 'DECREASE' as const, tokenId: 3n, liquidity: 10n, amount0Min: 1n, amount1Min: 1n, deadline: 1_000n },
      { kind: 'COLLECT' as const, tokenId: 3n, recipient: owner, amount0Max: 10n, amount1Max: 20n },
      { kind: 'BURN' as const, tokenId: 3n },
    ];
    for (const call of calls) {
      const built = buildLiquidityPayload(call, tx);
      expect(verifyLiquidityPayload(built.bytes, call, tx).to).toBe(POSITION_MANAGER);
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeUniswapApprove, decodeUniswapMint, decodeUniswapMintResult, decodeUniswapPosition, encodeUniswapApprove, encodeUniswapMint,
  formatRatio, sqrtRatioAtTick, uniswapAlignQuotePriceRange, uniswapBandAroundSqrtPrice, uniswapComposition, uniswapMinimum,
  uniswapQuotePriceAtSqrt, uniswapQuotePriceAtTick, uniswapRangeState, type UniswapMintParams } from '../src/index.js';

// Base Sepolia pool order: token0 USDC (6 decimals), token1 WETH (18 decimals); quote = USDC per WETH.
const D0 = 6, D1 = 18, SPACING = 10;
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e', WETH = '0x4200000000000000000000000000000000000006';
const OWNER = '0x1111111111111111111111111111111111111111';
const float = (tick: number) => 1e12 / Math.pow(1.0001, tick);
const quote = (tick: number) => Number(uniswapQuotePriceAtTick(tick, D0, D1));
const mint = (patch: Partial<UniswapMintParams> = {}): UniswapMintParams => ({ token0: USDC, token1: WETH, fee: 500, tickLower: 190_000, tickUpper: 200_000,
  amount0Desired: 10_000_000n, amount1Desired: 5_000_000_000_000_000n, amount0Min: 9_900_000n, amount1Min: 4_950_000_000_000_000n, recipient: OWNER,
  deadline: 1_900_000_000n, ...patch });

describe('Uniswap v3 public liquidity math (deterministic ticks)', () => {
  it('quote prices follow the inverted token order: a higher tick is a lower USDC-per-WETH price', () => {
    for (const tick of [-50_000, 0, 198_070, 225_606, 300_000]) expect(Math.abs(quote(tick) / float(tick) - 1)).toBeLessThan(1e-7);
    expect(quote(225_610)).toBeLessThan(quote(225_600));
    expect(uniswapQuotePriceAtSqrt(sqrtRatioAtTick(0), D0, D1)).toBe('1000000000000');
    expect(formatRatio(1n, 3n, 4)).toBe('0.3333');
    expect(formatRatio(12_345n, 10n, 3)).toBe('1234');
    expect(formatRatio(1n, 1_000n, 3)).toBe('0.001');
  });
  it('aligns an explicit price range outward to usable ticks and always contains the requested range', () => {
    const range = uniswapAlignQuotePriceRange('2000', '3000', D0, D1, SPACING);
    expect(range.tickLower % SPACING).toBe(0);
    expect(range.tickUpper % SPACING).toBe(0);
    // tickLower carries the HIGHER quote price; tickUpper the LOWER one.
    expect(quote(range.tickLower)).toBeGreaterThanOrEqual(3000);
    expect(quote(range.tickUpper)).toBeLessThanOrEqual(2000);
    expect(quote(range.tickLower + SPACING)).toBeLessThan(3000);
    expect(quote(range.tickUpper - SPACING)).toBeGreaterThan(2000);
    // Same input, same ticks: no floating-point reinterpretation.
    expect(uniswapAlignQuotePriceRange('2000', '3000', D0, D1, SPACING)).toEqual(range);
    expect(uniswapAlignQuotePriceRange('2000.000000000000000001', '3000', D0, D1, SPACING).tickUpper).toBe(range.tickUpper);
    for (const bad of [['3000', '2000'], ['2000', '2000'], ['0', '2000'], ['-1', '2000'], ['1e3', '2000'], ['2000', '3000.0000000000000000001']])
      expect(() => uniswapAlignQuotePriceRange(bad[0]!, bad[1]!, D0, D1, SPACING)).toThrow();
    expect(() => uniswapAlignQuotePriceRange('2000', '3000', D0, D1, 0)).toThrow('UNISWAP_TICK_SPACING_INVALID');
  });
  it('derives ±N% bands around the current price deterministically', () => {
    const current = sqrtRatioAtTick(225_606) + 12_345n;
    const band = uniswapBandAroundSqrtPrice(current, 1_000, SPACING);
    const p = Number(uniswapQuotePriceAtSqrt(current, D0, D1));
    expect(quote(band.tickLower)).toBeGreaterThanOrEqual(p * 1.1 * (1 - 1e-9));
    expect(quote(band.tickUpper)).toBeLessThanOrEqual(p * 0.9 * (1 + 1e-9));
    expect(band.tickLower % SPACING).toBe(0);
    expect(band.tickUpper % SPACING).toBe(0);
    expect(uniswapBandAroundSqrtPrice(current, 1_000, SPACING)).toEqual(band);
    expect(() => uniswapBandAroundSqrtPrice(current, 0, SPACING)).toThrow('UNISWAP_BAND_INVALID');
    expect(() => uniswapBandAroundSqrtPrice(current, 9_001, SPACING)).toThrow('UNISWAP_BAND_INVALID');
  });
  it('classifies range state with the pool rule and estimates the deposit composition', () => {
    expect(uniswapRangeState(99, 100, 200)).toBe('BELOW_RANGE');
    expect(uniswapRangeState(100, 100, 200)).toBe('IN_RANGE');
    expect(uniswapRangeState(200, 100, 200)).toBe('ABOVE_RANGE');
    const tick = 225_606, s = sqrtRatioAtTick(tick) + 1n;
    const inRange = uniswapComposition(s, tick, 225_000, 226_000, 100_000_000n, 10n ** 18n);
    expect(inRange.state).toBe('IN_RANGE');
    expect(inRange.amount0).toBeGreaterThan(0n);
    expect(inRange.amount1).toBeGreaterThan(0n);
    expect(inRange.amount0 <= 100_000_000n && inRange.amount1 <= 10n ** 18n).toBe(true);
    // One side binds exactly (within rounding).
    expect(inRange.amount0 >= 99_999_990n || inRange.amount1 >= 10n ** 18n - 10n ** 10n).toBe(true);
    const below = uniswapComposition(s, tick, 226_000, 227_000, 5_000_000n, 0n);
    expect(below).toMatchObject({ state: 'BELOW_RANGE', amount1: 0n });
    expect(below.amount0).toBeGreaterThan(4_999_990n);
    const above = uniswapComposition(s, tick, 224_000, 225_000, 0n, 10n ** 15n);
    expect(above).toMatchObject({ state: 'ABOVE_RANGE', amount0: 0n });
    expect(() => uniswapComposition(s, tick, 226_000, 227_000, 0n, 10n ** 15n)).toThrow('UNISWAP_LIQUIDITY_ZERO');
    expect(uniswapMinimum(1_000_000n, 100)).toBe(990_000n);
    expect(() => uniswapMinimum(1n, 10_001)).toThrow();
  });
});

describe('Uniswap v3 public liquidity calldata', () => {
  it('encodes and strictly decodes mint with the owner as NFT recipient', () => {
    const data = encodeUniswapMint(mint());
    expect(data.startsWith('0x88316456')).toBe(true);
    expect(data.length).toBe(10 + 11 * 64);
    expect(decodeUniswapMint(data)).toEqual(mint());
    const negative = mint({ tickLower: -200, tickUpper: -100 });
    expect(decodeUniswapMint(encodeUniswapMint(negative))).toEqual(negative);
    // A dirty high byte in an address word is non-canonical.
    expect(() => decodeUniswapMint(data.slice(0, 10) + 'ff' + data.slice(12))).toThrow('UNISWAP_MINT_INVALID');
  });
  it('rejects wrong token order, zero recipient, minimums above maxima, unknown fee and bad ticks', () => {
    expect(() => encodeUniswapMint(mint({ token0: WETH, token1: USDC }))).toThrow('UNISWAP_MINT_INVALID');
    expect(() => encodeUniswapMint(mint({ recipient: '0x0000000000000000000000000000000000000000' }))).toThrow('UNISWAP_MINT_INVALID');
    expect(() => encodeUniswapMint(mint({ amount0Min: 10_000_001n }))).toThrow('UNISWAP_MINT_INVALID');
    expect(() => encodeUniswapMint(mint({ fee: 501 }))).toThrow('UNISWAP_MINT_INVALID');
    expect(() => encodeUniswapMint(mint({ tickLower: 200_000, tickUpper: 190_000 }))).toThrow('UNISWAP_MINT_INVALID');
    expect(() => encodeUniswapMint(mint({ amount0Desired: 0n, amount1Desired: 0n, amount0Min: 0n, amount1Min: 0n }))).toThrow('UNISWAP_MINT_INVALID');
  });
  it('encodes exact finite approvals and decodes mint results and positions', () => {
    const approve = encodeUniswapApprove('0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2', 10_000_000n);
    expect(decodeUniswapApprove(approve)).toEqual({ spender: '0x27f971cb582bf9e50f397e4d29a5c7a34f11faa2', amount: 10_000_000n });
    expect(() => encodeUniswapApprove(OWNER, 0n)).toThrow('UNISWAP_APPROVAL_INVALID');
    const w = (n: bigint) => (n & ((1n << 256n) - 1n)).toString(16).padStart(64, '0');
    expect(decodeUniswapMintResult('0x' + w(7n) + w(1234n) + w(55n) + w(66n))).toEqual({ tokenId: 7n, liquidity: 1234n, amount0: 55n, amount1: 66n });
    expect(() => decodeUniswapMintResult('0x' + w(7n) + w(0n) + w(55n) + w(66n))).toThrow();
    const position = '0x' + w(0n) + w(0n) + w(BigInt(USDC)) + w(BigInt(WETH)) + w(500n) + w(-190_000n) + w(200_000n) + w(999n) + w(0n) + w(0n) + w(3n) + w(4n);
    expect(decodeUniswapPosition(position)).toEqual({ token0: USDC, token1: WETH, fee: 500, tickLower: -190_000, tickUpper: 200_000, liquidity: 999n, tokensOwed0: 3n, tokensOwed1: 4n });
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC: pure Uniswap v3 position math and exact calldata for the owner-wallet public path.
 * No network I/O, no signing. Price ↔ tick conversion is exact integer search over the independent
 * `sqrtRatioAtTick` (BUILD-006), so the ticks a range produces are deterministic on every platform.
 *
 * Conventions: the pool price r(tick) = 1.0001^tick is token1 raw units per token0 raw unit. The human "quote" price
 * is token0 per token1 (USDC per WETH on Base Sepolia, where USDC is token0): P = 10^(dec1 − dec0) / r, so a higher
 * tick is a LOWER quote price. Range states use the pool's own tick convention.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { encodeApprove, decodeApprove } from './abi.js';
import { sqrtRatioAtTick, Q96 } from './liquidity.js';

export const UNISWAP_MIN_TICK = -887_272;
export const UNISWAP_MAX_TICK = 887_272;
export const UNISWAP_MIN_SQRT_RATIO = 4_295_128_739n;
export const UNISWAP_MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const MAX_UINT128 = (1n << 128n) - 1n;
const Q192 = 1n << 192n;
export const UNISWAP_TOPICS = Object.freeze({
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  increaseLiquidity: '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
  poolMint: '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde',
});
export const UNISWAP_SELECTORS = Object.freeze({
  approve: '0x095ea7b3', mint: '0x88316456', positions: '0x99fbab88', ownerOf: '0x6352211e', balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e', decimals: '0x313ce567', factory: '0xc45a0155', weth9: '0x4aa4a4fc', getPool: '0x1698ee82',
  token0: '0x0dfe1681', token1: '0xd21220a7', fee: '0xddca3f43', tickSpacing: '0xd0c93a7c', slot0: '0x3850c7bd',
  liquidity: '0x1a686502', l1FeeUpperBound: '0xf1c7a58b',
});
const MINT_SIGNATURE = 'mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256))';
if ('0x' + Array.from(keccak_256(new TextEncoder().encode(MINT_SIGNATURE)).slice(0, 4), b => b.toString(16).padStart(2, '0')).join('') !== UNISWAP_SELECTORS.mint)
  throw new Error('UNISWAP_SELECTOR_PIN_INVALID');

function fail(code: string): never { throw new Error(code); }
const ADDRESS = /^0x[0-9a-f]{40}$/;
function tickValue(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < UNISWAP_MIN_TICK || tick > UNISWAP_MAX_TICK) fail('UNISWAP_TICK_INVALID');
  return tick;
}
const ratioAtTick = (tick: number) => { const s = sqrtRatioAtTick(tickValue(tick)); return s * s; };
/** Largest tick whose ratio (Q192) is ≤ the target ratio. */
function floorTickForRatio(targetQ192: bigint): number {
  if (targetQ192 <= 0n) fail('UNISWAP_PRICE_INVALID');
  let low = UNISWAP_MIN_TICK, high = UNISWAP_MAX_TICK;
  if (ratioAtTick(low) > targetQ192 || ratioAtTick(high) < targetQ192) fail('UNISWAP_PRICE_OUT_OF_RANGE');
  while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (ratioAtTick(mid) <= targetQ192) low = mid; else high = mid - 1; }
  return low;
}
function ceilTickForRatio(targetQ192: bigint): number {
  const floor = floorTickForRatio(targetQ192);
  return ratioAtTick(floor) === targetQ192 ? floor : floor + 1;
}
const alignDown = (tick: number, spacing: number) => Math.floor(tick / spacing) * spacing;
const alignUp = (tick: number, spacing: number) => Math.ceil(tick / spacing) * spacing;
function spacingValue(spacing: number): number {
  if (!Number.isSafeInteger(spacing) || spacing < 1 || spacing > 16_384) fail('UNISWAP_TICK_SPACING_INVALID');
  return spacing;
}
/** Usable aligned bounds (MIN/MAX_TICK rounded inward to the spacing). */
export function uniswapUsableTicks(spacing: number): { min: number; max: number } {
  return { min: alignUp(UNISWAP_MIN_TICK, spacingValue(spacing)), max: alignDown(UNISWAP_MAX_TICK, spacing) };
}

/** Parses a positive decimal string into an exact rational. */
export function parseDecimalPrice(text: string): { num: bigint; den: bigint } {
  const match = /^(0|[1-9][0-9]{0,17})(?:\.([0-9]{1,18}))?$/.exec(text.trim());
  if (!match) fail('UNISWAP_PRICE_INVALID');
  const fraction = match[2] ?? '', num = BigInt(match[1]! + fraction), den = 10n ** BigInt(fraction.length);
  if (num === 0n) fail('UNISWAP_PRICE_INVALID');
  return { num, den };
}
function decimalsValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 36) fail('UNISWAP_DECIMALS_INVALID');
  return value;
}
/** Ratio (token1 raw per token0 raw, Q192) of a quote price P = token0 per token1 (human units). */
function ratioForQuotePrice(price: { num: bigint; den: bigint }, decimals0: number, decimals1: number): bigint {
  const shift = decimalsValue(decimals1) - decimalsValue(decimals0);
  const scaleNum = shift >= 0 ? 10n ** BigInt(shift) : 1n, scaleDen = shift >= 0 ? 1n : 10n ** BigInt(-shift);
  return scaleNum * Q192 * price.den / (price.num * scaleDen);
}
/** Formats num/den with `significant` significant digits (truncated), no exponent. */
export function formatRatio(num: bigint, den: bigint, significant = 8): string {
  if (num < 0n || den <= 0n) fail('UNISWAP_PRICE_INVALID');
  if (num === 0n) return '0';
  const integer = num / den;
  if (integer > 0n) {
    const digits = integer.toString();
    if (digits.length >= significant) return digits;
    const fractionDigits = significant - digits.length;
    const fraction = (num % den) * 10n ** BigInt(fractionDigits) / den;
    const text = fraction.toString().padStart(fractionDigits, '0').replace(/0+$/, '');
    return text ? `${digits}.${text}` : digits;
  }
  let scale = 0n, scaled = num;
  while (scaled < den) { scaled *= 10n; scale += 1n; }
  const fraction = num * 10n ** (scale + BigInt(significant) - 1n) / den;
  return `0.${'0'.repeat(Number(scale) - 1)}${fraction.toString().replace(/0+$/, '')}`;
}
/** Human quote price (token0 per token1) at a Q96 square-root price. */
export function uniswapQuotePriceAtSqrt(sqrtPriceX96: bigint, decimals0: number, decimals1: number, significant = 8): string {
  if (sqrtPriceX96 <= 0n) fail('UNISWAP_PRICE_INVALID');
  const shift = decimalsValue(decimals1) - decimalsValue(decimals0);
  const ratio = sqrtPriceX96 * sqrtPriceX96;
  return shift >= 0 ? formatRatio(10n ** BigInt(shift) * Q192, ratio, significant) : formatRatio(Q192, ratio * 10n ** BigInt(-shift), significant);
}
export function uniswapQuotePriceAtTick(tick: number, decimals0: number, decimals1: number, significant = 8): string {
  return uniswapQuotePriceAtSqrt(sqrtRatioAtTick(tickValue(tick)), decimals0, decimals1, significant);
}
export type UniswapTickRange = { readonly tickLower: number; readonly tickUpper: number };
function checkedRange(tickLower: number, tickUpper: number, spacing: number): UniswapTickRange {
  const usable = uniswapUsableTicks(spacing);
  if (tickLower >= tickUpper || tickLower < usable.min || tickUpper > usable.max) fail('UNISWAP_RANGE_INVALID');
  return { tickLower, tickUpper };
}
/**
 * Deterministic outward alignment of a quote-price range (token0 per token1) to usable ticks. Because a higher
 * tick is a lower quote price, the upper price sets tickLower (aligned down) and the lower price sets tickUpper
 * (aligned up). The resulting range always contains the requested price range.
 */
export function uniswapAlignQuotePriceRange(lowerPrice: string, upperPrice: string, decimals0: number, decimals1: number, spacing: number): UniswapTickRange {
  const low = parseDecimalPrice(lowerPrice), high = parseDecimalPrice(upperPrice);
  if (low.num * high.den >= high.num * low.den) fail('UNISWAP_RANGE_INVALID');
  const tickLower = alignDown(floorTickForRatio(ratioForQuotePrice(high, decimals0, decimals1)), spacingValue(spacing));
  const tickUpper = alignUp(ceilTickForRatio(ratioForQuotePrice(low, decimals0, decimals1)), spacing);
  return checkedRange(tickLower, tickUpper, spacing);
}
/**
 * ±`bandBps` around the current price, aligned outward: quote prices P·(1 − b) and P·(1 + b) map to ticks exactly as
 * an explicit price range would. The current price is mutable state read at authoring time; the IR keeps the ticks.
 */
export function uniswapBandAroundSqrtPrice(sqrtPriceX96: bigint, bandBps: number, spacing: number): UniswapTickRange {
  if (!Number.isSafeInteger(bandBps) || bandBps < 1 || bandBps > 9_000) fail('UNISWAP_BAND_INVALID');
  if (sqrtPriceX96 <= UNISWAP_MIN_SQRT_RATIO || sqrtPriceX96 >= UNISWAP_MAX_SQRT_RATIO) fail('UNISWAP_PRICE_INVALID');
  const ratio = sqrtPriceX96 * sqrtPriceX96, b = BigInt(bandBps);
  // Quote price × (1 + b) ⇔ ratio / (1 + b) → lower tick; quote price × (1 − b) ⇔ ratio / (1 − b) → upper tick.
  const tickLower = alignDown(floorTickForRatio(ratio * 10_000n / (10_000n + b)), spacingValue(spacing));
  const tickUpper = alignUp(ceilTickForRatio(ratio * 10_000n / (10_000n - b)), spacing);
  return checkedRange(tickLower, tickUpper, spacing);
}
export type UniswapRangeState = 'BELOW_RANGE' | 'IN_RANGE' | 'ABOVE_RANGE';
/** The pool's own rule (UniswapV3Pool._modifyPosition): tick < lower → token0 only; tick ≥ upper → token1 only. */
export function uniswapRangeState(currentTick: number, tickLower: number, tickUpper: number): UniswapRangeState {
  tickValue(currentTick);
  return currentTick < tickLower ? 'BELOW_RANGE' : currentTick < tickUpper ? 'IN_RANGE' : 'ABOVE_RANGE';
}
function ceilDiv(a: bigint, b: bigint): bigint { return (a + b - 1n) / b; }
export type UniswapComposition = { readonly liquidity: bigint; readonly amount0: bigint; readonly amount1: bigint; readonly state: UniswapRangeState };
/**
 * Independent estimate of the liquidity and deposit a mint with these maxima produces (LiquidityAmounts and
 * SqrtPriceMath formulas). Used only to cross-check the public-network simulation, never as the reviewed amount.
 */
export function uniswapComposition(sqrtPriceX96: bigint, currentTick: number, tickLower: number, tickUpper: number,
  amount0Max: bigint, amount1Max: bigint): UniswapComposition {
  if (amount0Max < 0n || amount1Max < 0n || amount0Max === 0n && amount1Max === 0n) fail('UNISWAP_AMOUNT_INVALID');
  if (tickLower >= tickUpper) fail('UNISWAP_RANGE_INVALID');
  const a = sqrtRatioAtTick(tickValue(tickLower)), b = sqrtRatioAtTick(tickValue(tickUpper)), s = sqrtPriceX96;
  const state = uniswapRangeState(currentTick, tickLower, tickUpper);
  const l0 = (lo: bigint, hi: bigint) => amount0Max * (lo * hi / Q96) / (hi - lo);
  const l1 = (lo: bigint, hi: bigint) => amount1Max * Q96 / (hi - lo);
  let liquidity: bigint;
  if (s <= a) liquidity = l0(a, b);
  else if (s < b) { const x = l0(s, b), y = l1(a, s); liquidity = x < y ? x : y; }
  else liquidity = l1(a, b);
  if (liquidity <= 0n || liquidity > MAX_UINT128) fail('UNISWAP_LIQUIDITY_ZERO');
  const amount0For = (lo: bigint, hi: bigint) => ceilDiv(ceilDiv(liquidity * Q96 * (hi - lo), hi), lo);
  const amount1For = (lo: bigint, hi: bigint) => ceilDiv(liquidity * (hi - lo), Q96);
  const amount0 = state === 'BELOW_RANGE' ? amount0For(a, b) : state === 'IN_RANGE' ? amount0For(s < a ? a : s, b) : 0n;
  const amount1 = state === 'ABOVE_RANGE' ? amount1For(a, b) : state === 'IN_RANGE' ? amount1For(a, s > b ? b : s) : 0n;
  return { liquidity, amount0, amount1, state };
}
/** Minimum accepted amount for a simulated amount under the reviewed slippage (rounded down). */
export function uniswapMinimum(amount: bigint, slippageBps: number): bigint {
  if (amount < 0n || !Number.isSafeInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) fail('UNISWAP_SLIPPAGE_INVALID');
  return amount * BigInt(10_000 - slippageBps) / 10_000n;
}

const word = (value: bigint) => { if (value < 0n || value >= 1n << 256n) fail('UNISWAP_ABI_INVALID'); return value.toString(16).padStart(64, '0'); };
const addressWord = (value: string) => { if (!ADDRESS.test(value)) fail('UNISWAP_ABI_INVALID'); return value.slice(2).padStart(64, '0'); };
const tickWord = (tick: number) => word(BigInt(tickValue(tick)) & ((1n << 256n) - 1n));
const toHex = (bytes: Uint8Array) => '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
function fromHex(value: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(value)) fail('UNISWAP_ABI_INVALID');
  return Uint8Array.from(value.slice(2).match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}
/** Exact ERC-20 approve(spender, amount) calldata. */
export function encodeUniswapApprove(spender: string, amount: bigint): string {
  if (!ADDRESS.test(spender) || amount <= 0n || amount >= 1n << 256n) fail('UNISWAP_APPROVAL_INVALID');
  return toHex(encodeApprove(spender, amount));
}
export function decodeUniswapApprove(data: string): { spender: string; amount: bigint } {
  try { return decodeApprove(fromHex(data)); } catch { fail('UNISWAP_APPROVAL_INVALID'); }
}
export type UniswapMintParams = { readonly token0: string; readonly token1: string; readonly fee: number; readonly tickLower: number; readonly tickUpper: number;
  readonly amount0Desired: bigint; readonly amount1Desired: bigint; readonly amount0Min: bigint; readonly amount1Min: bigint;
  readonly recipient: string; readonly deadline: bigint };
function checkMint(p: UniswapMintParams): void {
  if (!ADDRESS.test(p.token0) || !ADDRESS.test(p.token1) || p.token0 >= p.token1 || !ADDRESS.test(p.recipient) ||
      p.recipient === '0x0000000000000000000000000000000000000000' || ![100, 500, 3000, 10000].includes(p.fee) ||
      tickValue(p.tickLower) >= tickValue(p.tickUpper) || p.amount0Desired < 0n || p.amount1Desired < 0n ||
      p.amount0Desired === 0n && p.amount1Desired === 0n || p.amount0Min < 0n || p.amount1Min < 0n ||
      p.amount0Min > p.amount0Desired || p.amount1Min > p.amount1Desired || p.deadline <= 0n || p.deadline >= 1n << 64n)
    fail('UNISWAP_MINT_INVALID');
}
/** Exact NonfungiblePositionManager.mint(MintParams) calldata. Token order must be the pool's (token0 < token1). */
export function encodeUniswapMint(p: UniswapMintParams): string {
  checkMint(p);
  return UNISWAP_SELECTORS.mint + addressWord(p.token0) + addressWord(p.token1) + word(BigInt(p.fee)) + tickWord(p.tickLower) + tickWord(p.tickUpper) +
    word(p.amount0Desired) + word(p.amount1Desired) + word(p.amount0Min) + word(p.amount1Min) + addressWord(p.recipient) + word(p.deadline);
}
/** Strict decode: only canonical re-encodable calldata is accepted. */
export function decodeUniswapMint(data: string): UniswapMintParams {
  if (typeof data !== 'string' || !/^0x88316456[0-9a-f]{704}$/.test(data)) fail('UNISWAP_MINT_INVALID');
  const at = (i: number) => BigInt('0x' + data.slice(10 + i * 64, 74 + i * 64));
  const addressAt = (i: number) => { const v = at(i); if (v >> 160n) fail('UNISWAP_MINT_INVALID'); return '0x' + v.toString(16).padStart(40, '0'); };
  const tickAt = (i: number) => { const v = at(i); const n = v >= 1n << 255n ? v - (1n << 256n) : v; if (n < -887_272n || n > 887_272n) fail('UNISWAP_MINT_INVALID'); return Number(n); };
  const fee = at(2);
  if (fee > 1_000_000n) fail('UNISWAP_MINT_INVALID');
  const p: UniswapMintParams = { token0: addressAt(0), token1: addressAt(1), fee: Number(fee), tickLower: tickAt(3), tickUpper: tickAt(4),
    amount0Desired: at(5), amount1Desired: at(6), amount0Min: at(7), amount1Min: at(8), recipient: addressAt(9), deadline: at(10) };
  if (encodeUniswapMint(p) !== data) fail('UNISWAP_MINT_INVALID');
  return p;
}
/** mint() returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1). */
export function decodeUniswapMintResult(data: string): { tokenId: bigint; liquidity: bigint; amount0: bigint; amount1: bigint } {
  if (typeof data !== 'string' || !/^0x[0-9a-f]{256}$/.test(data)) fail('UNISWAP_MINT_RESULT_INVALID');
  const at = (i: number) => BigInt('0x' + data.slice(2 + i * 64, 66 + i * 64));
  const result = { tokenId: at(0), liquidity: at(1), amount0: at(2), amount1: at(3) };
  if (result.liquidity > MAX_UINT128 || result.liquidity === 0n || result.tokenId === 0n) fail('UNISWAP_MINT_RESULT_INVALID');
  return result;
}
export type UniswapPositionRead = { readonly token0: string; readonly token1: string; readonly fee: number; readonly tickLower: number; readonly tickUpper: number;
  readonly liquidity: bigint; readonly tokensOwed0: bigint; readonly tokensOwed1: bigint };
/** positions(tokenId) return data (12 words). */
export function decodeUniswapPosition(data: string): UniswapPositionRead {
  if (typeof data !== 'string' || !/^0x[0-9a-f]{768}$/.test(data)) fail('UNISWAP_POSITION_INVALID');
  const at = (i: number) => BigInt('0x' + data.slice(2 + i * 64, 66 + i * 64));
  const addressAt = (i: number) => { const v = at(i); if (v >> 160n) fail('UNISWAP_POSITION_INVALID'); return '0x' + v.toString(16).padStart(40, '0'); };
  const tickAt = (i: number) => { const v = at(i) & ((1n << 24n) - 1n); return Number(v >= 1n << 23n ? v - (1n << 24n) : v); };
  return { token0: addressAt(2), token1: addressAt(3), fee: Number(at(4)), tickLower: tickAt(5), tickUpper: tickAt(6), liquidity: at(7),
    tokensOwed0: at(10), tokensOwed1: at(11) };
}
export { Q96 as UNISWAP_Q96 };

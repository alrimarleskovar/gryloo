// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: exact decimal strings as scaled integers. Prices, thresholds, percentages and amounts never pass through a
 * float: a value is parsed into a bigint at a fixed scale (refused when it has more fractional digits than the scale), compared and
 * combined as integers, and printed back without rounding drift.
 */
const DECIMAL = /^(0|[1-9][0-9]{0,29})(?:\.([0-9]{1,18}))?$/;

/** `value` × 10^scale, or null when it is not a plain non-negative decimal with at most `scale` fractional digits. */
export function parseScaled(value: unknown, scale: number): bigint | null {
  if (typeof value !== 'string') return null;
  const match = DECIMAL.exec(value);
  if (!match || (match[2] ?? '').length > scale) return null;
  return BigInt(match[1]! + (match[2] ?? '').padEnd(scale, '0'));
}
/** The decimal string of `units` / 10^scale, trailing zeros removed. */
export function formatScaled(units: bigint, scale: number): string {
  const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale), fraction = digits.slice(digits.length - scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
/** Integer division rounding toward −∞ or +∞ (both operands positive). */
export const divFloor = (a: bigint, b: bigint) => a / b;
export const divCeil = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** USD prices and thresholds carry 8 decimals (the scale of Chainlink USD feeds). */
export const PRICE_SCALE = 8;
/** Token amounts carry up to 18 decimals (the StrategySpec decimal grammar). */
export const AMOUNT_SCALE = 18;
/** Percentages carry 2 decimals ("5", "2.5", "12.75"). */
export const PERCENT_SCALE = 2;

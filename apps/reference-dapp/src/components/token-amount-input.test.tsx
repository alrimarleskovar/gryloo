// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { normalizeAmountEntry } from './token-amount-input';

describe('token amount entry formatting without financial parsing', () => {
  it.each([
    ['', ''], ['0', '0'], ['000', '0'], ['005050', '5050'], ['0007', '7'],
    ['0007.0500', '7.0500'], ['0.5', '0.5'], ['0.05', '0.05'], ['000.05', '0.05'],
    ['0.', '0.'], ['.', '0.'], ['.05', '0.05'], ['001.', '1.'], ['1.00', '1.00'],
    ['000123456789012345678901234567890', '123456789012345678901234567890'],
    ['0.0000000000000000001', '0.0000000000000000001'],
  ])('formats %j as %j while preserving every fractional digit', (entered, expected) => {
    expect(normalizeAmountEntry(entered)).toBe(expected);
  });

  it.each(['-1', '+1', '1e2', '01e2', '0x10', '1,5', ' 007 ', '1..2', 'abc'])('leaves invalid input %j for the existing validator', value => {
    expect(normalizeAmountEntry(value)).toBe(value);
  });
});

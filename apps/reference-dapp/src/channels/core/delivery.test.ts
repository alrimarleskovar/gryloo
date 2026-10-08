// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the outbound retry schedule — exponential backoff with ±20 % jitter, never shorter than the provider's
 * retry-after, never beyond the body's 15-minute lifetime — and the output guard's link rule.
 */
import { describe, expect, it } from 'vitest';
import { BACKOFF_SECONDS, MAX_SEND_ATTEMPTS, retryDelayMs } from './delivery.ts';
import { RETENTION } from './store.ts';

describe('BUILD-CHANNELS-001 outbound retry schedule', () => {
  it('backs off exponentially with bounded jitter, and every attempt fits in the body\'s lifetime', () => {
    expect(BACKOFF_SECONDS).toEqual([5, 20, 60, 180, 420]);
    expect(MAX_SEND_ATTEMPTS).toBe(BACKOFF_SECONDS.length + 1);
    for (const [i, seconds] of BACKOFF_SECONDS.entries()) {
      expect(retryDelayMs(i + 1, null, () => 0)).toBe(Math.round(seconds * 800));
      expect(retryDelayMs(i + 1, null, () => 1)).toBe(Math.round(seconds * 1200));
    }
    // Even with the longest jitter on every step, the last attempt happens before the body expires.
    const worst = BACKOFF_SECONDS.reduce((sum, s) => sum + s * 1200, 0);
    expect(worst).toBeLessThan(RETENTION.transientMs);
    expect(retryDelayMs(99, null, () => 0.5)).toBe(BACKOFF_SECONDS.at(-1)! * 1000);
  });

  it('waits at least the provider\'s retry-after, capped by the body\'s lifetime', () => {
    expect(retryDelayMs(1, 90_000, () => 0.5)).toBe(90_000);
    expect(retryDelayMs(1, 1_000, () => 0.5)).toBe(5_000);
    expect(retryDelayMs(1, 86_400_000, () => 0.5)).toBe(RETENTION.transientMs);
  });
});

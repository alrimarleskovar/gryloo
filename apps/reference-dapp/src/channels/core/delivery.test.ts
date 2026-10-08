// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the outbound retry policy. Retries run only when a sweep (once a minute) or a turn runs, so every wait between
 * attempts can grow by up to one scheduler interval. The schedule must still give a transiently failing message all six attempts
 * inside the body's 15-minute lifetime, for any jitter and any scheduler phase — proven here by the closed-form bound and by an
 * exhaustive simulation — and a message that cannot get its next attempt in time (a slower scheduler, a long retry-after) ends DEAD
 * at once instead of expiring as if it had never been attempted.
 */
import { describe, expect, it } from 'vitest';
import { BACKOFF_SECONDS, failedTransiently, MAX_SEND_ATTEMPTS, nextRetryAt, retryDelayMs, SCHEDULER_INTERVAL_MS } from './delivery.ts';
import { RETENTION } from './store.ts';

const LIFE = RETENTION.transientMs, TICK = SCHEDULER_INTERVAL_MS;
/**
 * A message created at `t0` (ms after a scheduler tick) is attempted at once by its turn, then only at ticks (k × `tick`); every
 * attempt fails transiently. Returns the attempt times and why it ended DEAD: attempts exhausted, the lifetime rule (no next attempt
 * could fit), or — when a slower scheduler's sweep only comes after the lifetime — expiry of a message that already failed, which the
 * delivery path also records as DEAD (`failedTransiently`). It can never end SKIPPED: it was attempted.
 */
function simulate(random: () => number, t0: number, tick = TICK) {
  const created = new Date(t0), attempts = [t0];
  for (;;) {
    if (attempts.length >= MAX_SEND_ATTEMPTS) return { attempts, ended: 'DEAD', reason: 'EXHAUSTED' };
    const retry = nextRetryAt(attempts.length, created, new Date(attempts.at(-1)!), null, random);
    if (!retry) return { attempts, ended: 'DEAD', reason: 'LIFETIME_RULE' };
    const next = Math.ceil(retry.getTime() / tick) * tick;
    if (next - t0 > LIFE) return { attempts, ended: failedTransiently({ errorCode: 'PROVIDER_UNAVAILABLE' }) ? 'DEAD' : 'SKIPPED', reason: 'EXPIRED_AFTER_ATTEMPT' };
    attempts.push(next);
  }
}

describe('BUILD-CHANNELS-001 outbound retry policy', () => {
  it('fits six attempts in the body lifetime by construction: Σ 1.2·b + 5 scheduler intervals ≤ 15 minutes', () => {
    expect(MAX_SEND_ATTEMPTS).toBe(BACKOFF_SECONDS.length + 1);
    expect(BACKOFF_SECONDS).toEqual([5, 15, 45, 120, 300]);
    const worst = BACKOFF_SECONDS.reduce((sum, s) => sum + s * 1_200, 0) + BACKOFF_SECONDS.length * TICK;
    expect(worst).toBe(882_000);
    expect(worst + TICK).toBeGreaterThan(LIFE); // the bound is tight enough to matter …
    expect(worst).toBeLessThanOrEqual(LIFE); // … and holds
    // The previous schedule did not: 5, 20, 60, 180, 420 s could need 1,122 s with a once-a-minute scheduler.
    expect([5, 20, 60, 180, 420].reduce((sum, s) => sum + s * 1_200, 0) + 5 * TICK).toBeGreaterThan(LIFE);
  });

  it('backs off exponentially within ±20 % jitter (minimum, middle and maximum), never shorter than the provider\'s retry-after', () => {
    for (const [i, seconds] of BACKOFF_SECONDS.entries()) {
      expect(retryDelayMs(i + 1, null, () => 0)).toBe(Math.round(seconds * 800));
      expect(retryDelayMs(i + 1, null, () => 0.5)).toBe(seconds * 1000);
      expect(retryDelayMs(i + 1, null, () => 1)).toBe(Math.round(seconds * 1200));
    }
    expect(retryDelayMs(1, 90_000, () => 0.5)).toBe(90_000);
    expect(retryDelayMs(1, 1_000, () => 0.5)).toBe(5_000);
    expect(retryDelayMs(1, 86_400_000, () => 0.5)).toBe(LIFE);
  });

  it('gives exactly six attempts then DEAD under a once-a-minute scheduler, for every jitter and every scheduler phase', () => {
    for (let r = 0; r <= 1.000001; r += 0.05) for (let t0 = 0; t0 < TICK; t0 += 1_000) {
      const run = simulate(() => Math.min(r, 1), t0);
      expect(run, `r=${r.toFixed(2)} t0=${t0}`).toMatchObject({ ended: 'DEAD', reason: 'EXHAUSTED' });
      expect(run.attempts).toHaveLength(MAX_SEND_ATTEMPTS);
      expect(run.attempts.at(-1)! - t0).toBeLessThanOrEqual(LIFE);
    }
    // The extremes, explicitly (first attempt just after a tick, the worst phase).
    expect(simulate(() => 1, 1).attempts.map(t => Math.round(t / 1000))).toEqual([0, 60, 120, 180, 360, 720]);
    expect(simulate(() => 0, 1).attempts.map(t => Math.round(t / 1000))).toEqual([0, 60, 120, 180, 300, 540]);
  });

  it('still ends DEAD — never SKIPPED — when a slower scheduler or a long retry-after leaves no room for the next attempt', () => {
    for (const tick of [2 * TICK, 5 * TICK, 20 * TICK]) for (const r of [0, 0.5, 1]) for (const t0 of [1, 30_000, 59_000]) {
      const run = simulate(() => r, t0, tick);
      expect(run.ended, `tick=${tick} r=${r} t0=${t0}`).toBe('DEAD');
      expect(run.attempts.length).toBeGreaterThanOrEqual(1);
      expect(run.attempts.length).toBeLessThanOrEqual(MAX_SEND_ATTEMPTS);
      expect(run.attempts.every(t => t - t0 <= LIFE)).toBe(true);
    }
    const created = new Date(0);
    expect(nextRetryAt(1, created, new Date(0), 600_000, () => 0.5)).toEqual(new Date(600_000));
    expect(nextRetryAt(1, created, new Date(0), 840_001, () => 0.5)).toBeNull();
  });

  it('places the final retry exactly at the lifetime boundary: allowed when the next sweep still fits, refused one millisecond later', () => {
    const created = new Date(0), last = BACKOFF_SECONDS.at(-1)! * 1000;
    // The fifth attempt fails at `now`; the sixth is due `last` later and a sweep may come one interval after that.
    const boundary = new Date(LIFE - TICK - last);
    expect(nextRetryAt(5, created, boundary, null, () => 0.5)).toEqual(new Date(LIFE - TICK));
    expect(nextRetryAt(5, created, new Date(boundary.getTime() + 1), null, () => 0.5)).toBeNull();
    // After the sixth attempt nothing is retried, whatever the time.
    expect(nextRetryAt(MAX_SEND_ATTEMPTS, created, new Date(0), null, () => 0)).toBeNull();
  });

  it('tells a message that failed transiently (a dead letter when it expires) from one never attempted or only held (SKIPPED)', () => {
    expect(failedTransiently({ errorCode: 'PROVIDER_UNAVAILABLE' })).toBe(true);
    expect(failedTransiently({ errorCode: 'PROVIDER_THROTTLED' })).toBe(true);
    expect(failedTransiently({ errorCode: null })).toBe(false);
    expect(failedTransiently({ errorCode: 'ORDER_HELD' })).toBe(false);
  });
});

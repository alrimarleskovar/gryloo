// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { dueAt, latestSlotAtOrBefore, localToInstant, nextPriceCheck, nextSlotAfter, periodStart, validTimeZone, zonedParts, type Schedule } from './schedule.ts';

const iso = (at: number) => new Date(at).toISOString();
const t = (value: string) => Date.parse(value);
const daily = (time: string, timezone = 'Europe/Lisbon'): Schedule => ({ frequency: 'DAILY', weekday: null, time, timezone });
const weekly = (weekday: number, time: string, timezone = 'Europe/Lisbon'): Schedule => ({ frequency: 'WEEKLY', weekday, time, timezone });

describe('BUILD-AUTOMATION-001 schedules in IANA zones', () => {
  it('accepts IANA zone identifiers only', () => {
    for (const zone of ['Europe/Lisbon', 'America/Sao_Paulo', 'America/New_York', 'Asia/Tokyo', 'UTC']) expect(validTimeZone(zone), zone).toBe(true);
    for (const zone of ['+01:00', 'GMT+1', 'Mars/Olympus', '', 'europe/lisbon', 'Europe/Lisbon ', 42]) expect(validTimeZone(zone), String(zone)).toBe(false);
  });

  it('computes daily slots at the local time, keyed by the local date', () => {
    expect(nextSlotAfter(daily('09:00'), t('2026-10-08T07:59:00Z'))).toEqual({ at: t('2026-10-08T08:00:00Z'), key: '2026-10-08T09:00' });
    // The slot itself is not "after" itself: the next one is tomorrow.
    expect(nextSlotAfter(daily('09:00'), t('2026-10-08T08:00:00Z'))).toEqual({ at: t('2026-10-09T08:00:00Z'), key: '2026-10-09T09:00' });
    expect(latestSlotAtOrBefore(daily('09:00'), t('2026-10-08T08:00:00Z'))?.key).toBe('2026-10-08T09:00');
    expect(latestSlotAtOrBefore(daily('09:00'), t('2026-10-08T07:59:59Z'))?.key).toBe('2026-10-07T09:00');
    expect(nextSlotAfter(daily('18:00', 'America/Sao_Paulo'), t('2026-10-08T12:00:00Z'))).toEqual({ at: t('2026-10-08T21:00:00Z'), key: '2026-10-08T18:00' });
  });

  it('computes weekly slots on the ISO weekday (Monday = 1)', () => {
    expect(nextSlotAfter(weekly(1, '09:00'), t('2026-10-08T10:00:00Z'))).toEqual({ at: t('2026-10-12T08:00:00Z'), key: '2026-10-12T09:00' });
    expect(nextSlotAfter(weekly(7, '23:30', 'Asia/Tokyo'), t('2026-10-08T00:00:00Z'))).toEqual({ at: t('2026-10-11T14:30:00Z'), key: '2026-10-11T23:30' });
  });

  it('keeps the local time across daylight-saving changes (never a fixed UTC hour)', () => {
    // Lisbon leaves summer time on 2026-10-25: 09:00 is 08:00Z before and 09:00Z after.
    expect(iso(nextSlotAfter(daily('09:00'), t('2026-10-24T00:00:00Z')).at)).toBe('2026-10-24T08:00:00.000Z');
    expect(iso(nextSlotAfter(daily('09:00'), t('2026-10-24T12:00:00Z')).at)).toBe('2026-10-25T09:00:00.000Z');
    expect(iso(nextSlotAfter(weekly(1, '09:00'), t('2026-10-20T00:00:00Z')).at)).toBe('2026-10-26T09:00:00.000Z');
    // ...and enters it on 2026-03-29.
    expect(iso(nextSlotAfter(daily('09:00'), t('2026-03-28T12:00:00Z')).at)).toBe('2026-03-29T08:00:00.000Z');
    expect(iso(nextSlotAfter(daily('09:00', 'America/New_York'), t('2026-03-07T20:00:00Z')).at)).toBe('2026-03-08T13:00:00.000Z');
  });

  it('runs a local time that does not exist one gap later, and an ambiguous one at its first occurrence', () => {
    // New York, 2026-03-08: 02:00 → 03:00. 02:30 does not exist and runs at 03:30 EDT (07:30Z).
    const gap = nextSlotAfter(daily('02:30', 'America/New_York'), t('2026-03-08T00:00:00Z'));
    expect(gap).toEqual({ at: t('2026-03-08T07:30:00Z'), key: '2026-03-08T02:30' });
    expect(zonedParts(gap.at, 'America/New_York')).toMatchObject({ hour: 3, minute: 30 });
    // New York, 2026-11-01: 01:30 happens twice; the first (EDT, 05:30Z) is the slot, once.
    expect(nextSlotAfter(daily('01:30', 'America/New_York'), t('2026-11-01T00:00:00Z'))).toEqual({ at: t('2026-11-01T05:30:00Z'), key: '2026-11-01T01:30' });
    expect(nextSlotAfter(daily('01:30', 'America/New_York'), t('2026-11-01T05:30:00Z')).key).toBe('2026-11-02T01:30');
    // Lisbon, 2026-10-25: 01:30 happens at 00:30Z (WEST) and 01:30Z (WET); 2026-03-29: 01:30 does not exist (→ 02:30 WEST, 01:30Z).
    expect(iso(localToInstant({ year: 2026, month: 10, day: 25 }, 1, 30, 'Europe/Lisbon'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(localToInstant({ year: 2026, month: 3, day: 29 }, 1, 30, 'Europe/Lisbon'))).toBe('2026-03-29T01:30:00.000Z');
  });

  it('applies the LATEST_WITHIN_GRACE missed-run policy: one proposal at most, never a backlog', () => {
    const s = daily('09:00'), since = t('2026-10-01T08:00:00Z');
    // A week down, back 30 minutes after today's slot: today's slot is proposed, the six before it are reported as missed.
    expect(dueAt(s, since, t('2026-10-08T08:30:00Z'))).toEqual({ kind: 'DUE', slot: { at: t('2026-10-08T08:00:00Z'), key: '2026-10-08T09:00' }, missed: 6,
      next: { at: t('2026-10-09T08:00:00Z'), key: '2026-10-09T09:00' } });
    // Back eight hours after today's slot (past the six-hour grace): nothing is proposed; all seven are missed.
    expect(dueAt(s, since, t('2026-10-08T16:00:00Z'))).toMatchObject({ kind: 'MISSED', missed: 7, next: { key: '2026-10-09T09:00' } });
    // Ten missed weekly purchases are never ten proposals.
    const w = weekly(1, '09:00'), down = dueAt(w, t('2026-08-03T08:00:00Z'), t('2026-10-12T08:05:00Z'));
    expect(down).toMatchObject({ kind: 'DUE', missed: 9, slot: { key: '2026-10-12T09:00' } });
    // Nothing new since the last handled slot.
    expect(dueAt(s, t('2026-10-08T08:00:00Z'), t('2026-10-08T12:00:00Z'))).toEqual({ kind: 'NOT_DUE', next: { at: t('2026-10-09T08:00:00Z'), key: '2026-10-09T09:00' } });
  });

  it('starts local periods at local midnight (day, ISO week, month)', () => {
    expect(iso(periodStart('DAY', t('2026-10-08T23:30:00Z'), 'Europe/Lisbon'))).toBe('2026-10-08T23:00:00.000Z');
    expect(iso(periodStart('WEEK', t('2026-10-08T12:00:00Z'), 'Europe/Lisbon'))).toBe('2026-10-04T23:00:00.000Z');
    expect(iso(periodStart('MONTH', t('2026-10-08T12:00:00Z'), 'America/Sao_Paulo'))).toBe('2026-10-01T03:00:00.000Z');
    expect(iso(periodStart('WEEK', t('2026-10-26T12:00:00Z'), 'Europe/Lisbon'))).toBe('2026-10-26T00:00:00.000Z');
  });

  it('aligns price checks to the minute grid and bounds the cadence', () => {
    expect(iso(nextPriceCheck(t('2026-10-08T10:07:30Z'), 15))).toBe('2026-10-08T10:15:00.000Z');
    expect(iso(nextPriceCheck(t('2026-10-08T10:15:00Z'), 15))).toBe('2026-10-08T10:30:00.000Z');
    expect(() => nextPriceCheck(0, 1)).toThrow('AUTOMATION_CADENCE_INVALID');
    expect(() => nextPriceCheck(0, 1441)).toThrow('AUTOMATION_CADENCE_INVALID');
  });

  it('refuses malformed schedules', () => {
    for (const bad of [{ ...daily('9:00') }, { ...daily('24:00') }, { ...weekly(0, '09:00') }, { ...weekly(8, '09:00') }, { ...daily('09:00'), weekday: 1 },
      { ...daily('09:00', 'Nowhere/Land') }] as Schedule[]) expect(() => nextSlotAfter(bad, 0)).toThrow('AUTOMATION_SCHEDULE_INVALID');
  });
});

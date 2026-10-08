// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: schedules in IANA time zones — pure, deterministic, no clock of its own.
 *
 * A schedule is a local wall-clock time (`HH:MM`) every day, or on one ISO weekday (1 = Monday … 7 = Sunday), in a named IANA zone.
 * Every slot is computed from the zone's own rules for that local date, never stored as a fixed UTC hour, so daylight-saving changes
 * move the UTC instant and keep the local time. Ambiguous and missing local times follow the `compatible` rule (as in Temporal):
 *
 *   overlap (clocks go back, the local time happens twice)   the EARLIER instant
 *   gap (clocks go forward, the local time does not exist)    shifted forward by the gap (02:30 → 03:30 in a one-hour gap)
 *
 * A slot's identity is its LOGICAL local date and configured time (`2026-10-12T09:00`), not its instant: one slot per local date,
 * stable across retries, replicas and DST, which is what makes "at most one occurrence per slot" enforceable by a unique key.
 *
 * Missed runs (`LATEST_WITHIN_GRACE`): after downtime only the most recent due slot may still produce a proposal, and only within
 * `MISSED_RUN_GRACE_MS` of its time; every earlier slot is reported as missed and is never proposed.
 */

export type Frequency = 'DAILY' | 'WEEKLY';
export type Schedule = { readonly frequency: Frequency; readonly weekday: number | null; readonly time: string; readonly timezone: string };
export type Slot = { readonly at: number; readonly key: string };
export type LocalDate = { readonly year: number; readonly month: number; readonly day: number };

export const MISSED_RUN_GRACE_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

let zones: ReadonlySet<string> | null = null;
/** The IANA zone identifiers this runtime knows (plus `UTC`): anything else, an abbreviation or an offset string, is refused. */
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  zones ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  if (!zones.has(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}
export const validTime = (value: unknown): value is string => typeof value === 'string' && TIME.test(value);

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit' });
    formatters.set(timezone, f);
  }
  return f;
}
export type LocalParts = LocalDate & { readonly hour: number; readonly minute: number; readonly second: number };
/** The wall-clock reading of an instant in a zone. */
export function zonedParts(at: number, timezone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timezone).formatToParts(new Date(at))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute!, second: parts.second! };
}
/** The zone's offset from UTC at an instant, in milliseconds (wall clock − UTC). */
export function zoneOffsetMs(at: number, timezone: string): number {
  const p = zonedParts(at, timezone), whole = Math.floor(at / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
}

/** The instant a local wall time names in a zone, with the `compatible` rule for overlaps (earlier) and gaps (shifted forward). */
export function localToInstant(date: LocalDate, hour: number, minute: number, timezone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const before = zoneOffsetMs(wall - DAY_MS, timezone), after = zoneOffsetMs(wall + DAY_MS, timezone);
  const valid = [...new Set([before, after, zoneOffsetMs(wall, timezone)])].map(offset => wall - offset)
    .filter(at => zoneOffsetMs(at, timezone) === wall - at).sort((a, b) => a - b);
  if (valid.length) return valid[0]!;
  // A gap: read the wall time with the offset in force before it, which lands after the transition by the gap's length.
  return wall - Math.min(before, after);
}

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: LocalDate) => ((new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() + 6) % 7) + 1;
const pad = (n: number, width = 2) => String(n).padStart(width, '0');
export const dateKey = (date: LocalDate) => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;

function slotOn(schedule: Schedule, date: LocalDate): Slot | null {
  if (schedule.frequency === 'WEEKLY' && isoWeekday(date) !== schedule.weekday) return null;
  const [, h, m] = TIME.exec(schedule.time)!;
  return { at: localToInstant(date, Number(h), Number(m), schedule.timezone), key: `${dateKey(date)}T${schedule.time}` };
}
/** Throws `AUTOMATION_SCHEDULE_INVALID` for anything that is not a well-formed schedule. */
export function assertSchedule(schedule: Schedule): void {
  const weekly = schedule.frequency === 'WEEKLY';
  if ((schedule.frequency !== 'DAILY' && !weekly) || !validTime(schedule.time) || !validTimeZone(schedule.timezone)
    || (weekly ? !(Number.isInteger(schedule.weekday) && schedule.weekday! >= 1 && schedule.weekday! <= 7) : schedule.weekday !== null)) throw new Error('AUTOMATION_SCHEDULE_INVALID');
}

/** The first slot strictly after `after`. */
export function nextSlotAfter(schedule: Schedule, after: number): Slot {
  assertSchedule(schedule);
  const today = zonedParts(after, schedule.timezone);
  for (let d = -1; d <= 15; d++) {
    const slot = slotOn(schedule, addDays(today, d));
    if (slot && slot.at > after) return slot;
  }
  throw new Error('AUTOMATION_SCHEDULE_INVALID');
}
/** The latest slot at or before `at`, or null when none exists within two weeks (never for a valid schedule). */
export function latestSlotAtOrBefore(schedule: Schedule, at: number): Slot | null {
  assertSchedule(schedule);
  const today = zonedParts(at, schedule.timezone);
  for (let d = 1; d >= -15; d--) {
    const slot = slotOn(schedule, addDays(today, d));
    if (slot && slot.at <= at) return slot;
  }
  return null;
}

export type DueDecision =
  | { readonly kind: 'NOT_DUE'; readonly next: Slot }
  /** `slot` is proposed; `missed` earlier slots since `since` are only reported. */
  | { readonly kind: 'DUE'; readonly slot: Slot; readonly missed: number; readonly next: Slot }
  /** Every due slot is older than the grace window: nothing is proposed. */
  | { readonly kind: 'MISSED'; readonly missed: number; readonly next: Slot };
/**
 * What a scheduled rule does when evaluated at `now`, having handled every slot up to `since` (exclusive of later ones): the
 * `LATEST_WITHIN_GRACE` missed-run policy. `next` is the first slot after `now` (the rule's next evaluation).
 */
export function dueAt(schedule: Schedule, since: number, now: number, grace = MISSED_RUN_GRACE_MS): DueDecision {
  const next = nextSlotAfter(schedule, now), latest = latestSlotAtOrBefore(schedule, now);
  if (!latest || latest.at <= since) return { kind: 'NOT_DUE', next };
  let count = 0;
  for (let cursor = nextSlotAfter(schedule, since); cursor.at <= now && count < 10_000; cursor = nextSlotAfter(schedule, cursor.at)) count++;
  return now - latest.at <= grace ? { kind: 'DUE', slot: latest, missed: Math.max(0, count - 1), next } : { kind: 'MISSED', missed: count, next };
}

export type Period = 'DAY' | 'WEEK' | 'MONTH';
/** The start of the local day, ISO week (Monday) or month containing `at`, in the zone. */
export function periodStart(period: Period, at: number, timezone: string): number {
  const today = zonedParts(at, timezone);
  const date = period === 'DAY' ? today : period === 'WEEK' ? addDays(today, 1 - isoWeekday(today)) : { year: today.year, month: today.month, day: 1 };
  return localToInstant(date, 0, 0, timezone);
}

/** The next check of a price rule: the next multiple of `minutes` on the epoch minute grid after `after`. */
export function nextPriceCheck(after: number, minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1_440) throw new Error('AUTOMATION_CADENCE_INVALID');
  const step = minutes * 60_000;
  return (Math.floor(after / step) + 1) * step;
}

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AUTOMATION-001A product contract: a recurring schedule may surface a deterministic swap strategy for the owner to review.
 * It is deliberately not execution authority. Every due occurrence must still enter FloFi's ordinary Simulate → Review →
 * owner-wallet signature path.
 */
import { composeStrategy } from '../engine/strategy-engine';
import type { StrategySpec } from '../engine/strategy-spec';
import type { Command } from './commands';

export const AUTOMATION_EXECUTION_POLICY = 'OWNER_CONFIRMATION_REQUIRED' as const;
export type ScheduleCadence = 'DAILY' | 'WEEKLY';
export type ScheduleTrigger = { readonly type: 'SCHEDULE'; readonly cadence: ScheduleCadence; readonly timezone: string;
  readonly localTime: string; readonly weekday?: number };
export type AutomationSpec = { readonly version: 1; readonly name: string; readonly trigger: ScheduleTrigger;
  readonly strategy: StrategySpec; readonly execution: typeof AUTOMATION_EXECUTION_POLICY };
export type ValidAutomation = { readonly spec: AutomationSpec; readonly workflowHash: string; readonly command: Command };

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const NAME = /^[^\u0000-\u001f\u007f]{1,80}$/, TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validTimeZone(timezone: unknown): timezone is string {
  if (typeof timezone !== 'string' || timezone.length < 1 || timezone.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0)); return true; } catch { return false; }
}
function triggerOf(value: unknown): ScheduleTrigger | null {
  if (!plain(value) || value.type !== 'SCHEDULE' || !['DAILY','WEEKLY'].includes(String(value.cadence)) ||
      !validTimeZone(value.timezone) || typeof value.localTime !== 'string' || !TIME.test(value.localTime)) return null;
  if (value.cadence === 'DAILY') {
    if (!exact(value, ['type','cadence','timezone','localTime'])) return null;
    return { type: 'SCHEDULE', cadence: 'DAILY', timezone: value.timezone, localTime: value.localTime };
  }
  if (!exact(value, ['type','cadence','timezone','localTime','weekday']) || !Number.isSafeInteger(value.weekday) ||
      (value.weekday as number) < 1 || (value.weekday as number) > 7) return null;
  return { type: 'SCHEDULE', cadence: 'WEEKLY', timezone: value.timezone, localTime: value.localTime, weekday: value.weekday as number };
}

/** Validate, normalize and hash exactly the strategy that every due event will later re-compose. */
export function validateAutomationSpec(value: unknown): ValidAutomation | { readonly code: string } {
  if (!plain(value) || !exact(value, ['version','name','trigger','strategy','execution']) || value.version !== 1 ||
      typeof value.name !== 'string' || !NAME.test(value.name) || value.execution !== AUTOMATION_EXECUTION_POLICY) return { code: 'AUTOMATION_SPEC_INVALID' };
  const trigger = triggerOf(value.trigger);
  if (!trigger) return { code: 'AUTOMATION_SCHEDULE_INVALID' };
  const composed = composeStrategy(value.strategy);
  if (!composed.ok || composed.strategy.action !== 'swap') return { code: 'AUTOMATION_STRATEGY_INVALID' };
  // 001A proves the scheduler on public testnets first. Mainnet and Solana schedules can reuse this contract after their
  // owner-session/execution gates are explicitly enabled; we do not present a schedule that cannot complete today.
  if (composed.strategy.network !== 'base-sepolia' && composed.strategy.network !== 'ethereum-sepolia') return { code: 'AUTOMATION_NETWORK_NOT_ENABLED' };
  const spec: AutomationSpec = { version: 1, name: value.name, trigger, strategy: composed.strategy, execution: AUTOMATION_EXECUTION_POLICY };
  return { spec, workflowHash: composed.workflowHash, command: composed.command };
}

type Local = { year: number; month: number; day: number; hour: number; minute: number };
function localParts(date: Date, timeZone: string): Local {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute') };
}
function localEpoch(value: Local): number { return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute); }
/** Convert a wall-clock instant in an IANA zone to UTC without introducing a timezone dependency. */
function zonedUtc(value: Local, timeZone: string): Date {
  let guess = localEpoch(value);
  for (let i = 0; i < 4; i++) {
    const seen = localParts(new Date(guess), timeZone);
    const delta = localEpoch(value) - localEpoch(seen);
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}
/** First scheduled wall-clock occurrence strictly after `after`, preserving the IANA timezone across DST changes. */
export function nextScheduledOccurrence(trigger: ScheduleTrigger, after: Date): Date {
  if (!Number.isFinite(after.getTime()) || !validTimeZone(trigger.timezone) || !TIME.test(trigger.localTime)) throw new Error('AUTOMATION_SCHEDULE_INVALID');
  const here = localParts(after, trigger.timezone), [hour, minute] = trigger.localTime.split(':').map(Number);
  const localMidnight = new Date(Date.UTC(here.year, here.month - 1, here.day));
  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(localMidnight.getTime() + offset * 86_400_000);
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (trigger.cadence === 'WEEKLY' && weekday !== trigger.weekday) continue;
    const candidate = zonedUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: hour!, minute: minute! }, trigger.timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('AUTOMATION_SCHEDULE_INVALID');
}
export function automationEventExpiry(nextDue: Date): Date { return nextDue; }

export function scheduledDcaSpec(input: { readonly name: string; readonly network: 'base-sepolia' | 'ethereum-sepolia';
  readonly amount: string; readonly slippageBps?: number; readonly cadence: ScheduleCadence; readonly timezone: string;
  readonly localTime: string; readonly weekday?: number }): AutomationSpec {
  const trigger: ScheduleTrigger = input.cadence === 'WEEKLY'
    ? { type: 'SCHEDULE', cadence: 'WEEKLY', timezone: input.timezone, localTime: input.localTime, weekday: input.weekday ?? 1 }
    : { type: 'SCHEDULE', cadence: 'DAILY', timezone: input.timezone, localTime: input.localTime };
  return { version: 1, name: input.name, trigger,
    strategy: { version: 1, action: 'swap', network: input.network, inputAsset: 'USDC', outputAsset: 'WETH',
      amount: input.amount, slippageBps: input.slippageBps ?? 50 },
    execution: AUTOMATION_EXECUTION_POLICY };
}

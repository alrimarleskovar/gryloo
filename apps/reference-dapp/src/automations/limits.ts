// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the owner's deterministic limits — pure. Every limit here is enforceable against FloFi's own state; none is
 * decorative. They bound what FloFi PROPOSES; they are not on-chain spending limits, and the fresh simulation and Strategy Manifest
 * Review stay authoritative for every market and route fact at execution time.
 *
 *   maxAmountPerExecution    the bound action's amount (in its spend asset) may not exceed it
 *   maxAmountPerPeriod       the amounts of counted occurrences in the current local DAY / WEEK / MONTH plus this one
 *   maxOccurrencesPerPeriod  the number of counted occurrences in the current period plus this one
 *   cooldownMinutes          minimum time between two occurrences of the rule
 *   maxSlippageBps           the bound action's slippage may not exceed it
 *
 * Counted occurrences are the ones still open or taken up by the owner (PENDING_OWNER, APPROVAL_CREATED, COMPLETED) and the ones the
 * owner opened before they expired (their approval may still have been used); declined (DISMISSED) and never-opened expired proposals
 * do not count. Checked at creation and rebinding (binding limits), when an occurrence is created (all, under the
 * rule's row lock) and again when the owner opens it (all, excluding itself).
 */
import { AMOUNT_SCALE, parseScaled } from './decimal.ts';
import type { Period } from './schedule.ts';

export const PERIODS: readonly Period[] = Object.freeze(['DAY', 'WEEK', 'MONTH']);
export type Limits = {
  readonly maxAmountPerExecution: string | null;
  readonly maxAmountPerPeriod: { readonly amount: string; readonly period: Period } | null;
  readonly maxOccurrencesPerPeriod: { readonly count: number; readonly period: Period } | null;
  readonly cooldownMinutes: number;
  readonly maxSlippageBps: number | null;
};
export const NO_LIMITS: Limits = Object.freeze({ maxAmountPerExecution: null, maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: null });
export const MAX_COOLDOWN_MINUTES = 60 * 24 * 31;

/** Throws `AUTOMATION_LIMITS_INVALID` unless every limit is well-formed. */
export function assertLimits(limits: Limits): void {
  const amount = (value: string) => { const v = parseScaled(value, AMOUNT_SCALE); return v !== null && v > 0n; };
  const ok = (limits.maxAmountPerExecution === null || amount(limits.maxAmountPerExecution))
    && (limits.maxAmountPerPeriod === null || (amount(limits.maxAmountPerPeriod.amount) && PERIODS.includes(limits.maxAmountPerPeriod.period)))
    && (limits.maxOccurrencesPerPeriod === null || (Number.isInteger(limits.maxOccurrencesPerPeriod.count) && limits.maxOccurrencesPerPeriod.count >= 1
      && limits.maxOccurrencesPerPeriod.count <= 1_000 && PERIODS.includes(limits.maxOccurrencesPerPeriod.period)))
    && Number.isInteger(limits.cooldownMinutes) && limits.cooldownMinutes >= 0 && limits.cooldownMinutes <= MAX_COOLDOWN_MINUTES
    && (limits.maxSlippageBps === null || (Number.isInteger(limits.maxSlippageBps) && limits.maxSlippageBps >= 0 && limits.maxSlippageBps <= 10_000));
  if (!ok) throw new Error('AUTOMATION_LIMITS_INVALID');
}

export type Spend = { readonly asset: string; readonly amount: string };
/** Limits that depend only on the bound action: its amount and slippage. Null when they hold, else the closed code. */
export function bindingViolation(limits: Limits, spend: Spend | null, slippageBps: number | null): string | null {
  if (spend && limits.maxAmountPerExecution !== null && parseScaled(spend.amount, AMOUNT_SCALE)! > parseScaled(limits.maxAmountPerExecution, AMOUNT_SCALE)!)
    return 'LIMIT_AMOUNT_PER_EXECUTION';
  if (limits.maxSlippageBps !== null && slippageBps !== null && slippageBps > limits.maxSlippageBps) return 'LIMIT_SLIPPAGE';
  return null;
}
/** The rule's counted occurrences in the current period of each periodic limit, and its latest occurrence. */
export type Usage = { readonly amountPeriod: { readonly sum: string; readonly asset: string | null } | null; readonly countPeriod: number | null;
  readonly lastOccurrenceAt: number | null };
/** Every limit for one more occurrence (`spend` null: a notify-only occurrence, which only counts and cools down). */
export function occurrenceViolation(limits: Limits, spend: Spend | null, slippageBps: number | null, usage: Usage, now: number): string | null {
  const binding = bindingViolation(limits, spend, slippageBps);
  if (binding) return binding;
  if (limits.cooldownMinutes > 0 && usage.lastOccurrenceAt !== null && now - usage.lastOccurrenceAt < limits.cooldownMinutes * 60_000) return 'LIMIT_COOLDOWN';
  if (limits.maxOccurrencesPerPeriod && (usage.countPeriod ?? 0) + 1 > limits.maxOccurrencesPerPeriod.count) return 'LIMIT_PERIOD_COUNT';
  if (limits.maxAmountPerPeriod && spend) {
    const used = parseScaled(usage.amountPeriod?.sum ?? '0', AMOUNT_SCALE) ?? 0n;
    // Amounts of different assets never add up: a rule's action has one spend asset; a mismatch is a corrupted history.
    if (usage.amountPeriod?.asset && usage.amountPeriod.asset !== spend.asset) return 'LIMIT_PERIOD_ASSET_MISMATCH';
    if (used + parseScaled(spend.amount, AMOUNT_SCALE)! > parseScaled(limits.maxAmountPerPeriod.amount, AMOUNT_SCALE)!) return 'LIMIT_PERIOD_AMOUNT';
  }
  return null;
}
/** The periods whose usage a rule's limits need. */
export const limitPeriods = (limits: Limits): { readonly amount: Period | null; readonly count: Period | null } =>
  ({ amount: limits.maxAmountPerPeriod?.period ?? null, count: limits.maxOccurrencesPerPeriod?.period ?? null });

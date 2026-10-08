// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: deterministic price conditions and their edge semantics — pure. A price observation feeds a comparison and
 * nothing else; it never becomes authority.
 *
 *   PRICE_BELOW    price <  threshold
 *   PRICE_ABOVE    price >  threshold
 *   PERCENT_DROP   price <= reference × (1 − percent/100)   (threshold rounded down: at least the full drop)
 *   PERCENT_RISE   price >= reference × (1 + percent/100)   (threshold rounded up: at least the full rise)
 *
 * Edge semantics (`trigger_state`): a condition fires on the transition from "not met" to "met", once.
 *
 *   first observation     arms the rule when the condition is NOT met; when it is already met, the rule waits (CONDITION_ALREADY_MET):
 *                         creating "below $3,000" while the price is $2,900 does not fire until the price crosses back and down again
 *   armed + met           TRIGGERED with key `price:<epoch>`; disarmed; the cooldown starts
 *   disarmed + not met    REARMED: the epoch advances, so the next crossing has a new identity
 *   disarmed + met        CONDITION_STILL_MET (ten checks below the threshold are not ten proposals)
 *   armed + met, cooling  COOLDOWN: the crossing is consumed (disarmed) without a proposal — no burst when the cooldown ends
 *   stale / failed read   OBSERVATION_STALE: no state change at all
 *
 * The caller may also consume a crossing without a proposal for its own reasons (a limit), exactly like COOLDOWN.
 */
import { divCeil, divFloor, parseScaled, PERCENT_SCALE, PRICE_SCALE } from './decimal.ts';

export const OBSERVED_ASSETS = ['ETH', 'BTC', 'SOL'] as const;
export type ObservedAsset = (typeof OBSERVED_ASSETS)[number];
export type ConditionType = 'PRICE_BELOW' | 'PRICE_ABOVE' | 'PERCENT_DROP' | 'PERCENT_RISE';
export type AbsoluteCondition = { readonly type: 'PRICE_BELOW' | 'PRICE_ABOVE'; readonly asset: ObservedAsset; readonly threshold: string };
export type PercentCondition = { readonly type: 'PERCENT_DROP' | 'PERCENT_RISE'; readonly asset: ObservedAsset; readonly reference: string; readonly percent: string };
export type PriceCondition = AbsoluteCondition | PercentCondition;
export const isPercentCondition = (c: PriceCondition): c is PercentCondition => c.type === 'PERCENT_DROP' || c.type === 'PERCENT_RISE';
export type TriggerState = { readonly armed: boolean | null; readonly epoch: number; readonly cooldownUntil: string | null; readonly lastTriggeredAt: string | null };
export const INITIAL_TRIGGER_STATE: TriggerState = Object.freeze({ armed: null, epoch: 0, cooldownUntil: null, lastTriggeredAt: null });

/** A price observation as the comparison needs it: the price at PRICE_SCALE and when the source says it was true. */
export type PricePoint = { readonly priceUsd: string; readonly observedAt: string };
export type TriggerOutcome = 'ARMED' | 'CONDITION_ALREADY_MET' | 'TRIGGERED' | 'CONDITION_NOT_MET' | 'REARMED' | 'CONDITION_STILL_MET' | 'COOLDOWN' | 'OBSERVATION_STALE';
export type TriggerStep = { readonly outcome: TriggerOutcome; readonly state: TriggerState; readonly triggerKey: string | null; readonly met: boolean | null };

/** The effective threshold at PRICE_SCALE, or `AUTOMATION_CONDITION_INVALID`. */
export function conditionThreshold(condition: PriceCondition): bigint {
  if (!isPercentCondition(condition)) {
    const threshold = parseScaled(condition.threshold, PRICE_SCALE);
    if (threshold === null || threshold <= 0n) throw new Error('AUTOMATION_CONDITION_INVALID');
    return threshold;
  }
  const reference = parseScaled(condition.reference, PRICE_SCALE), percent = parseScaled(condition.percent, PERCENT_SCALE);
  if (reference === null || reference <= 0n || percent === null || percent <= 0n) throw new Error('AUTOMATION_CONDITION_INVALID');
  // 100 % = 10_000 at PERCENT_SCALE. A drop must leave a positive threshold; a rise is bounded at +1000 %.
  if (condition.type === 'PERCENT_DROP') {
    if (percent >= 10_000n) throw new Error('AUTOMATION_CONDITION_INVALID');
    return divFloor(reference * (10_000n - percent), 10_000n);
  }
  if (percent > 100_000n) throw new Error('AUTOMATION_CONDITION_INVALID');
  return divCeil(reference * (10_000n + percent), 10_000n);
}
/** Whether the condition holds for `price` (PRICE_SCALE). */
export function conditionMet(condition: PriceCondition, price: bigint): boolean {
  const threshold = conditionThreshold(condition);
  switch (condition.type) {
    case 'PRICE_BELOW': return price < threshold;
    case 'PRICE_ABOVE': return price > threshold;
    case 'PERCENT_DROP': return price <= threshold;
    case 'PERCENT_RISE': return price >= threshold;
  }
}

/**
 * One evaluation of a price rule. `fresh` is false for an observation older than the source's maximum age (or absent): nothing
 * changes. `cooldownMs` starts at each trigger.
 */
export function stepTrigger(condition: PriceCondition, state: TriggerState, point: PricePoint | null, fresh: boolean, now: number, cooldownMs: number): TriggerStep {
  const price = point ? parseScaled(point.priceUsd, PRICE_SCALE) : null;
  if (!point || !fresh || price === null || price <= 0n) return { outcome: 'OBSERVATION_STALE', state, triggerKey: null, met: null };
  const met = conditionMet(condition, price);
  if (state.armed === null) return { outcome: met ? 'CONDITION_ALREADY_MET' : 'ARMED', met, triggerKey: null,
    state: { ...state, armed: !met, epoch: met ? state.epoch : state.epoch + 1 } };
  if (state.armed && met) {
    if (state.cooldownUntil !== null && now < Date.parse(state.cooldownUntil)) return { outcome: 'COOLDOWN', met, triggerKey: null, state: { ...state, armed: false } };
    return { outcome: 'TRIGGERED', met, triggerKey: `price:${state.epoch}`, state: { ...state, armed: false, lastTriggeredAt: new Date(now).toISOString(),
      cooldownUntil: cooldownMs > 0 ? new Date(now + cooldownMs).toISOString() : null } };
  }
  if (state.armed) return { outcome: 'CONDITION_NOT_MET', met, triggerKey: null, state };
  if (!met) return { outcome: 'REARMED', met, triggerKey: null, state: { ...state, armed: true, epoch: state.epoch + 1 } };
  return { outcome: 'CONDITION_STILL_MET', met, triggerKey: null, state };
}
/** A crossing consumed without a proposal (a limit refused it): disarmed like a trigger, no cooldown, no occurrence. */
export const consumeCrossing = (state: TriggerState): TriggerState => ({ ...state, armed: false });

export function validTriggerState(value: unknown): value is TriggerState {
  const s = value as Partial<TriggerState> | null;
  return !!s && typeof s === 'object' && (s.armed === null || typeof s.armed === 'boolean') && Number.isSafeInteger(s.epoch) && s.epoch! >= 0
    && (s.cooldownUntil === null || (typeof s.cooldownUntil === 'string' && !Number.isNaN(Date.parse(s.cooldownUntil))))
    && (s.lastTriggeredAt === null || (typeof s.lastTriggeredAt === 'string' && !Number.isNaN(Date.parse(s.lastTriggeredAt))));
}

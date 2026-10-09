// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { formatScaled, parseScaled, PRICE_SCALE } from './decimal.ts';
import { conditionMet, conditionThreshold, INITIAL_TRIGGER_STATE, stepTrigger, type PriceCondition, type TriggerState, type TriggerStep } from './trigger.ts';

const price = (value: string) => parseScaled(value, PRICE_SCALE)!;
const point = (priceUsd: string) => ({ priceUsd, observedAt: '2026-10-08T10:00:00.000Z' });
const below3000: PriceCondition = { type: 'PRICE_BELOW', asset: 'ETH', threshold: '3000' };
/** Feeds observations in order and returns every step's outcome and key. */
function run(condition: PriceCondition, prices: readonly (string | null)[], cooldownMs = 0, start: TriggerState = INITIAL_TRIGGER_STATE) {
  let state = start, now = Date.parse('2026-10-08T10:00:00Z');
  const steps: TriggerStep[] = [];
  for (const p of prices) {
    const step = stepTrigger(condition, state, p === null ? null : point(p), p !== null, now, cooldownMs);
    steps.push(step); state = step.state; now += 15 * 60_000;
  }
  return { steps, outcomes: steps.map(s => s.outcome), keys: steps.map(s => s.triggerKey).filter(Boolean), state };
}

describe('BUILD-AUTOMATION-001 deterministic price conditions', () => {
  it('compares absolute thresholds strictly and percentage thresholds against the reference, in exact integers', () => {
    expect(conditionMet(below3000, price('2999.99999999'))).toBe(true);
    expect(conditionMet(below3000, price('3000'))).toBe(false);
    expect(conditionMet({ type: 'PRICE_ABOVE', asset: 'ETH', threshold: '5000' }, price('5000.00000001'))).toBe(true);
    expect(conditionMet({ type: 'PRICE_ABOVE', asset: 'ETH', threshold: '5000' }, price('5000'))).toBe(false);
    const drop: PriceCondition = { type: 'PERCENT_DROP', asset: 'BTC', reference: '100000', percent: '5' };
    expect(formatScaled(conditionThreshold(drop), PRICE_SCALE)).toBe('95000');
    expect(conditionMet(drop, price('95000'))).toBe(true);
    expect(conditionMet(drop, price('95000.00000001'))).toBe(false);
    const rise: PriceCondition = { type: 'PERCENT_RISE', asset: 'SOL', reference: '123.45', percent: '2.5' };
    expect(formatScaled(conditionThreshold(rise), PRICE_SCALE)).toBe('126.53625');
    expect(conditionMet(rise, price('126.53625'))).toBe(true);
    // Rounding is conservative: a drop needs at least the full percentage, a rise at least the full rise.
    expect(conditionThreshold({ type: 'PERCENT_DROP', asset: 'ETH', reference: '0.00000003', percent: '50' })).toBe(1n);
    expect(conditionThreshold({ type: 'PERCENT_RISE', asset: 'ETH', reference: '0.00000003', percent: '50' })).toBe(5n);
  });

  it('refuses malformed or degenerate conditions', () => {
    for (const bad of [{ ...below3000, threshold: '0' }, { ...below3000, threshold: '-1' }, { ...below3000, threshold: '1e3' }, { ...below3000, threshold: '1.123456789' },
      { type: 'PERCENT_DROP', asset: 'ETH', reference: '100', percent: '100' }, { type: 'PERCENT_DROP', asset: 'ETH', reference: '100', percent: '0' },
      { type: 'PERCENT_RISE', asset: 'ETH', reference: '100', percent: '1000.01' }] as PriceCondition[]) expect(() => conditionThreshold(bad)).toThrow('AUTOMATION_CONDITION_INVALID');
  });

  it('fires once on the crossing: above → below triggers, staying below never fires again', () => {
    const { outcomes, keys } = run(below3000, ['3100', '2950', '2900', '2800', '2700', '2999', '2500', '2600', '2900', '2950', '2990', '2000']);
    expect(outcomes).toEqual(['ARMED', 'TRIGGERED', ...Array(10).fill('CONDITION_STILL_MET')]);
    expect(keys).toEqual(['price:1']);
  });

  it('re-arms only when the condition clears, giving the next crossing a new identity', () => {
    const { outcomes, keys } = run(below3000, ['3100', '2950', '3000', '3050', '2990', '3200', '2999']);
    expect(outcomes).toEqual(['ARMED', 'TRIGGERED', 'REARMED', 'CONDITION_NOT_MET', 'TRIGGERED', 'REARMED', 'TRIGGERED']);
    expect(keys).toEqual(['price:1', 'price:2', 'price:3']);
  });

  it('waits for a crossing when the condition is already met at creation', () => {
    const { outcomes, keys } = run(below3000, ['2900', '2800', '3100', '2950']);
    expect(outcomes).toEqual(['CONDITION_ALREADY_MET', 'CONDITION_STILL_MET', 'REARMED', 'TRIGGERED']);
    expect(keys).toEqual(['price:1']);
  });

  it('consumes a crossing inside the cooldown instead of firing in a burst afterwards', () => {
    // Checks are 15 minutes apart; the cooldown is one hour.
    const { outcomes, keys } = run(below3000, ['3100', '2950', '3100', '2950', '2900', '2900', '2900', '3100', '2950'], 60 * 60_000);
    expect(outcomes).toEqual(['ARMED', 'TRIGGERED', 'REARMED', 'COOLDOWN', 'CONDITION_STILL_MET', 'CONDITION_STILL_MET', 'CONDITION_STILL_MET', 'REARMED', 'TRIGGERED']);
    expect(keys).toEqual(['price:1', 'price:3']);
  });

  it('changes nothing on a missing, stale or malformed observation', () => {
    const armed = run(below3000, ['3100']).state;
    for (const stale of [null, point('2900')]) {
      const step = stepTrigger(below3000, armed, stale, false, Date.now(), 0);
      expect(step).toEqual({ outcome: 'OBSERVATION_STALE', state: armed, triggerKey: null, met: null });
    }
    expect(stepTrigger(below3000, armed, point('abc'), true, Date.now(), 0).outcome).toBe('OBSERVATION_STALE');
    expect(stepTrigger(below3000, armed, point('0'), true, Date.now(), 0).outcome).toBe('OBSERVATION_STALE');
    const { outcomes } = run(below3000, ['3100', null, null, '2950']);
    expect(outcomes).toEqual(['ARMED', 'OBSERVATION_STALE', 'OBSERVATION_STALE', 'TRIGGERED']);
  });

  it('handles rises and percentage drops with the same edge semantics', () => {
    expect(run({ type: 'PRICE_ABOVE', asset: 'ETH', threshold: '5000' }, ['4900', '5100', '5200', '4999', '5001']).keys).toEqual(['price:1', 'price:2']);
    expect(run({ type: 'PERCENT_DROP', asset: 'BTC', reference: '100000', percent: '5' }, ['99000', '96000', '95000', '94000', '97000', '90000']).outcomes)
      .toEqual(['ARMED', 'CONDITION_NOT_MET', 'TRIGGERED', 'CONDITION_STILL_MET', 'REARMED', 'TRIGGERED']);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: one evaluation of one rule — the body of the `automation.evaluate` work item, run by whichever worker claims
 * it (the scheduler endpoint's drain or the Railway worker). Delivery is at least once; the outcome is at most one occurrence per
 * trigger event.
 *
 *   phase 1 (no lock)    load the rule; for price and watch rules make the read-only observations (bounded, classified failures)
 *   phase 2 (locked)     `store.evaluate`: re-check ACTIVE and due under the rule's row lock, then decide here with reads made in that
 *                        transaction — binding drift, schedule slot (missed-run policy), trigger step, limits — and commit the rule's
 *                        new state, the occurrence (unique trigger key), history and the notification work item atomically
 *
 * A crash before the commit changes nothing (the retried item evaluates again); after it, the retried item finds the rule advanced
 * and does nothing. A paused, archived, expired or rebound rule is re-checked under the lock, so a queued evaluation cannot act on it.
 *
 * This module holds no key and has no way to sign, submit or approve anything: it writes proposals for the owner, nothing else.
 */
import { routeStrategyLabel } from './labels.ts';
import { spendOf } from './assets.ts';
import { singleStrategy, sourceDrift, verifyBinding } from './binding.ts';
import { limitPeriods, occurrenceViolation } from './limits.ts';
import type { AutomationLogger } from './log.ts';
import { observationFresh, type PriceObservation, type PriceResult, type PriceSource } from './price-source.ts';
import { dueAt, latestSlotAtOrBefore, nextPriceCheck, periodStart, type Schedule } from './schedule.ts';
import type { Attention, AutomationStore, EvaluationCommit, EvaluationReads, EvaluationResult, NewEvaluation, NewOccurrence, RuleRecord } from './store.ts';
import { stepTrigger, validTriggerState, INITIAL_TRIGGER_STATE, type ObservedAsset, type TriggerState } from './trigger.ts';

export type EvaluatorDeps = { readonly store: AutomationStore; readonly price: PriceSource; readonly log: AutomationLogger; readonly now: () => Date;
  readonly newId: (prefix: 'occ') => string };
/** How long an occurrence waits for its owner. */
export const OCCURRENCE_TTL = Object.freeze({ scheduleMaxMs: 24 * 3_600_000, priceMs: 6 * 3_600_000 });

/** The public part of an observation that history and notifications may keep. */
export const observationView = (o: PriceObservation) => ({ asset: o.asset, priceUsd: o.priceUsd, observedAt: o.observedAt, source: o.source, evidence: o.evidence,
  ...o.provenance.feed ? { feed: o.provenance.feed, roundId: o.provenance.roundId ?? null, chainId: o.provenance.chainId ?? null } : {} });

/** Binding and source checks; null when the rule may propose. */
async function attentionOf(rule: RuleRecord, reads: EvaluationReads): Promise<Attention | null> {
  if (!rule.binding) return null;
  if (!verifyBinding(rule.binding, { multiStep: rule.executionMode === 'DELEGATED_WITH_LIMITS' }).ok) return 'STRATEGY_STALE';
  if (rule.binding.source && sourceDrift(rule.binding.source, await reads.source(rule.owner, rule.binding.source))) return 'WORKFLOW_CHANGED';
  return null;
}
/** Limits for one more occurrence of `rule` at `now`; null when they hold. */
export async function limitViolation(rule: RuleRecord, reads: EvaluationReads, now: Date, except?: string): Promise<string | null> {
  const limits = rule.definition.limits, periods = limitPeriods(limits), tz = rule.timezone;
  const usage = await reads.usage({ amount: periods.amount ? new Date(periodStart(periods.amount, now.getTime(), tz)) : null,
    count: periods.count ? new Date(periodStart(periods.count, now.getTime(), tz)) : null }, except);
  const strategy = singleStrategy(rule.binding?.strategy ?? null);
  return occurrenceViolation(limits, strategy ? spendOf(strategy) : null, strategy && strategy.action === 'swap' ? strategy.slippageBps ?? null : null, usage, now.getTime());
}

function occurrenceOf(deps: EvaluatorDeps, rule: RuleRecord, kind: NewOccurrence['kind'], triggerKey: string, dueAtMs: number, expiresAtMs: number,
  observation: Readonly<Record<string, unknown>> | null): NewOccurrence {
  const strategy = kind === 'WATCH' ? null : rule.binding?.strategy ?? null;
  const single = singleStrategy(strategy);
  return { occurrenceId: deps.newId('occ'), triggerKey, kind, strategy, workflowHash: strategy ? rule.binding!.workflowHash : null,
    spend: single ? spendOf(single) : null, observation, dueAt: new Date(dueAtMs), expiresAt: new Date(expiresAtMs) };
}

/** Scheduled DCA and daily watch: the missed-run policy, then (when due) one proposal or report for the latest slot. */
async function scheduled(deps: EvaluatorDeps, rule: RuleRecord, reads: EvaluationReads, now: Date, watch: ReadonlyMap<ObservedAsset, PriceResult>): Promise<EvaluationCommit> {
  const schedule = rule.definition.schedule as Schedule, since = (rule.scheduleCursor ?? rule.createdAt).getTime();
  const decision = dueAt(schedule, since, now.getTime());
  if (decision.kind === 'NOT_DUE') return { nextEvaluationAt: new Date(decision.next.at), lastOutcome: 'NOT_DUE', evaluations: [] };
  const evaluations: NewEvaluation[] = [], missed = decision.missed;
  if (missed > 0) evaluations.push({ at: now, outcome: 'MISSED', triggerKey: null, occurrenceId: null, observation: null, detail: { count: missed, policy: 'LATEST_WITHIN_GRACE' } });
  if (decision.kind === 'MISSED') {
    // Every slot up to now is handled: none of them will ever be proposed.
    return { nextEvaluationAt: new Date(decision.next.at), scheduleCursor: new Date(latestSlotAtOrBefore(schedule, now.getTime())!.at), lastOutcome: 'MISSED', evaluations };
  }
  const slot = decision.slot, next = new Date(decision.next.at), cursor = new Date(slot.at), expires = Math.min(decision.next.at, slot.at + OCCURRENCE_TTL.scheduleMaxMs);
  if (rule.kind === 'DAILY_WATCH') {
    const previous = (rule.lastObservation as { assets?: Record<string, { priceUsd: string; observedAt: string }> } | null)?.assets ?? {};
    const assets: Record<string, unknown>[] = [], current: Record<string, { priceUsd: string; observedAt: string }> = {};
    for (const asset of rule.definition.watch?.assets ?? []) {
      const result = watch.get(asset);
      if (result?.ok && observationFresh(result.observation, now, deps.price.maxAgeMs)) {
        const prior = previous[asset];
        assets.push({ ...observationView(result.observation), previousPriceUsd: prior?.priceUsd ?? null, previousObservedAt: prior?.observedAt ?? null });
        current[asset] = { priceUsd: result.observation.priceUsd, observedAt: result.observation.observedAt };
      } else assets.push({ asset, code: result && !result.ok ? result.code : 'PRICE_STALE' });
    }
    const occurrence = occurrenceOf(deps, rule, 'WATCH', `watch:${slot.key}`, slot.at, expires, { assets });
    evaluations.push({ at: now, outcome: 'WATCH_REPORTED', triggerKey: occurrence.triggerKey, occurrenceId: occurrence.occurrenceId, observation: { assets }, detail: null });
    return { nextEvaluationAt: next, scheduleCursor: cursor, lastOutcome: 'WATCH_REPORTED', lastObservation: { assets: { ...previous, ...current } }, occurrence, evaluations };
  }
  const triggerKey = `slot:${slot.key}`, attention = await attentionOf(rule, reads);
  if (attention) {
    evaluations.push({ at: now, outcome: attention, triggerKey, occurrenceId: null, observation: null, detail: null });
    return { nextEvaluationAt: next, scheduleCursor: cursor, lastOutcome: attention, attention, evaluations };
  }
  const violation = await limitViolation(rule, reads, now);
  if (violation) {
    evaluations.push({ at: now, outcome: 'LIMIT_BLOCKED', triggerKey, occurrenceId: null, observation: null, detail: { code: violation } });
    return { nextEvaluationAt: next, scheduleCursor: cursor, lastOutcome: 'LIMIT_BLOCKED', evaluations };
  }
  const occurrence = occurrenceOf(deps, rule, 'SCHEDULE', triggerKey, slot.at, expires, null);
  evaluations.push({ at: now, outcome: 'TRIGGERED', triggerKey, occurrenceId: occurrence.occurrenceId, observation: null, detail: { action: routeStrategyLabel(singleStrategy(occurrence.strategy)) } });
  return { nextEvaluationAt: next, scheduleCursor: cursor, lastOutcome: 'TRIGGERED', occurrence, evaluations };
}

/** A price rule: one trigger step on a fresh observation, then (on a crossing) one proposal unless a binding check or limit consumes it. */
async function priced(deps: EvaluatorDeps, rule: RuleRecord, reads: EvaluationReads, now: Date, result: PriceResult | null): Promise<EvaluationCommit> {
  const condition = rule.definition.condition!, next = new Date(nextPriceCheck(now.getTime(), condition.checkEveryMinutes));
  const prior: TriggerState = validTriggerState(rule.triggerState) ? rule.triggerState : INITIAL_TRIGGER_STATE;
  const fresh = !!result?.ok && observationFresh(result.observation, now, deps.price.maxAgeMs);
  const step = stepTrigger(condition, prior, result?.ok ? result.observation : null, fresh, now.getTime(), rule.definition.limits.cooldownMinutes * 60_000);
  const view = result?.ok ? observationView(result.observation) : null;
  const failure = !result ? 'PRICE_SOURCE_OFF' : !result.ok ? result.code : !fresh ? 'PRICE_STALE' : null;
  const changed = rule.lastOutcome !== (failure ?? step.outcome);
  const evaluations: NewEvaluation[] = [];
  const base = { nextEvaluationAt: next, triggerState: step.state, ...view ? { lastObservation: view } : {} };
  if (step.outcome !== 'TRIGGERED') {
    // Repeated identical outcomes (still met, still not met, the same failure) are not history: only changes are.
    if (changed) evaluations.push({ at: now, outcome: failure ?? step.outcome, triggerKey: null, occurrenceId: null, observation: view, detail: failure ? { code: failure } : null });
    return { ...base, lastOutcome: failure ?? step.outcome, evaluations };
  }
  const triggerKey = step.triggerKey!, attention = await attentionOf(rule, reads);
  if (attention) {
    evaluations.push({ at: now, outcome: attention, triggerKey, occurrenceId: null, observation: view, detail: null });
    return { ...base, lastOutcome: attention, attention, evaluations };
  }
  const violation = await limitViolation(rule, reads, now);
  if (violation) {
    evaluations.push({ at: now, outcome: 'LIMIT_BLOCKED', triggerKey, occurrenceId: null, observation: view, detail: { code: violation } });
    return { ...base, lastOutcome: 'LIMIT_BLOCKED', evaluations };
  }
  const occurrence = occurrenceOf(deps, rule, 'PRICE', triggerKey, now.getTime(), now.getTime() + OCCURRENCE_TTL.priceMs, view);
  evaluations.push({ at: now, outcome: 'TRIGGERED', triggerKey, occurrenceId: occurrence.occurrenceId, observation: view,
    detail: { action: routeStrategyLabel(singleStrategy(occurrence.strategy)) } });
  return { ...base, lastOutcome: 'TRIGGERED', occurrence, evaluations };
}

export type EvaluationReport = EvaluationResult | { readonly kind: 'FAILED'; readonly code: string };
/** Evaluates one rule now (phase 1 and phase 2). Throws only for infrastructure failures, which the work item retries. */
export async function evaluateRule(deps: EvaluatorDeps, ruleId: string): Promise<EvaluationReport> {
  const now = deps.now(), started = performance.now();
  const rule = await deps.store.ruleById(ruleId);
  if (!rule) return { kind: 'SKIPPED', reason: 'NOT_FOUND' };
  if (rule.state !== 'ACTIVE' || !rule.nextEvaluationAt || rule.nextEvaluationAt > now) return { kind: 'SKIPPED', reason: rule.state !== 'ACTIVE' ? 'NOT_ACTIVE' : 'NOT_DUE' };
  // Phase 1: read-only observations, outside any transaction (never holding a lock across the network).
  let price: PriceResult | null = null;
  const watch = new Map<ObservedAsset, PriceResult>();
  if (rule.kind === 'PRICE_TRIGGER' && rule.definition.condition) price = deps.price.id === 'off' ? null : await deps.price.observe(rule.definition.condition.asset, now);
  if (rule.kind === 'DAILY_WATCH' && rule.definition.schedule && dueAt(rule.definition.schedule, (rule.scheduleCursor ?? rule.createdAt).getTime(), now.getTime()).kind === 'DUE')
    for (const asset of rule.definition.watch?.assets ?? []) watch.set(asset, await deps.price.observe(asset, now));
  // Phase 2: the locked decision and its atomic commit.
  const result = await deps.store.evaluate(ruleId, now, async (locked, reads) => locked.kind === 'PRICE_TRIGGER' ? priced(deps, locked, reads, now, price)
    : scheduled(deps, locked, reads, now, watch));
  const duration_ms = Math.round(performance.now() - started);
  if (result.kind === 'SKIPPED') { deps.log.info('automation.evaluated', { rule: ruleId, outcome: `SKIPPED_${result.reason}`, duration_ms }); return result; }
  deps.log.info('automation.evaluated', { rule: ruleId, kind: rule.kind, outcome: result.rule.lastOutcome, duration_ms, duplicate: result.duplicate,
    ...price?.ok ? { source: price.observation.source.toLowerCase(), evidence: price.observation.evidence } : price ? { code: price.code } : {} });
  if (result.occurrence) {
    deps.log.info('automation.trigger_matched', { rule: ruleId, kind: result.occurrence.kind, occurrence: result.occurrence.occurrenceId });
    deps.log.info('automation.occurrence_created', { rule: ruleId, occurrence: result.occurrence.occurrenceId, state: result.occurrence.state });
  } else if (result.rule.lastOutcome === 'CONDITION_NOT_MET' && rule.lastOutcome !== 'CONDITION_NOT_MET') deps.log.info('automation.condition_not_met', { rule: ruleId });
  if (result.rule.state === 'EXPIRED') deps.log.info('automation.expired', { rule: ruleId });
  return result;
}

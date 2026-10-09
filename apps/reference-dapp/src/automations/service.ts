// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the owner's automation operations. Every call names the owner whose wallet session the caller verified
 * (`automation-action.ts`); every store query is scoped to that owner. Nothing here signs, submits, claims or applies anything:
 *
 *   create        validate the closed input; bind the action BY VALUE to its canonical StrategySpec and workflow hash (from a route or
 *                 a saved single-swap workflow, whose id/hash/version are recorded); check the binding limits, the price source and
 *                 that this deployment would hand the action to its owner at all (supported by code, enabled, allowed by policy)
 *   open          an open occurrence → re-verify the binding and the source workflow, request a handoff on the SHARED approval model
 *                 (authority NONE), then attach it under the rule lock with the limits re-checked; the owner continues on /approve
 *                 (wallet proof, fresh simulation, Strategy Manifest Review, own signature). The previous handoff is withdrawn
 *                 first; if the owner already applied it, the occurrence is completed instead (one occurrence, one proposal)
 *   dismiss       the owner declines: its handoff is withdrawn first (an applied one completes the occurrence instead), then it ends
 *   watch         Buy / Sell on a watch report prepares FloFi's ordinary authoring command for the owner's own Build draft
 *                 (Apply proposal → Simulate → Review → sign); it is the owner's manual action, never an automated proposal
 *   rebind        the owner's explicit acceptance of a changed saved workflow (or re-composition after an engine change), re-checked
 *                 against the limits; proposals made under the old binding are withdrawn
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { savedWorkflowHash } from '../domain/saved-workflow.ts';
import { composeWorkflowBound, NETWORKS } from '../engine/strategy-engine';
import type { StrategySpec } from '../engine/strategy-spec';
import { evaluateWorkflowGates, requestApproval, sharedRuns, type EngineRuntime, type HandoffRecord, type HandoffStore, type WindowLimit } from '../platform/index.ts';
import { createSavedWorkflowStore } from '../server/saved-workflow-store.ts';
import { automationApprovalScheme, automationRequester, AUTOMATION_HANDOFF_RULES, ruleScope, sameOwner } from './approval.ts';
import { EXECUTION_ROUTES, observedAssetOf, routeStrategy, sideOf, type Side } from './assets.ts';
import { bindStrategy, sourceDrift, strategyOfSavedWorkflow, verifyBinding, type Binding } from './binding.ts';
import type { AutomationConfig } from './config.ts';
import { validateAutomationInput, type ActionRequest } from './definition.ts';
import { formatScaled, PRICE_SCALE } from './decimal.ts';
import { limitViolation } from './evaluator.ts';
import { bindingViolation } from './limits.ts';
import type { AutomationLogger } from './log.ts';
import type { PriceSource } from './price-source.ts';
import { nextSlotAfter } from './schedule.ts';
import { MAX_RULES_PER_OWNER, OPEN_OCCURRENCE, type AutomationStore, type EvaluationRecord, type OccurrenceRecord, type Owner, type RuleRecord } from './store.ts';
import { createLinkCode, ownerBucket, targetsOf, unlinkOwner } from './subscriptions.ts';
import { conditionThreshold, OBSERVED_ASSETS, type ObservedAsset } from './trigger.ts';
import type { ActionView, CapabilityView, HistoryEntryView, LinkCodeView, ObservationView, OccurrenceView, OpenedView, OverviewView, RuleHistoryView, RuleView,
  RouteCapability } from './views.ts';

export type ServiceDeps = {
  readonly config: AutomationConfig; readonly db: Database; readonly store: AutomationStore; readonly handoffs: HandoffStore; readonly allow: WindowLimit;
  readonly runtime: EngineRuntime; readonly price: PriceSource; readonly log: AutomationLogger; readonly now: () => Date; readonly newId: (prefix: 'aut' | 'occ') => string;
  /** Whether a channel that can carry automation notifications (Telegram) is enabled on this deployment. */
  readonly telegramAvailable: boolean;
};
const refuse = (code: string): never => { throw new Error(code); };

// ── Views ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function actionView(strategy: StrategySpec | null): ActionView {
  if (!strategy || strategy.action !== 'swap') return null;
  return { network: strategy.network, networkLabel: NETWORKS[strategy.network].label, inputAsset: strategy.inputAsset, outputAsset: strategy.outputAsset,
    amount: strategy.amount, slippageBps: strategy.slippageBps ?? null, side: sideOf(strategy), fundsClass: NETWORKS[strategy.network].class === 'MAINNET' ? 'REAL_FUNDS' : 'TEST_FUNDS' };
}
function observations(raw: Readonly<Record<string, unknown>> | null): ObservationView[] {
  if (!raw) return [];
  if (Array.isArray((raw as { assets?: unknown }).assets)) return (raw as { assets: ObservationView[] }).assets;
  return typeof (raw as { asset?: unknown }).asset === 'string' ? [raw as ObservationView] : [];
}
export function ruleView(rule: RuleRecord, pending = 0): RuleView {
  const d = rule.definition, c = d.condition;
  return { ruleId: rule.ruleId, name: rule.name, kind: rule.kind, state: rule.state, executionMode: rule.executionMode, version: rule.version, timezone: rule.timezone,
    schedule: d.schedule ? { frequency: d.schedule.frequency, weekday: d.schedule.weekday, time: d.schedule.time } : null,
    condition: c ? { type: c.type, asset: c.asset, threshold: 'threshold' in c ? c.threshold : null, reference: 'reference' in c ? c.reference : null,
      percent: 'percent' in c ? c.percent : null, effectiveThreshold: formatScaled(conditionThreshold(c), PRICE_SCALE), checkEveryMinutes: c.checkEveryMinutes } : null,
    watch: d.watch ? { assets: [...d.watch.assets] } : null, limits: d.limits, action: actionView(rule.binding?.strategy ?? null),
    source: rule.binding?.source ? { workflowId: rule.binding.source.workflowId, version: rule.binding.source.version } : null,
    nextEvaluationAt: rule.state === 'ACTIVE' ? rule.nextEvaluationAt?.toISOString() ?? null : null, lastEvaluationAt: rule.lastEvaluationAt?.toISOString() ?? null,
    lastOutcome: rule.lastOutcome, lastObservation: rule.kind === 'PRICE_TRIGGER' ? observations(rule.lastObservation)[0] ?? null : null,
    armed: rule.kind === 'PRICE_TRIGGER' ? rule.triggerState.armed : null, attention: rule.attention, expiresAt: rule.expiresAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(), pending };
}
const historyView = (e: EvaluationRecord): HistoryEntryView => ({ at: e.at.toISOString(), outcome: e.outcome, occurrenceId: e.occurrenceId,
  observation: observations(e.observation)[0] ?? null, detail: e.detail });

export function createAutomationService(deps: ServiceDeps) {
  const { store, config } = deps;
  const scheme = automationApprovalScheme(config.keys);
  const savedWorkflows = (owner: Owner) => createSavedWorkflowStore(deps.db, config.tenantId, owner);

  async function gatesOf(strategy: StrategySpec) {
    const workflow = composeWorkflowBound(strategy, undefined);
    if (!workflow.ok) return { allowed: false, reason: workflow.code };
    const gates = await evaluateWorkflowGates(workflow, deps.runtime, config.policy);
    return { allowed: gates.handoff.allowed, reason: gates.handoff.reason };
  }
  /** The bound action of a request: a route, or a saved single-swap workflow of this owner (recorded by id, hash and version). */
  async function bind(owner: Owner, action: ActionRequest): Promise<Binding> {
    if (action.kind === 'ROUTE') {
      const route = routeStrategy(action);
      if (!route.ok) refuse(route.code);
      const bound = bindStrategy(route.ok ? route.strategy : null);
      return bound.ok ? bound.binding : refuse(bound.code);
    }
    const saved = await savedWorkflows(owner).get(action.workflowId) ?? refuse('WORKFLOW_NOT_FOUND');
    const derived = strategyOfSavedWorkflow(saved.workflow);
    if (!derived.ok) refuse(derived.code);
    const bound = bindStrategy(derived.ok ? derived.strategy : null, { workflowId: saved.workflowId, workflowHash: savedWorkflowHash(saved.workflow), version: saved.version });
    return bound.ok ? bound.binding : refuse(bound.code);
  }
  async function bindingAllowed(rule: Pick<RuleRecord, 'definition'>, binding: Binding) {
    const strategy = binding.strategy;
    const limit = bindingViolation(rule.definition.limits, strategy.action === 'swap' ? { asset: strategy.inputAsset, amount: strategy.amount } : null,
      strategy.action === 'swap' ? strategy.slippageBps ?? null : null);
    if (limit) refuse(limit);
    const gates = await gatesOf(strategy);
    if (!gates.allowed) refuse(gates.reason ?? 'AUTOMATION_ACTION_NOT_ENABLED');
  }

  /** The wallet namespace that must claim a strategy's approval (Solana networks need a Solana wallet). */
  const namespaceOf = (strategy: StrategySpec): Owner['namespace'] => strategy.action === 'swap' && strategy.network.startsWith('solana') ? 'solana' : 'eip155';
  async function capabilities(owner: Owner): Promise<CapabilityView> {
    const routes: RouteCapability[] = [], unavailable: { asset: ObservedAsset; code: string }[] = [];
    for (const asset of OBSERVED_ASSETS) {
      if (!EXECUTION_ROUTES[asset].length) { unavailable.push({ asset, code: `${asset}_EXECUTION_ROUTE_UNAVAILABLE` }); continue; }
      for (const route of EXECUTION_ROUTES[asset]) {
        const probe = routeStrategy({ asset, side: 'BUY', network: route.network, amount: '1', slippageBps: 50 });
        // Only the owner's own wallet can claim a proposal, so a route of another wallet namespace is never offered.
        const gates = !probe.ok ? { allowed: false, reason: probe.code } : namespaceOf(probe.strategy) !== owner.namespace
          ? { allowed: false, reason: 'AUTOMATION_WALLET_NAMESPACE_MISMATCH' } : await gatesOf(probe.strategy);
        routes.push({ asset, network: route.network, networkLabel: NETWORKS[route.network].label, quote: route.quote, base: route.base, executable: gates.allowed,
          reason: gates.reason, fundsClass: NETWORKS[route.network].class === 'MAINNET' ? 'REAL_FUNDS' : 'TEST_FUNDS' });
      }
    }
    return { priceSource: deps.price.id, priceEvidence: deps.price.id === 'chainlink' ? 'PUBLIC_READ_ONLY' : deps.price.id === 'fixture' ? 'MOCKED' : null,
      observable: [...deps.price.assets], routes, unavailable };
  }

  /** The owner's view of one occurrence: its approval state and, once applied, the runs of the owner's own wallet that reviewed exactly it. */
  async function occurrenceView(o: OccurrenceRecord, names: ReadonlyMap<string, string>, withProgress: boolean, notified: ReadonlyMap<string, OccurrenceView['notifications']>): Promise<OccurrenceView> {
    let approval: OccurrenceView['approval'] = null;
    if (o.handoffId && withProgress) {
      const h = await deps.handoffs.forRequester(o.handoffId, ruleScope(o.ruleId), deps.now());
      if (h) {
        if (h.status === 'APPLIED' && o.state === 'APPROVAL_CREATED') await store.completeApproval(o.occurrenceId, h.handoffId, deps.now()).catch(() => false);
        // The viewer IS the owner (a verified session) and the claim policy only lets the owner's wallet claim: reading the owner's own runs
        // needs no sharing choice. Runs of any other wallet are never read.
        const owned = h.claimed && sameOwner(o.owner, h.claimed) ? await sharedRuns({ ...h, shareStatus: true } as HandoffRecord, deps.runtime, deps.handoffs).catch(() => null) : null;
        approval = { status: h.status, runs: (owned ?? []).map(r => ({ executionId: r.executionId, status: r.status, reconciled: r.reconciled, terminal: r.terminal,
          errorCode: r.errorCode, evidenceEnvironment: r.evidenceEnvironment, evidenceOutcome: r.evidenceOutcome, evidenceBundleHash: r.evidenceBundleHash })) };
      }
    }
    const state = approval?.status === 'APPLIED' && o.state === 'APPROVAL_CREATED' ? 'COMPLETED' : o.state;
    return { occurrenceId: o.occurrenceId, ruleId: o.ruleId, ruleName: names.get(o.ruleId) ?? '', kind: o.kind, state, dueAt: o.dueAt.toISOString(), expiresAt: o.expiresAt.toISOString(),
      action: actionView(o.strategy), observations: observations(o.observation), outcome: o.outcome, decidedAt: o.decidedAt?.toISOString() ?? null, approval,
      notifications: notified.get(o.occurrenceId) ?? [] };
  }
  /**
   * Withdraws an occurrence's current handoff before the occurrence is proposed again or dismissed. Revocation is a transaction on the
   * shared handoff row, so a withdrawn handoff can no longer be claimed or applied; one the owner ALREADY applied means the occurrence
   * was used — it is completed (and keeps counting against the limits), never proposed or dismissed a second time. Fails closed.
   */
  async function withdraw(o: OccurrenceRecord, now: Date): Promise<void> {
    if (!o.handoffId) return;
    const h = await deps.handoffs.revokeForRequester(o.handoffId, ruleScope(o.ruleId), now);
    if (h?.status !== 'APPLIED') return;
    await store.completeApproval(o.occurrenceId, h.handoffId, now);
    refuse('AUTOMATION_OCCURRENCE_COMPLETED');
  }
  async function notificationsOf(owner: Owner, list: readonly OccurrenceRecord[]) {
    const map = new Map<string, { channel: string; status: string; code: string | null }[]>();
    for (const n of await store.notifications(owner, list.map(o => o.occurrenceId))) (map.get(n.occurrenceId) ?? map.set(n.occurrenceId, []).get(n.occurrenceId)!)
      .push({ channel: n.channel, status: n.status, code: n.code });
    return map;
  }

  return {
    async overview(owner: Owner): Promise<OverviewView> {
      const now = deps.now(), rules = await store.listRules(owner), names = new Map(rules.map(r => [r.ruleId, r.name]));
      const occurrences = await store.listOccurrences(owner, { limit: 60 }, now);
      const open = occurrences.filter(o => o.state === 'PENDING_OWNER' || o.state === 'APPROVAL_CREATED');
      const notified = await notificationsOf(owner, occurrences.slice(0, 30));
      const pending = await Promise.all(open.map(o => occurrenceView(o, names, true, notified)));
      const recent = await Promise.all(occurrences.filter(o => !open.includes(o)).slice(0, 20).map((o, i) => occurrenceView(o, names, i < 5 && o.handoffId !== null, notified)));
      const counts = new Map<string, number>();
      for (const o of pending) if (o.state === 'PENDING_OWNER' || o.state === 'APPROVAL_CREATED') counts.set(o.ruleId, (counts.get(o.ruleId) ?? 0) + 1);
      const linked = deps.telegramAvailable ? (await targetsOf(deps.db, config.tenantId, owner, now)).find(t => t.channel === 'TELEGRAM') ?? null : null;
      return { rules: rules.map(r => ruleView(r, counts.get(r.ruleId) ?? 0)), pending: pending.filter(o => o.state === 'PENDING_OWNER' || o.state === 'APPROVAL_CREATED'),
        recent: [...pending.filter(o => o.state === 'COMPLETED'), ...recent], capabilities: await capabilities(owner),
        telegram: { available: deps.telegramAvailable, linked: linked ? { expiresAt: linked.expiresAt.toISOString() } : null } };
    },

    async create(owner: Owner, input: unknown): Promise<RuleView> {
      const now = deps.now(), validated = validateAutomationInput(input, now.getTime());
      if (!validated.ok) refuse(validated.code);
      const v = validated.ok ? validated.value : refuse('AUTOMATION_INPUT_INVALID');
      const binding = v.action ? await bind(owner, v.action) : null;
      // Only the owner's own wallet can claim a proposal: its namespace must be the action's.
      if (binding && namespaceOf(binding.strategy) !== owner.namespace) refuse('AUTOMATION_WALLET_NAMESPACE_MISMATCH');
      if (binding) await bindingAllowed({ definition: v.definition }, binding);
      const condition = v.definition.condition;
      if (condition && binding) {
        // An action must trade the observed asset (an ETH condition never proposes a SOL swap, whatever the saved workflow holds).
        if (observedAssetOf(binding.strategy) !== condition.asset) refuse('AUTOMATION_ACTION_ASSET_MISMATCH');
      }
      for (const asset of condition ? [condition.asset] : v.definition.watch?.assets ?? []) if (!deps.price.assets.includes(asset)) refuse('PRICE_ASSET_NOT_OBSERVABLE');
      const schedule = v.definition.schedule;
      // Slots before creation never count as missed; a price rule observes at once (arming on its first fresh observation).
      const nextEvaluationAt = schedule ? new Date(nextSlotAfter(schedule, now.getTime()).at) : now;
      const rule = await store.createRule({ ruleId: deps.newId('aut'), owner, name: v.name, kind: v.kind, definition: v.definition, binding, timezone: v.timezone,
        expiresAt: v.expiresAt, nextEvaluationAt, scheduleCursor: schedule ? now : null }, now, MAX_RULES_PER_OWNER);
      deps.log.info('automation.created', { rule: rule.ruleId, kind: rule.kind });
      return ruleView(rule);
    },

    async setState(owner: Owner, ruleId: string, expectedVersion: number, action: 'PAUSE' | 'RESUME' | 'ARCHIVE'): Promise<RuleView> {
      const now = deps.now(), current = await store.getRule(owner, ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      const schedule = current.definition.schedule;
      const resume = action === 'RESUME' ? { nextEvaluationAt: schedule ? new Date(nextSlotAfter(schedule, now.getTime()).at) : now, scheduleCursor: schedule ? now : null } : undefined;
      const rule = await store.setState(owner, ruleId, expectedVersion, action === 'PAUSE' ? 'PAUSED' : action === 'RESUME' ? 'ACTIVE' : 'ARCHIVED', now, resume);
      if (action === 'ARCHIVE') for (const o of await store.listOccurrences(owner, { ruleId, limit: 50 }, now))
        if (o.handoffId) await deps.handoffs.revokeForRequester(o.handoffId, ruleScope(ruleId), now).catch(() => null);
      deps.log.info(action === 'PAUSE' ? 'automation.paused' : action === 'RESUME' ? 'automation.resumed' : 'automation.archived', { rule: ruleId, version: rule.version });
      return ruleView(rule);
    },

    async rebind(owner: Owner, ruleId: string, expectedVersion: number): Promise<RuleView> {
      const now = deps.now(), rule = await store.getRule(owner, ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      if (!rule.binding) refuse('AUTOMATION_ACTION_UNSUPPORTED');
      const binding = rule.binding!.source ? await bind(owner, { kind: 'SAVED_WORKFLOW', workflowId: rule.binding!.source.workflowId })
        : (() => { const b = bindStrategy(rule.binding!.strategy); return b.ok ? b.binding : refuse(b.code); })();
      await bindingAllowed(rule, binding);
      const updated = await store.rebind(owner, ruleId, expectedVersion, binding, now);
      for (const o of await store.listOccurrences(owner, { ruleId, limit: 50 }, now))
        if (o.handoffId) await deps.handoffs.revokeForRequester(o.handoffId, ruleScope(ruleId), now).catch(() => null);
      deps.log.info('automation.rebound', { rule: ruleId, version: updated.version });
      return ruleView(updated);
    },

    async history(owner: Owner, ruleId: string): Promise<RuleHistoryView> {
      const now = deps.now(), rule = await store.getRule(owner, ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      const [entries, list] = await Promise.all([store.history(owner, ruleId, 100), store.listOccurrences(owner, { ruleId, limit: 50 }, now)]);
      const names = new Map([[rule.ruleId, rule.name]]), notified = await notificationsOf(owner, list);
      return { rule: ruleView(rule), entries: entries.map(historyView), occurrences: await Promise.all(list.map((o, i) => occurrenceView(o, names, i < 10, notified))) };
    },

    /** The owner opens an occurrence for review: a fresh handoff on the shared approval model (see the module comment). */
    async open(owner: Owner, occurrenceId: string): Promise<OpenedView> {
      const now = deps.now(), o = await store.getOccurrence(owner, occurrenceId, now) ?? refuse('AUTOMATION_OCCURRENCE_NOT_FOUND');
      if (o.state !== 'PENDING_OWNER' && o.state !== 'APPROVAL_CREATED') refuse(`AUTOMATION_OCCURRENCE_${o.state}`);
      if (!o.strategy || !o.workflowHash) refuse('AUTOMATION_OCCURRENCE_HAS_NO_ACTION');
      const rule = await store.getRule(owner, o.ruleId) ?? refuse('AUTOMATION_NOT_FOUND');
      if (rule.state !== 'ACTIVE') refuse(rule.state === 'PAUSED' ? 'AUTOMATION_PAUSED' : `AUTOMATION_${rule.state}`);
      if (rule.attention) refuse(`AUTOMATION_${rule.attention}`);
      // The proposal is exactly the rule's current binding, which still reproduces, from an unchanged source workflow.
      if (!rule.binding || rule.binding.workflowHash !== o.workflowHash || !verifyBinding({ strategy: o.strategy!, workflowHash: o.workflowHash! }).ok) refuse('STRATEGY_STALE');
      if (rule.binding!.source) {
        const saved = await savedWorkflows(owner).get(rule.binding!.source.workflowId);
        if (sourceDrift(rule.binding!.source, saved ? { workflowHash: savedWorkflowHash(saved.workflow), version: saved.version } : null)) refuse('AUTOMATION_WORKFLOW_CHANGED');
      }
      // The previous handoff is withdrawn FIRST, so it can never be used alongside the new one (one occurrence, at most one proposal).
      await withdraw(o, now);
      const approval = await requestApproval({ origin: config.origin, scheme, handoffs: deps.handoffs, allow: deps.allow, runtime: deps.runtime, policy: config.policy,
        rules: AUTOMATION_HANDOFF_RULES, now }, automationRequester(rule, o), o.strategy, o.workflowHash!);
      if (!approval.ok) refuse(approval.code);
      const created = approval.ok ? approval.value : refuse('APPROVAL_FAILED');
      const attached = await store.attachHandoff(owner, occurrenceId, { handoffId: o.handoffId, ruleVersion: rule.version }, created.approvalId, now,
        async (locked, occurrence, reads) => {
          if (locked.binding?.source) {
            const current = await reads.source(owner, locked.binding.source);
            if (sourceDrift(locked.binding.source, current)) return 'AUTOMATION_WORKFLOW_CHANGED';
          }
          return limitViolation({ ...locked, binding: locked.binding }, reads, now, occurrence.occurrenceId).then(code => code === 'LIMIT_COOLDOWN' ? null : code);
        });
      if (!attached.ok) {
        await deps.handoffs.revokeForRequester(created.approvalId, ruleScope(rule.ruleId), now).catch(() => null);
        refuse(attached.code);
      }
      deps.log.info('automation.approval_requested', { rule: rule.ruleId, occurrence: occurrenceId, handoff: created.approvalId });
      return { approvalUrl: created.approvalUrl, expiresAt: created.expiresAt };
    },

    async dismiss(owner: Owner, occurrenceId: string): Promise<OccurrenceView> {
      const now = deps.now(), current = await store.getOccurrence(owner, occurrenceId, now) ?? refuse('AUTOMATION_OCCURRENCE_NOT_FOUND');
      if (!OPEN_OCCURRENCE.includes(current.state)) refuse(`AUTOMATION_OCCURRENCE_${current.state}`);
      // A proposal the owner already added to their workflow is not dismissed (it keeps counting against the limits).
      await withdraw(current, now);
      const o = await store.decide(owner, occurrenceId, 'DISMISSED', 'OWNER_DISMISSED', now, current.handoffId);
      deps.log.info('automation.dismissed', { rule: o.ruleId, occurrence: o.occurrenceId });
      return occurrenceView(o, new Map(), false, new Map());
    },

    /**
     * Buy or Sell on a watch report: FloFi's ordinary authoring command for the owner's own Build draft (then Apply, Simulate, Review,
     * sign), for an executable route of the observed asset. The report becomes COMPLETED; nothing is proposed on the owner's behalf.
     */
    async prepareWatchAction(owner: Owner, occurrenceId: string, request: { readonly asset: ObservedAsset; readonly side: Side; readonly network: string; readonly amount: string;
      readonly slippageBps: number }) {
      const now = deps.now(), o = await store.getOccurrence(owner, occurrenceId, now) ?? refuse('AUTOMATION_OCCURRENCE_NOT_FOUND');
      if (o.kind !== 'WATCH' || o.state !== 'PENDING_OWNER') refuse('AUTOMATION_OCCURRENCE_NOT_OPEN');
      const watched = observations(o.observation).map(a => a.asset);
      if (!OBSERVED_ASSETS.includes(request.asset) || !watched.includes(request.asset)) refuse('AUTOMATION_ASSET_NOT_WATCHED');
      const route = routeStrategy({ ...request, network: request.network as never });
      if (!route.ok) refuse(route.code);
      if (route.ok && namespaceOf(route.strategy) !== owner.namespace) refuse('AUTOMATION_WALLET_NAMESPACE_MISMATCH');
      const workflow = composeWorkflowBound(route.ok ? route.strategy : null, undefined);
      if (!workflow.ok || workflow.steps.length !== 1) refuse(workflow.ok ? 'AUTOMATION_ACTION_UNSUPPORTED' : workflow.code);
      const composition = workflow.ok ? workflow.steps[0]! : refuse('AUTOMATION_ACTION_UNSUPPORTED');
      const gates = await gatesOf(composition.strategy);
      if (!gates.allowed) refuse(gates.reason ?? 'AUTOMATION_ACTION_NOT_ENABLED');
      await store.decide(owner, occurrenceId, 'COMPLETED', request.side === 'BUY' ? 'OWNER_PREPARED_BUY' : 'OWNER_PREPARED_SELL', now);
      return { command: composition.command, workflowHash: composition.workflowHash, summary: composition.summary };
    },

    async telegramLinkCode(owner: Owner): Promise<LinkCodeView> {
      if (!deps.telegramAvailable) refuse('AUTOMATION_CHAT_NOTIFICATIONS_UNAVAILABLE');
      const now = deps.now();
      if (!await deps.allow(ownerBucket(config.keys, owner), 5, 3_600, now)) refuse('AUTOMATION_LINK_RATE_LIMITED');
      const { code, expiresAt } = await createLinkCode(deps.db, config.tenantId, config.keys, owner, now);
      return { code, expiresAt: expiresAt.toISOString(), command: `automations ${code}` };
    },
    async telegramUnlink(owner: Owner): Promise<{ readonly unlinked: boolean }> {
      return { unlinked: await unlinkOwner(deps.db, config.tenantId, owner, 'TELEGRAM') };
    },
  };
}
export type AutomationService = ReturnType<typeof createAutomationService>;

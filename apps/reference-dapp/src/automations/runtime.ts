// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the wiring shared by every automation entry point (the owner's server actions, the scheduler endpoint, the
 * Railway worker): the deployment's embedded PostgreSQL host (never memory, files or /tmp), the store, the shared platform's handoff
 * store / abuse limiter / runtime, the configured price source, and — when Telegram runs here — the Channel Core notifier.
 * Nothing wired here can sign or submit: the price transport is read-only and no execution flow is reachable from the handlers.
 */
import { randomBytes } from 'node:crypto';
import type { Database, Logger, WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { createPgChannelStore } from '../channels/core/pg-store.ts';
import { channelLogger, type ChannelLogSink } from '../channels/core/log.ts';
import { notifySubscriber } from '../channels/core/subscriber.ts';
import { channelProviders, type ProviderSeams } from '../channels/providers.ts';
import { readChannelDeployment } from '../channels/registry.ts';
import { createPgHandoffStore, deploymentEngineRuntime, fixedWindow, typedId, type EngineRuntime, type HandoffStore, type WindowLimit } from '../platform/index.ts';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { priceSourceOf, type AutomationConfig } from './config.ts';
import { evaluateRule, type EvaluatorDeps } from './evaluator.ts';
import type { AutomationLogger } from './log.ts';
import { notifyOccurrence, type ChannelNotifier } from './notify.ts';
import { createPgAutomationStore } from './pg-store.ts';
import type { PriceSource } from './price-source.ts';
import type { AutomationStore } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type AutomationHost = { readonly db: Database; readonly tenantId: string };
export const AUTOMATION_WORK_KINDS = Object.freeze(['automation.evaluate', 'automation.notify'] as const);

/** The embedded runtime's database for this deployment's tenant, or a closed code (never a fallback store). */
export async function automationHost(env: Env, config: AutomationConfig, host?: AutomationHost): Promise<AutomationHost | { readonly code: string }> {
  let resolved = host;
  if (!resolved) {
    if (flowRuntimeKind(env) !== 'embedded') return { code: 'AUTOMATION_STORE_UNAVAILABLE' };
    try { const runtime = await embeddedRuntime(env); resolved = { db: runtime.db, tenantId: runtime.tenantId }; } catch { return { code: 'AUTOMATION_STORE_UNAVAILABLE' }; }
  }
  if (resolved.tenantId !== config.tenantId) return { code: 'AUTOMATION_STORE_UNAVAILABLE' };
  if (!await createPgAutomationStore(resolved.db, resolved.tenantId).schemaInstalled().catch(() => false)) return { code: 'AUTOMATION_SCHEMA_NOT_INSTALLED' };
  return resolved;
}

export type AutomationSeams = { readonly runtime?: EngineRuntime; readonly price?: PriceSource; readonly channelSeams?: ProviderSeams; readonly channelLog?: ChannelLogSink | null;
  readonly fetch?: typeof fetch };
/** The Telegram notifier of this deployment (same tenant), or null when Telegram does not run here. */
export function channelNotifier(env: Env, host: AutomationHost, now: () => Date, seams: AutomationSeams = {}): ChannelNotifier | null {
  const result = readChannelDeployment(env);
  if (!result.ok || !result.deployment.telegram || result.deployment.core.tenantId !== host.tenantId) return null;
  const { core } = result.deployment, adapter = channelProviders(result.deployment, seams.channelSeams).adapters.get('TELEGRAM');
  if (!adapter) return null;
  const store = createPgChannelStore(host.db, host.tenantId), handoffs = createPgHandoffStore(host.db, host.tenantId);
  return { channel: 'TELEGRAM', send: (conversationId, dedupeKey, reply) => notifySubscriber({ tenantId: core.tenantId, origin: core.origin, keys: core.keys, store, adapter,
    handoffs, log: channelLogger(seams.channelLog ?? null), now, fallbackLanguage: core.language }, conversationId, dedupeKey, reply) };
}

export type AutomationRuntime = { readonly config: AutomationConfig; readonly host: AutomationHost; readonly store: AutomationStore; readonly handoffs: HandoffStore;
  readonly allow: WindowLimit; readonly engine: EngineRuntime; readonly price: PriceSource; readonly notifier: ChannelNotifier | null; readonly log: AutomationLogger;
  readonly now: () => Date };
export function automationRuntime(env: Env, config: AutomationConfig, host: AutomationHost, log: AutomationLogger, now: () => Date, seams: AutomationSeams = {}): AutomationRuntime {
  return { config, host, store: createPgAutomationStore(host.db, host.tenantId), handoffs: createPgHandoffStore(host.db, host.tenantId), allow: fixedWindow(host.db, host.tenantId).allow,
    engine: seams.runtime ?? deploymentEngineRuntime(env), price: seams.price ?? priceSourceOf(config.price, seams.fetch), notifier: channelNotifier(env, host, now, seams), log, now };
}

export const newAutomationId = (prefix: 'aut' | 'occ') => typedId(prefix);
/** The work handlers of automations (the same in the scheduler endpoint's drain and in the Railway worker). */
export function automationHandlers(rt: AutomationRuntime): Record<(typeof AUTOMATION_WORK_KINDS)[number], WorkHandler> {
  const evaluator: EvaluatorDeps = { store: rt.store, price: rt.price, log: rt.log, now: rt.now, newId: newAutomationId };
  return {
    'automation.evaluate': async (item, settle) => {
      const ruleId = item.payload.ruleId;
      if (typeof ruleId !== 'string' || !/^aut_[a-z2-7]{26}$/.test(ruleId)) { await settle({ outcome: 'DEAD', reason: 'WORK_PAYLOAD_INVALID' }); return; }
      await evaluateRule(evaluator, ruleId);
      await settle({ outcome: 'DONE' });
    },
    'automation.notify': async (item, settle) => {
      const occurrenceId = item.payload.occurrenceId;
      if (typeof occurrenceId !== 'string' || !/^occ_[a-z2-7]{26}$/.test(occurrenceId)) { await settle({ outcome: 'DEAD', reason: 'WORK_PAYLOAD_INVALID' }); return; }
      await notifyOccurrence({ store: rt.store, db: rt.host.db, tenantId: rt.host.tenantId, origin: rt.config.origin, log: rt.log, now: rt.now, notifier: rt.notifier }, occurrenceId);
      await settle({ outcome: 'DONE' });
    },
  };
}
/** A worker id for one scheduler call (diagnostics only; leases come from the database). */
export const dispatchWorkerId = (env: Env) => `automation-${(env.VERCEL_DEPLOYMENT_ID ?? 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'local'}-${randomBytes(4).toString('hex')}`;
export type { Logger };

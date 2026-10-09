// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: automations hosted by the Railway worker (`backend/main.ts worker`, via `backend/automation-worker.ts`).
 *
 *   discovery   the worker's sweep (every 60 s) runs `sweepAutomations`: expire, enqueue due rules, sync approvals, retention — the
 *               scheduler heartbeat, with no cron, no plan upgrade and no new service
 *   processing  the worker's own claim loop runs `automation.evaluate` (and `automation.notify` when Telegram is configured on this
 *               process); the same fenced leases, deduplication and retries as every other work item
 *
 * It needs no FLOFI_AUTOMATION_SECRET (`readAutomationWorkerConfig`) and no engine runtime: nothing here can run a flow, mint an approval,
 * sign or submit. The protected `/api/automations/dispatch` endpoint stays available for deployments without a worker (Previews), and
 * both may run at once: every step is idempotent.
 */
import type { Database, Logger, WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { readAutomationWorkerConfig } from './config.ts';
import { sweepAutomations } from './dispatch.ts';
import { automationLogger } from './log.ts';
import { automationHandlers, automationWorkRuntime, type AutomationSeams } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type AutomationWorkerParts = { readonly handlers: Readonly<Record<string, WorkHandler>>; readonly sweep: () => Promise<unknown>; readonly telegram: boolean };
/** `seams` are the tests' clock, price source and Bot API double; production passes none. */
export function automationWorkerParts(env: Env, db: Database, tenantId: string, logger: Logger,
  seams: AutomationSeams & { readonly now?: () => Date } = {}): AutomationWorkerParts | { readonly disabled: string; readonly reason: string | null } {
  const config = readAutomationWorkerConfig(env);
  if (!config.enabled) return { disabled: config.code, reason: 'reason' in config ? config.reason ?? null : null };
  if (config.tenantId !== tenantId) return { disabled: 'AUTOMATION_TENANT_MISMATCH', reason: null };
  const rt = automationWorkRuntime(env, config, { db, tenantId }, automationLogger(logger), seams.now ?? (() => new Date()), seams);
  const all = automationHandlers(rt);
  // Telegram delivery needs the Channels configuration on this process; without it, notification items are left (unclaimed) to the
  // web deployment's dispatch instead of being recorded as undeliverable here.
  const handlers: Readonly<Record<string, WorkHandler>> = rt.notifier ? all : { 'automation.evaluate': all['automation.evaluate'] };
  return { handlers, sweep: () => sweepAutomations(rt), telegram: rt.notifier !== null };
}

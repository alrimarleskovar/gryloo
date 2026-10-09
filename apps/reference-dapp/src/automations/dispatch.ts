// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: one bounded scheduler pass over the deployment's automations — in production by the Railway worker's sweep
 * (`sweepAutomations`, every 60 s; its own claim loop drains), and optionally by any scheduler through the embedded web runtime's
 * `/api/automations/dispatch` (Previews, no worker, recovery). Every step is idempotent and
 * safe to run concurrently with another pass, another replica, the Railway worker and the owner's own actions:
 *
 *   1. expire     open occurrences past their expiry, rules past their `expires_at` (SKIP LOCKED batches)
 *   2. discover   one `automation.evaluate` work item per due ACTIVE rule (deduplicated by rule and due time)
 *   3. drain      claim ONLY automation work items (fenced leases) and run their handlers until the budget ends
 *   4. approvals  APPROVAL_CREATED occurrences whose handoff the owner applied become COMPLETED
 *   5. retention  history, ended occurrences, link codes and the automation abuse-limit buckets
 *
 * Nothing here signs, submits, claims or approves: the handlers write proposals and notifications for the owner, nothing else.
 */
import { createWorker, type Logger, type WorkQueue } from '@defi-workflow-engine/cloud-runtime';
import { ruleScope } from './approval.ts';
import { AUTOMATION_WORK_KINDS, automationHandlers, type AutomationRuntime, type AutomationWorkRuntime } from './runtime.ts';

export type DispatchLimits = { readonly enqueue: number; readonly expire: number; readonly approvals: number; readonly budgetMs: number; readonly batch: number };
export const DISPATCH_LIMITS: DispatchLimits = Object.freeze({ enqueue: 100, expire: 200, approvals: 50, budgetMs: 45_000, batch: 4 });
export type DispatchSummary = { readonly expiredOccurrences: number; readonly expiredRules: number; readonly enqueued: number; readonly processed: number;
  readonly synced: number; readonly truncated: boolean };

/** The work queue limited to automation work: a scheduler pass never runs another service's items. */
export const automationQueue = (queue: WorkQueue): WorkQueue => ({ ...queue, claim: limit => queue.claim(limit, AUTOMATION_WORK_KINDS) });

/** Steps 1, 2, 4 and 5 (no draining): also the Railway worker's sweep (`worker.ts`), whose own loop then processes the work items. */
export async function sweepAutomations(rt: AutomationWorkRuntime, limits: DispatchLimits = DISPATCH_LIMITS, deadline = Date.now() + limits.budgetMs) {
  const now = rt.now();
  const expired = await rt.store.expireLapsed(now, limits.expire);
  const enqueued = await rt.store.enqueueDue(now, limits.enqueue);
  let synced = 0, truncated = false;
  for (const o of await rt.store.awaitingApproval(limits.approvals)) {
    if (Date.now() >= deadline) { truncated = true; break; }
    const h = await rt.handoffs.forRequester(o.handoffId!, ruleScope(o.ruleId), rt.now()).catch(() => null);
    if (h?.status === 'APPLIED' && await rt.store.completeApproval(o.occurrenceId, h.handoffId, rt.now())) synced++;
  }
  await rt.store.purge(rt.now()).catch(() => undefined);
  await rt.host.db.query(`DELETE FROM mcp_rate_limits WHERE tenant_id = $1 AND (bucket LIKE 'automation:%' OR bucket LIKE 'handoff:automation:%') AND window_start < $2`,
    [rt.host.tenantId, new Date(rt.now().getTime() - 86_400_000)]).catch(() => undefined);
  return { expired, enqueued, synced, truncated };
}

export async function dispatchAutomations(rt: AutomationRuntime, queue: WorkQueue, logger: Logger, workerId: string, limits: DispatchLimits = DISPATCH_LIMITS): Promise<DispatchSummary> {
  const started = Date.now(), deadline = started + limits.budgetMs;
  const before = await sweepAutomations(rt, limits, deadline);
  const worker = createWorker({ queue: automationQueue(queue), handlers: automationHandlers(rt), logger, workerId, concurrency: limits.batch });
  let processed = 0, truncated = before.truncated;
  for (;;) {
    if (Date.now() >= deadline) { truncated = true; break; }
    const n = await worker.drainOnce();
    processed += n;
    if (n === 0) break;
  }
  const summary = { expiredOccurrences: before.expired.occurrences, expiredRules: before.expired.rules, enqueued: before.enqueued, processed, synced: before.synced, truncated };
  rt.log.info('automation.dispatch', { expired: before.expired.occurrences + before.expired.rules, enqueued: before.enqueued, processed, synced: before.synced, truncated,
    duration_ms: Date.now() - started });
  return summary;
}

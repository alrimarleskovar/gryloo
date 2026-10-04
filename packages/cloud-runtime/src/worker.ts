// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Horizontally scalable worker loop. Any number of processes may run it against the same database: claiming
 * uses SKIP LOCKED, every item carries a lease token, and correctness never depends on which process (or how
 * many) handle an item. Handlers settle their own item — normally while still holding the run lease, so a
 * concurrent state change can never be lost between "decide" and "complete". An unsettled or failed item is
 * retried with exponential backoff; exhausted items become DEAD and flag the run for attention.
 * Idle polling backs off (1 s → 10 s). SIGTERM stops claiming and lets in-flight items finish.
 */
import type { Logger } from './telemetry.js';
import { parseTraceparent, withSpan } from './telemetry.js';
import type { WorkItem, WorkQueue } from './work-queue.js';

export type Settlement = { readonly outcome: 'DONE' } | { readonly outcome: 'RETRY'; readonly delayMs: number; readonly reason: string } |
  { readonly outcome: 'DEAD'; readonly reason: string };
export type Settle = (settlement: Settlement) => Promise<boolean>;
export type WorkHandler = (item: WorkItem, settle: Settle, logger: Logger) => Promise<void>;

export const MAX_DELIVERIES = 500;
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export function backoffMs(deliveries: number, random: () => number = Math.random): number {
  const base = Math.min(600_000, 15_000 * 2 ** Math.max(0, Math.min(16, deliveries - 1)));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export type WorkerOptions = { readonly queue: WorkQueue; readonly handlers: Readonly<Record<string, WorkHandler>>; readonly logger: Logger;
  readonly workerId: string; readonly concurrency?: number; readonly idleMinMs?: number; readonly idleMaxMs?: number; readonly leaseMs?: number;
  readonly sweep?: () => Promise<unknown>; readonly sweepEveryMs?: number; readonly now?: () => number };

export function createWorker(options: WorkerOptions) {
  const concurrency = options.concurrency ?? 4, idleMin = options.idleMinMs ?? 1_000, idleMax = options.idleMaxMs ?? 10_000;
  const leaseMs = options.leaseMs ?? 60_000, now = options.now ?? Date.now, logger = options.logger.child({ worker_id: options.workerId });
  let stopping = false, wake: (() => void) | null = null;
  const inFlight = new Set<Promise<void>>();

  async function handle(item: WorkItem): Promise<void> {
    let settled = false;
    const settle: Settle = async settlement => {
      if (settled) return false;
      settled = true;
      if (settlement.outcome === 'DONE') return options.queue.complete(item);
      if (settlement.outcome === 'DEAD') return options.queue.dead(item, settlement.reason);
      const exhausted = item.deliveries >= MAX_DELIVERIES || now() - item.createdAt.getTime() > MAX_AGE_MS;
      return exhausted ? options.queue.dead(item, 'OBSERVATION_BUDGET_EXHAUSTED') : options.queue.retry(item, settlement.delayMs, settlement.reason);
    };
    const handler = options.handlers[item.kind];
    const heartbeat = setInterval(() => { options.queue.heartbeat(item).catch(() => undefined); }, Math.floor(leaseMs / 3));
    heartbeat.unref();
    const fields = { tenant_id: item.tenantId, run_id: item.runId, work_kind: item.kind, work_id: item.id, delivery: item.deliveries };
    try {
      await withSpan(logger, 'work.process', fields, async () => {
        if (!handler) { await settle({ outcome: 'DEAD', reason: 'WORK_KIND_UNKNOWN' }); return; }
        try { await handler(item, settle, logger.child(fields)); }
        catch (error) {
          const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'WORK_HANDLER_FAILED';
          await settle({ outcome: 'RETRY', delayMs: backoffMs(item.deliveries), reason: code });
          throw error;
        }
        if (!settled) await settle({ outcome: 'RETRY', delayMs: backoffMs(item.deliveries), reason: 'WORK_NOT_SETTLED' });
      }, parseTraceparent(item.traceParent));
    } catch { /* Already logged with its error code and rescheduled. */ }
    finally { clearInterval(heartbeat); }
  }

  async function loop(): Promise<void> {
    let idle = idleMin, lastSweep = 0;
    while (!stopping) {
      if (options.sweep && now() - lastSweep >= (options.sweepEveryMs ?? 60_000)) {
        lastSweep = now();
        await withSpan(logger, 'work.sweep', {}, options.sweep).catch(() => undefined);
      }
      let claimed: readonly WorkItem[] = [];
      const capacity = concurrency - inFlight.size;
      if (capacity > 0) {
        try { claimed = await options.queue.claim(capacity); }
        catch (error) { logger.warn('work.claim_failed', { error_code: error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN' }); }
      }
      for (const item of claimed) {
        const task = handle(item).finally(() => { inFlight.delete(task); wake?.(); });
        inFlight.add(task);
      }
      if (claimed.length) { idle = idleMin; continue; }
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, idle); wake = () => { clearTimeout(timer); resolve(); }; });
      wake = null;
      if (!inFlight.size) idle = Math.min(idleMax, idle * 2);
    }
    await Promise.allSettled([...inFlight]);
  }

  let running: Promise<void> | null = null;
  return {
    start(): Promise<void> { running ??= loop(); return running; },
    async stop(): Promise<void> { stopping = true; wake?.(); await running; },
    /** Claims and processes at most one batch synchronously (tests and one-shot jobs). */
    async drainOnce(): Promise<number> {
      const claimed = await options.queue.claim(concurrency);
      await Promise.all(claimed.map(handle));
      return claimed.length;
    },
  };
}
export type Worker = ReturnType<typeof createWorker>;

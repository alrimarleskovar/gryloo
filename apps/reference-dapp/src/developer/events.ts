// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: webhook events are DERIVED from FloFi's own state — the approval handoff and the runs its owner shares — never
 * reported by anyone. Each event has a dedupe key (`<type>:<approval or execution id>`), so deriving again adds nothing: convergent,
 * idempotent and safe for concurrent serverless instances. Events are notifications only: no FloFi state transition reads them.
 *
 *   approval.claimed       a wallet proved ownership and loaded the proposal in FloFi
 *   approval.applied       the proposal is in the owner's FloFi workflow (Review and signature still ahead)
 *   approval.ended         EXPIRED, SUPERSEDED, REVOKED or STALE (`data.status`)
 *   execution.started      a run of this approval was first seen (only while the owner shares status)
 *   execution.failed       that run ended with an error, unreconciled
 *   execution.reconciled   that run reconciled, with its evidence environment, outcome and bundle hash (never upgraded)
 *
 * Payloads carry ids, states and evidence facts only: never a wallet, a secret, calldata or a transaction.
 */
import { sharedRuns, TERMINAL, type EngineRuntime, type HandoffRecord, type HandoffStore, type RunProgress } from '../platform/index.ts';
import { developerRequesterRef, type ApprovalBinding, type DeveloperEventType, type DeveloperStore, type NewEvent } from './store.ts';

/** An APPLIED approval keeps being watched for runs this long; after that (or once it ended) it is settled. */
export const APPLIED_WATCH_MS = 7 * 86_400_000;

export function deriveEvents(binding: ApprovalBinding, h: HandoffRecord, runs: readonly RunProgress[] | null): readonly NewEvent[] {
  const events: NewEvent[] = [], base = { approvalId: h.handoffId, strategyId: binding.strategyId, workflowHash: h.workflowHash };
  const add = (type: DeveloperEventType, key: string, data: Record<string, unknown>) =>
    events.push({ type, dedupeKey: `${type}:${key}`, approvalId: h.handoffId, data: { ...base, ...data } });
  if (h.claimedAt) add('approval.claimed', h.handoffId, { status: 'CLAIMED' });
  if (h.appliedAt) add('approval.applied', h.handoffId, { status: 'APPLIED' });
  if (TERMINAL.includes(h.status)) add('approval.ended', h.handoffId, { status: h.status });
  for (const run of runs ?? []) {
    add('execution.started', run.executionId, { executionId: run.executionId });
    if (run.reconciled && run.evidenceEnvironment && run.evidenceOutcome && run.evidenceBundleHash)
      add('execution.reconciled', run.executionId, { executionId: run.executionId, status: run.status,
        evidence: { environment: run.evidenceEnvironment, outcome: run.evidenceOutcome, bundleHash: run.evidenceBundleHash } });
    else if (run.terminal && run.errorCode) add('execution.failed', run.executionId, { executionId: run.executionId, status: run.status, errorCode: run.errorCode });
  }
  return events;
}

export type SyncDeps = { readonly store: DeveloperStore; readonly handoffs: HandoffStore; readonly runtime: EngineRuntime; readonly now: Date };
export type SyncFilter = Parameters<DeveloperStore['approvalsToSync']>[0];
/**
 * Re-derives the events of up to `limit` open developer approvals (least recently synced first) and records the new ones, fanned out to
 * their project's subscribed endpoints. Run reads happen as the claimant owner, only while the owner shares them. Returns how many
 * approvals were synced.
 */
export async function syncDeveloperApprovals(deps: SyncDeps, filter: SyncFilter, limit: number): Promise<number> {
  const bindings = await deps.store.approvalsToSync(filter, limit, deps.now);
  for (const binding of bindings) {
    const scope = { projectId: binding.projectId, environment: binding.environment };
    const h = await deps.handoffs.forRequester(binding.handoffId, { kind: 'DEVELOPER_PROJECT', ref: developerRequesterRef(scope.projectId, scope.environment) }, deps.now);
    if (!h) { await deps.store.markSynced(binding.handoffId, true, deps.now); continue; }
    // A runtime failure leaves the runs for the next sweep; the approval's own events are still derived.
    const runs = await sharedRuns(h, deps.runtime, deps.handoffs).catch(() => null);
    const recorded = await deps.store.recordEvents(scope, deriveEvents(binding, h, runs), deps.now);
    const step = h.plan.steps[0];
    for (const event of recorded) if (event.type === 'execution.reconciled')
      await deps.store.incrementUsage(scope, 'execution.reconciled', step ? `${step.network}:${step.protocol}` : '', deps.now);
    const settled = TERMINAL.includes(h.status) || (h.appliedAt !== null && deps.now.getTime() - h.appliedAt.getTime() > APPLIED_WATCH_MS);
    await deps.store.markSynced(binding.handoffId, settled, deps.now);
  }
  return bindings.length;
}

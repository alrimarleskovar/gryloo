// SPDX-License-Identifier: AGPL-3.0-only
// Owner filter adapted from the Dashboard delivery; final truth reuses UX-005 projections.
import type { ExecutionLifecycle } from '../../domain/execution-lifecycle';
import type { ExecutionRecovery } from '../../domain/execution-recovery';
import { projectExecutionResult } from '../../domain/execution-result';
import { shellChainLabel } from '../../domain/product-shell';
import type { DashboardRun, DashboardRunView, DashboardStatus } from './types';

export const dashboardRunId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const textValue = (value: unknown) => typeof value === 'string' ? value : '';
export const optionalText = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
export const sameOwner = (left: string | null | undefined, right: string | null | undefined) => Boolean(left && right &&
  (/^0x[0-9a-f]{40}$/i.test(left) && /^0x[0-9a-f]{40}$/i.test(right) ? left.toLowerCase() === right.toLowerCase() : left === right));

export function toDashboardRun(value: unknown, account: string): DashboardRun | null {
  if (!object(value) || !sameOwner(textValue(value.ownerAccount), account) || !dashboardRunId(value.runId) || !textValue(value.flow) || !textValue(value.status)) return null;
  return { runId: value.runId, workflowId: textValue(value.workflowId), flow: textValue(value.flow), status: textValue(value.status),
    provenance: textValue(value.provenance), ownerAccount: account, errorCode: optionalText(value.errorCode),
    needsObservation: value.needsObservation === true, attentionRequired: value.attentionRequired === true, hasEvidence: value.hasEvidence === true,
    createdAt: optionalText(value.createdAt), updatedAt: optionalText(value.updatedAt) };
}
const titles: Record<string, string> = { 'aave-supply': 'Aave workflow', 'base-sepolia-swap': 'Swap', 'crosschain-router': 'Bridge',
  'crosschain-router-testnet': 'Bridge', 'robinhood-transfer': 'Transfer', 'jupiter-swap': 'Swap', 'solana-devnet-swap': 'Swap',
  'orca-liquidity': 'Liquidity workflow', 'uniswap-liquidity': 'Liquidity workflow' };

export function projectDashboardRun(run: DashboardRun, progress: ExecutionLifecycle | null = null, title = titles[run.flow] ?? 'Workflow execution', current = false): DashboardRunView {
  const result = projectExecutionResult(progress);
  let status: DashboardStatus = 'Unresolved', message = 'FloFi has not established the final workflow outcome.';
  if (progress) {
    status = progress.state === 'active' ? 'In progress' : progress.state === 'idle' ? 'Not started'
      : progress.state === 'complete' ? progress.planUnavailable ? 'Needs attention' : progress.evidence?.attention.length ? 'Completed with attention' : 'Completed'
      : progress.state === 'uncertain' ? 'Unresolved' : result?.label === 'Execution partially completed' ? 'Partially completed'
      : result?.label === 'Transaction not submitted' ? 'Transaction not submitted' : result?.label === 'Execution failed' ? 'Failed' : 'Needs attention';
    message = result?.message ?? progress.message;
  } else if (run.status === 'RECONCILED' && !run.needsObservation) {
    status = run.attentionRequired || run.errorCode ? 'Completed with attention' : 'Completed';
    message = 'The run records a reconciled outcome.';
  } else if (['PARTIAL', 'PARTIALLY_COMPLETED'].includes(run.status)) {
    status = 'Partially completed'; message = 'Earlier completed actions remain recorded.';
  } else if (['FAILED', 'REVERTED'].includes(run.status) && !run.needsObservation) {
    // A summary alone cannot establish whether earlier actions completed.
    status = 'Needs attention'; message = 'A failed action is recorded. Open the run to review any earlier completed actions.';
  } else if (['SIMULATED', 'AUTHORIZED', 'REVIEWED'].includes(run.status)) {
    status = 'Not started'; message = 'The run has no recorded execution start.';
  } else if (['PREPARED', 'RESERVED', 'SUBMITTING', 'PENDING', 'HASH', 'SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'SIGNED', 'POSTING', 'POSTED', 'OPEN', 'SETTLING', 'FULFILLED', 'PARTIALLY_FILLED'].includes(run.status)) {
    status = 'In progress'; message = 'The recorded execution is still awaiting its final outcome.';
  } else if (run.status === 'CONFIRMED') {
    status = 'Needs attention'; message = 'A transaction is confirmed. Full workflow completion has not been established by this summary.';
  }
  const attention: string[] = [];
  if (status === 'Unresolved') attention.push('Execution status unresolved');
  else if (status === 'Partially completed' || status === 'Failed') attention.push('Review the incomplete action');
  else if (status === 'Transaction not submitted') attention.push('Wallet confirmation was declined');
  else if (status === 'Needs attention') attention.push(message);
  if (run.needsObservation) attention.push('Awaiting an execution status check');
  if (run.attentionRequired && !attention.length) attention.push('This execution record needs attention');
  if (run.errorCode && !attention.length) attention.push('A recorded issue needs review');
  attention.push(...(progress?.evidence?.attention ?? []));
  return { run, title, status, message, attention: [...new Set(attention)],
    networks: progress ? [...new Set(progress.steps.flatMap(step => step.operations.map(operation => operation.chain)).filter(Boolean))].map(shellChainLabel) : [],
    completed: progress?.planUnavailable ? null : progress?.completed ?? null, total: progress?.planUnavailable ? null : progress?.steps.length ?? null,
    recovered: Object.values(progress?.stepEvidence ?? {}).some(step => step.recovered),
    reconciled: progress ? Object.values(progress.stepEvidence ?? {}).some(step => step.reconciled) : run.status === 'RECONCILED', current, progress };
}

export function currentDashboardRun(title: string, progress: ExecutionLifecycle, recovery?: Pick<ExecutionRecovery, 'contextIssue' | 'action'>): DashboardRunView | null {
  const owner = progress.evidence?.wallet;
  if (!progress.started || !dashboardRunId(progress.runKey) || !owner) return null;
  const run: DashboardRun = { runId: progress.runKey, workflowId: '', flow: 'current', status: progress.state,
    provenance: progress.local ? 'LOCAL' : '', ownerAccount: owner, errorCode: null, needsObservation: false,
    attentionRequired: false, hasEvidence: Boolean(progress.evidence && (progress.evidence.details.some(item => item.label === 'Evidence bundle') ||
      Object.values(progress.evidence.operations).some(op => op.identifiers.length > 0 || op.values.length > 0))), createdAt: null, updatedAt: null };
  const view = projectDashboardRun(run, progress, title, true);
  if (recovery?.contextIssue) view.attention.push(recovery.contextIssue);
  if (recovery?.action && progress.state !== 'complete') view.attention.push('Check execution status in Execute');
  return view;
}

export function dashboardRunIndex(account: string | null, runs: readonly DashboardRun[], current: DashboardRunView | null): DashboardRunView[] {
  if (!account) return [];
  const ownedCurrent = current && sameOwner(current.run.ownerAccount, account) ? current : null;
  return [...(ownedCurrent ? [ownedCurrent] : []), ...runs.filter(run => sameOwner(run.ownerAccount, account) && run.runId !== ownedCurrent?.run.runId).map(run => projectDashboardRun(run))];
}

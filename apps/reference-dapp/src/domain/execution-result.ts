// SPDX-License-Identifier: AGPL-3.0-only
/** Result presentation only. Completion and uncertainty come from the existing lifecycle. */
import type { ExecutionLifecycle } from './execution-lifecycle';
import { shellChainLabel } from './product-shell';

export type ExecutionResult = {
  label: string;
  message: string;
  tone: 'ready' | 'attention';
  completed: number;
  total: number;
  countLabel: string;
  networks: string[];
};

export function projectExecutionResult(progress: ExecutionLifecycle | null | undefined): ExecutionResult | null {
  if (!progress?.started || progress.state === 'idle' || progress.state === 'active') return null;
  const completed = progress.completed, total = progress.steps.length;
  const countLabel = progress.planUnavailable ? 'Recorded actions confirmed' : 'Steps confirmed';
  const networks = [...new Set(progress.steps.flatMap(step => step.operations.map(operation => operation.chain)).filter(Boolean))].map(shellChainLabel);
  if (progress.state === 'complete') return {
    label: progress.planUnavailable ? 'Recorded requests confirmed' : progress.evidence?.attention.length ? 'Execution completed with attention' : 'Execution completed',
    message: progress.planUnavailable ? 'The saved requests are confirmed. Original workflow details remain unavailable.' : progress.evidence?.attention.length ? 'All workflow steps are confirmed. A recorded allowance still needs attention.' : 'All workflow steps are confirmed in the current execution record.',
    tone: progress.evidence?.attention.length ? 'attention' : 'ready', completed, total, countLabel, networks,
  };
  if (progress.state === 'uncertain') return {
    label: 'Execution status unresolved',
    message: 'FloFi has not yet confirmed the final state. Confirmed actions remain recorded.',
    tone: 'attention', completed, total, countLabel, networks,
  };
  const operations = progress.steps.flatMap(step => step.operations);
  const failed = operations.filter(operation => operation.state === 'failed');
  const incomplete = operations.filter(operation => ['failed', 'cancelled', 'not-submitted'].includes(operation.state));
  const declined = incomplete.length > 0 && incomplete.every(operation => !operation.hash && (operation.label === 'Wallet request declined' || progress.evidence?.operations[operation.id]?.failure === 'declined'));
  const definitiveFailure = failed.some(operation => operation.label !== 'Wallet request declined');
  const confirmedActions = operations.some(operation => !operation.approval && operation.state === 'confirmed');
  return {
    label: completed > 0 || confirmedActions ? 'Execution partially completed' : declined ? 'Transaction not submitted' : definitiveFailure ? 'Execution failed' : 'Execution needs attention',
    message: declined ? 'Wallet confirmation was declined. Earlier confirmed requests remain recorded.' : definitiveFailure ? 'A recorded action failed. Earlier confirmed actions remain recorded.' : 'The run has an incomplete action. Any confirmed actions remain recorded.',
    tone: 'attention', completed, total, countLabel, networks,
  };
}

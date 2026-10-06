// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';
import { projectReview, type ReviewAuthorization, type ReviewWallet } from './review-presentation';
import type { SimulationSource } from './simulation-presentation';

export type ExecutionStart = {
  ready: boolean; started: boolean; start: (() => void | Promise<void>) | null; prompt: string | null;
  expiresAt: number | null; requiresMainnetAcknowledgement: boolean; reason?: string; connect?: () => void; next?: (() => void | Promise<void>) | null; nextLabel?: string; check?: (() => void | Promise<void>) | null;
};
export type ExecutionWorkspaceState = {
  workflow: Workflow; context: ReviewContext; source: SimulationSource; authorization: ReviewAuthorization;
  wallet: ReviewWallet; execution: ExecutionStart; invalidWorkflow?: boolean; acknowledged?: boolean;
};
/** Additional presentation gates never grant authority that the selected runtime does not have. */
export function projectExecution(props: ExecutionWorkspaceState, now = Date.now()) {
  const { workflow, context, source, authorization, wallet, execution, invalidWorkflow = false } = props;
  const review = projectReview(workflow, context, source, authorization, wallet, now, invalidWorkflow);
  const expiries = [review.expiresAt, execution.expiresAt].filter((value): value is number => value !== null && Number.isFinite(value));
  const expiresAt = expiries.length ? Math.min(...expiries) : null;
  let status = 'blocked', label = 'Authorization required', message = 'Review this workflow in Simulate before execution.';
  if (review.status === 'approved' && execution.ready && execution.start) {
    status = 'ready'; label = 'Ready to execute'; message = 'Your reviewed workflow is ready. Execution starts only when you choose to continue.';
  } else if (review.status !== 'ready' && review.status !== 'approved') {
    label = review.label === 'Review blocked' ? 'Review required' : review.label; message = review.message;
    if (review.status === 'invalidated') label = /Network changed/.test(message) ? 'Network changed' : /Wallet changed/.test(message) ? 'Wallet changed' : 'Workflow changed';
    if (review.status === 'blocked' && authorization.accepted && review.label !== 'Connect your wallet') label = 'Execution unavailable';
  }
  if (review.status === 'approved' && !execution.ready) { label = 'Execution unavailable'; message = execution.reason ?? 'Execution cannot begin with the current wallet or execution state. Check this workflow in Simulate.'; }
  if (!authorization.key) {
    status = 'blocked';
    if (review.status !== 'invalidated' && review.label !== 'Connect your wallet') { label = 'Review required'; message = 'Simulate and review this workflow before execution.'; }
  }
  if (execution.requiresMainnetAcknowledgement && !props.acknowledged && status === 'ready') {
    status = 'blocked'; label = 'Confirmation required'; message = 'Confirm that this swap uses real funds on Solana mainnet before executing.';
  }
  if (source.state.busy) { status = 'loading'; label = 'Preparing execution…'; message = 'Checking the workflow and wallet authorization. Complete any open wallet confirmation.'; }
  if (expiresAt !== null && now >= expiresAt || review.status === 'expired') { status = 'blocked'; label = 'Simulation expired'; message = 'Simulate again and review the refreshed workflow before execution.'; }
  if (execution.started) { status = 'started'; label = 'Execution already started'; message = 'A request is already recorded for this workflow. Check its existing execution details before taking another action.'; }
  if (!review.steps.length) { status = 'empty'; label = 'No workflow ready to execute'; message = 'Create a workflow in Build first.'; }
  return { status, label, message, canExecute: status === 'ready', expiresAt, steps: review.steps,
    bindingValid: review.bindingValid, authorizationMessage: review.message, authorizationLabel: expiresAt !== null && now >= expiresAt ? 'Expired' : review.bindingValid ? 'Reviewed and approved' : review.status === 'ready' ? 'Approval required' : review.label,
    providers: [...new Set(review.steps.map(step => step.provider).filter((provider): provider is string => Boolean(provider)))],
    warnings: review.warnings.filter(warning => warning.severity === 'blocking'), prompt: execution.prompt };
}
/** Recheck wall-clock freshness at the explicit click boundary, including background tabs. */
export function startReviewedExecution(props: ExecutionWorkspaceState, now = Date.now()) {
  if (projectExecution(props, now).canExecute) return props.execution.start?.();
}

/** Continue only a never-attempted next call under the existing accepted authority. */
export function canContinueExecution(props: ExecutionWorkspaceState, now = Date.now()) {
  const review = projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, now, props.invalidWorkflow);
  return Boolean(review.bindingValid && props.execution.started && props.execution.ready && props.execution.next && !props.source.state.busy && (props.execution.expiresAt === null || now < props.execution.expiresAt));
}

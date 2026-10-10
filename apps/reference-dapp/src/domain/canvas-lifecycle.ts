// SPDX-License-Identifier: AGPL-3.0-only
import { projectReview } from './review-presentation';
import type { ExecutionControlsState } from '../state/execution-controls';

export type CanvasAction = { kind: 'simulate' | 'approve' | 'execute' | 'continue' | 'recover' | 'status'; label: string; disabled: boolean };
/** Presentation only. Authority remains in Review and the existing execution/recovery capabilities. */
export function projectCanvasAction(props: ExecutionControlsState, controls: {
  requesting: boolean; verifying: boolean; canContinue: boolean; canCheck: boolean;
}, now = Date.now()): CanvasAction {
  // A completed saved run remains a result. Editing a new workflow can start
  // a fresh simulation; an unresolved saved run always retains recovery.
  const progress = props.progress?.started && !(props.progress.state === 'complete' && !props.progress.planUnavailable && props.progress.matchesWorkflow === false) ? props.progress : null;
  const op = progress?.active?.operations.find(o => !['waiting', 'confirmed'].includes(o.state));
  if (controls.requesting || op?.state === 'wallet') return { kind: 'status', label: 'Waiting for wallet…', disabled: true };
  if (controls.verifying) return { kind: 'status', label: 'Reconciling…', disabled: true };
  if (progress) {
    if (controls.canContinue) return { kind: 'continue', label: props.execution.nextLabel ?? 'Continue to wallet', disabled: false };
    if (controls.canCheck) return { kind: 'recover', label: progress.restored || progress.state === 'uncertain' ? 'Recover execution' : props.recovery?.recordOnly ? 'Refresh status' : props.recovery ? 'Check status' : 'Check confirmation', disabled: false };
    // A confirmed prefix can need a fresh quote/Review before its still-unattempted suffix.
    // Never offer simulation as a retry for an unresolved submitted operation.
    const unresolved = progress.steps.some(step => step.operations.some(operation => !['waiting', 'confirmed', 'cancelled'].includes(operation.state)));
    if (progress.state === 'active' && !progress.busy && !unresolved && !props.recovery?.contextIssue) {
      const review = projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, now, props.invalidWorkflow);
      if (review.canApprove) return { kind: 'approve', label: 'Approve & Continue', disabled: false };
      if (review.status !== 'approved') return { kind: 'simulate', label: 'Simulate again', disabled: Boolean(props.invalidWorkflow) };
    }
    return { kind: 'status', label: progress.state === 'complete' ? 'Execution completed' : progress.state === 'uncertain' || progress.restored ? 'Recover execution' : progress.busy ? 'Reconciling…' : progress.label, disabled: true };
  }
  if (props.source.state.busy) return { kind: 'status', label: 'Simulating workflow…', disabled: true };
  const review = projectReview(props.workflow, props.context, props.source, props.authorization, props.wallet, now, props.invalidWorkflow);
  if (review.status === 'approved') return { kind: 'execute', label: 'Execute workflow', disabled: !props.execution.ready };
  if (props.authorization.key && !['expired', 'invalidated'].includes(review.status)) return { kind: 'approve', label: 'Approve & Continue', disabled: !review.canApprove };
  return { kind: 'simulate', label: props.authorization.key ? 'Simulate again' : 'Simulate workflow', disabled: Boolean(props.invalidWorkflow) };
}

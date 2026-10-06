// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflow } from '../state/workflow-store';
import { poolProposalTarget } from './composer-card';
import { singleAmountProposalTarget } from '../domain/composer-presentation';

/** Existing authoring proposal acceptance; never financial authorization. */
export function WorkflowEditReview() {
  const { pending, applyProposal, dismissProposal, state, actionSetup } = useWorkflow();
  const singleSetupApplies = actionSetup && actionSetup.action !== 'pool' && actionSetup.action !== 'swap' && actionSetup.action !== 'bridge' && pending?.authoringId === actionSetup.id;
  // Amount acceptance lives in its card; other proposed edits keep their review surface.
  if (!pending || (pending.authoringId && !singleSetupApplies && !singleAmountProposalTarget(state.workflow, pending.command))) return null;
  // Pool position edits use their existing validated form and compact card acceptance controls.
  if (poolProposalTarget(pending.command)) return null;
  const singleCardApplies = singleSetupApplies || Boolean(singleAmountProposalTarget(state.workflow, pending.command));
  return <section className="workflow-edit-review panel" aria-label="Workflow edit review">
    <strong>Review proposed edit</strong><p>Changes to revision {pending.command.baseRevision}</p>
    <ul>{pending.diff.map((line, index) => <li key={index}>{line}</li>)}</ul>
    <p>Applying an edit updates the workflow. Simulate and review it before wallet authorization.</p>
    <div>{!singleCardApplies && <button type="button" disabled={pending.diff.length === 1 && pending.diff[0] !== 'Edit'} onClick={applyProposal}>Apply proposal</button>}
      <button type="button" className="quiet" onClick={dismissProposal}>Dismiss</button></div>
  </section>;
}

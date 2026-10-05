// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflow } from '../state/workflow-store';

/** Existing authoring proposal acceptance; never financial authorization. */
export function WorkflowEditReview() {
  const { pending, applyProposal, dismissProposal } = useWorkflow();
  if (!pending) return null;
  if (pending.authoringId) return <section className="workflow-edit-review panel" aria-label="Workflow edit review">
    <strong>Review amount</strong><p>{pending.valid ? <>Use {pending.authoringAmount} for this action.</> : 'Check the amount and action settings before applying.'}</p>
    <p>Simulate the configured workflow before authorizing it.</p>
    <div><button type="button" disabled={!pending.valid} onClick={applyProposal}>Apply amount</button><button type="button" className="quiet" onClick={dismissProposal}>Cancel</button></div>
  </section>;
  return <section className="workflow-edit-review panel" aria-label="Workflow edit review">
    <strong>Review proposed edit</strong><p>Changes to revision {pending.command.baseRevision}</p>
    <ul>{pending.diff.map((line, index) => <li key={index}>{line}</li>)}</ul>
    <p>Applying an edit updates the workflow. Simulate and review it before wallet authorization.</p>
    <div><button type="button" disabled={pending.diff.length === 1 && pending.diff[0] !== 'Edit'} onClick={applyProposal}>Apply proposal</button>
      <button type="button" className="quiet" onClick={dismissProposal}>Dismiss</button></div>
  </section>;
}

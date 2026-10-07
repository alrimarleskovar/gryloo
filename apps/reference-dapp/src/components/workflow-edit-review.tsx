// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflow } from '../state/workflow-store';
import { poolProposalTarget } from './composer-card';
import { singleAmountProposalTarget } from '../domain/composer-presentation';
import { ProposalReviewArtifact } from './proposal-review';
export { workflowProposalSummary } from './proposal-review';

/** Existing authoring proposal acceptance; never financial authorization. */
export function WorkflowEditReview() {
  const { pending, state } = useWorkflow();
  // Card-based proposals retain their existing eligibility and acceptance handler.
  // Copilot proposals on those cards render this same review through a canvas portal.
  if (!pending || pending.authoringId || singleAmountProposalTarget(state.workflow, pending.command) || poolProposalTarget(pending.command)) return null;
  return <ProposalReviewArtifact/>;
}

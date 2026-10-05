// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { product } from '../config/product';
import { STAGE_GUIDANCE, workflowShellContext, type WorkflowStage } from '../domain/product-shell';
import { useWorkflow } from '../state/workflow-store';

export function WorkspaceHeading({ stage, description }: { stage: WorkflowStage; description: string }) {
  const { state } = useWorkflow();
  if (stage === 'Build' || stage === 'Simulate') return null;
  const context = workflowShellContext(state.workflow);
  return <section className="workspace-heading" aria-label="Workflow workspace">
    <div className="workflow-context" data-workflow-id={context.workflowId} data-workflow-revision={context.revision}>
      <span className="workflow-name">Draft · {product.strategyName}</span>
      <span>{context.actionCount} {context.actionCount === 1 ? 'action' : 'actions'}</span>
      <span>Revision {context.revision}</span>
      <span className="workflow-chains">{context.chains.length ? context.chains.join(' · ') : 'No chain selected'}</span>
    </div>
    <div className="page-heading"><div>
      <p className="eyebrow">{stage.toUpperCase()} / WORKFLOW</p>
      <h1 id="workspace-title">{stage}</h1>
      <p>{description}</p>
    </div><span className="stage-current">Current stage · {stage}</span></div>
    <p className="stage-guidance"><strong>{STAGE_GUIDANCE[stage].purpose}</strong><span>{STAGE_GUIDANCE[stage].detail}</span></p>
  </section>;
}

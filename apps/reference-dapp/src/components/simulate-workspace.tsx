// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { ReactNode, Ref } from 'react';
import type { SimulationSource } from '../domain/simulation-presentation';
import { useWorkflow } from '../state/workflow-store';
import { SimulationSummary } from './simulation-summary';
import { SimulateWorkflowCanvas } from './simulate-workflow-canvas';

/** Workspace presentation only; runtime panels and their Review gates stay with their existing owners. */
export function SimulateWorkspace({ workflowName, returnToBuild, reviewActionHost, simulationSource, review, simulateAction, children }: {
  workflowName: string; returnToBuild?: (() => void) | undefined; reviewActionHost?: Ref<HTMLDivElement> | undefined; children?: ReactNode; review?: ReactNode; simulateAction?: ReactNode; simulationSource?: SimulationSource | undefined;
}) {
  const { t: tr } = useLocale();
  const { state, context, reviewError } = useWorkflow();
  return <section className="simulate-workspace" aria-label={tr("Workflow simulation workspace")}>
    <div className="simulate-workspace-grid">
      <SimulateWorkflowCanvas workflowName={workflowName} primaryAction={<div className="simulation-workspace-actions">
        {returnToBuild && <button type="button" className="simulation-back" onClick={returnToBuild}>{tr("Back to Build")}</button>}
        {tr(simulateAction)}
      </div>}/>
      <aside className="simulation-summary panel" aria-label={tr("Simulation Summary")}>
        <div className="simulation-summary-content" role="region" aria-label={tr("Simulation result details")}><SimulationSummary workflow={state.workflow} context={context} source={simulationSource} invalidWorkflow={Boolean(reviewError)}/></div>
        {tr(review)}
        <div className="simulation-workspace-actions">
          {reviewActionHost && <div className="simulation-review-action" ref={reviewActionHost}/>}
        </div>
      </aside>
    </div>
    {children}
  </section>;
}

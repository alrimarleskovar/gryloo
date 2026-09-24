// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { product } from '../config/product';
import { useWorkflow } from '../state/workflow-store';
import { ActionLibrary } from './action-library';
import { ArtifactInspector } from './artifact-inspector';
import { CopilotPanel } from './copilot-panel';
import { SummaryBar } from './summary-bar';
import { ReviewPanel } from './review-panel';
import { TopBar, type Tab } from './top-bar';
import { WorkflowCanvas } from './workflow-canvas';

export function AppShell() {
  const { state } = useWorkflow();
  const [tab, setTab] = useState<Tab>('Build');
  const [selectedId, select] = useState<string | null>(null);
  return <div className="app-shell"><TopBar tab={tab} setTab={setTab}/>
    <main className="main">
      <div className="page-heading"><div><p className="eyebrow">WORKSPACE / {tab.toUpperCase()}</p><h1>{tab === 'Build' ? product.strategyName : tab}</h1><p>{tab === 'Build' ? 'Author locally. Review every swap edit in one shared semantic workflow.' : 'This stage is unavailable in BUILD-003A.'}</p></div><span className="heading-revision">SEMANTIC REVISION {state.workflow.revision}</span></div>
      {tab === 'Build' ? <><div className="build-grid"><ActionLibrary/><WorkflowCanvas selectedId={selectedId} select={select}/><CopilotPanel/></div><ArtifactInspector selectedId={selectedId}/><ReviewPanel/></>
        : <section className="unavailable panel" aria-label={`${tab} unavailable`}><p className="eyebrow">{tab.toUpperCase()} / UNAVAILABLE</p><h2>{tab} is not implemented</h2><p>BUILD-003A implements swap authoring and deterministic lint only. There is no quote, financial simulation, wallet, transaction, execution or outcome here.</p><button type="button" onClick={() => setTab('Build')}>Return to Build</button></section>}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar/>
  </div>;
}

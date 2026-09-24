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
import { SimulatePanel } from './simulate-panel';
import { ObservationPanel } from './observation-panel';
import { TopBar, type Tab } from './top-bar';
import { WorkflowCanvas } from './workflow-canvas';

const headings: Record<Tab, string> = {
  Build: 'Author locally. Review every swap edit in one shared semantic workflow.',
  Simulate: 'Mocked artifact chain: synthetic fixture data, not a live quote or a financial simulation. A separate read-only Base observation follows it; neither can authorize execution.',
  Execute: 'This stage is unavailable.',
};

export function AppShell() {
  const { state } = useWorkflow();
  const [tab, setTab] = useState<Tab>('Build');
  const [selectedId, select] = useState<string | null>(null);
  return <div className="app-shell"><TopBar tab={tab} setTab={setTab}/>
    <main className="main">
      <div className="page-heading"><div><p className="eyebrow">WORKSPACE / {tab.toUpperCase()}</p><h1>{tab === 'Build' ? product.strategyName : tab}</h1><p>{headings[tab]}</p></div><span className="heading-revision">SEMANTIC REVISION {state.workflow.revision}</span></div>
      {tab === 'Build' ? <><div className="build-grid"><ActionLibrary/><WorkflowCanvas selectedId={selectedId} select={select}/><CopilotPanel/></div><ArtifactInspector selectedId={selectedId}/><ReviewPanel/></>
        : tab === 'Simulate' ? <><SimulatePanel/><ObservationPanel/></>
        : <section className="unavailable panel" aria-label="Execute unavailable"><p className="eyebrow">EXECUTE / UNAVAILABLE</p><h2>Execute is not implemented</h2><p>This build stops before authorization. Mocked quote and simulation artifacts cannot authorize execution. Read-only Base observations cannot authorize execution either. There is no wallet, signature, transaction, execution or outcome here.</p><button type="button" onClick={() => setTab('Build')}>Return to Build</button></section>}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar tab={tab} setTab={setTab}/>
  </div>;
}

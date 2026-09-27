// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { product } from '../config/product';
import { ModeBProvider, useModeB } from '../state/mode-b-store';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import { ActionLibrary } from './action-library';
import { ArtifactInspector } from './artifact-inspector';
import { CopilotPanel } from './copilot-panel';
import { ExecutionPanel } from './execution-panel';
import { ForkSimulationPanel } from './fork-simulation-panel';
import { ModeBPanel } from './mode-b-panel';
import { ManifestReview } from './manifest-review';
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
const forkExecuteHeading = 'Local-fork Mode A only: review two exact payloads, request them from your wallet on chain 31337, then recover and reconcile.';
const modeBExecuteHeading = 'Local fork chain 31337: review wallet authority, run the bounded worker, and reconcile exact effects.';

export function AppShell() { return <ModeBProvider><AppShellContent/></ModeBProvider>; }

function AppShellContent() {
  const { state } = useWorkflow();
  const { prepared, info } = useModeA();
  const modeB = useModeB();
  const [tab, setTab] = useState<Tab>('Build');
  const [selectedId, select] = useState<string | null>(null);
  const forkExecution = tab === 'Execute' && Boolean((info?.available && prepared) || modeB.info?.available);
  return <div className="app-shell"><TopBar tab={tab} setTab={setTab}/>
    <main className="main">
      <div className="page-heading"><div><p className="eyebrow">WORKSPACE / {tab.toUpperCase()}</p><h1>{tab === 'Build' ? product.strategyName : tab}</h1><p>{forkExecution ? (info?.available && prepared ? forkExecuteHeading : modeBExecuteHeading) : headings[tab]}</p></div><span className="heading-revision">SEMANTIC REVISION {state.workflow.revision}</span></div>
      {tab === 'Build' ? <><div className="build-grid"><ActionLibrary/><WorkflowCanvas selectedId={selectedId} select={select}/><CopilotPanel/></div><ArtifactInspector selectedId={selectedId}/><ReviewPanel/></>
        : tab === 'Simulate' ? <><SimulatePanel/><ObservationPanel/><ForkSimulationPanel/><ModeBPanel view="simulate"/></>
        : forkExecution ? <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/></>
        : <section className="unavailable panel" aria-label="Execute unavailable"><p className="eyebrow">EXECUTE / UNAVAILABLE</p><h2>Execute is not implemented for mocked or observed artifacts</h2><p>Mocked quote and simulation artifacts cannot authorize execution. Read-only Base observations cannot authorize execution either. There is no wallet, signature, transaction, execution or outcome here.</p>
          {info?.available && <p>Local-fork Mode A is enabled on this server: simulate a single USDC/WETH swap on the local fork in Simulate first. It runs on chain 31337 only.</p>}
          <button type="button" onClick={() => setTab('Build')}>Return to Build</button></section>}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar tab={tab} setTab={setTab}/>
  </div>;
}

// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { product } from '../config/product';
import { CowPanel } from './cow-panel';
import { useCow } from '../state/cow-store';
import { ModeBProvider, useModeB } from '../state/mode-b-store';
import { CompositionProvider, useComposition } from '../state/composition-store';
import { CompositionPanel } from './composition-panel';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import { useLiquidity } from '../state/liquidity-store';
import { LiquidityPanel } from './liquidity-panel';
import { BridgePanel } from './bridge-panel';
import { BridgeSwapPanel } from './bridge-swap-panel';
import { useBridgeSwap } from '../state/bridge-swap-store';
import { useBridge } from '../state/bridge-store';
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

export function AppShell() { return <ModeBProvider><CompositionProvider><AppShellContent/></CompositionProvider></ModeBProvider>; }

function AppShellContent() {
  const { state } = useWorkflow();
  const { prepared, info } = useModeA();
  const modeB = useModeB();
  const composition = useComposition();
  const cow = useCow();
  const liquidity = useLiquidity();
  const bridge = useBridge();
  const bridgeSwap = useBridgeSwap();
  const [tab, setTab] = useState<Tab>('Build');
  const [selectedId, select] = useState<string | null>(null);
  const bridgeSwapWorkflow = (state.workflow.nodes.length === 2 && state.workflow.nodes[0]?.nodeId === 'build009-bridge') || Boolean(bridgeSwap.run);
  const bridgeWorkflow = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.actionType === 'asset.bridge';
  const forkExecution = tab === 'Execute' && Boolean((info?.available && prepared) || modeB.info?.available || cow.execution || (liquidity.info?.available && liquidity.prepared) || composition.info?.available || bridge.execution || bridgeSwap.run);
  return <div className="app-shell"><TopBar tab={tab} setTab={setTab}/>
    <main className="main">
      <div className="page-heading"><div><p className="eyebrow">WORKSPACE / {tab.toUpperCase()}</p><h1>{tab === 'Build' ? product.strategyName : tab}</h1><p>{forkExecution ? (bridge.execution ? 'LI.FI live route with deterministic MOCKED execution and destination reconciliation.' : liquidity.info?.available && liquidity.prepared ? 'Local-fork Mode A Uniswap v3 position: review one exact payload, request the wallet transaction, then reconcile.' : info?.available && prepared ? forkExecuteHeading : (cow.execution ? 'MOCKED CoW signed intent: track, cancel and reconcile the local order.' : modeBExecuteHeading)) : tab === 'Build' && bridgeSwapWorkflow ? 'Author Base USDC → Arbitrum USDC → WETH in one workflow.' : tab === 'Build' && bridge.enabled ? 'Author one Base to Optimism USDC bridge in chat or canvas.' : tab === 'Build' && liquidity.info?.available ? 'Author locally. Review every swap or liquidity edit in one shared semantic workflow.' : headings[tab]}</p></div><span className="heading-revision">SEMANTIC REVISION {state.workflow.revision}</span></div>
      {tab === 'Build' ? <><div className="build-grid"><ActionLibrary selectedId={selectedId}/><WorkflowCanvas selectedId={selectedId} select={select}/><CopilotPanel/></div><ArtifactInspector selectedId={selectedId}/><ReviewPanel/></>
        : tab === 'Simulate' ? bridgeSwapWorkflow ? <BridgeSwapPanel view="simulate"/> : bridgeWorkflow ? <BridgePanel view="simulate"/> : <><SimulatePanel/><ObservationPanel/><ForkSimulationPanel/><ModeBPanel view="simulate"/><CompositionPanel view="simulate"/><CowPanel view="simulate"/><LiquidityPanel view="simulate"/></>
        : forkExecution ? bridgeSwap.run ? <BridgeSwapPanel view="execute"/> : bridge.execution ? <BridgePanel view="execute"/> : <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></>
        : <section className="unavailable panel" aria-label="Execute unavailable"><p className="eyebrow">EXECUTE / UNAVAILABLE</p><h2>Execute is not implemented for mocked or observed artifacts</h2><p>Mocked quote and simulation artifacts cannot authorize execution. Read-only Base observations cannot authorize execution either. There is no wallet, signature, transaction, execution or outcome here.</p>
          {info?.available && <p>Local-fork Mode A is enabled on this server: simulate a single USDC/WETH swap on the local fork in Simulate first. It runs on chain 31337 only.</p>}
          <button type="button" onClick={() => setTab('Build')}>Return to Build</button></section>}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar tab={tab} setTab={setTab}/>
  </div>;
}

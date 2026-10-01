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
import { CrossChainLiquidityPanel } from './cross-chain-liquidity-panel';
import { AcrossPanel } from './across-panel';
import { useAcross } from '../state/across-store';
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
import { CapabilityProvider, useWorkflowCapability } from '../state/capability-store';
import { usePublicTestnet } from '../state/public-testnet-store';
import { PublicTestnetPanel } from './public-testnet-panel';
import { capabilityBlockMessage, primaryExecutionBlocker } from '../domain/capability-view';

import { useSupply } from '../state/supply-store';
import { BorrowPanel } from './borrow-panel';
import { SupplyPanel } from './supply-panel';
import { useJupiter } from '../state/jupiter-store';
import { JupiterPanel } from './jupiter-panel';

const headings: Record<Tab, string> = {
  Build: 'Arrange your steps, then select one to configure it.',
  Simulate: 'Mocked artifact chain: synthetic fixture data, not a live quote or a financial simulation. A separate read-only Base observation follows it; neither can authorize execution.',
  Execute: 'This stage is unavailable.',
};
const forkExecuteHeading = 'Local-fork Mode A only: review two exact payloads, request them from your wallet on chain 31337, then recover and reconcile.';
const modeBExecuteHeading = 'Local fork chain 31337: review wallet authority, run the bounded worker, and reconcile exact effects.';

export function AppShell() { return <ModeBProvider><CompositionProvider><CapabilityProvider><AppShellContent/></CapabilityProvider></CompositionProvider></ModeBProvider>; }

function AppShellContent() {
  const { state } = useWorkflow();
  const modeA = useModeA();
  const { prepared, info } = modeA;
  const modeB = useModeB();
  const composition = useComposition();
  const cow = useCow();
  const liquidity = useLiquidity();
  const bridge = useBridge();
  const bridgeSwap = useBridgeSwap();
  const across = useAcross();
  const [tab, setTab] = useState<Tab>('Build');
  const supply = useSupply();
  const borrowPath=state.workflow.nodes.some(n=>n.actionType==='borrow')||Boolean(supply.recovered&&supply.record?.review.borrow);
  const supplyPath = state.workflow.nodes.some(n => n.actionType === 'supply') || Boolean(supply.recovered && supply.record);
  const jupiter = useJupiter();
  const solanaPath = !supplyPath && (state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId.startsWith('solana:')) || Boolean(jupiter.recovered && jupiter.record));
  const publicTestnet = usePublicTestnet();
  const testnetWorkflow = state.workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && node.chainId === 'eip155:84532');
  const publicRecovery = Boolean(publicTestnet.recoveryOnly && publicTestnet.run);
  const continuedApproval = Boolean(publicTestnet.run && !publicTestnet.retired &&
    publicTestnet.run.attempts.at(-1)?.step === 'approval' &&
    publicTestnet.run.attempts.at(-1)?.state === 'CONFIRMED');
  const publicPath = testnetWorkflow || publicRecovery || continuedApproval;
  const [selectedId, select] = useState<string | null>(null);
  const { environment, result: capability } = useWorkflowCapability();
  const blocker = primaryExecutionBlocker(capability, selectedId);
  const blockedNode = capability.nodes.find(item => item.nodeId === blocker?.nodeId);
  const acrossWorkflow = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.adapterConstraints.adapters[0]?.id === 'across.direct';
  const bridgeSwapWorkflow = (state.workflow.nodes.length === 2 && state.workflow.nodes[0]?.nodeId === 'build009-bridge') || Boolean(bridgeSwap.run);
  const crossChainWorkflow = state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.prepare');
  const bridgeWorkflow = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.actionType === 'asset.bridge';
  const forkExecution = tab === 'Execute' && Boolean(crossChainWorkflow || (info?.available && prepared) || modeB.info?.available || cow.execution || (liquidity.info?.available && liquidity.prepared) || composition.info?.available || bridge.execution || bridgeSwap.run || across.run);
  const persistedBuild009Recovery = bridgeSwap.recovered &&
    bridgeSwap.run?.format === 'gryloo.build009.mocked.v1' &&
    !['BRIDGE_QUOTED', 'BRIDGE_AUTHORIZED'].includes(bridgeSwap.run.state);
  const recoveryPath = Boolean(modeA.recoveryOnly || modeB.recoveryOnly || composition.recoveryOnly || liquidity.recoveryOnly ||
    cow.recoveryOnly || bridge.recoveryOnly || persistedBuild009Recovery || across.recovered);
  const executionSurface = borrowPath || supplyPath || solanaPath || publicPath || recoveryPath || (environment !== 'PUBLIC_TESTNET' && environment !== 'MAINNET' &&
    capability.executionSupported && forkExecution);
  return <div className="app-shell"><TopBar tab={tab} setTab={setTab}/>
    <main className="main">
      <div className="page-heading"><div><p className="eyebrow">{tab === 'Build' ? 'WORKFLOW' : tab.toUpperCase()}</p><h1>{tab === 'Build' ? product.strategyName : tab}</h1><p>{borrowPath && tab !== 'Build' ? 'Borrow against existing Aave collateral on Base Sepolia. Review debt and health factor, then sign with your wallet.' : supplyPath && tab !== 'Build' ? 'Supply USDC to Aave V3 on Base Sepolia. Review the beneficiary and sign with your wallet.' : solanaPath && tab !== 'Build' ? (jupiter.network === 'Solana Devnet' ? 'Swap valueless test tokens on Solana Devnet through Orca Whirlpools. Review the exact transaction and sign with your Solana wallet.' : 'Swap on Solana through Jupiter. Review the exact transaction and sign with your Solana wallet.') : publicPath && tab !== 'Build' ? 'Swap test USDC and WETH through the verified Uniswap pool on Base Sepolia.' : forkExecution ? (across.run ? 'Direct Across bridge with simulated deposit, fill, recovery and refund.' : bridge.execution ? 'LI.FI live route with deterministic MOCKED execution and destination reconciliation.' : liquidity.info?.available && liquidity.prepared ? 'Local-fork Mode A Uniswap v3 position: review one exact payload, request the wallet transaction, then reconcile.' : info?.available && prepared ? forkExecuteHeading : (cow.execution ? 'MOCKED CoW signed intent: track, cancel and reconcile the local order.' : modeBExecuteHeading)) : tab === 'Build' && crossChainWorkflow ? 'One reviewed Base → Arbitrum bridge, calculated destination split, and Uniswap v3 position.' : tab === 'Build' && acrossWorkflow ? 'Bridge Base USDC to Arbitrum directly through Across.' : tab === 'Build' && bridgeSwapWorkflow ? 'Author Base USDC → Arbitrum USDC → WETH in one workflow.' : tab === 'Build' && bridge.enabled ? 'Author one Base to Optimism USDC bridge in chat or canvas.' : tab === 'Build' && liquidity.info?.available ? 'Author locally. Review every swap or liquidity edit in one shared semantic workflow.' : headings[tab]}</p></div></div>
      {tab === 'Build' ? <><div className="build-grid"><WorkflowCanvas selectedId={selectedId} select={select}/><CopilotPanel/></div><ArtifactInspector selectedId={selectedId} select={select}/>{!testnetWorkflow && !supplyPath && !borrowPath && !solanaPath && <ReviewPanel/>}<ActionLibrary selectedId={selectedId}/></>
        : tab === 'Simulate' ? borrowPath ? <BorrowPanel view="simulate"/> : supplyPath ? <SupplyPanel view="simulate"/> : solanaPath ? <JupiterPanel view="simulate"/> : publicPath ? <PublicTestnetPanel view="simulate"/> : crossChainWorkflow ? <CrossChainLiquidityPanel view="simulate"/> : acrossWorkflow || across.run ? <AcrossPanel view="simulate"/> : bridgeSwapWorkflow ? <BridgeSwapPanel view="simulate"/> : bridgeWorkflow ? <BridgePanel view="simulate"/> : <><SimulatePanel/><ObservationPanel/><ForkSimulationPanel/><ModeBPanel view="simulate"/><CompositionPanel view="simulate"/><CowPanel view="simulate"/><LiquidityPanel view="simulate"/></>
        : executionSurface ? borrowPath ? <BorrowPanel view="execute"/> : supplyPath ? <SupplyPanel view="execute"/> : solanaPath ? <JupiterPanel view="execute"/> : publicPath ? <PublicTestnetPanel view="execute"/> : persistedBuild009Recovery ? <BridgeSwapPanel view="execute"/> : across.recovered ? <AcrossPanel view="execute"/> :
          bridge.recoveryOnly ? <BridgePanel view="execute"/> : modeA.recoveryOnly || modeB.recoveryOnly ||
          composition.recoveryOnly || liquidity.recoveryOnly || cow.recoveryOnly ?
            <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></> :
          crossChainWorkflow ? <CrossChainLiquidityPanel view="execute"/> : across.run ? <AcrossPanel view="execute"/> :
          bridgeSwap.run ? <BridgeSwapPanel view="execute"/> : bridge.execution ? <BridgePanel view="execute"/> :
          <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></>
        : <section className="unavailable panel" aria-label="Execute unavailable"><p className="eyebrow">EXECUTE / UNAVAILABLE</p><h2>{environment === 'PUBLIC_TESTNET' || environment === 'MAINNET' ? 'Execution unavailable in selected environment' : 'Execute is not implemented for mocked or observed artifacts'}</h2><p>Mocked quote and simulation artifacts cannot authorize execution. Read-only Base observations cannot authorize execution either. There is no wallet, signature, transaction, execution or outcome here.</p>
          {blocker && <p role="status">{capabilityBlockMessage(blocker, blockedNode)}</p>}
          {info?.available && <p>Local-fork Mode A is enabled on this server: simulate a single USDC/WETH swap on the local fork in Simulate first. It runs on chain 31337 only.</p>}
          <button type="button" onClick={() => setTab('Build')}>Return to Build</button></section>}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar tab={tab} setTab={setTab}/>
  </div>;
}

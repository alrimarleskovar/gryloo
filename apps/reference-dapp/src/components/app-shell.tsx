// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { WithdrawPanel } from './withdraw-panel';
import { RobinhoodTransferPanel } from './robinhood-transfer-panel';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useState } from 'react';
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
import { TopBar, type ProductSection } from './top-bar';
import { WorkflowCanvas } from './workflow-canvas';
import { WorkflowEditReview } from './workflow-edit-review';
import { CapabilityProvider, useWorkflowCapability } from '../state/capability-store';
import { usePublicTestnet } from '../state/public-testnet-store';
import { PublicTestnetPanel } from './public-testnet-panel';
import { capabilityBlockMessage, primaryExecutionBlocker } from '../domain/capability-view';

import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import {useLending} from '../state/lending-store';
import {LendingPanel} from './lending-panel';
import { useSupply } from '../state/supply-store';
import { RepayPanel } from './repay-panel';
import { BorrowPanel } from './borrow-panel';
import { SupplyPanel } from './supply-panel';
import { useJupiter } from '../state/jupiter-store';
import { JupiterPanel } from './jupiter-panel';
import { SolanaLiquidityPanel } from './solana-liquidity-panel';
import { useSolanaLiquidity } from '../state/solana-liquidity-store';
import { UniswapLiquidityPanel } from './uniswap-liquidity-panel';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { JourneyCard, RouterPanel } from './router-panel';
import { useRouter } from '../state/router-store';
import { routerDetails } from '../domain/router-authoring';

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
  const [tab, setTab] = useState<ProductSection>('Build');
  const [workflowName, setWorkflowName] = useState('Your Workflow');
  const [simulationActionHost, setSimulationActionHost] = useState<HTMLDivElement | null>(null);
  const supply = useSupply();
  const transfer = useRobinhoodTransfer();
  // RH-DEMO-001: the transfer node, or a persisted run recovered after reload while the workflow is still the untouched template.
  const transferPath = state.workflow.nodes.some(n => n.actionType === 'asset.transfer') || Boolean(transfer.record && state.workflow.nodes.every(n => n.actionType.startsWith('mock-')) && state.workflow.revision === 0);
  const lending=useLending(),lendingPath=isLendingComposition(state.workflow)||Boolean(lending.recovered&&lending.record&&!lending.retired);
  const withdrawPath=state.workflow.nodes.some(n=>n.actionType==='withdraw')||Boolean(supply.recovered&&supply.record?.review.withdraw);
  const repayPath=state.workflow.nodes.some(n=>n.actionType==='repay')||Boolean(supply.recovered&&supply.record?.review.repay);
  const borrowPath=state.workflow.nodes.some(n=>n.actionType==='borrow')||Boolean(supply.recovered&&supply.record?.review.borrow);
  const supplyPath = state.workflow.nodes.some(n => n.actionType === 'supply') || Boolean(supply.recovered && supply.record);
  const jupiter = useJupiter();
  const solanaLiquidity = useSolanaLiquidity();
  const uniswapLiquidity = useUniswapLiquidity();
  // BUILD-UNISWAP-LIQUIDITY-PUBLIC: the canonical position on Base Sepolia, or a recovered run while the workflow is the untouched template.
  const uniswapLiquidityPath = !supplyPath && (state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated' && n.chainId === 'eip155:84532') ||
    Boolean(uniswapLiquidity.recovered && uniswapLiquidity.record && state.workflow.revision === 0 && state.workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  const routerState = useRouter();
  // BUILD-ROUTER-001: the canonical cross-chain bridge node, or a recovered run while the workflow is the untouched template.
  const routerPath = state.workflow.nodes.some(n => routerDetails(n)) ||
    Boolean(routerState.recovered && routerState.record && state.workflow.revision === 0 && state.workflow.nodes.every(n => n.actionType.startsWith('mock-')));
  const solanaLiquidityPath = !supplyPath && !uniswapLiquidityPath && (state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated' && n.chainId.startsWith('solana:')) || Boolean(solanaLiquidity.recovered && solanaLiquidity.record));
  const solanaPath = !supplyPath && !solanaLiquidityPath && (state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId.startsWith('solana:')) || Boolean(jupiter.recovered && jupiter.record));
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
  const bridgeWorkflow = !routerPath && state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.actionType === 'asset.bridge';
  const forkExecution = tab === 'Execute' && Boolean(crossChainWorkflow || (info?.available && prepared) || modeB.info?.available || cow.execution || (liquidity.info?.available && liquidity.prepared) || composition.info?.available || bridge.execution || bridgeSwap.run || across.run);
  const persistedBuild009Recovery = bridgeSwap.recovered &&
    bridgeSwap.run?.format === 'gryloo.build009.mocked.v1' &&
    !['BRIDGE_QUOTED', 'BRIDGE_AUTHORIZED'].includes(bridgeSwap.run.state);
  const recoveryPath = Boolean(modeA.recoveryOnly || modeB.recoveryOnly || composition.recoveryOnly || liquidity.recoveryOnly ||
    cow.recoveryOnly || bridge.recoveryOnly || persistedBuild009Recovery || across.recovered);
  const executionSurface = routerPath || transferPath || lendingPath || withdrawPath || repayPath || borrowPath || supplyPath || uniswapLiquidityPath || solanaLiquidityPath || solanaPath || publicPath || recoveryPath || (environment !== 'PUBLIC_TESTNET' && environment !== 'MAINNET' &&
    capability.executionSupported && forkExecution);
  if (tab === 'Dashboard') return <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a><TopBar tab={tab} setTab={setTab}/>
    <main id="workspace" className="main" tabIndex={-1} aria-label="Dashboard"/>
  </div>;
  const productExecutionPath = routerPath || transferPath || lendingPath || withdrawPath || repayPath || borrowPath || supplyPath || uniswapLiquidityPath || solanaLiquidityPath || solanaPath || publicPath;
  const stageContent = tab === 'Build' ? <><div className="build-grid"><WorkflowCanvas selectedId={selectedId} select={select} workflowName={workflowName} renameWorkflow={setWorkflowName} primaryAction={<button type="button" onClick={() => setTab('Simulate')}>Simular Fees</button>}/><CopilotPanel showProposal={false}/></div><ArtifactInspector selectedId={selectedId} select={select}/><WorkflowEditReview/><JourneyCard/>
          <ActionLibrary selectedId={selectedId}>{!testnetWorkflow && !supplyPath && !borrowPath && !repayPath && !withdrawPath && !transferPath && !uniswapLiquidityPath && !solanaLiquidityPath && !solanaPath && !routerPath && <ReviewPanel/>}</ActionLibrary></>
        : tab === 'Simulate' ? routerPath ? <RouterPanel view="simulate"/> : transferPath ? <RobinhoodTransferPanel view="simulate"/> : lendingPath ? <LendingPanel view="simulate"/> : withdrawPath ? <WithdrawPanel view="simulate"/> : repayPath ? <RepayPanel view="simulate"/> : borrowPath ? <BorrowPanel view="simulate"/> : supplyPath ? <SupplyPanel view="simulate"/> : uniswapLiquidityPath ? <UniswapLiquidityPanel view="simulate"/> : solanaLiquidityPath ? <SolanaLiquidityPanel view="simulate"/> : solanaPath ? <JupiterPanel view="simulate"/> : publicPath ? <PublicTestnetPanel view="simulate"/> : crossChainWorkflow ? <CrossChainLiquidityPanel view="simulate"/> : acrossWorkflow || across.run ? <AcrossPanel view="simulate"/> : bridgeSwapWorkflow ? <BridgeSwapPanel view="simulate"/> : bridgeWorkflow ? <BridgePanel view="simulate"/> : <SimulatePanel workflowName={workflowName} returnToBuild={() => setTab('Build')} reviewActionHost={setSimulationActionHost}><ObservationPanel/><ForkSimulationPanel/><ModeBPanel view="simulate"/><CompositionPanel view="simulate"/><CowPanel view="simulate"/><LiquidityPanel view="simulate"/></SimulatePanel>
        : executionSurface ? routerPath ? <RouterPanel view="execute"/> : transferPath ? <RobinhoodTransferPanel view="execute"/> : lendingPath ? <LendingPanel view="execute"/> : withdrawPath ? <WithdrawPanel view="execute"/> : repayPath ? <RepayPanel view="execute"/> : borrowPath ? <BorrowPanel view="execute"/> : supplyPath ? <SupplyPanel view="execute"/> : uniswapLiquidityPath ? <UniswapLiquidityPanel view="execute"/> : solanaLiquidityPath ? <SolanaLiquidityPanel view="execute"/> : solanaPath ? <JupiterPanel view="execute"/> : publicPath ? <PublicTestnetPanel view="execute"/> : persistedBuild009Recovery ? <BridgeSwapPanel view="execute"/> : across.recovered ? <AcrossPanel view="execute"/> :
          bridge.recoveryOnly ? <BridgePanel view="execute"/> : modeA.recoveryOnly || modeB.recoveryOnly ||
          composition.recoveryOnly || liquidity.recoveryOnly || cow.recoveryOnly ?
            <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></> :
          crossChainWorkflow ? <CrossChainLiquidityPanel view="execute"/> : across.run ? <AcrossPanel view="execute"/> :
          bridgeSwap.run ? <BridgeSwapPanel view="execute"/> : bridge.execution ? <BridgePanel view="execute"/> :
          <><ManifestReview/><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></>
        : null;
  return <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a><TopBar tab={tab} setTab={setTab}/>
    <main id="workspace" className={tab === 'Build' ? 'main build-workspace' : 'main'} tabIndex={-1} aria-label={tab === 'Build' ? 'Workflow workspace' : tab === 'Simulate' ? 'Simulation workspace' : 'Execution workspace'}>
      {tab === 'Simulate' && (productExecutionPath || crossChainWorkflow || acrossWorkflow || across.run || bridgeSwapWorkflow || bridgeWorkflow) &&
        <WorkflowCanvas mode="simulate" workflowName={workflowName} primaryAction={<>
          <button type="button" onClick={() => setTab('Build')}>Return to Build</button>
          <div className="simulation-review-action" ref={setSimulationActionHost}/>
        </>}/>
      }
      {tab === 'Execute' && !productExecutionPath ? <>
        <WorkflowCanvas mode="execute" workflowName={workflowName}/>
        <details className="shell-details technical-workspace"><summary>Technical diagnostics</summary>{executionSurface ? stageContent : <>
          <p>A supported workflow, current simulation and explicit wallet authorization are required before execution.</p>
          {blocker && <p role="status">{capabilityBlockMessage(blocker, blockedNode)}</p>}
          {info?.available && <p>Local-fork Mode A is enabled on this server: simulate a single USDC/WETH swap on the local fork in Simulate first. It runs on chain 31337 only.</p>}
        </>}</details>
      </> : stageContent}
      {state.error && <div className="error-banner" role="alert"><strong>Edit not applied</strong><span>{state.error}</span></div>}
    </main><SummaryBar tab={tab} setTab={setTab} simulationActionHost={simulationActionHost}/>
  </div>;
}

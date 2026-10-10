// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { WithdrawPanel } from './withdraw-panel';
import { RobinhoodTransferPanel } from './robinhood-transfer-panel';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolboxMode } from '../domain/canvas-layout';
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
import { EngineeringAuthoring } from '../test-utils/engineering-authoring';
import { ReviewPanel } from './review-panel';
import { ReviewWorkspace, ReviewTechnicalDetails } from './review-workspace';
import { SimulatePanel } from './simulate-panel';
import { ObservationPanel } from './observation-panel';
import { ForkSimulationPanel } from './fork-simulation-panel';
import { useExecutionControls } from '../state/execution-controls';
import { CanvasLifecycleAction } from './canvas-lifecycle-action';
import { ArtifactInspector } from './artifact-inspector';
import { CopilotPanel } from './copilot-panel';
import { MobileBuildNavigation } from './mobile-build-navigation';
import { ExecutionPanel } from './execution-panel';
import { ModeBPanel } from './mode-b-panel';
import { ExecuteWorkspace } from './execute-workspace';
import { useExecutionLifecycle } from '../state/execution-lifecycle';
import { useExecutionStart } from '../state/execution-start';
import { restoredLocalExecutionKind } from '../domain/execution-recovery';
import { ReviewAuthorizationDetails } from './review-workspace';
import { useReviewAuthorization } from '../state/review-authorization';
import { SummaryBar } from './summary-bar';
import type { SimulationSource } from '../domain/simulation-presentation';
import { SimulateWorkspace } from './simulate-workspace';
import { TopBar, type ProductSection } from './top-bar';
import { WorkflowCanvas } from './workflow-canvas';
import { PoolPriceRangeProvider } from './pool-price-range';
import { CanvasCardInputsProvider } from './canvas-card-inputs';
import { useWorkflowCapability } from '../state/capability-store';
import { usePublicTestnet } from '../state/public-testnet-store';
import { PublicTestnetPanel } from './public-testnet-panel';

import {isLendingComposition, type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
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
import { RouterPanel } from './router-panel';
import { useRouter } from '../state/router-store';
import { routerDetails } from '../domain/router-authoring';
import { DashboardWorkspace } from './dashboard/dashboard-workspace';
import { dashboardRoute as resolveDashboardRoute } from '../lib/dashboard/routes';
import { secondaryWorkspaceRoute } from '../domain/secondary-workspaces';
import { SecondaryProductWorkspace } from './secondary-product-workspace';
import { AutomationInbox } from './automations-workspace';
import { automationsAvailability } from '../app/automation-action';

import { useSavedWorkflows } from '../state/saved-workflows';
import { useExecutionEnvironment } from '../state/capability-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useWalletProof } from './wallet-proof';
import { WorkflowVerification } from './saved-workflows';

type ProductNavigation = { engineering?: boolean; pathname?: string | null; navigate?: (path: string) => void; simulationRequest?: number };
export function AppShell(props: ProductNavigation = {}) { return <ModeBProvider><CompositionProvider><CanvasCardInputsProvider><PoolPriceRangeProvider><AppShellContent {...props}/></PoolPriceRangeProvider></CanvasCardInputsProvider></CompositionProvider></ModeBProvider>; }

function AppShellContent({ engineering = false, pathname, navigate, simulationRequest = 0 }: ProductNavigation) {
  const { t: tr } = useLocale();
  // Server HTML is visible before handlers and initial canvas preferences are ready.
  const [interactive, setInteractive] = useState(false);
  useEffect(() => { setInteractive(true); }, []);
  const { state, context, reviewError, authoringIncomplete, restoreWorkflow, restorationEpoch, propose } = useWorkflow();
  const modeA = useModeA();
  const { prepared, info } = modeA;
  const modeB = useModeB();
  const composition = useComposition();
  const cow = useCow();
  const liquidity = useLiquidity();
  const bridge = useBridge();
  const bridgeSwap = useBridgeSwap();
  const across = useAcross();
  const [section, setSection] = useState<ProductSection>('Build');
  const dashboardRoute = resolveDashboardRoute(pathname);
  const secondaryRoute = secondaryWorkspaceRoute(pathname);
  const tab = dashboardRoute ? 'Dashboard' : section;
  const setTab = useCallback((section: ProductSection) => {
    if (authoringIncomplete && (section === 'Simulate' || section === 'Execute')) return;
    if (navigate && section === 'Dashboard') { navigate('/app/dashboard'); return; }
    setSection(section);
    if (navigate && (dashboardRoute || secondaryRoute)) navigate('/app');
  }, [authoringIncomplete, navigate, dashboardRoute, secondaryRoute]);
  const lastSimulationRequest = useRef(0);
  useEffect(() => {
    if (simulationRequest > lastSimulationRequest.current) { lastSimulationRequest.current = simulationRequest; setTab('Simulate'); }
  }, [simulationRequest, setTab]);
  const [workflowName, setWorkflowName] = useState('Your Workflow');
  const connectedWallet = useBuild009Wallet();
  const walletIdentity = useExecutionEnvironment();
  const solanaSession = useJupiter().session;
  const owner = walletIdentity.walletKind === 'solana'
    ? solanaSession ? { namespace: 'solana' as const, address: solanaSession.account.address } : null
    : connectedWallet.account ? { namespace: 'eip155' as const, address: connectedWallet.account } : null;
  const proof = useWalletProof(owner?.namespace ?? null, solanaSession?.chain ?? 'solana:devnet');
  // BUILD-AUTOMATION-002: "Automate this workflow" is offered only where automations run; it carries the exact Canvas workflow (shared state).
  const [automationsReady, setAutomationsReady] = useState(false), [automateCanvas, setAutomateCanvas] = useState(false);
  useEffect(() => { void automationsAvailability().then(r => setAutomationsReady(r.enabled)).catch(() => setAutomationsReady(false)); }, []);
  const library = useSavedWorkflows(owner);
  const refreshLibrary = library.refresh;
  useEffect(() => { if (proof.proven === owner?.address) refreshLibrary(); }, [proof.proven, owner?.address, refreshLibrary]);
  const [saveNotice, setSaveNotice] = useState<{ owner: string | null; message: string } | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const ownerKey = owner ? `${owner.namespace}:${owner.address}` : null;
  async function saveCurrentWorkflow() {
    if (!owner) { setSaveNotice({ owner: null, message: 'Connect your wallet to save workflows.' }); return; }
    if (authoringIncomplete) { setSaveNotice({ owner: ownerKey, message: 'Configure the workflow before saving.' }); return; }
    if (proof.proven !== owner.address) { setShowVerification(true); return; }
    const saved = await library.save(state.workflow as SemanticWorkflow, workflowName);
    if (saved) setSaveNotice({ owner: ownerKey, message: 'Workflow saved.' });
  }
  async function reopenWorkflow(id: string) {
    const document = await library.open(id);
    if (!document) return;
    restoreWorkflow(document.workflow); setWorkflowName(document.name ?? 'Your Workflow');
    setSaveNotice({ owner: ownerKey, message: 'Workflow restored. Simulate again before reviewing.' });
    setTab('Build');
  }
  const workflows = { list: library.list, busy: library.busy, error: library.error,
    open: (id: string) => { void reopenWorkflow(id); }, refresh: () => { void proof.refresh(); library.refresh(); } };
  useEffect(() => { if (secondaryRoute?.id === 'workflows') refreshLibrary(); }, [secondaryRoute?.id, refreshLibrary]);
  const verification = owner && showVerification && proof.proven !== owner.address
    ? <WorkflowVerification namespace={owner.namespace} account={owner.address} proof={proof}/> : undefined;

  const [workspaceToolboxMode, setWorkspaceToolboxMode] = useState<ToolboxMode>('top');
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
  const uniswapLiquidityPath = !supplyPath && (state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated' && ['eip155:84532', 'eip155:11155111'].includes(n.chainId)) ||
    Boolean(uniswapLiquidity.recovered && uniswapLiquidity.record && state.workflow.revision === 0 && state.workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  const routerState = useRouter();
  // BUILD-ROUTER-001: the canonical cross-chain bridge node, or a recovered run while the workflow is the untouched template.
  const routerPath = state.workflow.nodes.some(n => routerDetails(n)) ||
    Boolean(routerState.recovered && routerState.record && state.workflow.revision === 0 && state.workflow.nodes.every(n => n.actionType.startsWith('mock-')));
  const solanaLiquidityPath = !supplyPath && !uniswapLiquidityPath && (state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated' && n.chainId.startsWith('solana:')) || Boolean(solanaLiquidity.recovered && solanaLiquidity.record));
  const solanaPath = !supplyPath && !solanaLiquidityPath && (state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId.startsWith('solana:')) || Boolean(jupiter.recovered && jupiter.record));
  const publicTestnet = usePublicTestnet();
  const testnetWorkflow = state.workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && ['eip155:84532', 'eip155:11155111'].includes(node.chainId));
  const publicRecovery = Boolean(publicTestnet.recoveryOnly && publicTestnet.run);
  const continuedApproval = Boolean(publicTestnet.run && !publicTestnet.retired &&
    publicTestnet.run.attempts.at(-1)?.step === 'approval' &&
    publicTestnet.run.attempts.at(-1)?.state === 'CONFIRMED');
  const publicPath = testnetWorkflow || publicRecovery || continuedApproval;
  const [selectedId, select] = useState<string | null>(null);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const selectAction = useCallback((id: string | null) => {
    select(id);
    if (!id) setInspectorExpanded(false);
  }, []);
  const openActionSettings = useCallback((id: string) => {
    select(id);
    setInspectorExpanded(true);
  }, []);
  const { environment, walletEnvironment, result: capability } = useWorkflowCapability();
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
  // The existing CoW loopback runtime is explicitly disabled on deployed environments.
  const localCowIntent = Boolean(cow.info?.enabled && cow.execution);
  const executionSurface = routerPath || transferPath || lendingPath || withdrawPath || repayPath || borrowPath || supplyPath || uniswapLiquidityPath || solanaLiquidityPath || solanaPath || publicPath || recoveryPath || localCowIntent || (environment !== 'PUBLIC_TESTNET' && environment !== 'MAINNET' &&
    capability.executionSupported && forkExecution);
  // Select the same runtime as the existing Simulate surface; presentation never changes its gates.
  const restoredLocalKind = restoredLocalExecutionKind(state.workflow, { composition: composition.recoveryOnly, liquidity: liquidity.recoveryOnly, cow: cow.recoveryOnly });
  let simulationSource: SimulationSource = routerPath ? { kind: 'router', state: routerState }
    : transferPath ? { kind: 'transfer', state: transfer }
    : lendingPath ? { kind: 'lending', state: lending }
    : supplyPath || borrowPath || repayPath || withdrawPath ? { kind: 'supply', state: supply }
    : uniswapLiquidityPath ? { kind: 'uniswap-pool', state: uniswapLiquidity }
    : solanaLiquidityPath ? { kind: 'solana-pool', state: solanaLiquidity }
    : solanaPath ? { kind: 'solana-swap', state: jupiter }
    : publicPath ? { kind: 'public', state: publicTestnet }
    : crossChainWorkflow ? { kind: 'unavailable', state: { error: null, busy: false } }
    : acrossWorkflow || across.run ? { kind: 'across', state: across }
    : bridgeSwapWorkflow ? { kind: 'unavailable', state: bridgeSwap }
    : bridgeWorkflow ? { kind: 'unavailable', state: bridge }
    : restoredLocalKind === 'composition' || state.workflow.nodes.some(n => n.actionType.includes('liquidity')) && state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input')
      ? { kind: 'composition', state: composition }
    : restoredLocalKind === 'fork-pool' || state.workflow.nodes.some(n => n.actionType.includes('liquidity')) ? { kind: 'fork-pool', state: liquidity }
    : restoredLocalKind === 'cow' || state.workflow.nodes.some(n => n.adapterConstraints.protocols.includes('cow-protocol'))
      ? { kind: 'unavailable', state: cow }
    : modeB.status?.prepared && !modeB.retired ? { kind: 'delegated-swap', state: modeB }
    : { kind: 'fork-swap', state: modeA };
  const reviewBinding = useReviewAuthorization(simulationSource.kind);
  const [restoredBinding, setRestoredBinding] = useState({ epoch: restorationEpoch, key: null as string | null });
  if (restoredBinding.epoch !== restorationEpoch) setRestoredBinding({ epoch: restorationEpoch, key: reviewBinding.authorization.key });
  if (restorationEpoch > 0 && (restoredBinding.epoch !== restorationEpoch || restoredBinding.key === reviewBinding.authorization.key))
    simulationSource = { ...simulationSource, state: { ...simulationSource.state, retired: true } } as SimulationSource;
  const executionProgress = useExecutionLifecycle(simulationSource.kind, reviewBinding.wallet);
  const executionStart = useExecutionStart(simulationSource.kind, reviewBinding.wallet);
  function openSimulationControls() {
    const details = document.querySelector<HTMLDetailsElement>('.simulation-technical');
    if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); details.querySelector<HTMLElement>('summary')?.focus(); }
  }
  const solanaReview = solanaLiquidity.record?.review;
  const simulateAgain = simulationSource.kind === 'router' ? routerState.simulate
    : simulationSource.kind === 'transfer' ? transfer.simulate
    : simulationSource.kind === 'lending' ? lending.simulate
    : simulationSource.kind === 'supply' ? supply.simulate
    : simulationSource.kind === 'uniswap-pool' ? uniswapLiquidity.simulate
    : simulationSource.kind === 'solana-pool' ? () => solanaLiquidity.simulate(solanaReview?.operation ?? 'OPEN', solanaReview?.operation === 'OPEN' ? undefined : solanaReview?.accounts.positionMint, solanaReview?.partBps ?? undefined)
    : simulationSource.kind === 'solana-swap' ? jupiter.simulate
    : simulationSource.kind === 'public' ? publicTestnet.simulate
    : simulationSource.kind === 'fork-swap' ? modeA.simulate
    : simulationSource.kind === 'delegated-swap' ? modeB.prepare
    : simulationSource.kind === 'composition' ? composition.prepare
    : openSimulationControls;
  const embeddedReview = <ReviewAuthorizationDetails workflowName={workflowName} workflow={state.workflow} context={context} source={simulationSource} authorization={reviewBinding.authorization} wallet={reviewBinding.wallet} invalidWorkflow={Boolean(reviewError)} backToBuild={() => setTab('Build')}/>;
  const simulationDisabled = authoringIncomplete || simulationSource.kind === 'unavailable' ||
    ('available' in simulationSource.state && simulationSource.state.available === false) ||
    ('info' in simulationSource.state && simulationSource.state.info?.available === false);
  const lifecycleState = { workflow: state.workflow, context, source: simulationSource, authorization: reviewBinding.authorization,
    wallet: reviewBinding.wallet, execution: executionStart, progress: executionProgress, recovery: executionProgress.recovery,
    invalidWorkflow: Boolean(reviewError || authoringIncomplete) };
  const lifecycleControls = useExecutionControls(lifecycleState);
  const simulateAction = <CanvasLifecycleAction {...lifecycleState} controls={lifecycleControls} workflowName={workflowName}
    simulationDisabled={simulationDisabled || !state.workflow.nodes.some(node => !node.actionType.startsWith('mock-'))}
    simulate={() => { setTab('Simulate'); return simulateAgain(); }} onExecute={() => setTab('Execute')}/>;
  if (secondaryRoute) return <div className="app-shell" inert={!interactive}><a className="skip-link" href="#workspace">{tr("Skip to workspace")}</a><TopBar tab={tab} setTab={setTab} pathname={pathname ?? null} engineering={engineering}/>
    <main id="workspace" className="main secondary-workspace" tabIndex={-1} aria-label={tr('{0} workspace', tr(secondaryRoute.label))}><SecondaryProductWorkspace workspace={secondaryRoute.id} workflows={{ ...workflows, loading: library.loading, connected: Boolean(owner), verification: owner && library.error === 'WALLET_SESSION_REQUIRED' ? <WorkflowVerification namespace={owner.namespace} account={owner.address} proof={proof}/> : undefined }}
      automations={{ owner, proof, onPropose: command => { propose(command); setTab('Build'); },
        canvas: automateCanvas ? { workflow: state.workflow, name: workflowName, dismiss: () => setAutomateCanvas(false) } : null }}/>
</main>
  </div>;
  if (tab === 'Dashboard') return <div className="app-shell" inert={!interactive}><a className="skip-link" href="#workspace">{tr("Skip to workspace")}</a><TopBar tab={tab} setTab={setTab} pathname={pathname ?? null} engineering={engineering}/>
    <main id="workspace" className="main" tabIndex={-1} aria-label={tr("Dashboard")}><DashboardWorkspace workflowName={workflowName} progress={executionProgress} recovery={executionProgress.recovery} wallet={reviewBinding.wallet} context={context}
      runId={dashboardRoute?.runId ?? null}
      build={() => setTab('Build')} execute={() => setTab('Execute')} navigate={navigate ?? (() => undefined)}/></main>
  </div>;
  if (authoringIncomplete && tab !== 'Build') return <div className="app-shell" inert={!interactive}><TopBar tab={tab} setTab={setTab} pathname={pathname ?? null} engineering={engineering}/><main className="main"><section className="panel stage-empty"><p>{tr("Configure the action amount in Build first.")}</p><button type="button" onClick={() => setTab('Build')}>{tr("Return to Build")}</button></section></main></div>;
  const stageContent = tab === 'Build' ? <><div className="build-grid"><WorkflowCanvas estimateOwner={solanaSession?.account.address} environment={walletEnvironment} selectedId={selectedId} select={selectAction} openSettings={openActionSettings} workflowName={workflowName} renameWorkflow={setWorkflowName} onAutomate={automationsReady ? () => { setAutomateCanvas(true); navigate?.('/app/automations'); } : undefined} onSave={() => void saveCurrentWorkflow()} onToolboxModeChange={setWorkspaceToolboxMode} primaryAction={simulateAction}/><CopilotPanel interactive={interactive} owner={owner} proof={proof}/></div>{verification}{saveNotice?.owner === ownerKey && <p role="status">{tr(saveNotice.message)}</p>}{library.busy && <p role="status">{tr('Saving workflow…')}</p>}{library.error && library.error !== 'WALLET_SESSION_REQUIRED' && <p role="alert">{tr(library.error === 'WORKFLOW_VERSION_CONFLICT' ? 'This workflow was updated in another session. Reopen it before saving.' : 'Workflow saving is unavailable. Try again.')}</p>}<ArtifactInspector selectedId={selectedId} select={selectAction} expanded={inspectorExpanded} onExpandedChange={setInspectorExpanded}/>
          {engineering && <EngineeringAuthoring selectedId={selectedId}><ReviewPanel/></EngineeringAuthoring>}</>
        : tab === 'Simulate' && engineering ? routerPath ? <RouterPanel view="simulate"/> : transferPath ? <RobinhoodTransferPanel view="simulate"/> : lendingPath ? <LendingPanel view="simulate"/> : withdrawPath ? <WithdrawPanel view="simulate"/> : repayPath ? <RepayPanel view="simulate"/> : borrowPath ? <BorrowPanel view="simulate"/> : supplyPath ? <SupplyPanel view="simulate"/> : uniswapLiquidityPath ? <UniswapLiquidityPanel view="simulate"/> : solanaLiquidityPath ? <SolanaLiquidityPanel view="simulate"/> : solanaPath ? <JupiterPanel view="simulate"/> : publicPath ? <PublicTestnetPanel view="simulate"/> : crossChainWorkflow ? <CrossChainLiquidityPanel view="simulate"/> : acrossWorkflow || across.run ? <AcrossPanel view="simulate"/> : bridgeSwapWorkflow ? <BridgeSwapPanel view="simulate"/> : bridgeWorkflow ? <BridgePanel view="simulate"/> : <SimulatePanel engineeringOnly workflowName={workflowName}><ReviewWorkspace workflowName={workflowName} workflow={state.workflow} context={context} source={simulationSource} authorization={reviewBinding.authorization} wallet={reviewBinding.wallet} invalidWorkflow={Boolean(reviewError)} backToBuild={() => setTab('Build')} simulateAgain={simulateAgain} actionSurface="canvas" showTechnicalDetails={false}/><ObservationPanel/><ForkSimulationPanel/><ModeBPanel view="simulate"/><CompositionPanel view="simulate"/><CowPanel view="simulate"/><LiquidityPanel view="simulate"/></SimulatePanel>
        : executionSurface ? routerPath ? <RouterPanel view="execute"/> : transferPath ? <RobinhoodTransferPanel view="execute"/> : lendingPath ? <LendingPanel view="execute"/> : withdrawPath ? <WithdrawPanel view="execute"/> : repayPath ? <RepayPanel view="execute"/> : borrowPath ? <BorrowPanel view="execute"/> : supplyPath ? <SupplyPanel view="execute"/> : uniswapLiquidityPath ? <UniswapLiquidityPanel view="execute"/> : solanaLiquidityPath ? <SolanaLiquidityPanel view="execute"/> : solanaPath ? <JupiterPanel view="execute"/> : publicPath ? <PublicTestnetPanel view="execute"/> : persistedBuild009Recovery ? <BridgeSwapPanel view="execute"/> : across.recovered ? <AcrossPanel view="execute"/> :
          bridge.recoveryOnly ? <BridgePanel view="execute"/> : modeA.recoveryOnly || modeB.recoveryOnly ||
          composition.recoveryOnly || liquidity.recoveryOnly || cow.recoveryOnly ?
            <><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></> :
          crossChainWorkflow ? <CrossChainLiquidityPanel view="execute"/> : across.run ? <AcrossPanel view="execute"/> :
          bridgeSwap.run ? <BridgeSwapPanel view="execute"/> : bridge.execution ? <BridgePanel view="execute"/> :
          <><ExecutionPanel/><ModeBPanel view="execute"/><CompositionPanel view="execute"/><CowPanel view="execute"/><LiquidityPanel view="execute"/></>
        : null;
  return <div className="app-shell" inert={!interactive}><a className="skip-link" href="#workspace">{tr("Skip to workspace")}</a><TopBar tab={tab} setTab={setTab} pathname={pathname ?? null} engineering={engineering}/>
    <AutomationInbox owner={owner} proven={Boolean(owner && proof.proven === owner.address)} open={() => navigate?.('/app/automations')}/>
    <main id="workspace" className={`main workflow-workspace${tab === 'Build' ? ' build-workspace' : ''}`} data-workspace-toolbox={workspaceToolboxMode} tabIndex={-1} aria-label={tr(tab === 'Build' ? 'Workflow workspace' : tab === 'Simulate' ? 'Simulation workspace' : 'Execution workspace')}>
      {tab === 'Execute' ? <ExecuteWorkspace controls={lifecycleControls} primaryAction={simulateAction} workflowName={workflowName} workflow={state.workflow} context={context} source={simulationSource} authorization={reviewBinding.authorization} wallet={reviewBinding.wallet} execution={executionStart} progress={executionProgress} recovery={executionProgress.recovery} invalidWorkflow={Boolean(reviewError || authoringIncomplete)} backToBuild={() => setTab('Build')} backToSimulate={() => setTab('Simulate')} technicalDetails={executionStart.started || executionProgress.started || recoveryPath || localCowIntent ? stageContent : undefined}/> : tab === 'Simulate' ?
        <SimulateWorkspace workflowName={workflowName} returnToBuild={() => setTab('Build')} simulationSource={simulationSource} review={embeddedReview} simulateAction={simulateAction}>
          {engineering && <details className="shell-details technical-workspace simulation-technical"><summary>{tr('View technical details')}</summary><ReviewTechnicalDetails authorization={reviewBinding.authorization}/>{stageContent}</details>}
        </SimulateWorkspace> : stageContent}
      <MobileBuildNavigation stage={tab === 'Build' ? 'Build' : tab === 'Simulate' ? 'Simulate' : 'Execute'}/>
      {state.error && <div className="error-banner" role="alert"><strong>{tr("Edit not applied")}</strong><span>{tr(tab !== 'Build' ? 'Review the workflow configuration in Build before simulating again.' : state.error)}</span></div>}
    </main>{tab !== 'Execute' && <SummaryBar tab={tab} setTab={setTab} canvasOwnsAction/>}
  </div>;
}

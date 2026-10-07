// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createPortal } from 'react-dom';
import { useModeA } from '../state/mode-a-store';
import { useModeB } from '../state/mode-b-store';
import { usePublicTestnet } from '../state/public-testnet-store';
import { useWorkflow } from '../state/workflow-store';
import type { Tab } from './top-bar';
import { workflowShellContext } from '../domain/product-shell';

import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import {useLending} from '../state/lending-store';
import { useSupply } from '../state/supply-store';
import { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import { useJupiter } from '../state/jupiter-store';
import { useSolanaLiquidity } from '../state/solana-liquidity-store';

export function SummaryBar({ tab, setTab, simulationActionHost, reviewAvailable, focusReview }: { tab: Tab; setTab: (value: Tab) => void; simulationActionHost?: HTMLDivElement | null; reviewAvailable?: boolean; focusReview?: () => void }) {
  const { state, actionSetup } = useWorkflow();
  const { info, prepared, retired, verifyError, verified } = useModeA();
  const modeB = useModeB();
  const supply = useSupply(),lending=useLending();
  const lendingPath=isLendingComposition(state.workflow)||Boolean(lending.recovered&&lending.record&&!lending.retired);
  const supplyPath = state.workflow.nodes.some(n => ['supply','borrow','repay','withdraw'].includes(n.actionType)) || Boolean(supply.recovered && supply.record);
  const transfer = useRobinhoodTransfer(), transferPath = state.workflow.nodes.some(n => n.actionType === 'asset.transfer');
  const jupiter = useJupiter();
  const solanaLiquidity = useSolanaLiquidity();
  const solanaLiquidityPath = !supplyPath && (state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated') || Boolean(solanaLiquidity.recovered && solanaLiquidity.record));
  const solanaPath = !supplyPath && !solanaLiquidityPath && (state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId.startsWith('solana:')) || Boolean(jupiter.recovered && jupiter.record));
  const publicTestnet = usePublicTestnet();
  const testnetWorkflow = state.workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && ['eip155:84532', 'eip155:11155111'].includes(node.chainId));
  const publicPath = testnetWorkflow || Boolean(publicTestnet.recoveryOnly && publicTestnet.run);
  const reviewable = Boolean(info?.available && prepared && !retired && !verifyError && verified['step-approve'] && verified['step-swap']);
  const actionCount = workflowShellContext(state.workflow).actionCount + (actionSetup ? 1 : 0);
  const action = tab === 'Build' || tab === 'Simulate' && reviewAvailable === false ? null
      : tab === 'Simulate' && transferPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false || !transfer.record || transfer.retired}>Review transfer</button>
      : tab === 'Simulate' && lendingPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false || !lending.record||lending.retired}>Review lending composition</button>
      : lendingPath ? <button type="button" onClick={()=>setTab('Simulate')}>Back to simulation</button>
      : tab === 'Simulate' && supplyPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false || !supply.record || supply.retired}>{state.workflow.nodes.some(n=>n.actionType==='withdraw')||supply.record?.review.withdraw?'Review Withdraw':state.workflow.nodes.some(n=>n.actionType==='repay')||supply.record?.review.repay?'Review Repay':state.workflow.nodes.some(n=>n.actionType==='borrow')||supply.record?.review.borrow?'Review Borrow':'Review Supply'}</button>
      : tab === 'Simulate' && solanaLiquidityPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false || !solanaLiquidity.record || solanaLiquidity.retired}>Review position</button>
      : solanaLiquidityPath ? <button type="button" onClick={() => setTab('Simulate')}>Back to simulation</button>
      : tab === 'Simulate' && solanaPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false || !jupiter.record || jupiter.retired}>Review swap</button>
      : solanaPath ? <button type="button" onClick={() => setTab('Simulate')}>Back to simulation</button>
      : tab === 'Simulate' && publicPath ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review"
          disabled={reviewAvailable === false || !publicTestnet.run || publicTestnet.retired}>Review swap</button>
      : tab === 'Simulate' && reviewAvailable ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review">Review authorization</button>
      : tab === 'Simulate' && modeB.info?.available && modeB.status?.prepared ?
          <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review" disabled={reviewAvailable === false}>Review permission</button>
      : tab === 'Simulate' ? <button type="button" className="primary" onClick={focusReview} aria-controls="simulation-review"
          disabled={reviewAvailable === false || !reviewable}>Review swap</button>
      : publicPath ? <button type="button" onClick={() => setTab('Simulate')}>Back to simulation</button>
      : modeB.info?.available ? <button type="button" onClick={() => setTab('Simulate')}>Back to simulation</button>
      : prepared && info?.available ? <button type="button" onClick={() => setTab('Simulate')}>Back to simulation</button>
      : <button type="button" onClick={() => setTab('Build')}>Back to Build</button>;
  return <footer className="summary-bar" data-workflow-revision={state.workflow.revision}>
    <div><span className="eyebrow">WORKFLOW</span><strong>{actionCount} {actionCount === 1 ? 'action' : 'actions'}</strong></div>
    {/* Relocate the existing action without duplicating its review gates or handler. */}
    {tab === 'Simulate' && simulationActionHost ? createPortal(action, simulationActionHost) : action}
  </footer>;
}

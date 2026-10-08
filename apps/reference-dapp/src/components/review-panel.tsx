// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useWorkflow } from '../state/workflow-store';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
export function ReviewPanel() {
  const { t: tr } = useLocale();
  const { review, reviewError, state } = useWorkflow();
  const cross = (() => { try { return state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.prepare') ? validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]) : null; } catch { return null; } })();
  const reviewable = state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' || n.actionType === BRIDGE_ACTION);
  if (!reviewable && !reviewError) return null;
  return <section className="review-panel panel" aria-label={tr("Deterministic review findings")}>
    <div><p className="eyebrow">{tr("REVIEW")}</p><h2>{tr("Workflow checks")}</h2>
      <p className="muted">{tr("Review workflow changes before simulation.")}</p></div>
    {cross && <div className="review-workflow-summary" aria-label={tr("Cross-chain composition review")}><h3>{tr("Base → Arbitrum liquidity composition")}</h3><ul>
      <li>{tr("Source: ")}{tr(Number(cross.bridgeAmount) / 1e6)}{tr(" USDC on Base. Destination: native USDC on Arbitrum.")}</li>
      <li>{tr("Bridge provider: ")}{tr(cross.bridgeProvider === 'lifi.rest' ? 'LI.FI' : 'Across direct')}{tr(" · maximum bridge slippage ")}{tr(cross.bridgeSlippageBps)}{tr(" bps. Estimated output awaits a fresh quote; the actual amount is taken from destination reconciliation.")}</li>
      <li>{tr("Preparation: compute the Uniswap v3 range ratio from the observed pool state and actual Arbitrum USDC. ")}{tr(cross.noSwap ? 'No swap; USDC-only range.' : `Swap only the calculated USDC portion through LI.FI; maximum slippage ${cross.swapSlippageBps} bps.`)}</li>
      <li>{tr("Liquidity: WETH / native USDC, 0.05% fee tier, ticks ")}{tr(cross.tickLower)}{tr(" to ")}{tr(cross.tickUpper)}{tr(". LP recipient: ")}{tr(cross.recipient)}.</li>
      <li>{tr("Expected deposits and residual WETH/USDC depend on the fresh pool read, reconciled bridge and swap outputs. Destination ETH must independently cover swap and mint gas; no automatic acquisition is included.")}</li>
      <li>{tr("Authorization: Mode A review binds the provider, targets, assets, recipient, amounts, gas and quote expiry. A changed split or route needs a new review.")}</li>
      <li>{tr("Boundaries: source wallet → bridge in flight → destination wallet → swap result → reconciled LP NFT and residual wallet balances. These stages are not globally atomic.")}</li>
    </ul></div>}
    {reviewError ? <p className="review-block" role="alert">{tr("Workflow review blocked: ")}{tr(reviewError)}{tr(". Check the graph before adding a swap.")}</p> : <ul>
      {review?.findings.map(finding => <li key={`${finding.nodeId}-${finding.code}`} className={finding.severity === 'BLOCK' ? 'review-block' : 'review-warning'}>
        <strong>{tr(finding.severity)} · {tr(finding.code)}</strong><span>{finding.nodeId} / {tr(finding.field)}: {tr(finding.message)}</span>
      </li>)}
    </ul>}
    <details className="review-workflow-ir"><summary>{tr("Workflow IR")}</summary><pre data-workflow-ir="">{JSON.stringify(state.workflow, null, 2)}</pre></details>
  </section>;
}

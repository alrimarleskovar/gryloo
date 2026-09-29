// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflow } from '../state/workflow-store';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
export function ReviewPanel() {
  const { review, reviewError, state } = useWorkflow();
  const cross = (() => { try { return state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.prepare') ? validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]) : null; } catch { return null; } })();
  const reviewable = state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' || n.actionType === BRIDGE_ACTION);
  if (!reviewable && !reviewError) return null;
  return <section className="review-panel panel" aria-label="Deterministic review findings">
    <div><p className="eyebrow">REVIEW</p><h2>Workflow checks</h2>
      <p className="muted">Authoring and lint are implemented. Simulate offers MOCKED artifacts; Base execution is unavailable. Only an explicitly started local-fork acceptance environment offers Mode A wallet requests, on chain 31337. Review is not financial enforcement.</p></div>
    {cross && <div className="review-workflow-summary" aria-label="Cross-chain composition review"><h3>Base → Arbitrum liquidity composition</h3><ul>
      <li>Source: {Number(cross.bridgeAmount) / 1e6} USDC on Base. Destination: native USDC on Arbitrum.</li>
      <li>Bridge provider: {cross.bridgeProvider === 'lifi.rest' ? 'LI.FI' : 'Across direct'} · maximum bridge slippage {cross.bridgeSlippageBps} bps. Estimated output awaits a fresh quote; the actual amount is taken from destination reconciliation.</li>
      <li>Preparation: compute the Uniswap v3 range ratio from the observed pool state and actual Arbitrum USDC. {cross.noSwap ? 'No swap; USDC-only range.' : `Swap only the calculated USDC portion through LI.FI; maximum slippage ${cross.swapSlippageBps} bps.`}</li>
      <li>Liquidity: WETH / native USDC, 0.05% fee tier, ticks {cross.tickLower} to {cross.tickUpper}. LP recipient: {cross.recipient}.</li>
      <li>Expected deposits and residual WETH/USDC depend on the fresh pool read, reconciled bridge and swap outputs. Destination ETH must independently cover swap and mint gas; no automatic acquisition is included.</li>
      <li>Authorization: Mode A review binds the provider, targets, assets, recipient, amounts, gas and quote expiry. A changed split or route needs a new review.</li>
      <li>Boundaries: source wallet → bridge in flight → destination wallet → swap result → reconciled LP NFT and residual wallet balances. These stages are not globally atomic.</li>
    </ul></div>}
    {reviewError ? <p className="review-block" role="alert">Workflow review blocked: {reviewError}. Check the graph before adding a swap.</p> : <ul>
      {review?.findings.map(finding => <li key={`${finding.nodeId}-${finding.code}`} className={finding.severity === 'BLOCK' ? 'review-block' : 'review-warning'}>
        <strong>{finding.severity} · {finding.code}</strong><span>{finding.nodeId} / {finding.field}: {finding.message}</span>
      </li>)}
    </ul>}
    <details className="review-workflow-ir"><summary>Workflow IR</summary><pre data-workflow-ir="">{JSON.stringify(state.workflow, null, 2)}</pre></details>
  </section>;
}

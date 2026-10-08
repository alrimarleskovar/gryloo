// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useComposition } from '../state/composition-store';
import { useWorkflow } from '../state/workflow-store';
export function CompositionPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const { state } = useWorkflow();
  const flow = useComposition();
  if (!flow.info?.available) return null;
  const graph = state.workflow.nodes.length === 2 && state.workflow.resourceEdges.length === 1 &&
    state.workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && node.requiredAuthorizationClass === 'MODE_B') &&
    state.workflow.nodes.some(node => node.actionType === 'asset.liquidity.uniswap-v3' && node.requiredAuthorizationClass === 'MODE_B');
  const prepared = flow.status?.prepared;
  const installed = Boolean(prepared && prepared.installation.length === prepared.compiled.installation.length);
  const events = flow.status?.events ?? [];
  const latest = events.filter(event => event.level === 'ATTEMPT').at(-1);
  const swap = events.filter(event => event.level === 'ATTEMPT' && event.step === 'SWAP').at(-1);
  const mint = events.filter(event => event.level === 'ATTEMPT' && event.step === 'MINT').at(-1);
  const completed = mint?.state === 'RECONCILED';
  const partial = swap?.state === 'RECONCILED' && mint?.state === 'REVERTED';
  return <section className="panel" aria-label={tr("Mode B swap to liquidity composition")}>
    <p className="eyebrow">{tr("Local demo · Base position")}</p>
    <h2>{tr("Swap → position")}</h2>
    <p>{tr("Base USDC → WETH, then one Uniswap v3 WETH/USDC 0.05% position owned by the Safe.")}</p>
    <p className="muted">{tr(flow.info.environment === 'FORK_REPRODUCED' ? 'Recorded Base state is replayed locally.' :
      'Synthetic Base-like source state is used for this mocked test.')}{tr(" Wallet setup and executor calls have no public-chain effect.")}</p>
    {view === 'simulate' && <>
      {!graph && <p role="status">{tr("Author the two-node Mode B composition in Build to prepare a review.")}</p>}
      <button type="button" onClick={flow.prepare} disabled={!graph || Boolean(flow.busy)} aria-busy={flow.busy === 'Preparing composition'}>{tr("Prepare chained review")}</button>
    </>}
    {prepared && <>
      <dl className="review-facts">
        <div><dt>{tr("Safe and NFT owner")}</dt><dd>{tr(flow.info.safe)}</dd></div>
        <div><dt>{tr("Executor")}</dt><dd>{tr(flow.info.executor)}</dd></div>
        <div><dt>{tr("Swap input")}</dt><dd>{tr(prepared.terms.swap.amountIn)}{tr(" USDC units")}</dd></div>
        <div><dt>{tr("Minimum WETH output")}</dt><dd>{tr(prepared.minimumOut)}{tr(" wei")}</dd></div>
        <div><dt>{tr("Mint caps")}</dt><dd>{tr(prepared.terms.maxWETH)}{tr(" WETH wei; ")}{tr(prepared.terms.maxUSDC)}{tr(" USDC units")}</dd></div>
        <div><dt>{tr("Total USDC budget")}</dt><dd>{tr(prepared.terms.totalUSDCBudget)}{tr(" units")}</dd></div>
        <div><dt>{tr("Ticks")}</dt><dd>{tr(prepared.terms.tickLower)}{tr(" to ")}{tr(prepared.terms.tickUpper)}</dd></div>
        <div><dt>{tr("Owner setup")}</dt><dd>{tr(prepared.installation.length)} / {tr(prepared.compiled.installation.length)}{tr(" confirmed")}</dd></div>
        <div><dt>{tr("Permission hash")}</dt><dd>{tr(prepared.compiled.permissionHash)}</dd></div>
        <div><dt>{tr("Manifest hash")}</dt><dd>{prepared.artifacts.hashes.manifestHash}</dd></div>
      </dl>
      <p className="muted">{tr("Roles limits target, selector, pair, recipient, ticks, desired amounts and one call per step. Uniswap checks output minimums and deadlines. The Safe owner keeps broader authority. Gas and step order are application checks.")}</p>
      {flow.retired && <p role="alert">{tr("The workflow changed. This review is retired; prepare a new one. You may still inspect or revoke its authority.")}</p>}
      {flow.recoveryOnly && <p role="status">{tr("A prior execution was loaded after browser restart. Inspect chain status and revoke if needed.")}</p>}
      {flow.unknownSubmission && <p role="alert">{tr("Wallet submission is uncertain. Do not repeat the owner step until the transaction is independently found or ruled out.")}</p>}
      {!flow.wallet && <button type="button" onClick={flow.connect} disabled={Boolean(flow.busy)}>{tr("Connect disposable owner wallet")}</button>}
      <button type="button" onClick={flow.acceptReview} disabled={flow.reviewed || Boolean(flow.busy)}>{tr(flow.reviewed ? 'Review acknowledged' : 'I reviewed this finite authority')}</button>
      {flow.wallet && flow.reviewed && !installed && <button type="button" onClick={flow.installNext}
        disabled={Boolean(flow.busy) || flow.retired || flow.recoveryOnly || flow.unknownSubmission}>{tr("Request next exact owner signature")}</button>}
      {view === 'execute' && <>
        <p role="status">{tr("Swap: ")}{tr(swap?.state ?? 'WAITING')}{tr(" · Mint: ")}{tr(mint?.state ?? 'WAITING')}</p>
        {partial && <p role="alert">{tr("Partial completion: swap reconciled, mint reverted. WETH and USDC remain in the Safe. Review residuals and revoke; no automatic swap back.")}</p>}
        {completed && <p role="status">{tr("Reconciled Safe-owned position NFT #")}{tr(mint.tokenId)}{tr(". Principal deposits are not earned fees.")}</p>}
        {flow.status && <p className="muted">{tr("One-use calls remaining: swap ")}{tr(flow.status.swapCalls)}{tr(", mint ")}{tr(flow.status.mintCalls)}{tr(". Safe token approvals: router USDC ")}{tr(flow.status.routerUSDC)}{tr(", manager USDC ")}{tr(flow.status.managerUSDC)}{tr(", manager WETH ")}{tr(flow.status.managerWETH)}.</p>}
        <button type="button" onClick={flow.runWorker} disabled={!installed || !flow.reviewed || flow.retired || flow.recoveryOnly ||
          Boolean(flow.busy) || completed || partial || latest?.state === 'INCONCLUSIVE'}>{tr("Run or observe fixed worker")}</button>
        <button type="button" onClick={flow.recoverKnown} disabled={Boolean(flow.busy) || latest?.state !== 'INCONCLUSIVE' || !latest.transactionHash}>{tr("Recheck known transaction receipt")}</button>
        <button type="button" onClick={flow.refresh} disabled={Boolean(flow.busy)}>{tr("Refresh fork status")}</button>
        {flow.wallet && flow.reviewed && prepared.revocation.length < prepared.compiled.revocation.length &&
          <button type="button" onClick={flow.revokeNext} disabled={Boolean(flow.busy) || flow.unknownSubmission}>{tr("Request next revocation signature")}</button>}
      </>}
    </>}
    {flow.busy && <p role="status">{tr(flow.busy)}…</p>}
    {flow.error && <p role="alert">{tr(flow.error)}{tr(". Review the fork status before another action.")}</p>}
  </section>;
}

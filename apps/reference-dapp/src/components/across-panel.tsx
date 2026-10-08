// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useAcross } from '../state/across-store';
import { useBuild009Wallet, BASE_HEX } from '../state/build009-wallet-store';
import { useWorkflow } from '../state/workflow-store';
export function AcrossPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const flow = useAcross(); const wallet = useBuild009Wallet(); const { state } = useWorkflow();
  const eligible = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.adapterConstraints.adapters[0]?.id === 'across.direct';
  const run = flow.run, quote = run?.quote, current = run?.state;
  if (view === 'execute' && !run) return null;
  const ready = Boolean(wallet.account && wallet.chainId === BASE_HEX && (!run || wallet.account === quote?.owner));
  const fresh = Boolean(quote && Date.parse(quote.quoteExpiresAt) > Date.now());
  return <section className="bridge-panel panel" role="region" aria-label={tr("Direct Across bridge")}>
    <div className="simulate-head"><div><p className="eyebrow">{tr("Across · Base → Arbitrum")}</p><h2>{tr("Bridge USDC directly")}</h2>
      <p className="muted">{tr("Across quotes are read only. Approval, deposit, fill, recovery and refund below are simulated. Your wallet will not sign or submit a transaction.")}</p></div>
      <span className="local-tag">{tr("Demo mode")}</span></div>
    {view === 'simulate' && <div className="bridge-controls">
      <p>{tr(flow.liveQuoteAvailable ? 'Across credentials configured for read-only quotes.' : 'Using an Across fixture; live quote verification is pending.')}</p>
      <button type="button" onClick={flow.quote} disabled={!eligible || !ready || flow.busy}>{tr("Get direct Across quote")}</button>
      {!ready && <p>{tr("Connect your wallet on Base to review this bridge.")}</p>}
    </div>}
    {flow.error && <p role="alert" className="simulate-alert">{tr(flow.error)}</p>}
    {flow.busy && <p role="status">{tr("Updating bridge…")}</p>}
    {run && quote && <div className="bridge-review">
      <div className="bridge-status"><strong>{tr("Bridge state")}</strong><span data-across-state={current} className="step-status">{tr(current)}</span>
        <span>{tr("Run ")}<code>{run.executionId}</code></span></div>
      {flow.recovered && <p>{tr("Recovered bridge history. Existing deposit can be checked; a new financial submission stays closed.")}</p>}
      {flow.retired && <p role="alert">{tr("The workflow or wallet changed. Review a new quote before another submission.")}</p>}
      <div className="bridge-grid"><article className="step-card"><h3>{tr("Across quote")}</h3><dl className="step-facts">
        <div><dt>{tr("Provider")}</dt><dd>{tr("Across direct · ")}{tr(quote.provenance === 'LIVE_READ_ONLY' ? 'Live read-only' : 'Deterministic fixture')}</dd></div>
        <div><dt>{tr("Route")}</dt><dd>{tr("Base USDC → Arbitrum USDC")}</dd></div>
        <div><dt>{tr("Input")}</dt><dd>{tr(quote.inputAmount)}{tr(" native USDC units")}</dd></div>
        <div><dt>{tr("Minimum output")}</dt><dd>{tr(quote.minimumOutput)}{tr(" native USDC units")}</dd></div>
        <div><dt>{tr("Quote expires")}</dt><dd>{tr(quote.quoteExpiresAt)}</dd></div>
        <div><dt>{tr("Expected fill")}</dt><dd>{tr(quote.expectedFillSeconds)}{tr(" seconds (estimate)")}</dd></div>
        <div><dt>{tr("Refund")}</dt><dd>{tr("Origin Base · ")}{tr(quote.refundAddress)}</dd></div>
      </dl></article><article className="step-card"><h3>{tr("Approval and prepared deposit")}</h3><dl className="step-facts">
        <div><dt>{tr("Approval transactions")}</dt><dd>{tr(quote.approvals.length)}</dd></div>
        <div><dt>{tr("Approval spender")}</dt><dd><code>{tr(quote.approvalSpender)}</code></dd></div>
        <div><dt>{tr("Deposit target")}</dt><dd><code>{tr(quote.deposit.to)}</code></dd></div>
        <div><dt>{tr("Fixed provider")}</dt><dd>{tr(run.review.provider.providerId)}</dd></div>
        <div><dt>{tr("Manifest hash")}</dt><dd><code data-across-manifest>{run.review.manifestHash}</code></dd></div>
      </dl><details><summary>{tr("Exact review data")}</summary><p>{tr("Deposit calldata ")}<code>{tr(quote.deposit.data)}</code></p>
        <p>{tr("Deposit payload hash ")}<code>{tr(run.review.depositHash)}</code></p></details></article></div>
      {!fresh && ['QUOTED','AUTHORIZED','APPROVAL_CONFIRMED','DEPOSIT_PREPARED'].includes(current ?? '') &&
        <p role="alert">{tr("Quote expired. Request a fresh quote and review again.")}</p>}
      {view === 'execute' && <div className="bridge-controls">
        {current === 'QUOTED' && <button type="button" onClick={flow.authorize} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>{tr("Authorize fixed Across review for demo")}</button>}
        {current === 'AUTHORIZED' && <button type="button" onClick={flow.approve} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>{tr("Simulate approval requirements")}</button>}
        {current === 'APPROVAL_CONFIRMED' && <button type="button" onClick={flow.prepare} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>{tr("Prepare deposit transaction")}</button>}
        {current === 'DEPOSIT_PREPARED' && <><label htmlFor="across-uncertain"><input id="across-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/>{tr(" Simulate uncertain response")}</label>
          <button type="button" onClick={flow.submit} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>{tr("Simulate source deposit")}</button></>}
        {current === 'DEPOSIT_UNKNOWN' && <button type="button" onClick={flow.recheck} disabled={flow.busy}>{tr("Recheck existing deposit")}</button>}
        {current === 'DEPOSIT_SUBMITTED' && <button type="button" onClick={flow.confirmSource} disabled={flow.busy}>{tr("Check source deposit")}</button>}
        {current === 'SOURCE_CONFIRMED' && <><button type="button" onClick={flow.progress} disabled={flow.busy}>{tr("Track destination fill")}</button><button type="button" onClick={flow.expire} disabled={flow.busy}>{tr("Simulate fill deadline")}</button></>}
        {['FILL_PENDING','FILL_DELAYED'].includes(current ?? '') && <><button type="button" onClick={flow.delay} disabled={flow.busy}>{tr("Show delayed fill")}</button><button type="button" onClick={flow.fill} disabled={flow.busy}>{tr("Confirm destination fill")}</button><button type="button" onClick={flow.expire} disabled={flow.busy}>{tr("Simulate fill deadline")}</button></>}
        {current === 'FILLED' && <button type="button" onClick={flow.reconcile} disabled={flow.busy}>{tr("Reconcile destination receipt and balance")}</button>}
        {current === 'REFUND_ELIGIBLE' && <button type="button" onClick={flow.refundPending} disabled={flow.busy}>{tr("Track pending refund")}</button>}
        {current === 'REFUND_PENDING' && <button type="button" onClick={flow.refundConfirm} disabled={flow.busy}>{tr("Confirm simulated refund")}</button>}
        <button type="button" className="quiet" onClick={flow.refresh} disabled={flow.busy}>{tr("Reload history")}</button>
      </div>}
      <details><summary>{tr("Execution history")}</summary><ol>{run.events.map(event => <li key={event.sequence}>{tr(event.state)}: {tr(event.note)}</li>)}</ol></details>
      {run.received && <p data-across-received="">{tr("Simulated reconciled destination USDC: ")}{tr(run.received)}</p>}
      {run.refundHash && <p>{tr("Simulated refund confirmed: ")}<code>{tr(run.refundHash)}</code></p>}
    </div>}
  </section>;
}

// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useAcross } from '../state/across-store';
import { useBuild009Wallet, BASE_HEX } from '../state/build009-wallet-store';
import { useWorkflow } from '../state/workflow-store';
export function AcrossPanel({ view }: { view: 'simulate' | 'execute' }) {
  const flow = useAcross(); const wallet = useBuild009Wallet(); const { state } = useWorkflow();
  const eligible = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.adapterConstraints.adapters[0]?.id === 'across.direct';
  const run = flow.run, quote = run?.quote, current = run?.state;
  if (view === 'execute' && !run) return null;
  const ready = Boolean(wallet.account && wallet.chainId === BASE_HEX && (!run || wallet.account === quote?.owner));
  const fresh = Boolean(quote && Date.parse(quote.quoteExpiresAt) > Date.now());
  return <section className="bridge-panel panel" role="region" aria-label="Direct Across bridge">
    <div className="simulate-head"><div><p className="eyebrow">Across · Base → Arbitrum</p><h2>Bridge USDC directly</h2>
      <p className="muted">Across quotes are read only. Approval, deposit, fill, recovery and refund below are simulated. Your wallet will not sign or submit a transaction.</p></div>
      <span className="local-tag">Demo mode</span></div>
    {view === 'simulate' && <div className="bridge-controls">
      <p>{flow.liveQuoteAvailable ? 'Across credentials configured for read-only quotes.' : 'Using an Across fixture; live quote verification is pending.'}</p>
      <button type="button" onClick={flow.quote} disabled={!eligible || !ready || flow.busy}>Get direct Across quote</button>
      {!ready && <p>Connect your wallet on Base to review this bridge.</p>}
    </div>}
    {flow.error && <p role="alert" className="simulate-alert">{flow.error}</p>}
    {flow.busy && <p role="status">Updating bridge…</p>}
    {run && quote && <div className="bridge-review">
      <div className="bridge-status"><strong>Bridge state</strong><span data-across-state={current} className="step-status">{current}</span>
        <span>Run <code>{run.executionId}</code></span></div>
      {flow.recovered && <p>Recovered bridge history. Existing deposit can be checked; a new financial submission stays closed.</p>}
      {flow.retired && <p role="alert">The workflow or wallet changed. Review a new quote before another submission.</p>}
      <div className="bridge-grid"><article className="step-card"><h3>Across quote</h3><dl className="step-facts">
        <div><dt>Provider</dt><dd>Across direct · {quote.provenance === 'LIVE_READ_ONLY' ? 'Live read-only' : 'Deterministic fixture'}</dd></div>
        <div><dt>Route</dt><dd>Base USDC → Arbitrum USDC</dd></div>
        <div><dt>Input</dt><dd>{quote.inputAmount} native USDC units</dd></div>
        <div><dt>Minimum output</dt><dd>{quote.minimumOutput} native USDC units</dd></div>
        <div><dt>Quote expires</dt><dd>{quote.quoteExpiresAt}</dd></div>
        <div><dt>Expected fill</dt><dd>{quote.expectedFillSeconds} seconds (estimate)</dd></div>
        <div><dt>Refund</dt><dd>Origin Base · {quote.refundAddress}</dd></div>
      </dl></article><article className="step-card"><h3>Approval and prepared deposit</h3><dl className="step-facts">
        <div><dt>Approval transactions</dt><dd>{quote.approvals.length}</dd></div>
        <div><dt>Approval spender</dt><dd><code>{quote.approvalSpender}</code></dd></div>
        <div><dt>Deposit target</dt><dd><code>{quote.deposit.to}</code></dd></div>
        <div><dt>Fixed provider</dt><dd>{run.review.provider.providerId}</dd></div>
        <div><dt>Manifest hash</dt><dd><code data-across-manifest>{run.review.manifestHash}</code></dd></div>
      </dl><details><summary>Exact review data</summary><p>Deposit calldata <code>{quote.deposit.data}</code></p>
        <p>Deposit payload hash <code>{run.review.depositHash}</code></p></details></article></div>
      {!fresh && ['QUOTED','AUTHORIZED','APPROVAL_CONFIRMED','DEPOSIT_PREPARED'].includes(current ?? '') &&
        <p role="alert">Quote expired. Request a fresh quote and review again.</p>}
      {view === 'execute' && <div className="bridge-controls">
        {current === 'QUOTED' && <button type="button" onClick={flow.authorize} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>Authorize fixed Across review for demo</button>}
        {current === 'AUTHORIZED' && <button type="button" onClick={flow.approve} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>Simulate approval requirements</button>}
        {current === 'APPROVAL_CONFIRMED' && <button type="button" onClick={flow.prepare} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>Prepare deposit transaction</button>}
        {current === 'DEPOSIT_PREPARED' && <><label htmlFor="across-uncertain"><input id="across-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/> Simulate uncertain response</label>
          <button type="button" onClick={flow.submit} disabled={!ready || !fresh || flow.recovered || flow.retired || flow.busy}>Simulate source deposit</button></>}
        {current === 'DEPOSIT_UNKNOWN' && <button type="button" onClick={flow.recheck} disabled={flow.busy}>Recheck existing deposit</button>}
        {current === 'DEPOSIT_SUBMITTED' && <button type="button" onClick={flow.confirmSource} disabled={flow.busy}>Check source deposit</button>}
        {current === 'SOURCE_CONFIRMED' && <><button type="button" onClick={flow.progress} disabled={flow.busy}>Track destination fill</button><button type="button" onClick={flow.expire} disabled={flow.busy}>Simulate fill deadline</button></>}
        {['FILL_PENDING','FILL_DELAYED'].includes(current ?? '') && <><button type="button" onClick={flow.delay} disabled={flow.busy}>Show delayed fill</button><button type="button" onClick={flow.fill} disabled={flow.busy}>Confirm destination fill</button><button type="button" onClick={flow.expire} disabled={flow.busy}>Simulate fill deadline</button></>}
        {current === 'FILLED' && <button type="button" onClick={flow.reconcile} disabled={flow.busy}>Reconcile destination receipt and balance</button>}
        {current === 'REFUND_ELIGIBLE' && <button type="button" onClick={flow.refundPending} disabled={flow.busy}>Track pending refund</button>}
        {current === 'REFUND_PENDING' && <button type="button" onClick={flow.refundConfirm} disabled={flow.busy}>Confirm simulated refund</button>}
        <button type="button" className="quiet" onClick={flow.refresh} disabled={flow.busy}>Reload history</button>
      </div>}
      <details><summary>Execution history</summary><ol>{run.events.map(event => <li key={event.sequence}>{event.state}: {event.note}</li>)}</ol></details>
      {run.received && <p data-across-received="">Simulated reconciled destination USDC: {run.received}</p>}
      {run.refundHash && <p>Simulated refund confirmed: <code>{run.refundHash}</code></p>}
    </div>}
  </section>;
}

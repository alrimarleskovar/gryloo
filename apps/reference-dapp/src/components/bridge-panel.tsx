// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState } from 'react';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';
import { useBridge } from '../state/bridge-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
function units(value: string, decimals: number): string {
  if (!/^[0-9]+$/.test(value)) return '--';
  const padded = value.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fractional = padded.slice(-decimals).replace(/0+$/, '');
  return whole + (fractional ? '.' + fractional : '');
}
export function BridgePanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const bridge = useBridge();
  const { state } = useWorkflow();
  const eligible = state.workflow.nodes.length === 1 && state.workflow.nodes[0]?.actionType === BRIDGE_ACTION;
  if (!bridge.enabled) return null;
  const run = bridge.execution, route = run?.route, compiled = run?.compiled;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { if (!route) return; const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer); }, [route]);
  const status = run?.bridgeJournal.events.at(-1)?.state ?? 'NOT_SENT';
  const quoteExpired = Boolean(route && Date.parse(route.expiresAt) <= clock);
  if (view === 'execute' && !run) return null;
  return <section className="bridge-panel panel" aria-label={tr(view === 'simulate' ? 'LI.FI bridge quote and review' : 'LI.FI mocked bridge execution')}>
    <div className="simulate-head"><div><p className="eyebrow">{tr(view.toUpperCase())}{tr(" / LI.FI ROUTE")}</p>
      <h2>{tr("Base → Optimism USDC bridge")}</h2>
      <p className="muted">{tr("Live route data. Financial execution, bridge progress and destination readback are deterministic MOCKED rehearsal only.")}</p></div>
      <StatusBadge label="MOCKED EXECUTION" tone="info"/></div>
    {view === 'simulate' && <div className="bridge-controls">
      {!eligible && <p>{tr("Author one isolated bridge action in chat or canvas to request a route.")}</p>}
      {!bridge.wallet ? <button type="button" onClick={bridge.connect} disabled={Boolean(bridge.busy)}>{tr("Connect Base wallet address")}</button>
        : <p>{tr("Connected owner and destination recipient ")}<code>{tr(bridge.wallet)}</code></p>}
      <label htmlFor="bridge-scenario">{tr("Rehearsal response")}</label>
      <select id="bridge-scenario" value={bridge.scenario} onChange={e => bridge.setScenario(e.target.value as 'normal' | 'uncertain')} disabled={Boolean(bridge.busy)}>
        <option value="normal">{tr("Normal bridge progress")}</option><option value="uncertain">{tr("Uncertain source response, then recheck")}</option>
      </select>
      <button type="button" onClick={bridge.quote} disabled={!eligible || !bridge.wallet || Boolean(bridge.busy)}>{tr("Get live LI.FI route")}</button>
      {quoteExpired && <button type="button" onClick={bridge.quote} disabled={!eligible || !bridge.wallet || Boolean(bridge.busy)}>{tr("Requote and review")}</button>}
    </div>}
    {bridge.busy && <p role="status" className="simulate-note">{tr(bridge.busy)}.</p>}
    {bridge.error && <p role="alert" className="simulate-alert">{tr(bridge.error)}{tr(". Review the journal and retry only the available read or quote action.")}</p>}
    {bridge.retired && <p role="alert" className="simulate-alert">{tr("The semantic workflow changed. Get a fresh route and review before authorizing a new rehearsal.")}</p>}
    {bridge.recoveryOnly && <p className="simulate-note">{tr("Recovered from the durable journal after restart. Existing progress can be rechecked; mocked submission controls remain closed.")}</p>}
    {run && route && compiled && <div className="bridge-review">
      <div className="bridge-status"><strong>{tr("Bridge state")}</strong><span data-bridge-state={status} className="step-status">{tr(status)}</span>
        <span>{tr("Run ")}<code>{run.executionId}</code></span></div>
      <div className="bridge-grid">
        <article className="step-card" aria-label={tr("LI.FI quote")}>
          <h3>{tr("Live route")}</h3><dl className="step-facts">
            <div><dt>{tr("Source → destination")}</dt><dd>{tr("Base (8453) → Optimism (10)")}</dd></div>
            <div><dt>{tr("Input")}</dt><dd className="numeric">{tr(units(route.amountIn, 6))}{tr(" USDC")}</dd></div>
            <div><dt>{tr("Expected output")}</dt><dd className="numeric">{tr(units(route.expectedOut, 6))}{tr(" USDC")}</dd></div>
            <div><dt>{tr("Minimum output")}</dt><dd className="numeric">{tr(units(route.minimumOut, 6))}{tr(" USDC")}</dd></div>
            <div><dt>{tr("Maximum slippage")}</dt><dd className="numeric">{tr(route.slippageBps)}{tr(" bps")}</dd></div>
            <div><dt>{tr("Underlying bridge")}</dt><dd>{tr(route.provider)}</dd></div>
            <div><dt>{tr("Route steps")}</dt><dd>{tr(route.includedSteps.map(x => x.type + ' · ' + x.tool).join(' → '))}</dd></div>
            <div><dt>{tr("Quote expires")}</dt><dd><time dateTime={route.expiresAt}>{tr(route.expiresAt)}</time></dd></div>
            <div><dt>{tr("Recipient")}</dt><dd><code>{tr(route.owner)}</code></dd></div>
          </dl></article>
        <article className="step-card" aria-label={tr("Bridge fees and approval")}>
          <h3>{tr("Fees and exact approval")}</h3><dl className="step-facts">
            {route.fees.map((fee, index) => <div key={index}><dt>{tr(fee.name)}</dt><dd className="numeric">{tr(units(fee.amount, fee.decimals))} {tr(fee.symbol)}{tr(fee.included ? ' · included' : '')}</dd></div>)}
            {route.gas.map((fee, index) => <div key={'gas-'+index}><dt>{tr("Source gas estimate")}</dt><dd className="numeric">{tr(units(fee.amount, fee.decimals))} {tr(fee.symbol)}</dd></div>)}
            <div><dt>{tr("Approval token / spender")}</dt><dd><code>{tr(compiled.approval.to)}</code><br/><code>{tr(route.approvalSpender)}</code></dd></div>
            <div><dt>{tr("Exact approval")}</dt><dd className="numeric">{tr(units(route.amountIn, 6))}{tr(" USDC, no unlimited allowance")}</dd></div>
            <div><dt>{tr("Source transaction target")}</dt><dd><code>{tr(route.transaction.to)}</code></dd></div>
            <div><dt>{tr("Native value / gas limit")}</dt><dd className="numeric">{tr("0 ETH / ")}{tr(BigInt(route.transaction.gasLimit).toString())}{tr(" gas")}</dd></div>
          </dl></article>
      </div>
      <article className="step-card" aria-label={tr("Bridge Strategy Manifest")}>
        <h3>{tr("Strategy Manifest and exact request")}</h3><dl className="step-facts">
          <div><dt>{tr("Owner / spend ceiling")}</dt><dd><code>{compiled.manifest.owner.address}</code> · <span className="numeric">{tr(units(compiled.manifest.spendLimits[0]!.maximumAmount, 6))}{tr(" USDC")}</span></dd></div>
          <div><dt>{tr("Fee / gas ceilings")}</dt><dd className="numeric">{tr(units(compiled.manifest.feeBudgets[0]!.maximumAmount, 6))}{tr(" USDC / ")}{tr(units(compiled.manifest.gasBudgets[0]!.maximumAmount, 18))}{tr(" ETH")}</dd></div>
          <div><dt>{tr("Provider / enforcement")}</dt><dd>{tr("LI.FI → ")}{tr(route.provider)} · {tr(compiled.manifest.enforcement)}{tr(" · MOCKED")}</dd></div>
          <div><dt>{tr("Manifest hash")}</dt><dd><code data-bridge-manifest>{tr(compiled.hashes.manifest)}</code></dd></div>
          <div><dt>{tr("Approval payload hash")}</dt><dd><code>{tr(compiled.hashes.approvalPayload)}</code></dd></div>
          <div><dt>{tr("Source payload hash")}</dt><dd><code>{tr(compiled.hashes.sourcePayload)}</code></dd></div>
        </dl>
        <details><summary>{tr("Review exact approval and LI.FI calldata")}</summary>
          <p>{tr("Approval data ")}<code>{tr(compiled.approval.data)}</code></p>
          <p>{tr("Source calldata ")}<code className="bridge-calldata">{tr(route.transaction.data)}</code></p></details>
      </article>
      {quoteExpired && status === 'NOT_SENT' && <p role="alert" className="simulate-alert">{tr("The route expired. Requote and review a new Manifest before authorization or submission.")}</p>}
      {view === 'execute' && <div className="bridge-controls" aria-label={tr("Mocked bridge controls")}>
        {!run.authorized && <button type="button" onClick={bridge.authorize} disabled={quoteExpired || bridge.recoveryOnly || bridge.retired || !bridge.wallet || Boolean(bridge.busy)}>{tr("Authorize reviewed Manifest for MOCKED rehearsal")}</button>}
        {run.authorized && run.attempts.length === 0 && <button type="button" onClick={bridge.approve} disabled={quoteExpired || bridge.recoveryOnly || Boolean(bridge.busy)}>{tr("Rehearse exact USDC approval")}</button>}
        {run.attempts.some(x => x.stepId === 'bridge.step.approval' && x.state === 'CONFIRMED') && status === 'NOT_SENT'
          && <button type="button" onClick={bridge.submit} disabled={quoteExpired || bridge.recoveryOnly || Boolean(bridge.busy)}>{tr("Rehearse source transaction")}</button>}
        {status === 'UNKNOWN' && <button type="button" onClick={bridge.recheck} disabled={Boolean(bridge.busy)}>{tr("Recheck existing source attempt")}</button>}
        {status === 'SOURCE_SUBMITTED' && <button type="button" onClick={bridge.confirmSource} disabled={Boolean(bridge.busy)}>{tr("Check source confirmation")}</button>}
        {status === 'SOURCE_CONFIRMED' && <button type="button" onClick={bridge.progress} disabled={Boolean(bridge.busy)}>{tr("Check bridge progress")}</button>}
        {status === 'BRIDGE_IN_PROGRESS' && <button type="button" onClick={bridge.confirmDestination} disabled={Boolean(bridge.busy)}>{tr("Check destination receipt")}</button>}
        {status === 'DESTINATION_CONFIRMED' && <button type="button" onClick={bridge.reconcile} disabled={Boolean(bridge.busy)}>{tr("Reconcile destination balance")}</button>}
        <button type="button" className="quiet" onClick={bridge.refresh} disabled={Boolean(bridge.busy)}>{tr("Reload journal")}</button>
      </div>}
      {view === 'execute' && <div className="bridge-timeline"><h3>{tr("Durable bridge lifecycle")}</h3><ol>{run.bridgeJournal.events.map(event =>
        <li key={event.sequence}><strong>{tr(event.state)}</strong> · {tr(event.step)} · {tr(event.note)}
          {event.transactionHash && <code>{event.transactionHash}</code>}</li>)}</ol></div>}
      {run.evidence && <article className="step-card" aria-label={tr("Mocked bridge Evidence Bundle")}><h3>{tr("Destination ")}{tr(run.evidence.bundle.outcome)}</h3>
        <p><StatusBadge label={run.evidence.bundle.environment} tone="info"/>{tr(" Destination balance and receipt are scripted readback.")}</p>
        <p>{tr("Evidence hash ")}<code data-bridge-evidence>{tr(run.evidence.hash)}</code></p>
        <p>{tr(run.evidence.bundle.reconciliation.limitations.join(' · '))}</p>
      </article>}
    </div>}
  </section>;
}

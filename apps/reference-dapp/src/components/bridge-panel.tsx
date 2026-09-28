// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  return <section className="bridge-panel panel" aria-label={view === 'simulate' ? 'LI.FI bridge quote and review' : 'LI.FI mocked bridge execution'}>
    <div className="simulate-head"><div><p className="eyebrow">{view.toUpperCase()} / LI.FI ROUTE</p>
      <h2>Base → Optimism USDC bridge</h2>
      <p className="muted">Live route data. Financial execution, bridge progress and destination readback are deterministic MOCKED rehearsal only.</p></div>
      <StatusBadge label="MOCKED EXECUTION" tone="info"/></div>
    {view === 'simulate' && <div className="bridge-controls">
      {!eligible && <p>Author one isolated bridge action in chat or canvas to request a route.</p>}
      {!bridge.wallet ? <button type="button" onClick={bridge.connect} disabled={Boolean(bridge.busy)}>Connect Base wallet address</button>
        : <p>Connected owner and destination recipient <code>{bridge.wallet}</code></p>}
      <label htmlFor="bridge-scenario">Rehearsal response</label>
      <select id="bridge-scenario" value={bridge.scenario} onChange={e => bridge.setScenario(e.target.value as 'normal' | 'uncertain')} disabled={Boolean(bridge.busy)}>
        <option value="normal">Normal bridge progress</option><option value="uncertain">Uncertain source response, then recheck</option>
      </select>
      <button type="button" onClick={bridge.quote} disabled={!eligible || !bridge.wallet || Boolean(bridge.busy)}>Get live LI.FI route</button>
      {quoteExpired && <button type="button" onClick={bridge.quote} disabled={!eligible || !bridge.wallet || Boolean(bridge.busy)}>Requote and review</button>}
    </div>}
    {bridge.busy && <p role="status" className="simulate-note">{bridge.busy}.</p>}
    {bridge.error && <p role="alert" className="simulate-alert">{bridge.error}. Review the journal and retry only the available read or quote action.</p>}
    {bridge.retired && <p role="alert" className="simulate-alert">The semantic workflow changed. Get a fresh route and review before authorizing a new rehearsal.</p>}
    {bridge.recoveryOnly && <p className="simulate-note">Recovered from the durable journal after restart. Existing progress can be rechecked; mocked submission controls remain closed.</p>}
    {run && route && compiled && <div className="bridge-review">
      <div className="bridge-status"><strong>Bridge state</strong><span data-bridge-state={status} className="step-status">{status}</span>
        <span>Run <code>{run.executionId}</code></span></div>
      <div className="bridge-grid">
        <article className="step-card" aria-label="LI.FI quote">
          <h3>Live route</h3><dl className="step-facts">
            <div><dt>Source → destination</dt><dd>Base (8453) → Optimism (10)</dd></div>
            <div><dt>Input</dt><dd className="numeric">{units(route.amountIn, 6)} USDC</dd></div>
            <div><dt>Expected output</dt><dd className="numeric">{units(route.expectedOut, 6)} USDC</dd></div>
            <div><dt>Minimum output</dt><dd className="numeric">{units(route.minimumOut, 6)} USDC</dd></div>
            <div><dt>Maximum slippage</dt><dd className="numeric">{route.slippageBps} bps</dd></div>
            <div><dt>Underlying bridge</dt><dd>{route.provider}</dd></div>
            <div><dt>Route steps</dt><dd>{route.includedSteps.map(x => x.type + ' · ' + x.tool).join(' → ')}</dd></div>
            <div><dt>Quote expires</dt><dd><time dateTime={route.expiresAt}>{route.expiresAt}</time></dd></div>
            <div><dt>Recipient</dt><dd><code>{route.owner}</code></dd></div>
          </dl></article>
        <article className="step-card" aria-label="Bridge fees and approval">
          <h3>Fees and exact approval</h3><dl className="step-facts">
            {route.fees.map((fee, index) => <div key={index}><dt>{fee.name}</dt><dd className="numeric">{units(fee.amount, fee.decimals)} {fee.symbol}{fee.included ? ' · included' : ''}</dd></div>)}
            {route.gas.map((fee, index) => <div key={'gas-'+index}><dt>Source gas estimate</dt><dd className="numeric">{units(fee.amount, fee.decimals)} {fee.symbol}</dd></div>)}
            <div><dt>Approval token / spender</dt><dd><code>{compiled.approval.to}</code><br/><code>{route.approvalSpender}</code></dd></div>
            <div><dt>Exact approval</dt><dd className="numeric">{units(route.amountIn, 6)} USDC, no unlimited allowance</dd></div>
            <div><dt>Source transaction target</dt><dd><code>{route.transaction.to}</code></dd></div>
            <div><dt>Native value / gas limit</dt><dd className="numeric">0 ETH / {BigInt(route.transaction.gasLimit).toString()} gas</dd></div>
          </dl></article>
      </div>
      <article className="step-card" aria-label="Bridge Strategy Manifest">
        <h3>Strategy Manifest and exact request</h3><dl className="step-facts">
          <div><dt>Owner / spend ceiling</dt><dd><code>{compiled.manifest.owner.address}</code> · <span className="numeric">{units(compiled.manifest.spendLimits[0]!.maximumAmount, 6)} USDC</span></dd></div>
          <div><dt>Fee / gas ceilings</dt><dd className="numeric">{units(compiled.manifest.feeBudgets[0]!.maximumAmount, 6)} USDC / {units(compiled.manifest.gasBudgets[0]!.maximumAmount, 18)} ETH</dd></div>
          <div><dt>Provider / enforcement</dt><dd>LI.FI → {route.provider} · {compiled.manifest.enforcement} · MOCKED</dd></div>
          <div><dt>Manifest hash</dt><dd><code data-bridge-manifest>{compiled.hashes.manifest}</code></dd></div>
          <div><dt>Approval payload hash</dt><dd><code>{compiled.hashes.approvalPayload}</code></dd></div>
          <div><dt>Source payload hash</dt><dd><code>{compiled.hashes.sourcePayload}</code></dd></div>
        </dl>
        <details><summary>Review exact approval and LI.FI calldata</summary>
          <p>Approval data <code>{compiled.approval.data}</code></p>
          <p>Source calldata <code className="bridge-calldata">{route.transaction.data}</code></p></details>
      </article>
      {quoteExpired && status === 'NOT_SENT' && <p role="alert" className="simulate-alert">The route expired. Requote and review a new Manifest before authorization or submission.</p>}
      {view === 'execute' && <div className="bridge-controls" aria-label="Mocked bridge controls">
        {!run.authorized && <button type="button" onClick={bridge.authorize} disabled={quoteExpired || bridge.recoveryOnly || bridge.retired || !bridge.wallet || Boolean(bridge.busy)}>Authorize reviewed Manifest for MOCKED rehearsal</button>}
        {run.authorized && run.attempts.length === 0 && <button type="button" onClick={bridge.approve} disabled={quoteExpired || bridge.recoveryOnly || Boolean(bridge.busy)}>Rehearse exact USDC approval</button>}
        {run.attempts.some(x => x.stepId === 'bridge.step.approval' && x.state === 'CONFIRMED') && status === 'NOT_SENT'
          && <button type="button" onClick={bridge.submit} disabled={quoteExpired || bridge.recoveryOnly || Boolean(bridge.busy)}>Rehearse source transaction</button>}
        {status === 'UNKNOWN' && <button type="button" onClick={bridge.recheck} disabled={Boolean(bridge.busy)}>Recheck existing source attempt</button>}
        {status === 'SOURCE_SUBMITTED' && <button type="button" onClick={bridge.confirmSource} disabled={Boolean(bridge.busy)}>Check source confirmation</button>}
        {status === 'SOURCE_CONFIRMED' && <button type="button" onClick={bridge.progress} disabled={Boolean(bridge.busy)}>Check bridge progress</button>}
        {status === 'BRIDGE_IN_PROGRESS' && <button type="button" onClick={bridge.confirmDestination} disabled={Boolean(bridge.busy)}>Check destination receipt</button>}
        {status === 'DESTINATION_CONFIRMED' && <button type="button" onClick={bridge.reconcile} disabled={Boolean(bridge.busy)}>Reconcile destination balance</button>}
        <button type="button" className="quiet" onClick={bridge.refresh} disabled={Boolean(bridge.busy)}>Reload journal</button>
      </div>}
      {view === 'execute' && <div className="bridge-timeline"><h3>Durable bridge lifecycle</h3><ol>{run.bridgeJournal.events.map(event =>
        <li key={event.sequence}><strong>{event.state}</strong> · {event.step} · {event.note}
          {event.transactionHash && <code>{event.transactionHash}</code>}</li>)}</ol></div>}
      {run.evidence && <article className="step-card" aria-label="Mocked bridge Evidence Bundle"><h3>Destination {run.evidence.bundle.outcome}</h3>
        <p><StatusBadge label={run.evidence.bundle.environment} tone="info"/> Destination balance and receipt are scripted readback.</p>
        <p>Evidence hash <code data-bridge-evidence>{run.evidence.hash}</code></p>
        <p>{run.evidence.bundle.reconciliation.limitations.join(' · ')}</p>
      </article>}
    </div>}
  </section>;
}

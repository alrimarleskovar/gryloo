// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { formatHumanAmount } from '../domain/swap-authoring';
import { useCow } from '../state/cow-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

const short = (value: string) => value.length > 18 ? value.slice(0, 10) + '…' + value.slice(-8) : value;
export function CowPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const cow = useCow();
  const { context, state } = useWorkflow();
  const { info, execution, busy, error, wallet, retired, recoveryOnly } = cow;
  if (!info?.enabled) return null;
  if (view === 'execute' && !execution) return null;
  const record = execution?.record;
  const quote = record?.quote;
  const compiled = record?.compiled;
  const direction = quote?.sellToken === '0x4200000000000000000000000000000000000006'
    ? { sell: 'WETH' as const, buy: 'USDC' as const } : { sell: 'USDC' as const, buy: 'WETH' as const };
  const amount = (units: string, symbol: 'USDC' | 'WETH') => formatHumanAmount(units, symbol, context) + ' ' + symbol;
  const trackable = record && ['POSTING', 'POST_RESULT_UNKNOWN', 'POSTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'RECONCILIATION_REQUIRED'].includes(record.state);
  const quoteExpired = Boolean(record?.state === 'REVIEWED' && quote && Date.parse(quote.expiresAt) <= Date.now());
  return <section className="cow-panel panel" aria-label={tr(view === 'simulate' ? 'CoW signed-intent simulation' : 'CoW signed-intent execution')}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr(view.toUpperCase())}{tr(" / COW SIGNED INTENT · LOOPBACK")}</p>
        <h2>{tr("CoW signed-intent swap")}</h2>
        <p className="muted">{tr("MOCKED orderbook and settlement. A disposable injected local wallet signs EIP-712; Flofi contacts no public provider or chain.")}</p></div>
      <StatusBadge label="MOCKED" tone="info"/>
    </div>
    {view === 'simulate' && <div className="cow-controls">
      <p>{tr("Capability: ")}{tr(info.discovery?.available ? 'Available' : 'Unavailable')} · {tr(info.discovery?.reason)}</p>
      {wallet ? <span className="wallet-chip">{tr("Local wallet · ")}{tr(short(wallet))}</span>
        : <button type="button" onClick={cow.connect} disabled={Boolean(busy)}>{tr("Connect disposable local wallet")}</button>}
      <label htmlFor="cow-scenario">{tr("Scripted outcome")}</label>
      <select id="cow-scenario" value={cow.scenario} onChange={event => cow.setScenario(event.target.value as typeof cow.scenario)} disabled={Boolean(busy)}>
        <option value="fill">{tr("Fill after tracking")}</option><option value="hold">{tr("Remain open for cancellation")}</option>
        <option value="ambiguous">{tr("Ambiguous posting, then fill")}</option><option value="expire">{tr("Expire")}</option>
        <option value="failure">{tr("Posting failure, no order found")}</option>
      </select>
      <button type="button" onClick={cow.prepare} disabled={!info.discovery?.available || !wallet || Boolean(busy)}>{tr("Prepare CoW quote for revision ")}{tr(state.workflow.revision)}</button>
    </div>}
    {busy && <p className="simulate-note" role="status">{tr(busy)}.</p>}
    {error && <p className="simulate-alert" role="alert">{tr("CoW action stopped: ")}{tr(error)}{tr(". Review the state before trying another action.")}</p>}
    {quoteExpired && <p className="simulate-alert" role="alert">{tr("The CoW quote expired. Prepare a fresh quote and review its Manifest before signing.")}</p>}
    {retired && <p className="simulate-alert" role="alert">{tr("The semantic workflow changed. This review is invalid for a new signature; prepare a fresh quote. Existing posted orders can still be tracked.")}</p>}
    {recoveryOnly && <p className="simulate-note">{tr("Recovered from the local execution journal after restart. Review-only orders cannot be signed from a restored page; posted orders remain trackable.")}</p>}
    {record && quote && compiled && <>
      <div className="cow-status"><strong>{tr("Order state")}</strong><span className="step-status" data-cow-state={record.state}>{tr(record.state)}</span>
        <span>{tr("Execution ")}<code>{record.executionId}</code></span></div>
      <div className="cow-grid">
        <article className="step-card" aria-label={tr("CoW quote and simulation")}>
          <h3>{tr("Quote and simulation")}</h3>
          <dl className="step-facts">
            <div><dt>{tr("Input")}</dt><dd className="numeric">{tr(amount(quote.sellAmount, direction.sell))}</dd></div>
            <div><dt>{tr("Minimum output")}</dt><dd className="numeric">{tr(amount(quote.buyAmount, direction.buy))}</dd></div>
            <div><dt>{tr("Quote source")}</dt><dd>{tr(quote.sourceId)}{tr(" · block 0 (scripted)")}</dd></div>
            <div><dt>{tr("Quote expires")}</dt><dd>{tr(quote.expiresAt)}</dd></div>
            <div><dt>{tr("Order expires")}</dt><dd>{tr(new Date(quote.validTo * 1000).toISOString())}</dd></div>
            <div><dt>{tr("Protocol fee in signed order")}</dt><dd className="numeric">0 {tr(direction.sell)}{tr(" · other solver fees and gas not modeled")}</dd></div>
            <div><dt>{tr("Failure path")}</dt><dd>{tr("If no fill occurs, the input remains with the local account. A lost post response requires UID lookup before any next action.")}</dd></div>
          </dl>
        </article>
        <article className="step-card" aria-label={tr("CoW exact EIP-712 review")}>
          <h3>{tr("Exact EIP-712 order review")}</h3>
          <dl className="step-facts">
            <div><dt>{tr("Signing domain")}</dt><dd>{tr(compiled.typedData.domain.name)} {tr(compiled.typedData.domain.version)}{tr(" · chain ")}{tr(compiled.typedData.domain.chainId)}</dd></div>
            <div><dt>{tr("Verifying contract")}</dt><dd><code>{tr(compiled.typedData.domain.verifyingContract)}</code></dd></div>
            <div><dt>{tr("Allowance spender")}</dt><dd><code>{tr(info.discovery?.spender)}</code>{tr(" · allowance is a review input, no approval transaction is made here")}</dd></div>
            <div><dt>{tr("Owner / receiver")}</dt><dd><code>{tr(quote.owner)}</code></dd></div>
            <div><dt>{tr("Sell / buy token")}</dt><dd><code>{tr(quote.sellToken)}</code><br/><code>{tr(quote.buyToken)}</code></dd></div>
            <div><dt>{tr("Sell / minimum buy native units")}</dt><dd className="numeric">{tr(quote.sellAmount)} / {tr(quote.buyAmount)}</dd></div>
            <div><dt>{tr("Kind / partial fill / balance")}</dt><dd>{tr("sell / false / erc20 → erc20")}</dd></div>
            <div><dt>{tr("App data / signed fee")}</dt><dd><code>{tr(compiled.order.appData)}</code> / {tr(compiled.order.feeAmount)}</dd></div>
            <div><dt>{tr("Order UID")}</dt><dd><code data-cow-uid="">{tr(compiled.orderUid)}</code></dd></div>
          </dl>
        </article>
      </div>
      <article className="step-card cow-manifest" aria-label={tr("CoW Manifest review")}>
        <h3>{tr("Manifest review")}</h3><dl className="step-facts">
          <div><dt>{tr("Provider / execution")}</dt><dd>{tr(compiled.manifest.providers.kind === 'FIXED' ? compiled.manifest.providers.providerId : 'UNAVAILABLE')}{tr(" · SIGNED_INTENT")}</dd></div>
          <div><dt>{tr("Owner / spend ceiling")}</dt><dd><code>{compiled.manifest.owner.address}</code> · {tr(amount(compiled.manifest.spendLimits[0]?.maximumAmount ?? '0', direction.sell))}</dd></div>
          <div><dt>{tr("Minimum receive")}</dt><dd>{tr(amount(quote.buyAmount, direction.buy))}</dd></div>
          <div><dt>{tr("Deadline / revocation epoch")}</dt><dd>{tr(compiled.manifest.expiresAt)} · {tr(compiled.manifest.revocationEpoch)}</dd></div>
          <div><dt>{tr("Enforcement")}</dt><dd>{tr(compiled.manifest.enforcement)}{tr(" · local scripted acceptance only")}</dd></div>
        </dl></article>
      <details className="cow-hashes"><summary>{tr("Artifact and authorization hashes")}</summary>
        <dl className="step-facts">{Object.entries(compiled.hashes).map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd><code>{tr(value)}</code></dd></div>)}
          <div><dt>{tr("Intent hash")}</dt><dd><code>{tr(compiled.intentHash)}</code></dd></div></dl>
      </details>
      {view === 'simulate' && <p className="simulate-next">{tr("Review the exact order and fixed CoW provider here, then open Execute to sign. Any provider or execution-kind change needs a fresh quote, simulation, Manifest and signature.")}</p>}
      {view === 'execute' && <div className="cow-controls" aria-label={tr("CoW order controls")}>
        {!wallet && <button type="button" onClick={cow.connect} disabled={Boolean(busy)}>{tr("Connect disposable local wallet")}</button>}
        {record.state === 'REVIEWED' && <button type="button" onClick={cow.signAndPost}
          disabled={!wallet || retired || recoveryOnly || Boolean(busy) || Date.parse(quote.expiresAt) <= Date.now()}>{tr("Sign exact order and post to local orderbook")}</button>}
        {trackable && <button type="button" onClick={cow.track} disabled={Boolean(busy)}>{tr("Check order UID and status")}</button>}
        {['OPEN', 'POSTED', 'PARTIALLY_FILLED'].includes(record.state) && <button type="button" onClick={cow.cancel}
          disabled={!wallet || Boolean(busy)}>{tr("Sign supported cancellation")}</button>}
        {['RECONCILIATION_REQUIRED', 'INCONCLUSIVE'].includes(record.state) && <button type="button" onClick={cow.reconcile}
          disabled={Boolean(busy)}>{tr("Reconcile scripted settlement")}</button>}
      </div>}
      {view === 'execute' && <div className="cow-timeline"><h3>{tr("Order lifecycle")}</h3><ol>
        {record.history.map((entry, index) => <li key={index}><span>{tr(entry.state)}</span><time dateTime={entry.at}>{tr(entry.at)}</time></li>)}
      </ol><p>{tr("Posting attempts: ")}{tr(record.postCount)}{tr(". An ambiguous result never authorizes a second post.")}</p></div>}
      {execution?.evidence && <article className="step-card" aria-label={tr("CoW evidence")}>
        <h3>{tr("Evidence Bundle · ")}{tr(execution.evidence.bundle.outcome)}</h3>
        <p><StatusBadge label={execution.evidence.bundle.environment} tone="info"/>{tr(" Scripted receipt, trade and balance observations only.")}</p>
        <p>{tr("Evidence hash ")}<code data-cow-evidence="">{tr(execution.evidence.hash)}</code></p>
        <p>{tr(execution.evidence.bundle.reconciliation.limitations.join(' '))}</p>
      </article>}
    </>}
  </section>;
}

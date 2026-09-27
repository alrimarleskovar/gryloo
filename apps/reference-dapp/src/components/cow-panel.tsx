// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatHumanAmount } from '../domain/swap-authoring';
import { useCow } from '../state/cow-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

const short = (value: string) => value.length > 18 ? value.slice(0, 10) + '…' + value.slice(-8) : value;
export function CowPanel({ view }: { view: 'simulate' | 'execute' }) {
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
  return <section className="cow-panel panel" aria-label={view === 'simulate' ? 'CoW signed-intent simulation' : 'CoW signed-intent execution'}>
    <div className="simulate-head">
      <div><p className="eyebrow">{view.toUpperCase()} / COW SIGNED INTENT · LOOPBACK</p>
        <h2>CoW signed-intent swap</h2>
        <p className="muted">MOCKED orderbook and settlement. A disposable injected local wallet signs EIP-712; Gryloo contacts no public provider or chain.</p></div>
      <StatusBadge label="MOCKED" tone="info"/>
    </div>
    {view === 'simulate' && <div className="cow-controls">
      <p>Capability: {info.discovery?.available ? 'Available' : 'Unavailable'} · {info.discovery?.reason}</p>
      {wallet ? <span className="wallet-chip">Local wallet · {short(wallet)}</span>
        : <button type="button" onClick={cow.connect} disabled={Boolean(busy)}>Connect disposable local wallet</button>}
      <label htmlFor="cow-scenario">Scripted outcome</label>
      <select id="cow-scenario" value={cow.scenario} onChange={event => cow.setScenario(event.target.value as typeof cow.scenario)} disabled={Boolean(busy)}>
        <option value="fill">Fill after tracking</option><option value="hold">Remain open for cancellation</option>
        <option value="ambiguous">Ambiguous posting, then fill</option><option value="expire">Expire</option>
        <option value="failure">Posting failure, no order found</option>
      </select>
      <button type="button" onClick={cow.prepare} disabled={!info.discovery?.available || !wallet || Boolean(busy)}>
        Prepare CoW quote for revision {state.workflow.revision}</button>
    </div>}
    {busy && <p className="simulate-note" role="status">{busy}.</p>}
    {error && <p className="simulate-alert" role="alert">CoW action stopped: {error}. Review the state before trying another action.</p>}
    {quoteExpired && <p className="simulate-alert" role="alert">The CoW quote expired. Prepare a fresh quote and review its Manifest before signing.</p>}
    {retired && <p className="simulate-alert" role="alert">The semantic workflow changed. This review is invalid for a new signature; prepare a fresh quote. Existing posted orders can still be tracked.</p>}
    {recoveryOnly && <p className="simulate-note">Recovered from the local execution journal after restart. Review-only orders cannot be signed from a restored page; posted orders remain trackable.</p>}
    {record && quote && compiled && <>
      <div className="cow-status"><strong>Order state</strong><span className="step-status" data-cow-state={record.state}>{record.state}</span>
        <span>Execution <code>{record.executionId}</code></span></div>
      <div className="cow-grid">
        <article className="step-card" aria-label="CoW quote and simulation">
          <h3>Quote and simulation</h3>
          <dl className="step-facts">
            <div><dt>Input</dt><dd className="numeric">{amount(quote.sellAmount, direction.sell)}</dd></div>
            <div><dt>Minimum output</dt><dd className="numeric">{amount(quote.buyAmount, direction.buy)}</dd></div>
            <div><dt>Quote source</dt><dd>{quote.sourceId} · block 0 (scripted)</dd></div>
            <div><dt>Quote expires</dt><dd>{quote.expiresAt}</dd></div>
            <div><dt>Order expires</dt><dd>{new Date(quote.validTo * 1000).toISOString()}</dd></div>
            <div><dt>Protocol fee in signed order</dt><dd className="numeric">0 {direction.sell} · other solver fees and gas not modeled</dd></div>
            <div><dt>Failure path</dt><dd>If no fill occurs, the input remains with the local account. A lost post response requires UID lookup before any next action.</dd></div>
          </dl>
        </article>
        <article className="step-card" aria-label="CoW exact EIP-712 review">
          <h3>Exact EIP-712 order review</h3>
          <dl className="step-facts">
            <div><dt>Signing domain</dt><dd>{compiled.typedData.domain.name} {compiled.typedData.domain.version} · chain {compiled.typedData.domain.chainId}</dd></div>
            <div><dt>Verifying contract</dt><dd><code>{compiled.typedData.domain.verifyingContract}</code></dd></div>
            <div><dt>Allowance spender</dt><dd><code>{info.discovery?.spender}</code> · allowance is a review input, no approval transaction is made here</dd></div>
            <div><dt>Owner / receiver</dt><dd><code>{quote.owner}</code></dd></div>
            <div><dt>Sell / buy token</dt><dd><code>{quote.sellToken}</code><br/><code>{quote.buyToken}</code></dd></div>
            <div><dt>Sell / minimum buy native units</dt><dd className="numeric">{quote.sellAmount} / {quote.buyAmount}</dd></div>
            <div><dt>Kind / partial fill / balance</dt><dd>sell / false / erc20 → erc20</dd></div>
            <div><dt>App data / signed fee</dt><dd><code>{compiled.order.appData}</code> / {compiled.order.feeAmount}</dd></div>
            <div><dt>Order UID</dt><dd><code data-cow-uid="">{compiled.orderUid}</code></dd></div>
          </dl>
        </article>
      </div>
      <article className="step-card cow-manifest" aria-label="CoW Manifest review">
        <h3>Manifest review</h3><dl className="step-facts">
          <div><dt>Provider / execution</dt><dd>{compiled.manifest.providers.kind === 'FIXED' ? compiled.manifest.providers.providerId : 'UNAVAILABLE'} · SIGNED_INTENT</dd></div>
          <div><dt>Owner / spend ceiling</dt><dd><code>{compiled.manifest.owner.address}</code> · {amount(compiled.manifest.spendLimits[0]?.maximumAmount ?? '0', direction.sell)}</dd></div>
          <div><dt>Minimum receive</dt><dd>{amount(quote.buyAmount, direction.buy)}</dd></div>
          <div><dt>Deadline / revocation epoch</dt><dd>{compiled.manifest.expiresAt} · {compiled.manifest.revocationEpoch}</dd></div>
          <div><dt>Enforcement</dt><dd>{compiled.manifest.enforcement} · local scripted acceptance only</dd></div>
        </dl></article>
      <details className="cow-hashes"><summary>Artifact and authorization hashes</summary>
        <dl className="step-facts">{Object.entries(compiled.hashes).map(([name, value]) =>
          <div key={name}><dt>{name}</dt><dd><code>{value}</code></dd></div>)}
          <div><dt>Intent hash</dt><dd><code>{compiled.intentHash}</code></dd></div></dl>
      </details>
      {view === 'simulate' && <p className="simulate-next">Review the exact order and fixed CoW provider here, then open Execute to sign. Any provider or execution-kind change needs a fresh quote, simulation, Manifest and signature.</p>}
      {view === 'execute' && <div className="cow-controls" aria-label="CoW order controls">
        {!wallet && <button type="button" onClick={cow.connect} disabled={Boolean(busy)}>Connect disposable local wallet</button>}
        {record.state === 'REVIEWED' && <button type="button" onClick={cow.signAndPost}
          disabled={!wallet || retired || recoveryOnly || Boolean(busy) || Date.parse(quote.expiresAt) <= Date.now()}>
          Sign exact order and post to local orderbook</button>}
        {trackable && <button type="button" onClick={cow.track} disabled={Boolean(busy)}>
          Check order UID and status</button>}
        {['OPEN', 'POSTED', 'PARTIALLY_FILLED'].includes(record.state) && <button type="button" onClick={cow.cancel}
          disabled={!wallet || Boolean(busy)}>Sign supported cancellation</button>}
        {['RECONCILIATION_REQUIRED', 'INCONCLUSIVE'].includes(record.state) && <button type="button" onClick={cow.reconcile}
          disabled={Boolean(busy)}>Reconcile scripted settlement</button>}
      </div>}
      {view === 'execute' && <div className="cow-timeline"><h3>Order lifecycle</h3><ol>
        {record.history.map((entry, index) => <li key={index}><span>{entry.state}</span><time dateTime={entry.at}>{entry.at}</time></li>)}
      </ol><p>Posting attempts: {record.postCount}. An ambiguous result never authorizes a second post.</p></div>}
      {execution?.evidence && <article className="step-card" aria-label="CoW evidence">
        <h3>Evidence Bundle · {execution.evidence.bundle.outcome}</h3>
        <p><StatusBadge label={execution.evidence.bundle.environment} tone="info"/> Scripted receipt, trade and balance observations only.</p>
        <p>Evidence hash <code data-cow-evidence="">{execution.evidence.hash}</code></p>
        <p>{execution.evidence.bundle.reconciliation.limitations.join(' ')}</p>
      </article>}
    </>}
  </section>;
}

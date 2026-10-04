// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { formatHumanAmount } from '../domain/swap-authoring';
import { useModeB } from '../state/mode-b-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
export function ModeBPanel({ view }: { view: 'simulate' | 'execute' }) {
  const mode = useModeB();
  const { context, state } = useWorkflow();
  const { info, status, busy, error } = mode;
  if (info && !info.available) return null;
  const prepared = status?.prepared;
  const inSymbol = prepared?.direction === 'WETH_TO_USDC' ? 'WETH' : 'USDC';
  const outSymbol = inSymbol === 'WETH' ? 'USDC' : 'WETH';
  const amount = (units: string, symbol: 'USDC' | 'WETH') => `${formatHumanAmount(units, symbol, context)} ${symbol}`;
  const installIndex = prepared ? prepared.installationStart + prepared.installation.length : 0;
  const installed = Boolean(prepared && installIndex === prepared.compiled.installation.length);
  const revokeIndex = prepared?.revocation.length ?? 0;
  const revoked = Boolean(prepared && revokeIndex === prepared.compiled.revocation.length && revokeIndex > 0 && !status?.moduleEnabled && !status?.executorEnabled);
  return <section className="mode-b-panel panel" aria-label="Finite Mode B authority">
    <div className="simulate-head">
      <div><p className="eyebrow">{view === 'simulate' ? 'Simulate' : 'Execute'} · local demo</p><h2>Finite delegated swap</h2>
        <p className="muted">Safe 1.4.1 and Zodiac Roles 2.1.0. One exact Uniswap call, one non-refilling allowance, protocol deadline. Local fork only.</p></div>
      <div className="simulate-controls"><StatusBadge label="Local fork" tone="warning"/><StatusBadge label="Limited permission" tone="info"/></div>
    </div>
    {!info && <p role="status" className="simulate-note">Checking the local Mode B boundary…</p>}
    {info?.available && !prepared && <div className="simulate-empty"><h3>No Mode B review yet</h3>
      <p>Use one USDC/WETH swap in the shared chat or canvas workflow. This starts a separate fork quote and chained authority simulation; mocked artifacts and read-only observations never enter this path.</p>
      <button type="button" disabled={Boolean(busy)} onClick={mode.prepare}>Simulate finite Mode B for revision {state.workflow.revision}</button>
    </div>}
    {busy && <p className="simulate-note" role="status">{busy}.</p>}
    {error && <p className="simulate-alert" role="alert">Mode B stopped: {error}. Inspect the fork state before another action.</p>}
    {mode.unknownSubmission && <p className="simulate-alert" role="alert">Wallet result is unknown. Flofi will not request the same operation again. Read the chain and transaction history before continuing.</p>}
    {prepared && <>
      {mode.recoveryOnly && <p className="simulate-note" role="status">Recovered from the local journal. New installation and browser-triggered execution are disabled; inspect and revoke any existing permission after review.</p>}
      {mode.quoteExpired && !installed && <p className="simulate-alert" role="status">The fork quote expired. Simulate the current revision again before requesting installation signatures. Existing onchain permission still requires inspection or revocation.</p>}
      {mode.retired && <p className="simulate-alert" role="status">Semantic revision changed after this review. New installation and execution are retired. Existing onchain permission still needs inspection or revocation.</p>}
      <ol className="chain-strip" aria-label="Finite authority commitments">
        <li><span>Execution ID · revision {prepared.revision}</span><code>{prepared.executionId}</code></li>
        <li><span>Semantic workflow</span><code>{prepared.workflowHash}</code></li>
        <li><span>Fork quote</span><code>{prepared.compiled.permission.quoteHash}</code></li>
        <li><span>Chained simulation</span><code>{prepared.simulationHash}</code></li>
        <li><span>Mode B permission</span><code>{prepared.compiled.permissionHash}</code></li>
      </ol>
      <div className="mode-b-facts">
        <div><span>Input</span><strong className="numeric">{amount(prepared.amountIn, inSymbol)}</strong><small>{prepared.amountIn} native units</small></div>
        <div><span>Quoted output</span><strong className="numeric">{amount(prepared.quotedOut, outSymbol)}</strong><small>minimum {amount(prepared.minimumOut, outSymbol)}</small></div>
        <div><span>Remaining budget</span><strong className="numeric">{amount(status?.remainingBudget ?? '0', inSymbol)}</strong><small>{status?.remainingBudget ?? '0'} native units · one-time allowance</small></div>
        <div><span>Residual router allowance</span><strong className="numeric">{amount(status?.residualTokenAllowance ?? '0', inSymbol)}</strong><small>{status?.residualTokenAllowance ?? '0'} native units</small></div>
      </div>
      <table className="enforcement-table" aria-label="Mode B enforcement locations"><thead><tr><th scope="col">Rule</th><th scope="col">Reviewed value</th><th scope="col">Boundary</th></tr></thead><tbody>
        <tr><td>Owner / threshold</td><td><code>{prepared.compiled.permission.owner}</code> · 1 of 1</td><td>Safe owner readback</td></tr>
        <tr><td>Source Safe</td><td><code>{prepared.compiled.permission.safe}</code></td><td>Safe module route</td></tr>
        <tr><td>Executor</td><td><code>{prepared.compiled.permission.executor}</code></td><td>Roles member</td></tr>
        <tr><td>Target / selector</td><td><code>{prepared.compiled.permission.router}</code> · <code>{prepared.compiled.permission.selector}</code></td><td>Roles target/function</td></tr>
        <tr><td>Token / recipient</td><td><code>{prepared.tokenIn}</code> · <code>{prepared.compiled.permission.recipient}</code></td><td>Roles nested parameters</td></tr>
        <tr><td>Exact input / cumulative cap</td><td className="numeric">{prepared.amountIn} native units</td><td>Roles exact parameters + one-time allowance</td></tr>
        <tr><td>Minimum output</td><td className="numeric">{prepared.minimumOut} native units</td><td>Uniswap router</td></tr>
        <tr><td>Expiry</td><td>{new Date(Number(prepared.deadline) * 1000).toISOString()}</td><td>Uniswap protocol deadline</td></tr>
        <tr><td>Gas payer / cap</td><td>Disposable executor · local only</td><td>Worker gateway; gas cap not independently enforced</td></tr>
      </tbody></table>
      <p className="simulate-note">Quote block <code>{short(prepared.quoteBlockHash)}</code> · simulation gas {prepared.simulationGas} · source block {info?.available ? 'recorded Base' : 'local'} · permission review binds Safe/Roles code pins. The owner retains full Safe authority.</p>
      {view === 'simulate' ? <div className="simulate-controls">
        <button type="button" disabled={Boolean(busy)} onClick={mode.prepare}>Simulate current revision again</button>
        <button type="button" disabled={Boolean(busy)} onClick={mode.refresh}>Read current permission</button>
      </div> : <>
        <div className="simulate-controls">
          {!mode.wallet ? <button type="button" disabled={Boolean(busy)} onClick={mode.connect}>Connect local owner wallet</button>
            : <span className="wallet-chip">{mode.wallet.label} · <code>{short(mode.wallet.account)}</code></span>}
          <button type="button" disabled={mode.reviewed || Boolean(busy)} onClick={mode.acceptReview}>
            {mode.reviewed ? 'Permission reviewed' : 'I reviewed the finite permission and signatures'}</button>
          <button type="button" disabled={Boolean(busy)} onClick={mode.refresh}>Read chain state</button>
        </div>
        <ol className="mode-b-steps" aria-label="Distinct owner authorizations">
          {prepared.compiled.installation.map((item, index) => <li key={index}>
            <div><strong>{item.label}</strong><small>Signature {index + 1} · to <code>{item.to}</code></small>
              <code className="mode-b-calldata">{item.data}</code></div>
            <span>{index < prepared.installationStart ? 'PRE-ENABLED · VERIFIED' : prepared.installation.some(confirmed => confirmed.index === index) ? 'CHAIN CONFIRMED' : 'WAITING'}</span>
          </li>)}
        </ol>
        {!installed && <button type="button" disabled={!mode.wallet || !mode.reviewed || mode.retired || mode.recoveryOnly || mode.quoteExpired || mode.unknownSubmission || Boolean(busy)} onClick={mode.installNext}>
          Request owner signature {installIndex + 1} · {prepared.compiled.installation[installIndex]?.label}</button>}
        {installed && <div className="simulate-controls"><StatusBadge label="PERMISSION_INSTALLED" tone="info"/>
          <button type="button" disabled={!mode.reviewed || mode.retired || mode.recoveryOnly || Boolean(busy) || Boolean(prepared.executionHash)} onClick={mode.runWorker}>Run bounded local worker</button>
          {prepared.executionHash && !prepared.reconciliation && <button type="button" disabled={Boolean(busy)} onClick={mode.reconcile}>Reconcile independently</button>}
        </div>}
        {prepared.executionHash && <p className="simulate-note">Executor transaction <code>{prepared.executionHash}</code> · {prepared.reconciliation?.outcome ?? 'CONFIRMED_NOT_RECONCILED'}.</p>}
        {prepared.reconciliation && <p className="simulate-note" role="status">{prepared.reconciliation.outcome}: {prepared.reconciliation.reason}. Remaining budget {prepared.reconciliation.remainingBudget} native units; residual allowance {prepared.reconciliation.residualTokenAllowance} native units.</p>}
        {installed && <div className="mode-b-revoke"><h3>Wallet revocation</h3><p>Local pause cannot revoke. Remove the role, disable the Safe module, then clear residual router allowance with distinct owner signatures. Readback must confirm each effect.</p>
          <p>Module: {status?.moduleEnabled ? 'ENABLED' : 'DISABLED'} · executor role: {status?.executorEnabled ? 'ASSIGNED' : 'REMOVED'} · revocation: {revoked ? 'REVOCATION_CONFIRMED' : 'NOT_CONFIRMED'}</p>
          {!revoked && <button type="button" disabled={!mode.wallet || !mode.reviewed || mode.unknownSubmission || Boolean(busy) || revokeIndex >= prepared.compiled.revocation.length} onClick={mode.revokeNext}>
            Request owner revocation signature {revokeIndex + 1} · {prepared.compiled.revocation[revokeIndex]?.label}</button>}
        </div>}
      </>}
    </>}
  </section>;
}

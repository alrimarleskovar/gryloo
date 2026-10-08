// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { formatHumanAmount } from '../domain/swap-authoring';
import { useModeB } from '../state/mode-b-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
export function ModeBPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
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
  return <section className="mode-b-panel panel" aria-label={tr("Finite Mode B authority")}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr(view === 'simulate' ? 'Simulate' : 'Execute')}{tr(" · local demo")}</p><h2>{tr("Finite delegated swap")}</h2>
        <p className="muted">{tr("Safe 1.4.1 and Zodiac Roles 2.1.0. One exact Uniswap call, one non-refilling allowance, protocol deadline. Local fork only.")}</p></div>
      <div className="simulate-controls"><StatusBadge label="Local fork" tone="warning"/><StatusBadge label="Limited permission" tone="info"/></div>
    </div>
    {!info && <p role="status" className="simulate-note">{tr("Checking the local Mode B boundary…")}</p>}
    {info?.available && !prepared && <div className="simulate-empty"><h3>{tr("No Mode B review yet")}</h3>
      <p>{tr("Use one USDC/WETH swap in the shared chat or canvas workflow. This starts a separate fork quote and chained authority simulation; mocked artifacts and read-only observations never enter this path.")}</p>
      <button type="button" disabled={Boolean(busy)} onClick={mode.prepare}>{tr("Simulate finite Mode B for revision ")}{tr(state.workflow.revision)}</button>
    </div>}
    {busy && <p className="simulate-note" role="status">{tr(busy)}.</p>}
    {error && <p className="simulate-alert" role="alert">{tr("Mode B stopped: ")}{tr(error)}{tr(". Inspect the fork state before another action.")}</p>}
    {mode.unknownSubmission && <p className="simulate-alert" role="alert">{tr("Wallet result is unknown. Flofi will not request the same operation again. Read the chain and transaction history before continuing.")}</p>}
    {prepared && <>
      {mode.recoveryOnly && <p className="simulate-note" role="status">{tr("Recovered from the local journal. New installation and browser-triggered execution are disabled; inspect and revoke any existing permission after review.")}</p>}
      {mode.quoteExpired && !installed && <p className="simulate-alert" role="status">{tr("The fork quote expired. Simulate the current revision again before requesting installation signatures. Existing onchain permission still requires inspection or revocation.")}</p>}
      {mode.retired && <p className="simulate-alert" role="status">{tr("Semantic revision changed after this review. New installation and execution are retired. Existing onchain permission still needs inspection or revocation.")}</p>}
      <ol className="chain-strip" aria-label={tr("Finite authority commitments")}>
        <li><span>{tr("Execution ID · revision ")}{tr(prepared.revision)}</span><code>{prepared.executionId}</code></li>
        <li><span>{tr("Semantic workflow")}</span><code>{tr(prepared.workflowHash)}</code></li>
        <li><span>{tr("Fork quote")}</span><code>{tr(prepared.compiled.permission.quoteHash)}</code></li>
        <li><span>{tr("Chained simulation")}</span><code>{tr(prepared.simulationHash)}</code></li>
        <li><span>{tr("Mode B permission")}</span><code>{tr(prepared.compiled.permissionHash)}</code></li>
      </ol>
      <div className="mode-b-facts">
        <div><span>{tr("Input")}</span><strong className="numeric">{tr(amount(prepared.amountIn, inSymbol))}</strong><small>{tr(prepared.amountIn)}{tr(" native units")}</small></div>
        <div><span>{tr("Quoted output")}</span><strong className="numeric">{tr(amount(prepared.quotedOut, outSymbol))}</strong><small>{tr("minimum ")}{tr(amount(prepared.minimumOut, outSymbol))}</small></div>
        <div><span>{tr("Remaining budget")}</span><strong className="numeric">{tr(amount(status?.remainingBudget ?? '0', inSymbol))}</strong><small>{tr(status?.remainingBudget ?? '0')}{tr(" native units · one-time allowance")}</small></div>
        <div><span>{tr("Residual router allowance")}</span><strong className="numeric">{tr(amount(status?.residualTokenAllowance ?? '0', inSymbol))}</strong><small>{tr(status?.residualTokenAllowance ?? '0')}{tr(" native units")}</small></div>
      </div>
      <table className="enforcement-table" aria-label={tr("Mode B enforcement locations")}><thead><tr><th scope="col">{tr("Rule")}</th><th scope="col">{tr("Reviewed value")}</th><th scope="col">{tr("Boundary")}</th></tr></thead><tbody>
        <tr><td>{tr("Owner / threshold")}</td><td><code>{tr(prepared.compiled.permission.owner)}</code>{tr(" · 1 of 1")}</td><td>{tr("Safe owner readback")}</td></tr>
        <tr><td>{tr("Source Safe")}</td><td><code>{tr(prepared.compiled.permission.safe)}</code></td><td>{tr("Safe module route")}</td></tr>
        <tr><td>{tr("Executor")}</td><td><code>{tr(prepared.compiled.permission.executor)}</code></td><td>{tr("Roles member")}</td></tr>
        <tr><td>{tr("Target / selector")}</td><td><code>{tr(prepared.compiled.permission.router)}</code> · <code>{tr(prepared.compiled.permission.selector)}</code></td><td>{tr("Roles target/function")}</td></tr>
        <tr><td>{tr("Token / recipient")}</td><td><code>{tr(prepared.tokenIn)}</code> · <code>{tr(prepared.compiled.permission.recipient)}</code></td><td>{tr("Roles nested parameters")}</td></tr>
        <tr><td>{tr("Exact input / cumulative cap")}</td><td className="numeric">{tr(prepared.amountIn)}{tr(" native units")}</td><td>{tr("Roles exact parameters + one-time allowance")}</td></tr>
        <tr><td>{tr("Minimum output")}</td><td className="numeric">{tr(prepared.minimumOut)}{tr(" native units")}</td><td>{tr("Uniswap router")}</td></tr>
        <tr><td>{tr("Expiry")}</td><td>{tr(new Date(Number(prepared.deadline) * 1000).toISOString())}</td><td>{tr("Uniswap protocol deadline")}</td></tr>
        <tr><td>{tr("Gas payer / cap")}</td><td>{tr("Disposable executor · local only")}</td><td>{tr("Worker gateway; gas cap not independently enforced")}</td></tr>
      </tbody></table>
      <p className="simulate-note">{tr("Quote block ")}<code>{tr(short(prepared.quoteBlockHash))}</code>{tr(" · simulation gas ")}{tr(prepared.simulationGas)}{tr(" · source block ")}{tr(info?.available ? 'recorded Base' : 'local')}{tr(" · permission review binds Safe/Roles code pins. The owner retains full Safe authority.")}</p>
      {view === 'simulate' ? <div className="simulate-controls">
        <button type="button" disabled={Boolean(busy)} onClick={mode.prepare}>{tr("Simulate current revision again")}</button>
        <button type="button" disabled={Boolean(busy)} onClick={mode.refresh}>{tr("Read current permission")}</button>
      </div> : <>
        <div className="simulate-controls">
          {!mode.wallet ? <button type="button" disabled={Boolean(busy)} onClick={mode.connect}>{tr("Connect local owner wallet")}</button>
            : <span className="wallet-chip">{tr(mode.wallet.label)} · <code>{short(mode.wallet.account)}</code></span>}
          <button type="button" disabled={mode.reviewed || Boolean(busy)} onClick={mode.acceptReview}>
            {tr(mode.reviewed ? 'Permission reviewed' : 'I reviewed the finite permission and signatures')}</button>
          <button type="button" disabled={Boolean(busy)} onClick={mode.refresh}>{tr("Read chain state")}</button>
        </div>
        <ol className="mode-b-steps" aria-label={tr("Distinct owner authorizations")}>
          {prepared.compiled.installation.map((item, index) => <li key={index}>
            <div><strong>{tr(item.label)}</strong><small>{tr("Signature ")}{tr(index + 1)}{tr(" · to ")}<code>{tr(item.to)}</code></small>
              <code className="mode-b-calldata">{tr(item.data)}</code></div>
            <span>{tr(index < prepared.installationStart ? 'PRE-ENABLED · VERIFIED' : prepared.installation.some(confirmed => confirmed.index === index) ? 'CHAIN CONFIRMED' : 'WAITING')}</span>
          </li>)}
        </ol>
        {!installed && <button type="button" disabled={!mode.wallet || !mode.reviewed || mode.retired || mode.recoveryOnly || mode.quoteExpired || mode.unknownSubmission || Boolean(busy)} onClick={mode.installNext}>{tr("Request owner signature ")}{tr(installIndex + 1)} · {tr(prepared.compiled.installation[installIndex]?.label)}</button>}
        {installed && <div className="simulate-controls"><StatusBadge label="PERMISSION_INSTALLED" tone="info"/>
          <button type="button" disabled={!mode.reviewed || mode.retired || mode.recoveryOnly || Boolean(busy) || Boolean(prepared.executionHash)} onClick={mode.runWorker}>{tr("Run bounded local worker")}</button>
          {prepared.executionHash && !prepared.reconciliation && <button type="button" disabled={Boolean(busy)} onClick={mode.reconcile}>{tr("Reconcile independently")}</button>}
        </div>}
        {prepared.executionHash && <p className="simulate-note">{tr("Executor transaction ")}<code>{tr(prepared.executionHash)}</code> · {tr(prepared.reconciliation?.outcome ?? 'CONFIRMED_NOT_RECONCILED')}.</p>}
        {prepared.reconciliation && <p className="simulate-note" role="status">{tr(prepared.reconciliation.outcome)}: {tr(prepared.reconciliation.reason)}{tr(". Remaining budget ")}{tr(prepared.reconciliation.remainingBudget)}{tr(" native units; residual allowance ")}{tr(prepared.reconciliation.residualTokenAllowance)}{tr(" native units.")}</p>}
        {installed && <div className="mode-b-revoke"><h3>{tr("Wallet revocation")}</h3><p>{tr("Local pause cannot revoke. Remove the role, disable the Safe module, then clear residual router allowance with distinct owner signatures. Readback must confirm each effect.")}</p>
          <p>{tr("Module: ")}{tr(status?.moduleEnabled ? 'ENABLED' : 'DISABLED')}{tr(" · executor role: ")}{tr(status?.executorEnabled ? 'ASSIGNED' : 'REMOVED')}{tr(" · revocation: ")}{tr(revoked ? 'REVOCATION_CONFIRMED' : 'NOT_CONFIRMED')}</p>
          {!revoked && <button type="button" disabled={!mode.wallet || !mode.reviewed || mode.unknownSubmission || Boolean(busy) || revokeIndex >= prepared.compiled.revocation.length} onClick={mode.revokeNext}>{tr("Request owner revocation signature ")}{tr(revokeIndex + 1)} · {tr(prepared.compiled.revocation[revokeIndex]?.label)}</button>}
        </div>}
      </>}
    </>}
  </section>;
}

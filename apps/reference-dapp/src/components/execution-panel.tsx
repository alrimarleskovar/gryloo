// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { Attempt } from '@defi-workflow-engine/reference-executor';
import { formatHumanAmount } from '../domain/swap-authoring';
import type { ExecutionStatus, StepId, StepObservation } from '../server/mode-a-service';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import { PayloadFields } from './manifest-review';
import { StatusBadge } from './status-badge';

type StepView = { readonly attempt: Attempt | null; readonly observation: StepObservation | null; readonly label: string };
function stepView(execution: ExecutionStatus | null, stepId: StepId): StepView {
  const attempt = execution?.attempts.filter(item => item.stepId === stepId).at(-1) ?? null;
  const observation = attempt ? execution?.observations.filter(item => item.attemptId === attempt.executionAttemptId).at(-1) ?? null : null;
  if (!attempt) return { attempt, observation, label: 'NOT_REQUESTED' };
  if (attempt.state === 'CONFIRMED') return { attempt, observation, label: 'CONFIRMED_NOT_RECONCILED' };
  if (attempt.state === 'RECONCILIATION_REQUIRED') return { attempt, observation, label: observation?.outcome ?? 'RECONCILIATION_REQUIRED' };
  return { attempt, observation, label: attempt.state };
}
const tone = (label: string): 'neutral' | 'info' | 'warning' => /DIVERGENT|REVERTED|UNKNOWN|INCONCLUSIVE|NOT_FOUND/.test(label) ? 'warning' : /CONFIRMED|RECONCILED|PENDING/.test(label) ? 'info' : 'neutral';

export function ExecutionPanel() {
  const { t: tr } = useLocale();
  const { context } = useWorkflow();
  const modeA = useModeA();
  const { prepared, execution, wallet, walletError, reviewAccepted, retired, recoveryOnly, busy, error, requests, verified, info } = modeA;
  if (!prepared || !info?.available) return null;
  const approve = stepView(execution, 'step-approve');
  const swap = stepView(execution, 'step-swap');
  const revoke = stepView(execution, 'step-revoke');
  const evidence = execution?.evidence.at(-1) ?? null;
  const first = execution?.evidence.find(item => item.version === 1) ?? null;
  const revocation = execution?.revocation ?? null;
  const forward = reviewAccepted && Boolean(wallet) && !retired && !recoveryOnly && !busy;
  const amount = (units: string, symbol: 'USDC' | 'WETH') => `${formatHumanAmount(units, symbol, context)} ${symbol}`;
  const outcome = evidence ? (evidence.revocationConfirmed ? 'REVOCATION_CONFIRMED' : evidence.outcome) : swap.label === 'DIVERGENT' ? 'DIVERGENT' : null;
  const step = (id: StepId, view: StepView, title: string, enabled: boolean, action: string) => <article className="step-card" aria-label={tr(title)}>
    <div className="step-head"><h3>{tr(title)}</h3><span className={`step-status step-${view.label.toLowerCase()}`} data-step-state={view.label}>{tr(view.label)}</span></div>
    {view.attempt && <dl className="step-facts">
      <div><dt>{tr("Journal attempt")}</dt><dd><code>{tr(view.attempt.executionAttemptId)}</code></dd></div>
      <div><dt>{tr("Journaled before request")}</dt><dd>{tr("PREPARED → SUBMITTING (fsynced)")}</dd></div>
      {view.attempt.transactionHash && <div><dt>{tr("Transaction")}</dt><dd><code>{view.attempt.transactionHash}</code></dd></div>}
      {view.observation && <div><dt>{tr("Independent read")}</dt><dd>{tr(view.observation.outcome)} · {tr(view.observation.code)}</dd></div>}
    </dl>}
    {view.label === 'SUBMISSION_RESULT_UNKNOWN' && <p className="simulate-alert" role="status">{tr("The wallet result is unknown. Flofi will not request this step again; it first scans the fork (nonce, blocks, txpool) for the exact transaction.")}</p>}
    {view.label === 'DIVERGENT' && <p className="simulate-alert" role="alert">{tr("The signed transaction differs from the reviewed payload (")}{tr(view.observation?.code)}{tr("). It can never be RECONCILED.")}</p>}
    <div className="simulate-controls">
      {!view.attempt || view.label === 'NOT_FOUND'
        ? <button type="button" disabled={!enabled} onClick={() => modeA.request(id)}>{tr(action)}</button>
        : view.label === 'SUBMISSION_RESULT_UNKNOWN' || view.label === 'PENDING'
          ? <button type="button" disabled={Boolean(busy)} onClick={() => modeA.observe(id)}>{tr("Scan the fork for this attempt")}</button> : null}
    </div>
  </article>;
  return <section className="execution-panel panel" aria-label={tr("Mode A execution")}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr("EXECUTE / LOCAL FORK · CHAIN 31337")}</p><h2>{tr("Mode A execution")}</h2>
        <p className="muted">{tr("Environment ")}{tr(prepared.environment)}{tr(": local chain 31337 only. Not mainnet, not a public testnet, not production certified.")}</p></div>
      <div className="simulate-controls">
        {wallet ? <span className="wallet-chip" data-wallet-account={wallet.account}>{tr(wallet.label)} · {wallet.account.slice(0, 6)}…{wallet.account.slice(-4)} · 31337</span>
          : <button type="button" onClick={modeA.connect} disabled={Boolean(busy)}>{tr("Connect injected wallet")}</button>}
      </div>
    </div>
    {walletError && <p className="simulate-alert" role="alert">{tr("Wallet refused before any request: ")}{tr(walletError)}{tr(". Flofi never switches chains or accounts.")}</p>}
    {!reviewAccepted && <p className="simulate-note">{tr("Review the Mode A Manifest above before any wallet request.")}</p>}
    {busy && <p className="simulate-note" role="status">{tr(busy)}.</p>}
    {error && <p className="simulate-alert" role="alert">{tr("Step refused: ")}{tr(error)}.</p>}
    <div className="payload-grid">
      {tr(step('step-approve', approve, 'Step 1 · approve exact input', forward, `Request wallet signature · approve ${amount(prepared.amountIn, prepared.symbolIn)}`))}
      {tr(step('step-swap', swap, 'Step 2 · exact swap', forward && approve.label === 'CONFIRMED_NOT_RECONCILED', `Request wallet signature · swap ${amount(prepared.amountIn, prepared.symbolIn)}`))}
    </div>
    {(swap.label === 'CONFIRMED_NOT_RECONCILED' || swap.label === 'REVERTED') && !first && <div className="simulate-controls">
      <button type="button" disabled={Boolean(busy)} onClick={modeA.reconcile}>{tr("Reconcile from independent fork reads")}</button></div>}
    {outcome && <article className={`outcome-card outcome-${outcome.toLowerCase()}`} aria-label={tr("Mode A outcome")}>
      <div className="step-head"><h3>{tr("Outcome")}</h3><span className="step-status" data-outcome={outcome}>{tr(outcome)}</span></div>
      {evidence && <dl className="step-facts">
        <div><dt>{tr("Reconciliation")}</dt><dd>{tr(first?.outcome)} · {tr(first?.code)}</dd></div>
        {first?.observedOut && <div><dt>{tr("Observed output")}</dt><dd className="numeric">{tr(amount(first.observedOut, prepared.symbolOut))}</dd></div>}
        {first?.totalFee && <div><dt>{tr("Fork fees paid (gas, L1 data, operator)")}</dt><dd className="numeric">{tr(first.totalFee)}{tr(" wei")}</dd></div>}
        <div><dt>{tr("Residual router allowance")}</dt><dd className="numeric">{tr(amount(evidence.residualAllowance, prepared.symbolIn))}</dd></div>
        <div><dt>{tr("Evidence Bundle v")}{tr(evidence.version)}</dt><dd><code>{tr(evidence.bundle.evidenceBundleId)}</code> · <code data-evidence-hash="">{tr(evidence.evidenceBundleHash)}</code></dd></div>
        <div><dt>{tr("Evidence environment")}</dt><dd><StatusBadge label={evidence.bundle.environment} tone={tone(evidence.bundle.environment)}/></dd></div>
      </dl>}
    </article>}
    {first && first.residualAllowance !== '0' && <article className="step-card" aria-label={tr("Separate revocation")}>
      <div className="step-head"><h3>{tr("Separate Mode A revocation · approve(router, 0)")}</h3><span className="step-status" data-step-state={revoke.label}>{tr(evidence?.revocationConfirmed ? 'REVOCATION_CONFIRMED' : revoke.label)}</span></div>
      <p className="muted">{tr("A residual allowance remains after the failed swap. Revocation is its own reviewed authorization with its own journal and evidence; local pause does not revoke.")}</p>
      {revocation && verified['step-revoke'] && <PayloadFields decoded={verified['step-revoke'].decoded} prepared={prepared} label="Decoded fields · step-revoke"/>}
      <div className="simulate-controls">
        {!revocation && <button type="button" disabled={Boolean(busy)} onClick={modeA.prepareRevocation}>{tr("Prepare separate revocation")}</button>}
        {revocation && !revoke.attempt && <button type="button" disabled={!wallet || Boolean(busy)} onClick={() => modeA.request('step-revoke')}>{tr("Request wallet signature · revoke allowance to 0")}</button>}
        {revoke.label === 'CONFIRMED_NOT_RECONCILED' && !evidence?.revocationConfirmed && <button type="button" disabled={Boolean(busy)} onClick={modeA.confirmRevocation}>{tr("Confirm revocation from the fork")}</button>}
      </div>
    </article>}
    {requests.length > 0 && <ul className="fork-limitations" aria-label={tr("Wallet requests from this page")}>
      {requests.map((item, index) => <li key={index}>{tr(item.stepId)}{tr(" · payload ")}<code>{tr(item.payloadHash)}</code>{tr(" · wallet ")}{tr(item.outcome)}</li>)}
    </ul>}
  </section>;
}

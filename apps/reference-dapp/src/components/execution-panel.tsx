// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  const step = (id: StepId, view: StepView, title: string, enabled: boolean, action: string) => <article className="step-card" aria-label={title}>
    <div className="step-head"><h3>{title}</h3><span className={`step-status step-${view.label.toLowerCase()}`} data-step-state={view.label}>{view.label}</span></div>
    {view.attempt && <dl className="step-facts">
      <div><dt>Journal attempt</dt><dd><code>{view.attempt.executionAttemptId}</code></dd></div>
      <div><dt>Journaled before request</dt><dd>PREPARED → SUBMITTING (fsynced)</dd></div>
      {view.attempt.transactionHash && <div><dt>Transaction</dt><dd><code>{view.attempt.transactionHash}</code></dd></div>}
      {view.observation && <div><dt>Independent read</dt><dd>{view.observation.outcome} · {view.observation.code}</dd></div>}
    </dl>}
    {view.label === 'SUBMISSION_RESULT_UNKNOWN' && <p className="simulate-alert" role="status">The wallet result is unknown. Flofi will not request this step again; it first scans the fork (nonce, blocks, txpool) for the exact transaction.</p>}
    {view.label === 'DIVERGENT' && <p className="simulate-alert" role="alert">The signed transaction differs from the reviewed payload ({view.observation?.code}). It can never be RECONCILED.</p>}
    <div className="simulate-controls">
      {!view.attempt || view.label === 'NOT_FOUND'
        ? <button type="button" disabled={!enabled} onClick={() => modeA.request(id)}>{action}</button>
        : view.label === 'SUBMISSION_RESULT_UNKNOWN' || view.label === 'PENDING'
          ? <button type="button" disabled={Boolean(busy)} onClick={() => modeA.observe(id)}>Scan the fork for this attempt</button> : null}
    </div>
  </article>;
  return <section className="execution-panel panel" aria-label="Mode A execution">
    <div className="simulate-head">
      <div><p className="eyebrow">EXECUTE / LOCAL FORK · CHAIN 31337</p><h2>Mode A execution</h2>
        <p className="muted">Environment {prepared.environment}: local chain 31337 only. Not mainnet, not a public testnet, not production certified.</p></div>
      <div className="simulate-controls">
        {wallet ? <span className="wallet-chip" data-wallet-account={wallet.account}>{wallet.label} · {wallet.account.slice(0, 6)}…{wallet.account.slice(-4)} · 31337</span>
          : <button type="button" onClick={modeA.connect} disabled={Boolean(busy)}>Connect injected wallet</button>}
      </div>
    </div>
    {walletError && <p className="simulate-alert" role="alert">Wallet refused before any request: {walletError}. Flofi never switches chains or accounts.</p>}
    {!reviewAccepted && <p className="simulate-note">Review the Mode A Manifest above before any wallet request.</p>}
    {busy && <p className="simulate-note" role="status">{busy}.</p>}
    {error && <p className="simulate-alert" role="alert">Step refused: {error}.</p>}
    <div className="payload-grid">
      {step('step-approve', approve, 'Step 1 · approve exact input', forward, `Request wallet signature · approve ${amount(prepared.amountIn, prepared.symbolIn)}`)}
      {step('step-swap', swap, 'Step 2 · exact swap', forward && approve.label === 'CONFIRMED_NOT_RECONCILED', `Request wallet signature · swap ${amount(prepared.amountIn, prepared.symbolIn)}`)}
    </div>
    {(swap.label === 'CONFIRMED_NOT_RECONCILED' || swap.label === 'REVERTED') && !first && <div className="simulate-controls">
      <button type="button" disabled={Boolean(busy)} onClick={modeA.reconcile}>Reconcile from independent fork reads</button></div>}
    {outcome && <article className={`outcome-card outcome-${outcome.toLowerCase()}`} aria-label="Mode A outcome">
      <div className="step-head"><h3>Outcome</h3><span className="step-status" data-outcome={outcome}>{outcome}</span></div>
      {evidence && <dl className="step-facts">
        <div><dt>Reconciliation</dt><dd>{first?.outcome} · {first?.code}</dd></div>
        {first?.observedOut && <div><dt>Observed output</dt><dd className="numeric">{amount(first.observedOut, prepared.symbolOut)}</dd></div>}
        {first?.totalFee && <div><dt>Fork fees paid (gas, L1 data, operator)</dt><dd className="numeric">{first.totalFee} wei</dd></div>}
        <div><dt>Residual router allowance</dt><dd className="numeric">{amount(evidence.residualAllowance, prepared.symbolIn)}</dd></div>
        <div><dt>Evidence Bundle v{evidence.version}</dt><dd><code>{evidence.bundle.evidenceBundleId}</code> · <code data-evidence-hash="">{evidence.evidenceBundleHash}</code></dd></div>
        <div><dt>Evidence environment</dt><dd><StatusBadge label={evidence.bundle.environment} tone={tone(evidence.bundle.environment)}/></dd></div>
      </dl>}
    </article>}
    {first && first.residualAllowance !== '0' && <article className="step-card" aria-label="Separate revocation">
      <div className="step-head"><h3>Separate Mode A revocation · approve(router, 0)</h3><span className="step-status" data-step-state={revoke.label}>{evidence?.revocationConfirmed ? 'REVOCATION_CONFIRMED' : revoke.label}</span></div>
      <p className="muted">A residual allowance remains after the failed swap. Revocation is its own reviewed authorization with its own journal and evidence; local pause does not revoke.</p>
      {revocation && verified['step-revoke'] && <PayloadFields decoded={verified['step-revoke'].decoded} prepared={prepared} label="Decoded fields · step-revoke"/>}
      <div className="simulate-controls">
        {!revocation && <button type="button" disabled={Boolean(busy)} onClick={modeA.prepareRevocation}>Prepare separate revocation</button>}
        {revocation && !revoke.attempt && <button type="button" disabled={!wallet || Boolean(busy)} onClick={() => modeA.request('step-revoke')}>Request wallet signature · revoke allowance to 0</button>}
        {revoke.label === 'CONFIRMED_NOT_RECONCILED' && !evidence?.revocationConfirmed && <button type="button" disabled={Boolean(busy)} onClick={modeA.confirmRevocation}>Confirm revocation from the fork</button>}
      </div>
    </article>}
    {requests.length > 0 && <ul className="fork-limitations" aria-label="Wallet requests from this page">
      {requests.map((item, index) => <li key={index}>{item.stepId} · payload <code>{item.payloadHash}</code> · wallet {item.outcome}</li>)}
    </ul>}
  </section>;
}

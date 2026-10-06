// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canContinueExecution, projectExecution, startReviewedExecution, type ExecutionWorkspaceState } from '../domain/execution-presentation';
import { shellChainLabel } from '../domain/product-shell';
import { walletEnvironmentLabel } from '../wallet/environment';
import type { ExecutionRecovery } from '../domain/execution-recovery';
import type { ExecutionLifecycle } from '../domain/execution-lifecycle';
import { projectExecutionResult } from '../domain/execution-result';
import { ExecutionTimeline } from './execution-timeline';
import { NetworkBrandIcon } from './brand-icon';
import { SimulateWorkflowCanvas } from './simulate-workflow-canvas';
import { ExecutionEvidenceDetails } from './execution-evidence-details';

export type ExecuteWorkspaceProps = ExecutionWorkspaceState & {
  workflowName: string; backToBuild(): void; backToSimulate(): void; technicalDetails?: ReactNode; progress?: ExecutionLifecycle; recovery?: ExecutionRecovery;
};
export function ExecuteWorkspace(props: ExecuteWorkspaceProps) {
  const { workflowName, wallet, authorization, execution, backToBuild, backToSimulate } = props;
  const requestLock = useRef<{ fingerprint: string; error: string | null; sawBusy: boolean } | null>(null);
  const checkLock = useRef<{ sawBusy: boolean } | null>(null);
  const [checking, setChecking] = useState(false), [checkFailed, setCheckFailed] = useState(false);
  const [requesting, setRequesting] = useState(false), [requestFailed, setRequestFailed] = useState(false);
  const progress = props.progress, live = progress?.started ? progress : null;
  const [clock, setClock] = useState(() => Date.now());
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const acknowledgementKey = JSON.stringify([authorization.key, wallet.account, wallet.chain, wallet.changed]);
  const current = { ...props, acknowledged: acknowledgement === acknowledgementKey };
  const view = projectExecution(current, Math.max(clock, Date.now())), expiresAt = view.expiresAt;
  useEffect(() => {
    const lock = requestLock.current;
    if (!lock) return;
    if (props.source.state.busy) { lock.sawBusy = true; return; }
    if (lock.sawBusy || props.progress?.fingerprint !== lock.fingerprint && Boolean(props.progress) || props.source.state.error !== lock.error) { requestLock.current = null; setRequesting(false); }
  }, [props.source.state.busy, props.source.state.error, props.progress?.fingerprint]);
  const providers = live ? [...new Set(live.steps.map(step => step.provider).filter((provider): provider is string => Boolean(provider)))] : view.providers;
  const recovery = props.recovery;
  const verifying = checking || Boolean(recovery?.checking);
  const result = verifying ? null : projectExecutionResult(live);
  const reconciledCount = Object.values(live?.stepEvidence ?? {}).filter(step => step.reconciled).length;
  const recoveredCount = Object.values(live?.stepEvidence ?? {}).filter(step => step.recovered).length;
  const resultUnit = live?.planUnavailable ? 'recorded action' : 'step';
  const canContinue = Boolean(live && live.state === 'active' && canContinueExecution(current) && !requesting && !verifying && !recovery?.contextIssue);
  const check = recovery ? recovery.check : execution.check;
  const canCheck = Boolean(live && check && !requesting && !verifying && !props.source.state.busy && (recovery?.action || !recovery && live.steps.some(step => step.operations.some(op => ['submitted', 'pending', 'posted', 'settling', 'partial'].includes(op.state)))));
  const checkIsPrimary = !canContinue && (live?.state !== 'complete' || reconciledCount === 0);
  useEffect(() => {
    const lock = checkLock.current; if (!lock) return;
    if (props.source.state.busy) lock.sawBusy = true;
    else if (lock.sawBusy) { checkLock.current = null; setChecking(false); }
  }, [props.source.state.busy]);
  function checkStatus() {
    if (checkLock.current || requestLock.current || !canCheck || !check) return;
    checkLock.current = { sawBusy: false }; setChecking(true); setCheckFailed(false);
    const finish = () => { checkLock.current = null; setChecking(false); };
    try {
      const result = check();
      if (result && typeof result.then === 'function') void result.catch(() => setCheckFailed(true)).finally(finish);
    } catch { setCheckFailed(true); finish(); }
  }
  function request(continuation: boolean) {
    if (requestLock.current || checkLock.current || verifying || recovery?.contextIssue || !(continuation ? canContinueExecution(current) && live?.state === 'active' : projectExecution(current).canExecute)) return;
    requestLock.current = { fingerprint: props.progress?.fingerprint ?? '', error: props.source.state.error, sawBusy: false };
    setRequesting(true); setRequestFailed(false);
    try { Promise.resolve(continuation ? execution.next?.() : startReviewedExecution(current)).catch(() => setRequestFailed(true)); } catch { setRequestFailed(true); }
  }
  useEffect(() => {
    if (expiresAt === null || expiresAt <= Date.now()) return;
    const update = () => setClock(Date.now());
    const timer = window.setTimeout(update, Math.min(expiresAt - Date.now() + 1, 2_147_483_647));
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [expiresAt]);
  const verificationLabel = recovery?.recordOnly ? 'Updating recorded status…' : 'Checking execution status…';
  const verificationMessage = recovery?.recordOnly ? 'Refreshing the saved execution record. No transaction is resent.' : 'Checking the recorded execution. No transaction is resent.';
  const continuationLabel = execution.nextLabel === 'Verify and continue' ? 'Ready to verify execution' : 'Ready to continue';
  const continuationMessage = execution.nextLabel === 'Verify and continue' ? 'FloFi checks the recorded transaction before the next authorized step can start.' : 'The previous request is confirmed. Only the next authorized request can start.';
  const currentOperation = live?.active?.operations.find(operation => !['waiting', 'confirmed'].includes(operation.state));
  const interactionLabel = currentOperation?.state === 'wallet' ? 'Waiting for wallet…' : currentOperation?.state === 'submitting' ? currentOperation.intent ? 'Posting order…' : 'Submitting transaction…' : null;
  const interactionMessage = currentOperation?.state === 'wallet' ? 'Confirm or decline the reviewed request in your wallet.' : currentOperation?.state === 'submitting' ? currentOperation.intent ? 'The signed order is being sent to the provider. Settlement is not yet confirmed.' : 'The reviewed transaction is being submitted. Confirmation is not yet known.' : null;
  const statusLabel = live ? verifying ? verificationLabel : canContinue ? continuationLabel : result?.label ?? interactionLabel ?? recovery?.label ?? live.label : requesting && !execution.started ? 'Preparing execution…' : view.label;
  const statusMessage = live ? verifying ? verificationMessage : canContinue ? continuationMessage : result?.message ?? interactionMessage ?? recovery?.message ?? live.message : view.message;
  return <section className="execute-workspace" aria-label="Workflow execution workspace">
    <header className="execute-heading"><p className="eyebrow">EXECUTE</p><h1>{result ? 'Your execution result' : live ? 'Your workflow execution' : 'Run your workflow'}</h1><p>{result ? 'Review the current run and the recorded status of each step.' : live ? 'Follow each request and its confirmed status.' : 'Check the plan and connected wallet before starting.'}</p></header>
    <div className="execute-workspace-grid">
      {live ? <ExecutionTimeline progress={live} result={result} workflowName={workflowName} backToBuild={backToBuild} checkingOperation={verifying && !recovery?.recordOnly ? recovery?.operationId ?? null : null}/> : <SimulateWorkflowCanvas workflowName={workflowName} stage="execute" primaryAction={<><button type="button" className="simulation-back" onClick={backToBuild}>Back to Build</button><button type="button" className="primary" disabled={!view.canExecute || requesting} onClick={() => request(false)}>Execute workflow</button></>}/>}
      <aside className={`execution-summary panel${result ? ' execution-result-summary' : ''}`} aria-label={result ? 'Execution result summary' : 'Execution Summary'}>
        <h2>{result ? 'Result Summary' : 'Execution Summary'}</h2>
        <div className={`simulation-validity simulation-tone-${verifying ? 'neutral' : result ? result.tone : live ? live.state === 'complete' ? 'ready' : live.state === 'active' ? 'neutral' : live.state === 'uncertain' ? 'attention' : 'blocked' : view.canExecute ? 'ready' : view.status === 'loading' || view.status === 'empty' ? 'neutral' : 'blocked'}`} role="status" aria-live="polite"><strong><span className="simulation-status-dot" aria-hidden="true"/>{statusLabel}</strong><p>{statusMessage}</p></div>
        <dl className="simulation-summary-values">
          {result ? <>
            <div className="execution-result-count"><dt>{result.countLabel}</dt><dd>{result.completed} of {result.total}</dd></div>
            {result.networks.length > 0 && <div><dt>Networks</dt><dd>{result.networks.map(network => <span key={network} className="simulation-summary-network"><NetworkBrandIcon network={network.replace(/ \(\d+\)$/, '')}/>{network}</span>)}</dd></div>}
            {wallet.account && wallet.account !== live?.evidence?.wallet && <div><dt>Connected wallet</dt><dd title={wallet.account}>{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</dd></div>}
            {live?.evidence?.wallet && <div><dt>Execution wallet</dt><dd title={live.evidence.wallet}>{live.evidence.wallet.slice(0, 6)}…{live.evidence.wallet.slice(-4)}</dd></div>}
            {live?.evidence?.knownCosts.map(cost => <div key={cost.label} className="execution-result-cost"><dt>{cost.label}</dt><dd>{cost.value}</dd></div>)}
            {reconciledCount > 0 && <div><dt>Reconciliation</dt><dd>{reconciledCount} {resultUnit}{reconciledCount === 1 ? '' : 's'} reconciled</dd></div>}
            {recoveredCount > 0 && <div><dt>Recovery</dt><dd>{recoveredCount} {resultUnit}{recoveredCount === 1 ? '' : 's'} recovered</dd></div>}
          </> : <>
          <div><dt>{live ? 'Connected wallet' : 'Wallet'}</dt><dd title={wallet.account ?? undefined}>{wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : 'Connect your wallet'}</dd></div>
          {live?.evidence?.wallet && live.evidence.wallet !== wallet.account && <div><dt>Execution wallet</dt><dd title={live.evidence.wallet}>{live.evidence.wallet.slice(0, 6)}…{live.evidence.wallet.slice(-4)}</dd></div>}
          <div><dt>Network</dt><dd>{wallet.chain ? <span className="simulation-summary-network"><NetworkBrandIcon network={shellChainLabel(wallet.chain).replace(/ \(\d+\)$/, '')}/>{shellChainLabel(wallet.chain)}</span> : '—'}</dd></div>
          <div><dt>Environment</dt><dd>{wallet.environment === 'unknown' ? 'Unknown network' : walletEnvironmentLabel(wallet.environment)}</dd></div>
          <div><dt>Actions</dt><dd>{live ? `${live.completed} of ${live.steps.length} completed` : view.steps.length}</dd></div>
          </>}
          {providers.length > 0 && <div><dt>Providers</dt><dd>{providers.join(' · ')}</dd></div>}
          {!live && <div><dt>Authorization</dt><dd>{view.authorizationLabel}</dd></div>}
        </dl>
        {live?.active && <section className="execute-next" aria-label="Current step"><h3>{result ? 'Needs attention' : 'Current step'}</h3><p>{live.active.number}. {live.active.action}</p><p>{[live.active.provider, live.active.network].filter(Boolean).join(' · ')}</p><p>{live.active.label}</p></section>}
        {(requestFailed || live && props.source.state.error) && <p className="simulation-warning-blocking execution-request-error" role="status">The last request could not complete. Check the recorded status before taking another action.</p>}
        {live && recovery?.contextIssue && <p className="execution-context execution-recovery-attention" role="status">{recovery.contextIssue}</p>}
        {result && live?.evidence?.attention.map(item => <p className="execution-context execution-recovery-attention" key={item}>{item}</p>)}
        {live?.local && live.steps.some(step => step.operations.some(operation => operation.intent)) && <p className="execution-context">Local signed-order execution · scripted settlement. No public settlement or funds are observed.</p>}
        {checkFailed && <p className="execution-context" role="status">Unable to check execution status. The recorded result is unchanged; no transaction was resent.</p>}
        {live && live.state === 'active' && live.active?.operations.some(operation => operation.state === 'waiting') && !verifying && !requesting && !recovery?.contextIssue && !view.bindingValid && <p className="execution-context" role="status">{view.authorizationMessage}</p>}
        {execution.requiresMainnetAcknowledgement && !execution.started && <label className="execute-acknowledgement"><input type="checkbox" checked={current.acknowledged} onChange={event => setAcknowledgement(event.target.checked ? acknowledgementKey : null)}/>I understand this executes on Solana mainnet with real funds</label>}
        {!live && view.warnings.length > 0 && <ul className="simulation-warnings" aria-label="Execution blockers">{view.warnings.map((warning, index) => <li key={index} className="simulation-warning-blocking"><span className="simulation-warning-label">Blocking</span>{warning.message}</li>)}</ul>}
        {authorization.accepted && view.prompt && !execution.started && !requesting && <section className="execute-next" aria-label="Next confirmation"><h3>What happens next</h3><p>{view.prompt}</p><p>Only the next authorized request starts. Further wallet confirmations remain separate.</p></section>}
        <div className="execute-actions simulation-workspace-actions">
          {execution.connect && authorization.accepted && !wallet.changed && !execution.started && <button type="button" disabled={Boolean(props.source.state.busy)} onClick={execution.connect}>Connect execution wallet</button>}
          {live ? <>{canContinue && <button type="button" className="primary" onClick={() => request(true)}>{execution.nextLabel ?? 'Continue to wallet'}</button>}{(canCheck || verifying) && <button type="button" className={checkIsPrimary ? 'primary' : undefined} disabled={!canCheck} onClick={checkStatus}>{verifying ? recovery?.recordOnly ? 'Updating status…' : 'Checking status…' : recovery?.recordOnly ? 'Refresh status' : recovery ? 'Check status' : 'Check confirmation'}</button>}</> : null}
          <button type="button" className={result && live?.state === 'complete' && !(canCheck && checkIsPrimary) ? 'primary' : 'simulation-back'} onClick={result || view.status === 'empty' ? backToBuild : backToSimulate}>{result ? 'Return to Build' : view.status === 'empty' ? 'Create a workflow in Build' : view.label === 'Simulation expired' ? 'Simulate again' : 'Back to Simulate'}</button>
        </div>
        {live && live.state !== 'complete' && live.steps.some(step => step.operations.some(operation => operation.hash || operation.intent && ['posted', 'settling', 'partial'].includes(operation.state))) && <p className="execution-context execution-navigation-note">Leaving this view does not cancel submitted requests.</p>}
      </aside>
    </div>
    {(live || props.technicalDetails) && <details className="shell-details technical-workspace execute-technical"><summary>View technical details</summary>{live ? <ExecutionEvidenceDetails progress={live}/> : props.technicalDetails}</details>}
  </section>;
}

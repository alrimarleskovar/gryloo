// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { ExecutionLifecycle, LifecycleOperation, LifecycleState } from '../domain/execution-lifecycle';
import { Fragment } from 'react';
import type { ExecutionResult } from '../domain/execution-result';
import { executionStepEvidence, type ExecutionStepEvidence } from '../domain/execution-step-evidence';
import { shellChainLabel } from '../domain/product-shell';
import { NetworkBrandIcon, TokenBrandIcon } from './brand-icon';
import type { EvidenceValue, OperationResultEvidence } from '../domain/execution-evidence';
import { ExecutionIdentifier } from './execution-identifier';
const marker = (state: LifecycleState) => state === 'confirmed' ? '✓' : ['failed', 'uncertain', 'cancelled', 'expired', 'not-submitted'].includes(state) ? '!' : state === 'waiting' ? '○' : '●';
function Transaction({ operation }: { operation: LifecycleOperation }) {
  const hash = operation.hash;
  if (!hash) return null;
  return <ExecutionIdentifier identifier={{ label: operation.approval ? 'Approval transaction' : 'Action transaction', value: hash, kind: 'transaction', explorer: operation.explorer }}/>;
}
function StepEvidence({ evidence, action, values, facts }: { evidence: ExecutionStepEvidence; action: string; values: EvidenceValue[]; facts: OperationResultEvidence[] }) {
  const { t: tr } = useLocale();
  const comparisons = [...evidence.comparisons, ...facts.flatMap(item => item.comparisons)].filter((item, index, all) => all.findIndex(other => other.actual === item.actual && other.planned === item.planned) === index);
  const failure = facts.find(item => item.failure)?.failure;
  const message = failure === 'reverted' ? 'The transaction reverted. Earlier confirmed actions remain recorded.' : failure === 'declined' ? 'Wallet confirmation was declined. No transaction was submitted for this request.' : evidence.message;
  return <section className="execution-step-evidence" aria-label={tr(`${action} result evidence`)}>
    <div className="execution-evidence-heading"><span>{tr("Step outcome")}</span><div><strong>{tr(evidence.label)}</strong>{evidence.recovered && <span className="execution-evidence-recovered">{tr("Recovered")}</span>}</div></div>
    <p>{tr(message)}</p>
    {evidence.restored && !evidence.recovered && <p className="execution-evidence-restored">{tr("This step’s saved result was restored.")}</p>}
    {values.length > 0 && <dl className="execution-actual-values">{values.map((item, index) => <div key={`${item.label}-${index}`}><dt>{tr(item.label)}</dt><dd>{tr(item.value)}</dd></div>)}</dl>}
    {facts.filter(item => item.note).map((item, index) => <p key={index}>{tr(item.note)}</p>)}
    {comparisons.length > 0 && <div className="execution-evidence-comparison" role="group" aria-label={tr("Planned and actual values")}>
      <div className="execution-evidence-comparison-head"><span/><span>{tr("Planned")}</span><span>{tr("Actual")}</span></div>
      {comparisons.map((comparison, index) => <div key={`${comparison.label}-${index}`} className="execution-evidence-comparison-row"><span>{tr(comparison.label)}</span><span>{tr(comparison.planned)}</span><strong>{tr(comparison.actual)}</strong></div>)}
      <p>{tr("Actual values come from recorded execution effects.")}</p>
    </div>}
  </section>;
}
export function ExecutionTimeline({ progress, result, workflowName, backToBuild, checkingOperation, runContext = 'current' }: { progress: ExecutionLifecycle; result?: ExecutionResult | null; workflowName: string; backToBuild?: () => void; checkingOperation?: string | null; runContext?: 'current' | 'saved' }) {
  const { t: tr } = useLocale();
  return <section className={`execution-plan panel${result ? ' execution-result-plan' : ''}`} aria-label={tr("Execution plan")}>
    <div className="execution-plan-heading"><div><p className="eyebrow">{tr(result ? runContext === 'saved' ? 'SAVED RUN RESULT' : 'CURRENT RUN RESULT' : runContext === 'saved' ? 'SAVED EXECUTION PLAN' : 'EXECUTION PLAN')}</p><h2 title={workflowName}>{workflowName}</h2></div>{backToBuild && <button type="button" className="simulation-back" onClick={backToBuild}>{tr("Back to Build")}</button>}</div>
    {(result || runContext === 'saved') && <p className="execution-result-context">{tr("Step results ")}<span>{tr(runContext === 'saved' ? 'Saved run' : 'Current run')}{tr(" · Read-only")}</span></p>}
    {progress.local && <p className="execution-context">{tr("Local execution · no public-chain transactions")}</p>}
    {progress.restored && <p className="execution-context" role="status">{tr("Resuming display of the recorded execution. No new request has been sent.")}</p>}
    {progress.planUnavailable && <p className="execution-context">{tr("The original workflow details are unavailable in this saved run. Recorded requests and their status are shown below.")}</p>}
    <ol className="execution-timeline" aria-label={tr("Workflow step progression")}>{progress.steps.map(step => {
      const recorded = progress.stepEvidence?.[step.id] ?? executionStepEvidence(step, progress.restored);
      const facts = step.operations.flatMap(operation => progress.evidence?.operations[operation.id] ? [progress.evidence.operations[operation.id]!] : []);
      const failure = facts.find(item => item.failure)?.failure;
      const evidence = ['failed', 'cancelled', 'not-submitted'].includes(step.state) && failure === 'declined' ? { ...recorded, label: 'Transaction not submitted' }
        : step.state === 'failed' && failure === 'reverted' ? { ...recorded, label: 'Transaction reverted' } : recorded;
      const showEvidence = Boolean(result) || step.state === 'confirmed';
      return <li key={step.id} className={`execution-step execution-state-${step.state}`} aria-current={progress.active?.id === step.id && step.state !== 'waiting' ? 'step' : undefined}>
      <span className="execution-step-marker" aria-hidden="true">{tr(marker(step.state))}</span>
      <div className="execution-step-content"><div className="execution-step-heading"><h3>{tr(step.number)}. {tr(step.action)}</h3><span className="execution-state-label">{tr(step.operations.some(op => op.id === checkingOperation) ? 'Checking status…' : showEvidence ? evidence.label : step.label)}</span></div>
        <p className="execution-step-assets">{step.input !== '—' && <span className="execution-result-planned">{tr("Planned")}</span>}{step.tokens.map(token => <TokenBrandIcon key={token} symbol={token}/>)}<span>{tr(step.input)}{step.pair && <> · {tr(step.pair)}</>}</span></p>
        <p className="execution-step-context">{step.provider && <span>{tr(step.provider)} ·</span>}{step.network.split(' → ').map((network, index) => <Fragment key={`${network}-${index}`}>{index > 0 && <span aria-hidden="true">→</span>}<span className="execution-step-network"><NetworkBrandIcon network={network}/><span>{network}</span></span></Fragment>)}</p>
        {showEvidence && <StepEvidence evidence={evidence} action={step.action} values={facts.flatMap(item => item.values)} facts={facts}/>}
        <ul className="execution-operations" aria-label={tr(`${step.action} requests`)}>{step.operations.map(operation => {
          const fact = progress.evidence?.operations[operation.id];
          return <li key={operation.id} className={`execution-operation execution-state-${operation.state}`}>
          <div className="execution-operation-heading"><span>{tr(operation.approval ? 'Wallet setup · ' : '')}{tr(operation.title)}</span><strong>{tr(operation.id === checkingOperation ? 'Checking status…' : operation.label)}</strong></div>
          {operation.chain && operation.hash && <p className="execution-operation-network">{tr(shellChainLabel(operation.chain))}</p>}
          {fact ? fact.identifiers.map(identifier => <ExecutionIdentifier key={`${identifier.kind}-${identifier.value}`} identifier={identifier}/>) : <Transaction operation={operation}/>}
          {fact ? fact.fees.map((fee, index) => <p key={index} className="execution-operation-fee">{tr(fee.label)} · {tr(fee.value)}</p>) : operation.fee && <p className="execution-operation-fee">{tr("Actual network fee · ")}{tr(operation.fee)}</p>}
          {!showEvidence && fact && fact.values.length > 0 && <dl className="execution-actual-values">{fact.values.map((value, index) => <div key={index}><dt>{tr(value.label)}</dt><dd>{tr(value.value)}</dd></div>)}</dl>}
          {!showEvidence && fact?.note && <p className="execution-context">{tr(fact.note)}</p>}
        </li>; })}</ul>
      </div>
    </li>; })}</ol>
  </section>;
}

// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../../i18n/locale';
import { ExecutionTimeline } from '../execution-timeline';
import { ExecutionEvidenceDetails } from '../execution-evidence-details';
import { ExecutionIdentifier } from '../execution-identifier';
import { projectExecutionResult } from '../../domain/execution-result';
import { transactionLifecycle } from '../../domain/execution-lifecycle';
import type { DashboardDetailResponse, DashboardRunDetail, DashboardRunView } from '../../lib/dashboard/types';
import { DashboardIcon, dateLabel } from './dashboard-view';
import { DashboardStatusBadge } from './dashboard-status';
import { RunEvidence } from './run-evidence';
import { NetworkBrandIcon } from '../brand-icon';

function RecordedRequests({ detail }: { detail: DashboardRunDetail | null }) {
  const { t: tr } = useLocale();
  return <section className="panel dashboard-recorded-requests" aria-labelledby="recorded-requests-heading">
    <div className="dashboard-section-heading"><div><p className="eyebrow">{tr("REDUCED EXECUTION RECORD")}</p><h2 id="recorded-requests-heading">{tr("Recorded requests")}</h2></div><span className="dashboard-read-only">{tr("Saved run · Read-only")}</span></div>
    <p className="muted">{tr("Original workflow details are unavailable. These requests do not establish full workflow completion.")}</p>
    {detail?.attempts.length ? <ol className="dashboard-recorded-request-list">{detail.attempts.map((attempt, index) => {
      const state = transactionLifecycle(attempt.state, attempt.transactionHash, false, attempt.reconciled);
      const status = state === 'confirmed' ? attempt.reconciled ? 'Reconciled' : 'Confirmed'
        : state === 'failed' ? attempt.state === 'REJECTED' && !attempt.transactionHash ? 'Wallet confirmation declined' : attempt.state === 'REVERTED' ? 'Transaction reverted' : 'Request failed'
        : state === 'uncertain' ? 'Unresolved' : state === 'pending' ? 'Pending confirmation' : state === 'submitted' ? 'Transaction submitted'
        : state === 'preparing' ? 'Request prepared' : state === 'submitting' ? 'Submission in progress' : state === 'expired' ? 'Request expired' : state === 'cancelled' ? 'Request cancelled' : 'Not started';
      return <li key={attempt.attemptId} className={`dashboard-recorded-request execution-state-${state}`}><div className="dashboard-section-heading"><h3>{tr(index + 1)}. {tr(attempt.step.toLowerCase().replaceAll('_', ' '))}</h3><span className="execution-state-label">{tr(status)}</span></div>
        {attempt.transactionHash && <ExecutionIdentifier identifier={{ label: attempt.step.toUpperCase().includes('APPROV') ? 'Approval transaction' : attempt.step.toUpperCase() === 'DEPOSIT' ? 'Source transaction' : 'Action transaction', value: attempt.transactionHash, kind: 'transaction' }}/>}
      </li>;
    })}</ol> : <p className="dashboard-evidence-note">{tr("No execution requests are available in this record.")}</p>}
  </section>;
}

export function RunDetailView({ view, detail, connection, loading, back, execute, refresh }: {
  view: DashboardRunView | null; detail: DashboardRunDetail | null; connection: DashboardDetailResponse['connection'] | 'DISCONNECTED' | null;
  loading: boolean; back(): void; build(): void; execute(): void; refresh?: () => void;
}) {
  const { t: tr } = useLocale();
  const result = projectExecutionResult(view?.progress);
  const unavailable = connection === 'UNAVAILABLE' || connection === null || connection === 'CONNECTED';
  const updated = dateLabel(view?.run.updatedAt ?? null), created = dateLabel(view?.run.createdAt ?? null);
  const hasContext = Boolean(view && (view.attention.length || view.recovered || view.reconciled || view.progress?.restored));
  return <div className="dashboard-workspace dashboard-run-detail"><button type="button" className="dashboard-back" onClick={back}><span aria-hidden="true">←</span>{tr(" Back to Dashboard")}</button>
    {!view ? <section className="panel dashboard-empty dashboard-detail-empty" role="status"><span className="dashboard-empty-icon"><DashboardIcon kind={connection === 'DISCONNECTED' || connection === 'SIGN_IN_REQUIRED' ? 'wallet' : 'history'}/></span><p className="eyebrow">{tr("EXECUTION RECORD")}</p><h1>{tr(loading ? 'Loading execution…' : connection === 'DISCONNECTED' ? 'Connect the wallet used for this execution' : connection === 'NOT_FOUND' ? 'Run not found' : connection === 'SIGN_IN_REQUIRED' ? 'Verify your wallet to view this execution' : connection === 'NOT_CONFIGURED' ? 'Execution history unavailable in this environment' : 'Execution details temporarily unavailable')}</h1><p>{tr(loading ? 'Checking the selected execution record.' : connection === 'SIGN_IN_REQUIRED' ? 'Verify the connected wallet from Dashboard to view its saved history.' : connection === 'NOT_FOUND' ? 'This execution is unavailable for the connected wallet.' : connection === 'DISCONNECTED' ? 'Use the wallet control in the FloFi header, then return to this run.' : connection === 'NOT_CONFIGURED' ? 'Saved execution records are not available from this environment.' : 'The history source could not be reached. This does not establish that the run is missing.')}</p>{!loading && unavailable && refresh && <button type="button" onClick={refresh}>{tr("Reload details")}</button>}</section> : <>
      <div className="dashboard-detail-heading"><div><p className="eyebrow">{tr(view.current ? 'CURRENT EXECUTION' : 'SAVED EXECUTION')}{tr(" · READ-ONLY")}</p><h1 title={view.title}>{view.title}</h1>{!view.current && <p className="dashboard-title-context">{tr("Saved workflow · original title not recorded")}</p>}</div>{updated && <div className="dashboard-detail-updated"><span>{tr("Last updated")}</span><time dateTime={view.run.updatedAt!}>{tr(updated)}</time></div>}</div>
      {detail?.recordUnavailable && <section className="dashboard-notice dashboard-detail-source" role="status"><div><strong>{tr("Detailed execution records could not be loaded.")}</strong><p>{tr("The saved summary remains visible. Workflow details and actual values may be unavailable.")}</p></div>{refresh && <button type="button" onClick={refresh}>{tr("Reload details")}</button>}</section>}
      <div className={`dashboard-detail-overview${hasContext ? ' dashboard-detail-has-context' : ''}`}><section className="panel dashboard-result-summary" aria-labelledby="run-summary-heading"><div className="dashboard-section-heading"><h2 id="run-summary-heading">{tr("Run summary")}</h2><DashboardStatusBadge status={view.status}/></div><h3 className="dashboard-final-result">{tr(result?.label ?? view.status)}</h3><p>{tr(view.current ? view.message : view.message.replaceAll('current execution record', 'saved execution record'))}</p><dl>
        {view.total !== null && <div><dt>{tr("Steps confirmed")}</dt><dd>{tr(view.completed)}{tr(" of ")}{tr(view.total)}</dd></div>}
        <div><dt>{tr("Execution wallet")}</dt><dd><ExecutionIdentifier identifier={{ label: 'Execution wallet', value: view.run.ownerAccount, kind: 'reference' }}/></dd></div>
        {view.networks.length > 0 && <div><dt>{tr("Networks")}</dt><dd className="dashboard-detail-networks">{view.networks.map(network => <span key={network}><NetworkBrandIcon network={network}/>{network}</span>)}</dd></div>}
        <div><dt>{tr("Recorded evidence")}</dt><dd>{tr(view.run.hasEvidence ? 'Recorded evidence available' : 'No final bundle recorded')}</dd></div>
        {created && <div><dt>{tr("Record created")}</dt><dd><time dateTime={view.run.createdAt!}>{tr(created)}</time></dd></div>}
        {(view.progress?.evidence?.knownCosts ?? []).map(fee => <div key={fee.label}><dt>{tr(fee.label)}</dt><dd>{tr(fee.value)}</dd></div>)}
      </dl>{view.progress?.local && <p className="dashboard-local-context">{tr("Local execution · no public-chain transactions")}</p>}
      {view.current && <button type="button" className="dashboard-primary" onClick={execute}>{tr(view.status === 'Completed' || view.status === 'Completed with attention' ? 'View result in Execute' : 'Open current execution')}</button>}
      </section>{hasContext && <aside className="dashboard-detail-context" aria-label={tr("Execution follow-up")}>
        {view.attention.length > 0 && <section className="panel dashboard-detail-attention" aria-labelledby="run-attention-heading"><h2 id="run-attention-heading">{tr("Needs attention")}</h2><ul>{view.attention.map(message => <li key={message}>{tr(message)}</li>)}</ul>{!view.current && <p className="dashboard-evidence-note">{tr("This saved view does not retry or continue execution.")}</p>}</section>}
        {(view.recovered || view.reconciled || view.progress?.restored) && <section className="panel dashboard-recovery-summary" aria-labelledby="run-recovery-heading"><h2 id="run-recovery-heading">{tr("Recovery and reconciliation")}</h2><div className="dashboard-recovery-tags">{view.recovered && <span className="dashboard-record-tag">{tr("Recovered")}</span>}{view.reconciled && <span className="dashboard-record-tag">{tr("Reconciled")}</span>}{view.progress?.restored && !view.recovered && <span className="dashboard-record-tag">{tr("Saved result restored")}</span>}</div>
          {view.recovered && <p>{tr("A previously uncertain request was confirmed from its recorded execution. No action was repeated by this view.")}</p>}
          {view.reconciled && <p>{tr(view.progress ? 'Reconciliation is recorded for the steps marked Reconciled in the timeline.' : 'The saved run records a reconciled outcome.')}</p>}
          {view.progress?.restored && !view.recovered && <p>{tr("The saved result was restored for display. Restoration alone does not establish recovery or reconciliation.")}</p>}
        </section>}
      </aside>}</div>
      {view.progress ? <ExecutionTimeline progress={view.progress} result={result} workflowName={view.title} runContext={view.current ? 'current' : 'saved'}/> : <RecordedRequests detail={detail}/>}
      <RunEvidence view={view} detail={detail}/>
      <details className="shell-details technical-workspace"><summary>{tr("View technical details")}</summary>
        {view.progress ? <ExecutionEvidenceDetails progress={view.progress} runContext={view.current ? 'current' : 'saved'}/> : <ExecutionIdentifier full identifier={{ label: 'Run ID', value: view.run.runId, kind: 'reference' }}/>}
        <dl><div><dt>{tr("Recorded status")}</dt><dd>{tr(view.run.status)}</dd></div>{view.run.provenance && <div><dt>{tr("Recorded environment")}</dt><dd>{tr(view.run.provenance)}</dd></div>}{view.run.workflowId && <div><dt>{tr("Workflow reference")}</dt><dd>{view.run.workflowId}</dd></div>}{view.run.errorCode && <div><dt>{tr("Recorded issue")}</dt><dd>{tr(view.run.errorCode)}</dd></div>}</dl>
        {detail?.evidence.map(item => <section key={item.bundleHash}><h3>{tr("Archive reference")}</h3><ExecutionIdentifier full identifier={{ label: 'Evidence content hash', value: item.bundleHash, kind: 'reference' }}/></section>)}
      </details>
    </>}
  </div>;
}

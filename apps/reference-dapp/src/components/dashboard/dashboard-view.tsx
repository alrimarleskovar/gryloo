// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../../i18n/locale';
// Activity/attention structure adapted from the delivery; the canonical shell owns all controls.
import type { DashboardConnection, DashboardRunView } from '../../lib/dashboard/types';
import { DashboardStatusBadge } from './dashboard-status';

export function DashboardIcon({ kind }: { kind: 'activity' | 'wallet' | 'attention' | 'history' | 'check' }) {
  return <svg className="dashboard-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'activity' ? <><path d="M3 12h4l3-7 4 14 3-7h4"/></>
      : kind === 'wallet' ? <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18m0 5h-5v4h5"/><path d="M17 15h.01"/></>
      : kind === 'attention' ? <><path d="m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>
      : kind === 'check' ? <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>
      : <><path d="M3 10a9 9 0 1 1 1.4 7M3 4v6h6m3-3v5l3 2"/></>}
  </svg>;
}

export function dateLabel(value: string | null, language: 'EN' | 'PT' = 'EN') {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(language === 'PT' ? 'pt-PT' : 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(Date.parse(value)) + ' UTC';
}

function RunCard({ view, openRun }: { view: DashboardRunView; openRun(runId: string): void }) {
  const { t: tr, language } = useLocale();
  const updated = dateLabel(view.run.updatedAt, language);
  return <article className={`dashboard-run-card${view.current ? ' dashboard-run-current' : ''}`}>
    <div className="dashboard-run-heading"><div className="dashboard-run-title"><span className="dashboard-run-icon"><DashboardIcon kind="activity"/></span><h3 title={view.title}>{view.current ? view.title : tr(view.title)}</h3></div><DashboardStatusBadge status={view.status}/></div>
    <p className="dashboard-run-message">{tr(view.message)}</p>
    <div className="dashboard-run-facts">
      {view.total !== null && <span>{tr(view.completed)}{tr(" of ")}{tr(view.total)} {tr(view.total === 1 ? 'step' : 'steps')}{tr(" confirmed")}</span>}
      {view.networks.length > 0 && <span>{tr(view.networks.join(' → '))}</span>}
      {view.progress?.local && <span>{tr("Local execution")}</span>}
    </div>
    <div className="dashboard-run-footer"><div className="dashboard-run-records">
      {view.recovered && <span className="dashboard-record-tag dashboard-record-info">{tr("Recovered")}</span>}
      {view.reconciled && <span className="dashboard-record-tag dashboard-record-info">{tr("Reconciled")}</span>}
      {view.run.hasEvidence && <span className="dashboard-record-tag">{tr("Evidence available")}</span>}
      {updated && <time dateTime={view.run.updatedAt!}>{tr(updated)}</time>}
    </div><a className="dashboard-run-link" href={`/app/dashboard/runs/${encodeURIComponent(view.run.runId)}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openRun(view.run.runId); } }} aria-label={tr(`View ${view.title} run ${view.run.runId}`)}>{tr(view.current ? 'View current run' : 'View run')} <span aria-hidden="true">→</span></a></div>
  </article>;
}

export function DashboardView({ account, connection, runs, hasMore, loading, build, openRun, verify, verifying, verificationIssue, refresh }: {
  account: string | null; connection: DashboardConnection | null; runs: DashboardRunView[]; hasMore: boolean; loading: boolean;
  build(): void; openRun(runId: string): void; verify(): void; verifying: boolean; verificationIssue: string | null; refresh(): void;
}) {
  const { t: tr } = useLocale();
  const attention = runs.filter(run => run.attention.length > 0);
  const current = runs.filter(run => run.current);
  const recent = runs.filter(run => !run.current);
  const attentionPanel = <aside className={`panel dashboard-attention${attention.length ? ' dashboard-attention-required' : ''}`} aria-labelledby="dashboard-attention"><div className="dashboard-section-heading"><div className="dashboard-attention-heading"><DashboardIcon kind="attention"/><h2 id="dashboard-attention">{tr("Needs attention")}</h2></div>{attention.length > 0 && <span className="dashboard-attention-count" aria-label={tr(`${attention.length} available ${attention.length === 1 ? 'run needs' : 'runs need'} attention`)}>{tr(attention.length)}</span>}</div>{attention.length ? <><p className="dashboard-attention-context">{tr("Review these records before taking your next action.")}</p><ul>{attention.map(view => <li key={view.run.runId}><h3 title={view.title}>{view.current ? view.title : tr(view.title)}</h3><DashboardStatusBadge status={view.status}/>{view.attention.map(message => <p key={message}>{tr(message)}</p>)}<button type="button" onClick={() => openRun(view.run.runId)} aria-label={tr(`Review ${view.title} run ${view.run.runId}`)}>{tr("Review run ")}<span aria-hidden="true">→</span></button></li>)}</ul></> : <div className="dashboard-attention-empty">{!loading && connection === 'CONNECTED' && <span className="dashboard-empty-icon"><DashboardIcon kind="check"/></span>}<p className="muted">{tr(loading ? 'Checking available records…' : connection === 'CONNECTED' ? 'No available runs need attention.' : 'Attention appears here when execution records are available.')}</p></div>}</aside>;
  return <div className="dashboard-workspace">
    <div className="page-heading"><div><p className="eyebrow">{tr("DASHBOARD")}</p><h1>{tr("Your execution workspace")}</h1><p className="muted">{tr("Follow your workflows and the evidence behind their results.")}</p></div><button type="button" className="dashboard-primary" onClick={build}>{tr("Build workflow")}</button></div>
    {!account ? <section className="panel dashboard-empty dashboard-disconnected" role="status"><span className="dashboard-empty-icon"><DashboardIcon kind="wallet"/></span><h2>{tr("Connect your wallet to view your execution history.")}</h2><p>{tr("Use the wallet control in the FloFi header.")}</p><p className="dashboard-empty-note">{tr("Your workflows, execution status, and recorded evidence will appear here.")}</p></section> : <>
      {loading && <p className="dashboard-notice dashboard-loading" role="status"><DashboardIcon kind="history"/>{tr("Loading execution history…")}</p>}
      {!loading && connection === 'SIGN_IN_REQUIRED' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="wallet"/></span><div><strong>{tr("Verify this wallet to view saved execution history.")}</strong><p>{tr("Sign the existing wallet verification message. It does not authorize a transaction.")}</p></div><button type="button" onClick={verify} disabled={verifying}>{tr(verifying ? 'Waiting for wallet…' : 'Verify wallet for history')}</button></section>}
      {!loading && connection === 'NOT_CONFIGURED' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="history"/></span><div><strong>{tr("Saved history is unavailable in this environment")}</strong><p>{tr("Saved execution history is not available in this environment. Any current execution remains visible below.")}</p></div></section>}
      {!loading && connection === 'UNAVAILABLE' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="history"/></span><div><strong>{tr("Execution history temporarily unavailable.")}</strong><p>{tr("Saved history could not be loaded. Any current execution remains visible below.")}</p></div><button type="button" onClick={refresh}>{tr("Refresh history")}</button></section>}
      {verificationIssue && <p className="dashboard-notice dashboard-verification-issue" role="alert">{tr(verificationIssue)}</p>}
      {current.length > 0 && <section className="dashboard-current" aria-labelledby="dashboard-current"><div className="dashboard-section-heading"><div><p className="eyebrow">{tr("FROM THIS WORKSPACE")}</p><h2 id="dashboard-current">{tr("Current execution")}</h2></div><span className="dashboard-read-only">{tr("Read-only overview")}</span></div>{current.map(view => <RunCard key={view.run.runId} view={view} openRun={openRun}/>)}</section>}
      <div className="dashboard-grid">{tr(attention.length > 0 && attentionPanel)}<section className="panel dashboard-activity" aria-labelledby="dashboard-activity"><div className="dashboard-section-heading"><div><h2 id="dashboard-activity">{tr("Recent activity")}</h2><p>{tr("Saved execution records for this wallet.")}</p></div>{connection === 'CONNECTED' && <button type="button" onClick={refresh} disabled={loading}>{tr("Refresh history")}</button>}</div>
        {recent.length ? <ol className="dashboard-run-list">{recent.map(view => <li key={view.run.runId}><RunCard view={view} openRun={openRun}/></li>)}</ol> : loading ? <div className="dashboard-list-loading" aria-hidden="true"><span/><span/><span/></div> : <div className="dashboard-empty dashboard-history-empty"><span className="dashboard-empty-icon"><DashboardIcon kind="history"/></span><h3>{tr(connection === 'CONNECTED' ? current.length ? 'No other saved runs' : 'No workflows executed yet' : 'Saved records are not available yet')}</h3><p>{tr(connection === 'CONNECTED' ? current.length ? 'Your current execution is shown above. Other saved runs will appear here.' : 'Build your first workflow to see its execution history here.' : current.length ? 'Your current execution is shown above. Saved history will appear when available.' : 'No current execution is available for this wallet.')}</p>{connection === 'CONNECTED' && !current.length && <button type="button" onClick={build}>{tr("Build workflow")}</button>}</div>}
        {hasMore && <p className="dashboard-history-limit muted">{tr("Showing up to 100 recent saved runs. Older records are not included in this view.")}</p>}
      </section>{tr(!attention.length && attentionPanel)}</div>
    </>}
  </div>;
}

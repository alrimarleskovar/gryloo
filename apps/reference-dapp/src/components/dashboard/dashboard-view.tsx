// SPDX-License-Identifier: AGPL-3.0-only
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

export function dateLabel(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(Date.parse(value)) + ' UTC';
}

function RunCard({ view, openRun }: { view: DashboardRunView; openRun(runId: string): void }) {
  const updated = dateLabel(view.run.updatedAt);
  return <article className={`dashboard-run-card${view.current ? ' dashboard-run-current' : ''}`}>
    <div className="dashboard-run-heading"><div className="dashboard-run-title"><span className="dashboard-run-icon"><DashboardIcon kind="activity"/></span><h3 title={view.title}>{view.title}</h3></div><DashboardStatusBadge status={view.status}/></div>
    <p className="dashboard-run-message">{view.message}</p>
    <div className="dashboard-run-facts">
      {view.total !== null && <span>{view.completed} of {view.total} {view.total === 1 ? 'step' : 'steps'} confirmed</span>}
      {view.networks.length > 0 && <span>{view.networks.join(' → ')}</span>}
      {view.progress?.local && <span>Local execution</span>}
    </div>
    <div className="dashboard-run-footer"><div className="dashboard-run-records">
      {view.recovered && <span className="dashboard-record-tag dashboard-record-info">Recovered</span>}
      {view.reconciled && <span className="dashboard-record-tag dashboard-record-info">Reconciled</span>}
      {view.run.hasEvidence && <span className="dashboard-record-tag">Evidence available</span>}
      {updated && <time dateTime={view.run.updatedAt!}>{updated}</time>}
    </div><a className="dashboard-run-link" href={`/app/dashboard/runs/${encodeURIComponent(view.run.runId)}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openRun(view.run.runId); } }} aria-label={`View ${view.title} run ${view.run.runId}`}>{view.current ? 'View current run' : 'View run'} <span aria-hidden="true">→</span></a></div>
  </article>;
}

export function DashboardView({ account, connection, runs, hasMore, loading, build, openRun, verify, verifying, verificationIssue, refresh }: {
  account: string | null; connection: DashboardConnection | null; runs: DashboardRunView[]; hasMore: boolean; loading: boolean;
  build(): void; openRun(runId: string): void; verify(): void; verifying: boolean; verificationIssue: string | null; refresh(): void;
}) {
  const attention = runs.filter(run => run.attention.length > 0);
  const current = runs.filter(run => run.current);
  const recent = runs.filter(run => !run.current);
  const attentionPanel = <aside className={`panel dashboard-attention${attention.length ? ' dashboard-attention-required' : ''}`} aria-labelledby="dashboard-attention"><div className="dashboard-section-heading"><div className="dashboard-attention-heading"><DashboardIcon kind="attention"/><h2 id="dashboard-attention">Needs attention</h2></div>{attention.length > 0 && <span className="dashboard-attention-count" aria-label={`${attention.length} available ${attention.length === 1 ? 'run needs' : 'runs need'} attention`}>{attention.length}</span>}</div>{attention.length ? <><p className="dashboard-attention-context">Review these records before taking your next action.</p><ul>{attention.map(view => <li key={view.run.runId}><h3 title={view.title}>{view.title}</h3><DashboardStatusBadge status={view.status}/>{view.attention.map(message => <p key={message}>{message}</p>)}<button type="button" onClick={() => openRun(view.run.runId)} aria-label={`Review ${view.title} run ${view.run.runId}`}>Review run <span aria-hidden="true">→</span></button></li>)}</ul></> : <div className="dashboard-attention-empty">{!loading && connection === 'CONNECTED' && <span className="dashboard-empty-icon"><DashboardIcon kind="check"/></span>}<p className="muted">{loading ? 'Checking available records…' : connection === 'CONNECTED' ? 'No available runs need attention.' : 'Attention appears here when execution records are available.'}</p></div>}</aside>;
  return <div className="dashboard-workspace">
    <div className="page-heading"><div><p className="eyebrow">DASHBOARD</p><h1>Your execution workspace</h1><p className="muted">Follow your workflows and the evidence behind their results.</p></div><button type="button" className="dashboard-primary" onClick={build}>Build workflow</button></div>
    {!account ? <section className="panel dashboard-empty dashboard-disconnected" role="status"><span className="dashboard-empty-icon"><DashboardIcon kind="wallet"/></span><h2>Connect your wallet to view your execution history.</h2><p>Use the wallet control in the FloFi header.</p><p className="dashboard-empty-note">Your workflows, execution status, and recorded evidence will appear here.</p></section> : <>
      {loading && <p className="dashboard-notice dashboard-loading" role="status"><DashboardIcon kind="history"/>Loading execution history…</p>}
      {!loading && connection === 'SIGN_IN_REQUIRED' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="wallet"/></span><div><strong>Verify this wallet to view saved execution history.</strong><p>Sign the existing wallet verification message. It does not authorize a transaction.</p></div><button type="button" onClick={verify} disabled={verifying}>{verifying ? 'Waiting for wallet…' : 'Verify wallet for history'}</button></section>}
      {!loading && connection === 'NOT_CONFIGURED' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="history"/></span><div><strong>Saved history is unavailable in this environment</strong><p>Saved execution history is not available in this environment. Any current execution remains visible below.</p></div></section>}
      {!loading && connection === 'UNAVAILABLE' && <section className="dashboard-notice dashboard-source-notice" role="status"><span className="dashboard-notice-icon"><DashboardIcon kind="history"/></span><div><strong>Execution history temporarily unavailable.</strong><p>Saved history could not be loaded. Any current execution remains visible below.</p></div><button type="button" onClick={refresh}>Refresh history</button></section>}
      {verificationIssue && <p className="dashboard-notice dashboard-verification-issue" role="alert">{verificationIssue}</p>}
      {current.length > 0 && <section className="dashboard-current" aria-labelledby="dashboard-current"><div className="dashboard-section-heading"><div><p className="eyebrow">FROM THIS WORKSPACE</p><h2 id="dashboard-current">Current execution</h2></div><span className="dashboard-read-only">Read-only overview</span></div>{current.map(view => <RunCard key={view.run.runId} view={view} openRun={openRun}/>)}</section>}
      <div className="dashboard-grid">{attention.length > 0 && attentionPanel}<section className="panel dashboard-activity" aria-labelledby="dashboard-activity"><div className="dashboard-section-heading"><div><h2 id="dashboard-activity">Recent activity</h2><p>Saved execution records for this wallet.</p></div>{connection === 'CONNECTED' && <button type="button" onClick={refresh} disabled={loading}>Refresh history</button>}</div>
        {recent.length ? <ol className="dashboard-run-list">{recent.map(view => <li key={view.run.runId}><RunCard view={view} openRun={openRun}/></li>)}</ol> : loading ? <div className="dashboard-list-loading" aria-hidden="true"><span/><span/><span/></div> : <div className="dashboard-empty dashboard-history-empty"><span className="dashboard-empty-icon"><DashboardIcon kind="history"/></span><h3>{connection === 'CONNECTED' ? current.length ? 'No other saved runs' : 'No workflows executed yet' : 'Saved records are not available yet'}</h3><p>{connection === 'CONNECTED' ? current.length ? 'Your current execution is shown above. Other saved runs will appear here.' : 'Build your first workflow to see its execution history here.' : current.length ? 'Your current execution is shown above. Saved history will appear when available.' : 'No current execution is available for this wallet.'}</p>{connection === 'CONNECTED' && !current.length && <button type="button" onClick={build}>Build workflow</button>}</div>}
        {hasMore && <p className="dashboard-history-limit muted">Showing up to 100 recent saved runs. Older records are not included in this view.</p>}
      </section>{!attention.length && attentionPanel}</div>
    </>}
  </div>;
}

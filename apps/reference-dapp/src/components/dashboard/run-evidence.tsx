// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../../i18n/locale';
import type { DashboardRunDetail, DashboardRunView } from '../../lib/dashboard/types';
import { ExecutionIdentifier } from '../execution-identifier';
import { dateLabel } from './dashboard-view';

const environmentLabel = (value: string) => ({ PUBLIC_TESTNET: 'Public testnet', PUBLIC_MAINNET: 'Public mainnet', MOCKED: 'Mocked local execution', FORK_REPRODUCED: 'Local fork', LOCAL: 'Local execution' }[value] ?? value);
const outcomeLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll('_', ' ');

/** Display the existing UX-005 evidence and archive references; never infer execution effects. */
export function RunEvidence({ view, detail }: { view: DashboardRunView; detail: DashboardRunDetail | null }) {
  const { t: tr } = useLocale();
  const evidence = view.progress?.evidence;
  const operations = Object.values(evidence?.operations ?? {});
  const hasIdentifiers = operations.some(operation => operation.identifiers.length > 0);
  const hasValues = operations.some(operation => operation.values.length > 0);
  const archives = detail?.evidence ?? [];
  const references = (evidence?.details ?? []).filter(item => ['Evidence bundle', 'Evidence content hash', 'Evidence observed at', 'Reconciliation outcome', 'Evidence environment'].includes(item.label))
    .filter(item => !archives.some(archive => archive.bundleHash === item.value));
  return <section className="panel dashboard-run-evidence" aria-labelledby="run-evidence-heading">
    <div className="dashboard-section-heading"><div><p className="eyebrow">{tr("RECORDED EXECUTION PROOF")}</p><h2 id="run-evidence-heading">{tr("Evidence")}</h2></div><span className="dashboard-read-only">{tr("Read-only")}</span></div>
    {(hasIdentifiers || hasValues) && <p className="dashboard-evidence-intro">{tr("Recorded identifiers and reported values are shown with their requests in the timeline.")}</p>}
    {!hasValues && <p className="dashboard-evidence-note">{tr("Actual amounts are unavailable in this record. Planned values do not establish what was received.")}</p>}
    {!evidence?.knownCosts.length && <p className="dashboard-evidence-note">{tr("Network costs are not recorded here.")}</p>}
    {references.length > 0 && <dl className="dashboard-evidence-references">{references.map((item, index) => <div key={`${item.label}-${index}`}><dt>{tr(item.label)}</dt><dd>{item.copy ? <ExecutionIdentifier identifier={{ label: item.label, value: item.value, kind: 'reference' }}/>
      : item.label === 'Evidence observed at' && dateLabel(item.value) ? <time dateTime={item.value}>{tr(dateLabel(item.value))}</time>
      : item.label === 'Evidence environment' ? environmentLabel(item.value) : item.label === 'Reconciliation outcome' ? outcomeLabel(item.value) : item.value}</dd></div>)}</dl>}
    {archives.length > 0 && <div className="dashboard-evidence-archives">{archives.map(item => <article className="dashboard-evidence-archive" key={item.bundleHash}>
      <div className="dashboard-section-heading"><h3>{tr("Archived evidence")}</h3><span className={`dashboard-record-tag${item.verified ? ' dashboard-archive-verified' : ''}`}>{tr(item.verified ? 'Archive integrity verified' : 'Archive verification unavailable')}</span></div>
      <ExecutionIdentifier identifier={{ label: 'Evidence content hash', value: item.bundleHash, kind: 'reference' }}/>
      <dl>{item.outcome && <div><dt>{tr("Recorded outcome")}</dt><dd>{tr(outcomeLabel(item.outcome))}</dd></div>}{item.environment && <div><dt>{tr("Recorded environment")}</dt><dd>{tr(environmentLabel(item.environment))}</dd></div>}{dateLabel(item.createdAt) && <div><dt>{tr("Archived at")}</dt><dd><time dateTime={item.createdAt!}>{tr(dateLabel(item.createdAt))}</time></dd></div>}</dl>
      <p>{tr(item.verified ? 'Archived bytes verified by the existing FloFi evidence store. This verifies the archive’s integrity; the execution status is shown above.' : 'Archive integrity has not been verified. This reference does not establish execution success.')}</p>
    </article>)}</div>}
    {detail?.evidenceUnavailable ? <p className="dashboard-notice" role="status">{tr("Archived evidence could not be loaded. Recorded execution results remain visible.")}</p>
      : !archives.length && !references.length && <p className="dashboard-evidence-note">{tr(view.run.hasEvidence ? 'Evidence is recorded for this run, but archive details are not available in this view.' : 'No final evidence bundle is available in this record.')}</p>}
    {evidence && evidence.limitations.length > 0 && <div className="dashboard-evidence-limitations"><h3>{tr("Evidence limitations")}</h3><ul>{evidence.limitations.map(item => <li key={item}>{tr(item)}</li>)}</ul></div>}
  </section>;
}

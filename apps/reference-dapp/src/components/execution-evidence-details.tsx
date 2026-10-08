// SPDX-License-Identifier: AGPL-3.0-only

import { useLocale } from '../i18n/locale';
import type { ExecutionLifecycle } from '../domain/execution-lifecycle';
import { ExecutionIdentifier } from './execution-identifier';

/** Read-only records, in the workspace's single secondary disclosure. */
export function ExecutionEvidenceDetails({ progress, runContext = 'current' }: { progress: ExecutionLifecycle; runContext?: 'current' | 'saved' }) {
  const { t: tr } = useLocale();
  const evidence = progress.evidence;
  return <div className="execution-evidence-details">
    <h2>{tr(runContext === 'saved' ? 'Saved execution record' : 'Current execution record')}</h2>
    <dl>{(evidence?.details ?? (progress.runKey ? [{ label: 'Run ID', value: progress.runKey, copy: true }] : [])).map((item, index) => <div key={`${item.label}-${index}`}>
      <dt>{tr(item.label)}</dt><dd>{item.copy ? <ExecutionIdentifier full identifier={{ label: item.label, value: item.value, kind: 'reference' }}/> : item.value}</dd>
    </div>)}</dl>
    {progress.steps.map(step => <section key={step.id} aria-label={tr(`${step.action} technical record`)}><h3>{tr(step.number)}. {tr(step.action)}</h3>
      {step.operations.map(operation => {
        const identifiers = evidence?.operations[operation.id]?.identifiers ?? (operation.hash ? [{ label: operation.approval ? 'Approval transaction' : 'Action transaction', value: operation.hash, kind: 'transaction' as const, explorer: operation.explorer }] : []);
        return <div key={operation.id}><p>{tr(operation.title)} · {tr(operation.label)}</p>{identifiers.map(identifier => <ExecutionIdentifier key={`${identifier.kind}-${identifier.value}`} full identifier={identifier}/>)}</div>;
      })}
    </section>)}
    {evidence && evidence.limitations.length > 0 && <section><h3>{tr("Recorded limitations")}</h3><ul>{evidence.limitations.map(item => <li key={item}>{tr(item)}</li>)}</ul></section>}
  </div>;
}

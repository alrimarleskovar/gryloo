// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { chainStatus, checkChainAccess } from '../domain/artifact-chain';
import { useModeA } from '../state/mode-a-store';
import { useModeB } from '../state/mode-b-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
import { useWorkflowCapability } from '../state/capability-store';
import { workflowExecutionLabel } from '../domain/capability-view';
import type { Tab } from './top-bar';

export function SummaryBar({ tab, setTab, recoveryEnvironment }: { tab: Tab; setTab: (value: Tab) => void; recoveryEnvironment: 'Local Fork' | 'Mock' | null }) {
  const { state, chain } = useWorkflow();
  const { environment, result: capability } = useWorkflowCapability();
  const { info, prepared, retired, verifyError, verified, execution } = useModeA();
  const modeB = useModeB();
  const modeBRecord = modeB.status?.prepared;
  const modeBState = modeBRecord?.revocation.length === modeBRecord?.compiled.revocation.length && modeBRecord?.revocation.length ? 'REVOCATION_CONFIRMED'
    : modeBRecord?.reconciliation?.outcome ?? (modeBRecord ? 'REVIEW' : 'NOT PREPARED');
  const status = chainStatus(chain);
  // The chip is an access too: it shows CURRENT only while the guard passes now.
  const access = checkChainAccess(chain, state.workflow, Date.now(), performance.now());
  const shown = status === 'CURRENT' && !access.ok ? (access.code === 'ARTIFACTS_STALE' ? 'INVALIDATED' : 'EXPIRED') : status;
  // Only a current, browser-verified local-fork Manifest opens review; mocked and observed artifacts never do.
  const reviewable = Boolean(info?.available && prepared && !retired && !verifyError && verified['step-approve'] && verified['step-swap']);
  const evidence = execution?.evidence.at(-1);
  const forkState = !prepared ? 'NOT PREPARED' : evidence ? (evidence.revocationConfirmed ? 'REVOCATION_CONFIRMED' : evidence.outcome) : retired ? 'INVALIDATED' : 'REVIEW';
  return <footer className="summary-bar" data-workflow-revision={state.workflow.revision}><div><span className="eyebrow">WORKFLOW</span><strong>{state.workflow.nodes.length} steps</strong></div>
    <div className="summary-status"><StatusBadge label="Demo mode" tone="info"/>
      <StatusBadge label={'Execute: ' + (recoveryEnvironment ? 'Recovery only · ' + recoveryEnvironment : workflowExecutionLabel(capability))} tone={capability.executionSupported || recoveryEnvironment ? 'info' : 'warning'}/><StatusBadge label={`Simulation: ${shown}`}/>
      {info?.available && <StatusBadge label={`Direct review · ${forkState}`} tone="warning"/>}
      {modeB.info?.available && <StatusBadge label={`Permission review · ${modeBState}`} tone="warning"/>}</div>
    {tab === 'Build' ? <button type="button" onClick={() => setTab('Simulate')}>Open mocked simulation</button>
      : tab === 'Simulate' && (environment === 'PUBLIC_TESTNET' || environment === 'MAINNET') ?
        <button type="button" disabled aria-label="Execution unavailable">Execution unavailable</button>
      : tab === 'Simulate' && modeB.info?.available && modeBRecord ? <button type="button" className="primary" onClick={() => setTab('Execute')}>Review finite Mode B permission</button>
      : tab === 'Simulate' ? (reviewable
        ? <button type="button" className="primary" onClick={() => setTab('Execute')}>Review Mode A Manifest</button>
        : <button type="button" disabled aria-label="Manifest review unavailable">Manifest review unavailable</button>)
      : modeB.info?.available ? <button type="button" onClick={() => setTab('Simulate')}>Back to finite simulation</button>
      : prepared && info?.available ? <button type="button" onClick={() => setTab('Simulate')}>Back to local-fork simulation</button>
        : <button type="button" disabled aria-label="Execution unavailable">Execution unavailable</button>}
  </footer>;
}

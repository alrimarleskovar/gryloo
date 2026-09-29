// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflowCapability } from '../state/capability-store';
import { capabilityBlockMessage, primaryExecutionBlocker, workflowExecutionLabel } from '../domain/capability-view';

export function CapabilitySummary({ recoveryEnvironment }: { recoveryEnvironment: 'Local Fork' | 'Mock' | null }) {
  const { environment, result } = useWorkflowCapability();
  const blocker = primaryExecutionBlocker(result);
  const node = result.nodes.find(item => item.nodeId === blocker?.nodeId);
  return <section className="capability-summary panel" aria-label="Workflow readiness">
    <div><p className="eyebrow">WORKFLOW READINESS</p><h2>What you can do here</h2></div>
    <div className="capability-summary-grid">
      <span>Build <strong>{result.capabilities.AUTHOR ? 'Ready' : 'Unavailable'}</strong></span>
      <span>Simulate <strong>{result.capabilities.SIMULATE ? 'Available' : 'Unavailable'}</strong></span>
      <span>Execute <strong>{recoveryEnvironment ? 'Recovery only' : workflowExecutionLabel(result)}</strong></span>
      <span>Evidence <strong>{result.evidenceCeiling?.replaceAll('_', ' ').toLowerCase() ?? 'None'}</strong></span>
    </div>
    <p className="muted">Selected environment: {environment === 'LOCAL_FORK' ? 'Local Fork' : environment === 'PUBLIC_TESTNET' ? 'Public Testnet' : environment === 'MAINNET' ? 'Mainnet' : 'Mock'}.
      {recoveryEnvironment ? ` New execution follows the selected environment. An existing ${recoveryEnvironment} execution can be recovered from its persisted journal and policy.` :
        result.executionSupported ? ' Exact artifacts, wallet and authorization are still checked before a financial request.' :
          ' Full workflow execution is unavailable here.'}</p>
    {blocker && <p className="capability-blocker" role="status">{capabilityBlockMessage(blocker, node)}</p>}
  </section>;
}

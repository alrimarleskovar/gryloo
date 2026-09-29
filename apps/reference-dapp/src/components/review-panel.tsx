// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useWorkflow } from '../state/workflow-store';
export function ReviewPanel() {
  const { review, reviewError, state } = useWorkflow();
  const swaps = state.workflow.nodes.filter(n => n.actionType === 'asset.swap.exact-input');
  if (swaps.length === 0 && !reviewError) return null;
  return <section className="review-panel panel" aria-label="Deterministic review findings">
    <div><p className="eyebrow">REVIEW</p><h2>Workflow checks</h2>
      <p className="muted">Authoring and lint are implemented. Simulate offers MOCKED artifacts; Base execution is unavailable. Only an explicitly started local-fork acceptance environment offers Mode A wallet requests, on chain 31337. Review is not financial enforcement.</p></div>
    {reviewError ? <p className="review-block" role="alert">Workflow review blocked: {reviewError}. Check the graph before adding a swap.</p> : <ul>
      {review?.findings.map(finding => <li key={`${finding.nodeId}-${finding.code}`} className={finding.severity === 'BLOCK' ? 'review-block' : 'review-warning'}>
        <strong>{finding.severity} · {finding.code}</strong><span>{finding.nodeId} / {finding.field}: {finding.message}</span>
      </li>)}
    </ul>}
  </section>;
}

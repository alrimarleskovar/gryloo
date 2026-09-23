// SPDX-License-Identifier: AGPL-3.0-only
import { mockActions, actionKinds } from '../domain/mock-actions';
import { useWorkflow } from '../state/workflow-store';

export function ActionLibrary() {
  const { state, dispatch } = useWorkflow();
  return <aside className="library panel" aria-label="Mock action library">
    <p className="eyebrow">BUILD / 01</p><h2>Action library</h2>
    <p className="muted">Local, typed examples for composing a workflow. No adapter is connected.</p>
    <div className="action-list">{mockActions.map((action, index) =>
      <button key={action.id} type="button" className="action-card" onClick={() => dispatch({ type: 'ADD', kind: actionKinds[index]!, source: 'CANVAS', baseRevision: state.workflow.revision })}>
        <span className="action-glyph" aria-hidden="true">{index === 0 ? 'R' : index === 1 ? 'T' : 'C'}</span>
        <span><strong>{action.id.replace('mock-', 'Mock ')}</strong><small>{action.nodeClass} · Add to canvas</small></span>
        <span aria-hidden="true">+</span>
      </button>)}</div>
    <div className="library-note"><strong>One semantic plan</strong><p>Every accepted edit updates the same immutable workflow revision.</p></div>
  </aside>;
}

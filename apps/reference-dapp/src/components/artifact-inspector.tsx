// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { amountOf } from '../domain/commands';
import { useWorkflow } from '../state/workflow-store';

export function ArtifactInspector({ selectedId }: { selectedId: string | null }) {
  const { state, dispatch } = useWorkflow();
  const node = state.workflow.nodes.find((item) => item.nodeId === selectedId);
  const [amount, setAmount] = useState('');
  useEffect(() => setAmount(node ? amountOf(node) : ''), [node]);
  const locked = Boolean(node?.lockedParameters.length);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (node) dispatch({ type: 'SET_AMOUNT', nodeId: node.nodeId, amount, source: 'CANVAS', baseRevision: state.workflow.revision });
  }
  return <section className="inspector panel" aria-label="Artifact inspector"><div><p className="eyebrow">BUILD / 03</p><h2>Inspector</h2></div>
    {node ? <><p className="muted">{node.nodeId} · {node.actionType} · {node.chainId}</p>
      <form onSubmit={save}><label htmlFor="sample-amount">Sample amount (integer native units)</label><input id="sample-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" pattern="(0|[1-9][0-9]*)" disabled={locked}/><button type="submit" disabled={locked || amount === amountOf(node)}>Save parameter</button></form>
      <div className="inspector-actions"><button type="button" onClick={() => dispatch({ type: 'LOCK', nodeId: node.nodeId, locked: !locked, source: 'CANVAS', baseRevision: state.workflow.revision })}>{locked ? 'Unlock amount' : 'Lock amount'}</button><button type="button" className="quiet" onClick={() => dispatch({ type: 'REMOVE', nodeId: node.nodeId, source: 'CANVAS', baseRevision: state.workflow.revision })}>Remove node</button></div>
      <details><summary>Semantic Workflow IR</summary><pre>{JSON.stringify(state.workflow, null, 2)}</pre></details>
    </> : <div className="inspector-empty"><strong>No node selected</strong><p>Select a canvas node to edit its sample units or inspect the shared IR.</p></div>}
  </section>;
}

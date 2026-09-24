// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { amountOf } from '../domain/commands';
import { parseHumanAmount, parseSlippage, swapDetails } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';

export function ArtifactInspector({ selectedId }: { selectedId: string | null }) {
  const { state, dispatch, context, propose } = useWorkflow();
  const node = state.workflow.nodes.find(item => item.nodeId === selectedId);
  const swap = node && swapDetails(node, context);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setAmount(swap ? swap.amount : node ? amountOf(node) : '');
    setSlippage(swap?.slippage?.toString() ?? '');
    setError('');
  }, [node]);
  const locked = Boolean(node?.lockedParameters.length);
  function saveAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!node) return;
    if (swap) {
      try {
        parseHumanAmount(amount, swap.from, context);
        setError('');
        propose({ type: 'SET_SWAP_AMOUNT', nodeId: node.nodeId, amount, source: 'CANVAS', baseRevision: state.workflow.revision });
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid amount'); }
    } else dispatch({ type: 'SET_AMOUNT', nodeId: node.nodeId, amount, source: 'CANVAS', baseRevision: state.workflow.revision });
  }
  function saveSlippage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!node || !swap) return;
    try {
      parseSlippage(slippage);
      setError('');
      propose({ type: 'SET_SLIPPAGE', nodeId: node.nodeId, slippage, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid slippage'); }
  }
  return <section className="inspector panel" aria-label="Artifact inspector"><div><p className="eyebrow">BUILD / 03</p><h2>Inspector</h2></div>
    {node ? <><p className="muted">{node.nodeId} · {node.actionType} · {node.chainId}</p>
      {swap && <div className="asset-facts"><strong>{swap.from} → {swap.to} · Base</strong><span>Input: {swap.amount} {swap.from} · {swap.units} native units</span>
        <span>Input contract: {JSON.stringify(context.assets[swap.from].asset)}</span><span>Output contract: {JSON.stringify(context.assets[swap.to].asset)}</span>
        <span>Decimals: {context.assets[swap.from].asset.decimals} → {context.assets[swap.to].asset.decimals}</span>
        <span>Metadata: NOT_ONCHAIN_VERIFIED · minimum output: 0 unquoted</span>
        <span>Prototype cap: {swap.from === 'USDC' ? '1,000,000 USDC' : '1,000 WETH'}; no financial guarantee.</span></div>}
      <form onSubmit={saveAmount} className="inspector-form"><label htmlFor="sample-amount">{swap ? `Input amount (${swap.from}, decimal units)` : 'Sample amount (integer native units)'}</label>
        <input id="sample-amount" type="text" value={amount} onChange={event => setAmount(event.target.value)} inputMode={swap ? 'decimal' : 'numeric'} autoComplete="off" spellCheck={false} maxLength={swap ? 80 : 78} disabled={locked} aria-invalid={Boolean(error)}/>
        <button type="submit" disabled={locked || amount === (swap ? swap.amount : amountOf(node))}>{swap ? 'Review amount change' : 'Save parameter'}</button></form>
      {swap && <form onSubmit={saveSlippage} className="inspector-form"><label htmlFor="swap-edit-slippage">Slippage (integer bps)</label>
        <input id="swap-edit-slippage" type="text" value={slippage} onChange={event => setSlippage(event.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} aria-invalid={Boolean(error)}/>
        <button type="submit" disabled={slippage === (swap.slippage?.toString() ?? '')}>Review slippage change</button></form>}
      {error && <p role="alert" className="form-error">{error}. Check the field and review the prototype bounds.</p>}
      <div className="inspector-actions"><button type="button" onClick={() => dispatch({ type: 'LOCK', nodeId: node.nodeId, locked: !locked, source: 'CANVAS', baseRevision: state.workflow.revision })}>{locked ? 'Unlock amount' : 'Lock amount'}</button>
        <button type="button" className="quiet" onClick={() => dispatch({ type: 'REMOVE', nodeId: node.nodeId, source: 'CANVAS', baseRevision: state.workflow.revision })}>Remove node</button></div>
      <details><summary>Semantic Workflow IR</summary><pre>{JSON.stringify(state.workflow, null, 2)}</pre></details>
    </> : <div className="inspector-empty"><strong>No node selected</strong><p>Select a canvas node to edit its parameters or inspect the shared IR.</p></div>}
  </section>;
}

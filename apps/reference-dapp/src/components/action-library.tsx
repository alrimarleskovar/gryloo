// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { mockActions, actionKinds } from '../domain/mock-actions';
import { inputSymbol, parseHumanAmount, parseSlippage, type Direction } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useCow } from '../state/cow-store';

export function ActionLibrary() {
  const { state, dispatch, context, propose } = useWorkflow();
  const cowEnabled = useCow().info?.enabled === true;
  const [direction, setDirection] = useState<Direction>('USDC_TO_WETH');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [allowCow, setAllowCow] = useState(false);
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      parseHumanAmount(amount, inputSymbol(direction), context);
      parseSlippage(slippage);
      setError('');
      propose({ type: cowEnabled && allowCow ? 'ADD_COW_SWAP' : 'ADD_SWAP', direction, amount, slippage, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid swap input'); }
  }
  return <aside className="library panel" aria-label="Action library">
    <p className="eyebrow">BUILD / 01</p><h2>Action library</h2>
    <p className="muted">Local actions share one semantic workflow. Base swaps are unquoted.</p>
    <form className="swap-create" onSubmit={submit} aria-label="Create Base swap proposal">
      <strong>Exact-input swap · Base</strong>
      <label htmlFor="swap-direction">Direction</label>
      <select id="swap-direction" value={direction} onChange={event => setDirection(event.target.value as Direction)}>
        <option value="USDC_TO_WETH">USDC → WETH</option><option value="WETH_TO_USDC">WETH → USDC</option>
      </select>
      <label htmlFor="swap-amount">Input amount (required)</label>
      <input id="swap-amount" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80} value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'swap-create-error' : undefined}/>
      <label htmlFor="swap-slippage">Slippage in bps (required)</label>
      <input id="swap-slippage" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} value={slippage} onChange={event => setSlippage(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'swap-create-error' : undefined}/>
      {cowEnabled && <label className="cow-authoring-choice"><input type="checkbox" checked={allowCow} onChange={event => setAllowCow(event.target.checked)}/> Enable CoW signed intent for this swap</label>}
      {error && <p id="swap-create-error" role="alert">{error}. Check the amount, asset cap and slippage.</p>}
      <button type="submit">Review swap proposal</button>
      <small>Caps: 1,000,000 USDC or 1,000 WETH. Prototype limits; no quote or execution.</small>
    </form>
    <div className="action-list">{mockActions.map((action, index) =>
      <button key={action.id} type="button" className="action-card" onClick={() => dispatch({ type: 'ADD', kind: actionKinds[index]!, source: 'CANVAS', baseRevision: state.workflow.revision })}>
        <span className="action-glyph" aria-hidden="true">{index === 0 ? 'R' : index === 1 ? 'T' : 'C'}</span>
        <span><strong>{action.id.replace('mock-', 'Mock ')}</strong><small>{action.nodeClass} · Add to canvas</small></span>
        <span aria-hidden="true">+</span>
      </button>)}</div>
    <div className="library-note"><strong>One semantic plan</strong><p>Every accepted edit updates the same immutable workflow revision.</p></div>
  </aside>;
}

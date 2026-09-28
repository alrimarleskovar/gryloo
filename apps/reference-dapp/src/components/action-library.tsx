// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { mockActions, actionKinds } from '../domain/mock-actions';
import { inputSymbol, parseHumanAmount, parseSlippage, type Direction } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useCow } from '../state/cow-store';
import { useLiquidity } from '../state/liquidity-store';
import { createLiquidityNode, type LiquidityInput } from '../domain/liquidity-authoring';

export function ActionLibrary({ selectedId }: { selectedId: string | null }) {
  const { state, dispatch, context, propose } = useWorkflow();
  const cowEnabled = useCow().info?.enabled === true;
  const liquidityEnabled = useLiquidity().info?.available === true;
  const [direction, setDirection] = useState<Direction>('USDC_TO_WETH');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [allowCow, setAllowCow] = useState(false);
  const [error, setError] = useState('');
  const [liquidity, setLiquidity] = useState<LiquidityInput>({ weth: '', usdc: '', minimumWeth: '', minimumUsdc: '', tickLower: '', tickUpper: '', recipient: '' });
  const [liquidityError, setLiquidityError] = useState('');
  const selectedLiquidity = selectedId ? state.workflow.nodes.find(node => node.nodeId === selectedId && node.actionType === 'asset.liquidity.uniswap-v3') : null;
  function submitLiquidity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      createLiquidityNode(selectedLiquidity?.nodeId ?? 'node-preview', liquidity, context);
      setLiquidityError('');
      propose(selectedLiquidity ? { type: 'SET_LIQUIDITY', nodeId: selectedLiquidity.nodeId, input: liquidity, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_LIQUIDITY', input: liquidity, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setLiquidityError(cause instanceof Error ? cause.message : 'Invalid liquidity input'); }
  }
  function setLiquidityField(key: keyof LiquidityInput, value: string) { setLiquidity(current => ({ ...current, [key]: value })); }
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
    {liquidityEnabled && <form className="swap-create liquidity-create" onSubmit={submitLiquidity} aria-label="Create or edit Base liquidity proposal">
      <strong>Uniswap v3 position · Base</strong>
      <p className="muted">One isolated WETH/USDC position, fee tier 500. Wallet operations are reviewed separately on the local fork.</p>
      <label htmlFor="liquidity-weth">Maximum WETH</label>
      <input id="liquidity-weth" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.weth} onChange={e => setLiquidityField('weth', e.target.value)}/>
      <label htmlFor="liquidity-usdc">Maximum USDC</label>
      <input id="liquidity-usdc" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.usdc} onChange={e => setLiquidityField('usdc', e.target.value)}/>
      <label htmlFor="liquidity-min-weth">Minimum WETH received or deposited</label>
      <input id="liquidity-min-weth" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.minimumWeth} onChange={e => setLiquidityField('minimumWeth', e.target.value)}/>
      <label htmlFor="liquidity-min-usdc">Minimum USDC received or deposited</label>
      <input id="liquidity-min-usdc" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.minimumUsdc} onChange={e => setLiquidityField('minimumUsdc', e.target.value)}/>
      <label htmlFor="liquidity-lower">Lower tick</label>
      <input id="liquidity-lower" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={liquidity.tickLower} onChange={e => setLiquidityField('tickLower', e.target.value)}/>
      <label htmlFor="liquidity-upper">Upper tick</label>
      <input id="liquidity-upper" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={liquidity.tickUpper} onChange={e => setLiquidityField('tickUpper', e.target.value)}/>
      <label htmlFor="liquidity-recipient">Position NFT recipient</label>
      <input id="liquidity-recipient" type="text" autoComplete="off" spellCheck={false} maxLength={42} value={liquidity.recipient} onChange={e => setLiquidityField('recipient', e.target.value)}/>
      {liquidityError && <p role="alert">{liquidityError}</p>}
      <button type="submit">{selectedLiquidity ? 'Review position edit' : 'Review position proposal'}</button>
      <small>Pool identity, current tick and price are checked before simulation. Editing here invalidates prior liquidity artifacts.</small>
    </form>}
    <div className="action-list">{mockActions.map((action, index) =>
      <button key={action.id} type="button" className="action-card" onClick={() => dispatch({ type: 'ADD', kind: actionKinds[index]!, source: 'CANVAS', baseRevision: state.workflow.revision })}>
        <span className="action-glyph" aria-hidden="true">{index === 0 ? 'R' : index === 1 ? 'T' : 'C'}</span>
        <span><strong>{action.id.replace('mock-', 'Mock ')}</strong><small>{action.nodeClass} · Add to canvas</small></span>
        <span aria-hidden="true">+</span>
      </button>)}</div>
    <div className="library-note"><strong>One semantic plan</strong><p>Every accepted edit updates the same immutable workflow revision.</p></div>
  </aside>;
}

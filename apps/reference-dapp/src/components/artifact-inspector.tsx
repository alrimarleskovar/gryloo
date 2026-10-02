// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { liquidityDetails, validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import { createCrossChainLiquidityWorkflow, type CrossChainLiquidityInput } from '../domain/cross-chain-liquidity';
import { amountOf } from '../domain/commands';
import { bridgeDetails, createBridgeNode, type BridgeInput } from '../domain/bridge-authoring';
import { canDeleteCanvasNode } from '../domain/canvas-keyboard';
import { createLiquidityNode, type LiquidityInput } from '../domain/liquidity-authoring';
import { formatHumanAmount, parseHumanAmount, parseSlippage, swapDetails } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';

import { RepayAuthoringForm } from './repay-panel';
import { BorrowAuthoringForm } from './borrow-panel';
import { SupplyAuthoringForm } from './supply-panel';
import { SolanaSwapForm } from './jupiter-panel';
import { solanaSwapDetails, solanaSwapLabels } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { SolanaLiquidityForm } from './solana-liquidity-panel';

const emptyCrossChain: CrossChainLiquidityInput = { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: '0x1111111111111111111111111111111111111111', provider: 'lifi.rest', noSwap: false };
const emptyLiquidity: LiquidityInput = { weth: '', usdc: '', minimumWeth: '', minimumUsdc: '', tickLower: '', tickUpper: '', recipient: '' };
export function ArtifactInspector({ selectedId, select }: { selectedId: string | null; select: (id: string | null) => void }) {
  const { state, dispatch, context, propose } = useWorkflow();
  const node = state.workflow.nodes.find(item => item.nodeId === selectedId);
  const cross = useMemo(() => {
    if (!state.workflow.nodes.some(item => item.actionType === 'asset.liquidity.prepare')) return null;
    try { return validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]); } catch { return null; }
  }, [state.workflow]);
  const [crossInput, setCrossInput] = useState<CrossChainLiquidityInput>(emptyCrossChain);
  const swap = useMemo(() => node && swapDetails(node, context), [node, context]);
  const bridge = useMemo(() => node && bridgeDetails(node), [node]);
  const liquidity = useMemo(() => node && liquidityDetails(node, context), [node, context]);
  const template = node?.actionType.startsWith('mock-') ?? false;
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [bridgeInput, setBridgeInput] = useState<BridgeInput>({ amount: '', slippageBps: '50' });
  const [liquidityInput, setLiquidityInput] = useState<LiquidityInput>(emptyLiquidity);
  const [error, setError] = useState('');
  useEffect(() => {
    setAmount(swap ? swap.amount : template && node ? amountOf(node) : '');
    setSlippage(swap?.slippage?.toString() ?? '');
    setBridgeInput(bridge ? { amount: bridge.amount, slippageBps: String(bridge.slippageBps) } : { amount: '', slippageBps: '50' });
    setLiquidityInput(liquidity ? {
      weth: formatHumanAmount(liquidity.amountWeth, 'WETH', context), usdc: formatHumanAmount(liquidity.amountUsdc, 'USDC', context),
      minimumWeth: formatHumanAmount(liquidity.minimumWeth, 'WETH', context), minimumUsdc: formatHumanAmount(liquidity.minimumUsdc, 'USDC', context),
      tickLower: String(liquidity.tickLower), tickUpper: String(liquidity.tickUpper), recipient: liquidity.recipient,
    } : emptyLiquidity);
    if (cross) setCrossInput({ amount: (Number(cross.bridgeAmount) / 1e6).toString(), bridgeSlippageBps: String(cross.bridgeSlippageBps),
      swapSlippageBps: String(cross.swapSlippageBps || 50), tickLower: String(cross.tickLower), tickUpper: String(cross.tickUpper),
      recipient: cross.recipient, provider: cross.bridgeProvider, noSwap: cross.noSwap });
    setError('');
  }, [cross, node, swap?.amount, swap?.slippage, bridge?.amount, bridge?.slippageBps, liquidity, context, template]);
  const locked = Boolean(node?.lockedParameters.length);
  const deletable = canDeleteCanvasNode(state.workflow, selectedId);
  function saveAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node) return;
    if (swap) {
      try { parseHumanAmount(amount, swap.from, context); setError(''); propose({ type: 'SET_SWAP_AMOUNT', nodeId: node.nodeId, amount, source: 'CANVAS', baseRevision: state.workflow.revision }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid amount'); }
    } else if (template) dispatch({ type: 'SET_AMOUNT', nodeId: node.nodeId, amount, source: 'CANVAS', baseRevision: state.workflow.revision });
  }
  function saveSlippage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node || !swap) return;
    try { parseSlippage(slippage); setError(''); propose({ type: 'SET_SLIPPAGE', nodeId: node.nodeId, slippage, source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid slippage'); }
  }
  function saveBridge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node || !bridge) return;
    try { createBridgeNode(node.nodeId, bridgeInput); setError(''); propose({ type: 'SET_BRIDGE', nodeId: node.nodeId, input: bridgeInput, source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid bridge parameters'); }
  }
  function saveLiquidity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node || !liquidity) return;
    try { createLiquidityNode(node.nodeId, liquidityInput, context); setError(''); propose({ type: 'SET_LIQUIDITY', nodeId: node.nodeId, input: liquidityInput, source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid pool parameters'); }
  }
  function saveCross(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { createCrossChainLiquidityWorkflow(state.workflow.workflowId, state.workflow.revision + 1, crossInput);
      setError(''); propose({ type: 'AUTHOR_CROSS_CHAIN_LIQUIDITY', input: crossInput, source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid composition'); }
  }
  const supply = node?.actionType === 'supply';
  const solana = node ? solanaSwapDetails(node) : null;
  const orcaPosition = node ? solanaLiquidityDetails(node) : null;
  const label = supply ? 'Supply' : solana ? 'Swap' : orcaPosition ? 'Liquidity position' : cross && node ? 'Cross-chain liquidity' : swap ? 'Swap' : bridge ? 'Bridge' : liquidity ? 'Pool' : template && node ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : 'Action';
  return <section className="inspector panel" aria-label="Action inspector"><div><p className="eyebrow">SELECTED ACTION</p><h2>{node ? `${label} settings` : 'Settings'}</h2></div>
    {node ? <>
      {node.actionType==='repay'&&<RepayAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId}/>}
      {node.actionType==='borrow'&&<BorrowAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId}/>}
      {supply && <SupplyAuthoringForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId}/>}
      {solana && <><p className="muted">{solana.network} {solana.from} → {solana.to} via {solanaSwapLabels(solana.network).provider}{solanaSwapLabels(solana.network).testTokens ? ' · valueless test tokens' : ''} · simulate for a live quote. Changes require review.</p><SolanaSwapForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId}/></>}
      {orcaPosition && <><p className="muted">{orcaPosition.network} SOL / devUSDC via {orcaPosition.provider} · valueless test tokens · simulate against the live pool. Changes require review.</p><SolanaLiquidityForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId}/></>}
      {cross && <p className="muted">Base USDC → Arbitrum USDC → {cross.noSwap ? 'one-sided' : 'calculated partial swap →'} Uniswap v3 position. Each boundary requires fresh review and reconciliation.</p>}
      {template && <p className="muted">Template only. No provider quote or financial execution is available for this action.</p>}
      {swap && <p className="muted">{node.chainId === 'eip155:84532' ? 'Base Sepolia' : 'Base'} {swap.from} → {swap.to} · simulate for a quote. Changes require review.</p>}
      {bridge && <p className="muted">Base → Optimism USDC. A fresh quote and review are required after changes.</p>}
      {liquidity && <p className="muted">Base WETH/USDC position. Pool conditions require separate simulation.</p>}
      {(swap || template) && <form onSubmit={saveAmount} className="inspector-form"><label htmlFor="sample-amount">{swap ? `Input amount (${swap.from})` : 'Sample amount'}</label>
        <input id="sample-amount" type="text" value={amount} onChange={event => setAmount(event.target.value)} inputMode={swap ? 'decimal' : 'numeric'} autoComplete="off" spellCheck={false} maxLength={swap ? 80 : 78} disabled={locked} aria-invalid={Boolean(error)}/>
        <button type="submit" disabled={locked || amount === (swap ? swap.amount : node ? amountOf(node) : '')}>{swap ? 'Review amount change' : 'Save parameter'}</button></form>}
      {swap && <form onSubmit={saveSlippage} className="inspector-form"><label htmlFor="swap-edit-slippage">Slippage (bps)</label>
        <input id="swap-edit-slippage" type="text" value={slippage} onChange={event => setSlippage(event.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} aria-invalid={Boolean(error)}/>
        <button type="submit" disabled={slippage === (swap.slippage?.toString() ?? '')}>Review slippage change</button></form>}
      {bridge && <form onSubmit={saveBridge} className="inspector-fields"><label>USDC amount<input type="text" inputMode="decimal" value={bridgeInput.amount} onChange={event => setBridgeInput(current => ({ ...current, amount: event.target.value }))}/></label>
        <label>Maximum slippage (bps)<input type="text" inputMode="numeric" value={bridgeInput.slippageBps} onChange={event => setBridgeInput(current => ({ ...current, slippageBps: event.target.value }))}/></label><button type="submit">Review bridge change</button></form>}
      {liquidity && <form onSubmit={saveLiquidity} className="inspector-fields">{([
        ['weth', 'Maximum WETH'], ['usdc', 'Maximum USDC'], ['minimumWeth', 'Minimum WETH'], ['minimumUsdc', 'Minimum USDC'],
        ['tickLower', 'Lower tick'], ['tickUpper', 'Upper tick'], ['recipient', 'Recipient'],
      ] as const).map(([key, title]) => <label key={key}>{title}<input type="text" value={liquidityInput[key]} onChange={event => setLiquidityInput(current => ({ ...current, [key]: event.target.value }))}/></label>)}<button type="submit">Review pool change</button></form>}
      {!cross && !swap && !bridge && !liquidity && !template && !supply && !solana && <p className="muted">This step is configured through its workflow review.</p>}
      {error && <p role="alert" className="form-error">{error}. Check the parameters and try again.</p>}
      <div className="inspector-actions">{(swap || template) && <button type="button" onClick={() => dispatch({ type: 'LOCK', nodeId: node.nodeId, locked: !locked, source: 'CANVAS', baseRevision: state.workflow.revision })}>{locked ? 'Unlock amount' : 'Lock amount'}</button>}
        <button type="button" className="quiet" disabled={!deletable} onClick={() => { dispatch({ type: 'REMOVE', nodeId: node.nodeId, source: 'CANVAS', baseRevision: state.workflow.revision }); select(null); }}>Remove step</button></div>
      {!deletable && <p className="muted">This step is required by the workflow or protected.</p>}
    </> : !cross && <div className="inspector-empty"><strong>Select a step</strong><p>Choose a canvas step to edit its parameters.</p></div>}
    {cross && <form className="inspector-fields" onSubmit={saveCross} aria-label="Compose cross-chain liquidity">
      <p className="eyebrow">BASE → ARBITRUM · UNISWAP V3</p>
      <label>Source USDC amount<input value={crossInput.amount} onChange={e => setCrossInput(v => ({ ...v, amount: e.target.value }))} inputMode="decimal" /></label>
      <label>Bridge provider<select value={crossInput.provider} onChange={e => setCrossInput(v => ({ ...v, provider: e.target.value as CrossChainLiquidityInput['provider'] }))}><option value="lifi.rest">LI.FI</option><option value="across.direct">Across direct</option></select></label>
      <label>Bridge slippage (bps)<input value={crossInput.bridgeSlippageBps} onChange={e => setCrossInput(v => ({ ...v, bridgeSlippageBps: e.target.value }))} inputMode="numeric" /></label>
      <label>Destination swap slippage (bps)<input value={crossInput.swapSlippageBps} onChange={e => setCrossInput(v => ({ ...v, swapSlippageBps: e.target.value }))} inputMode="numeric" /></label>
      <label>Lower tick<input value={crossInput.tickLower} onChange={e => setCrossInput(v => ({ ...v, tickLower: e.target.value }))} inputMode="numeric" /></label>
      <label>Upper tick<input value={crossInput.tickUpper} onChange={e => setCrossInput(v => ({ ...v, tickUpper: e.target.value }))} inputMode="numeric" /></label>
      <label>LP recipient<input value={crossInput.recipient} onChange={e => setCrossInput(v => ({ ...v, recipient: e.target.value.toLowerCase() }))} autoComplete="off" /></label>
      <label><input type="checkbox" checked={crossInput.noSwap} onChange={e => setCrossInput(v => ({ ...v, noSwap: e.target.checked }))} /> No swap (USDC-only range)</label>
      <button type="submit">Review {cross ? 'composition change' : 'cross-chain composition'}</button>
      <p className="muted">A destination ETH balance is required for gas. Split amounts are computed from the reconciled bridge output and observed pool state.</p>
    </form>}
  </section>;
}

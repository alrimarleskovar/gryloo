// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { CryptoPoolForm } from './crypto-pool-form';
import { cryptoInputOf, cryptoProfile, canSelectCryptoAssets } from '../domain/crypto-action-picker';
import {LendingNodeEditor} from './lending-node-editor';
import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import { WithdrawAuthoringForm } from './withdraw-panel';
import { RobinhoodTransferAuthoringForm } from './robinhood-transfer-panel';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { liquidityDetails, validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import { createCrossChainLiquidityWorkflow, type CrossChainLiquidityInput } from '../domain/cross-chain-liquidity';
import { amountOf } from '../domain/commands';
import { TokenAmountInput } from './token-amount-input';
import { bridgeDetails, createBridgeNode, type BridgeInput } from '../domain/bridge-authoring';
import { canDeleteCanvasNode } from '../domain/canvas-keyboard';
import { createLiquidityNode, type LiquidityInput } from '../domain/liquidity-authoring';
import { inputSymbol, formatHumanAmount, parseHumanAmount, parseSlippage, swapDetails } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { composerSummary, composerNodeState } from '../domain/composer-presentation';

import { RepayAuthoringForm } from './repay-panel';
import { BorrowAuthoringForm } from './borrow-panel';
import { SupplyAuthoringForm } from './supply-panel';
import { SolanaSwapForm } from './jupiter-panel';
import { solanaSwapDetails, solanaSwapLabels } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import { SolanaLiquidityForm } from './solana-liquidity-panel';
import { UniswapLiquidityForm } from './uniswap-liquidity-panel';
import { uniswapLiquidityDetails } from '../domain/uniswap-liquidity-authoring';
import { RouterForm } from './router-panel';
import { routerDetails } from '../domain/router-authoring';
import { canEditCanvasAmount, setupSummary } from '../domain/canvas-action-setup';
import { supplyReviewFormId, poolReviewFormId } from './composer-card';
import { usePoolContributionInputs, useStockCardInputs } from './canvas-card-inputs';
import { StocksSettings } from './stocks-settings';

const emptyCrossChain: CrossChainLiquidityInput = { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900', recipient: '0x1111111111111111111111111111111111111111', provider: 'lifi.rest', noSwap: false };
const emptyLiquidity: LiquidityInput = { weth: '', usdc: '', minimumWeth: '', minimumUsdc: '', tickLower: '', tickUpper: '', recipient: '' };
type InspectorProps = {
  selectedId: string | null; select: (id: string | null) => void;
  expanded?: boolean; onExpandedChange: (expanded: boolean) => void;
};
export function ArtifactInspector(props: InspectorProps) {
  const stocks = useStockCardInputs();
  const card = stocks.cards.find(card => card.id === props.selectedId);
  return card ? <StocksSettings card={card} expanded={props.expanded ?? false} onExpandedChange={props.onExpandedChange}/> : <CanonicalArtifactInspector {...props}/>;
}
function CanonicalArtifactInspector({ selectedId, select, expanded = false, onExpandedChange }: InspectorProps) {
  const { t: tr } = useLocale();
  const { state, dispatch, context, propose, review, actionSetup = null, amountInputs = {}, bridgeNetworkInputs = {}, cryptoSelections = {}, dismissProposal, editCanvasAmount, reviewCanvasAmount, removeActionSetup } = useWorkflow();
  const contentId = useId();
  const lending=isLendingComposition(state.workflow);
  const node = state.workflow.nodes.find(item => item.nodeId === selectedId && !item.actionType.startsWith('mock-'));
  const setup = actionSetup?.id === selectedId ? actionSetup : null;
  const contributions = usePoolContributionInputs(node?.nodeId);
  const cross = useMemo(() => {
    if (!state.workflow.nodes.some(item => item.actionType === 'asset.liquidity.prepare')) return null;
    try { return validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]); } catch { return null; }
  }, [state.workflow]);
  const [crossInput, setCrossInput] = useState<CrossChainLiquidityInput>(emptyCrossChain);
  const swap = useMemo(() => lending?null:node && swapDetails(node, context), [node, context,lending]);
  const bridge = useMemo(() => node && bridgeDetails(node), [node]);
  const liquidity = useMemo(() => node && liquidityDetails(node, context), [node, context]);
  const template = node?.actionType.startsWith('mock-') ?? false;
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [bridgeInput, setBridgeInput] = useState<BridgeInput>({ amount: '', slippageBps: '50' });
  const [liquidityInput, setLiquidityInput] = useState<LiquidityInput>(emptyLiquidity);
  const effectiveLiquidityInput = liquidity && contributions.values ? { ...liquidityInput, weth: contributions.values[0]!.amount, usdc: contributions.values[1]!.amount } : liquidityInput;
  const [error, setError] = useState('');
  const cryptoInput = node && canSelectCryptoAssets(node, state.workflow) ? cryptoInputOf(node) : null;
  useEffect(() => {
    setAmount(swap ? swap.amount : template && node ? amountOf(node) : '');
    setSlippage(swap?.slippage?.toString() ?? cryptoInput?.slippage ?? '');
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
  }, [cross, node, swap?.amount, swap?.slippage, cryptoInput?.slippage, bridge?.amount, bridge?.slippageBps, liquidity, context, template]);
  const selection = node ? cryptoSelections[node.nodeId] ?? cryptoInput?.selection : undefined;
  const cryptoSwap = cryptoInput?.selection.action === 'swap' ? cryptoInput : null;
  const locked = Boolean(node?.lockedParameters.length);
  const deletable = canDeleteCanvasNode(state.workflow, selectedId);
  function saveAmount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node) return;
    if (swap && amountInputs[node.nodeId] !== undefined) { setError(reviewCanvasAmount(node.nodeId) ?? ''); return; }
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
    const input = { ...bridgeInput, amount: amountInputs[node.nodeId] ?? bridgeInput.amount };
    try { createBridgeNode(node.nodeId, input); setError(''); propose({ type: 'SET_BRIDGE', nodeId: node.nodeId, input, source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid bridge parameters'); }
  }
  function saveLiquidity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!node || !liquidity) return;
    try { createLiquidityNode(node.nodeId, effectiveLiquidityInput, context); setError(''); propose({ type: 'SET_LIQUIDITY', nodeId: node.nodeId, input: effectiveLiquidityInput, source: 'CANVAS', baseRevision: state.workflow.revision }); }
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
  const uniPosition = node ? uniswapLiquidityDetails(node) : null;
  const routed = node ? routerDetails(node) : null;
  const label = node?.actionType === 'borrow' && !lending ? 'Borrow' : node?.actionType === 'repay' ? 'Repay' : node?.actionType === 'withdraw' ? 'Withdraw' : lending ? (node?.nodeId==='lending-supply'?'Aave Supply':node?.nodeId==='lending-borrow'?'Aave Borrow':'Uniswap Swap') : supply ? 'Supply' : solana ? 'Swap' : orcaPosition || uniPosition ? 'Liquidity position' : routed ? 'Cross-chain bridge' : cross && node ? 'Cross-chain liquidity' : swap ? 'Swap' : bridge ? 'Bridge' : liquidity ? 'Pool' : template && node ? node.actionType.slice(5).replace(/^./, letter => letter.toUpperCase()) : 'Action';
  const canonicalSummary = node ? composerSummary(state.workflow, node, context) : setup ? setupSummary(setup, context) : null;
  const networks = node ? bridgeNetworkInputs[node.nodeId] : undefined;
  const selectedSummary = canonicalSummary && node && cryptoSelections[node.nodeId] ? { ...canonicalSummary, chain: selection!.network, provider: cryptoProfile(selection!)!.provider } : canonicalSummary;
  const summary = selectedSummary && networks ? { ...selectedSummary, chain: `${networks.source} → ${networks.destination}` } : selectedSummary;
  const displayAmount = node && amountInputs[node.nodeId] !== undefined ? `${amountInputs[node.nodeId] || '0'} ${selection?.from ?? swap?.from ?? 'USDC'}` : summary?.amount;
  const validation = node ? composerNodeState(review, node.nodeId) : null;
  const open = Boolean((node || setup) && expanded);
  return <section className="inspector panel inspector-disclosure" aria-label={tr("Action inspector")}>
    <button type="button" className="inspector-toggle" aria-expanded={open} aria-controls={contentId} disabled={!node && !setup} onClick={() => onExpandedChange(!open)}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m6 3 5 5-5 5"/></svg>
      <span>{tr("Advanced Settings")}</span>
    </button>
    <div id={contentId} className="inspector-body" hidden={!open}>
    <h2>{tr(setup ? `${setupSummary(setup, context).action} settings` : node ? `${label} settings` : 'Settings')}</h2>
    {summary && <p className="composer-editor-context">{tr(summary.action)} · {tr(summary.provider)} · {tr(summary.chain)} · {tr(displayAmount)}</p>}
    {validation && validation.findings.length > 0 && <div className="composer-findings" aria-label={tr("Selected action checks")}>
      {validation.findings.map(finding => <p key={`${finding.code}:${finding.field}`}><span aria-hidden="true">⚠ </span>{tr(finding.message)}</p>)}
    </div>}
    {setup?.action === 'pool' && !setup.cryptoSelection && <UniswapLiquidityForm key={setup.id} nodeId={setup.id} reviewFormId={poolReviewFormId(setup.id)}/>}
    {(setup?.action === 'pool' && setup.cryptoSelection || node && cryptoSelections[node.nodeId]?.action === 'pool') && <CryptoPoolForm key={`${setup?.id ?? node!.nodeId}:${setup?.cryptoSelection?.network ?? cryptoSelections[node!.nodeId]?.network}`} nodeId={setup?.id ?? node!.nodeId}/>}
    {setup && setup.action !== 'pool' && <form id={setup.action !== 'swap' && setup.action !== 'bridge' ? supplyReviewFormId(setup.id) : undefined} className="inspector-form" aria-label={tr(`Configure ${setupSummary(setup, context).action}`)} onSubmit={event => { event.preventDefault(); setError(reviewCanvasAmount(setup.id) ?? ''); }}>
      <label htmlFor="configure-action-amount">{tr("Source amount (")}{tr(setup.action === 'swap' ? setup.cryptoSelection?.from ?? inputSymbol(setup.direction ?? 'USDC_TO_WETH') : 'USDC')})</label>
      <TokenAmountInput id="configure-action-amount" value={setup.amount} maxLength={80} onValueChange={value => { setError(''); editCanvasAmount(setup.id, value); }}/>
      <p className="muted">{tr("Enter an amount greater than 0 to configure this action.")}</p>
      {error && <p className="form-error" role="alert">{tr(error)}</p>}
      <p className="muted">{tr("Review and apply the amount in the card.")}</p>
      <button type="button" className="quiet" onClick={() => { removeActionSetup(); select(null); }}>{tr("Remove step")}</button>
    </form>}
    {node ? <>
      {node.actionType==='asset.transfer'&&<RobinhoodTransferAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId}/>}
      {node.actionType==='withdraw'&&<WithdrawAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId} reviewFormId={supplyReviewFormId(node.nodeId)}/>}
      {node.actionType==='repay'&&<RepayAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId} reviewFormId={supplyReviewFormId(node.nodeId)}/>}
      {lending&&<LendingNodeEditor key={`${node.nodeId}:${state.workflow.revision}`} nodeId={node.nodeId} {...(supply || node.actionType === 'borrow' ? { reviewFormId: supplyReviewFormId(node.nodeId) } : {})}/>}
      {!lending&&node.actionType==='borrow'&&<BorrowAuthoringForm key={node.nodeId+':'+state.workflow.revision} nodeId={node.nodeId} reviewFormId={supplyReviewFormId(node.nodeId)}/>}
      {!lending && supply && <SupplyAuthoringForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId} reviewFormId={supplyReviewFormId(node.nodeId)}/>}
      {solana && !cryptoSwap && <><p className="muted">{tr(solana.network)} {tr(solana.from)} → {tr(solana.to)}{tr(" via ")}{tr(solanaSwapLabels(solana.network).provider)}{tr(solanaSwapLabels(solana.network).testTokens ? ' · valueless test tokens' : '')}{tr(" · simulate for a live quote. Changes require review.")}</p><SolanaSwapForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId}/></>}
      {cryptoSwap && selection && <form className="inspector-form" aria-label={tr("Edit Swap")} onSubmit={event => {
        event.preventDefault();
        propose({ type: 'SET_CRYPTO_ACTION', nodeId: node.nodeId, input: { ...cryptoSwap, selection, amount: amountInputs[node.nodeId] ?? cryptoSwap.amount, slippage }, source: 'CANVAS', baseRevision: state.workflow.revision });
      }}>
        <label>{tr("Input amount (")}{tr(selection.from)})<TokenAmountInput value={amountInputs[node.nodeId] ?? cryptoSwap.amount} onValueChange={value => editCanvasAmount(node.nodeId, value)}/></label>
        <label>{tr("Slippage (bps)")}<input value={slippage} onChange={event => { dismissProposal(); setSlippage(event.target.value); }} inputMode="numeric"/></label>
        <button type="submit">{tr("Review Swap settings")}</button>
      </form>}
      {routed && <><p className="muted">{tr(routed.source)}{tr(" USDC → ")}{tr(routed.network === 'testnet' ? 'Arbitrum Sepolia' : 'Arbitrum One')}{tr(" USDC through the Cross-chain Router · ")}{tr(routed.network === 'testnet' ? 'test USDC' : 'real funds')}{tr(" · a fresh route, simulation and Review are required after changes.")}</p><RouterForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId}/></>}
      {uniPosition && !cryptoSelections[node.nodeId] && <><p className="muted">{tr(uniPosition.network)}{tr(" USDC / WETH via ")}{tr(uniPosition.provider)}{tr(" · fee 0.05% · test tokens · simulate against the live pool. Changes require review.")}</p><UniswapLiquidityForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId} reviewFormId={poolReviewFormId(node.nodeId)}/></>}
      {orcaPosition && !cryptoSelections[node.nodeId] && <><p className="muted">{tr(orcaPosition.network)}{tr(" SOL / devUSDC via ")}{tr(orcaPosition.provider)}{tr(" · valueless test tokens · simulate against the live pool. Changes require review.")}</p><SolanaLiquidityForm key={node.nodeId + ':' + state.workflow.revision} nodeId={node.nodeId} reviewFormId={poolReviewFormId(node.nodeId)}/></>}
      {cross && <p className="muted">{tr("Base USDC → Arbitrum USDC → ")}{tr(cross.noSwap ? 'one-sided' : 'calculated partial swap →')}{tr(" Uniswap v3 position. Each boundary requires fresh review and reconciliation.")}</p>}
      {template && <p className="muted">{tr("Template only. No provider quote or financial execution is available for this action.")}</p>}
      {swap && !cryptoSwap && <p className="muted">{tr(node.chainId === 'eip155:84532' ? 'Base Sepolia' : node.chainId === 'eip155:11155111' ? 'Ethereum Sepolia' : 'Base')} {tr(swap.from)} → {tr(swap.to)}{tr(" · simulate for a quote. Changes require review.")}</p>}
      {bridge && <p className="muted">{tr("Base → Optimism USDC. A fresh quote and review are required after changes.")}</p>}
      {liquidity && <p className="muted">{tr("Base WETH/USDC position. Pool conditions require separate simulation.")}</p>}
      {(swap && !cryptoSwap || template) && <form onSubmit={saveAmount} className="inspector-form"><label htmlFor="sample-amount">{tr(swap ? `Input amount (${swap.from})` : 'Sample amount')}</label>
        <TokenAmountInput id="sample-amount" value={node ? amountInputs[node.nodeId] ?? amount : amount} onValueChange={value => swap && node ? editCanvasAmount(node.nodeId, value) : setAmount(value)} inputMode={swap ? 'decimal' : 'numeric'} maxLength={swap ? 80 : 78} disabled={locked} aria-invalid={Boolean(error)}/>
        {node && canEditCanvasAmount(node, context, state.workflow) ? <p className="muted">{tr("Review and apply the amount in the card.")}</p>
          : <button type="submit" disabled={locked || (node ? amountInputs[node.nodeId] ?? amount : amount) === (swap ? swap.amount : node ? amountOf(node) : '')}>{tr(swap ? 'Review amount change' : 'Save parameter')}</button>}</form>}
      {swap && !cryptoSwap && <form onSubmit={saveSlippage} className="inspector-form"><label htmlFor="swap-edit-slippage">{tr("Slippage (bps)")}</label>
        <input id="swap-edit-slippage" type="text" value={slippage} onChange={event => setSlippage(event.target.value)} inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} aria-invalid={Boolean(error)}/>
        <button type="submit" disabled={slippage === (swap.slippage?.toString() ?? '')}>{tr("Review slippage change")}</button></form>}
      {bridge && <form onSubmit={saveBridge} className="inspector-fields"><label>{tr("USDC amount")}<TokenAmountInput value={amountInputs[node.nodeId] ?? bridgeInput.amount} onValueChange={value => editCanvasAmount(node.nodeId, value)}/></label>
        <label>{tr("Maximum slippage (bps)")}<input type="text" inputMode="numeric" value={bridgeInput.slippageBps} onChange={event => setBridgeInput(current => ({ ...current, slippageBps: event.target.value }))}/></label><button type="submit">{tr("Review bridge change")}</button></form>}
      {liquidity && !cryptoSelections[node.nodeId] && <form id={poolReviewFormId(node.nodeId)} onSubmit={saveLiquidity} className="inspector-fields">{([
        ['weth', 'Maximum WETH'], ['usdc', 'Maximum USDC'], ['minimumWeth', 'Minimum WETH'], ['minimumUsdc', 'Minimum USDC'],
        ['tickLower', 'Lower tick'], ['tickUpper', 'Upper tick'], ['recipient', 'Recipient'],
      ] as const).map(([key, title]) => <label key={key}>{tr(title)}<input type="text" value={effectiveLiquidityInput[key]} onChange={event => {
        if (key === 'weth' || key === 'usdc') contributions.edit(key === 'weth' ? 0 : 1, event.target.value);
        setLiquidityInput(current => ({ ...current, [key]: event.target.value }));
      }}/></label>)}</form>}
      {!lending && !cross && !swap && !bridge && !liquidity && !template && !supply && !solana && !uniPosition && <p className="muted">{tr("This step is configured through its workflow review.")}</p>}
      {error && <p role="alert" className="form-error">{tr(error)}{tr(". Check the parameters and try again.")}</p>}
      <div className="inspector-actions">{(swap || template) && <button type="button" onClick={() => dispatch({ type: 'LOCK', nodeId: node.nodeId, locked: !locked, source: 'CANVAS', baseRevision: state.workflow.revision })}>{tr(locked ? 'Unlock amount' : 'Lock amount')}</button>}
        <button type="button" className="quiet" disabled={!deletable} onClick={() => { dispatch({ type: 'REMOVE', nodeId: node.nodeId, source: 'CANVAS', baseRevision: state.workflow.revision }); select(null); }}>{tr("Remove step")}</button></div>
      {!deletable && <p className="muted">{tr("This step is required by the workflow or protected.")}</p>}
    </> : null}
    {cross && node && <form className="inspector-fields" onSubmit={saveCross} aria-label={tr("Compose cross-chain liquidity")}>
      <p className="eyebrow">{tr("BASE → ARBITRUM · UNISWAP V3")}</p>
      <label>{tr("Source USDC amount")}<input value={crossInput.amount} onChange={e => setCrossInput(v => ({ ...v, amount: e.target.value }))} inputMode="decimal" /></label>
      <label>{tr("Bridge provider")}<select value={crossInput.provider} onChange={e => setCrossInput(v => ({ ...v, provider: e.target.value as CrossChainLiquidityInput['provider'] }))}><option value="lifi.rest">{tr("LI.FI")}</option><option value="across.direct">{tr("Across direct")}</option></select></label>
      <label>{tr("Bridge slippage (bps)")}<input value={crossInput.bridgeSlippageBps} onChange={e => setCrossInput(v => ({ ...v, bridgeSlippageBps: e.target.value }))} inputMode="numeric" /></label>
      <label>{tr("Destination swap slippage (bps)")}<input value={crossInput.swapSlippageBps} onChange={e => setCrossInput(v => ({ ...v, swapSlippageBps: e.target.value }))} inputMode="numeric" /></label>
      <label>{tr("Lower tick")}<input value={crossInput.tickLower} onChange={e => setCrossInput(v => ({ ...v, tickLower: e.target.value }))} inputMode="numeric" /></label>
      <label>{tr("Upper tick")}<input value={crossInput.tickUpper} onChange={e => setCrossInput(v => ({ ...v, tickUpper: e.target.value }))} inputMode="numeric" /></label>
      <label>{tr("LP recipient")}<input value={crossInput.recipient} onChange={e => setCrossInput(v => ({ ...v, recipient: e.target.value.toLowerCase() }))} autoComplete="off" /></label>
      <label><input type="checkbox" checked={crossInput.noSwap} onChange={e => setCrossInput(v => ({ ...v, noSwap: e.target.checked }))} />{tr(" No swap (USDC-only range)")}</label>
      <button type="submit">{tr("Review ")}{tr(cross ? 'composition change' : 'cross-chain composition')}</button>
      <p className="muted">{tr("A destination ETH balance is required for gas. Split amounts are computed from the reconciled bridge output and observed pool state.")}</p>
    </form>}
    </div>
  </section>;
}

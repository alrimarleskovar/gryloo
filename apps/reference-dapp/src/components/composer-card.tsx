// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';
import type { Command } from '../domain/commands';
import type { CanvasAction } from '../domain/canvas-authoring';
import { ActionIcon } from './action-icon';
import { useEffect, useId, useRef, useState } from 'react';
import { PoolPriceRange, usePoolPriceRange, type PoolPricePreset } from './pool-price-range';
import { TokenAmountInput } from './token-amount-input';

export type CanvasAmountEditor = { value: string; changed: boolean; canApply: boolean; formId?: string; onChange(value: string): void; onReview(): string | null; onApply(): void; onCancel?: () => void };
export function supplyReviewFormId(nodeId: string) { return `composer-supply-review-${nodeId}`; }

export function poolReviewFormId(nodeId: string) { return `composer-pool-review-${nodeId}`; }
/** Route existing liquidity edit proposals to their card; no new authoring commands. */
export function poolProposalTarget(command: Command): string | null {
  return ['SET_LIQUIDITY', 'SET_UNISWAP_LIQUIDITY', 'SET_SOLANA_LIQUIDITY'].includes(command.type) && 'nodeId' in command ? command.nodeId : null;
}

const actionIcons: Record<string, CanvasAction | 'transfer'> = {
  Swap: 'swap', Bridge: 'bridge', 'Pool / Liquidity': 'pool', 'Prepare liquidity': 'pool',
  Supply: 'supply', Lending: 'lending', Borrow: 'borrow', Repay: 'repay', Withdraw: 'withdraw', Transfer: 'transfer',
};

function TokenChip({ symbol, network }: { symbol: string; network: string }) {
  return <span className="composer-token-chip">
    <span className="composer-token-avatar" data-token={symbol}>
      {symbol === 'USDC' ? <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M6 4a7 7 0 0 0 0 12m8-12a7 7 0 0 1 0 12M12.5 6.5h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-3M10 5v1.5m0 8V16"/></svg>
        : symbol === 'WETH' ? <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor"><path d="m10 2-5 8 5 3 5-3-5-8Zm0 12-5-3 5 7 5-7-5 3Z"/></svg>
          : symbol === '—' ? '?' : symbol.slice(0, 1)}
      <span className="composer-network-badge" role="img" aria-label={`${network} network`} title={network}>{network.slice(0, 1)}</span>
    </span>
    <span className="composer-amount-token">{symbol}</span>
  </span>;
}

const priceStrategies = [
  { title: 'Estável', range: '± 0.03%', description: 'Bom para stablecoins ou pares de baixa volatilidade' },
  { title: 'Amplo', range: '–50% — +100%', description: 'Bom para pares voláteis' },
  { title: 'Unilateral inferior', range: '–50%', description: 'Fornecer liquidez se o preço descer' },
  { title: 'Unilateral superior', range: '+100%', description: 'Fornecer liquidez se o preço subir' },
] as const;

/** Selection previews only; the authored protocol stays in the position editor. */
function PoolProviderSelector({ provider, chain }: { provider: string; chain: string }) {
  const active = /solana|orca/i.test(`${provider} ${chain}`) ? 'Solana' : /uniswap/i.test(provider) ? 'Uniswap' : provider || 'Uniswap';
  const [choice, setChoice] = useState(active);
  useEffect(() => { setChoice(active); }, [active]);
  const options = ['Uniswap', 'Solana'].includes(active) ? ['Uniswap', 'Solana'] : [active, 'Uniswap', 'Solana'];
  return <div className="composer-pool-mode composer-pool-provider nodrag nopan" role="group" aria-label="Liquidity provider"
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {options.map(option => <button key={option} type="button" aria-pressed={choice === option} onClick={() => setChoice(option)}>{option}</button>)}
  </div>;
}

/** Shared editable percentage; acceptance still belongs to the position form. */
function PoolCustomRange({ value, onChange }: { value: number; onChange(value: number): void }) {
  return <div className="composer-pool-custom nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <label className="composer-pool-custom-box"><span>Custom</span>
      <span className="composer-pool-custom-value"><span>±</span><input type="number" aria-label="Custom range percentage" inputMode="decimal" min="0.01" max="90" step="0.01" value={value} style={{ width: `${String(value).length}ch` }} onChange={event => { if (event.target.value !== '') onChange(Number(event.target.value)); }}/><span>%</span></span>
    </label>
  </div>;
}

/** Product presentation only; authored ranges still use the existing position editor. */
function PoolRangeSelector({ mode, onChange }: { mode: 'Tick' | 'Price'; onChange(mode: 'Tick' | 'Price'): void }) {
  return <div className="composer-pool-range nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="composer-pool-mode" role="group" aria-label="Liquidity range view">
        {(['Tick', 'Price'] as const).map(option => <button key={option} type="button" aria-pressed={mode === option} onClick={() => {
          onChange(option);
        }}>{option}</button>)}
      </div>
  </div>;
}

function PoolPricePanel({ strategy, onSelect, onCollapse }: { strategy: PoolPricePreset | null; onSelect(strategy: PoolPricePreset): void; onCollapse(): void }) {
  const id = useId();
  return <fieldset className="composer-pool-presets nodrag nopan" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <legend className="sr-only">Price strategies</legend>
      <button type="button" className="composer-pool-collapse" aria-label="Hide price strategies" title="Hide price strategies" onClick={onCollapse}>
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
      </button>
      {priceStrategies.map(preset => <label key={preset.title} className="composer-pool-preset" data-selected={strategy === preset.title || undefined}>
        <input className="sr-only" type="radio" name={`${id}-strategy`} value={preset.title} checked={strategy === preset.title} onChange={() => onSelect(preset.title)}/>
        <span className="composer-pool-preset-heading">
          <span className="composer-pool-preset-title">{preset.title}</span>
          <span className="composer-pool-preset-check" aria-hidden="true"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7"/></svg></span>
        </span>
        <span className="composer-pool-preset-range">{preset.range}</span>
        <span className="composer-pool-preset-description">{preset.description}</span>
      </label>)}
    </fieldset>;
}

/** Draft amounts only; zeros for unavailable values are visibly identified as placeholders. */
function ValueBox({ amount, token, network, source, label, hint, editor, displayOnly, fiatFirst = false, onFiatFirstChange }: { amount?: string | undefined; token: string; network: string; source?: boolean; label?: string; hint: string; editor?: CanvasAmountEditor | undefined; displayOnly?: boolean; fiatFirst?: boolean; onFiatFirstChange?: (fiatFirst: boolean) => void }) {
  const tokenValue = editor ? <TokenAmountInput className={`composer-token-value ${fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}`}
    aria-label={`Source amount (${token})`} inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80}
    form={editor.formId} value={editor.value} style={fiatFirst ? { width: `${Math.max(editor.value.length, 1)}ch` } : undefined}
    onValueChange={editor.onChange} onKeyDown={event => event.stopPropagation()}/>
    : <span className={fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}>{amount ?? '0'}</span>;
  return <span className={`numeric composer-amount-box nodrag nopan ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={label ?? (source ? 'Source amount' : 'Destination amount (unquoted placeholder)')}
    data-symbolic={!amount || undefined} title={hint}>
    <span className="composer-value-column">
      <span className="composer-value-line">
        {fiatFirst ? <button type="button" className="composer-primary-fiat" title="Fiat estimate unavailable" onClick={() => onFiatFirstChange?.(false)}>US$ 0,00</button> : tokenValue}
      </span>
      {displayOnly ? <span className="composer-fiat-value" title="Fiat estimate not quoted">US$ 0,00</span> : fiatFirst ? <span className="composer-token-subline">{editor ? <>{tokenValue}<button type="button" aria-label="Show token amount first" onClick={() => onFiatFirstChange?.(false)}>{token}</button></>
        : <button type="button" aria-label="Show token amount first" onClick={() => onFiatFirstChange?.(false)}>{amount ?? '0'} {token}</button>}</span>
        : <button type="button" className="composer-fiat-value" aria-label="Show fiat amount first (estimate unavailable)" title="Fiat estimate not quoted" onClick={() => onFiatFirstChange?.(true)}>US$ 0,00</button>}
    </span>
    <TokenChip symbol={token} network={network}/>
  </span>;
}

export type ComposerCardData = {
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
  amountEditor?: CanvasAmountEditor;
  supplyProposal?: { formId: string; reviewLabel?: string; canReview: boolean; hasProposal: boolean; canApply: boolean; onApply(): void };
  poolProposal?: { nodeId: string; formId: string; canReview: boolean; canApply: boolean; onApply(): void };
  onOpenSettings?: () => void;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  const [amountError, setAmountError] = useState<string | null>(null);
  const [fiatFirst, setFiatFirst] = useState(false);
  const amountBox = !card.inspection && (card.summary.action === 'Swap' || card.summary.action === 'Bridge');
  const poolCard = !card.inspection && card.summary.action === 'Pool / Liquidity';
  const [poolMode, setPoolMode] = useState<'Tick' | 'Price'>('Tick');
  const [poolPanelOpen, setPoolPanelOpen] = useState(false);
  const poolRange = usePoolPriceRange(card.poolProposal?.nodeId);
  function changePoolMode(mode: 'Tick' | 'Price') {
    setPoolMode(mode); setPoolPanelOpen(mode === 'Price');
    if (mode === 'Price') {
      // Review validates the same visible Custom or preset range.
      if (poolMode !== 'Price') {
        if (poolRange.preset) poolRange.selectPreset(poolRange.preset);
        else poolRange.edit(poolRange.percent);
      }
      void poolRange.refresh();
    }
    else if (poolRange.edited) poolRange.reset();
  }
  const poolNodeRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!poolCard || poolMode !== 'Price') return;
    // Fit the measured Pool surfaces again when the available canvas width changes.
    let frame = 0, measuredFrame = 0;
    function fitPanel() {
      cancelAnimationFrame(frame); cancelAnimationFrame(measuredFrame);
      frame = requestAnimationFrame(() => { measuredFrame = requestAnimationFrame(() => { void fitView({ padding: { top: '16px', bottom: '96px', left: '16px', right: '56px' }, duration: 0 }); }); });
    }
    const canvas = poolNodeRef.current?.closest('.build-flow-surface');
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitPanel) : null;
    if (canvas) observer?.observe(canvas);
    if (poolNodeRef.current) observer?.observe(poolNodeRef.current);
    fitPanel();
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(measuredFrame); };
  }, [poolCard, poolMode, poolPanelOpen, fitView]);
  const poolValues = !card.inspection && card.summary.action === 'Pool / Liquidity' ? card.summary.liquidityValues : undefined;
  const quietAmount = amountBox || (!card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw'].includes(card.summary.action) && (Boolean(card.amountEditor?.changed) || card.validation.status === 'Draft'));
  const amountParts = card.summary.amount.match(/^(\d+(?:\.\d+)?) (\S+)$/);
  const pair = card.summary.detail ?? (!card.inspection ? card.summary.bridgePair : undefined);
  const [pairSource, pairDestination] = pair?.split(' → ') ?? [];
  const [sourceNetwork = 'Network not specified', destinationNetwork = sourceNetwork] = card.summary.chain.split(' → ');
  const editor = card.amountEditor ? { ...card.amountEditor, onChange: (value: string) => { setAmountError(null); card.amountEditor!.onChange(value); } } : undefined;
  const AmountContainer = editor ? 'form' : 'div';
  const content = <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection || quietAmount ? undefined : card.validation.tone}>
      <Handle type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={false}/>
      {card.inspection ? <>
        <div className="composer-card-head"><span className="composer-step">Step {card.step}</span></div>
        <strong>{card.summary.action}</strong>
      </> : <>
        <strong className="composer-action-title"><span>{card.step}. {card.summary.action}</span><ActionIcon action={actionIcons[card.summary.action] ?? 'action'}/></strong>
        {!quietAmount && card.validation.status !== 'Configured' && <span className="composer-card-state" title={card.validation.message}>{card.validation.tone !== 'neutral' && '⚠ '}{card.validation.status === 'Draft' ? 'Check settings' : card.validation.status}</span>}
      </>}
      {card.inspection ? <>
        <span className="composer-provider">{card.summary.provider || 'Provider not specified'}</span>
        <span className="composer-chain">{card.summary.chain}</span>
      </> : poolCard ? <PoolProviderSelector provider={card.summary.provider} chain={card.summary.chain}/> : <span className="composer-metadata">
        <span className="composer-provider">{card.summary.provider.replace(/Cross-chain Router/g, 'Router') || 'Provider not specified'}</span>
        {' · '}<span className="composer-chain">{card.summary.chain}</span>
      </span>}
      {amountBox ? <AmountContainer className="composer-amount-form nodrag nopan" onKeyDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); if (editor) setAmountError(editor.onReview()); }}>
        <div className="composer-value-pair">
        <ValueBox source amount={amountParts?.[1]} token={amountParts?.[2] ?? pairSource ?? '—'}
          network={sourceNetwork} editor={editor} hint={editor ? 'Enter the source amount' : card.summary.amount} fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
        <span className="composer-value-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-5-5 5 5 5-5"/></svg></span>
        <ValueBox token={pairDestination ?? '—'} network={destinationNetwork} hint="Destination amount not quoted; zero is a placeholder" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
        </div>
        <span className="composer-quote-note">{!amountParts && <>{card.summary.amount} · </>}Estimate unavailable</span>
        {editor?.changed && <div className="composer-amount-actions">
          <button type="submit" className="composer-amount-review">Review amount</button>
          <button type="button" className="composer-amount-apply" disabled={!editor.canApply} onClick={editor.onApply}>Apply amount</button>
          {editor.onCancel && <button type="button" className="composer-amount-cancel" onClick={editor.onCancel}>Cancel</button>}
        </div>}
        {amountError && <span className="sr-only" role="alert">{amountError}</span>}
      </AmountContainer> : poolValues?.length === 2 ? <div className="composer-value-pair nodrag nopan">
        <ValueBox source label="First liquidity asset amount" amount={poolValues[0]!.amount} token={poolValues[0]!.token} network={sourceNetwork} hint="First liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
        <span className="composer-value-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-5-5 5 5 5-5"/></svg></span>
        <ValueBox label="Second liquidity asset amount" amount={poolValues[1]!.amount} token={poolValues[1]!.token} network={sourceNetwork} hint="Second liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
      </div> : !card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw'].includes(card.summary.action) && (amountParts || editor)
        ? <ValueBox source displayOnly amount={amountParts?.[1]} token={amountParts?.[2] ?? 'USDC'} network={sourceNetwork} editor={editor} hint={editor ? 'Enter the source amount' : card.summary.amount}/>
        : <span className="numeric composer-amount">{card.summary.amount}</span>}
      {!card.inspection && card.supplyProposal && <div className="composer-amount-actions composer-supply-actions nodrag nopan" onClick={event => event.stopPropagation()}>
        <button type="submit" form={card.supplyProposal.formId} className="composer-amount-review" disabled={!card.supplyProposal.canReview}>{card.supplyProposal.reviewLabel ?? 'Review Supply change'}</button>
        {card.supplyProposal.hasProposal && <button type="button" className="composer-amount-apply" disabled={!card.supplyProposal.canApply} onClick={card.supplyProposal.onApply}>Apply proposal</button>}
      </div>}
      {!amountBox && !poolCard && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{pair}</span>}
      {poolCard && <div className="composer-pool-controls">
        {poolMode === 'Price' && <PoolPriceRange percent={poolRange.percent} preset={poolRange.preset} extent={poolRange.extent} reference={poolRange.reference} onChange={poolRange.edit}/>}
        <div className="composer-pool-control-row">{poolMode === 'Price' && (poolRange.preset && poolRange.preset !== 'Estável'
          ? <button type="button" className="composer-pool-custom-box composer-pool-preset-summary nodrag nopan" aria-label="Edit custom range" onClick={event => { event.stopPropagation(); poolRange.edit(poolRange.percent); }}><span>Custom</span><span>{priceStrategies.find(preset => preset.title === poolRange.preset)!.range}</span></button>
          : <PoolCustomRange value={poolRange.percent} onChange={poolRange.edit}/>)}<PoolRangeSelector mode={poolMode} onChange={changePoolMode}/></div>
        {card.poolProposal && <div className="composer-amount-actions nodrag nopan" onClick={event => event.stopPropagation()}>
          <button type="submit" form={card.poolProposal.formId} className="composer-amount-review" disabled={!card.poolProposal.canReview || (poolRange.edited && !poolRange.reference)}>Review</button>
          <button type="button" className="composer-amount-apply" disabled={!card.poolProposal.canApply || (poolRange.edited && !poolRange.reviewCurrent)} onClick={() => { card.poolProposal!.onApply(); poolRange.reset(); }}>Apply</button>
        </div>}
      </div>}
      {!card.inspection && !quietAmount && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <button type="button" className="composer-selected nodrag nopan" onClick={event => { event.stopPropagation(); card.onOpenSettings?.(); }} title="Open Advanced Settings">Advanced Settings
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
  return poolCard ? <div ref={poolNodeRef} className="composer-pool-node">{content}{poolPanelOpen && <PoolPricePanel strategy={poolRange.preset} onSelect={poolRange.selectPreset} onCollapse={() => setPoolPanelOpen(false)}/>}</div> : content;
}

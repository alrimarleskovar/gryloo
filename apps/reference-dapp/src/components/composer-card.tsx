// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';
import type { Command } from '../domain/commands';
import type { CanvasAction } from '../domain/canvas-authoring';
import { ActionIcon } from './action-icon';
import { TokenBrandIcon, NetworkBrandIcon } from './brand-icon';
import { useEffect, useId, useRef, useState } from 'react';
import { PoolPriceRange, usePoolPriceRange, type PoolPricePreset } from './pool-price-range';
import { TokenAmountInput } from './token-amount-input';
import { STOCK_EQUITIES, usePoolContributionInputs, type StockEquity } from './canvas-card-inputs';
import type { CryptoSelection } from '../domain/crypto-action-picker';

export type CanvasAmountEditor = { value: string; changed: boolean; canApply: boolean; formId?: string; onChange(value: string): void; onReview(): string | null; onApply(): void; onCancel?: () => void };
export function supplyReviewFormId(nodeId: string) { return `composer-supply-review-${nodeId}`; }

export function poolReviewFormId(nodeId: string) { return `composer-pool-review-${nodeId}`; }
/** Route existing liquidity edit proposals to their card; no new authoring commands. */
export function poolProposalTarget(command: Command): string | null {
  if (command.type === 'SET_CRYPTO_ACTION' && command.input.selection.action === 'pool') return command.nodeId;
  return ['SET_LIQUIDITY', 'SET_UNISWAP_LIQUIDITY', 'SET_SOLANA_LIQUIDITY'].includes(command.type) && 'nodeId' in command ? command.nodeId : null;
}

const actionIcons: Record<string, CanvasAction | 'stocks' | 'transfer'> = {
  Swap: 'swap', Bridge: 'bridge', 'Pool / Liquidity': 'pool', 'Prepare liquidity': 'pool',
  Supply: 'supply', Lending: 'lending', Borrow: 'borrow', Repay: 'repay', Withdraw: 'withdraw', Transfer: 'transfer', Stocks: 'stocks',
};

function TokenChip({ symbol, network }: { symbol: string; network?: string }) {
  return <span className="composer-token-chip">
    <span className="composer-token-avatar" data-token={symbol}>
      <TokenBrandIcon symbol={symbol}/>
      {network !== undefined && <span className="composer-network-badge" role="img" aria-label={`${network} network`} title={network}><NetworkBrandIcon network={network}/></span>}
    </span>
    <span className="composer-amount-token">{symbol}</span>
  </span>;
}

type TokenPickerControl = { label: string; expanded: boolean; controls: string; title?: string; onToggle(trigger: HTMLButtonElement): void };
function TokenPill({ symbol, network, picker }: { symbol: string; network: string; picker: TokenPickerControl }) {
  return <button type="button" className="composer-token-chip composer-equity-pill composer-token-pill nodrag nopan" aria-label={picker.label} aria-expanded={picker.expanded} aria-controls={picker.controls} title={picker.title}
    onClick={event => { event.stopPropagation(); picker.onToggle(event.currentTarget); }} onKeyDown={event => event.stopPropagation()}>
    <TokenChip symbol={symbol} network={network}/>
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4 3 3 3-3"/></svg>
  </button>;
}

function TokenPicker({ symbol, network, options, onChange }: { symbol: string; network: string; options: readonly string[]; onChange(symbol: string): void }) {
  const name = useId();
  const listRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => { listRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }, []);
  return <fieldset ref={listRef} className="composer-stock-options composer-token-options">
    <legend className="sr-only">Choose token on {network}</legend>
    {options.map(option => <label key={option} className="composer-stock-option" data-selected={option === symbol || undefined}>
      <input className="sr-only" type="radio" name={name} value={option} aria-label={option} checked={option === symbol} onChange={() => onChange(option)}/>
      <TokenChip symbol={option}/>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </label>)}
  </fieldset>;
}

function NetworkBadge({ network }: { network: string }) {
  return <span className="composer-bridge-network-icon" aria-hidden="true"><NetworkBrandIcon network={network}/></span>;
}
function NetworkPicker({ network, options, unavailable = [], onSelect }: { network: string; options: readonly string[]; unavailable?: readonly string[] | undefined; onSelect(network: string): void }) {
  return <fieldset className="composer-stock-options composer-network-options">
    <legend className="sr-only">Choose network</legend>
    {[...options, ...unavailable].map(option => <button key={option} type="button" className="composer-stock-option" disabled={unavailable.includes(option)} aria-label={option} aria-pressed={option === network} data-selected={option === network || undefined} onClick={() => onSelect(option)}>
      <NetworkBadge network={option}/><span>{option}</span>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </button>)}
  </fieldset>;
}

function AssetNetworkPicker({ id, side, symbol, network, tokens, networks, unavailable, onTokenChange, onNetworkChange, onCollapse, bridge = false }: {
  id: string; side: 'source' | 'destination'; symbol: string; network: string; tokens: readonly string[]; networks: readonly string[]; unavailable?: readonly string[] | undefined;
  onTokenChange(symbol: string): void; onNetworkChange(network: string): void; onCollapse(): void;
  bridge?: boolean;
}) {
  const sideLabel = side === 'source' ? 'Source' : 'Destination';
  return <section id={id} className="composer-stocks-panel composer-bridge-picker nodrag nopan" aria-label={`${sideLabel} ${bridge ? 'bridge' : 'asset'} picker`}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyDownCapture={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCollapse(); }
    }}>
    <button type="button" className="composer-pool-collapse" aria-label={bridge ? 'Hide bridge picker' : 'Hide token picker'} title={bridge ? 'Hide bridge picker' : 'Hide token picker'} onClick={onCollapse}>
      <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
    </button>
    <div className="composer-bridge-picker-columns">
      <div className="composer-bridge-picker-column" role="region" aria-label={`${sideLabel} token picker`}>
        <span className="composer-bridge-picker-heading" aria-hidden="true">Tokens</span>
        <TokenPicker symbol={symbol} network={network} options={tokens} onChange={token => { if (tokens.includes(token)) onTokenChange(token); }}/>
      </div>
      <div className="composer-bridge-picker-column" role="region" aria-label={bridge ? `${sideLabel} network picker` : 'Action network picker'}>
        <span className="composer-bridge-picker-heading" title={bridge ? undefined : 'One network for all assets in this action'} aria-hidden="true">Networks</span>
        {!networks.length && !bridge && <p className="muted">No supported networks in the connected wallet environment.</p>}
        <NetworkPicker network={network} options={networks} unavailable={unavailable} onSelect={choice => { if (networks.includes(choice) && choice !== network) onNetworkChange(choice); }}/>
      </div>
    </div>
  </section>;
}

function EquityPill({ equity, onToggle, expanded, controls }: { equity: StockEquity; onToggle(): void; expanded: boolean; controls: string }) {
  return <button type="button" className="composer-token-chip composer-equity-pill nodrag nopan" aria-label="Select stock" aria-expanded={expanded} aria-controls={controls}
    onClick={event => { event.stopPropagation(); onToggle(); }} onKeyDown={event => event.stopPropagation()}>
    <span className="composer-token-avatar composer-robinhood-avatar">
      <img src="/brand/robinhood-avatar.jpg" width="22" height="22" alt="Robinhood"/>
      <span className="composer-network-badge" data-network="robinhood" role="img" aria-label="Robinhood Chain network" title="Robinhood Chain"><NetworkBrandIcon network="Robinhood Chain"/></span>
    </span>
    <span className="composer-amount-token">{equity}</span>
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4 3 3 3-3"/></svg>
  </button>;
}

function StockPicker({ equity, onChange }: { equity: StockEquity; onChange(equity: StockEquity): void }) {
  const name = useId();
  return <fieldset className="composer-stock-options">
    <legend className="sr-only">Choose stock</legend>
    {STOCK_EQUITIES.map(symbol => <label key={symbol} className="composer-stock-option" data-selected={symbol === equity || undefined}>
      <input className="sr-only" type="radio" name={name} value={symbol} checked={symbol === equity} onChange={() => onChange(symbol)}/>
      <span>{symbol}</span>
      <svg className="composer-stock-check" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>
    </label>)}
  </fieldset>;
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

/** Display priority is shared by all value boxes in the card; token inputs keep their denomination. */
function ValueBox({ amount, token, network, source, label, hint, editor, inputLabel, equity, picker, fiatFirst, onFiatFirstChange, readOnly = false }: { readOnly?: boolean; amount?: string | undefined; token: string; network: string; source?: boolean; label?: string; hint: string; editor?: Pick<CanvasAmountEditor, 'value' | 'formId' | 'onChange'> | undefined; inputLabel?: string; equity?: { symbol: StockEquity; onToggle(): void; expanded: boolean; controls: string }; picker?: TokenPickerControl; fiatFirst: boolean; onFiatFirstChange: (fiatFirst: boolean) => void }) {
  if (readOnly) return <span className={`numeric composer-amount-box ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={label ?? (source ? 'Source amount' : 'Destination amount')} data-symbolic={!amount || undefined} title={hint}>
    <span className="composer-value-column"><span className="composer-amount-value">{amount ?? '—'}</span></span>{' '}
    <TokenChip symbol={token} network={network.replace(/ \(\d+\)$/, '').replace('Robinhood Chain Testnet', 'Robinhood Chain')}/>
  </span>;
  const tokenValue = editor ? <TokenAmountInput className={`composer-token-value ${fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}`}
    aria-label={inputLabel ?? `Source amount (${token})`} inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80}
    form={editor.formId} value={editor.value} style={fiatFirst ? { width: `${Math.max(editor.value.length, 1)}ch` } : undefined}
    onValueChange={editor.onChange} onKeyDown={event => event.stopPropagation()}/>
    : <span className={fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}>{amount ?? '0'}</span>;
  return <span className={`numeric composer-amount-box nodrag nopan ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={label ?? (source ? 'Source amount' : 'Destination amount (unquoted placeholder)')}
    data-symbolic={!amount || undefined} title={hint}>
    <span className="composer-value-column">
      <span className="composer-value-line">
        {fiatFirst ? <button type="button" className="composer-primary-fiat" aria-label="Show token amount first" onClick={() => onFiatFirstChange(false)}>US$ 0,00</button> : tokenValue}
      </span>
      {fiatFirst ? <span className="composer-token-subline">{editor ? <>{tokenValue}<span>{token}</span></>
        : <span>{amount ?? '0'} {token}</span>}</span>
        : <button type="button" className="composer-fiat-value" aria-label="Show fiat amount first (estimate unavailable)" onClick={() => onFiatFirstChange(true)}>US$ 0,00</button>}
    </span>
    {equity ? <EquityPill equity={equity.symbol} onToggle={equity.onToggle} expanded={equity.expanded} controls={equity.controls}/> : picker ? <TokenPill symbol={token} network={network} picker={picker}/> : <TokenChip symbol={token} network={network}/>}
  </span>;
}

export type ComposerCardData = {
  actionSelection?: { selection: CryptoSelection; networks: readonly string[]; valid: boolean; tokens: { source: readonly string[]; destination: readonly string[] }; onNetwork(network: string): void; onToken(side: 'source' | 'destination', token: string): void };
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
  amountEditor?: CanvasAmountEditor;
  tokenSelection?: { source: readonly string[]; destination: readonly string[]; onSelect(side: 'source' | 'destination', symbol: string): void };
  networkSelection?: { source: readonly string[]; destination: readonly string[]; valid: boolean; unavailable?: readonly string[]; onSelect(side: 'source' | 'destination', network: string): void };
  stocks?: { equity: StockEquity; amount: string; onAmountChange(amount: string): void; onEquityChange(equity: StockEquity): void };
  supplyProposal?: { formId: string; reviewLabel?: string; canReview: boolean; hasProposal: boolean; canApply: boolean; onApply(): void };
  poolProposal?: { nodeId: string; formId: string; canReview: boolean; canApply: boolean; onApply(): void };
  onOpenSettings?: () => void;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  const [amountError, setAmountError] = useState<string | null>(null);
  const [fiatFirst, setFiatFirst] = useState(false);
  const amountBox = !card.inspection && (card.summary.action === 'Swap' || card.summary.action === 'Bridge');
  const bridgeCard = !card.inspection && card.summary.action === 'Bridge';
  const stocksCard = Boolean(card.stocks);
  const poolCard = !card.inspection && card.summary.action === 'Pool / Liquidity';
  const [poolMode, setPoolMode] = useState<'Tick' | 'Price'>('Tick');
  const [poolPanelOpen, setPoolPanelOpen] = useState(false);
  const [stocksPanelOpen, setStocksPanelOpen] = useState(false);
  const stocksPanelId = useId();
  const [tokenPanel, setTokenPanel] = useState<'source' | 'destination' | null>(null);
  const tokenPanelId = useId();
  const tokenTrigger = useRef<HTMLButtonElement | null>(null);
  const [bridgePanel, setBridgePanel] = useState<'source' | 'destination' | null>(null);
  const bridgePanelId = useId();
  const bridgeTrigger = useRef<HTMLButtonElement | null>(null);
  const poolRange = usePoolPriceRange(card.poolProposal?.nodeId);
  const poolContributions = usePoolContributionInputs(card.poolProposal?.nodeId);
  function changePoolMode(mode: 'Tick' | 'Price') {
    setTokenPanel(null);
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
    if (!(poolCard && poolMode === 'Price') && !(stocksCard && stocksPanelOpen) && !tokenPanel && !bridgePanel) return;
    // Fit the expanded card surfaces again when the available canvas width changes.
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
  }, [poolCard, poolMode, poolPanelOpen, stocksCard, stocksPanelOpen, tokenPanel, bridgePanel, fitView]);
  useEffect(() => {
    if (!tokenPanel && !bridgePanel) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !poolNodeRef.current?.contains(event.target)) { setTokenPanel(null); setBridgePanel(null); } };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [tokenPanel, bridgePanel]);
  const poolValues = poolCard ? poolContributions.values ?? card.summary.liquidityValues : undefined;
  const quietAmount = Boolean(card.stocks) || amountBox || (!card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw'].includes(card.summary.action) && (Boolean(card.amountEditor?.changed) || card.validation.status === 'Draft'));
  const amountParts = card.summary.amount.match(/^(\d+(?:\.\d+)?) (\S+)$/);
  const pair = card.summary.detail ?? card.summary.bridgePair;
  const [pairSource, pairDestination] = pair?.split(' → ') ?? [];
  const [sourceNetwork = 'Network not specified', destinationNetwork = sourceNetwork] = card.summary.chain.split(' → ');
  const editor = card.amountEditor ? { ...card.amountEditor, onChange: (value: string) => { setAmountError(null); card.amountEditor!.onChange(value); } } : undefined;
  function picker(side: 'source' | 'destination'): TokenPickerControl {
    if (bridgeCard) return { label: `Configure ${side} asset`, title: `${side === 'source' ? amountParts?.[2] ?? pairSource : pairDestination} on ${side === 'source' ? sourceNetwork : destinationNetwork}`, expanded: bridgePanel === side, controls: bridgePanelId, onToggle: trigger => {
      bridgeTrigger.current = trigger; setBridgePanel(current => current === side ? null : side); setTokenPanel(null);
    } };
    return { label: `Select ${side} token`, title: `${side === 'source' ? poolValues?.[0]?.token ?? amountParts?.[2] ?? pairSource : poolValues?.[1]?.token ?? pairDestination} on ${sourceNetwork}`, expanded: tokenPanel === side, controls: tokenPanelId, onToggle: trigger => {
      tokenTrigger.current = trigger; setTokenPanel(current => current === side ? null : side); setPoolPanelOpen(false);
      setBridgePanel(null);
    } };
  }
  function collapseTokens() { setTokenPanel(null); tokenTrigger.current?.focus(); }
  function collapseBridge() { setBridgePanel(null); bridgeTrigger.current?.focus(); }
  const bridgeSymbol = bridgePanel === 'destination' ? pairDestination : amountParts?.[2] ?? pairSource;
  const bridgeNetwork = bridgePanel === 'destination' ? destinationNetwork : sourceNetwork;
  const tokenSymbol = tokenPanel === 'destination' ? poolValues?.[1]?.token ?? pairDestination : poolValues?.[0]?.token ?? amountParts?.[2] ?? pairSource;
  const tokenNetwork = poolCard || tokenPanel === 'source' ? sourceNetwork : destinationNetwork;
  // Authored actions keep their configured assets; draft Swap exposes its existing supported directions.
  const tokenOptions = tokenPanel && tokenSymbol ? card.actionSelection?.tokens[tokenPanel] ?? card.tokenSelection?.[tokenPanel] ?? [tokenSymbol] : [];
  const AmountContainer = editor ? 'form' : 'div';
  const content = <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection || quietAmount ? undefined : card.validation.tone}>
      <Handle type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={false}/>
      <strong className="composer-action-title"><span>{card.step}. {card.summary.action}</span><ActionIcon action={actionIcons[card.summary.action] ?? 'action'}/></strong>
      {!card.inspection && !quietAmount && card.validation.status !== 'Configured' && <span className="composer-card-state" title={card.validation.message}>{card.validation.tone !== 'neutral' && '⚠ '}{card.validation.status === 'Draft' ? 'Check settings' : card.validation.status}</span>}
      {poolCard ? <PoolProviderSelector provider={card.summary.provider} chain={card.summary.chain}/> : <span className="composer-metadata">
        <span className="composer-provider">{card.summary.provider.replace(/Cross-chain Router/g, 'Router') || 'Provider not specified'}</span>
        {!card.stocks && !bridgeCard && <>{' · '}<span className="composer-chain">{card.summary.chain}</span></>}
      </span>}
      {card.inspection ? <>
        {card.summary.liquidityValues ? <div className="composer-value-pair">
          {card.summary.liquidityValues.map((value, index) => <ValueBox key={value.token} readOnly source={index === 0} amount={value.amount} token={value.token} network={sourceNetwork}
            label={`${index === 0 ? 'First' : 'Second'} liquidity asset amount`} hint="Configured liquidity contribution" fiatFirst={false} onFiatFirstChange={setFiatFirst}/>)}
        </div> : <div className={pairDestination ? 'composer-value-pair' : undefined}>
          {amountParts ? <ValueBox readOnly source amount={amountParts[1]} token={amountParts[2]!} network={sourceNetwork} hint={card.summary.amount} fiatFirst={false} onFiatFirstChange={setFiatFirst}/>
            : <span className="numeric composer-amount">{card.summary.amount}</span>}
          {pairDestination && <><span className="composer-value-arrow" aria-hidden="true">↓</span><ValueBox readOnly token={pairDestination} network={destinationNetwork} hint="Output estimate unavailable" fiatFirst={false} onFiatFirstChange={setFiatFirst}/></>}
        </div>}
        {pairDestination && <span className="composer-quote-note">Estimate unavailable</span>}
      </> : card.stocks ? <ValueBox source fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst} label="Stocks amount" inputLabel="Stocks amount" amount={card.stocks.amount} token={card.stocks.equity} network={sourceNetwork}
        hint="Stocks amount" editor={{ value: card.stocks.amount, onChange: card.stocks.onAmountChange }} equity={{ symbol: card.stocks.equity, onToggle: () => setStocksPanelOpen(open => !open), expanded: stocksPanelOpen, controls: stocksPanelId }}/>
        : amountBox ? <AmountContainer className="composer-amount-form nodrag nopan" onKeyDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); if (editor) setAmountError(editor.onReview()); }}>
        <div className="composer-value-pair">
        <ValueBox source amount={amountParts?.[1]} token={amountParts?.[2] ?? pairSource ?? '—'}
          network={sourceNetwork} editor={editor} picker={picker('source')} hint={editor ? 'Enter the source amount' : card.summary.amount} fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
        <span className="composer-value-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-5-5 5 5 5-5"/></svg></span>
        <ValueBox token={pairDestination ?? '—'} network={destinationNetwork} picker={picker('destination')} hint="Destination amount not quoted; zero is a placeholder" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}/>
        </div>
        <span className="composer-quote-note">{card.networkSelection?.valid === false ? 'Choose matching networks' : <>{!amountParts && <>{card.summary.amount} · </>}Estimate unavailable</>}</span>
        {editor?.changed && <div className="composer-amount-actions">
          <button type="submit" className="composer-amount-review" disabled={card.networkSelection?.valid === false || card.actionSelection?.valid === false}>Review amount</button>
          <button type="button" className="composer-amount-apply" disabled={!editor.canApply} onClick={editor.onApply}>Apply amount</button>
          {editor.onCancel && <button type="button" className="composer-amount-cancel" onClick={editor.onCancel}>Cancel</button>}
        </div>}
        {amountError && <span className="sr-only" role="alert">{amountError}</span>}
      </AmountContainer> : poolValues?.length === 2 ? <div className="composer-value-pair nodrag nopan">
        <ValueBox source label="First liquidity asset amount" inputLabel={`First liquidity amount (${poolValues[0]!.token})`} amount={poolValues[0]!.amount} token={poolValues[0]!.token} network={sourceNetwork} hint="First liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}
          picker={picker('source')} editor={card.poolProposal ? { value: poolValues[0]!.amount, formId: card.poolProposal.formId, onChange: amount => poolContributions.edit(0, amount) } : undefined}/>
        <span className="composer-value-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14m-5-5 5 5 5-5"/></svg></span>
        <ValueBox label="Second liquidity asset amount" inputLabel={`Second liquidity amount (${poolValues[1]!.token})`} amount={poolValues[1]!.amount} token={poolValues[1]!.token} network={sourceNetwork} hint="Second liquidity contribution" fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst}
          picker={picker('destination')} editor={card.poolProposal ? { value: poolValues[1]!.amount, formId: card.poolProposal.formId, onChange: amount => poolContributions.edit(1, amount) } : undefined}/>
      </div> : !card.inspection && ['Supply', 'Borrow', 'Repay', 'Withdraw'].includes(card.summary.action) && (amountParts || editor)
        ? <ValueBox source fiatFirst={fiatFirst} onFiatFirstChange={setFiatFirst} amount={amountParts?.[1]} token={amountParts?.[2] ?? 'USDC'} network={sourceNetwork} picker={picker('source')} editor={editor} hint={editor ? 'Enter the source amount' : card.summary.amount}/>
        : <span className="numeric composer-amount">{card.summary.amount}</span>}
      {!card.inspection && card.supplyProposal && <div className="composer-amount-actions composer-supply-actions nodrag nopan" onClick={event => event.stopPropagation()}>
        <button type="submit" form={card.supplyProposal.formId} className="composer-amount-review" disabled={!card.supplyProposal.canReview || card.actionSelection?.valid === false}>{card.supplyProposal.reviewLabel ?? 'Review Supply change'}</button>
        {card.supplyProposal.hasProposal && <button type="button" className="composer-amount-apply" disabled={!card.supplyProposal.canApply} onClick={card.supplyProposal.onApply}>Apply proposal</button>}
      </div>}
      {!amountBox && !poolCard && (!card.inspection || !pairDestination) && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{pair}</span>}
      {poolCard && <div className="composer-pool-controls">
        {poolMode === 'Price' && <PoolPriceRange percent={poolRange.percent} preset={poolRange.preset} extent={poolRange.extent} reference={poolRange.reference} onChange={poolRange.edit}/>}
        <div className="composer-pool-control-row">{poolMode === 'Price' && (poolRange.preset && poolRange.preset !== 'Estável'
          ? <button type="button" className="composer-pool-custom-box composer-pool-preset-summary nodrag nopan" aria-label="Edit custom range" onClick={event => { event.stopPropagation(); poolRange.edit(poolRange.percent); }}><span>Custom</span><span>{priceStrategies.find(preset => preset.title === poolRange.preset)!.range}</span></button>
          : <PoolCustomRange value={poolRange.percent} onChange={poolRange.edit}/>)}<PoolRangeSelector mode={poolMode} onChange={changePoolMode}/></div>
        {card.poolProposal && <div className="composer-amount-actions nodrag nopan" onClick={event => event.stopPropagation()}>
          <button type="submit" form={card.poolProposal.formId} className="composer-amount-review" disabled={!card.poolProposal.canReview || card.actionSelection?.valid === false || (poolRange.edited && !poolRange.reference)}>Review</button>
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
  const tokens = tokenPanel && tokenSymbol && <AssetNetworkPicker key={tokenPanel + tokenNetwork} id={tokenPanelId} side={tokenPanel} symbol={tokenSymbol} network={tokenNetwork}
    tokens={tokenOptions} networks={card.actionSelection?.networks ?? []} onCollapse={collapseTokens}
    onTokenChange={symbol => { if (card.actionSelection) card.actionSelection.onToken(tokenPanel, symbol); else card.tokenSelection?.onSelect(tokenPanel, symbol); }}
    onNetworkChange={network => { card.actionSelection?.onNetwork(network); setAmountError(null); if (poolCard) poolRange.reset(); }}/>;
  const bridge = bridgePanel && bridgeSymbol && <AssetNetworkPicker bridge key={bridgePanel} id={bridgePanelId} side={bridgePanel} symbol={bridgeSymbol} network={bridgeNetwork}
    tokens={card.tokenSelection?.[bridgePanel] ?? [bridgeSymbol]} networks={card.networkSelection?.[bridgePanel] ?? [bridgeNetwork]} unavailable={card.networkSelection?.unavailable}
    onTokenChange={symbol => card.tokenSelection?.onSelect(bridgePanel, symbol)}
    onNetworkChange={network => { card.networkSelection?.onSelect(bridgePanel, network); setAmountError(null); }} onCollapse={collapseBridge}/>;
  return poolCard ? <div ref={poolNodeRef} className="composer-pool-node">{content}{tokens}{poolPanelOpen && <PoolPricePanel strategy={poolRange.preset} onSelect={poolRange.selectPreset} onCollapse={() => setPoolPanelOpen(false)}/>}</div> : card.stocks ? <div ref={poolNodeRef} className="composer-stocks-node">{content}
    {stocksPanelOpen && <section id={stocksPanelId} className="composer-stocks-panel nodrag nopan" aria-label="Stocks configuration" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="composer-pool-collapse" aria-label="Hide Stocks configuration" title="Hide Stocks configuration" onClick={() => setStocksPanelOpen(false)}>
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 5-5 5 5 5m9-10-5 5 5 5"/></svg>
      </button>
      <StockPicker equity={card.stocks.equity} onChange={card.stocks.onEquityChange}/>
    </section>}
  </div> : !card.inspection && (amountBox || ['Supply', 'Borrow', 'Repay', 'Withdraw'].includes(card.summary.action)) ? <div ref={poolNodeRef} className="composer-token-node">{content}{tokens}{bridge}</div> : content;
}

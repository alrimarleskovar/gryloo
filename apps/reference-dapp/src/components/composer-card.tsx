// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Handle, Position } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';
import type { CanvasAction } from '../domain/canvas-authoring';
import { ActionIcon } from './action-icon';
import { useState } from 'react';

export type CanvasAmountEditor = { value: string; changed: boolean; onChange(value: string): void; onReview(): string | null; onCancel?: () => void };

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

/** Draft amounts only; zeros for unavailable values are visibly identified as placeholders. */
function ValueBox({ amount, token, network, source, hint, editor }: { amount?: string | undefined; token: string; network: string; source?: boolean; hint: string; editor?: CanvasAmountEditor | undefined }) {
  const [fiatFirst, setFiatFirst] = useState(false);
  const tokenValue = editor ? <input className={`composer-token-value ${fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}`}
    aria-label={`Source amount (${token})`} inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80}
    value={editor.value} onChange={event => editor.onChange(event.target.value)}/>
    : <span className={fiatFirst ? 'composer-fiat-value' : 'composer-amount-value'}>{amount ?? '0'}</span>;
  return <span className={`numeric composer-amount-box ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={source ? 'Source amount' : 'Destination amount (unquoted placeholder)'}
    data-symbolic={!amount || undefined} title={hint}>
    <span className="composer-value-column">
      <span className="composer-value-line">
        {fiatFirst ? <button type="button" className="composer-primary-fiat" title="Fiat estimate unavailable" onClick={() => setFiatFirst(false)}>US$ 0,00</button> : tokenValue}
        {!fiatFirst && source && <svg className="composer-value-edit" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>}
      </span>
      {fiatFirst ? <span className="composer-token-subline">{tokenValue}<button type="button" aria-label="Show token amount first" onClick={() => setFiatFirst(false)}>{token}</button></span>
        : <button type="button" className="composer-fiat-value" aria-label="Show fiat amount first (estimate unavailable)" title="Fiat estimate not quoted" onClick={() => setFiatFirst(true)}>US$ 0,00</button>}
    </span>
    <TokenChip symbol={token} network={network}/>
  </span>;
}

export type ComposerCardData = {
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
  amountEditor?: CanvasAmountEditor;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  const [amountError, setAmountError] = useState<string | null>(null);
  const amountBox = !card.inspection && (card.summary.action === 'Swap' || card.summary.action === 'Bridge');
  const amountParts = card.summary.amount.match(/^(\d+(?:\.\d+)?) (\S+)$/);
  const pair = card.summary.detail ?? (!card.inspection ? card.summary.bridgePair : undefined);
  const [pairSource, pairDestination] = pair?.split(' → ') ?? [];
  const [sourceNetwork = 'Network not specified', destinationNetwork = sourceNetwork] = card.summary.chain.split(' → ');
  const editor = card.amountEditor ? { ...card.amountEditor, onChange: (value: string) => { setAmountError(null); card.amountEditor!.onChange(value); } } : undefined;
  const AmountContainer = editor ? 'form' : 'div';
  return <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection ? undefined : card.validation.tone}>
      <Handle type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={false}/>
      {card.inspection ? <>
        <div className="composer-card-head"><span className="composer-step">Step {card.step}</span></div>
        <strong>{card.summary.action}</strong>
      </> : <>
        <strong className="composer-action-title"><span>{card.step}. {card.summary.action}</span><ActionIcon action={actionIcons[card.summary.action] ?? 'action'}/></strong>
        {card.validation.status !== 'Configured' && <span className="composer-card-state" title={card.validation.message}>{card.validation.tone !== 'neutral' && '⚠ '}{card.validation.status === 'Draft' ? 'Check settings' : card.validation.status}</span>}
      </>}
      {card.inspection ? <>
        <span className="composer-provider">{card.summary.provider || 'Provider not specified'}</span>
        <span className="composer-chain">{card.summary.chain}</span>
      </> : <span className="composer-metadata">
        <span className="composer-provider">{card.summary.provider.replace(/Cross-chain Router/g, 'Router') || 'Provider not specified'}</span>
        {' · '}<span className="composer-chain">{card.summary.chain}</span>
      </span>}
      {amountBox ? <AmountContainer className="composer-amount-form nodrag nopan" onKeyDown={event => event.stopPropagation()} onSubmit={event => { event.preventDefault(); if (editor) setAmountError(editor.onReview()); }}>
        <ValueBox source amount={amountParts?.[1]} token={amountParts?.[2] ?? pairSource ?? '—'}
          network={sourceNetwork} editor={editor} hint={editor ? 'Enter the source amount' : card.summary.amount}/>
        <ValueBox token={pairDestination ?? '—'} network={destinationNetwork} hint="Destination amount not quoted; zero is a placeholder"/>
        <span className="composer-quote-note">{!amountParts && <>{card.summary.amount} · </>}Output / fiat not quoted</span>
        {editor?.changed && <div className="composer-amount-actions"><button type="submit">Review amount</button>{editor.onCancel && <button type="button" onClick={editor.onCancel}>Cancel</button>}</div>}
        {amountError && <span className="composer-amount-error" role="alert">{amountError}</span>}
      </AmountContainer> : <span className="numeric composer-amount">{card.summary.amount}</span>}
      {!amountBox && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{pair}</span>}
      {!card.inspection && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <span className="composer-selected" title="Open Advanced Settings">Advanced Settings
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
      </span>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
}

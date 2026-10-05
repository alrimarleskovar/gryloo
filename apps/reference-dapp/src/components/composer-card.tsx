// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Handle, Position } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';
import type { CanvasAction } from '../domain/canvas-authoring';
import { ActionIcon } from './action-icon';

const actionIcons: Record<string, CanvasAction | 'transfer'> = {
  Swap: 'swap', Bridge: 'bridge', 'Pool / Liquidity': 'pool', 'Prepare liquidity': 'pool',
  Supply: 'supply', Lending: 'lending', Borrow: 'borrow', Repay: 'repay', Withdraw: 'withdraw', Transfer: 'transfer',
};

function TokenChip({ symbol }: { symbol: string }) {
  return <span className="composer-token-chip">
    <span className="composer-token-avatar" data-token={symbol} aria-hidden="true">
      {symbol === 'USDC' ? <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M6 4a7 7 0 0 0 0 12m8-12a7 7 0 0 1 0 12M12.5 6.5h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4h-3M10 5v1.5m0 8V16"/></svg>
        : symbol === 'WETH' ? <svg viewBox="0 0 20 20" fill="currentColor"><path d="m10 2-5 8 5 3 5-3-5-8Zm0 12-5-3 5 7 5-7-5 3Z"/></svg>
          : symbol === '—' ? '?' : symbol.slice(0, 1)}
    </span>
    <span className="composer-amount-token">{symbol}</span>
  </span>;
}

/** Draft amounts only; zeros for unavailable values are visibly identified as placeholders. */
function ValueBox({ amount, token, source, hint }: { amount?: string | undefined; token: string; source?: boolean; hint: string }) {
  return <span className={`numeric composer-amount-box ${source ? 'composer-amount' : 'composer-destination-box'}`}
    role="group" aria-label={source ? 'Source amount' : 'Destination amount (unquoted placeholder)'}
    data-symbolic={!amount || undefined} title={hint}>
    <span className="composer-value-column">
      <span className="composer-value-line">
        <span className="composer-amount-value">{amount ?? '0'}</span>
        {source && <svg className="composer-value-edit" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>}
      </span>
      <span className="composer-fiat-value" aria-label="Fiat estimate unavailable (placeholder)" title="Fiat estimate not quoted">US$ 0,00</span>
    </span>
    <TokenChip symbol={token}/>
  </span>;
}

export type ComposerCardData = {
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  const amountBox = !card.inspection && (card.summary.action === 'Swap' || card.summary.action === 'Bridge');
  const amountParts = card.summary.amount.match(/^(\d+(?:\.\d+)?) (\S+)$/);
  const pair = card.summary.detail ?? (!card.inspection ? card.summary.bridgePair : undefined);
  const [pairSource, pairDestination] = pair?.split(' → ') ?? [];
  return <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection ? undefined : card.validation.tone}>
      <Handle type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={false}/>
      {card.inspection ? <>
        <div className="composer-card-head"><span className="composer-step">Step {card.step}</span></div>
        <strong>{card.summary.action}</strong>
      </> : <>
        <strong className="composer-action-title"><span>{card.step}. {card.summary.action}</span><ActionIcon action={actionIcons[card.summary.action] ?? 'action'}/></strong>
        {card.validation.status !== 'Configured' && <span className="composer-card-state" title={card.validation.message}>{card.validation.tone !== 'neutral' && '⚠ '}{card.validation.status}</span>}
      </>}
      {card.inspection ? <>
        <span className="composer-provider">{card.summary.provider || 'Provider not specified'}</span>
        <span className="composer-chain">{card.summary.chain}</span>
      </> : <span className="composer-metadata">
        <span className="composer-provider">{card.summary.provider.replace(/Cross-chain Router/g, 'Router') || 'Provider not specified'}</span>
        {' · '}<span className="composer-chain">{card.summary.chain}</span>
      </span>}
      {amountBox ? <>
        <ValueBox source amount={amountParts?.[1]} token={amountParts?.[2] ?? pairSource ?? '—'}
          hint={amountParts ? 'Edit amount in Advanced Settings' : card.summary.amount}/>
        <ValueBox token={pairDestination ?? '—'} hint="Destination amount not quoted; zero is a placeholder"/>
        <span className="composer-quote-note">{!amountParts && <>{card.summary.amount} · </>}Output / fiat not quoted</span>
      </> : <span className="numeric composer-amount">{card.summary.amount}</span>}
      {!amountBox && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{pair}</span>}
      {!card.inspection && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <span className="composer-selected" title="Open Advanced Settings">Advanced Settings
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 3-.5 3-2 1.2L4.7 6l-2 3.5 2.3 2v1l-2.3 2 2 3.5 2.8-1.2 2 1.2.5 3h4l.5-3 2-1.2 2.8 1.2 2-3.5-2.3-2v-1l2.3-2-2-3.5-2.8 1.2-2-1.2-.5-3Z"/><circle cx="12" cy="12" r="3"/></svg>
      </span>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
}

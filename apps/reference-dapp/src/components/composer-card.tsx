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
      {amountBox ? <><span className="numeric composer-amount composer-amount-box" aria-label="Source amount" data-symbolic={!amountParts || undefined} title="Edit amount in Selected Action">
        <span className="composer-amount-value">{amountParts ? amountParts[1] : card.summary.amount}</span>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z"/></svg>
        {' '}<span className="composer-amount-token">{amountParts?.[2] ?? pairSource ?? '—'}</span>
      </span>
        <span className="numeric composer-amount-box composer-destination-box" aria-label="Destination amount" data-symbolic title="Destination amount is available after quoting">
          <span className="composer-amount-value">Not quoted</span>
          {' '}<span className="composer-amount-token">{pairDestination ?? '—'}</span>
        </span>
      </> : <span className="numeric composer-amount">{card.summary.amount}</span>}
      {!amountBox && pair && <span className={card.summary.detail ? 'composer-detail' : 'composer-bridge-pair'}>{pair}</span>}
      {!card.inspection && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <span className="composer-selected">{card.selected ? 'Editing in Selected Action' : 'Select to edit below'}</span>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
}

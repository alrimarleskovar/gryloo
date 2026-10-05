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
      <span className="numeric composer-amount">{card.summary.amount}</span>
      {card.summary.detail && <span className="composer-detail">{card.summary.detail}</span>}
      {!card.inspection && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <span className="composer-selected">{card.selected ? 'Editing in Selected Action' : 'Select to edit below'}</span>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
}

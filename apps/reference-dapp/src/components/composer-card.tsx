// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { Handle, Position } from '@xyflow/react';
import type { composerSummary, composerNodeState } from '../domain/composer-presentation';

export type ComposerCardData = {
  composer: true; step: number; selected: boolean; vertical: boolean;
  summary: ReturnType<typeof composerSummary>;
} & ({ inspection: true } | { inspection?: false; validation: ReturnType<typeof composerNodeState> });

/** Shared UX-002 card; inspection has no authoring or simulation-result status. */
export function ComposerCard({ data: card }: { data: ComposerCardData }) {
  return <div className={`flow-card composer-card ${card.selected ? 'active' : ''}`} data-state={card.inspection ? undefined : card.validation.tone}>
      <Handle type="target" position={card.vertical ? Position.Top : Position.Left} isConnectable={false}/>
      <div className="composer-card-head"><span className="composer-step">Step {card.step}</span>{!card.inspection && <span className="composer-card-state" title={card.validation.message ?? 'Parameters saved in the draft; execution requires separate review.'}>{card.validation.tone !== 'neutral' && '⚠ '}{card.validation.status}</span>}</div>
      <strong>{card.summary.action}</strong>
      <span className="composer-provider">{card.summary.provider || 'Provider not specified'}</span>
      <span className="composer-chain">{card.summary.chain}</span>
      <span className="numeric composer-amount">{card.summary.amount}</span>
      {card.summary.detail && <span className="composer-detail">{card.summary.detail}</span>}
      {!card.inspection && card.validation.message && <span className="composer-warning" title={card.validation.message}>Check settings</span>}
      {card.summary.risk && <span className="flow-card-risk">{card.summary.risk}</span>}
      {!card.inspection && <span className="composer-selected">{card.selected ? 'Editing in Selected Action' : 'Select to edit below'}</span>}
      <Handle type="source" position={card.vertical ? Position.Bottom : Position.Right} isConnectable={false}/>
    </div>;
}

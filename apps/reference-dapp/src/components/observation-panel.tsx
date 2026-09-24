// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import { BASE_OBSERVATION_PROFILE } from '@defi-workflow-engine/reference-linter';
import { checkObservationAccess, observationView, type NodeObservation, type ObservationRecord } from '../domain/base-observation';
import { SWAP_ACTION, swapDetails } from '../domain/swap-authoring';
import type { Workflow } from '../domain/initial-workflow';
import { useBaseObservations, useWorkflow } from '../state/workflow-store';

/** Every observed amount is rendered only through this element, with its mode and block beside it. */
function ObservedValue({ units, human, symbol, modeLabel, block }: { units: string; human: string; symbol: string; modeLabel: string; block: number }) {
  return <span className="observed-value" data-observed-value="">
    <span className="numeric">{human} {symbol}</span>
    <small>{units} native units</small>
    <span className="observed-tag">{modeLabel} · block {block}</span>
  </span>;
}

type Shown = 'NOT READ' | 'READING' | 'CURRENT' | 'EXPIRED' | 'INVALIDATED' | 'FAILED';
function shownStatus(entry: NodeObservation | undefined, accessOk: boolean, stale: boolean): Shown {
  if (!entry) return 'NOT READ';
  if (entry.status === 'READING') return 'READING';
  if (entry.status === 'FAILED') return 'FAILED';
  if (entry.status === 'RETIRED') return entry.reason === 'SEMANTIC_EDIT' ? 'INVALIDATED' : 'EXPIRED';
  return accessOk ? 'CURRENT' : stale ? 'INVALIDATED' : 'EXPIRED';
}

function Retired({ record, workflow, shown }: { record: ObservationRecord; workflow: Workflow; shown: 'EXPIRED' | 'INVALIDATED' }) {
  return <div className="observation-retired" role="status">
    <strong>{shown === 'EXPIRED' ? `EXPIRED · the ${BASE_OBSERVATION_PROFILE.validitySeconds}-second observation validity ended at ${record.review.expiresAt}` : `INVALIDATED · semantic edit (revision ${record.review.revision} → ${workflow.revision})`}</strong>
    <p>Values and JSON of this observation are hidden and are never reused. Read again for revision {workflow.revision}.</p>
    <p>Retired observation <code>{record.review.artifactHash}</code></p>
  </div>;
}

export function ObservationPanel() {
  const { state, context } = useWorkflow();
  const { observations, readQuote, accessCheck } = useBaseObservations();
  const workflow = state.workflow;
  const [open, setOpen] = useState<string | null>(null);
  const swaps = workflow.nodes.filter(node => node.actionType === SWAP_ACTION)
    .sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)
    .flatMap(node => { const details = swapDetails(node, context); return details ? [{ nodeId: node.nodeId, details }] : []; });
  // Every render is an access: binding and expiry are re-evaluated now.
  const wallNowMs = Date.now(), monotonicNowMs = performance.now();
  const rows = swaps.map(swap => {
    const entry = observations[swap.nodeId];
    const access = checkObservationAccess(entry, workflow, wallNowMs, monotonicNowMs);
    const shown = shownStatus(entry, access.ok, !access.ok && access.code === 'OBSERVATION_STALE');
    return { ...swap, entry, current: access.ok ? access.record : null, shown };
  });
  useEffect(() => { if (rows.some(row => row.entry?.status === 'CURRENT' && !row.current)) accessCheck(); });
  function toggle(key: string, nodeId: string) {
    // Opening JSON is a use of the observation, so the guard runs again at that moment.
    if (!checkObservationAccess(observations[nodeId], workflow, Date.now(), performance.now()).ok) { setOpen(null); accessCheck(); return; }
    setOpen(open === key ? null : key);
  }

  return <section className="observation-panel panel" aria-label="Base read-only observation">
    <div className="simulate-head">
      <div><p className="eyebrow">SIMULATE / BASE READ-ONLY OBSERVATION</p><h2>Base read-only observation</h2>
        <p className="muted">Reads Uniswap v3 QuoterV2 and the factory on Base mainnet through this local server, with every read pinned to one block hash. Live reads use the single Alchemy Free provider only when explicitly enabled on a local development server. An observation is not evidence, not a route recommendation and not an authorization input. The mocked chain above never uses these values.</p></div>
      <span className="observation-badge">NOT EVIDENCE · NOT AN AUTHORIZATION INPUT</span>
    </div>
    <p className="observation-disclosure">A read sends the token pair, exact input amount and server IP to Alchemy ({BASE_OBSERVATION_PROFILE.providerHost}). The API key stays on the local server; no wallet address or browser cookie is sent.</p>
    {rows.length === 0 ? <div className="simulate-empty"><strong>No Base swap to read</strong><p>Add a Base swap in Build before reading a Base quote.</p></div>
      : rows.map(row => {
        const view = row.current ? observationView(row.current, context) : null;
        const record = row.current;
        const retired = row.entry?.status === 'RETIRED' ? row.entry.record : row.entry?.status === 'CURRENT' && !row.current ? row.entry.record : null;
        return <article key={row.nodeId} className="observation-swap" aria-label={`Base observation for ${row.nodeId}`}>
          <div className="observation-swap-head">
            <h3>{row.nodeId} · {row.details.from} → {row.details.to} · exact input {row.details.amount} {row.details.from}</h3>
            <div className="simulate-controls">
              <span className={`observation-status observation-${row.shown.toLowerCase().replace(' ', '-')}`}>OBSERVATION: {row.shown}</span>
              <button type="button" onClick={() => readQuote(row.nodeId)} disabled={row.shown === 'READING'}>Read Base quote</button>
            </div>
          </div>
          {row.entry?.status === 'READING' && <p className="simulate-note" role="status">Reading Base for revision {row.entry.workflow.revision}.</p>}
          {row.entry?.status === 'FAILED' && <p className="observation-alert" role="alert"><strong>{row.entry.code}</strong> {row.entry.message}</p>}
          {retired && (row.shown === 'EXPIRED' || row.shown === 'INVALIDATED') && <Retired record={retired} workflow={workflow} shown={row.shown}/>}
          {record && view && <>
            <p className="observation-mode"><span className="observation-badge">{view.modeLabel}</span><span>Block {view.block.number} · {view.block.time}</span></p>
            <table className="tier-table" aria-label={`Fee tiers for ${row.nodeId}`}>
              <thead><tr><th scope="col">Fee tier</th><th scope="col">Pool</th><th scope="col">Status</th><th scope="col">Quoted output for {view.amountIn.human} {view.from}</th></tr></thead>
              <tbody>{view.tiers.map(tier => <tr key={tier.fee}>
                <td>{tier.feeLabel}</td>
                <td>{tier.pool ? <code>{tier.pool}</code> : 'No pool'}</td>
                <td>{tier.statusLabel}</td>
                <td>{tier.amount ? <ObservedValue units={tier.amount.units} human={tier.amount.human} symbol={tier.amount.symbol} modeLabel={view.modeLabel} block={view.block.number}/> : 'No number shown'}</td>
              </tr>)}</tbody>
            </table>
            <p className="observation-note">Fee tiers are listed in a fixed order. Nothing is ranked or recommended. A number is shown only when the quote provably consumed the full input; no minimum output is derived.</p>
            <ul className="observation-checks" aria-label={`On-chain checks for ${row.nodeId}`}>{view.checks.map(check => <li key={check}>{check}</li>)}</ul>
            <dl className="observation-provenance" aria-label={`Provenance for ${row.nodeId}`}>
              <div><dt>Mode</dt><dd>{record.review.facts.mode}</dd></div>
              <div><dt>Provider host</dt><dd>{record.review.facts.providerHost}</dd></div>
              <div><dt>Chain</dt><dd>{record.review.facts.chainId}</dd></div>
              <div><dt>Block</dt><dd>{view.block.number}</dd></div>
              <div><dt>Block hash</dt><dd><code>{view.block.hash}</code></dd></div>
              <div><dt>Block time</dt><dd>{view.block.time}</dd></div>
              <div><dt>Retrieved at</dt><dd>{record.review.retrievedAt}</dd></div>
              <div><dt>Expires at</dt><dd>{record.review.expiresAt} ({BASE_OBSERVATION_PROFILE.validitySeconds}-second rule)</dd></div>
              <div><dt>Requests</dt><dd>{record.review.facts.requests}</dd></div>
              <div><dt>Transcript hash</dt><dd><code data-observation-hash={`transcript:${row.nodeId}`}>{record.review.rawResponseHash}</code></dd></div>
              <div><dt>Artifact hash</dt><dd><code data-observation-hash={`artifact:${row.nodeId}`}>{record.review.artifactHash}</code></dd></div>
            </dl>
            <div className="artifact-json">
              {([[`artifact:${row.nodeId}`, `Show JSON · Base observation ${row.nodeId}`, `Hide JSON · Base observation ${row.nodeId}`, record.artifactJson],
                [`transcript:${row.nodeId}`, `Show transcript · ${row.nodeId}`, `Hide transcript · ${row.nodeId}`, record.transcript]] as const).map(([key, show, hide, text]) => <div key={key}>
                <button type="button" className="quiet" aria-expanded={open === key} onClick={() => toggle(key, row.nodeId)}>{open === key ? hide : show}</button>
                {open === key && <pre data-observation-json={key}>{text}</pre>}
              </div>)}
            </div>
          </>}
        </article>;
      })}
    <p className="not-modeled"><strong>Not modeled:</strong> minimum output, slippage bounds, route choice, transaction gas, protocol fees and MEV. USD values: not modeled. Not an authorization input.</p>
  </section>;
}

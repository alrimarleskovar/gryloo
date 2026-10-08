// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState } from 'react';
import { BASE_OBSERVATION_PROFILE } from '@defi-workflow-engine/reference-linter';
import { checkObservationAccess, observationView, type NodeObservation, type ObservationRecord } from '../domain/base-observation';
import { SWAP_ACTION, swapDetails } from '../domain/swap-authoring';
import type { Workflow } from '../domain/initial-workflow';
import { useBaseObservations, useWorkflow } from '../state/workflow-store';

/** Every observed amount is rendered only through this element, with its mode and block beside it. */
function ObservedValue({ units, human, symbol, modeLabel, block }: { units: string; human: string; symbol: string; modeLabel: string; block: number }) {
  const { t: tr } = useLocale();
  return <span className="observed-value" data-observed-value="">
    <span className="numeric">{tr(human)} {symbol}</span>
    <small>{tr(units)}{tr(" native units")}</small>
    <span className="observed-tag">{tr(modeLabel)}{tr(" · block ")}{tr(block)}</span>
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
  const { t: tr } = useLocale();
  return <div className="observation-retired" role="status">
    <strong>{tr(shown === 'EXPIRED' ? `EXPIRED · the ${BASE_OBSERVATION_PROFILE.validitySeconds}-second observation validity ended at ${record.review.expiresAt}` : `INVALIDATED · semantic edit (revision ${record.review.revision} → ${workflow.revision})`)}</strong>
    <p>{tr("Values and JSON of this observation are hidden and are never reused. Read again for revision ")}{tr(workflow.revision)}.</p>
    <p>{tr("Retired observation ")}<code>{tr(record.review.artifactHash)}</code></p>
  </div>;
}

export function ObservationPanel() {
  const { t: tr } = useLocale();
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

  return <section className="observation-panel panel" aria-label={tr("Base read-only observation")}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr("SIMULATE / BASE READ-ONLY OBSERVATION")}</p><h2>{tr("Base read-only observation")}</h2>
        <p className="muted">{tr("Reads Uniswap v3 QuoterV2 and the factory on Base mainnet through this local server, with every read pinned to one block hash. Live reads use the single Alchemy Free provider only when explicitly enabled on a local development server. An observation is not evidence, not a route recommendation and not an authorization input. The mocked chain above never uses these values.")}</p></div>
      <span className="observation-badge">{tr("NOT EVIDENCE · NOT AN AUTHORIZATION INPUT")}</span>
    </div>
    <p className="observation-disclosure">{tr("A read sends the token pair, exact input amount and server IP to Alchemy (")}{tr(BASE_OBSERVATION_PROFILE.providerHost)}{tr("). The API key stays on the local server; no wallet address or browser cookie is sent.")}</p>
    {rows.length === 0 ? <div className="simulate-empty"><strong>{tr("No Base swap to read")}</strong><p>{tr("Add a Base swap in Build before reading a Base quote.")}</p></div>
      : rows.map(row => {
        const view = row.current ? observationView(row.current, context) : null;
        const record = row.current;
        const retired = row.entry?.status === 'RETIRED' ? row.entry.record : row.entry?.status === 'CURRENT' && !row.current ? row.entry.record : null;
        return <article key={row.nodeId} className="observation-swap" aria-label={tr(`Base observation for ${row.nodeId}`)}>
          <div className="observation-swap-head">
            <h3>{row.nodeId} · {tr(row.details.from)} → {tr(row.details.to)}{tr(" · exact input ")}{tr(row.details.amount)} {tr(row.details.from)}</h3>
            <div className="simulate-controls">
              <span className={`observation-status observation-${row.shown.toLowerCase().replace(' ', '-')}`}>{tr("OBSERVATION: ")}{tr(row.shown)}</span>
              <button type="button" onClick={() => readQuote(row.nodeId)} disabled={row.shown === 'READING'}>{tr("Read Base quote")}</button>
            </div>
          </div>
          {row.entry?.status === 'READING' && <p className="simulate-note" role="status">{tr("Reading Base for revision ")}{tr(row.entry.workflow.revision)}.</p>}
          {row.entry?.status === 'FAILED' && <p className="observation-alert" role="alert"><strong>{tr(row.entry.code)}</strong> {tr(row.entry.message)}</p>}
          {retired && (row.shown === 'EXPIRED' || row.shown === 'INVALIDATED') && <Retired record={retired} workflow={workflow} shown={row.shown}/>}
          {record && view && <>
            <p className="observation-mode"><span className="observation-badge">{tr(view.modeLabel)}</span><span>{tr("Block ")}{tr(view.block.number)} · {tr(view.block.time)}</span></p>
            <table className="tier-table" aria-label={tr(`Fee tiers for ${row.nodeId}`)}>
              <thead><tr><th scope="col">{tr("Fee tier")}</th><th scope="col">{tr("Pool")}</th><th scope="col">{tr("Status")}</th><th scope="col">{tr("Quoted output for ")}{tr(view.amountIn.human)} {tr(view.from)}</th></tr></thead>
              <tbody>{view.tiers.map(tier => <tr key={tier.fee}>
                <td>{tr(tier.feeLabel)}</td>
                <td>{tier.pool ? <code>{tr(tier.pool)}</code> : 'No pool'}</td>
                <td>{tr(tier.statusLabel)}</td>
                <td>{tier.amount ? <ObservedValue units={tier.amount.units} human={tier.amount.human} symbol={tier.amount.symbol} modeLabel={view.modeLabel} block={view.block.number}/> : 'No number shown'}</td>
              </tr>)}</tbody>
            </table>
            <p className="observation-note">{tr("Fee tiers are listed in a fixed order. Nothing is ranked or recommended. A number is shown only when the quote provably consumed the full input; no minimum output is derived.")}</p>
            <ul className="observation-checks" aria-label={tr(`On-chain checks for ${row.nodeId}`)}>{view.checks.map(check => <li key={check}>{tr(check)}</li>)}</ul>
            <dl className="observation-provenance" aria-label={tr(`Provenance for ${row.nodeId}`)}>
              <div><dt>{tr("Mode")}</dt><dd>{tr(record.review.facts.mode)}</dd></div>
              <div><dt>{tr("Provider host")}</dt><dd>{tr(record.review.facts.providerHost)}</dd></div>
              <div><dt>{tr("Chain")}</dt><dd>{tr(record.review.facts.chainId)}</dd></div>
              <div><dt>{tr("Block")}</dt><dd>{tr(view.block.number)}</dd></div>
              <div><dt>{tr("Block hash")}</dt><dd><code>{tr(view.block.hash)}</code></dd></div>
              <div><dt>{tr("Block time")}</dt><dd>{tr(view.block.time)}</dd></div>
              <div><dt>{tr("Retrieved at")}</dt><dd>{tr(record.review.retrievedAt)}</dd></div>
              <div><dt>{tr("Expires at")}</dt><dd>{tr(record.review.expiresAt)} ({tr(BASE_OBSERVATION_PROFILE.validitySeconds)}{tr("-second rule)")}</dd></div>
              <div><dt>{tr("Requests")}</dt><dd>{tr(record.review.facts.requests)}</dd></div>
              <div><dt>{tr("Transcript hash")}</dt><dd><code data-observation-hash={`transcript:${row.nodeId}`}>{tr(record.review.rawResponseHash)}</code></dd></div>
              <div><dt>{tr("Artifact hash")}</dt><dd><code data-observation-hash={`artifact:${row.nodeId}`}>{tr(record.review.artifactHash)}</code></dd></div>
            </dl>
            <div className="artifact-json">
              {([[`artifact:${row.nodeId}`, `Show JSON · Base observation ${row.nodeId}`, `Hide JSON · Base observation ${row.nodeId}`, record.artifactJson],
                [`transcript:${row.nodeId}`, `Show transcript · ${row.nodeId}`, `Hide transcript · ${row.nodeId}`, record.transcript]] as const).map(([key, show, hide, text]) => <div key={key}>
                <button type="button" className="quiet" aria-expanded={open === key} onClick={() => toggle(key, row.nodeId)}>{tr(open === key ? hide : show)}</button>
                {open === key && <pre data-observation-json={key}>{tr(text)}</pre>}
              </div>)}
            </div>
          </>}
        </article>;
      })}
    <p className="not-modeled"><strong>{tr("Not modeled:")}</strong>{tr(" minimum output, slippage bounds, route choice, transaction gas, protocol fees and MEV. USD values: not modeled. Not an authorization input.")}</p>
  </section>;
}

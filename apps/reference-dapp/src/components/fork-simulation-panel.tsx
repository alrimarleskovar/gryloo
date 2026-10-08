// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { formatHumanAmount, SWAP_ACTION } from '../domain/swap-authoring';
import type { Workflow } from '../domain/initial-workflow';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

/** Client pre-check only; the server applies the exact eligibility rule again. */
function eligibility(workflow: Workflow): string | null {
  const swaps = workflow.nodes.filter(node => node.actionType === SWAP_ACTION);
  if (swaps.length !== 1) return 'Local-fork Mode A needs exactly one USDC/WETH swap in the workflow.';
  if (workflow.resourceEdges.length) return 'Connections to the swap are not supported by local-fork Mode A.';
  return null;
}
export function forkTime(seconds: string): string {
  return `${new Date(Number(seconds) * 1000).toISOString().replace('.000Z', 'Z')} fork time`;
}

export function ForkSimulationPanel() {
  const { t: tr } = useLocale();
  const { state, context } = useWorkflow();
  const modeA = useModeA();
  const { info, prepared, retired, recoveryOnly, verifyError, verified, busy, error } = modeA;
  if (!info) return null;
  if (!info.available) {
    return <section className="fork-panel panel" aria-label={tr("Local fork Mode A simulation")}>
      <p className="eyebrow">{tr("SIMULATE / LOCAL FORK · OFF")}</p>
      <p className="simulate-note">{tr("Local-fork Mode A is off on this server. It exists only in an explicitly started local-fork acceptance environment on chain 31337.")}</p>
    </section>;
  }
  const reason = eligibility(state.workflow);
  const current = prepared && !retired;
  const amount = (units: string, symbol: 'USDC' | 'WETH') => `${formatHumanAmount(units, symbol, context)} ${symbol}`;
  const status = !prepared ? 'EMPTY' : retired ? 'INVALIDATED' : recoveryOnly ? 'RECOVERED' : verifyError ? 'BLOCKED' : 'CURRENT';
  return <section className="fork-panel panel" aria-label={tr("Local fork Mode A simulation")}>
    <div className="simulate-head">
      <div><p className="eyebrow">{tr("SIMULATE / LOCAL FORK · CHAIN 31337")}</p><h2>{tr("Local-fork Mode A simulation")}</h2>
        <p className="muted">{tr(info.environment === 'FORK_REPRODUCED'
          ? `Reads come from a closed replay of recorded finalized Base state at block ${info.source.blockNumber} on local chain 31337. Nothing reaches Base and no public funds exist here.`
          : 'MOCKED: synthetic local contracts stand in for Base code on chain 31337. This is engineering evidence only, never fork evidence.')}</p></div>
      <div className="simulate-controls">
        <StatusBadge label={info.environment} tone={info.environment === 'MOCKED' ? 'info' : 'warning'}/>
        <span className={`chain-status fork-${status.toLowerCase()}`}>{tr("FORK: ")}{tr(status)}</span>
        <button type="button" onClick={modeA.simulate} disabled={Boolean(reason) || Boolean(busy)}>{tr("Simulate on local fork for revision ")}{tr(state.workflow.revision)}</button>
      </div>
    </div>
    {reason && !prepared && <p className="simulate-note">{tr(reason)}</p>}
    {busy && <p className="simulate-note" role="status">{tr(busy)}.</p>}
    {error && <p className="simulate-alert" role="alert">{tr("Local-fork step refused: ")}{tr(error)}{tr(". Nothing was requested from the wallet.")}</p>}
    {verifyError && <p className="simulate-alert" role="alert">{tr("Browser verification blocked the wallet: ")}{tr(verifyError)}.</p>}
    {prepared && retired && <div className="chain-retired" role="status">
      <strong>{tr("INVALIDATED · semantic edit (revision ")}{tr(prepared.revision)} → {tr(state.workflow.revision)})</strong>
      <p>{tr("The reviewed quote, simulation, policy, Manifest, plan and payloads are retired for new wallet requests. Simulate again for revision ")}{tr(state.workflow.revision)}.</p>
    </div>}
    {prepared && <div className="fork-results">
      <ol className="chain-strip" aria-label={tr("Local fork artifact links")}>
        <li><span>{tr("Semantic Workflow IR · revision ")}{tr(prepared.revision)}</span><code>{tr(prepared.hashes.semanticWorkflowHash)}</code></li>
        <li><span>{tr("Fork Quote/State · ")}{prepared.nodeId} <StatusBadge label={prepared.environment} tone="info"/></span><code>{tr(prepared.hashes.quoteHash)}</code></li>
        <li><span>{tr("Artifact Set")}</span><code>{tr(prepared.hashes.artifactSetHash)}</code></li>
        <li><span>{tr("Exact simulation")}</span><code>{tr(prepared.hashes.simulationHash)}</code></li>
      </ol>
      <article className="simulate-swap" aria-label={tr(`Fork simulation for ${prepared.nodeId}`)}>
        <h3>{prepared.nodeId} · {tr(prepared.symbolIn)} → {tr(prepared.symbolOut)}{tr(" · local fork 31337")}</h3>
        <table><tbody>
          <tr><th scope="row">{tr("Source state")}</th><td>{tr(prepared.environment === 'MOCKED' ? 'Synthetic chain 8453' : 'Recorded Base 8453')}{tr(" block ")}{tr(prepared.source.blockNumber)} · <code>{tr(prepared.source.blockHash)}</code></td></tr>
          <tr><th scope="row">{tr("Quote block")}</th><td>{tr("local block ")}{tr(prepared.quoteBlock.number)} · {tr(forkTime(prepared.quoteBlock.timestamp))}</td></tr>
          <tr><th scope="row">{tr("Input")}</th><td className="numeric">{tr(amount(prepared.amountIn, prepared.symbolIn))}</td></tr>
          <tr><th scope="row">{tr("Quoted output (fee ")}{tr(prepared.fee)})</th><td className="numeric">{tr(amount(prepared.quotedOut, prepared.symbolOut))}</td></tr>
          <tr><th scope="row">{tr("Minimum at ")}{tr(prepared.slippageBps)}{tr(" bps")}</th><td className="numeric">{tr(amount(prepared.minimumOut, prepared.symbolOut))}</td></tr>
          <tr><th scope="row">{tr("Simulated gas")}</th><td className="numeric">{tr("approve ")}{tr(prepared.simulation.approveGasUsed)}{tr(" of ")}{tr(prepared.simulation.approveGasLimit)}{tr(" · swap ")}{tr(prepared.simulation.swapGasUsed)}{tr(" of ")}{tr(prepared.simulation.swapGasLimit)}</td></tr>
          <tr><th scope="row">{tr("Failure path")}</th><td>{tr("If the swap fails after approval, a finite allowance of ")}<span className="numeric">{tr(amount(prepared.simulation.residualAllowanceOnSwapFailure, prepared.symbolIn))}</span>{tr(" remains until a separate revocation.")}</td></tr>
          <tr><th scope="row">{tr("Quote validity")}</th><td>{tr("until ")}{tr(forkTime(prepared.quoteExpiresAt))}{tr("; swap deadline ")}{tr(forkTime(prepared.deadline))}</td></tr>
        </tbody></table>
      </article>
      <table className="tier-table" aria-label={tr(`Fork fee tiers for ${prepared.nodeId}`)}><thead><tr><th scope="col">{tr("Fee tier")}</th><th scope="col">{tr("Status")}</th><th scope="col">{tr("Quoted output")}</th></tr></thead><tbody>
        {prepared.tiers.map(tier => <tr key={tier.fee}><td>{tr(tier.fee)}</td><td>{tr(tier.status)}</td><td className="numeric">{tr(tier.amountOut ? amount(tier.amountOut, prepared.symbolOut) : '—')}</td></tr>)}
      </tbody></table>
      <p className="fork-verified" data-browser-verification={verified['step-approve'] && verified['step-swap'] ? 'EXACT' : 'BLOCKED'}>
        {tr(verified['step-approve'] && verified['step-swap']
          ? 'The browser independently decoded both unsigned payloads and recomputed their hashes: EXACT match with the server.'
          : 'The browser has not verified these payloads; no wallet request is possible.')}</p>
      {prepared.excludedMockNodes.length > 0 && <p className="simulate-note">{tr("Mock nodes excluded from execution: ")}{tr(prepared.excludedMockNodes.join(', '))}{tr(". They have no financial meaning.")}</p>}
      <p className="not-modeled"><strong>{tr("Not modeled:")}</strong>{tr(" current markets, MEV, other users and L1 data costs beyond the fork. USD values: not modeled.")}</p>
      <p className="simulate-next">{tr(current && !verifyError ? 'Next step: review the Mode A Manifest and both exact wallet authorizations in Execute.' : 'Next step: simulate the current revision.')}</p>
    </div>}
  </section>;
}

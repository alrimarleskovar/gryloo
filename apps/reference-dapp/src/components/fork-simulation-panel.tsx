// SPDX-License-Identifier: AGPL-3.0-only
'use client';
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
  const { state, context } = useWorkflow();
  const modeA = useModeA();
  const { info, prepared, retired, recoveryOnly, verifyError, verified, busy, error } = modeA;
  if (!info) return null;
  if (!info.available) {
    return <section className="fork-panel panel" aria-label="Local fork Mode A simulation">
      <p className="eyebrow">SIMULATE / LOCAL FORK · OFF</p>
      <p className="simulate-note">Local-fork Mode A is off on this server. It exists only in an explicitly started local-fork acceptance environment on chain 31337.</p>
    </section>;
  }
  const reason = eligibility(state.workflow);
  const current = prepared && !retired;
  const amount = (units: string, symbol: 'USDC' | 'WETH') => `${formatHumanAmount(units, symbol, context)} ${symbol}`;
  const status = !prepared ? 'EMPTY' : retired ? 'INVALIDATED' : recoveryOnly ? 'RECOVERED' : verifyError ? 'BLOCKED' : 'CURRENT';
  return <section className="fork-panel panel" aria-label="Local fork Mode A simulation">
    <div className="simulate-head">
      <div><p className="eyebrow">SIMULATE / LOCAL FORK · CHAIN 31337</p><h2>Local-fork Mode A simulation</h2>
        <p className="muted">{info.environment === 'FORK_REPRODUCED'
          ? `Reads come from a closed replay of recorded finalized Base state at block ${info.source.blockNumber} on local chain 31337. Nothing reaches Base and no public funds exist here.`
          : 'MOCKED: synthetic local contracts stand in for Base code on chain 31337. This is engineering evidence only, never fork evidence.'}</p></div>
      <div className="simulate-controls">
        <StatusBadge label={info.environment} tone={info.environment === 'MOCKED' ? 'info' : 'warning'}/>
        <span className={`chain-status fork-${status.toLowerCase()}`}>FORK: {status}</span>
        <button type="button" onClick={modeA.simulate} disabled={Boolean(reason) || Boolean(busy)}>Simulate on local fork for revision {state.workflow.revision}</button>
      </div>
    </div>
    {reason && !prepared && <p className="simulate-note">{reason}</p>}
    {busy && <p className="simulate-note" role="status">{busy}.</p>}
    {error && <p className="simulate-alert" role="alert">Local-fork step refused: {error}. Nothing was requested from the wallet.</p>}
    {verifyError && <p className="simulate-alert" role="alert">Browser verification blocked the wallet: {verifyError}.</p>}
    {prepared && retired && <div className="chain-retired" role="status">
      <strong>INVALIDATED · semantic edit (revision {prepared.revision} → {state.workflow.revision})</strong>
      <p>The reviewed quote, simulation, policy, Manifest, plan and payloads are retired for new wallet requests. Simulate again for revision {state.workflow.revision}.</p>
    </div>}
    {prepared && <div className="fork-results">
      <ol className="chain-strip" aria-label="Local fork artifact links">
        <li><span>Semantic Workflow IR · revision {prepared.revision}</span><code>{prepared.hashes.semanticWorkflowHash}</code></li>
        <li><span>Fork Quote/State · {prepared.nodeId} <StatusBadge label={prepared.environment} tone="info"/></span><code>{prepared.hashes.quoteHash}</code></li>
        <li><span>Artifact Set</span><code>{prepared.hashes.artifactSetHash}</code></li>
        <li><span>Exact simulation</span><code>{prepared.hashes.simulationHash}</code></li>
      </ol>
      <article className="simulate-swap" aria-label={`Fork simulation for ${prepared.nodeId}`}>
        <h3>{prepared.nodeId} · {prepared.symbolIn} → {prepared.symbolOut} · local fork 31337</h3>
        <table><tbody>
          <tr><th scope="row">Source state</th><td>{prepared.environment === 'MOCKED' ? 'Synthetic chain 8453' : 'Recorded Base 8453'} block {prepared.source.blockNumber} · <code>{prepared.source.blockHash}</code></td></tr>
          <tr><th scope="row">Quote block</th><td>local block {prepared.quoteBlock.number} · {forkTime(prepared.quoteBlock.timestamp)}</td></tr>
          <tr><th scope="row">Input</th><td className="numeric">{amount(prepared.amountIn, prepared.symbolIn)}</td></tr>
          <tr><th scope="row">Quoted output (fee {prepared.fee})</th><td className="numeric">{amount(prepared.quotedOut, prepared.symbolOut)}</td></tr>
          <tr><th scope="row">Minimum at {prepared.slippageBps} bps</th><td className="numeric">{amount(prepared.minimumOut, prepared.symbolOut)}</td></tr>
          <tr><th scope="row">Simulated gas</th><td className="numeric">approve {prepared.simulation.approveGasUsed} of {prepared.simulation.approveGasLimit} · swap {prepared.simulation.swapGasUsed} of {prepared.simulation.swapGasLimit}</td></tr>
          <tr><th scope="row">Failure path</th><td>If the swap fails after approval, a finite allowance of <span className="numeric">{amount(prepared.simulation.residualAllowanceOnSwapFailure, prepared.symbolIn)}</span> remains until a separate revocation.</td></tr>
          <tr><th scope="row">Quote validity</th><td>until {forkTime(prepared.quoteExpiresAt)}; swap deadline {forkTime(prepared.deadline)}</td></tr>
        </tbody></table>
      </article>
      <table className="tier-table" aria-label={`Fork fee tiers for ${prepared.nodeId}`}><thead><tr><th scope="col">Fee tier</th><th scope="col">Status</th><th scope="col">Quoted output</th></tr></thead><tbody>
        {prepared.tiers.map(tier => <tr key={tier.fee}><td>{tier.fee}</td><td>{tier.status}</td><td className="numeric">{tier.amountOut ? amount(tier.amountOut, prepared.symbolOut) : '—'}</td></tr>)}
      </tbody></table>
      <p className="fork-verified" data-browser-verification={verified['step-approve'] && verified['step-swap'] ? 'EXACT' : 'BLOCKED'}>
        {verified['step-approve'] && verified['step-swap']
          ? 'The browser independently decoded both unsigned payloads and recomputed their hashes: EXACT match with the server.'
          : 'The browser has not verified these payloads; no wallet request is possible.'}</p>
      {prepared.excludedMockNodes.length > 0 && <p className="simulate-note">Mock nodes excluded from execution: {prepared.excludedMockNodes.join(', ')}. They have no financial meaning.</p>}
      <p className="not-modeled"><strong>Not modeled:</strong> current markets, MEV, other users and L1 data costs beyond the fork. USD values: not modeled.</p>
      <p className="simulate-next">{current && !verifyError ? 'Next step: review the Mode A Manifest and both exact wallet authorizations in Execute.' : 'Next step: simulate the current revision.'}</p>
    </div>}
  </section>;
}

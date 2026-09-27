// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import { MOCKED_CHAIN_PROFILE, type ReviewContext, type Symbol } from '@defi-workflow-engine/reference-linter';
import { INVALIDATION_V1, chainStatus, checkChainAccess, type ChainRecord } from '../domain/artifact-chain';
import { formatHumanAmount, swapDetails } from '../domain/swap-authoring';
import type { Workflow } from '../domain/initial-workflow';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
import { WorkflowCanvas, type SimulationOverlay } from './workflow-canvas';

/** Every generated amount is rendered only through this element (R-1). */
export function MockedValue({ units, symbol, context }: { units: string; symbol: Symbol; context: ReviewContext }) {
  return <span className="mocked-value" data-mocked-value="">
    <span className="numeric">{formatHumanAmount(units, symbol, context)} {symbol}</span>
    <small>{units} native units</small>
    <span className="mocked-tag">MOCKED · {MOCKED_CHAIN_PROFILE.rateLabel}</span>
  </span>;
}

type SwapView = { nodeId: string; from: Symbol; to: Symbol; amount: string; units: string; slippage: number;
  expected: string; minimum: string; adverse: string; residual: string };

function swapViews(record: ChainRecord, context: ReviewContext): SwapView[] {
  return record.chain.quotes.map((quote) => {
    const node = record.sourceWorkflow.nodes.find(candidate => candidate.nodeId === quote.nodeId);
    const details = node && swapDetails(node, context);
    const output = record.chain.simulation.outputs.find(candidate => candidate.nodeId === quote.nodeId);
    const failure = record.chain.simulation.failurePaths.find(candidate => candidate.failedNodeId === quote.nodeId);
    if (!details || details.slippage === null || !output || !failure?.residualAssets[0]) throw new Error('ARTIFACTS_UNAVAILABLE');
    return { nodeId: quote.nodeId, from: details.from, to: details.to, amount: details.amount, units: details.units, slippage: details.slippage,
      expected: output.expected.amount, minimum: output.minimum.amount, adverse: output.adverse.amount, residual: failure.residualAssets[0].amount };
  });
}

function jsonFor(record: ChainRecord, key: string): string {
  if (key === 'artifact-set') return JSON.stringify(record.chain.artifactSet, null, 2);
  if (key === 'simulation-bundle') return JSON.stringify(record.chain.simulation, null, 2);
  const quote = record.chain.quotes.find(candidate => `quote:${candidate.nodeId}` === key);
  if (!quote) throw new Error('ARTIFACTS_UNAVAILABLE');
  return JSON.stringify(quote, null, 2);
}

function RetiredChain({ record, workflow, expired }: { record: ChainRecord; workflow: Workflow; expired: boolean }) {
  const dependents = expired ? INVALIDATION_V1.ARTIFACT_EXPIRED : INVALIDATION_V1.SEMANTIC_EDIT;
  return <div className="chain-retired" role="status">
    <strong>{expired ? 'EXPIRED · the 60-second mock validity window ended' : `INVALIDATED · semantic edit (revision ${record.review.revision} → ${workflow.revision})`}</strong>
    <p>Numbers and JSON of this chain are hidden. Generate new mocked artifacts for revision {workflow.revision}.</p>
    <p>Dependents retired under the frozen v1 matrix: {dependents.join(', ')}.{expired ? ' The expired mocked quote is retired as well.' : ''} Policy, manifest, plan and authorization dependents were never created.</p>
    <ul className="retired-ids" aria-label="Retired artifact identities">
      <li>Semantic Workflow IR · revision {record.review.revision} <code>{record.review.semanticWorkflowHash}</code></li>
      {record.chain.quotes.map(quote => <li key={quote.nodeId}>Retired mocked quote · {quote.nodeId} <code>{record.review.quoteHashes[quote.nodeId]}</code></li>)}
      <li>Retired Artifact Set <code>{record.review.artifactSetHash}</code></li>
      <li>Retired mocked simulation <code>{record.review.simulationHash}</code></li>
    </ul>
  </div>;
}

export function SimulatePanel() {
  const { state, context, chain, eligibility, generateArtifacts, refreshArtifacts, accessCheck } = useWorkflow();
  const workflow = state.workflow;
  const [openJson, setOpenJson] = useState<string | null>(null);
  const status = chainStatus(chain);
  // Every render is an access: binding and expiry are re-evaluated now.
  const access = checkChainAccess(chain, workflow, Date.now(), performance.now());
  const current = access.ok ? access.record : null;
  const shown = status === 'CURRENT' && !access.ok ? (access.code === 'ARTIFACTS_STALE' ? 'INVALIDATED' : 'EXPIRED') : status;
  useEffect(() => { if (status === 'CURRENT' && !access.ok) accessCheck(); });
  const views = current ? swapViews(current, context) : [];
  const overlay: ReadonlyMap<string, SimulationOverlay> = new Map(views.map(view => [view.nodeId, { symbol: view.to, expected: view.expected, minimum: view.minimum }]));
  function toggleJson(key: string) {
    // Opening JSON is a use of the chain, so the guard runs again at that moment.
    if (!checkChainAccess(chain, workflow, Date.now(), performance.now()).ok) { setOpenJson(null); accessCheck(); return; }
    setOpenJson(openJson === key ? null : key);
  }
  const jsonKeys = current ? [...current.chain.quotes.map(quote => [`quote:${quote.nodeId}`, `mocked quote · ${quote.nodeId}`] as const),
    ['artifact-set', 'Artifact Set'] as const, ['simulation-bundle', 'mocked simulation'] as const] : [];

  return <section className="simulate-panel panel" aria-label="Mocked artifact chain">
    <div className="simulate-head">
      <div><p className="eyebrow">SIMULATE / MOCKED ARTIFACT CHAIN</p><h2>Mocked artifact chain</h2>
        <p className="muted">Generates MOCKED Quote/State, Artifact Set and Simulation Bundle artifacts for the current revision from a synthetic fixture ({MOCKED_CHAIN_PROFILE.rateLabel}). Mocked artifacts cannot authorize execution.</p></div>
      <div className="simulate-controls">
        <span className={`chain-status chain-${shown.toLowerCase()}`}>ARTIFACTS: {shown}</span>
        {current
          ? <button type="button" onClick={refreshArtifacts}>Refresh mocked quote</button>
          : <button type="button" onClick={generateArtifacts} disabled={!eligibility.eligible || status === 'GENERATING'}>Generate mocked artifacts for revision {workflow.revision}</button>}
      </div>
    </div>
    {!current && !eligibility.eligible && <p className="simulate-note">{eligibility.reason}</p>}
    {status === 'REJECTED' && chain.rejected && <p className="simulate-alert" role="alert">{chain.rejected === 'DIGEST_UNAVAILABLE'
      ? 'Artifact hashing self-check failed (DIGEST_UNAVAILABLE). No mocked artifacts were generated.'
      : `Mocked artifact generation failed (${chain.rejected}). No mocked artifacts were generated.`}</p>}
    {chain.notice && <p className="simulate-note" role="status">Generation finished for a superseded revision and was discarded.</p>}
    {status === 'GENERATING' && <p className="simulate-note" role="status">Generating mocked artifacts for revision {chain.pending?.workflow.revision}.</p>}
    {!current && chain.record && (shown === 'INVALIDATED' || shown === 'EXPIRED') && <RetiredChain record={chain.record} workflow={workflow} expired={shown === 'EXPIRED'}/>}
    <div className="simulate-grid">
      <WorkflowCanvas mode="simulate" overlay={overlay}/>
      <div className="simulate-results">
        {current ? <>
          <ol className="chain-strip" aria-label="Artifact links">
            <li><span>Semantic Workflow IR · revision {current.review.revision}</span><code data-hash="semantic-workflow">{current.review.semanticWorkflowHash}</code></li>
            {current.chain.quotes.map(quote => <li key={quote.nodeId}><span>Mocked quote · {quote.nodeId} <StatusBadge label="MOCKED" tone="info"/></span><code data-hash={`quote:${quote.nodeId}`}>{current.review.quoteHashes[quote.nodeId]}</code></li>)}
            <li><span>Artifact Set <StatusBadge label="MOCKED" tone="info"/></span><code data-hash="artifact-set">{current.review.artifactSetHash}</code></li>
            <li><span>Mocked simulation <StatusBadge label="MOCKED" tone="info"/></span><code data-hash="simulation-bundle">{current.review.simulationHash}</code></li>
          </ol>
          {views.map(view => <article key={view.nodeId} className="simulate-swap" aria-label={`Mocked results for ${view.nodeId}`}>
            <h3>{view.nodeId} · {view.from} → {view.to} · Base</h3>
            <table><tbody>
              <tr><th scope="row">Input (authored)</th><td>{view.amount} {view.from} · {view.units} native units</td></tr>
              <tr><th scope="row">Expected output</th><td><MockedValue units={view.expected} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">Minimum at {view.slippage} bps</th><td><MockedValue units={view.minimum} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">Adverse outcome</th><td><MockedValue units={view.adverse} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">Failure path</th><td><div className="failure-cell"><span>An output below the minimum is modeled as a revert that retains the input:</span><MockedValue units={view.residual} symbol={view.from} context={context}/><span>Gas not modeled.</span></div></td></tr>
            </tbody></table>
          </article>)}
          <table className="enforcement-table" aria-label="Enforcement locations"><thead><tr><th scope="col">Limit</th><th scope="col">Enforcement</th></tr></thead><tbody>
            <tr><td>Maximum input (authored)</td><td>NOT_ENFORCED</td></tr>
            <tr><td>Maximum slippage (authored)</td><td>NOT_ENFORCED</td></tr>
            <tr><td>Mocked minimum output</td><td>NOT_ENFORCED</td></tr>
            <tr><td>Prototype cap (1,000,000 USDC or 1,000 WETH)</td><td>NOT_ENFORCED</td></tr>
          </tbody></table>
          <ul className="chain-findings" aria-label="Mocked chain review findings">
            {current.review.findings.map(finding => <li key={`${finding.nodeId}-${finding.code}`} className="review-block"><strong>{finding.severity} · {finding.code}</strong><span>{finding.nodeId} / {finding.field}: {finding.message}</span></li>)}
          </ul>
          <p className="simulate-validity">Generated locally at {current.review.observedAt}. Mock validity ends at {current.review.expiresAt} (60-second rule). Validity is re-checked on every use and when the tab resumes; there is no countdown.</p>
          <div className="artifact-json">
            {jsonKeys.map(([key, label]) => <div key={key}>
              <button type="button" className="quiet" aria-expanded={openJson === key} onClick={() => toggleJson(key)}>{openJson === key ? 'Hide' : 'Show'} JSON · {label}</button>
              {openJson === key && <pre data-artifact-json={key}>{jsonFor(current, key)}</pre>}
            </div>)}
          </div>
        </> : <div className="simulate-empty">
          <strong>{shown === 'EMPTY' || shown === 'REJECTED' || shown === 'GENERATING' ? 'No current mocked artifacts' : 'No current mocked artifacts for this revision'}</strong>
          <p>A generation creates one mocked quote per Base swap, an Artifact Set and a mocked simulation, all bound to revision {workflow.revision} and valid for 60 seconds.</p>
        </div>}
        <p className="not-modeled"><strong>Not modeled:</strong> balances, allowances, gas, fees, price impact, liquidity, MEV and duration. USD values: not modeled.</p>
        <p className="simulate-next">Next step: Manifest review is unavailable for mocked artifacts; they cannot authorize execution and the workflow stays DRAFT. Local-fork Mode A uses its own separate artifacts, never these.</p>
      </div>
    </div>
  </section>;
}

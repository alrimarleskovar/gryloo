// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { MOCKED_CHAIN_PROFILE, type ReviewContext, type Symbol } from '@defi-workflow-engine/reference-linter';
import { INVALIDATION_V1, chainStatus, checkChainAccess, type ChainRecord } from '../domain/artifact-chain';
import { formatHumanAmount, swapDetails } from '../domain/swap-authoring';
import type { Workflow } from '../domain/initial-workflow';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
import type { SimulationSource } from '../domain/simulation-presentation';
import { SimulateWorkspace } from './simulate-workspace';

/** Every generated amount is rendered only through this element (R-1). */
export function MockedValue({ units, symbol, context }: { units: string; symbol: Symbol; context: ReviewContext }) {
  const { t: tr } = useLocale();
  return <span className="mocked-value" data-mocked-value="">
    <span className="numeric">{tr(formatHumanAmount(units, symbol, context))} {symbol}</span>
    <small>{tr(units)}{tr(" native units")}</small>
    <span className="mocked-tag">{tr("MOCKED · ")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}</span>
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
  const { t: tr } = useLocale();
  const dependents = expired ? INVALIDATION_V1.ARTIFACT_EXPIRED : INVALIDATION_V1.SEMANTIC_EDIT;
  return <div className="chain-retired" role="status">
    <strong>{tr(expired ? 'EXPIRED · the 60-second mock validity window ended' : `INVALIDATED · semantic edit (revision ${record.review.revision} → ${workflow.revision})`)}</strong>
    <p>{tr("Numbers and JSON of this chain are hidden. Generate new mocked artifacts for revision ")}{tr(workflow.revision)}.</p>
    <p>{tr("Dependents retired under the frozen v1 matrix: ")}{tr(dependents.join(', '))}.{tr(expired ? ' The expired mocked quote is retired as well.' : '')}{tr(" Policy, manifest, plan and authorization dependents were never created.")}</p>
    <ul className="retired-ids" aria-label={tr("Retired artifact identities")}>
      <li>{tr("Semantic Workflow IR · revision ")}{tr(record.review.revision)} <code>{tr(record.review.semanticWorkflowHash)}</code></li>
      {record.chain.quotes.map(quote => <li key={quote.nodeId}>{tr("Retired mocked quote · ")}{quote.nodeId} <code>{record.review.quoteHashes[quote.nodeId]}</code></li>)}
      <li>{tr("Retired Artifact Set ")}<code>{tr(record.review.artifactSetHash)}</code></li>
      <li>{tr("Retired mocked simulation ")}<code>{tr(record.review.simulationHash)}</code></li>
    </ul>
  </div>;
}

export function SimulatePanel({ engineeringOnly = false, workflowName, returnToBuild, reviewActionHost, simulationSource, review, simulateAction, children }: { engineeringOnly?: boolean; workflowName: string; returnToBuild?: () => void; reviewActionHost?: Ref<HTMLDivElement>; children?: ReactNode; review?: ReactNode; simulateAction?: ReactNode; simulationSource?: SimulationSource | undefined }) {
  const { t: tr } = useLocale();
  const { state, context, chain, eligibility, generateArtifacts, refreshArtifacts, accessCheck } = useWorkflow();
  const workflow = state.workflow;
  const [openJson, setOpenJson] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const status = chainStatus(chain);
  // Every render is an access: binding and expiry are re-evaluated now.
  const access = checkChainAccess(chain, workflow, Date.now(), performance.now());
  const current = access.ok ? access.record : null;
  const shown = status === 'CURRENT' && !access.ok ? (access.code === 'ARTIFACTS_STALE' ? 'INVALIDATED' : 'EXPIRED') : status;
  useEffect(() => { if (status === 'CURRENT' && !access.ok) accessCheck(); });
  const views = current ? swapViews(current, context) : [];
  function toggleJson(key: string) {
    // Opening JSON is a use of the chain, so the guard runs again at that moment.
    if (!checkChainAccess(chain, workflow, Date.now(), performance.now()).ok) { setOpenJson(null); accessCheck(); return; }
    setOpenJson(openJson === key ? null : key);
  }
  const jsonKeys = current ? [...current.chain.quotes.map(quote => [`quote:${quote.nodeId}`, `mocked quote · ${quote.nodeId}`] as const),
    ['artifact-set', 'Artifact Set'] as const, ['simulation-bundle', 'mocked simulation'] as const] : [];

  const diagnostics = <>
    <div className="simulate-head">
      <div><p className="muted">{tr("Generates MOCKED Quote/State, Artifact Set and Simulation Bundle artifacts for the current revision from a synthetic fixture (")}{tr(MOCKED_CHAIN_PROFILE.rateLabel)}{tr("). Mocked artifacts cannot authorize execution.")}</p></div>
      <div className="simulate-controls">
        <span className={`chain-status chain-${shown.toLowerCase()}`}>{tr("ARTIFACTS: ")}{tr(shown)}</span>
        {current
          ? <button type="button" onClick={refreshArtifacts}>{tr("Refresh mocked quote")}</button>
          : <button type="button" onClick={generateArtifacts} disabled={!eligibility.eligible || status === 'GENERATING'}>{tr("Generate mocked artifacts for revision ")}{tr(workflow.revision)}</button>}
      </div>
    </div>
    {status === 'REJECTED' && chain.rejected && <p className="simulate-alert" role="alert">{tr(chain.rejected === 'DIGEST_UNAVAILABLE'
      ? 'Artifact hashing self-check failed (DIGEST_UNAVAILABLE). No mocked artifacts were generated.'
      : `Mocked artifact generation failed (${chain.rejected}). No mocked artifacts were generated.`)}</p>}
    {chain.notice && <p className="simulate-note" role="status">{tr("Generation finished for a superseded revision and was discarded.")}</p>}
    {status === 'GENERATING' && <p className="simulate-note" role="status">{tr("Generating mocked artifacts for revision ")}{tr(chain.pending?.workflow.revision)}.</p>}
    {!current && chain.record && (shown === 'INVALIDATED' || shown === 'EXPIRED') && <RetiredChain record={chain.record} workflow={workflow} expired={shown === 'EXPIRED'}/>}
      <div className="simulate-results">
        {current ? <>
          <ol className="chain-strip" aria-label={tr("Artifact links")}>
            <li><span>{tr("Semantic Workflow IR · revision ")}{tr(current.review.revision)}</span><code data-hash="semantic-workflow">{tr(current.review.semanticWorkflowHash)}</code></li>
            {current.chain.quotes.map(quote => <li key={quote.nodeId}><span>{tr("Mocked quote · ")}{quote.nodeId} <StatusBadge label="MOCKED" tone="info"/></span><code data-hash={`quote:${quote.nodeId}`}>{current.review.quoteHashes[quote.nodeId]}</code></li>)}
            <li><span>{tr("Artifact Set ")}<StatusBadge label="MOCKED" tone="info"/></span><code data-hash="artifact-set">{tr(current.review.artifactSetHash)}</code></li>
            <li><span>{tr("Mocked simulation ")}<StatusBadge label="MOCKED" tone="info"/></span><code data-hash="simulation-bundle">{tr(current.review.simulationHash)}</code></li>
          </ol>
          {views.map(view => <article key={view.nodeId} className="simulate-swap" aria-label={tr(`Mocked results for ${view.nodeId}`)}>
            <h3>{view.nodeId} · {tr(view.from)} → {tr(view.to)}{tr(" · Base")}</h3>
            <table><tbody>
              <tr><th scope="row">{tr("Input (authored)")}</th><td>{tr(view.amount)} {tr(view.from)} · {tr(view.units)}{tr(" native units")}</td></tr>
              <tr><th scope="row">{tr("Expected output")}</th><td><MockedValue units={view.expected} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">{tr("Minimum at ")}{tr(view.slippage)}{tr(" bps")}</th><td><MockedValue units={view.minimum} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">{tr("Adverse outcome")}</th><td><MockedValue units={view.adverse} symbol={view.to} context={context}/></td></tr>
              <tr><th scope="row">{tr("Failure path")}</th><td><div className="failure-cell"><span>{tr("An output below the minimum is modeled as a revert that retains the input:")}</span><MockedValue units={view.residual} symbol={view.from} context={context}/><span>{tr("Gas not modeled.")}</span></div></td></tr>
            </tbody></table>
          </article>)}
          <table className="enforcement-table" aria-label={tr("Enforcement locations")}><thead><tr><th scope="col">{tr("Limit")}</th><th scope="col">{tr("Enforcement")}</th></tr></thead><tbody>
            <tr><td>{tr("Maximum input (authored)")}</td><td>{tr("NOT_ENFORCED")}</td></tr>
            <tr><td>{tr("Maximum slippage (authored)")}</td><td>{tr("NOT_ENFORCED")}</td></tr>
            <tr><td>{tr("Mocked minimum output")}</td><td>{tr("NOT_ENFORCED")}</td></tr>
            <tr><td>{tr("Prototype cap (1,000,000 USDC or 1,000 WETH)")}</td><td>{tr("NOT_ENFORCED")}</td></tr>
          </tbody></table>
          <ul className="chain-findings" aria-label={tr("Mocked chain review findings")}>
            {current.review.findings.map(finding => <li key={`${finding.nodeId}-${finding.code}`} className="review-block"><strong>{tr(finding.severity)} · {tr(finding.code)}</strong><span>{finding.nodeId} / {tr(finding.field)}: {tr(finding.message)}</span></li>)}
          </ul>
          <p className="simulate-validity">{tr("Generated locally at ")}{tr(current.review.observedAt)}{tr(". Mock validity ends at ")}{tr(current.review.expiresAt)}{tr(" (60-second rule). Validity is re-checked on every use and when the tab resumes; there is no countdown.")}</p>
          <div className="artifact-json">
            {jsonKeys.map(([key, label]) => <div key={key}>
              <button type="button" className="quiet" aria-expanded={openJson === key} onClick={() => toggleJson(key)}>{tr(openJson === key ? 'Hide' : 'Show')}{tr(" JSON · ")}{tr(label)}</button>
              {openJson === key && <pre data-artifact-json={key}>{tr(jsonFor(current, key))}</pre>}
            </div>)}
          </div>
        </> : <div className="simulate-empty">
          <strong>{tr(shown === 'EMPTY' || shown === 'REJECTED' || shown === 'GENERATING' ? 'No current mocked artifacts' : 'No current mocked artifacts for this revision')}</strong>
          <p>{tr("A generation creates one mocked quote per Base swap, an Artifact Set and a mocked simulation, all bound to revision ")}{tr(workflow.revision)}{tr(" and valid for 60 seconds.")}</p>
        </div>}
        <p className="not-modeled"><strong>{tr("Not modeled:")}</strong>{tr(" balances, allowances, gas, fees, price impact, liquidity, MEV and duration. USD values: not modeled.")}</p>
        <p className="simulate-next">{tr("Next step: Manifest review is unavailable for mocked artifacts; they cannot authorize execution and the workflow stays DRAFT. Local-fork Mode A uses its own separate artifacts, never these.")}</p>
      </div>

      {!current && !eligibility.eligible && <p className="simulate-note">{tr(eligibility.reason)}</p>}
      {children}
    </>;
  if (engineeringOnly) return <div className="engineering-artifacts">{diagnostics}</div>;
  return <SimulateWorkspace workflowName={workflowName} returnToBuild={returnToBuild} reviewActionHost={reviewActionHost} simulationSource={simulationSource} review={review} simulateAction={simulateAction}>
    <details className="shell-details technical-workspace simulation-technical" data-technical-open={showTechnical} onToggle={event => setShowTechnical(event.currentTarget.open)}>
      <summary>{tr('View technical details')}</summary>{diagnostics}
    </details>
  </SimulateWorkspace>;
}

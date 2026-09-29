// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import { buildMockCrossChainLiquidityScenario, type MockCrossChainFailure } from '../app/cross-chain-liquidity-action';
import { setCrossChainCanvasRuntime, type CrossChainRuntimeStatus } from './workflow-canvas';
import { useWorkflow } from '../state/workflow-store';
type Scenario = Awaited<ReturnType<typeof buildMockCrossChainLiquidityScenario>>;
export function CrossChainLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow();
  const [scenario, setScenario] = useState<Scenario | null>(null), [index, setIndex] = useState(0);
  const [manualSelected, setManualSelected] = useState(false);
  const [failure, setFailure] = useState<MockCrossChainFailure>('NONE');
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { setScenario(null); setIndex(0); setError(null); setManualSelected(false); }, [state.workflow]);
  useEffect(() => {
    if (!scenario) return;
    const seen = scenario.snapshots.slice(0, index + 1).map(item => item.stage);
    const last = seen.at(-1);
    const status: Record<string, CrossChainRuntimeStatus> = {
      'build011c-bridge': seen.includes('DESTINATION RECONCILED') ? 'Completed' : 'Pending',
      'build011c-prepare': seen.includes('PREPARATION REVIEWED') ? 'Completed' :
        last === 'RECOVERY REQUIRED' ? 'Recovery required' : 'Pending',
      'build011c-swap': seen.includes('SWAP RECONCILED') ? 'Completed' :
        failure === 'SWAP_REVERT' && last === 'PARTIALLY COMPLETED' ? 'Failed' : 'Pending',
      'build011c-mint': last === 'COMPLETED' ? 'Completed' :
        failure === 'MINT_REVERT' && last === 'PARTIALLY COMPLETED' ? 'Failed' :
          last === 'RECOVERY REQUIRED' ? 'Recovery required' : 'Pending',
    };
    setCrossChainCanvasRuntime(state.workflow.workflowId, state.workflow.revision, status);
  }, [scenario, index, failure, state.workflow]);
  const details = (() => { try { return validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]); } catch { return null; } })();
  if (!details) return null;
  const step = scenario?.snapshots[index];
  const labels = ['Submit MOCKED bridge', 'Reconcile MOCKED destination balance', 'Review actual amount and new Manifest',
    ...(details.noSwap ? [] : ['Reconcile MOCKED destination swap']), 'Submit MOCKED liquidity mint', 'Reconcile MOCKED LP position'];
  async function generate() {
    try { setBusy(true); setError(null);
      const result = await buildMockCrossChainLiquidityScenario(state.workflow as unknown as Parameters<typeof buildMockCrossChainLiquidityScenario>[0], failure);
      setScenario(result); setIndex(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'MOCKED_COMPOSITION_FAILED'); }
    finally { setBusy(false); }
  }
  return <section className="panel bridge-panel" role="region" aria-label="Cross-chain liquidity composition">
    <p className="eyebrow">BUILD-011C · MOCKED COMPOSITION AND RECOVERY</p><h2>Base bridge → Arbitrum split → Uniswap v3 position</h2>
    <p>Deterministic engineering rehearsal with a synthetic route, pool price and observations. Each stage is computed through the canonical compiler, journal and reconciler. No signature, transaction, public-chain receipt or executable authorization is created.</p>
    {!scenario && <><label htmlFor="cross-chain-failure">Deterministic outcome</label>
      <select id="cross-chain-failure" value={failure} onChange={event => setFailure(event.target.value as MockCrossChainFailure)}>
        <option value="NONE">Successful composition</option>
        <option value="SWAP_REVERT">Destination swap reverts</option>
        <option value="MINT_REVERT">Liquidity mint reverts</option>
        <option value="MINT_UNKNOWN_CONFIRMED">Mint response unknown, position found</option>
        <option value="MINT_UNKNOWN_INCONCLUSIVE">Mint response unknown, inconclusive</option>
        <option value="POLICY_EXPIRED">Policy expires after bridge</option>
        <option value="LATE_BRIDGE_SETTLEMENT">Bridge arrives after expiry</option>
        <option value="ARTIFACT_STALE">Destination artifact stale</option>
      </select>
      <button type="button" onClick={generate} disabled={busy}>{busy ? 'Computing MOCKED trace…' : 'Generate MOCKED chained simulation'}</button></>}
    {scenario && step && <>
      <p role="status">Stage: <strong>{step.stage}</strong> · current asset location: {step.location}</p>
      <ul>
        <li>Source: {scenario.sourceUsdc} USDC on Base · provider {scenario.provider}.</li>
        <li>Estimated bridge output: {scenario.estimatedBridgeUsdc} USDC · minimum {scenario.minimumBridgeUsdc} USDC.</li>
        <li>Reconciled destination output: {step.actual ? `${step.actual} USDC` : 'pending MOCKED destination balance read'}.</li>
        <li>Destination split: {step.swapInput ? `${step.swapInput} USDC selected for swap; ${step.liquidityUsdc} USDC kept for the position` : 'pending reconciliation'}.</li>
        <li>Pool: {scenario.pool} · 0.05% · ticks {scenario.tickLower} to {scenario.tickUpper}.</li>
        <li>Independent destination ETH gas reserve: {scenario.destinationGasReserveEth} ETH · source gas {scenario.sourceGasEth} ETH · bridge fee {scenario.bridgeFeeUsdc} USDC.</li>
        <li>Destination swap gas {scenario.destinationSwapGasEth} ETH · pool swap fee {scenario.swapPoolFeeUsdc} USDC · liquidity gas {scenario.liquidityGasEth} ETH · mint protocol fee 0 · estimated spot swap output {scenario.estimatedSwapWeth} WETH.</li>
        {step.liquidityWeth && <li>Final mint inputs: {step.liquidityWeth} WETH + {step.liquidityUsdc} USDC.</li>}
        {step.lp && <li>Reconciled position NFT #{step.lp} · residual {step.residualWeth} WETH + {step.residualUsdc} USDC · remaining allowances 0 / 0.</li>}
      </ul>
      {view === 'execute' && index < scenario.snapshots.length - 1 && <button type="button" disabled={Date.now() >= scenario.expiresAtMs}
        onClick={() => setIndex(value => value + 1)}>{labels[index]}</button>}
      {index === scenario.snapshots.length - 1 && scenario.recovery && <section aria-label="Cross-chain recovery">
        <h3>PARTIALLY COMPLETED</h3>
        <p>The bridge already settled. Local continuation is paused; no prior financial action was undone.</p>
        <h4>{scenario.recovery.evidence === 'RECONCILED' ? 'Current assets' : 'Last independently confirmed assets'}</h4><p>{scenario.recovery.balances.usdc} USDC and {scenario.recovery.balances.weth} WETH on Arbitrum · {step.location}.</p>
        <h4>Completed steps</h4><p>{[...new Set(scenario.recovery.completed)].join(', ')}.</p>
        <h4>Failed step</h4><p>{scenario.recovery.failedStep} · evidence {scenario.recovery.evidence}.</p>
        <h4>Costs already incurred</h4><p>Source gas {scenario.recovery.sourceGasEth} ETH · bridge provider fee {scenario.recovery.bridgeProviderFeeUsdc} USDC · destination gas {scenario.recovery.destinationGasSpentEth} ETH.</p>
        <h4>Authority status</h4><p>{scenario.recovery.authority} · expires {new Date(scenario.recovery.expiresAtMs).toISOString()}. Pausing local execution does not revoke allowances or delegated authority.</p>
        {scenario.requote && <><h4>Fresh requote preview</h4><p>New artifact set {scenario.requote.artifactSet} · simulation {scenario.requote.simulation} · policy {scenario.requote.policy} · Manifest {scenario.requote.manifest}. {scenario.requote.review}. This preview cannot execute until separately reviewed and authorized.</p></>}
        <h4>Available recovery actions</h4><ul>{scenario.recovery.options.map(option => <li key={option.action}>{option.action}: {option.status} — {option.reason}</li>)}</ul>
        <h4>Manual intervention</h4><p>Execution ID {scenario.recovery.executionId}. You may stop here and leave assets at the destination wallet. Use the evidence record and a new reviewed Manifest before any new financial action.</p>
        <button type="button" disabled={manualSelected} onClick={() => setManualSelected(true)}>Stop automatic continuation</button>
        {manualSelected && <p role="status">Manual intervention selected. Local execution paused; authority and allowances have not been revoked.</p>}
      </section>}
      {index === scenario.snapshots.length - 1 && <p>MOCKED Evidence Bundle: <code>{manualSelected ? scenario.manualEvidenceHash : scenario.evidenceHash}</code>. This record reflects the displayed outcome and remains MOCKED.</p>}
      <details><summary>Artifact, Manifest and journal references</summary><p>Workflow {scenario.hashes.workflow} · source Manifest {scenario.sourceManifestHash} · simulation {scenario.hashes.simulation} · destination Manifest {scenario.hashes.manifest} · policy {scenario.hashes.policy} · execution plan {scenario.hashes.executionPlan} · journal entries through this stage {step.journalEntries}</p></details>
      <button type="button" className="quiet" onClick={() => { setScenario(null); setIndex(0); setError(null); setManualSelected(false); }}>Clear MOCKED rehearsal</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

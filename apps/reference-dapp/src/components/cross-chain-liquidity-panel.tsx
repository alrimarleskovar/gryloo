// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState } from 'react';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import { buildMockCrossChainLiquidityScenario, type MockCrossChainFailure } from '../app/cross-chain-liquidity-action';
import { setCrossChainCanvasRuntime, type CrossChainRuntimeStatus } from './workflow-canvas';
import { useWorkflow } from '../state/workflow-store';
type Scenario = Awaited<ReturnType<typeof buildMockCrossChainLiquidityScenario>>;
export function CrossChainLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
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
  return <section className="panel bridge-panel" role="region" aria-label={tr("Cross-chain liquidity composition")}>
    <p className="eyebrow">{tr("BUILD-011C · MOCKED COMPOSITION AND RECOVERY")}</p><h2>{tr("Base bridge → Arbitrum split → Uniswap v3 position")}</h2>
    <p>{tr("Deterministic engineering rehearsal with a synthetic route, pool price and observations. Each stage is computed through the canonical compiler, journal and reconciler. No signature, transaction, public-chain receipt or executable authorization is created.")}</p>
    {!scenario && <><label htmlFor="cross-chain-failure">{tr("Deterministic outcome")}</label>
      <select id="cross-chain-failure" value={failure} onChange={event => setFailure(event.target.value as MockCrossChainFailure)}>
        <option value="NONE">{tr("Successful composition")}</option>
        <option value="SWAP_REVERT">{tr("Destination swap reverts")}</option>
        <option value="MINT_REVERT">{tr("Liquidity mint reverts")}</option>
        <option value="MINT_UNKNOWN_CONFIRMED">{tr("Mint response unknown, position found")}</option>
        <option value="MINT_UNKNOWN_INCONCLUSIVE">{tr("Mint response unknown, inconclusive")}</option>
        <option value="POLICY_EXPIRED">{tr("Policy expires after bridge")}</option>
        <option value="LATE_BRIDGE_SETTLEMENT">{tr("Bridge arrives after expiry")}</option>
        <option value="ARTIFACT_STALE">{tr("Destination artifact stale")}</option>
      </select>
      <button type="button" onClick={generate} disabled={busy}>{tr(busy ? 'Computing MOCKED trace…' : 'Generate MOCKED chained simulation')}</button></>}
    {scenario && step && <>
      <p role="status">{tr("Stage: ")}<strong>{tr(step.stage)}</strong>{tr(" · current asset location: ")}{tr(step.location)}</p>
      <ul>
        <li>{tr("Source: ")}{tr(scenario.sourceUsdc)}{tr(" USDC on Base · provider ")}{tr(scenario.provider)}.</li>
        <li>{tr("Estimated bridge output: ")}{tr(scenario.estimatedBridgeUsdc)}{tr(" USDC · minimum ")}{tr(scenario.minimumBridgeUsdc)}{tr(" USDC.")}</li>
        <li>{tr("Reconciled destination output: ")}{tr(step.actual ? `${step.actual} USDC` : 'pending MOCKED destination balance read')}.</li>
        <li>{tr("Destination split: ")}{tr(step.swapInput ? `${step.swapInput} USDC selected for swap; ${step.liquidityUsdc} USDC kept for the position` : 'pending reconciliation')}.</li>
        <li>{tr("Pool: ")}{tr(scenario.pool)}{tr(" · 0.05% · ticks ")}{tr(scenario.tickLower)}{tr(" to ")}{tr(scenario.tickUpper)}.</li>
        <li>{tr("Independent destination ETH gas reserve: ")}{tr(scenario.destinationGasReserveEth)}{tr(" ETH · source gas ")}{tr(scenario.sourceGasEth)}{tr(" ETH · bridge fee ")}{tr(scenario.bridgeFeeUsdc)}{tr(" USDC.")}</li>
        <li>{tr("Destination swap gas ")}{tr(scenario.destinationSwapGasEth)}{tr(" ETH · pool swap fee ")}{tr(scenario.swapPoolFeeUsdc)}{tr(" USDC · liquidity gas ")}{tr(scenario.liquidityGasEth)}{tr(" ETH · mint protocol fee 0 · estimated spot swap output ")}{tr(scenario.estimatedSwapWeth)}{tr(" WETH.")}</li>
        {step.liquidityWeth && <li>{tr("Final mint inputs: ")}{tr(step.liquidityWeth)}{tr(" WETH + ")}{tr(step.liquidityUsdc)}{tr(" USDC.")}</li>}
        {step.lp && <li>{tr("Reconciled position NFT #")}{tr(step.lp)}{tr(" · residual ")}{tr(step.residualWeth)}{tr(" WETH + ")}{tr(step.residualUsdc)}{tr(" USDC · remaining allowances 0 / 0.")}</li>}
      </ul>
      {view === 'execute' && index < scenario.snapshots.length - 1 && <button type="button" disabled={Date.now() >= scenario.expiresAtMs}
        onClick={() => setIndex(value => value + 1)}>{tr(labels[index])}</button>}
      {index === scenario.snapshots.length - 1 && scenario.recovery && <section aria-label={tr("Cross-chain recovery")}>
        <h3>{tr("PARTIALLY COMPLETED")}</h3>
        <p>{tr("The bridge already settled. Local continuation is paused; no prior financial action was undone.")}</p>
        <h4>{tr(scenario.recovery.evidence === 'RECONCILED' ? 'Current assets' : 'Last independently confirmed assets')}</h4><p>{tr(scenario.recovery.balances.usdc)}{tr(" USDC and ")}{tr(scenario.recovery.balances.weth)}{tr(" WETH on Arbitrum · ")}{tr(step.location)}.</p>
        <h4>{tr("Completed steps")}</h4><p>{tr([...new Set(scenario.recovery.completed)].join(', '))}.</p>
        <h4>{tr("Failed step")}</h4><p>{tr(scenario.recovery.failedStep)}{tr(" · evidence ")}{tr(scenario.recovery.evidence)}.</p>
        <h4>{tr("Costs already incurred")}</h4><p>{tr("Source gas ")}{tr(scenario.recovery.sourceGasEth)}{tr(" ETH · bridge provider fee ")}{tr(scenario.recovery.bridgeProviderFeeUsdc)}{tr(" USDC · destination gas ")}{tr(scenario.recovery.destinationGasSpentEth)}{tr(" ETH.")}</p>
        <h4>{tr("Authority status")}</h4><p>{tr(scenario.recovery.authority)}{tr(" · expires ")}{tr(new Date(scenario.recovery.expiresAtMs).toISOString())}{tr(". Pausing local execution does not revoke allowances or delegated authority.")}</p>
        {scenario.requote && <><h4>{tr("Fresh requote preview")}</h4><p>{tr("New artifact set ")}{tr(scenario.requote.artifactSet)}{tr(" · simulation ")}{tr(scenario.requote.simulation)}{tr(" · policy ")}{tr(scenario.requote.policy)}{tr(" · Manifest ")}{tr(scenario.requote.manifest)}. {tr(scenario.requote.review)}{tr(". This preview cannot execute until separately reviewed and authorized.")}</p></>}
        <h4>{tr("Available recovery actions")}</h4><ul>{scenario.recovery.options.map(option => <li key={option.action}>{tr(option.action)}: {tr(option.status)} — {tr(option.reason)}</li>)}</ul>
        <h4>{tr("Manual intervention")}</h4><p>{tr("Execution ID ")}{scenario.recovery.executionId}{tr(". You may stop here and leave assets at the destination wallet. Use the evidence record and a new reviewed Manifest before any new financial action.")}</p>
        <button type="button" disabled={manualSelected} onClick={() => setManualSelected(true)}>{tr("Stop automatic continuation")}</button>
        {manualSelected && <p role="status">{tr("Manual intervention selected. Local execution paused; authority and allowances have not been revoked.")}</p>}
      </section>}
      {index === scenario.snapshots.length - 1 && <p>{tr("MOCKED Evidence Bundle: ")}<code>{tr(manualSelected ? scenario.manualEvidenceHash : scenario.evidenceHash)}</code>{tr(". This record reflects the displayed outcome and remains MOCKED.")}</p>}
      <details><summary>{tr("Artifact, Manifest and journal references")}</summary><p>{tr("Workflow ")}{tr(scenario.hashes.workflow)}{tr(" · source Manifest ")}{tr(scenario.sourceManifestHash)}{tr(" · simulation ")}{tr(scenario.hashes.simulation)}{tr(" · destination Manifest ")}{tr(scenario.hashes.manifest)}{tr(" · policy ")}{tr(scenario.hashes.policy)}{tr(" · execution plan ")}{tr(scenario.hashes.executionPlan)}{tr(" · journal entries through this stage ")}{tr(step.journalEntries)}</p></details>
      <button type="button" className="quiet" onClick={() => { setScenario(null); setIndex(0); setError(null); setManualSelected(false); }}>{tr("Clear MOCKED rehearsal")}</button>
    </>}
    {error && <p role="alert">{tr(error)}</p>}
  </section>;
}

// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState } from 'react';
import { validateCrossChainLiquidityWorkflow } from '@defi-workflow-engine/reference-linter';
import { buildMockCrossChainLiquidityScenario } from '../app/cross-chain-liquidity-action';
import { useWorkflow } from '../state/workflow-store';
type Scenario = Awaited<ReturnType<typeof buildMockCrossChainLiquidityScenario>>;
export function CrossChainLiquidityPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow();
  const [scenario, setScenario] = useState<Scenario | null>(null), [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { setScenario(null); setIndex(0); setError(null); }, [state.workflow]);
  const details = (() => { try { return validateCrossChainLiquidityWorkflow(state.workflow as unknown as Parameters<typeof validateCrossChainLiquidityWorkflow>[0]); } catch { return null; } })();
  if (!details) return null;
  const step = scenario?.snapshots[index];
  const labels = ['Submit MOCKED bridge', 'Reconcile MOCKED destination balance', 'Review actual amount and new Manifest',
    ...(details.noSwap ? [] : ['Reconcile MOCKED destination swap']), 'Submit MOCKED liquidity mint', 'Reconcile MOCKED LP position'];
  async function generate() {
    try { setBusy(true); setError(null);
      const result = await buildMockCrossChainLiquidityScenario(state.workflow as unknown as Parameters<typeof buildMockCrossChainLiquidityScenario>[0]);
      setScenario(result); setIndex(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'MOCKED_COMPOSITION_FAILED'); }
    finally { setBusy(false); }
  }
  return <section className="panel bridge-panel" role="region" aria-label="Cross-chain liquidity composition">
    <p className="eyebrow">BUILD-011C-1 · MOCKED COMPOSITION</p><h2>Base bridge → Arbitrum split → Uniswap v3 position</h2>
    <p>Deterministic engineering rehearsal with a synthetic route, pool price and observations. Each stage is computed through the canonical compiler, journal and reconciler. No signature, transaction, public-chain receipt or executable authorization is created.</p>
    {!scenario && <button type="button" onClick={generate} disabled={busy}>{busy ? 'Computing MOCKED trace…' : 'Generate MOCKED chained simulation'}</button>}
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
      {index === scenario.snapshots.length - 1 && <p>MOCKED Evidence Bundle: <code>{scenario.evidenceHash}</code>. The reconciled LP NFT and wallet residues complete this rehearsal.</p>}
      <details><summary>Artifact, Manifest and journal references</summary><p>Workflow {scenario.hashes.workflow} · source Manifest {scenario.sourceManifestHash} · simulation {scenario.hashes.simulation} · destination Manifest {scenario.hashes.manifest} · policy {scenario.hashes.policy} · execution plan {scenario.hashes.executionPlan} · journal entries through this stage {step.journalEntries}</p></details>
      <button type="button" className="quiet" onClick={() => { setScenario(null); setIndex(0); setError(null); }}>Clear MOCKED rehearsal</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

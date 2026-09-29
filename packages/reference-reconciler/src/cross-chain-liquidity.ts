// SPDX-License-Identifier: AGPL-3.0-only
/** Final evidence linking the shared IR and all reconciled cross-chain happy-path stages. */
import { ARBITRUM_LIQUIDITY, type compileCrossChainLiquidityArtifacts } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes, hashJournalBytes, hashRawBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
const enc = new TextEncoder();
const A = 'eip155:42161';
const usdc = { chainId: A, address: ARBITRUM_LIQUIDITY.usdc, decimals: 6 };
const weth = { chainId: A, address: ARBITRUM_LIQUIDITY.weth, decimals: 18 };
const nft = { chainId: A, address: ARBITRUM_LIQUIDITY.positionManager, decimals: 0 };
const destinationEth = { chainId: A, nativeId: 'ETH', decimals: 18 };
const quantity = (asset: typeof usdc | typeof weth | typeof nft | typeof destinationEth, amount: bigint) => ({ asset, amount: amount.toString() });
type Artifacts = ReturnType<typeof compileCrossChainLiquidityArtifacts>;
export type CrossChainFinalEvidence = { readonly workflowId: string; readonly owner: string;
  readonly stage: string; readonly sourceManifestHash: string; readonly destinationManifestHash: string | null;
  readonly executionPlanHash: string; readonly journal: ExecutionJournal;
  readonly observations: readonly { readonly step: string; readonly hash: string }[];
  readonly produced: readonly { readonly nodeId: string; readonly outputId: string; readonly amount: string; readonly observationHash: string }[];
  readonly final: null | { readonly tokenId: bigint; readonly depositedWeth: bigint; readonly depositedUsdc: bigint;
    readonly residualWeth: bigint; readonly residualUsdc: bigint; readonly remainingWethAllowance: bigint;
    readonly remainingUsdcAllowance: bigint; readonly liquidityGasEth: bigint } };
export function buildCrossChainLiquidityEvidence(artifacts: Artifacts, run: CrossChainFinalEvidence, observedAt: string) {
  const required = ['bridge-submission', 'destination-reconciliation', 'destination-preparation',
    ...(artifacts.preparation.swapRequired ? ['destination-swap'] : []), 'liquidity-submission', 'final-reconciliation'];
  const journal = validateArtifact('execution-journal', run.journal);
  const headHash = hashJournalBytes(enc.encode(JSON.stringify(journal))).at(-1);
  const final = run.final;
  if (!headHash || run.stage !== 'COMPLETED' || !final || run.destinationManifestHash !== artifacts.hashes.manifest ||
      run.executionPlanHash !== journal.executionPlanHash || run.sourceManifestHash !== journal.manifestHash ||
      run.journal.entries.filter(e => e.level === 'workflow').at(-1)?.toState !== 'COMPLETED' ||
      !required.every(step => run.observations.some(o => o.step === step && /^0x[0-9a-f]{64}$/.test(o.hash))) ||
      !run.produced.some(o => o.nodeId === 'build011c-bridge' && o.outputId === 'amount-out' &&
        o.amount === artifacts.preparation.actualBridgeUsdc.toString()) ||
      !run.produced.some(o => o.nodeId === 'build011c-mint' && o.outputId === 'position-nft' &&
        o.amount === final.tokenId.toString()) ||
      !run.produced.some(o => o.nodeId === 'build011c-mint' && o.outputId === 'residual-weth' && o.amount === final.residualWeth.toString()) ||
      !run.produced.some(o => o.nodeId === 'build011c-mint' && o.outputId === 'residual-usdc' && o.amount === final.residualUsdc.toString()) ||
      (artifacts.preparation.swapRequired && !run.produced.some(o => o.nodeId === 'build011c-swap' && o.outputId === 'amount-out')))
    throw new Error('CROSS_CHAIN_EVIDENCE_INCOMPLETE');
  const f = final;
  const bundle = validateArtifact('evidence-bundle', { schemaVersion: '1.0.0',
    evidenceBundleId: `${run.workflowId}.evidence`, version: 1, supersedes: null,
    semanticWorkflowHash: artifacts.hashes.workflow, artifactSetHash: artifacts.hashes.artifactSet,
    simulationHash: artifacts.hashes.simulation, policyHash: artifacts.hashes.policy,
    manifestHash: artifacts.hashes.manifest, executionPlanHash: run.executionPlanHash,
    journalHeadHash: headHash, observedAt, environment: 'MOCKED', outcome: 'RECONCILED',
    receipts: run.observations.map((o, index) => ({ receiptId: `stage-${index}-${o.step}`, contentHash: o.hash })),
    differences: [], reconciliation: {
      balances: [quantity(weth, f.residualWeth), quantity(usdc, f.residualUsdc)],
      allowances: [quantity(weth, f.remainingWethAllowance), quantity(usdc, f.remainingUsdcAllowance)], debt: [],
      positions: [quantity(nft, f.tokenId)], fees: [quantity(destinationEth, f.liquidityGasEth)],
      residualAssets: [quantity(weth, f.residualWeth), quantity(usdc, f.residualUsdc)],
      ownership: [{ chainId: A, address: run.owner }],
      limitations: ['MOCKED_FINANCIAL_EXECUTION', 'BRIDGE_AND_SWAP_GAS_ESTIMATES_NOT_OBSERVED',
        'NON_ATOMIC_CROSS_CHAIN_WORKFLOW', 'NO_PUBLIC_CHAIN_RECEIPTS'],
    },
    evidence: [{ evidenceId: 'semantic-workflow', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.workflow },
      { evidenceId: 'artifact-set', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.artifactSet },
      { evidenceId: 'simulation', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.simulation },
      { evidenceId: 'policy', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.policy },
      { evidenceId: 'source-manifest', kind: 'HASH_VECTOR', contentHash: run.sourceManifestHash },
      { evidenceId: 'destination-manifest', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.manifest },
      { evidenceId: 'destination-plan', kind: 'HASH_VECTOR', contentHash: artifacts.hashes.executionPlan },
      { evidenceId: 'journal', kind: 'JOURNAL_ENTRY', contentHash: headHash },
      ...run.produced.map((o, index) => ({ evidenceId: `output-${index}-${o.nodeId}-${o.outputId}`,
        kind: 'EXTERNAL_REFERENCE' as const, contentHash: o.observationHash })),
      { evidenceId: 'final-position', kind: 'HASH_VECTOR', contentHash: hashRawBytes('raw-response',
        enc.encode(JSON.stringify({ tokenId: f.tokenId.toString(), depositedWeth: f.depositedWeth.toString(),
          depositedUsdc: f.depositedUsdc.toString(), residualWeth: f.residualWeth.toString(),
          residualUsdc: f.residualUsdc.toString() }))) }],
  });
  return { bundle, hash: hashArtifactBytes('evidence-bundle', enc.encode(JSON.stringify(bundle))) };
}

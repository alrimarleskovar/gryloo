// SPDX-License-Identifier: AGPL-3.0-only
import { BRIDGE_DESTINATION, BRIDGE_DESTINATION_USDC, hashArtifactBytes, hashJournalBytes, hashRawBytes,
  type BridgeJournal, type ExecutionJournal, type EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import type { BridgeCompiled, BridgeRoute } from '@defi-workflow-engine/reference-compiler';
const enc = new TextEncoder();
export type BridgeObservation = {
  readonly source: { readonly chainId: 8453; readonly transactionHash: string; readonly status: 0 | 1 };
  readonly destination: { readonly chainId: 10; readonly transactionHash: string; readonly status: 0 | 1;
    readonly token: string; readonly recipient: string; readonly balanceBefore: string; readonly balanceAfter: string };
};
export function reconcileBridgeDestination(route: BridgeRoute, compiled: BridgeCompiled, sourceHash: string,
  destinationHash: string, observed: BridgeObservation): { readonly outcome: 'RECONCILED' | 'INCONCLUSIVE'; readonly code: string; readonly received: string } {
  if (observed.source.chainId !== 8453 || observed.destination.chainId !== 10
    || observed.source.transactionHash !== sourceHash || observed.destination.transactionHash !== destinationHash
    || observed.source.status !== 1 || observed.destination.status !== 1
    || observed.destination.token !== BRIDGE_DESTINATION_USDC || observed.destination.recipient !== route.owner
    || compiled.manifest.owner.address !== route.owner
    || !/^[0-9]+$/.test(observed.destination.balanceBefore) || !/^[0-9]+$/.test(observed.destination.balanceAfter))
    return { outcome: 'INCONCLUSIVE', code: 'BRIDGE_OBSERVATION_MISMATCH', received: '0' };
  const delta = BigInt(observed.destination.balanceAfter) - BigInt(observed.destination.balanceBefore);
  if (delta < BigInt(route.minimumOut) || delta > BigInt(route.expectedOut))
    return { outcome: 'INCONCLUSIVE', code: 'BRIDGE_OUTPUT_OUT_OF_BOUNDS', received: delta.toString() };
  return { outcome: 'RECONCILED', code: 'MOCKED_DESTINATION_MATCH', received: delta.toString() };
}
export function buildBridgeEvidence(compiled: BridgeCompiled, bridgeJournal: BridgeJournal, canonicalJournal: ExecutionJournal,
  observed: BridgeObservation, received: string): { readonly bundle: EvidenceBundle; readonly hash: string } {
  if (bridgeJournal.events.at(-1)?.state !== 'RECONCILED') throw new Error('BRIDGE_NOT_RECONCILED');
  const journalHeadHash = hashJournalBytes(enc.encode(JSON.stringify(canonicalJournal))).at(-1);
  if (!journalHeadHash) throw new Error('BRIDGE_JOURNAL_EMPTY');
  const outputAsset = { chainId: BRIDGE_DESTINATION, address: BRIDGE_DESTINATION_USDC, decimals: 6 };
  const bundle = validateArtifact('evidence-bundle', { schemaVersion: '1.0.0',
    evidenceBundleId: bridgeJournal.executionId + '.evidence', version: 1, supersedes: null,
    semanticWorkflowHash: compiled.hashes.workflow, artifactSetHash: compiled.hashes.artifactSet,
    simulationHash: compiled.hashes.simulation, policyHash: compiled.hashes.policy,
    manifestHash: compiled.hashes.manifest, executionPlanHash: compiled.hashes.plan, journalHeadHash,
    observedAt: new Date().toISOString(), environment: 'MOCKED', outcome: 'RECONCILED',
    receipts: [observed.source, observed.destination].map((receipt, index) => ({
      receiptId: index === 0 ? 'source-receipt' : 'destination-receipt',
      contentHash: hashRawBytes('raw-response', enc.encode(JSON.stringify(receipt))) })),
    differences: [], reconciliation: { balances: [{ asset: outputAsset, amount: received }],
      allowances: [], debt: [], positions: [], fees: compiled.quote.fees, residualAssets: [],
      ownership: [{ chainId: BRIDGE_DESTINATION, address: observed.destination.recipient }],
      limitations: ['MOCKED_FINANCIAL_EXECUTION', 'LIVE_LIFI_QUOTE_READ_ONLY', 'NO_PUBLIC_CHAIN_RECEIPTS'] },
    evidence: [{ evidenceId: 'bridge-route', kind: 'EXTERNAL_REFERENCE', contentHash: compiled.quote.rawResponseHash },
      { evidenceId: 'bridge-journal', kind: 'JOURNAL_ENTRY',
        contentHash: hashRawBytes('raw-response', enc.encode(JSON.stringify(bridgeJournal))) }] });
  return { bundle, hash: hashArtifactBytes('evidence-bundle', enc.encode(JSON.stringify(bundle))) };
}

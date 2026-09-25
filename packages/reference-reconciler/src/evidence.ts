// SPDX-License-Identifier: AGPL-3.0-only
import { hashRawBytes, hashArtifactBytes, type EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
export type EvidenceInput = {
  readonly evidenceBundleId: string; readonly version: number; readonly supersedes: string | null;
  readonly semanticWorkflowHash: string; readonly artifactSetHash: string; readonly simulationHash: string;
  readonly policyHash: string; readonly manifestHash: string; readonly executionPlanHash: string;
  readonly journalHeadHash: string; readonly observedAt: string;
  readonly outcome: EvidenceBundle['outcome'];
  readonly receipts: readonly { readonly transactionHash: string; readonly exactRawResponse: Uint8Array }[];
  readonly matrixHash: string; readonly signedRawDigests: readonly string[];
  readonly reconciliationTranscript: Uint8Array; readonly forkTranscriptHash: string;
  readonly differences: EvidenceBundle['differences']; readonly reconciliation: EvidenceBundle['reconciliation'];
};
export function buildEvidenceBundle(input: EvidenceInput): { readonly bundle: EvidenceBundle; readonly evidenceBundleHash: string } {
  if (!Number.isSafeInteger(input.version) || input.version < 1
    || (input.version === 1 && input.supersedes !== null)
    || (input.version > 1 && (input.supersedes === null || !/^0x[0-9a-f]{64}$/.test(input.supersedes)))) {
    throw new Error('EVIDENCE_VERSION_INVALID');
  }
  if (input.outcome === 'RECONCILED' && (input.receipts.length === 0
    || input.signedRawDigests.length !== input.receipts.length
    || input.differences.length !== 0 || input.reconciliation.ownership.length !== 1
    || !input.reconciliation.limitations.includes('FORK_REPRODUCED_NOT_MAINNET'))) {
    throw new Error('EVIDENCE_INCOMPLETE');
  }
  if (new Set(input.receipts.map(item => item.transactionHash)).size !== input.receipts.length) {
    throw new Error('EVIDENCE_DUPLICATE_RECEIPT');
  }
  const bundle = validateArtifact('evidence-bundle', {
    schemaVersion: '1.0.0', evidenceBundleId: input.evidenceBundleId, version: input.version,
    supersedes: input.supersedes, semanticWorkflowHash: input.semanticWorkflowHash,
    artifactSetHash: input.artifactSetHash, simulationHash: input.simulationHash,
    policyHash: input.policyHash, manifestHash: input.manifestHash,
    executionPlanHash: input.executionPlanHash, journalHeadHash: input.journalHeadHash,
    observedAt: input.observedAt, environment: 'FORK_REPRODUCED', outcome: input.outcome,
    receipts: input.receipts.map(item => ({ receiptId: item.transactionHash,
      contentHash: hashRawBytes('raw-response', item.exactRawResponse) })),
    differences: input.differences, reconciliation: input.reconciliation,
    evidence: [
      { evidenceId: 'enforcement-matrix', kind: 'EXTERNAL_REFERENCE', contentHash: input.matrixHash },
      ...input.signedRawDigests.map((digest, index) => ({ evidenceId: `signed-raw-${index + 1}`, kind: 'EXTERNAL_REFERENCE', contentHash: digest })),
      { evidenceId: 'reconciliation-transcript', kind: 'EXTERNAL_REFERENCE', contentHash: hashRawBytes('raw-response', input.reconciliationTranscript) },
      { evidenceId: 'fork-state-transcript', kind: 'EXTERNAL_REFERENCE', contentHash: input.forkTranscriptHash },
    ],
  });
  return { bundle, evidenceBundleHash: hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(bundle))) };
}

import { describe, expect, it } from 'vitest';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { buildEvidenceBundle, type EvidenceInput } from '../src/evidence.js';
const hash = '0x' + 'a'.repeat(64);
const base: EvidenceInput = { evidenceBundleId: 'evidence-1', version: 1, supersedes: null,
  semanticWorkflowHash: hash, artifactSetHash: hash, simulationHash: hash, policyHash: hash,
  manifestHash: hash, executionPlanHash: hash, journalHeadHash: hash,
  observedAt: '2026-09-24T18:00:00.000Z', outcome: 'RECONCILED',
  receipts: [{ transactionHash: hash, exactRawResponse: new TextEncoder().encode('{"status":"0x1"}') }],
  matrixHash: hash, signedRawDigests: [hash], reconciliationTranscript: new TextEncoder().encode('{}'),
  forkTranscriptHash: hash, differences: [],
  reconciliation: { balances: [], allowances: [], debt: [], positions: [], fees: [], residualAssets: [],
    ownership: [{ chainId: 'eip155:31337', address: '0x' + '1'.repeat(40) }], limitations: ['FORK_REPRODUCED_NOT_MAINNET'] } };
describe('frozen Evidence Bundle', () => {
  it('validates every hash link and supports append-only supersession', () => {
    const first = buildEvidenceBundle(base);
    expect(first.bundle.environment).toBe('FORK_REPRODUCED');
    expect(first.evidenceBundleHash).toBe(hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(first.bundle))));
    const second = buildEvidenceBundle({ ...base, evidenceBundleId: 'evidence-2', version: 2, supersedes: first.evidenceBundleHash });
    expect(second.bundle.supersedes).toBe(first.evidenceBundleHash);
    expect(second.evidenceBundleHash).not.toBe(first.evidenceBundleHash);
  });
  it('rejects a green outcome without a signed-raw digest for every receipt', () => {
    expect(() => buildEvidenceBundle({ ...base, signedRawDigests: [] })).toThrow('EVIDENCE_INCOMPLETE');
    expect(() => buildEvidenceBundle({ ...base, receipts: [] })).toThrow('EVIDENCE_INCOMPLETE');
    expect(() => buildEvidenceBundle({ ...base, reconciliation: { ...base.reconciliation, ownership: [] } })).toThrow('EVIDENCE_INCOMPLETE');
    expect(() => buildEvidenceBundle({ ...base, differences: [{ field: 'owner-output',
      expected: { asset: { chainId: 'eip155:31337', nativeId: 'ETH', decimals: 18 }, amount: '1' },
      observed: { asset: { chainId: 'eip155:31337', nativeId: 'ETH', decimals: 18 }, amount: '0' } }] })).toThrow('EVIDENCE_INCOMPLETE');
  });
  it('requires a valid append-only supersession link and unique receipt hashes', () => {
    expect(() => buildEvidenceBundle({ ...base, version: 2, supersedes: null })).toThrow('EVIDENCE_VERSION_INVALID');
    expect(() => buildEvidenceBundle({ ...base, version: 1, supersedes: hash })).toThrow('EVIDENCE_VERSION_INVALID');
    expect(() => buildEvidenceBundle({ ...base, receipts: [base.receipts[0]!, base.receipts[0]!],
      signedRawDigests: [hash, hash] })).toThrow('EVIDENCE_DUPLICATE_RECEIPT');
  });
});

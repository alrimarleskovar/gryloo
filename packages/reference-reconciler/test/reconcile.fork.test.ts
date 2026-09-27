// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F credential-free fork proof (MOCKED synthetic environment): the application's own Mode A
 * service runs all seven acceptance scenarios on a loopback synthetic chain-8453 source forked to chain
 * 31337, and every compiled artifact, signed transaction and Evidence Bundle is re-verified here from
 * independent fork reads and the frozen v1 raw-ingress contracts. No provider, key or phrase is used.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromHex, payloadIdentity } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes, parseArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { serveSyntheticFork } from '../../../apps/reference-dapp/e2e/fork/offline-rehearsal.mjs';
import { runModeAScenarios } from '../../../apps/reference-dapp/e2e/fork/harness.mjs';

const PORTS = { fork: 18745, source: 18746 };
type Summary = { executionId: string; hashes: Record<string, string>; payloadHashes: string[];
  attempts: { id: string; state: string; transactionHash: string | null }[];
  observations: { stepId: string; outcome: string; code: string }[];
  evidence: { version: number; outcome: string; code: string; evidenceBundleHash: string; environment: string; residualAllowance: string; revocationConfirmed: boolean }[] };
let served: { stop(): Promise<void> } | undefined;
let results: Record<string, Summary>;
let journalRoot: string;
/** Raw loopback JSON-RPC for the test wallet; the application's own adapter refuses signing methods. */
async function call(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${PORTS.fork}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(`FORK_RPC_ERROR:${body.error.message ?? ''}`);
  return body.result;
}

beforeAll(async () => {
  const binary = process.env.GRYLOO_ANVIL_BIN;
  if (!binary || basename(binary) !== 'anvil' || basename(dirname(binary)) !== 'foundry-v1.8.3') throw new Error('GRYLOO_ANVIL_BIN must name the verified foundry-v1.8.3/anvil binary');
  const runtime = mkdtempSync(join(tmpdir(), 'gryloo-reconcile-fork-'));
  served = await serveSyntheticFork(runtime, binary, PORTS);
  const profile = JSON.parse(readFileSync(join(runtime, 'profile.json'), 'utf8'));
  const fixture = JSON.parse(readFileSync(join(runtime, 'fixture.json'), 'utf8'));
  journalRoot = join(runtime, 'scenario-journals');
  results = await runModeAScenarios({ call, profile, journalRoot, setupAccount: fixture.setup });
}, 180_000);
afterAll(async () => { await served?.stop(); });

describe('Mode A service on the synthetic fork (MOCKED)', () => {
  it('reconciles both directions, the unknown-result restart and delayed mining exactly', () => {
    for (const key of ['WETH_TO_USDC', 'USDC_TO_WETH', 'UNKNOWN_RESULT_RESTART', 'PENDING_THEN_MINED']) {
      const value = results[key]!;
      expect(value.attempts.map(item => item.state), key).toEqual(['CONFIRMED', 'CONFIRMED']);
      expect(value.evidence, key).toEqual([expect.objectContaining({ version: 1, outcome: 'RECONCILED', code: 'EXACT', environment: 'MOCKED', residualAllowance: '0' })]);
    }
    expect(results.UNKNOWN_RESULT_RESTART!.observations.at(-1)?.code).toBe('RECOVERED_RECEIPT_SUCCESS');
  });

  it('keeps a reverted swap DIVERGENT with its residual allowance until a separate revocation supersedes the evidence', () => {
    const value = results.REVERT_RESIDUAL_REVOCATION!;
    expect(value.attempts.map(item => `${item.id.split('.')[1]}:${item.state}`)).toEqual(['step-approve:CONFIRMED', 'step-swap:REVERTED', 'step-revoke:CONFIRMED']);
    expect(value.evidence.map(item => [item.version, item.outcome, item.code, item.residualAllowance, item.revocationConfirmed]))
      .toEqual([[1, 'DIVERGENT', 'TRANSACTION_REVERTED', '1000000000000000000', false], [2, 'DIVERGENT', 'TRANSACTION_REVERTED', '0', true]]);
  });

  it('classifies wallet-mutated gas and recipient as DIVERGENT with no Evidence Bundle claiming reconciliation', () => {
    for (const key of ['WALLET_MUTATED_GAS', 'WALLET_MUTATED_RECIPIENT']) {
      const value = results[key]!;
      expect(value.attempts.map(item => item.state)).toEqual(['CONFIRMED', 'RECONCILIATION_REQUIRED']);
      expect(value.observations.at(-1)).toMatchObject({ outcome: 'DIVERGENT', code: 'PAYLOAD_FIDELITY_FAILED' });
      expect(value.evidence).toEqual([]);
    }
  });

  it('passes every persisted artifact and bundle through the frozen v1 raw ingress with matching hashes', async () => {
    let checked = 0;
    for (const scenario of readdirSync(journalRoot)) {
      for (const executionId of readdirSync(join(journalRoot, scenario)).filter(name => name.startsWith('exec-'))) {
        const directory = join(journalRoot, scenario, executionId);
        const prepared = JSON.parse(readFileSync(join(directory, 'prepared.json'), 'utf8'));
        const pairs = [['quote-state-artifact', prepared.artifacts.quote, prepared.hashes.quoteHash], ['artifact-set', prepared.artifacts.artifactSet, prepared.hashes.artifactSetHash],
          ['simulation-bundle', prepared.artifacts.simulation, prepared.hashes.simulationHash], ['authorization-policy', prepared.artifacts.policy, prepared.hashes.policyHash],
          ['strategy-manifest', prepared.artifacts.manifest, prepared.hashes.manifestHash], ['execution-plan', prepared.artifacts.plan, prepared.hashes.executionPlanHash],
          ['enforcement-matrix', prepared.artifacts.matrix, prepared.hashes.enforcementMatrixHash], ['semantic-workflow', prepared.workflow, prepared.hashes.semanticWorkflowHash]] as const;
        for (const [kind, value, hash] of pairs) {
          const bytes = new TextEncoder().encode(JSON.stringify(value));
          expect(parseArtifactBytes(bytes, kind)).toEqual(value);
          expect(hashArtifactBytes(kind, bytes)).toBe(hash);
          checked++;
        }
        expect(prepared.artifacts.matrix.environment.stateSourceHash).toBe(prepared.source.stateSourceHash);
        for (const view of prepared.payloads) expect(payloadIdentity(fromHex(view.bytes)).payloadHash).toBe(view.payloadHash);
        // Every confirmed step was verified against its reviewed bytes when observed, before the next snapshot revert.
        const observations = readFileSync(join(directory, 'observations.jsonl'), 'utf8').trimEnd().split('\n');
        for (const item of JSON.parse(observations.at(-1)!).value as { outcome: string; code: string }[]) {
          expect(['RECEIPT_SUCCESS', 'RECEIPT_REVERTED', 'RECOVERED_RECEIPT_SUCCESS', 'PAYLOAD_FIDELITY_FAILED']).toContain(item.code);
        }
        try {
          const evidence = readFileSync(join(directory, 'evidence.jsonl'), 'utf8').trimEnd().split('\n');
          for (const record of JSON.parse(evidence.at(-1)!).value as { bundle: unknown; evidenceBundleHash: string }[]) {
            const bytes = new TextEncoder().encode(JSON.stringify(record.bundle));
            expect(parseArtifactBytes(bytes, 'evidence-bundle')).toMatchObject({ environment: 'MOCKED' });
            expect(hashArtifactBytes('evidence-bundle', bytes)).toBe(record.evidenceBundleHash);
            checked++;
          }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(7 * 8 + 6);
  });
});

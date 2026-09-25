import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateArtifact, artifactSchemas, type ArtifactKind } from '../src/schemas.js';
import { parseArtifactBytes } from '../src/raw-json.js';
import { hashArtifactBytes, hashJournalBytes } from '../src/index.js';
import { hashArtifactValue } from '../src/canonical.js';

const dir = new URL('../../../tests/compatibility/v1/', import.meta.url);
const kinds = [
  'semantic-workflow', 'artifact-set', 'simulation-bundle',
  'authorization-policy', 'strategy-manifest', 'execution-plan',
  'execution-journal', 'evidence-bundle',
] as const;
const fixtureBytes = (kind: string) => readFileSync(new URL(kind + '.json', dir));
const fixture = (kind: string): Record<string, unknown> =>
  JSON.parse(fixtureBytes(kind).toString('utf8')) as Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);

describe('v1 artifact contracts at serialized ingress', () => {
  it.each(kinds)('validates the frozen %s fixture through raw ingress and Ajv', kind => {
    const bytes = fixtureBytes(kind);
    const parsed = parseArtifactBytes(bytes, kind);
    expect(parsed).toEqual(fixture(kind));
    expect(validateArtifact(kind, parsed)).toEqual(parsed);
    expect(artifactSchemas[kind].$id).toContain('/v1/' + kind);
    if (kind === 'execution-journal') {
      expect(hashJournalBytes(bytes)).toHaveLength(4);
    } else {
      expect(hashArtifactBytes(kind, bytes)).toBe(hashArtifactValue(kind, parsed));
    }
  });

  it('binds each downstream artifact to the expected predecessor hashes', () => {
    const hash = (kind: Exclude<ArtifactKind, 'execution-journal'>) =>
      hashArtifactBytes(kind, fixtureBytes(kind));
    const w = hash('semantic-workflow');
    const a = hash('artifact-set');
    const s = hash('simulation-bundle');
    const p = hash('authorization-policy');
    const m = hash('strategy-manifest');
    const x = hash('execution-plan');
    expect(fixture('artifact-set').semanticWorkflowHash).toBe(w);
    expect(fixture('simulation-bundle')).toMatchObject({
      semanticWorkflowHash: w, artifactSetHash: a,
    });
    expect(fixture('authorization-policy')).toMatchObject({
      semanticWorkflowHash: w, artifactSetHash: a, simulationHash: s,
    });
    expect(fixture('strategy-manifest')).toMatchObject({
      semanticWorkflowHash: w, artifactSetHash: a, simulationHash: s, policyHash: p,
      authorizationMode: 'NONE', enforcement: 'NOT_ENFORCED',
    });
    expect(fixture('execution-plan')).toMatchObject({
      semanticWorkflowHash: w, manifestHash: m, enforcement: 'NOT_ENFORCED',
    });
    const journal = fixture('execution-journal');
    expect(journal).toMatchObject({ executionPlanHash: x, manifestHash: m });
    const head = hashJournalBytes(fixtureBytes('execution-journal')).at(-1);
    expect(fixture('evidence-bundle')).toMatchObject({
      semanticWorkflowHash: w, artifactSetHash: a, simulationHash: s,
      policyHash: p, manifestHash: m, executionPlanHash: x, journalHeadHash: head,
      environment: 'MOCKED', outcome: 'CONFIRMED_NOT_RECONCILED',
    });
  });

  it.each(kinds)('rejects unknown runtime or executable fields in %s', kind => {
    const value = fixture(kind);
    value.runtimeSignature = 'unapproved';
    expect(() => validateArtifact(kind, value)).toThrow('additional properties');
  });

  it.each(kinds)('rejects unknown schema version and a missing required link in %s', kind => {
    const value = fixture(kind);
    value.schemaVersion = '2.0.0';
    expect(() => validateArtifact(kind, value)).toThrow();
    const missing = fixture(kind);
    delete missing.schemaVersion;
    expect(() => validateArtifact(kind, missing)).toThrow();
  });

  it('rejects money as a floating JSON number, unsafe numbers, and malformed hashes', () => {
    const policy = fixture('authorization-policy');
    policy.nonce = 1.5;
    expect(() => validateArtifact('authorization-policy', policy)).toThrow();
    const workflow = fixture('semantic-workflow');
    workflow.revision = Number.MAX_SAFE_INTEGER + 1;
    expect(() => validateArtifact('semantic-workflow', workflow)).toThrow();
    const set = fixture('artifact-set');
    set.semanticWorkflowHash = '0xABC';
    expect(() => validateArtifact('artifact-set', set)).toThrow();
  });

  it('accepts native-unit string quantities and rejects numeric, noncanonical, and overflowing money', () => {
    const asset = { chainId: 'eip155:1', nativeId: 'ETH', decimals: 18 };
    const workflow = fixture('semantic-workflow');
    const nodes = workflow.nodes as Array<Record<string, unknown>>;
    const quantity = { name: 'amount', kind: 'QUANTITY', value: { asset, amount: '1000000000000000000' } };
    nodes[0]!.inputs = [quantity];
    expect(() => validateArtifact('semantic-workflow', workflow)).not.toThrow();
    for (const amount of [1.5, 1, '01', '-1', '1.5', (2n ** 256n).toString()]) {
      const invalid = clone(workflow);
      const inputs = (invalid.nodes as Array<Record<string, unknown>>)[0]!.inputs as Array<{ value: { amount: unknown } }>;
      inputs[0]!.value.amount = amount;
      expect(() => validateArtifact('semantic-workflow', invalid)).toThrow();
    }
    const boundary = clone(workflow);
    const inputs = (boundary.nodes as Array<Record<string, unknown>>)[0]!.inputs as Array<{ value: { amount: string } }>;
    inputs[0]!.value.amount = (2n ** 256n - 1n).toString();
    expect(() => validateArtifact('semantic-workflow', boundary)).not.toThrow();
    expect(hashArtifactValue('semantic-workflow', boundary)).not.toBe(hashArtifactValue('semantic-workflow', workflow));
  });

  it('rejects inconsistent decimals for the same asset and unsafe spend bounds', () => {
    const policy = fixture('authorization-policy');
    const asset = { chainId: 'eip155:1', nativeId: 'ETH', decimals: 18 };
    policy.spendLimits = [{ asset, maximumAmount: '10', maximumPerStepAmount: '11', maximumCumulativeAmount: '20' }];
    expect(() => validateArtifact('authorization-policy', policy)).toThrow('spend limits');
    policy.spendLimits = [{ asset, maximumAmount: '10', maximumPerStepAmount: '5', maximumCumulativeAmount: '20' }];
    policy.gasBudgets = [{ asset: { ...asset, decimals: 6 }, maximumAmount: '1' }];
    expect(() => validateArtifact('authorization-policy', policy)).toThrow('decimals');
  });

  it('rejects semantic cycles and conflicting artifact-set identities', () => {
    const workflow = fixture('semantic-workflow');
    const nodes = workflow.nodes as Array<Record<string, unknown>>;
    nodes[0]!.dependencies = [nodes[0]!.nodeId];
    expect(() => validateArtifact('semantic-workflow', workflow)).toThrow('cycle');
    const set = fixture('artifact-set');
    const artifacts = set.artifacts as Array<Record<string, unknown>>;
    artifacts.push(clone(artifacts[0]!));
    expect(() => validateArtifact('artifact-set', set)).toThrow('duplicate');
  });

  it('rejects inconsistent evidence supersession and journal ordering', () => {
    const evidence = fixture('evidence-bundle');
    evidence.version = 2;
    expect(() => validateArtifact('evidence-bundle', evidence)).toThrow('supersession');
    const journal = fixture('execution-journal');
    const entries = journal.entries as Array<Record<string, unknown>>;
    entries[1]!.sequence = 7;
    expect(() => validateArtifact('execution-journal', journal)).toThrow('sequence');
  });

  it('publishes only the approved ESM package surfaces', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      name: '@defi-workflow-engine/workflow-contracts', version: '0.2.0',
      private: true, type: 'module', license: 'Apache-2.0',
    });
    expect(Object.keys(manifest.exports as object).sort()).toEqual([
      '.', './package.json', './schemas', './schemas/v1/*.schema.json',
    ].sort());
    const publicModule = await import('@defi-workflow-engine/workflow-contracts');
    expect(publicModule.hashArtifactBytes).toBeTypeOf('function');
    expect(publicModule.parseArtifactBytes).toBeTypeOf('function');
    expect('canonicalJson' in publicModule).toBe(false);
  });
});

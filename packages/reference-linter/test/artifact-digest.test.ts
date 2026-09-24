// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashArtifactBytes, hashRawBytes } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { DIGEST_FIELDS, digestArtifact, digestRawResponse, digestSelfCheck, type DigestKind } from '../src/artifact-digest.js';
import { createReviewContext } from '../src/index.js';
import { editorReducer, initialEditor, type EditorState } from '../../../apps/reference-dapp/src/domain/editor';
import type { Command } from '../../../apps/reference-dapp/src/domain/commands';

type Vector = { domain: string; value?: unknown; rawHex?: string; digest: string };
const repo = (path: string) => new URL('../../../' + path, import.meta.url);
const vectors = (JSON.parse(readFileSync(repo('tests/compatibility/v1/hash-vectors.json'), 'utf8')) as { vectors: Vector[] }).vectors;
const kinds: DigestKind[] = ['semantic-workflow', 'quote-state-artifact', 'artifact-set', 'simulation-bundle'];
const schema = (kind: DigestKind) => JSON.parse(readFileSync(repo(`packages/workflow-contracts/schemas/v1/${kind}.schema.json`), 'utf8')) as { properties: Record<string, unknown> };
const base = (kind: DigestKind) => structuredClone(vectors.find(vector => vector.domain === kind)!.value) as Record<string, unknown>;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });

function apply(state: EditorState, ...commands: ((revision: number) => Command)[]): EditorState {
  for (const make of commands) {
    const next = editorReducer(state, make(state.workflow.revision), context);
    if (next.error) throw new Error(next.error);
    state = next;
  }
  return state;
}
const swap = (direction: 'USDC_TO_WETH' | 'WETH_TO_USDC', amount: string, slippage: string) => (baseRevision: number): Command =>
  ({ type: 'ADD_SWAP', direction, amount, slippage, source: 'CHAT', baseRevision });

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser-safe digest equivalence (R-4)', () => {
  it('reproduces every relevant frozen v1 vector', async () => {
    let checked = 0;
    for (const vector of vectors) {
      if ((kinds as string[]).includes(vector.domain)) {
        expect(await digestArtifact(vector.domain as DigestKind, vector.value)).toBe(vector.digest);
        checked += 1;
      }
      if (vector.domain === 'raw-response') {
        expect(await digestRawResponse(new Uint8Array(Buffer.from(vector.rawHex!, 'hex')))).toBe(vector.digest);
        checked += 1;
      }
    }
    expect(checked).toBe(5);
  });

  it('equals the frozen hash for authored workflows in both directions, locks and several swaps', async () => {
    const start = initialEditor();
    const workflows = [
      start,
      apply(start, swap('USDC_TO_WETH', '2.25', '50')),
      apply(start, swap('WETH_TO_USDC', '0.125', '0')),
      apply(start, swap('USDC_TO_WETH', '1000000', '300'), revision => ({ type: 'LOCK', nodeId: 'node-002', locked: true, source: 'CANVAS', baseRevision: revision })),
      apply(start, swap('USDC_TO_WETH', '1', '1'), swap('WETH_TO_USDC', '0.000000001', '100'), revision => ({ type: 'ADD', kind: 'transform', source: 'CANVAS', baseRevision: revision })),
    ].map(state => state.workflow);
    for (const workflow of workflows) {
      expect(await digestArtifact('semantic-workflow', workflow)).toBe(hashArtifactBytes('semantic-workflow', bytes(workflow)));
    }
  });

  it('projects exactly the frozen schema properties for every kind', () => {
    for (const kind of kinds) expect([...DIGEST_FIELDS[kind]].sort()).toEqual(Object.keys(schema(kind).properties).sort());
  });

  it('never accepts a serialized input that the frozen implementation rejects', async () => {
    const asset = { chainId: 'eip155:1', address: '0xabc', decimals: 6 };
    const idField: Record<DigestKind, string> = { 'semantic-workflow': 'workflowId', 'quote-state-artifact': 'artifactId', 'artifact-set': 'artifactSetId', 'simulation-bundle': 'simulationId' };
    const nested = (depth: number): unknown => depth === 0 ? 0 : [nested(depth - 1)];
    const cases: [DigestKind, string, unknown][] = [];
    for (const kind of kinds) {
      for (const root of [[], null, 'text', 1, true]) cases.push([kind, `root ${JSON.stringify(root)}`, root]);
      for (const field of DIGEST_FIELDS[kind]) {
        const missing = base(kind);
        delete missing[field];
        cases.push([kind, `missing ${field}`, missing]);
      }
      cases.push([kind, 'unknown field', { ...base(kind), extra: 1 }]);
      cases.push([kind, 'mistyped schemaVersion', { ...base(kind), schemaVersion: 1 }]);
      cases.push([kind, 'over-length identifier', { ...base(kind), [idField[kind]]: 'a'.repeat(129) }]);
      cases.push([kind, 'lone surrogate', { ...base(kind), [idField[kind]]: 'a\uD800' }]);
      cases.push([kind, 'depth above 64', { ...base(kind), extra: nested(70) }]);
      cases.push([kind, 'more than 1 MiB', { ...base(kind), extra: 'x'.repeat(1_100_000) }]);
    }
    const workflow = base('semantic-workflow');
    for (const revision of [1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY, -1]) cases.push(['semantic-workflow', `revision ${revision}`, { ...workflow, revision }]);
    const node = (workflow.nodes as Record<string, unknown>[])[0]!;
    cases.push(['semantic-workflow', 'duplicate node IDs', { ...workflow, nodes: [node, node] }]);
    cases.push(['semantic-workflow', 'broken edge reference', { ...workflow, resourceEdges: [{ fromNodeId: 'node-001', outputId: 'x', toNodeId: 'node-404', inputName: 'y' }] }]);
    cases.push(['semantic-workflow', 'dependency on unknown node', { ...workflow, nodes: [{ ...node, dependencies: ['node-404'] }] }]);
    cases.push(['semantic-workflow', 'dependency cycle', { ...workflow, nodes: [{ ...node, dependencies: ['node-001'] }] }]);
    const quote = base('quote-state-artifact');
    cases.push(['quote-state-artifact', 'invalid calendar timestamp', { ...quote, retrievedAt: '2026-02-30T00:00:00.000Z' }]);
    cases.push(['quote-state-artifact', 'non-canonical timestamp', { ...quote, retrievedAt: '2026-09-22T00:00:00Z' }]);
    cases.push(['quote-state-artifact', 'non-integer height', { ...quote, chainPosition: { kind: 'BLOCK', height: 1.5 } }]);
    cases.push(['quote-state-artifact', 'uint256 overflow', { ...quote, fees: [{ asset, amount: ((1n << 256n)).toString() }] }]);
    cases.push(['quote-state-artifact', 'inconsistent decimals', { ...quote, fees: [{ asset, amount: '1' }, { asset: { ...asset, decimals: 18 }, amount: '1' }] }]);
    const set = base('artifact-set');
    const entry = (set.artifacts as unknown[])[0];
    cases.push(['artifact-set', 'duplicate artifact IDs', { ...set, artifacts: [entry, { ...(entry as object), artifactHash: '0x' + '1'.repeat(64) }] }]);
    const simulation = base('simulation-bundle');
    cases.push(['simulation-bundle', 'observedAt after expiresAt', { ...simulation, freshness: { observedAt: '2026-09-22T00:00:01.000Z', expiresAt: '2026-09-22T00:00:00.000Z', maximumAgeSeconds: 0 } }]);
    cases.push(['simulation-bundle', 'non-integer revision', { ...simulation, semanticWorkflowRevision: 0.5 }]);
    for (const [kind, label, value] of cases) {
      expect(() => hashArtifactBytes(kind, bytes(value)), `frozen ${kind} ${label}`).toThrow();
      await expect(digestArtifact(kind, value), `browser ${kind} ${label}`).rejects.toThrow();
    }
    expect(cases.length).toBeGreaterThan(90);
  });

  it('rejects object-only malformations that JSON bytes cannot express', async () => {
    const cyclic = base('semantic-workflow'); cyclic.extra = cyclic;
    const accessor = base('semantic-workflow'); Object.defineProperty(accessor, 'workflowId', { get: () => 'workflow-001', enumerable: true });
    class Workflow { schemaVersion = '1.0.0'; }
    const sparse = base('semantic-workflow'); sparse.resourceEdges = new Array(1);
    const symbol = base('semantic-workflow'); (symbol as Record<symbol, unknown>)[Symbol('x')] = 1;
    const nullPrototype = Object.assign(Object.create(null), base('semantic-workflow'));
    for (const value of [cyclic, accessor, new Workflow(), sparse, symbol, nullPrototype, undefined, () => 0, 1n]) {
      await expect(digestArtifact('semantic-workflow', value)).rejects.toThrow();
    }
  });

  it('bounds raw-response input exactly like the frozen implementation', async () => {
    for (const size of [0, 1, 1_048_576]) {
      const data = new Uint8Array(size).fill(7);
      expect(await digestRawResponse(data)).toBe(hashRawBytes('raw-response', data));
    }
    const oversized = new Uint8Array(1_048_577);
    expect(() => hashRawBytes('raw-response', oversized)).toThrow();
    await expect(digestRawResponse(oversized)).rejects.toThrow('INPUT_SIZE');
    for (const value of [new ArrayBuffer(4), 'text', [1, 2]]) await expect(digestRawResponse(value as never)).rejects.toThrow();
  });

  it('has no payload, intent or authority domains', async () => {
    for (const kind of ['payload', 'intent', 'raw-response', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'execution-journal', 'execution-journal-entry', 'evidence-bundle']) {
      await expect(digestArtifact(kind as DigestKind, {})).rejects.toThrow('UNSUPPORTED_DIGEST_KIND');
    }
  });

  it('does not mutate frozen input', async () => {
    const value = base('semantic-workflow');
    const frozen = JSON.parse(JSON.stringify(value), (_key, item) => (item && typeof item === 'object' ? Object.freeze(item) : item));
    expect(await digestArtifact('semantic-workflow', frozen)).toBe(hashArtifactBytes('semantic-workflow', bytes(value)));
  });
});

describe('digest self-check (R-3)', () => {
  it('passes with the platform digest and is re-run on every call', async () => {
    await expect(digestSelfCheck()).resolves.toBeUndefined();
    vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } });
    await expect(digestSelfCheck()).rejects.toThrow('DIGEST_UNAVAILABLE');
    vi.unstubAllGlobals();
    await expect(digestSelfCheck()).resolves.toBeUndefined();
  });

  it('fails closed when the digest is missing, throws or returns the wrong length', async () => {
    for (const replacement of [{}, { subtle: {} }, { subtle: { digest: async () => { throw new Error('boom'); } } }, { subtle: { digest: async () => new ArrayBuffer(31) } }]) {
      vi.stubGlobal('crypto', replacement);
      await expect(digestSelfCheck()).rejects.toThrow('DIGEST_UNAVAILABLE');
      vi.unstubAllGlobals();
    }
  });
});

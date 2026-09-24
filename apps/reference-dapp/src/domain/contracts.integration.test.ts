// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertTransition, invalidationFor, parseArtifactBytes, hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { parseActionRegistryBytes, baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import * as linter from '@defi-workflow-engine/reference-linter';
import { createReviewContext, lintWorkflow } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { mockActions } from './mock-actions';
import { parseLocalCommand, parseMockCommand } from './commands';
import { generateMockedChain } from './mock-artifacts';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('BUILD-001 contract integration', () => {
  it('validates and hashes the same immutable workflow before and after a mock edit', () => {
    const initial = initialEditor();
    const changed = editorReducer(initial, parseMockCommand('add read', 0));
    for (const state of [initial, changed]) {
      expect(parseArtifactBytes(bytes(state.workflow), 'semantic-workflow')).toEqual(state.workflow);
    }
    expect(hashArtifactBytes('semantic-workflow', bytes(initial.workflow)))
      .not.toBe(hashArtifactBytes('semantic-workflow', bytes(changed.workflow)));
    expect(initial.workflow.revision).toBe(0);
  });

  it('round-trips authored swaps through frozen raw ingress and hashes only semantic edits', () => {
    const context = createReviewContext({ registryId: referenceRegistry.registryId,
      capabilityId: referenceRegistry.capabilities[0]?.id,
      actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
    const start = initialEditor();
    const added = editorReducer(start,
      parseLocalCommand('swap 2 USDC to WETH on Base slippage 50 bps', start.workflow, context), context);
    expect(added.error).toBeNull();
    expect(parseArtifactBytes(bytes(added.workflow), 'semantic-workflow')).toEqual(added.workflow);
    const initialHash = hashArtifactBytes('semantic-workflow', bytes(start.workflow));
    const addedHash = hashArtifactBytes('semantic-workflow', bytes(added.workflow));
    expect(addedHash).not.toBe(initialHash);
    const review = lintWorkflow(added.workflow, context);
    expect(review.revision).toBe(added.workflow.revision);
    expect(review.executable).toBe(false);
    expect(hashArtifactBytes('semantic-workflow', bytes(added.workflow))).toBe(addedHash);
    const changed = editorReducer(added, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002',
      amount: '3', source: 'CHAT', baseRevision: 1 }, context);
    expect(changed.error).toBeNull();
    expect(parseArtifactBytes(bytes(changed.workflow), 'semantic-workflow')).toEqual(changed.workflow);
    expect(hashArtifactBytes('semantic-workflow', bytes(changed.workflow))).not.toBe(addedHash);
    const noOp = editorReducer(changed, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002',
      amount: '3', source: 'CHAT', baseRevision: 2 }, context);
    expect(noOp.workflow).toBe(changed.workflow);
    const stale = editorReducer(changed, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002',
      amount: '4', source: 'CHAT', baseRevision: 1 }, context);
    expect(stale.workflow).toBe(changed.workflow);
    expect(hashArtifactBytes('semantic-workflow', bytes(stale.workflow))).toBe(hashArtifactBytes('semantic-workflow', bytes(changed.workflow)));
  });

  it('accepts local action declarations with no execution kind or authorization mode', () => {
    const registry = parseActionRegistryBytes(bytes({
      schemaVersion: '1.0.0', registryId: 'mock-local', registryVersion: '1.0.0',
      capabilities: [{ id: 'mock-authoring', version: '1.0.0', status: 'DECLARED_ONLY',
        enforcement: 'NOT_ENFORCED', executionKinds: [], authorizationModes: [] }],
      actions: mockActions,
    }));
    expect(registry.actions).toHaveLength(3);
    expect(registry.actions.every((action) => action.executionKinds.length === 0 && action.authorizationModes.length === 0)).toBe(true);
  });
});

describe('BUILD-003B mocked chain against the frozen contracts', () => {
  const context = createReviewContext({ registryId: referenceRegistry.registryId,
    capabilityId: referenceRegistry.capabilities[0]?.id,
    actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
  const NOW = Date.parse('2026-09-24T12:00:10.000Z');
  const authored = editorReducer(initialEditor(), parseLocalCommand('swap 2.25 USDC to WETH on Base slippage 50 bps', initialEditor().workflow, context), context).workflow;

  it('parses every generated artifact through frozen raw ingress and matches every recomputed hash', async () => {
    for (const workflow of [authored, editorReducer({ workflow: authored, error: null }, parseLocalCommand('swap 0.125 WETH to USDC on Base slippage 0 bps', authored, context), context).workflow]) {
      const { chain, review } = await generateMockedChain(workflow, context, { nowMs: NOW, generation: 1 });
      expect(review.semanticWorkflowHash).toBe(hashArtifactBytes('semantic-workflow', bytes(workflow)));
      for (const quote of chain.quotes) {
        expect(parseArtifactBytes(bytes(quote), 'quote-state-artifact')).toEqual(quote);
        expect(review.quoteHashes[quote.nodeId]).toBe(hashArtifactBytes('quote-state-artifact', bytes(quote)));
        expect(quote.semanticWorkflowHash).toBe(review.semanticWorkflowHash);
      }
      expect(parseArtifactBytes(bytes(chain.artifactSet), 'artifact-set')).toEqual(chain.artifactSet);
      expect(review.artifactSetHash).toBe(hashArtifactBytes('artifact-set', bytes(chain.artifactSet)));
      expect(parseArtifactBytes(bytes(chain.simulation), 'simulation-bundle')).toEqual(chain.simulation);
      expect(review.simulationHash).toBe(hashArtifactBytes('simulation-bundle', bytes(chain.simulation)));
      expect(chain.simulation.artifactSetHash).toBe(review.artifactSetHash);
    }
  });

  it('keeps the IR hash on refresh and changes every hash on a semantic edit', async () => {
    const first = await generateMockedChain(authored, context, { nowMs: NOW, generation: 1 });
    const refreshed = await generateMockedChain(authored, context, { nowMs: NOW + 5_000, generation: 2 });
    expect(refreshed.review.semanticWorkflowHash).toBe(first.review.semanticWorkflowHash);
    expect(refreshed.review.quoteHashes['node-002']).not.toBe(first.review.quoteHashes['node-002']);
    expect(refreshed.review.artifactSetHash).not.toBe(first.review.artifactSetHash);
    expect(refreshed.review.simulationHash).not.toBe(first.review.simulationHash);
    const changed = editorReducer({ workflow: authored, error: null }, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002', amount: '3', source: 'CANVAS', baseRevision: 1 }, context).workflow;
    const edited = await generateMockedChain(changed, context, { nowMs: NOW, generation: 1 });
    for (const key of ['semanticWorkflowHash', 'artifactSetHash', 'simulationHash'] as const) expect(edited.review[key]).not.toBe(first.review[key]);
  });

  it('relies on the frozen invalidation matrix and state table to keep mocked artifacts non-authorizing', () => {
    expect(invalidationFor('SEMANTIC_EDIT')).toEqual(expect.arrayContaining(['quote-state-artifact', 'artifact-set', 'simulation-bundle', 'authorization']));
    expect(invalidationFor('QUOTE_REFRESH')).not.toContain('quote-state-artifact');
    expect(() => assertTransition('workflow', 'DRAFT', 'AUTHORIZED')).toThrow('Invalid state transition');
    expect(() => assertTransition('workflow', 'DRAFT', 'SIMULATED')).toThrow('Invalid state transition');
  });

  it('exposes the approved private linter identity and additive root exports', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../packages/reference-linter/package.json', import.meta.url), 'utf8'));
    expect(manifest).toMatchObject({ name: '@defi-workflow-engine/reference-linter', version: '0.1.0', private: true, license: 'AGPL-3.0-only' });
    expect(Object.keys(manifest.exports)).toEqual(['.', './package.json']);
    for (const name of ['lintWorkflow', 'validateAuthoringWorkflow', 'createReviewContext', 'digestArtifact', 'digestRawResponse', 'digestSelfCheck', 'reviewMockedArtifactChain', 'mockedSwapOutputs', 'mockedFixtureBytes',
      'collectBaseTranscript', 'deriveBaseObservation', 'reviewBaseObservation']) {
      expect(typeof (linter as Record<string, unknown>)[name]).toBe('function');
    }
    expect(Object.isFrozen(linter.MOCKED_CHAIN_PROFILE)).toBe(true);
    expect(Object.isFrozen(linter.BASE_OBSERVATION_PROFILE)).toBe(true);
    expect(linter.BASE_OBSERVATION_PROFILE.methods).toEqual(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
  });
});

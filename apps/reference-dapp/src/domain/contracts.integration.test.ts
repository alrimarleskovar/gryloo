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

describe('BUILD-003F Mode A fork artifacts against the frozen contracts', () => {
  it('compiles a UI-authored swap into frozen v1 policy, Manifest, plan and matrix artifacts bound to exact payloads', async () => {
    const compiler = await import('@defi-workflow-engine/reference-compiler');
    const { modeASwapFromWorkflow, walletRequestFor } = await import('../server/mode-a-service');
    const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
      actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
    const start = initialEditor();
    const authored = editorReducer(start, parseLocalCommand('swap 1 WETH to USDC on Base slippage 100 bps', start.workflow, context), context);
    expect(authored.error).toBeNull();
    const swap = modeASwapFromWorkflow(authored.workflow as never);
    expect(swap).toMatchObject({ direction: 'WETH_TO_USDC', amountIn: 10n ** 18n, slippageBps: 100, excludedMockNodes: ['node-001'] });
    const owner = '0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b';
    const semanticWorkflowHash = hashArtifactBytes('semantic-workflow', bytes(authored.workflow));
    const quotedOut = 2_486_306_666n, minimumOut = quotedOut * 9_900n / 10_000n;
    const pair = compiler.buildModeAPair({ owner, tokenIn: compiler.FORK_CONTRACTS.weth, tokenOut: compiler.FORK_CONTRACTS.usdc, amountIn: swap.amountIn,
      amountOutMinimum: minimumOut, fee: 3000, deadline: 1_790_000_266n, nonce: 0n, approveGasLimit: 57_294n, swapGasLimit: 69_364n, maxFeePerGas: 1_796_246_614n });
    const compileContext = { nodeId: swap.nodeId, revision: authored.workflow.revision, forkBlock: 28, semanticWorkflowHash,
      artifactSetHash: `0x${'aa'.repeat(32)}`, simulationHash: `0x${'bb'.repeat(32)}`, owner, tokenIn: compiler.FORK_CONTRACTS.weth,
      tokenOut: compiler.FORK_CONTRACTS.usdc, tokenInDecimals: 18, tokenOutDecimals: 6, amountIn: swap.amountIn, quotedOut, minimumOut,
      slippageBps: swap.slippageBps, fee: 3000 as const, nonce: 0n, deadline: 1_790_000_266n, approveGasLimit: 57_294n, swapGasLimit: 69_364n,
      maxFeePerGas: 1_796_246_614n };
    const { policy, policyHash } = compiler.compilePolicy(compileContext);
    const { manifest, manifestHash } = compiler.compileManifest(compileContext, policy, policyHash);
    const { plan, executionPlanHash } = compiler.compileExecutionPlan(compileContext, manifestHash, pair.approveBytes, pair.swapBytes);
    const { matrix, enforcementMatrixHash } = compiler.compileEnforcementMatrix(compileContext,
      { sourceBlock: { height: 36_000_000, hash: `0x${'cc'.repeat(32)}` }, stateSourceHash: `0x${'dd'.repeat(32)}`, simulationRawHash: `0x${'ee'.repeat(32)}` },
      { policyHash, manifestHash, executionPlanHash }, pair.approveBytes, pair.swapBytes);
    for (const [kind, value, hash] of [['authorization-policy', policy, policyHash], ['strategy-manifest', manifest, manifestHash],
      ['execution-plan', plan, executionPlanHash], ['enforcement-matrix', matrix, enforcementMatrixHash]] as const) {
      expect(parseArtifactBytes(bytes(value), kind)).toEqual(value);
      expect(hashArtifactBytes(kind, bytes(value))).toBe(hash);
    }
    expect(matrix.environment.evidenceEnvironment).toBe('FORK_REPRODUCED');
    expect(matrix.payloads.map(item => item.payloadHash)).toEqual([pair.approveBytes, pair.swapBytes].map(item => compiler.payloadIdentity(item).payloadHash));
    expect(walletRequestFor(pair.swapBytes, owner)).toMatchObject({ from: owner, to: compiler.SWAP_ROUTER_02, chainId: '0x7a69', type: '0x2', value: '0x0' });
    expect(manifest.authorizationMode).toBe('MODE_A');
    expect(manifest.enforcement).toBe('NOT_ENFORCED');
  });
});

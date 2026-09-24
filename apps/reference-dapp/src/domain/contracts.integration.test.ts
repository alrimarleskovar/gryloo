// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseArtifactBytes, hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { parseActionRegistryBytes, baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { mockActions } from './mock-actions';
import { parseLocalCommand, parseMockCommand } from './commands';

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

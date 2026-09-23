// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseArtifactBytes, hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { parseActionRegistryBytes } from '@defi-workflow-engine/action-registry';
import { editorReducer, initialEditor } from './editor';
import { mockActions } from './mock-actions';
import { parseMockCommand } from './commands';

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

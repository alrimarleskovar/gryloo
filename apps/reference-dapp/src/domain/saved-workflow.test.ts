// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { savedWorkflowHash, validateSavedWorkflow, workflowOwner } from './saved-workflow';

const authored = () => editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow;
describe('canonical saved-workflow validation', () => {
  it('roundtrips the canonical document and hashes reordered reconstructed JSON identically', () => {
    const workflow = validateSavedWorkflow(authored());
    const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
    const restored = validateSavedWorkflow(reorder(JSON.parse(JSON.stringify(workflow))));
    expect(restored).toEqual(workflow); expect(savedWorkflowHash(restored)).toBe(savedWorkflowHash(workflow));
  });
  it.each(['quote', 'simulation', 'review', 'authorization', 'privateKey', 'owner'])('refuses %s alongside canonical semantic data', field => {
    expect(() => validateSavedWorkflow({ ...authored(), [field]: 'untrusted' })).toThrow();
  });
  it('refuses empty templates, invalid semantic revisions and oversized documents', () => {
    expect(() => validateSavedWorkflow(initialEditor().workflow)).toThrow('WORKFLOW_EMPTY');
    expect(() => validateSavedWorkflow({ ...authored(), revision: -1 })).toThrow();
    expect(() => validateSavedWorkflow({ padding: 'x'.repeat(262_144) })).toThrow('WORKFLOW_INVALID');
  });
  it('requires a namespace and validates identity without treating it as proof', () => {
    const address = '0x' + 'a'.repeat(40);
    expect(workflowOwner(`eip155:${address}`)).toEqual({ namespace: 'eip155', address });
    for (const input of [address, `eip155:${address.toUpperCase()}`, 'other:' + address, 'solana:0x123', null]) expect(workflowOwner(input)).toBeNull();
  });
});

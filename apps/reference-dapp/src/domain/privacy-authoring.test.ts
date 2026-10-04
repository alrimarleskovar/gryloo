// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createReviewContext, digestArtifact, lintWorkflow, validateSolanaSwapWorkflow } from '@defi-workflow-engine/reference-linter';
import { hashArtifactBytes, privacyRequirement, assertPrivacyManifest, type SemanticWorkflow, type StrategyManifest } from '@defi-workflow-engine/workflow-contracts';
import { jupiterIntent } from '@defi-workflow-engine/reference-compiler';
import manifestFixture from '../../../../tests/compatibility/v1/strategy-manifest.json' with { type: 'json' };
import { commandIsValid, parseLocalCommand } from './commands';
import { editorReducer, initialEditor } from './editor';
import { createSolanaSwapNode, type SolanaSwapInput } from './jupiter-authoring';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const input: SolanaSwapInput = { network: 'Solana', from: 'SOL', to: 'USDC', amount: '0.02', slippage: '50', privacy: 'cloak' };
const authored = () => editorReducer(initialEditor(), parseLocalCommand('swap 0.02 SOL to USDC privately', initialEditor().workflow, context), context);
describe('privacy is a property of the canonical Flofi swap', () => {
  it('authors identical hash-covered policy from Guided and Canvas', async () => {
    const chat = authored(), canvas = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input, source: 'CANVAS', baseRevision: 0 }, context);
    expect(chat.error).toBeNull(); expect(chat.workflow).toEqual(canvas.workflow); expect(chat.workflow.nodes).toHaveLength(1);
    const workflow = chat.workflow as SemanticWorkflow;
    expect(validateSolanaSwapWorkflow(workflow).amount).toBe('20000000');
    expect(workflow.nodes[0]!.actionType).toBe('asset.swap.exact-input');
    expect(privacyRequirement(workflow.nodes[0]!)).toEqual({ mode: 'required', provider: 'cloak', output: 'public-with-private-change' });
    const nodeHash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
    expect(await digestArtifact('semantic-workflow', workflow)).toBe(nodeHash);
    const publicInput = { ...input }; delete publicInput.privacy;
    const publicWorkflow = { ...workflow, nodes: [createSolanaSwapNode('node-002', publicInput)] };
    expect(await digestArtifact('semantic-workflow', publicWorkflow)).not.toBe(nodeHash);
  });
  it('retains required privacy through amount edits and refuses downgrades', () => {
    const state = authored(), edit = parseLocalCommand('set node-002 amount 0.03', state.workflow, context);
    expect(commandIsValid(edit)).toBe(true);
    expect(editorReducer(state, edit, context).workflow.nodes[0]!.requiredCapabilities).toContain('privacy.required.cloak');
    const publicInput = { ...input }; delete publicInput.privacy;
    expect(editorReducer(state, { type: 'SET_SOLANA_SWAP', nodeId: 'node-002', input: publicInput, source: 'CANVAS', baseRevision: 1 }, context).error).toBe('PRIVACY_DOWNGRADE_DENIED');
  });
  it('blocks original unsupported USDC → private SOL, Devnet and oversized input', () => {
    expect(() => parseLocalCommand('Swap 5 USDC to SOL privately', initialEditor().workflow, context)).toThrow('CLOAK_SWAP_UNSUPPORTED');
    expect(() => createSolanaSwapNode('node-002', { ...input, network: 'Solana Devnet' })).toThrow();
    expect(() => createSolanaSwapNode('node-002', { ...input, amount: '0.051' })).toThrow('CLOAK_AMOUNT_OUT_OF_RANGE');
  });
  it('blocks public compilation and misleading capability/evidence upgrades', () => {
    const workflow = authored().workflow as SemanticWorkflow;
    expect(() => jupiterIntent(workflow, '11111111111111111111111111111111')).toThrow('PRIVACY_PUBLIC_FALLBACK_DENIED');
    expect(lintWorkflow(workflow, context).findings).toContainEqual(expect.objectContaining({ code: 'CLOAK_EXECUTION_GATES_REQUIRED', severity: 'BLOCK' }));
    const capabilities = resolveWorkflowCapability(workflow, { environment: 'MAINNET' });
    expect(capabilities.executionSupported).toBe(false); expect(capabilities.nodes[0]!.evidenceCeiling).toBeNull();
  });
  it('rejects incomplete capability policy and binds Manifest owner-mode/provider to the IR', () => {
    const workflow = authored().workflow as SemanticWorkflow;
    const broken = structuredClone(workflow); broken.nodes[0]!.requiredCapabilities.pop();
    expect(() => validateSolanaSwapWorkflow(broken)).toThrow('PRIVACY_REQUIREMENT_INVALID');
    const workflowHash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
    const manifest = { ...(manifestFixture as unknown as StrategyManifest), semanticWorkflowRevision: workflow.revision,
      semanticWorkflowHash: workflowHash, owner: { chainId: workflow.nodes[0]!.chainId, address: '11111111111111111111111111111111' }, providers: { kind: 'FIXED' as const, providerId: 'cloak' }, authorizationMode: 'MODE_A' as const, executor: null };
    expect(assertPrivacyManifest(workflow, workflowHash, manifest).provider).toBe('cloak');
    expect(() => assertPrivacyManifest(workflow, workflowHash, { ...manifest, providers: { kind: 'FIXED', providerId: 'jupiter' } })).toThrow('PRIVACY_MANIFEST_MISMATCH');
    expect(() => assertPrivacyManifest(workflow, '0x' + '0'.repeat(64), manifest)).toThrow('PRIVACY_MANIFEST_MISMATCH');
  });
});

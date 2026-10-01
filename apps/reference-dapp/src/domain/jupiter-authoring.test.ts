// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry, SOLANA_MAINNET_TOKENS } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { readExactInputSwap } from '@defi-workflow-engine/workflow-contracts';
import { commandIsValid, parseLocalCommand, summarize } from './commands';
import { editorReducer, initialEditor } from './editor';
import { editorHistoryReducer, initialEditorHistory } from './editor-history';
import { createSolanaSwapNode, parseTokenAmount, solanaSwapDetails, type SolanaSwapInput } from './jupiter-authoring';
import { createSwapNode } from './swap-authoring';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const canvasInput: SolanaSwapInput = { network: 'Solana', from: 'USDC', to: 'SOL', amount: '10', slippage: '50' };
describe('Solana swap chat/canvas authoring', () => {
  it('produces semantically identical canonical swap IR from chat and canvas', () => {
    const chat = parseLocalCommand('Swap 10 USDC to SOL on Solana', initialEditor().workflow, context);
    expect(chat).toEqual({ type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CHAT', baseRevision: 0 });
    const fromChat = editorReducer(initialEditor(), chat, context);
    const fromCanvas = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context);
    expect(fromChat.error).toBeNull();
    expect(fromChat.workflow).toEqual(fromCanvas.workflow);
    const node = fromChat.workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input')!;
    expect(readExactInputSwap(node as Parameters<typeof readExactInputSwap>[0])).toMatchObject({ chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      input: { address: SOLANA_MAINNET_TOKENS.USDC.mint, decimals: 6 }, output: { address: SOLANA_MAINNET_TOKENS.SOL.mint, decimals: 9 }, amount: '10000000', slippageBps: 50, protocols: ['jupiter'] });
    expect(summarize(fromChat.workflow)).toContain('Swap 10 USDC to SOL on Solana via Jupiter');
  });
  it('uses the same canonical action and port shape as the existing EVM swap', () => {
    const evm = createSwapNode('node-002', 'USDC_TO_WETH', '1', '50', createBaseSepoliaReviewContext());
    const sol = createSolanaSwapNode('node-002', canvasInput);
    const shape = (n: typeof evm) => [n.actionType, n.requiredCapabilities, n.inputs.map(i => [i.name, i.kind]), n.expectedOutputs.map(o => o.outputId), n.userConstraints.map(c => c.kind), n.requiredAuthorizationClass];
    expect(shape(sol)).toEqual(shape(evm));
  });
  it('parses exact token units by mint decimals and rejects ambiguous input', () => {
    expect(parseTokenAmount('0.000000001', 9)).toBe('1');
    expect(parseTokenAmount('10.5', 6)).toBe('10500000');
    for (const bad of ['0', '1e3', '-1', '1.0000001', '']) expect(() => parseTokenAmount(bad, 6)).toThrow();
    expect(() => createSolanaSwapNode('n', { ...canvasInput, to: 'USDC' })).toThrow('INVALID_ASSET_PAIR');
    expect(() => createSolanaSwapNode('n', { ...canvasInput, slippage: '301' })).toThrow('SOLANA_SLIPPAGE_OUT_OF_RANGE');
    expect(() => parseLocalCommand('swap 10 BONK to SOL on Solana', initialEditor().workflow, context)).toThrow();
  });
  it('edits amount and slippage through chat with revision checks and undo/redo', () => {
    let history = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', command: { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context });
    const added = history.editor.workflow;
    const edit = parseLocalCommand('set node-002 amount 12.5', added, context);
    expect(edit).toMatchObject({ type: 'SET_SOLANA_SWAP', nodeId: 'node-002', input: { amount: '12.5' } });
    history = editorHistoryReducer(history, { type: 'COMMAND', command: edit, context });
    expect(solanaSwapDetails(history.editor.workflow.nodes.find(n => n.nodeId === 'node-002')!)?.amount).toBe('12.5');
    const slip = parseLocalCommand('set node-002 slippage 100 bps', history.editor.workflow, context);
    expect(slip).toMatchObject({ type: 'SET_SOLANA_SWAP', input: { slippage: '100' } });
    expect(editorReducer(history.editor, { ...edit, baseRevision: 0 }, context).error).toMatch('BASE_REVISION_CONFLICT');
    history = editorHistoryReducer(history, { type: 'UNDO' });
    // Undo restores the semantic content under a fresh revision, so a prior Review cannot be revived.
    expect(history.editor.workflow.nodes).toEqual(added.nodes);
    expect(history.editor.workflow.revision).toBeGreaterThan(added.revision + 1);
    history = editorHistoryReducer(history, { type: 'REDO' });
    expect(solanaSwapDetails(history.editor.workflow.nodes.find(n => n.nodeId === 'node-002')!)?.amount).toBe('12.5');
  });
  it('keeps the Solana swap isolated and validates commands strictly', () => {
    const added = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context);
    expect(editorReducer(added, { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 1 }, context).error).toBe('SOLANA_SWAP_ISOLATED_ONLY');
    expect(commandIsValid({ type: 'ADD_SOLANA_SWAP', input: { ...canvasInput, extra: '1' }, source: 'CHAT', baseRevision: 0 })).toBe(false);
    expect(commandIsValid({ type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CHAT', baseRevision: 0 })).toBe(true);
  });
});

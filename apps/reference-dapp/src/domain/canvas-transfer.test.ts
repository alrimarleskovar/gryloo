// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCryptoActionNode, cryptoInputOf, cryptoProfiles, selectCryptoNetwork, type CryptoAction } from './crypto-action-picker';
import { transferDetails } from './robinhood-transfer-authoring';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { canvasAmountCommand } from './canvas-action-setup';
import { editorHistoryReducer, initialEditorHistory } from './editor-history';

describe('native self-transfer Canvas parity', () => {
  it('offers only the two supported test networks', () => {
    expect(cryptoProfiles('transfer' as CryptoAction).map(p => p.network)).toEqual(['Robinhood Chain Testnet', 'Ethereum Sepolia']);
  });
  it.each(['Robinhood Chain Testnet', 'Ethereum Sepolia'])('uses the existing canonical self-transfer on %s', network => {
    const selection = selectCryptoNetwork('transfer' as CryptoAction, network);
    const node = createCryptoActionNode('canvas-transfer', { selection, amount: '0.000001', slippage: '50' });
    expect(node.actionType).toBe('asset.transfer');
    expect(transferDetails(node)).toEqual({ network, asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' });
    expect(cryptoInputOf(node)).toMatchObject({ selection, amount: '0.000001' });
    expect(() => createCryptoActionNode('canvas-transfer', { selection, amount: '0', slippage: '50' })).toThrow();
  });
  it.each(['Robinhood Chain Testnet', 'Ethereum Sepolia'])('reviews and applies an amount edit on %s without reselecting the network', network => {
    const context = createBaseSepoliaReviewContext();
    const selection = selectCryptoNetwork('transfer', network);
    const initial = editorHistoryReducer(initialEditorHistory(), { type: 'COMMAND', context, command: {
      type: 'ADD_CRYPTO_ACTION', source: 'CANVAS', baseRevision: 0, input: { selection, amount: '0.000001', slippage: '50' },
    } });
    const node = initial.editor.workflow.nodes.find(node => node.actionType === 'asset.transfer')!;
    const editing = editorHistoryReducer(initial, { type: 'EDIT_CANVAS_AMOUNT', context, id: node.nodeId, amount: '0.000002' });
    const command = canvasAmountCommand(editing.editor, null, editing.amountInputs, node.nodeId, context);
    expect(command).toMatchObject({ type: 'SET_RH_TRANSFER', nodeId: node.nodeId, input: { amount: '0.000002', recipient: 'CONNECTED_OWNER', network } });
    const accepted = editorHistoryReducer(editing, { type: 'COMMAND', context, command, authoringId: node.nodeId, authoringAmount: '0.000002' });
    expect(accepted.editor.error).toBeNull(); expect(accepted.amountInputs).toEqual({});
    const transfer = accepted.editor.workflow.nodes.find(candidate => candidate.nodeId === node.nodeId)!;
    expect(transferDetails(transfer as Parameters<typeof transferDetails>[0])).toMatchObject({ network, amount: '0.000002', recipient: 'CONNECTED_OWNER' });
    expect(editorHistoryReducer(accepted, { type: 'UNDO' }).editor.workflow.nodes).toEqual(initial.editor.workflow.nodes);
  });
});

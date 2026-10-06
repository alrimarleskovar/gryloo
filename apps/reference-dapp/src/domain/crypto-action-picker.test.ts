// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { cryptoNetworks, selectCryptoNetwork, selectCryptoToken, cryptoTokenOptions, createCryptoActionNode, cryptoInputOf, validCryptoSelection, cryptoReviewContext, canSelectCryptoAssets, type CryptoAction } from './crypto-action-picker';
import { editorReducer, initialEditor } from './editor';
import { editorHistoryReducer, initialEditorHistory } from './editor-history';
import { canvasAmountCommand, actionReviewValue } from './canvas-action-setup';
import { classifyWalletEnvironment } from '../wallet/environment';

const owner = '0x1111111111111111111111111111111111111111', context = cryptoReviewContext('Base Sepolia');
const actions: CryptoAction[] = ['swap', 'pool', 'supply', 'borrow', 'repay', 'withdraw'];
function input(action: CryptoAction, network: string) { return { selection: selectCryptoNetwork(action, network), amount: '0.1', secondAmount: '0.01', slippage: '50', beneficiary: owner }; }
function assetChains(node: ReturnType<typeof createCryptoActionNode>) {
  const chains: string[] = [];
  const visit = (value: unknown) => { if (!value || typeof value !== 'object') return; for (const [key, nested] of Object.entries(value)) { if (key === 'chainId' && typeof nested === 'string') chains.push(nested); else visit(nested); } };
  visit(node.inputs); visit(node.expectedOutputs); return chains;
}

describe('one network per crypto action', () => {
  it.each(actions)('%s uses the shared wallet classifier and never mixes environments', action => {
    for (const environment of ['mainnet', 'testnet'] as const) {
      const profiles = cryptoNetworks(action, environment);
      expect(profiles.every(profile => classifyWalletEnvironment(profile.chain) === environment)).toBe(true);
    }
    expect(cryptoNetworks(action, 'unknown')).toEqual([]);
  });
  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)('%s exposes only the pinned Aave USDC deployment', action => {
    expect(cryptoNetworks(action, 'testnet').map(profile => [profile.network, profile.tokens])).toEqual([['Base Sepolia', ['USDC']]]);
    expect(cryptoNetworks(action, 'mainnet')).toEqual([]);
    expect(() => selectCryptoNetwork(action, 'Solana Devnet')).toThrow('ACTION_NETWORK_UNSUPPORTED');
    const node = createCryptoActionNode('asset', input(action, 'Base Sepolia'));
    expect(node.chainId).toBe('eip155:84532');
    expect(cryptoInputOf(node)?.selection).toEqual(selectCryptoNetwork(action, 'Base Sepolia'));
    expect(assetChains(node).every(chain => chain === node.chainId)).toBe(true);
  });
  it.each(['swap', 'pool'] as const)('%s moves both assets and refreshes token options together', action => {
    const original = selectCryptoNetwork(action, 'Base Sepolia');
    const next = selectCryptoNetwork(action, 'Solana Devnet', original);
    expect([next.from, next.to]).toEqual(['SOL', 'devUSDC']);
    expect(cryptoTokenOptions(next, 'source')).not.toContain('WETH');
    expect(cryptoTokenOptions(next, 'destination')).not.toContain('USDC');
    for (const network of cryptoNetworks(action, 'mainnet').concat(cryptoNetworks(action, 'testnet')).map(profile => profile.network)) {
      const node = createCryptoActionNode('assets', input(action, network));
      expect(assetChains(node).length).toBeGreaterThan(0);
      expect(assetChains(node).every(chain => chain === node.chainId)).toBe(true);
      expect(cryptoInputOf(node)?.selection.network).toBe(network);
    }
  });
  it('lets swap assets change independently while retaining a single action network', () => {
    const initial = selectCryptoNetwork('swap', 'Solana');
    const next = selectCryptoToken(initial, 'destination', 'USDT');
    expect(next).toEqual({ action: 'swap', network: 'Solana', from: 'SOL', to: 'USDT' });
    const reverse = selectCryptoToken(next, 'source', 'USDT');
    expect(reverse.from).toBe('USDT'); expect(reverse.to).toBe('SOL'); expect(reverse.network).toBe('Solana');
  });
  it('does not advertise Arbitrum swaps or unsupported pool adapters and pairs', () => {
    expect(cryptoNetworks('swap', 'mainnet').map(profile => profile.network)).toEqual(['Base', 'Solana']);
    expect(cryptoNetworks('pool', 'mainnet').map(profile => profile.network)).toEqual(['Base']);
    expect(() => selectCryptoNetwork('pool', 'Solana')).toThrow('ACTION_NETWORK_UNSUPPORTED');
    expect(validCryptoSelection({ action: 'pool', network: 'Base Sepolia', from: 'WETH', to: 'USDC' })).toBe(false);
  });
  it('rejects per-asset networks instead of allowing a hidden cross-chain swap', () => {
    const unsupported = { ...selectCryptoNetwork('swap', 'Base'), destinationNetwork: 'Arbitrum' };
    expect(validCryptoSelection(unsupported)).toBe(false);
    expect(() => createCryptoActionNode('bad', { ...input('swap', 'Base'), selection: unsupported })).toThrow('ACTION_ASSETS_UNSUPPORTED');
  });
  it('preserves node identity, amounts, and lock/dependency validation when editing its network', () => {
    const before = editorReducer(initialEditor(), { type: 'ADD_CRYPTO_ACTION', input: input('swap', 'Base Sepolia'), source: 'CANVAS', baseRevision: 0 }, context);
    expect(before.error).toBeNull();
    const old = before.workflow.nodes.find(node => node.actionType === 'asset.swap.exact-input')!;
    const after = editorReducer(before, { type: 'SET_CRYPTO_ACTION', nodeId: old.nodeId, input: input('swap', 'Solana Devnet'), source: 'CANVAS', baseRevision: 1 }, context);
    expect(after.error).toBeNull();
    const node = after.workflow.nodes.find(node => node.nodeId === old.nodeId)!;
    expect(cryptoInputOf(node)?.amount).toBe('0.1'); expect(classifyWalletEnvironment(node.chainId)).toBe('testnet'); expect(node.chainId).toBe(cryptoNetworks('swap', 'testnet').find(profile => profile.network === 'Solana Devnet')!.chain);
    const locked = { ...old, lockedParameters: [old.inputs.find(input => input.kind === 'QUANTITY')!] };
    expect(canSelectCryptoAssets(locked, before.workflow)).toBe(false);
    const rejected = editorReducer({ ...before, workflow: { ...before.workflow, nodes: [locked] } }, { type: 'SET_CRYPTO_ACTION', nodeId: old.nodeId, input: input('swap', 'Solana Devnet'), source: 'CANVAS', baseRevision: 1 }, context);
    expect(rejected.error).toBe('ACTION_SELECTION_LOCKED');
  });
  it('retains provider constraints and legacy pool minimums on the same deployment', () => {
    const baseContext = cryptoReviewContext('Base');
    const cow = editorReducer(initialEditor(), { type: 'ADD_COW_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50', source: 'CANVAS', baseRevision: 0 }, baseContext);
    const swap = cow.workflow.nodes.find(node => node.actionType === 'asset.swap.exact-input')!;
    const changed = editorReducer(cow, { type: 'SET_CRYPTO_ACTION', nodeId: swap.nodeId, input: { ...input('swap', 'Base'), amount: '2' }, source: 'CANVAS', baseRevision: 1 }, baseContext);
    expect(changed.error).toBeNull();
    expect(changed.workflow.nodes.find(node => node.nodeId === swap.nodeId)?.adapterConstraints).toEqual(swap.adapterConstraints);
    const pool = editorReducer(initialEditor(), { type: 'ADD_CRYPTO_ACTION', input: input('pool', 'Base'), source: 'CANVAS', baseRevision: 0 }, baseContext);
    const position = pool.workflow.nodes.find(node => node.actionType === 'asset.liquidity.uniswap-v3')!;
    const protectedPosition = { ...position, inputs: position.inputs.map(parameter => parameter.kind === 'QUANTITY' && parameter.name === 'amount0-min' ? { ...parameter, value: { ...parameter.value, amount: '10000000000000000' } } : parameter) };
    const protectedState = { ...pool, workflow: { ...pool.workflow, nodes: pool.workflow.nodes.map(node => node.nodeId === position.nodeId ? protectedPosition : node) } };
    const edited = editorReducer(protectedState, { type: 'SET_CRYPTO_ACTION', nodeId: position.nodeId, input: { ...input('pool', 'Base'), amount: '0.2' }, source: 'CANVAS', baseRevision: 1 }, baseContext);
    expect(edited.error).toBeNull();
    expect(edited.workflow.nodes.find(node => node.nodeId === position.nodeId)?.inputs.find(parameter => parameter.name === 'amount0-min')).toEqual(protectedPosition.inputs.find(parameter => parameter.name === 'amount0-min'));
    const rejected = editorReducer(protectedState, { type: 'SET_CRYPTO_ACTION', nodeId: position.nodeId, input: { ...input('pool', 'Base'), amount: '0.001' }, source: 'CANVAS', baseRevision: 1 }, baseContext);
    expect(rejected.error).not.toBeNull(); expect(rejected.workflow).toBe(protectedState.workflow);
  });
  it('invalidates a reviewed selection and restores the entire selection through undo', () => {
    let state = editorHistoryReducer(initialEditorHistory(), { type: 'START_ACTION_SETUP', action: 'swap', position: { x: 0, y: 0 }, beneficiary: owner });
    const id = state.actionSetup!.id;
    state = editorHistoryReducer(state, { type: 'EDIT_CRYPTO_SELECTION', id, selection: selectCryptoNetwork('swap', 'Base Sepolia'), context });
    state = editorHistoryReducer(state, { type: 'EDIT_CANVAS_AMOUNT', id, amount: '1', context });
    const command = canvasAmountCommand(state.editor, state.actionSetup, state.amountInputs, id, context);
    const authoringAmount = actionReviewValue(state.actionSetup, id, undefined)!;
    const changed = editorHistoryReducer(state, { type: 'EDIT_CRYPTO_SELECTION', id, selection: selectCryptoNetwork('swap', 'Solana Devnet'), context });
    expect(editorHistoryReducer(changed, { type: 'COMMAND', command, context, authoringId: id, authoringAmount })).toBe(changed);
    const undone = editorHistoryReducer(changed, { type: 'UNDO' });
    expect(undone.actionSetup?.cryptoSelection).toEqual(state.actionSetup?.cryptoSelection);
  });
});

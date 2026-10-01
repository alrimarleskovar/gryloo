// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry, SOLANA_DEVNET_TOKENS, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { readExactInputSwap } from '@defi-workflow-engine/workflow-contracts';
import { commandIsValid, parseLocalCommand, summarize } from './commands';
import { editorReducer, initialEditor } from './editor';
import { describeProposal } from './proposal';
import { createSolanaSwapNode, parseSolanaSwapChat, solanaSwapDetails, solanaSwapLabels, type SolanaSwapInput } from './jupiter-authoring';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const canvasInput: SolanaSwapInput = { network: 'Solana Devnet', from: 'devUSDC', to: 'SOL', amount: '10', slippage: '50' };
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
describe('Solana Devnet swap chat/canvas authoring', () => {
  it('"Swap 10 test USDC to test SOL on Solana Devnet" and the canvas form produce identical canonical IR', () => {
    const chat = parseLocalCommand('Swap 10 test USDC to test SOL on Solana Devnet', initialEditor().workflow, context);
    expect(chat).toEqual({ type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CHAT', baseRevision: 0 });
    const fromChat = editorReducer(initialEditor(), chat, context);
    const fromCanvas = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context);
    expect(fromChat.error).toBeNull();
    expect(fromChat.workflow).toEqual(fromCanvas.workflow);
    const node = fromChat.workflow.nodes.find(n => n.actionType === 'asset.swap.exact-input')!;
    expect(node.actionType).toBe('asset.swap.exact-input');
    expect(readExactInputSwap(node as Parameters<typeof readExactInputSwap>[0])).toMatchObject({ chain: DEVNET,
      input: { chainId: DEVNET, address: SOLANA_DEVNET_TOKENS.devUSDC.mint, decimals: 6 }, output: { chainId: DEVNET, address: SOLANA_DEVNET_TOKENS.SOL.mint, decimals: 9 },
      amount: '10000000', slippageBps: 50, protocols: ['orca-whirlpools'] });
    expect(summarize(fromChat.workflow)).toContain('Swap 10 devUSDC to SOL on Solana Devnet via Orca Whirlpools');
    expect(summarize(fromChat.workflow)).not.toContain('Jupiter');
  });
  it('accepts devUSDC, plain USDC and test-prefixed names on Devnet only', () => {
    expect(parseSolanaSwapChat('swap 0.1 SOL to devUSDC on Solana Devnet slippage 100 bps')).toEqual({ network: 'Solana Devnet', from: 'SOL', to: 'devUSDC', amount: '0.1', slippage: '100' });
    expect(parseSolanaSwapChat('Swap 1 USDC for SOL on solana devnet')).toMatchObject({ network: 'Solana Devnet', from: 'devUSDC', to: 'SOL' });
    // A test token named on mainnet never resolves to a real asset.
    expect(() => parseLocalCommand('Swap 10 test USDC to SOL on Solana', initialEditor().workflow, context)).toThrow('SOLANA_MINT_UNSUPPORTED');
    expect(() => parseLocalCommand('Swap 10 USDT to SOL on Solana Devnet', initialEditor().workflow, context)).toThrow('SOLANA_MINT_UNSUPPORTED');
  });
  it('mainnet and Devnet differ only in chain, mint identity and provider below the same action', () => {
    const devnet = createSolanaSwapNode('node-002', canvasInput), mainnet = createSolanaSwapNode('node-002', { network: 'Solana', from: 'USDC', to: 'SOL', amount: '10', slippage: '50' });
    const shape = (n: typeof devnet) => [n.actionType, n.actionSchemaVersion, n.requiredCapabilities, n.inputs.map(i => [i.name, i.kind]), n.expectedOutputs.map(o => o.outputId),
      n.userConstraints.map(c => c.kind), n.requiredAuthorizationClass, n.failurePolicy];
    expect(shape(devnet)).toEqual(shape(mainnet));
    expect(devnet.chainId).not.toBe(mainnet.chainId);
    expect(solanaSwapDetails(devnet)).toEqual(canvasInput);
    expect(solanaSwapLabels('Solana Devnet')).toEqual({ network: 'Solana Devnet', provider: 'Orca Whirlpools', kind: 'SOLANA DEVNET · ORCA', testTokens: true });
  });
  it('validates Devnet amounts, slippage and pairs, and keeps commands strict', () => {
    expect(() => createSolanaSwapNode('n', { ...canvasInput, to: 'devUSDC' })).toThrow('INVALID_ASSET_PAIR');
    expect(() => createSolanaSwapNode('n', { ...canvasInput, from: 'USDC' })).toThrow('SOLANA_MINT_UNSUPPORTED');
    expect(() => createSolanaSwapNode('n', { ...canvasInput, slippage: '301' })).toThrow('SOLANA_SLIPPAGE_OUT_OF_RANGE');
    expect(() => createSolanaSwapNode('n', { ...canvasInput, amount: '1000.000001' })).toThrow('AMOUNT_OUT_OF_RANGE');
    expect(() => createSolanaSwapNode('n', { ...canvasInput, amount: '0.0000001' })).toThrow('AMOUNT_PRECISION');
    expect(createSolanaSwapNode('n', { ...canvasInput, from: 'SOL', to: 'devUSDC', amount: '0.000000001' }).inputs[0]).toMatchObject({ value: { amount: '1' } });
    expect(commandIsValid({ type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 })).toBe(true);
    expect(commandIsValid({ type: 'ADD_SOLANA_SWAP', input: { ...canvasInput, network: 'Solana Testnet' }, source: 'CANVAS', baseRevision: 0 })).toBe(false);
  });
  it('labels the proposal honestly and resolves a Devnet public-test capability with no demonstrated evidence', () => {
    const before = initialEditor(), after = editorReducer(before, { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context);
    const lines = describeProposal(before, after, { type: 'ADD_SOLANA_SWAP', input: canvasInput, source: 'CANVAS', baseRevision: 0 }, context).join('\n');
    expect(lines).toContain('on Solana Devnet via Orca Whirlpools');
    expect(lines).toContain('Valueless Devnet test tokens');
    expect(lines).not.toMatch(/Jupiter|mainnet funds/);
    const capability = resolveWorkflowCapability(after.workflow, { environment: 'PUBLIC_TESTNET', runtime: { walletConnected: true, walletChainId: DEVNET,
      artifacts: 'CURRENT', simulationReady: true, authorizationReady: true, quoteProviderAvailable: true } });
    expect(capability.nodes.find(n => n.actionType === 'asset.swap.exact-input')).toMatchObject({ adapterId: 'orca.whirlpools-devnet', evidenceCeiling: null });
  });
});

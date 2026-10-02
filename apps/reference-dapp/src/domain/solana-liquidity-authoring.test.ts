// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { readConcentratedLiquidity } from '@defi-workflow-engine/workflow-contracts';
import { commandIsValid, parseLocalCommand, summarize } from './commands';
import { editorReducer, initialEditor } from './editor';
import { describeProposal } from './proposal';
import { createSolanaLiquidityNode, parseSolanaLiquidityChat, solanaLiquidityDetails, solanaLiquidityInputOf, type SolanaLiquidityInput } from './solana-liquidity-authoring';
import { createLiquidityNode } from './liquidity-authoring';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id, actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const canvas: SolanaLiquidityInput = { network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.30', rangeUnit: 'PRICE', lower: '20.121902', upper: '24.593436', slippage: '100' };
describe('Solana Devnet liquidity chat/canvas authoring', () => {
  it('chat and canvas produce the identical canonical asset.liquidity.concentrated IR with deterministically aligned ticks', () => {
    const text = 'Add liquidity 0.01 SOL and 0.30 devUSDC from 20.121902 to 24.593436 devUSDC per SOL on Solana Devnet slippage 100 bps';
    const chat = parseLocalCommand(text, initialEditor().workflow, context);
    expect(chat).toEqual({ type: 'ADD_SOLANA_LIQUIDITY', input: canvas, source: 'CHAT', baseRevision: 0 });
    const fromChat = editorReducer(initialEditor(), chat, context), fromCanvas = editorReducer(initialEditor(), { type: 'ADD_SOLANA_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: 0 }, context);
    expect(fromChat.error).toBeNull();
    expect(fromChat.workflow).toEqual(fromCanvas.workflow);
    const node = fromChat.workflow.nodes.find(n => n.actionType === 'asset.liquidity.concentrated')!;
    expect(readConcentratedLiquidity(node as Parameters<typeof readConcentratedLiquidity>[0])).toMatchObject({ chain: DEVNET, amount0Max: '10000000', amount1Max: '300000',
      tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100, protocols: ['orca-whirlpools'], recipient: null });
    // Tick syntax for the same range produces the same IR.
    const ticks = parseLocalCommand('add orca liquidity 0.01 SOL and 0.3 test USDC ticks -39104 to -36992 on Solana Devnet', initialEditor().workflow, context);
    expect(editorReducer(initialEditor(), ticks, context).workflow.nodes).toEqual(fromChat.workflow.nodes);
    expect(summarize(fromChat.workflow)).toContain('Concentrated liquidity on Solana Devnet via Orca Whirlpools');
    expect(describeProposal(initialEditor(), fromChat, chat, context).join('\n')).toMatch(/Maxima are limits, not amounts to spend/);
  });
  it('round-trips the inspector edit form and keeps the wallet out of the IR', () => {
    const node = createSolanaLiquidityNode('node-002', canvas), details = solanaLiquidityDetails(node)!;
    expect(details).toMatchObject({ network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.3', tickLower: -39104, tickUpper: -36992, slippage: '100' });
    expect(createSolanaLiquidityNode('node-002', solanaLiquidityInputOf(details))).toEqual(node);
    expect(JSON.stringify(node)).not.toMatch(/recipient|owner/);
  });
  it('rejects unsupported networks, zero or excessive maxima, unaligned ticks, bad prices and slippage; commands are validated closed', () => {
    expect(() => createSolanaLiquidityNode('n', { ...canvas, network: 'Solana' as 'Solana Devnet' })).toThrow('SOLANA_CLUSTER_UNSUPPORTED');
    expect(() => createSolanaLiquidityNode('n', { ...canvas, maxSol: '0', maxDevUsdc: '0' })).toThrow('SOLANA_LIQUIDITY_ZERO');
    expect(() => createSolanaLiquidityNode('n', { ...canvas, maxSol: '11' })).toThrow('AMOUNT_OUT_OF_RANGE');
    expect(() => createSolanaLiquidityNode('n', { ...canvas, rangeUnit: 'TICK', lower: '-39100', upper: '-36992' })).toThrow('SOLANA_LIQUIDITY_RANGE_INVALID');
    expect(() => createSolanaLiquidityNode('n', { ...canvas, lower: '24.6', upper: '20.1' })).toThrow('ORCA_PRICE_RANGE_INVALID');
    expect(() => createSolanaLiquidityNode('n', { ...canvas, slippage: '301' })).toThrow('SOLANA_SLIPPAGE_OUT_OF_RANGE');
    expect(parseSolanaLiquidityChat('add liquidity 1 WETH and 2 USDC ticks -10 to 10 on Solana Devnet')).toBeNull();
    expect(commandIsValid({ type: 'ADD_SOLANA_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: 0 })).toBe(true);
    expect(commandIsValid({ type: 'ADD_SOLANA_LIQUIDITY', input: { ...canvas, owner: 'x' }, source: 'CANVAS', baseRevision: 0 })).toBe(false);
    const withSwap = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: { network: 'Solana Devnet', from: 'SOL', to: 'devUSDC', amount: '0.1', slippage: '50' }, source: 'CANVAS', baseRevision: 0 }, context);
    expect(editorReducer(withSwap, { type: 'ADD_SOLANA_LIQUIDITY', input: canvas, source: 'CANVAS', baseRevision: withSwap.workflow.revision }, context).error).toMatch(/ISOLATED_ONLY/);
  });
  it('leaves the BUILD-006 Uniswap v3 authoring bytes unchanged and readable by the neutral reader', () => {
    const evm = createLiquidityNode('node-002', { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0', tickLower: '-100', tickUpper: '100',
      recipient: '0x1111111111111111111111111111111111111111' }, context);
    expect(evm.actionType).toBe('asset.liquidity.uniswap-v3');
    expect(readConcentratedLiquidity(evm)).toMatchObject({ chain: 'eip155:8453', feeTier: 500, protocols: ['uniswap-v3'], slippageBps: null });
    expect(solanaLiquidityDetails(evm)).toBeNull();
  });
});

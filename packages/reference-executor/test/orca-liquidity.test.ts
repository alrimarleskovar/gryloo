// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createConcentratedLiquidityNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { base58Encode, createMockedSolanaDevnetOrca, createMockedSolanaWallet, simulateOrcaLiquidity } from '@defi-workflow-engine/reference-compiler';
import { createOrcaLiquidityRun, orcaLiquidityAttemptResolved, orcaLiquidityTransition, prepareOrcaLiquidityAttempt, recordOrcaLiquiditySignature,
  validateOrcaLiquidityRun } from '../src/index.js';

const chain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'w', revision: 1, resourceEdges: [], nodes: [createConcentratedLiquidityNode('node-002', { chain,
  token0: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, token1: { chainId: chain, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 },
  amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0', tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100,
  protocols: ['orca-whirlpools'], recipient: null, positionAsset: { chainId: chain, address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', decimals: 0 } })] };
describe('Orca liquidity run model', () => {
  it('persists intent before signing and the signature before broadcast, with one recovery boundary per operation', async () => {
    const env = createMockedSolanaDevnetOrca(), wallet = createMockedSolanaWallet(); env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
    const mint = base58Encode(crypto.getRandomValues(new Uint8Array(32)));
    const review = await simulateOrcaLiquidity(workflow, wallet.owner, { operation: 'OPEN', positionMint: mint }, env.rpc, Date.parse('2026-10-01T12:00:00.000Z'));
    const run = createOrcaLiquidityRun('orcalp-' + 'b'.repeat(32), review, 'MOCKED');
    expect(run).toMatchObject({ operation: 'OPEN', positionMint: mint, attempt: null, verdict: 'PENDING', ownerInitiated: false });
    validateOrcaLiquidityRun(run);
    expect(() => prepareOrcaLiquidityAttempt(run, 380_000_000)).toThrow('ORCA_LIQUIDITY_REVIEW_REQUIRED');
    const prepared = prepareOrcaLiquidityAttempt({ ...run, authorization: review.commitment }, 380_000_000);
    expect(() => prepareOrcaLiquidityAttempt(prepared, 380_000_000)).toThrow('ORCA_LIQUIDITY_EXISTING_ATTEMPT_OBSERVE_ONLY');
    expect(() => prepareOrcaLiquidityAttempt({ ...run, authorization: review.commitment }, review.lastValidBlockHeight)).toThrow('ORCA_LIQUIDITY_REVIEW_STALE');
    validateOrcaLiquidityRun(prepared);
    expect(orcaLiquidityAttemptResolved(prepared)).toBe(false);
    const signed = recordOrcaLiquiditySignature(prepared, { signature: '1'.repeat(64), transaction: 'AA==' });
    expect(() => orcaLiquidityTransition(signed, 'PENDING', { signature: '2'.repeat(64) })).toThrow('ORCA_LIQUIDITY_SIGNATURE_DIVERGENT');
    expect(signed.journal.entries.filter(e => e.level === 'attempt').map(e => [e.entityId, e.toState])).toEqual([[`${run.id}.open`, 'PREPARED'], [`${run.id}.open`, 'SUBMITTING']]);
    expect(() => validateOrcaLiquidityRun({ ...signed, positionMint: wallet.owner })).toThrow('ORCA_LIQUIDITY_STORE_CORRUPT');
    expect(() => validateOrcaLiquidityRun({ ...signed, review: { ...signed.review, operationPlan: { ...signed.review.operationPlan, tokenB: '1' } } })).toThrow('ORCA_LIQUIDITY_STORE_CORRUPT');
    expect(() => createOrcaLiquidityRun('orca-' + 'b'.repeat(32), review, 'MOCKED')).toThrow('ORCA_LIQUIDITY_ID_INVALID');
  });
});

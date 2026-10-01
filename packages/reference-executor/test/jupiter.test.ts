// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET as profile, SOLANA_MAINNET_TOKENS as T, createMockedSolanaJupiter, createMockedSolanaWallet, simulateJupiterSwap,
  verifySignedJupiterTransaction } from '@defi-workflow-engine/reference-compiler';
import { createJupiterRun, jupiterAttemptResolved, jupiterObservationDecision, jupiterTransition, prepareJupiterAttempt, recordJupiterSignature, validateJupiterRun } from '../src/jupiter.js';

const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
  nodes: [createExactInputSwapNode('node-002', { chain: profile.chain, input: { chainId: profile.chain, address: T.USDC.mint, decimals: 6 },
    output: { chainId: profile.chain, address: T.SOL.mint, decimals: 9 }, amount: '10000000', slippageBps: 50, protocols: ['jupiter'], maximumAmount: T.USDC.maximumAmount })] };
async function run() {
  const env = createMockedSolanaJupiter(), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, { USDC: 50_000_000n });
  const review = await simulateJupiterSwap(workflow, wallet.owner, env.http, env.rpc);
  return { env, wallet, review, run: createJupiterRun('jupiter-' + 'a'.repeat(32), review, 'MOCKED') };
}
describe('Jupiter exactly-once attempt lifecycle', () => {
  it('requires an accepted Review and prepares one durable attempt before any wallet request', async () => {
    const { run: r, review, env } = await run();
    expect(() => prepareJupiterAttempt(r, env.state.blockHeight)).toThrow('JUPITER_REVIEW_REQUIRED');
    const prepared = prepareJupiterAttempt({ ...r, authorization: review.commitment }, env.state.blockHeight);
    expect(prepared.attempt).toMatchObject({ state: 'PREPARED', signature: null, messageHash: review.messageHash });
    expect(prepared.journal.entries.at(-1)?.toState).toBe('PREPARED');
    expect(() => prepareJupiterAttempt(prepared, env.state.blockHeight)).toThrow('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    expect(() => prepareJupiterAttempt({ ...r, authorization: review.commitment }, review.lastValidBlockHeight)).toThrow('JUPITER_QUOTE_STALE');
    validateJupiterRun(prepared);
  });
  it('persists the signature and signed bytes before broadcast and never changes transaction identity', async () => {
    const { run: r, review, env, wallet } = await run();
    const signed = verifySignedJupiterTransaction(review, wallet.sign(review.unsignedTransaction));
    const submitting = recordJupiterSignature(prepareJupiterAttempt({ ...r, authorization: review.commitment }, env.state.blockHeight), signed);
    expect(submitting.attempt).toMatchObject({ state: 'SUBMITTING', signature: signed.signature, transaction: signed.transaction });
    expect(() => recordJupiterSignature(submitting, signed)).toThrow('JUPITER_ATTEMPT_NOT_PREPARED');
    expect(() => jupiterTransition(submitting, 'PENDING', { signature: createMockedSolanaWallet().owner + 'x' })).toThrow('JUPITER_SIGNATURE_DIVERGENT');
    validateJupiterRun(jupiterTransition(submitting, 'PENDING'));
  });
  it('treats absence as conclusive only after the reviewed blockhash validity has passed', () => {
    expect(jupiterObservationDecision(true, 10, 5)).toBe('FOUND');
    expect(jupiterObservationDecision(false, 100, 100)).toBe('WAIT');
    expect(jupiterObservationDecision(false, 101, 100)).toBe('EXPIRED');
  });
  it('holds the owner lease until the attempt is provably resolved', async () => {
    const { run: r, review, env, wallet } = await run();
    const prepared = prepareJupiterAttempt({ ...r, authorization: review.commitment }, env.state.blockHeight);
    expect(jupiterAttemptResolved(r)).toBe(true);
    expect(jupiterAttemptResolved(prepared)).toBe(false);
    const signed = recordJupiterSignature(prepared, verifySignedJupiterTransaction(review, wallet.sign(review.unsignedTransaction)));
    const unknown = jupiterTransition(signed, 'SUBMISSION_RESULT_UNKNOWN');
    expect(jupiterAttemptResolved(unknown)).toBe(false);
    expect(jupiterAttemptResolved(jupiterTransition(unknown, 'NOT_FOUND'))).toBe(true);
    expect(jupiterAttemptResolved(jupiterTransition(prepared, 'CANCELLED'))).toBe(true);
  });
  it('detects corrupted durable runs', async () => {
    const { run: r, review, env } = await run();
    const prepared = prepareJupiterAttempt({ ...r, authorization: review.commitment }, env.state.blockHeight);
    expect(() => validateJupiterRun({ ...prepared, review: { ...prepared.review, amount: '1' } })).toThrow('JUPITER_STORE_CORRUPT');
    expect(() => validateJupiterRun({ ...prepared, attempt: { ...prepared.attempt!, state: 'PENDING' } })).toThrow('JUPITER_STORE_CORRUPT');
    expect(() => validateJupiterRun({ ...prepared, ownerInitiated: false })).toThrow('JUPITER_STORE_CORRUPT');
  });
});

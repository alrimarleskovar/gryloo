// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET as profile, SOLANA_MAINNET_TOKENS as T, createMockedSolanaJupiter, createMockedSolanaWallet, simulateJupiterSwap,
  verifySignedJupiterTransaction, type MockedJupiterOptions, type SolanaTokenSymbol } from '@defi-workflow-engine/reference-compiler';
import { createJupiterRun, jupiterTransition, prepareJupiterAttempt, recordJupiterSignature } from '../../reference-executor/src/jupiter.js';
import { buildJupiterEvidence, classifyJupiterEvidence, reconcileJupiterAttempt } from '../src/jupiter.js';

const workflow = (from: SolanaTokenSymbol, to: SolanaTokenSymbol, amount: string): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
  nodes: [createExactInputSwapNode('node-002', { chain: profile.chain, input: { chainId: profile.chain, address: T[from].mint, decimals: T[from].decimals },
    output: { chainId: profile.chain, address: T[to].mint, decimals: T[to].decimals }, amount, slippageBps: 50, protocols: ['jupiter'], maximumAmount: T[from].maximumAmount })] });
async function executed(from: SolanaTokenSymbol, to: SolanaTokenSymbol, amount: string, options: MockedJupiterOptions = {}, fundUsdt = false, afterReview: MockedJupiterOptions = {}) {
  const env = createMockedSolanaJupiter(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, { USDC: 50_000_000n, ...fundUsdt ? { USDT: 1n } : {} });
  const review = await simulateJupiterSwap(workflow(from, to, amount), wallet.owner, env.http, env.rpc);
  Object.assign(options, afterReview);
  const signed = verifySignedJupiterTransaction(review, wallet.sign(review.unsignedTransaction));
  await env.rpc('sendTransaction', [signed.transaction, { encoding: 'base64' }]);
  return { env, wallet, review, attempt: signed };
}
describe('independent Jupiter reconciliation (MOCKED chain)', () => {
  it('reconciles USDC→SOL from finalized balances, fee and the exact owner-signed bytes', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000');
    const o = await reconcileJupiterAttempt(review, attempt, env.rpc);
    expect(o).toMatchObject({ verdict: 'RECONCILED', reason: 'JUPITER_TRANSACTION_AND_BALANCES_VERIFIED', inputSpent: '10000000', outputReceived: review.quote.outAmount,
      feeLamports: review.estimatedFeeLamports, confirmation: 'finalized', accountCreationLamports: '0' });
    expect(o.programs).toContain(profile.programs.jupiter);
  });
  it('reconciles SOL input and a new output token-account deposit', async () => {
    const sol = await executed('SOL', 'USDC', '100000000');
    expect(await reconcileJupiterAttempt(sol.review, sol.attempt, sol.env.rpc)).toMatchObject({ verdict: 'RECONCILED', inputSpent: '100000000' });
    const usdt = await executed('USDC', 'USDT', '1000000');
    expect(await reconcileJupiterAttempt(usdt.review, usdt.attempt, usdt.env.rpc)).toMatchObject({ verdict: 'RECONCILED', accountCreationLamports: '2039280', outputReceived: '1000000' });
  });
  it('treats a failed on-chain transaction as divergent and charges only the fee', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000', {}, false, { failSwap: true });
    const o = await reconcileJupiterAttempt(review, attempt, env.rpc);
    expect(o).toMatchObject({ verdict: 'DIVERGENT', reason: 'JUPITER_SWAP_FAILED', found: true, feeLamports: review.estimatedFeeLamports });
    expect(env.state.tokens.get(env.ata(review.owner, T.USDC.mint))!.amount).toBe(50_000_000n);
  });
  it('reports a swap failure on chain as JUPITER_SWAP_FAILED', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000');
    const t = env.state.transactions.get(attempt.signature)!; t.err = { InstructionError: [4, { Custom: 6001 }] };
    expect(await reconcileJupiterAttempt(review, attempt, env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'JUPITER_SWAP_FAILED' });
  });
  it('fails closed on balance-delta mismatch and minimum-output violation', async () => {
    const leak = await executed('USDC', 'SOL', '10000000', {}, false, { extraInputDebit: 1n });
    expect(await reconcileJupiterAttempt(leak.review, leak.attempt, leak.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'JUPITER_INPUT_DELTA_MISMATCH' });
    const ok = await executed('USDC', 'SOL', '10000000');
    const stricter = { ...ok.review, quote: { ...ok.review.quote, otherAmountThreshold: (BigInt(ok.review.quote.outAmount) + 1n).toString() } };
    expect(await reconcileJupiterAttempt(stricter, ok.attempt, ok.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'JUPITER_MINIMUM_OUTPUT_VIOLATED' });
  });
  it('fails closed on unrelated owner asset movement', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000', {}, true);
    const t = env.state.transactions.get(attempt.signature)!;
    const usdt = env.ata(review.owner, T.USDT.mint);
    t.keys.push(usdt); t.pre.push(2039280n); t.post.push(2039280n);
    t.preTokens.push({ accountIndex: t.keys.length - 1, mint: T.USDT.mint, owner: review.owner, uiTokenAmount: { amount: '5', decimals: 6 } });
    t.postTokens.push({ accountIndex: t.keys.length - 1, mint: T.USDT.mint, owner: review.owner, uiTokenAmount: { amount: '0', decimals: 6 } });
    t.loaded.readonly.push(usdt);
    const o = await reconcileJupiterAttempt(review, attempt, env.rpc);
    expect(o.verdict).toBe('DIVERGENT');
  });
  it('stays inconclusive before finality and when the signature is not observed', async () => {
    const pending = await executed('USDC', 'SOL', '10000000', { confirmationDelay: 5 });
    expect(await reconcileJupiterAttempt(pending.review, pending.attempt, pending.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'AWAITING_FINALITY', found: true });
    pending.env.advance(5);
    expect((await reconcileJupiterAttempt(pending.review, pending.attempt, pending.env.rpc)).verdict).toBe('RECONCILED');
    const dropped = await executed('USDC', 'SOL', '10000000', { send: 'DROPPED' });
    expect(await reconcileJupiterAttempt(dropped.review, dropped.attempt, dropped.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED', found: false });
  });
  it('rejects a wrong cluster and a signature that does not belong to the signed bytes', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000');
    const wrong = async (m: string, p: readonly unknown[]) => m === 'getGenesisHash' ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' : env.rpc(m, p);
    expect(await reconcileJupiterAttempt(review, attempt, wrong)).toMatchObject({ verdict: 'DIVERGENT', reason: 'SOLANA_WRONG_CLUSTER' });
    const other = await executed('USDC', 'SOL', '10000000');
    expect(await reconcileJupiterAttempt(review, { signature: attempt.signature, transaction: other.attempt.transaction }, env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'JUPITER_SIGNATURE_MISMATCH' });
  });
  it('builds a schema-valid MOCKED Evidence Bundle and classifies evidence honestly', async () => {
    const { env, review, attempt } = await executed('USDC', 'SOL', '10000000');
    const observation = await reconcileJupiterAttempt(review, attempt, env.rpc);
    let run = createJupiterRun('jupiter-' + '1'.repeat(32), review, 'MOCKED');
    run = prepareJupiterAttempt({ ...run, authorization: review.commitment }, env.state.blockHeight - 1);
    run = jupiterTransition(recordJupiterSignature(run, attempt), 'PENDING');
    run = jupiterTransition(run, 'CONFIRMED', { reconciled: true });
    const evidence = buildJupiterEvidence({ id: run.id, review, journal: run.journal, provenance: 'MOCKED', ownerInitiated: true, observation });
    expect(evidence.bundle.environment).toBe('MOCKED');
    expect(evidence.evidenceClass).toBe('MOCKED');
    expect(hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(evidence.bundle)))).toBe(evidence.bundleHash);
    expect(classifyJupiterEvidence({ provenance: 'MOCKED', ownerInitiated: true, observation })).toBe('MOCKED');
    expect(classifyJupiterEvidence({ provenance: 'PUBLIC_MAINNET', ownerInitiated: false, observation: null })).toBe('PUBLIC_READ_ONLY');
    expect(classifyJupiterEvidence({ provenance: 'PUBLIC_MAINNET', ownerInitiated: true, observation: { ...observation, verdict: 'INCONCLUSIVE' } })).toBe('PUBLIC_READ_ONLY');
    expect(classifyJupiterEvidence({ provenance: 'PUBLIC_MAINNET', ownerInitiated: true, observation })).toBe('PUBLIC_EXECUTED');
    expect(() => buildJupiterEvidence({ id: run.id, review, journal: run.journal, provenance: 'MOCKED', ownerInitiated: true, observation: { ...observation, verdict: 'INCONCLUSIVE' } })).toThrow('JUPITER_EVIDENCE_NOT_RECONCILED');
  });
});

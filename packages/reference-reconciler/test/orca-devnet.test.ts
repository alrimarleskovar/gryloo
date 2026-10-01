// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET as profile, SOLANA_DEVNET_TOKENS as T, createMockedSolanaDevnetOrca, createMockedSolanaWallet, simulateOrcaDevnetSwap,
  verifySignedOrcaDevnetTransaction, type MockedOrcaOptions } from '@defi-workflow-engine/reference-compiler';
import { createSolanaSwapRun, prepareSolanaSwapAttempt, recordSolanaSwapSignature, solanaSwapTransition } from '../../reference-executor/src/jupiter.js';
import { buildSolanaSwapEvidence, classifySolanaSwapEvidence, reconcileSolanaSwapAttempt } from '../src/jupiter.js';

type Symbol = keyof typeof T;
const workflow = (from: Symbol, amount: string): SemanticWorkflow => {
  const to: Symbol = from === 'SOL' ? 'devUSDC' : 'SOL';
  return { schemaVersion: '1.0.0', workflowId: 'devnet-demo', revision: 1, resourceEdges: [], nodes: [createExactInputSwapNode('node-002', { chain: profile.chain,
    input: { chainId: profile.chain, address: T[from].mint, decimals: T[from].decimals }, output: { chainId: profile.chain, address: T[to].mint, decimals: T[to].decimals },
    amount, slippageBps: 50, protocols: ['orca-whirlpools'], maximumAmount: T[from].maximumAmount })] };
};
async function executed(from: Symbol, amount: string, options: MockedOrcaOptions = {}, afterReview: MockedOrcaOptions = {}, devUsdc = 50_000_000n) {
  const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, devUsdc);
  const review = await simulateOrcaDevnetSwap(workflow(from, amount), wallet.owner, env.rpc);
  Object.assign(options, afterReview);
  const signed = verifySignedOrcaDevnetTransaction(review, wallet.sign(review.unsignedTransaction));
  await env.rpc('sendTransaction', [signed.transaction, { encoding: 'base64' }]);
  return { env, wallet, review, attempt: signed };
}
describe('independent Solana Devnet reconciliation (MOCKED Devnet loopback)', () => {
  it('reconciles SOL → devUSDC: cluster, owner, exact bytes, Orca program, token accounts, deltas, fee and the Traded event', async () => {
    const { env, review, attempt } = await executed('SOL', '100000000', {}, {}, 0n);
    const o = await reconcileSolanaSwapAttempt(review, attempt, env.rpc);
    expect(o).toMatchObject({ verdict: 'RECONCILED', reason: 'DEVNET_SWAP_TRANSACTION_AND_BALANCES_VERIFIED', inputSpent: '100000000', outputReceived: review.quote.outAmount,
      feeLamports: '5000', confirmation: 'finalized', accountCreationLamports: '2039280', minimumOutput: review.quote.otherAmountThreshold,
      explorer: `https://explorer.solana.com/tx/${attempt.signature}?cluster=devnet` });
    expect(o.programs).toContain(profile.programs.whirlpool);
    expect(o.innerPrograms).toContain(profile.programs.token);
    expect(o.trade).toMatchObject({ whirlpool: profile.pool.address, aToB: true, inputAmount: '100000000', outputAmount: review.quote.outAmount });
    expect(o.owner).toMatchObject({ outputBefore: '0', outputAfter: review.quote.outAmount });
  });
  it('reconciles devUSDC → SOL with a native output measured on owner lamports', async () => {
    const { env, review, attempt } = await executed('devUSDC', '10000000');
    expect(await reconcileSolanaSwapAttempt(review, attempt, env.rpc)).toMatchObject({ verdict: 'RECONCILED', inputSpent: '10000000', outputReceived: review.quote.outAmount,
      accountCreationLamports: '0', owner: { inputBefore: '50000000', inputAfter: '40000000' } });
  });
  it('a failed Devnet transaction is divergent and moves only the fee', async () => {
    const { env, review, attempt } = await executed('devUSDC', '10000000', {}, { failSwap: true });
    expect(await reconcileSolanaSwapAttempt(review, attempt, env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'DEVNET_SWAP_SWAP_FAILED', found: true, feeLamports: '5000' });
    expect(env.state.tokens.get(env.ata(review.owner, T.devUSDC.mint))!.amount).toBe(50_000_000n);
  });
  it('fails closed on input or owner SOL balance mismatch, minimum-output violation and a mismatched Traded event', async () => {
    const leak = await executed('devUSDC', '10000000', {}, { extraInputDebit: 1n });
    expect(await reconcileSolanaSwapAttempt(leak.review, leak.attempt, leak.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'DEVNET_SWAP_INPUT_DELTA_MISMATCH' });
    const lamports = await executed('SOL', '100000000', {}, { extraOwnerDebit: 7n });
    expect(await reconcileSolanaSwapAttempt(lamports.review, lamports.attempt, lamports.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'DEVNET_SWAP_INPUT_DELTA_MISMATCH' });
    const ok = await executed('SOL', '100000000');
    const stricter = { ...ok.review, quote: { ...ok.review.quote, otherAmountThreshold: (BigInt(ok.review.quote.outAmount) + 1n).toString() } };
    expect(await reconcileSolanaSwapAttempt(stricter, ok.attempt, ok.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'DEVNET_SWAP_MINIMUM_OUTPUT_VIOLATED' });
    const silent = await executed('SOL', '100000000', {}, { noTradeEvent: true });
    expect(await reconcileSolanaSwapAttempt(silent.review, silent.attempt, silent.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'ORCA_TRADE_EVENT_MISMATCH' });
  });
  it('rejects a mainnet RPC, another transaction for the signature, and stays inconclusive before finality or observation', async () => {
    const { env, review, attempt } = await executed('SOL', '100000000');
    const mainnet = async (m: string, p: readonly unknown[]) => m === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : env.rpc(m, p);
    expect(await reconcileSolanaSwapAttempt(review, attempt, mainnet)).toMatchObject({ verdict: 'DIVERGENT', reason: 'SOLANA_WRONG_CLUSTER' });
    const other = await executed('SOL', '100000000');
    expect(await reconcileSolanaSwapAttempt(review, { signature: attempt.signature, transaction: other.attempt.transaction }, env.rpc))
      .toMatchObject({ verdict: 'DIVERGENT', reason: 'DEVNET_SWAP_SIGNATURE_MISMATCH' });
    const pending = await executed('SOL', '100000000', { confirmationDelay: 5 });
    expect(await reconcileSolanaSwapAttempt(pending.review, pending.attempt, pending.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'AWAITING_FINALITY' });
    const dropped = await executed('SOL', '100000000', { send: 'DROPPED' });
    expect(await reconcileSolanaSwapAttempt(dropped.review, dropped.attempt, dropped.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED' });
  });
  it('classifies Devnet evidence as DEVNET_EXECUTED, never MAINNET_EXECUTED, and builds a schema-valid bundle', async () => {
    const { env, review, attempt } = await executed('SOL', '100000000');
    const observation = await reconcileSolanaSwapAttempt(review, attempt, env.rpc);
    let run = createSolanaSwapRun('orca-' + '2'.repeat(32), review, 'PUBLIC_DEVNET');
    expect(run.format).toBe('gryloo.orca-devnet-run.v1');
    run = prepareSolanaSwapAttempt({ ...run, authorization: review.commitment }, env.state.blockHeight - 1);
    run = solanaSwapTransition(recordSolanaSwapSignature(run, attempt), 'PENDING');
    run = solanaSwapTransition(run, 'CONFIRMED', { reconciled: true });
    // Fixture != DEVNET_EXECUTED: this proves the classifier and bundle shape only; it is a MOCKED chain.
    const evidence = buildSolanaSwapEvidence({ id: run.id, review, journal: run.journal, provenance: 'PUBLIC_DEVNET', ownerInitiated: true, observation });
    expect(evidence.evidenceClass).toBe('DEVNET_EXECUTED');
    expect(evidence.bundle.environment).toBe('TESTNET_EXECUTED');
    expect(evidence.publicExecution).toMatchObject({ environment: 'DEVNET_EXECUTED', cluster: 'devnet', network: 'Solana Devnet', provider: 'Orca Whirlpools swap_v2 (Solana Devnet)',
      providerProgram: profile.programs.whirlpool, pool: profile.pool.address, realFunds: false, signature: attempt.signature, slot: observation.slot, feeLamports: '5000',
      inputMint: T.SOL.mint, outputMint: T.devUSDC.mint, requestedInput: '100000000', expectedOutput: review.quote.outAmount, minimumOutput: review.quote.otherAmountThreshold,
      actualInputDelta: '100000000', actualOutputDelta: review.quote.outAmount, verdict: 'RECONCILED' });
    expect(JSON.stringify(evidence)).not.toContain('MAINNET_EXECUTED');
    expect(hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(evidence.bundle)))).toBe(evidence.bundleHash);
    const mocked = buildSolanaSwapEvidence({ id: run.id, review, journal: run.journal, provenance: 'MOCKED', ownerInitiated: true, observation });
    expect([mocked.evidenceClass, mocked.bundle.environment]).toEqual(['MOCKED', 'MOCKED']);
    expect(() => buildSolanaSwapEvidence({ id: run.id, review, journal: run.journal, provenance: 'PUBLIC_MAINNET', ownerInitiated: true, observation })).toThrow('DEVNET_SWAP_EVIDENCE_PROVENANCE_MISMATCH');
    expect(classifySolanaSwapEvidence({ provenance: 'PUBLIC_DEVNET', ownerInitiated: false, observation })).toBe('PUBLIC_READ_ONLY');
    expect(classifySolanaSwapEvidence({ provenance: 'PUBLIC_DEVNET', ownerInitiated: true, observation: { ...observation, verdict: 'DIVERGENT' } })).toBe('PUBLIC_READ_ONLY');
    expect(classifySolanaSwapEvidence({ provenance: 'PUBLIC_MAINNET', ownerInitiated: true, observation })).toBe('PUBLIC_EXECUTED');
  });
});

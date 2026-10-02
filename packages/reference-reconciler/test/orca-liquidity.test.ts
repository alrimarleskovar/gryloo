// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createConcentratedLiquidityNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { base58Encode, createMockedSolanaDevnetOrca, createMockedSolanaWallet, fromBase64, parseTransaction, serializeSignedTransaction, simulateOrcaLiquidity, toBase64,
  type MockedOrcaOptions, type OrcaLiquidityReview, type SolanaRpc } from '@defi-workflow-engine/reference-compiler';
import { createOrcaLiquidityRun, prepareOrcaLiquidityAttempt } from '../../reference-executor/src/orca-liquidity.js';
import { buildOrcaLiquidityEvidence, classifyOrcaLiquidityEvidence, reconcileOrcaLiquidityAttempt } from '../src/index.js';

const chain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'w', revision: 1, resourceEdges: [], nodes: [createConcentratedLiquidityNode('node-002', { chain,
  token0: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, token1: { chainId: chain, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 },
  amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0', tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100,
  protocols: ['orca-whirlpools'], recipient: null, positionAsset: { chainId: chain, address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', decimals: 0 } })] };
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
async function landed(options: MockedOrcaOptions = {}) {
  options = { ...options };
  const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
  const secret = ed25519.utils.randomSecretKey(), mint = base58Encode(ed25519.getPublicKey(secret));
  const send = async (review: OrcaLiquidityReview, withMint: boolean) => {
    const { signatures, message } = parseTransaction(fromBase64(wallet.sign(review.unsignedTransaction), 2048));
    const transaction = toBase64(serializeSignedTransaction(withMint ? [signatures[0]!, ed25519.sign(message, secret)] : [signatures[0]!], message));
    const signature = await env.rpc('sendTransaction', [transaction, {}]) as string;
    return { signature, transaction };
  };
  const open = await simulateOrcaLiquidity(workflow, wallet.owner, { operation: 'OPEN', positionMint: mint }, env.rpc, NOW);
  return { env, wallet, mint, send, open, options, openAttempt: await send(open, true) };
}
/** Rewrites the finalized getTransaction result: a model of a lying or compromised RPC/provider. */
const tamper = (rpc: SolanaRpc, edit: (tx: Record<string, unknown>) => void): SolanaRpc => async (method, params) => {
  const value = await rpc(method, params);
  if (method !== 'getTransaction' || !value) return value;
  const copy = structuredClone(value) as Record<string, unknown>; edit(copy); return copy;
};
const meta = (tx: Record<string, unknown>) => tx.meta as Record<string, unknown[] | unknown>;
describe('Orca liquidity independent reconciliation (MOCKED Devnet loopback)', () => {
  it('reconciles open, partial removal with fee collection and exit from finalized transaction facts only', async () => {
    const s = await landed({ accrueFees: { a: '777', b: '33' } });
    const opened = await reconcileOrcaLiquidityAttempt(s.open, s.openAttempt, s.env.rpc);
    expect(opened).toMatchObject({ verdict: 'RECONCILED', confirmation: 'finalized', instructions: s.open.instructionSummary.map(i => i.name), signers: [s.wallet.owner, s.mint],
      positionAuthority: { owner: s.wallet.owner, amount: '1' }, effects: { depositedA: s.open.expected.amountA, depositedB: s.open.expected.amountB } });
    expect(opened.events.map(e => e.kind)).toEqual(['PositionOpened', 'LiquidityIncreased']);
    const decrease = await simulateOrcaLiquidity(workflow, s.wallet.owner, { operation: 'DECREASE_PARTIAL', positionMint: s.mint, partBps: 2500 }, s.env.rpc, NOW);
    const d = await reconcileOrcaLiquidityAttempt(decrease, await s.send(decrease, false), s.env.rpc);
    expect(d.verdict).toBe('RECONCILED');
    // Principal from the LiquidityDecreased event; fees are only the extra vault outflow.
    expect(d.effects).toMatchObject({ withdrawnPrincipalA: d.events[0]!.tokenA, withdrawnPrincipalB: d.events[0]!.tokenB, collectedFeesA: '777', collectedFeesB: '33' });
    const exit = await simulateOrcaLiquidity(workflow, s.wallet.owner, { operation: 'EXIT', positionMint: s.mint }, s.env.rpc, NOW);
    const e = await reconcileOrcaLiquidityAttempt(exit, await s.send(exit, false), s.env.rpc);
    expect(e).toMatchObject({ verdict: 'RECONCILED', effects: { collectedFeesA: '0', collectedFeesB: '0', closedAccounts: [exit.accounts.position, s.mint, exit.accounts.positionTokenAccount] } });
    expect(e.effects!.rentRefundedLamports).toBe(opened.effects!.rentPaidLamports);
  });
  it.each([
    ['an unexpected inner program (Memo)', (tx: Record<string, unknown>) => { (meta(tx).innerInstructions as unknown[]).push({ index: 6,
      instructions: [{ programIdIndex: memoIndex(tx), accounts: [], data: '' }] }); }, 'ORCA_LIQUIDITY_UNEXPECTED_PROGRAM'],
    ['an unexplained token movement', (tx: Record<string, unknown>) => { (meta(tx).postTokenBalances as unknown[]).push({ accountIndex: 1, mint: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k',
      owner: '11111111111111111111111111111112', programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', uiTokenAmount: { amount: '5', decimals: 6 } }); }, 'ORCA_LIQUIDITY_UNEXPECTED_TOKEN_MOVEMENT'],
    ['an unexplained lamport movement', (tx: Record<string, unknown>) => { const post = meta(tx).postBalances as number[]; post[post.length - 1] = post.at(-1)! + 1; }, 'ORCA_LIQUIDITY_UNEXPECTED_LAMPORT_MOVEMENT'],
    ['an owner balance that does not match the events', (tx: Record<string, unknown>) => { const post = meta(tx).postBalances as number[]; post[0] = post[0]! - 1; }, 'ORCA_LIQUIDITY_BALANCE_MISMATCH'],
    ['different on-chain bytes', (tx: Record<string, unknown>) => { const t = tx.transaction as [string, string]; const b = fromBase64(t[0], 2048); b[100] = b[100]! ^ 1; t[0] = toBase64(b); }, 'ORCA_LIQUIDITY_TRANSACTION_MISMATCH'],
    ['a fee above the review', (tx: Record<string, unknown>) => { meta(tx).fee = 20_000; }, 'ORCA_LIQUIDITY_FEE_MISMATCH'],
    ['a missing Orca event', (tx: Record<string, unknown>) => { meta(tx).logMessages = (meta(tx).logMessages as string[]).filter(l => !l.startsWith('Program data:')); }, 'ORCA_LIQUIDITY_EVENT_MISMATCH'],
    ['the position token held by someone else', (tx: Record<string, unknown>) => { for (const b of meta(tx).postTokenBalances as { programId?: string; owner: string }[])
      if (b.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') b.owner = '11111111111111111111111111111112'; }, 'ORCA_POSITION_AUTHORITY_MISMATCH'],
  ])('fails closed (DIVERGENT) on %s', async (_n, edit, reason) => {
    const s = await landed();
    const rpc = tamper(s.env.rpc, edit);
    const observation = await reconcileOrcaLiquidityAttempt(s.open, s.openAttempt, rpc);
    expect(observation).toMatchObject({ verdict: 'DIVERGENT', reason });
  });
  it('stays INCONCLUSIVE until finality, reports failed transactions and refuses the wrong cluster', async () => {
    const s = await landed({ confirmationDelay: 5 });
    expect(await reconcileOrcaLiquidityAttempt(s.open, s.openAttempt, s.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: 'AWAITING_FINALITY', found: true });
    expect(await reconcileOrcaLiquidityAttempt(s.open, { signature: null, transaction: null }, s.env.rpc)).toMatchObject({ verdict: 'INCONCLUSIVE', found: false });
    const failing = await landed();
    const exit = await simulateOrcaLiquidity(workflow, failing.wallet.owner, { operation: 'EXIT', positionMint: failing.mint }, failing.env.rpc, NOW);
    failing.options.failLiquidity = true;
    const attempt = await failing.send(exit, false);
    expect(await reconcileOrcaLiquidityAttempt(exit, attempt, failing.env.rpc)).toMatchObject({ verdict: 'DIVERGENT', reason: 'ORCA_LIQUIDITY_TRANSACTION_FAILED', transactionFailed: true });
    const wrong: SolanaRpc = async (m, p) => m === 'getGenesisHash' ? '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' : failing.env.rpc(m, p);
    expect(await reconcileOrcaLiquidityAttempt(failing.open, failing.openAttempt, wrong)).toMatchObject({ verdict: 'DIVERGENT', reason: 'SOLANA_WRONG_CLUSTER' });
  });
  it('classifies evidence honestly and builds a schema-valid bundle: Devnet maps to TESTNET_EXECUTED, never MAINNET_EXECUTED', async () => {
    const s = await landed();
    const observation = await reconcileOrcaLiquidityAttempt(s.open, s.openAttempt, s.env.rpc);
    expect(classifyOrcaLiquidityEvidence({ provenance: 'MOCKED', ownerInitiated: true, observation })).toBe('MOCKED');
    expect(classifyOrcaLiquidityEvidence({ provenance: 'PUBLIC_DEVNET', ownerInitiated: false, observation })).toBe('PUBLIC_READ_ONLY');
    expect(classifyOrcaLiquidityEvidence({ provenance: 'PUBLIC_DEVNET', ownerInitiated: true, observation: { ...observation, verdict: 'DIVERGENT' } })).toBe('PUBLIC_READ_ONLY');
    expect(classifyOrcaLiquidityEvidence({ provenance: 'PUBLIC_DEVNET', ownerInitiated: true, observation })).toBe('DEVNET_EXECUTED');
    const run = prepareOrcaLiquidityAttempt({ ...createOrcaLiquidityRun('orcalp-' + 'a'.repeat(32), s.open, 'PUBLIC_DEVNET'), authorization: s.open.commitment }, 380_000_000);
    const evidence = buildOrcaLiquidityEvidence({ id: run.id, review: s.open, journal: run.journal, provenance: 'PUBLIC_DEVNET', ownerInitiated: true, observation, lifecycle: { positionMint: s.mint } });
    expect(evidence).toMatchObject({ evidenceClass: 'DEVNET_EXECUTED', bundle: { environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED' },
      publicExecution: { environment: 'DEVNET_EXECUTED', realFunds: false, network: 'Solana Devnet', operation: 'OPEN', positionMint: s.mint } });
    expect(JSON.stringify(evidence)).not.toContain('MAINNET_EXECUTED');
    expect(evidence.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => buildOrcaLiquidityEvidence({ id: run.id, review: s.open, journal: run.journal, provenance: 'PUBLIC_DEVNET', ownerInitiated: true,
      observation: { ...observation, verdict: 'INCONCLUSIVE' }, lifecycle: null })).toThrow('ORCA_LIQUIDITY_EVIDENCE_NOT_RECONCILED');
  });
});
function memoIndex(tx: Record<string, unknown>): number {
  const bytes = fromBase64((tx.transaction as [string])[0], 2048), { message } = parseTransaction(bytes);
  // Static keys follow the 4-byte prefix (version, header) and compact length; find the memo key by decoding the message.
  const count = message[4]!, keys = Array.from({ length: count }, (_, i) => base58Encode(message.slice(5 + i * 32, 37 + i * 32)));
  return keys.indexOf('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
}

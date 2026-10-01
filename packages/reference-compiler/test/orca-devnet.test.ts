// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET as profile, SOLANA_DEVNET_TOKENS as T, SOLANA_MAINNET_CHAIN } from '@defi-workflow-engine/action-registry';
import { decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, serializeTransaction, toBase64 } from '../src/solana.js';
import { assertOrcaDevnetReview, decodeOrcaSwapV2, decodeWhirlpool, encodeOrcaSwapV2, orcaDevnetIntent, orcaTickArrayStarts, parseOrcaTradedEvents,
  simulateOrcaDevnetSwap, verifySignedOrcaDevnetTransaction } from '../src/orca-whirlpool.js';
import { createMockedSolanaDevnetOrca } from '../src/orca-mock.js';
import { createMockedSolanaWallet } from '../src/jupiter-mock.js';
import { solanaSwapHash } from '../src/solana-swap.js';

const chain = profile.chain;
const asset = (symbol: keyof typeof T, on = chain) => ({ chainId: on, address: T[symbol].mint, decimals: T[symbol].decimals });
function workflow(from: keyof typeof T, amount: string, slippageBps = 50, patch: Partial<Parameters<typeof createExactInputSwapNode>[1]> = {}): SemanticWorkflow {
  const to = from === 'SOL' ? 'devUSDC' : 'SOL';
  return { schemaVersion: '1.0.0', workflowId: 'devnet-demo', revision: 1, resourceEdges: [], nodes: [createExactInputSwapNode('node-002', { chain, input: asset(from),
    output: asset(to), amount, slippageBps, protocols: ['orca-whirlpools'], maximumAmount: T[from].maximumAmount, ...patch })] };
}
const fixture = JSON.parse(readFileSync(new URL('./fixtures/orca-devnet-pool.json', import.meta.url), 'utf8')) as {
  pool: { address: string; slot: number; owner: string; data: string }; trade: { signature: string; logMessages: string[] } };

describe('Orca Whirlpools Devnet codec (PUBLIC_READ_ONLY Devnet fixture)', () => {
  it('decodes the real Devnet test pool and a real Traded event', () => {
    const pool = decodeWhirlpool(fixture.pool.address, fromBase64(fixture.pool.data, 4096), fixture.pool.slot);
    expect(fixture.pool.owner).toBe(profile.programs.whirlpool);
    expect(pool).toMatchObject({ whirlpoolsConfig: profile.whirlpoolsConfig, tickSpacing: 64, tokenMintA: T.SOL.mint, tokenMintB: T.devUSDC.mint,
      tokenVaultA: profile.pool.tokenVaultA, tokenVaultB: profile.pool.tokenVaultB });
    expect(BigInt(pool.liquidity)).toBeGreaterThan(0n);
    const events = parseOrcaTradedEvents(fixture.trade.logMessages);
    expect(events).toHaveLength(1);
    expect(events[0]!.whirlpool).toBe(profile.pool.address);
    expect(BigInt(events[0]!.inputAmount)).toBeGreaterThan(0n);
    expect(() => decodeWhirlpool(fixture.pool.address, new Uint8Array(653), 1)).toThrow('ORCA_POOL_INVALID');
  });
  it('derives the program tick-array sequence and round-trips exact-input swap_v2 data', () => {
    expect(orcaTickArrayStarts(-38_008, 64, true)).toEqual([-39_424, -45_056, -50_688]);
    expect(orcaTickArrayStarts(-38_008, 64, false)).toEqual([-39_424, -33_792, -28_160]);
    expect(orcaTickArrayStarts(-33_800, 64, false)).toEqual([-33_792, -28_160, -22_528]); // shifted at the array edge
    const data = encodeOrcaSwapV2({ amount: '100000000', otherAmountThreshold: '2220186', aToB: true });
    expect(Buffer.from(data.slice(0, 8)).toString('hex')).toBe('2b04ed0b1ac91e62');
    expect(decodeOrcaSwapV2(data)).toEqual({ amount: '100000000', otherAmountThreshold: '2220186', sqrtPriceLimit: '0', amountSpecifiedIsInput: true, aToB: true });
    expect(() => decodeOrcaSwapV2(data.slice(0, 42))).toThrow('ORCA_SWAP_INSTRUCTION_UNSUPPORTED');
  });
});

describe('canonical swap on Solana Devnet', () => {
  const owner = createMockedSolanaWallet().owner;
  it('reads the same canonical IR with Devnet identity and the Orca provider only', () => {
    const intent = orcaDevnetIntent(workflow('devUSDC', '10000000'), owner);
    expect(intent).toMatchObject({ nodeId: 'node-002', amount: '10000000', slippageBps: 50, input: { symbol: 'devUSDC' }, output: { symbol: 'SOL' } });
    const node = workflow('devUSDC', '10000000').nodes[0]!;
    expect(node).toMatchObject({ actionType: 'asset.swap.exact-input', chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', requiredCapabilities: ['swap.direct-transaction'],
      adapterConstraints: { adapters: [], protocols: ['orca-whirlpools'] } });
  });
  it.each([
    ['wrong cluster', workflow('SOL', '1000', 50, { chain: SOLANA_MAINNET_CHAIN, input: asset('SOL', SOLANA_MAINNET_CHAIN), output: asset('devUSDC', SOLANA_MAINNET_CHAIN) }), 'SOLANA_CLUSTER_UNSUPPORTED'],
    ['wrong token', workflow('SOL', '1000', 50, { output: { chainId: chain, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 } }), 'SOLANA_MINT_UNSUPPORTED'],
    ['wrong decimals', workflow('SOL', '1000', 50, { output: { ...asset('devUSDC'), decimals: 9 } }), 'SOLANA_MINT_UNSUPPORTED'],
    ['Jupiter on Devnet', workflow('SOL', '1000', 50, { protocols: ['jupiter'] }), 'SOLANA_SWAP_PROVIDER_UNSUPPORTED'],
    ['excessive slippage', workflow('SOL', '1000', 301), 'SOLANA_SLIPPAGE_OUT_OF_RANGE'],
  ])('rejects %s', (_name, wf, code) => expect(() => orcaDevnetIntent(wf, owner)).toThrow(code));
});

describe('Orca Devnet simulation, Review and signature binding (MOCKED loopback)', () => {
  function setup(options: Parameters<typeof createMockedSolanaDevnetOrca>[0] = {}) {
    const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
    env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
    return { env, wallet };
  }
  it('quotes SOL → devUSDC by exact-message simulation and binds an owner-only exact-input message', async () => {
    const { env, wallet } = setup(), wf = workflow('SOL', '100000000', 50);
    const review = await simulateOrcaDevnetSwap(wf, wallet.owner, env.rpc, Date.parse('2026-10-01T18:00:00Z'));
    const quoted = env.quoteFor(true, 100_000_000n);
    expect(review).toMatchObject({ format: 'gryloo.orca-devnet-review.v1', cluster: 'devnet', provider: 'Orca Whirlpools', amount: '100000000', estimatedFeeLamports: '5000',
      quote: { outAmount: quoted.toString(), otherAmountThreshold: (quoted * 9_950n / 10_000n).toString(), slippageBps: 50 } });
    expect(review.simulationResult).toMatchObject({ inputSpent: '100000000', outputReceived: quoted.toString(), feeLamports: '5000' });
    expect(review.simulatedTrade).toMatchObject({ whirlpool: profile.pool.address, aToB: true, inputAmount: '100000000', outputAmount: quoted.toString() });
    const instructions = decompileMessageV0(parseMessageV0(fromBase64(review.message)), {});
    expect(instructions.map(i => i.programId)).toEqual([profile.programs.computeBudget, profile.programs.associatedToken, profile.programs.system, profile.programs.token,
      profile.programs.associatedToken, profile.programs.whirlpool, profile.programs.token]);
    const swap = instructions.find(i => i.programId === profile.programs.whirlpool)!;
    expect(decodeOrcaSwapV2(swap.data)).toMatchObject({ amount: '100000000', otherAmountThreshold: review.quote.otherAmountThreshold, amountSpecifiedIsInput: true, aToB: true });
    expect(swap.accounts[3]).toMatchObject({ pubkey: wallet.owner, isSigner: true });
    expect(instructions.flatMap(i => i.accounts).filter(a => a.isSigner).every(a => a.pubkey === wallet.owner)).toBe(true);
    expect(review.manifest.owner).toEqual({ chainId: chain, address: wallet.owner });
    expect(review.plan.segments[0]!.steps[0]).toMatchObject({ adapter: { id: 'orca.whirlpools-devnet' }, payloadHash: review.messageHash });
    expect(env.state.sent).toHaveLength(0);
  });
  it('quotes devUSDC → SOL and requires the devUSDC input', async () => {
    const { env, wallet } = setup();
    const review = await simulateOrcaDevnetSwap(workflow('devUSDC', '10000000'), wallet.owner, env.rpc);
    expect(review.quote.outAmount).toBe(env.quoteFor(false, 10_000_000n).toString());
    expect(review.inspection.swap.aToB).toBe(false);
    await expect(simulateOrcaDevnetSwap(workflow('devUSDC', '60000000'), wallet.owner, env.rpc)).rejects.toThrow('DEVNET_SWAP_INSUFFICIENT_DEVUSDC');
  });
  it.each([
    ['a mainnet RPC', { cluster: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }, 'SOLANA_WRONG_CLUSTER'],
    ['a pool under the mainnet config', { poolConfig: '2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ' }, 'ORCA_POOL_MISMATCH'],
    ['a swap without the Traded event', { noTradeEvent: true }, 'ORCA_TRADE_EVENT_MISSING'],
    ['an on-chain output below the bound', { actualOutput: () => 0n }, 'DEVNET_SWAP_SIMULATION_FAILED'],
  ])('fails closed on %s', async (_name, options, code) => {
    const { env, wallet } = setup(options as Parameters<typeof createMockedSolanaDevnetOrca>[0]);
    await expect(simulateOrcaDevnetSwap(workflow('SOL', '100000000'), wallet.owner, env.rpc)).rejects.toThrow(code);
  });
  it('requires enough Devnet SOL and refuses a pre-existing wrapped-SOL account', async () => {
    const env = createMockedSolanaDevnetOrca(), wallet = createMockedSolanaWallet();
    env.fund(wallet.owner, 100_000_000n);
    await expect(simulateOrcaDevnetSwap(workflow('SOL', '100000000'), wallet.owner, env.rpc)).rejects.toThrow('DEVNET_SWAP_INSUFFICIENT_SOL');
    env.fund(wallet.owner, 3_000_000_000n);
    env.state.tokens.set(env.ata(wallet.owner, T.SOL.mint), { mint: T.SOL.mint, owner: wallet.owner, amount: 0n });
    await expect(simulateOrcaDevnetSwap(workflow('SOL', '100000000'), wallet.owner, env.rpc)).rejects.toThrow('DEVNET_SWAP_WRAPPED_SOL_ACCOUNT_PRESENT');
  });
  it('Review rejects stale, wrong-owner, changed-semantics, tampered and changed-transaction cases', async () => {
    const { env, wallet } = setup(), wf = workflow('SOL', '100000000'), now = Date.parse('2026-10-01T18:00:00Z');
    const review = await simulateOrcaDevnetSwap(wf, wallet.owner, env.rpc, now);
    const height = env.state.blockHeight;
    expect(() => assertOrcaDevnetReview(review, wf, wallet.owner, height, now + 1000)).not.toThrow();
    expect(() => assertOrcaDevnetReview(review, wf, wallet.owner, height, now + 61_000)).toThrow('DEVNET_SWAP_QUOTE_STALE');
    expect(() => assertOrcaDevnetReview(review, wf, wallet.owner, review.lastValidBlockHeight - 20, now + 1000)).toThrow('DEVNET_SWAP_QUOTE_STALE');
    expect(() => assertOrcaDevnetReview(review, wf, createMockedSolanaWallet().owner, height, now + 1000)).toThrow('DEVNET_SWAP_WRONG_OWNER');
    expect(() => assertOrcaDevnetReview(review, { ...workflow('SOL', '100000001'), revision: 1 }, wallet.owner, height, now + 1000)).toThrow('DEVNET_SWAP_SEMANTIC_REVISION_CHANGED');
    expect(() => assertOrcaDevnetReview({ ...review, amount: '1' }, wf, wallet.owner, height, now + 1000)).toThrow('DEVNET_SWAP_AUTHORIZATION_INVALID');
    // A different message, even with a recomputed commitment, no longer matches the reviewed payload hash.
    const other = await simulateOrcaDevnetSwap(workflow('SOL', '90000000'), wallet.owner, env.rpc, now);
    const content: Omit<typeof review, 'commitment'> & { commitment?: string } = { ...review, message: other.message, unsignedTransaction: other.unsignedTransaction };
    delete content.commitment;
    expect(() => assertOrcaDevnetReview({ ...content, commitment: solanaSwapHash(content) }, wf, wallet.owner, height, now + 1000)).toThrow('DEVNET_SWAP_TRANSACTION_CHANGED');
  });
  it('accepts only the byte-identical reviewed message signed by the owner', async () => {
    const { env, wallet } = setup();
    const review = await simulateOrcaDevnetSwap(workflow('SOL', '100000000'), wallet.owner, env.rpc);
    expect(verifySignedOrcaDevnetTransaction(review, wallet.sign(review.unsignedTransaction)).signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    const other = await simulateOrcaDevnetSwap(workflow('SOL', '90000000'), wallet.owner, env.rpc);
    expect(() => verifySignedOrcaDevnetTransaction(review, wallet.sign(other.unsignedTransaction))).toThrow('DEVNET_SWAP_TRANSACTION_CHANGED');
    const stranger = createMockedSolanaWallet();
    const { message } = parseTransaction(fromBase64(review.unsignedTransaction, 2048));
    const forged = toBase64(serializeTransaction(parseTransaction(fromBase64(stranger.sign(review.unsignedTransaction), 2048)).signatures[0]!, message));
    expect(() => verifySignedOrcaDevnetTransaction(review, forged)).toThrow('DEVNET_SWAP_SIGNATURE_INVALID');
  });
});

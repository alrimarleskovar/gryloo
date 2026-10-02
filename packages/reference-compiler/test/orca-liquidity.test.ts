// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { createConcentratedLiquidityNode, type ConcentratedLiquidityFields, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_MAX_SQRT_PRICE, ORCA_MIN_SQRT_PRICE, assertOrcaLiquidityReview, base58Encode, createMockedSolanaDevnetOrca, createMockedSolanaWallet, decodeOrcaModifyLiquidity,
  decodeOrcaOpenPosition, decodeWhirlpool, encodeOrcaModifyLiquidity, encodeOrcaOpenPosition, fromBase64, orcaAlignPriceRange, orcaLiquidityAmounts, orcaLiquidityForMaxima,
  orcaPositionAddress, orcaPriceBandAround, orcaPriceFromSqrtPrice, orcaSqrtPriceAtTick, orcaSqrtPriceFromPrice, orcaTickAtSqrtPrice, parseOrcaLiquidityEvents, parseTransaction,
  serializeSignedTransaction, sha256Hex, simulateOrcaLiquidity, solanaSwapHash, summarizeOrcaLiquidityInstructions, toBase64, verifySignedOrcaLiquidityTransaction,
  type MockedOrcaOptions, type OrcaLiquidityReview } from '../src/index.js';

/** PUBLIC_READ_ONLY fixture: a read-only Devnet simulation of a Gryloo-built open→increase→decrease→collect→close message. Nothing was signed or sent. */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/orca-devnet-liquidity.json', import.meta.url), 'utf8')) as { pool: { address: string; data: string; sqrtPrice: string;
  tickCurrentIndex: number }; logs: string[]; liquidity: string; tickLower: number; tickUpper: number; position: string; positionMint: string };
const chain = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const fields: ConcentratedLiquidityFields = { chain, token0: { chainId: chain, address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  token1: { chainId: chain, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 }, amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0',
  tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100, protocols: ['orca-whirlpools'], recipient: null,
  positionAsset: { chainId: chain, address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', decimals: 0 } };
const workflow = (patch: Partial<ConcentratedLiquidityFields> = {}): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'w', revision: 1, resourceEdges: [],
  nodes: [createConcentratedLiquidityNode('node-002', { ...fields, ...patch })] });
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
function setup(options: MockedOrcaOptions = {}) {
  const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
  return { env, wallet };
}
const mintKey = () => { const secret = ed25519.utils.randomSecretKey(); return { secret, address: base58Encode(ed25519.getPublicKey(secret)) }; };
function fullySigned(wallet: ReturnType<typeof createMockedSolanaWallet>, review: OrcaLiquidityReview, mint: ReturnType<typeof mintKey> | null) {
  const { signatures, message } = parseTransaction(fromBase64(wallet.sign(review.unsignedTransaction), 2048));
  return toBase64(serializeSignedTransaction(mint ? [signatures[0]!, ed25519.sign(message, mint.secret)] : [signatures[0]!], message));
}
async function landOpen(s: ReturnType<typeof setup>) {
  const mint = mintKey();
  const review = await simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: mint.address }, s.env.rpc, NOW);
  await s.env.rpc('sendTransaction', [fullySigned(s.wallet, review, mint), {}]);
  return { mint, review };
}

describe('Orca integer math (bit-identical to programs/whirlpool/src/math)', () => {
  it('matches the program bounds and inverts exactly', () => {
    expect(orcaSqrtPriceAtTick(443_636)).toBe(ORCA_MAX_SQRT_PRICE);
    expect(orcaSqrtPriceAtTick(-443_636)).toBe(ORCA_MIN_SQRT_PRICE);
    expect(orcaSqrtPriceAtTick(0)).toBe(1n << 64n);
    for (const tick of [-443_636, -38_008, -1, 0, 1, 64, 12_345, 443_636]) {
      expect(orcaTickAtSqrtPrice(orcaSqrtPriceAtTick(tick))).toBe(tick);
      if (tick < 443_636) expect(orcaSqrtPriceAtTick(tick + 1)).toBeGreaterThan(orcaSqrtPriceAtTick(tick));
    }
    expect(() => orcaSqrtPriceAtTick(443_637)).toThrow('ORCA_TICK_INVALID');
  });
  it('reproduces the deployed program’s own liquidity amounts from a real Devnet simulation (PUBLIC_READ_ONLY fixture)', () => {
    const pool = decodeWhirlpool(fixture.pool.address, fromBase64(fixture.pool.data, 4096), 0);
    expect({ sqrt: pool.sqrtPrice, tick: pool.tickCurrentIndex, spacing: pool.tickSpacing, fee: pool.feeRate }).toEqual({ sqrt: fixture.pool.sqrtPrice, tick: fixture.pool.tickCurrentIndex, spacing: 64, fee: 2000 });
    expect(orcaTickAtSqrtPrice(BigInt(pool.sqrtPrice))).toBe(pool.tickCurrentIndex);
    const events = parseOrcaLiquidityEvents(fixture.logs);
    expect(events.map(e => e.kind)).toEqual(['PositionOpened', 'LiquidityIncreased', 'LiquidityDecreased']);
    expect(events.every(e => e.whirlpool === fixture.pool.address && e.position === fixture.position && e.tickLower === fixture.tickLower && e.tickUpper === fixture.tickUpper)).toBe(true);
    expect(orcaPositionAddress(fixture.positionMint)).toBe(fixture.position);
    const state = { tickCurrentIndex: pool.tickCurrentIndex, sqrtPrice: BigInt(pool.sqrtPrice) }, L = BigInt(fixture.liquidity);
    const up = orcaLiquidityAmounts(state, fixture.tickLower, fixture.tickUpper, L, true), down = orcaLiquidityAmounts(state, fixture.tickLower, fixture.tickUpper, L, false);
    expect([up.amount0.toString(), up.amount1.toString()]).toEqual([events[1]!.tokenA, events[1]!.tokenB]);
    expect([down.amount0.toString(), down.amount1.toString()]).toEqual([events[2]!.tokenA, events[2]!.tokenB]);
    expect(events[1]!.liquidity).toBe(fixture.liquidity);
  });
  it('aligns a price range outward to spacing 64, deterministically and without floating point', () => {
    expect(orcaAlignPriceRange('20.121902', '24.593436')).toEqual({ tickLower: -39104, tickUpper: -36992 });
    // Exact tick-boundary prices stay on that tick; anything inside widens to the next usable tick.
    const at = (tick: number) => orcaPriceFromSqrtPrice(orcaSqrtPriceAtTick(tick), 9, 6, 12);
    expect(orcaAlignPriceRange(at(-39103), at(-36992))).toEqual({ tickLower: -39104, tickUpper: -36992 });
    // A floored boundary price lies just below its tick, so the lower bound widens outward by one spacing; never inward.
    expect(orcaAlignPriceRange(at(-39104), at(-36992)).tickLower).toBe(-39168);
    expect(() => orcaAlignPriceRange('24', '20')).toThrow('ORCA_PRICE_RANGE_INVALID');
    expect(() => orcaAlignPriceRange('0', '20')).toThrow('ORCA_PRICE_INVALID');
    expect(() => orcaAlignPriceRange('1e3', '20')).toThrow('ORCA_PRICE_INVALID');
    const band = orcaPriceBandAround(BigInt(fixture.pool.sqrtPrice), 1_000);
    expect(Number(band.lowerPrice)).toBeLessThan(Number(band.upperPrice));
    expect(orcaSqrtPriceFromPrice(band.lowerPrice, 9, 6)).toBeLessThan(BigInt(fixture.pool.sqrtPrice));
  });
  it('computes below-range, in-range and above-range compositions with maximal liquidity and rounding inside the maxima', () => {
    const state = { tickCurrentIndex: -38_008, sqrtPrice: BigInt(fixture.pool.sqrtPrice) };
    const inRange = orcaLiquidityForMaxima(state, -39_104, -36_992, 10_000_000n, 300_000n);
    expect(inRange.state).toBe('IN_RANGE'); expect(inRange.amount0).toBeLessThanOrEqual(10_000_000n); expect(inRange.amount1).toBeLessThanOrEqual(300_000n);
    const next = orcaLiquidityAmounts(state, -39_104, -36_992, inRange.liquidity + 1n, true);
    expect(next.amount0 > 10_000_000n || next.amount1 > 300_000n).toBe(true);
    const below = orcaLiquidityForMaxima(state, -37_888, -36_992, 10_000_000n, 300_000n);
    expect(below).toMatchObject({ state: 'BELOW_RANGE', amount1: 0n }); expect(below.amount0).toBeGreaterThan(0n);
    const above = orcaLiquidityForMaxima(state, -39_104, -38_016, 10_000_000n, 300_000n);
    expect(above).toMatchObject({ state: 'ABOVE_RANGE', amount0: 0n }); expect(above.amount1).toBeGreaterThan(0n);
    expect(orcaLiquidityForMaxima(state, -39_104, -36_992, 0n, 300_000n).liquidity).toBe(0n);
    expect(orcaLiquidityForMaxima(state, -37_888, -36_992, 0n, 300_000n).liquidity).toBe(0n);
    // Withdrawal rounds down; deposit rounds up: the pool never pays out more than it took.
    const d = orcaLiquidityAmounts(state, -39_104, -36_992, inRange.liquidity, false);
    expect(inRange.amount0 - d.amount0).toBeGreaterThanOrEqual(0n); expect(inRange.amount1 - d.amount1).toBeLessThanOrEqual(1n);
  });
  it('encodes and decodes exactly the reviewed instruction layouts and refuses anything else', () => {
    expect(decodeOrcaOpenPosition(encodeOrcaOpenPosition(-39104, -36992))).toEqual({ tickLower: -39104, tickUpper: -36992, withTokenMetadata: false });
    expect(decodeOrcaModifyLiquidity(encodeOrcaModifyLiquidity('increase', 30_196_427n, 10_000_000n, 243_220n)))
      .toEqual({ kind: 'increase', liquidity: '30196427', tokenA: '10000000', tokenB: '243220' });
    const data = encodeOrcaModifyLiquidity('decrease', 5n, 1n, 2n); data[40] = 1;
    expect(() => decodeOrcaModifyLiquidity(data)).toThrow('ORCA_INSTRUCTION_UNSUPPORTED');
    expect(() => summarizeOrcaLiquidityInstructions([{ programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', accounts: [], data: new Uint8Array(1) }])).toThrow('ORCA_LIQUIDITY_UNEXPECTED_PROGRAM');
    expect(() => summarizeOrcaLiquidityInstructions([{ programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', accounts: [], data: Uint8Array.from(Buffer.from('2b04ed0b1ac91e62', 'hex')) }]))
      .toThrow('ORCA_INSTRUCTION_UNSUPPORTED');
  });
});

describe('Orca liquidity simulation and Review binding (MOCKED Devnet loopback)', () => {
  it('builds one owner + position-mint message whose program effects equal Gryloo’s math, and binds it to Review', async () => {
    const s = setup(), mint = mintKey();
    const review = await simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: mint.address }, s.env.rpc, NOW);
    expect(review.signers).toEqual([s.wallet.owner, mint.address]);
    expect(review.instructionSummary.map(i => i.name)).toEqual(['set_compute_unit_limit', 'create_idempotent', 'transfer', 'sync_native', 'create_idempotent',
      'open_position_with_token_extensions', 'increase_liquidity_v2', 'close_account']);
    expect(review.simulationResult).toMatchObject({ depositedA: review.expected.amountA, depositedB: review.expected.amountB, collectedFeesA: '0' });
    expect(review.estimatedFeeLamports).toBe('10000');
    expect(sha256Hex(fromBase64(review.message))).toBe(review.messageHash);
    expect(review.plan.segments[0]!.steps[0]).toMatchObject({ stepId: 'orca-liquidity-open', payloadHash: review.messageHash });
    expect(() => assertOrcaLiquidityReview(review, workflow(), s.wallet.owner, 380_000_000, NOW + 1000)).not.toThrow();
    expect(() => assertOrcaLiquidityReview(review, workflow({ slippageBps: 50 }), s.wallet.owner, 380_000_000, NOW)).toThrow('ORCA_LIQUIDITY_SEMANTIC_REVISION_CHANGED');
    expect(() => assertOrcaLiquidityReview(review, workflow(), createMockedSolanaWallet().owner, 380_000_000, NOW)).toThrow('ORCA_LIQUIDITY_WRONG_OWNER');
    expect(() => assertOrcaLiquidityReview(review, workflow(), s.wallet.owner, 380_000_000, NOW + 60_000)).toThrow('ORCA_LIQUIDITY_REVIEW_STALE');
    expect(() => assertOrcaLiquidityReview(review, workflow(), s.wallet.owner, review.lastValidBlockHeight - 10, NOW)).toThrow('ORCA_LIQUIDITY_REVIEW_STALE');
    expect(() => assertOrcaLiquidityReview({ ...review, estimatedFeeLamports: '1' }, workflow(), s.wallet.owner, 380_000_000, NOW)).toThrow('ORCA_LIQUIDITY_AUTHORIZATION_INVALID');
    // A self-consistent substitute message (all hashes recomputed) with a larger token bound still fails the instruction round trip.
    const bytes = fromBase64(review.message), at = Buffer.from(bytes).indexOf(Buffer.from(encodeOrcaModifyLiquidity('increase', BigInt(review.operationPlan.liquidityDelta),
      BigInt(review.operationPlan.tokenA), BigInt(review.operationPlan.tokenB))));
    expect(at).toBeGreaterThan(0);
    bytes[at + 32] = bytes[at + 32]! + 1;
    const forged = { ...review, message: toBase64(bytes), messageHash: sha256Hex(bytes), unsignedTransaction: toBase64(serializeSignedTransaction([null, null], bytes)),
      plan: { ...review.plan, segments: [{ ...review.plan.segments[0]!, steps: [{ ...review.plan.segments[0]!.steps[0]!, payloadHash: sha256Hex(bytes) }] }] } } as OrcaLiquidityReview;
    const content: Partial<OrcaLiquidityReview> = { ...forged }; delete content.commitment;
    expect(() => assertOrcaLiquidityReview({ ...forged, commitment: solanaSwapHash(content) }, workflow(), s.wallet.owner, 380_000_000, NOW)).toThrow('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  });
  it('accepts only the exact reviewed bytes with every reviewed signature', async () => {
    const s = setup(), mint = mintKey();
    const review = await simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: mint.address }, s.env.rpc, NOW);
    expect(verifySignedOrcaLiquidityTransaction(review, fullySigned(s.wallet, review, mint)).signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(() => verifySignedOrcaLiquidityTransaction(review, s.wallet.sign(review.unsignedTransaction))).toThrow('ORCA_LIQUIDITY_POSITION_SIGNATURE_INVALID');
    expect(() => verifySignedOrcaLiquidityTransaction(review, fullySigned(s.wallet, review, mintKey()))).toThrow('ORCA_LIQUIDITY_POSITION_SIGNATURE_INVALID');
    expect(() => verifySignedOrcaLiquidityTransaction(review, fullySigned(createMockedSolanaWallet(), review, mint))).toThrow('ORCA_LIQUIDITY_SIGNATURE_INVALID');
    const { message } = parseTransaction(fromBase64(review.unsignedTransaction, 2048));
    expect(() => verifySignedOrcaLiquidityTransaction(review, toBase64(serializeSignedTransaction([ed25519.sign(message, mint.secret)], message)))).toThrow('ORCA_LIQUIDITY_TRANSACTION_CHANGED');
  });
  it.each([
    ['a non-Devnet cluster', { cluster: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' }, {}, 'SOLANA_WRONG_CLUSTER'],
    ['a pool under another config', { poolConfig: '11111111111111111111111111111112' }, {}, 'ORCA_POOL_MISMATCH'],
    ['a changed pool fee tier', { poolFeeRate: 3000 }, {}, 'ORCA_POOL_MISMATCH'],
    ['pool reward emitters', { poolRewardMint: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k' }, {}, 'ORCA_POOL_REWARDS_UNSUPPORTED'],
    ['a range on uninitialized tick arrays', {}, { tickLower: -64_000, tickUpper: -63_936 }, 'ORCA_TICK_ARRAY_UNINITIALIZED'],
    ['maxima too small for any liquidity', {}, { amount0Max: '1', amount1Max: '0' }, 'ORCA_LIQUIDITY_ZERO'],
    ['a deposit below the authored minimum', {}, { amount1Min: '299999' }, 'ORCA_LIQUIDITY_BELOW_MINIMUM'],
  ])('fails closed on %s', async (_n, options, patch, code) => {
    const s = setup(options as MockedOrcaOptions);
    await expect(simulateOrcaLiquidity(workflow(patch as Partial<ConcentratedLiquidityFields>), s.wallet.owner, { operation: 'OPEN', positionMint: mintKey().address }, s.env.rpc, NOW)).rejects.toThrow(code);
  });
  it('requires the owner to be the position authority and the workflow range to match the position', async () => {
    const s = setup(), { mint } = await landOpen(s);
    const stranger = createMockedSolanaWallet(); s.env.fund(stranger.owner, 1_000_000_000n, 1_000_000n);
    await expect(simulateOrcaLiquidity(workflow(), stranger.owner, { operation: 'EXIT', positionMint: mint.address }, s.env.rpc, NOW)).rejects.toThrow('ORCA_POSITION_AUTHORITY_MISMATCH');
    await expect(simulateOrcaLiquidity(workflow({ tickLower: -39_168 }), s.wallet.owner, { operation: 'EXIT', positionMint: mint.address }, s.env.rpc, NOW)).rejects.toThrow('ORCA_POSITION_RANGE_MISMATCH');
    await expect(simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'DECREASE_PARTIAL', positionMint: mint.address, partBps: 10_000 }, s.env.rpc, NOW)).rejects.toThrow('ORCA_LIQUIDITY_PART_INVALID');
    await expect(simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'EXIT', positionMint: mintKey().address }, s.env.rpc, NOW)).rejects.toThrow('ORCA_POSITION_NOT_FOUND');
    await expect(simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: mint.address }, s.env.rpc, NOW)).rejects.toThrow('ORCA_POSITION_MINT_IN_USE');
    const exit = await simulateOrcaLiquidity(workflow(), s.wallet.owner, { operation: 'EXIT', positionMint: mint.address }, s.env.rpc, NOW);
    expect(exit.signers).toEqual([s.wallet.owner]);
    expect(exit.instructionSummary.map(i => i.name)).toEqual(['set_compute_unit_limit', 'create_idempotent', 'create_idempotent', 'decrease_liquidity_v2', 'collect_fees_v2',
      'close_position_with_token_extensions', 'close_account']);
    expect(exit.simulationResult.closedAccounts).toHaveLength(3);
  });
});

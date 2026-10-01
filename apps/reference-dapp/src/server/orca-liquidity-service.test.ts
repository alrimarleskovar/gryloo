// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMockedSolanaDevnetOrca, createMockedSolanaWallet, fromBase64, parseTransaction, serializeSignedTransaction, toBase64,
  type MockedOrcaOptions } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSolanaLiquidityNode, type SolanaLiquidityInput } from '../domain/solana-liquidity-authoring';
import { createPositionMintSigner, type PositionMintSigner } from '../wallet/position-mint-signer';
import { createOrcaLiquidityService } from './orca-liquidity-service';

/** MOCKED Solana Devnet + Orca loopback only. The owner wallet key and the position-mint key live only in this test process. */
const input = (patch: Partial<SolanaLiquidityInput> = {}): SolanaLiquidityInput => ({ network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.3', rangeUnit: 'TICK',
  lower: '-39104', upper: '-36992', slippage: '100', ...patch });
const workflow = (patch: Partial<SolanaLiquidityInput> = {}, revision = 1): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'orca-liquidity', revision,
  resourceEdges: [], nodes: [createSolanaLiquidityNode('node-002', input(patch))] });
async function setup(options: MockedOrcaOptions = {}, service: { provenance?: 'PUBLIC_DEVNET' | 'MOCKED'; executionEnabled?: boolean } = {}) {
  const env = createMockedSolanaDevnetOrca(options), wallet = createMockedSolanaWallet();
  env.fund(wallet.owner, 3_000_000_000n, 50_000_000n);
  const dir = await mkdtemp(join(tmpdir(), 'gryloo-orcalp-'));
  let clock = Date.parse('2026-10-01T12:00:00.000Z');
  const make = () => createOrcaLiquidityService({ rpc: env.rpc, journalDir: dir, provenance: service.provenance ?? 'MOCKED', executionEnabled: service.executionEnabled ?? true,
    now: () => clock });
  return { env, wallet, dir, options, service: make(), make, tick: (ms: number) => { clock += ms; } };
}
type S = Awaited<ReturnType<typeof setup>>;
async function sign(s: S, begin: { unsignedTransaction: string; signers: string[] }, key: PositionMintSigner | null) {
  const walletSigned = s.wallet.sign(begin.unsignedTransaction);
  if (begin.signers.length === 1) return walletSigned;
  const { signatures, message } = parseTransaction(fromBase64(walletSigned, 2048));
  return toBase64(serializeSignedTransaction([signatures[0]!, await key!.sign(message)], message));
}
async function reviewed(s: S, operation: 'OPEN' | 'DECREASE_PARTIAL' | 'EXIT', mint: string, wf = workflow(), partBps?: number) {
  const simulated = await s.service.simulate(wf, s.wallet.owner, { operation, positionMint: mint, ...partBps ? { partBps } : {} });
  return s.service.review(simulated.id, simulated.review.commitment, wf);
}
async function execute(s: S, id: string, key: PositionMintSigner | null, wf = workflow()) {
  const begin = await s.service.begin(id, s.wallet.owner, wf);
  await s.service.submit(id, await sign(s, begin, key));
  return s.service.observe(id);
}
async function open(s: S) {
  const key = await createPositionMintSigner();
  const record = await reviewed(s, 'OPEN', key.address);
  return { key, record: await execute(s, record.id, key) };
}

describe('Orca liquidity service lifecycle (MOCKED Devnet loopback, no public submission)', () => {
  it('opens, partially removes with fee collection, exits and closes: one reviewed owner transaction per step, each independently reconciled', async () => {
    const s = await setup({ accrueFees: { a: '1234', b: '56' } });
    const key = await createPositionMintSigner();
    const simulated = await s.service.simulate(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: key.address });
    expect(simulated).toMatchObject({ id: expect.stringMatching(/^orcalp-[a-f0-9]{32}$/), format: 'gryloo.orca-liquidity-run.v1', operation: 'OPEN', positionMint: key.address,
      authorization: null, attempt: null, evidenceClass: 'MOCKED' });
    const r = simulated.review;
    expect(r).toMatchObject({ cluster: 'devnet', provider: 'Orca Whirlpools', signers: [s.wallet.owner, key.address],
      range: { tickLower: -39104, tickUpper: -36992, state: 'IN_RANGE' }, intent: { amount0Max: '10000000', amount1Max: '300000', slippageBps: 100 } });
    expect(BigInt(r.expected.liquidity)).toBeGreaterThan(0n);
    expect(BigInt(r.operationPlan.tokenA)).toBeLessThanOrEqual(10_000_000n);
    expect(BigInt(r.operationPlan.tokenB)).toBeLessThanOrEqual(300_000n);
    expect(r.simulationResult.depositedA).toBe(r.expected.amountA);
    expect(r.programs.sort()).toEqual(['11111111111111111111111111111111', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'].sort());
    expect(s.env.state.sent).toEqual([]);
    await expect(s.service.begin(simulated.id, s.wallet.owner, workflow())).rejects.toThrow('ORCA_LIQUIDITY_REVIEW_REQUIRED');
    const record = await s.service.review(simulated.id, r.commitment, workflow());
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    expect(begin).toMatchObject({ walletChain: 'solana:devnet', signers: [s.wallet.owner, key.address] });
    expect((await s.service.load(record.id)).attempt?.state).toBe('PREPARED');
    expect((await s.service.positions(s.wallet.owner))[0]).toMatchObject({ positionMint: key.address, status: 'OPEN_PENDING' });
    await s.service.submit(record.id, await sign(s, begin, key));
    const opened = await s.service.observe(record.id);
    expect(opened).toMatchObject({ verdict: 'RECONCILED', evidenceClass: 'MOCKED', attempt: { state: 'CONFIRMED', reconciled: true } });
    expect(opened.observations.at(-1)?.effects).toMatchObject({ depositedA: r.expected.amountA, depositedB: r.expected.amountB, collectedFeesA: '0', collectedFeesB: '0' });
    expect(opened.observations.at(-1)?.positionAuthority).toEqual({ tokenAccount: r.accounts.positionTokenAccount, owner: s.wallet.owner, amount: '1' });
    expect(opened.evidence?.bundle.environment).toBe('MOCKED');
    const [position] = await s.service.positions(s.wallet.owner);
    expect(position).toMatchObject({ status: 'ACTIVE', liquidity: r.expected.liquidity, tickLower: -39104, tickUpper: -36992 });
    // Partial removal: principal comes from the LiquidityDecreased event, the remaining vault outflow is fees.
    const partial = await execute(s, (await reviewed(s, 'DECREASE_PARTIAL', key.address, workflow(), 4000)).id, null);
    const pe = partial.observations.at(-1)!.effects!;
    expect(partial.verdict).toBe('RECONCILED');
    expect(pe).toMatchObject({ collectedFeesA: '1234', collectedFeesB: '56' });
    expect(BigInt(pe.withdrawnPrincipalA)).toBeGreaterThan(0n);
    expect(partial.review.signers).toEqual([s.wallet.owner]);
    const remaining = (await s.service.positions(s.wallet.owner))[0]!;
    expect(BigInt(remaining.liquidity!)).toBe(BigInt(r.expected.liquidity) - BigInt(partial.review.operationPlan.liquidityDelta));
    // Exit: all remaining liquidity, fees and the position itself; every deposit is refunded.
    const exit = await execute(s, (await reviewed(s, 'EXIT', key.address)).id, null);
    const ee = exit.observations.at(-1)!.effects!;
    expect(exit.verdict).toBe('RECONCILED');
    expect(ee.closedAccounts).toEqual([r.accounts.position, key.address, r.accounts.positionTokenAccount]);
    expect(ee.rentRefundedLamports).toBe(opened.observations.at(-1)!.effects!.rentPaidLamports);
    expect((await s.service.positions(s.wallet.owner))[0]).toMatchObject({ status: 'CLOSED', liquidity: null,
      runs: [{ operation: 'OPEN', verdict: 'RECONCILED' }, { operation: 'DECREASE_PARTIAL', verdict: 'RECONCILED' }, { operation: 'EXIT', verdict: 'RECONCILED' }] });
    expect(exit.evidence?.publicExecution).toMatchObject({ operation: 'EXIT', realFunds: false, lifecycle: { positionMint: key.address } });
    // Principal deposited minus principal withdrawn is at most the program's rounding in the pool's favor; fees are separate.
    const deposited = BigInt(opened.observations.at(-1)!.effects!.depositedB), withdrawn = BigInt(pe.withdrawnPrincipalB) + BigInt(ee.withdrawnPrincipalB);
    expect(deposited - withdrawn).toBeGreaterThanOrEqual(0n);
    expect(deposited - withdrawn).toBeLessThanOrEqual(2n);
    expect(s.env.state.sent).toHaveLength(3);
    // A new position is allowed only after the previous one is closed.
    const next = await createPositionMintSigner();
    await expect(s.service.simulate(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: next.address })).resolves.toMatchObject({ operation: 'OPEN' });
  });
  it('never creates a second position while one exists, and recovers the real position after a failed later step', async () => {
    const s = await setup();
    const { key, record } = await open(s);
    expect(record.verdict).toBe('RECONCILED');
    const other = await createPositionMintSigner();
    await expect(s.service.simulate(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: other.address })).rejects.toThrow('ORCA_LIQUIDITY_POSITION_ALREADY_OPEN');
    // A later decrease fails on chain: the position is untouched and is recovered, not recreated.
    const failing = await reviewed(s, 'DECREASE_PARTIAL', key.address, workflow(), 5000);
    s.options.failLiquidity = true;
    const failed = await execute(s, failing.id, null);
    expect(failed).toMatchObject({ verdict: 'DIVERGENT', error: 'ORCA_LIQUIDITY_TRANSACTION_FAILED', attempt: { state: 'REVERTED' } });
    s.options.failLiquidity = false;
    const restarted = s.make();
    const [position] = await restarted.positions(s.wallet.owner);
    expect(position).toMatchObject({ positionMint: key.address, status: 'ACTIVE', runs: [{ operation: 'OPEN', verdict: 'RECONCILED' }, { operation: 'DECREASE_PARTIAL', verdict: 'DIVERGENT' }] });
    const exitReview = await restarted.simulate(workflow(), s.wallet.owner, { operation: 'EXIT', positionMint: key.address });
    const exit = await (async () => { const r = await restarted.review(exitReview.id, exitReview.review.commitment, workflow());
      const begin = await restarted.begin(r.id, s.wallet.owner, workflow()); await restarted.submit(r.id, await sign(s, begin, null)); return restarted.observe(r.id); })();
    expect(exit.verdict).toBe('RECONCILED');
    await expect(restarted.simulate(workflow(), s.wallet.owner, { operation: 'EXIT', positionMint: key.address })).rejects.toThrow('ORCA_POSITION_NOT_FOUND');
  });
  it('fails closed on wallet-modified bytes, a wrong or missing position signature and a foreign wallet, and never broadcasts', async () => {
    const s = await setup();
    const key = await createPositionMintSigner();
    const record = await reviewed(s, 'OPEN', key.address);
    await expect(s.service.begin(record.id, createMockedSolanaWallet().owner, workflow())).rejects.toThrow('ORCA_LIQUIDITY_WRONG_OWNER');
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    // Wallet-only signature: the position-mint slot is still empty.
    const cancelled = await s.service.submit(record.id, s.wallet.sign(begin.unsignedTransaction));
    expect(cancelled).toMatchObject({ notSubmitted: true, error: 'ORCA_LIQUIDITY_POSITION_SIGNATURE_INVALID', attempt: { state: 'CANCELLED', signature: null } });
    expect(s.env.state.sent).toEqual([]);
    // A different position key and a mutated message.
    const second = await (async () => { const k = await createPositionMintSigner(); return { k, r: await reviewed(s, 'OPEN', k.address) }; })();
    const b2 = await s.service.begin(second.r.id, s.wallet.owner, workflow());
    const wrongKey = await createPositionMintSigner();
    expect(await s.service.submit(second.r.id, await sign(s, b2, wrongKey))).toMatchObject({ notSubmitted: true, error: 'ORCA_LIQUIDITY_POSITION_SIGNATURE_INVALID' });
    const third = await (async () => { const k = await createPositionMintSigner(); return { k, r: await reviewed(s, 'OPEN', k.address) }; })();
    const b3 = await s.service.begin(third.r.id, s.wallet.owner, workflow());
    const bytes = fromBase64(b3.unsignedTransaction, 2048); bytes[bytes.length - 40] = bytes[bytes.length - 40]! ^ 1;
    const mutated = createMockedSolanaWallet().sign(toBase64(bytes));
    expect(await s.service.submit(third.r.id, mutated)).toMatchObject({ notSubmitted: true, error: 'ORCA_LIQUIDITY_TRANSACTION_CHANGED' });
    expect(s.env.state.sent).toEqual([]);
    expect((await s.service.positions(s.wallet.owner)).every(p => p.status === 'NOT_CREATED')).toBe(true);
  });
  it('binds Review to the exact semantics: stale reviews, semantic edits and tampered records are refused', async () => {
    const s = await setup();
    const key = await createPositionMintSigner();
    const simulated = await s.service.simulate(workflow(), s.wallet.owner, { operation: 'OPEN', positionMint: key.address });
    await expect(s.service.review(simulated.id, simulated.review.commitment, workflow({ maxSol: '0.02' }))).rejects.toThrow('ORCA_LIQUIDITY_SEMANTIC_REVISION_CHANGED');
    await expect(s.service.review(simulated.id, '0x' + '0'.repeat(64), workflow())).rejects.toThrow('ORCA_LIQUIDITY_AUTHORIZATION_REPLACED');
    const record = await s.service.review(simulated.id, simulated.review.commitment, workflow());
    await expect(s.service.begin(record.id, s.wallet.owner, workflow({ lower: '-39168' }))).rejects.toThrow('ORCA_LIQUIDITY_SEMANTIC_REVISION_CHANGED');
    s.tick(61_000);
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('ORCA_LIQUIDITY_REVIEW_STALE');
    expect(await s.service.invalidate(record.id)).toMatchObject({ authorization: null, error: 'ORCA_LIQUIDITY_SEMANTIC_EDIT_REQUIRES_REVIEW' });
    const path = join(s.dir, record.id + '.jsonl'), text = await readFile(path, 'utf8');
    await writeFile(path, text.replace('"slippageBps":100', '"slippageBps":300'));
    await expect(s.service.load(record.id)).rejects.toThrow('ORCA_LIQUIDITY_STORE_CORRUPT');
  });
  it('ambiguous submission is observed, never resubmitted; a dropped transaction expires as not executed; duplicate Execute is refused', async () => {
    const s = await setup({ send: 'RPC_ERROR_AFTER_LANDING' });
    const key = await createPositionMintSigner();
    const record = await reviewed(s, 'OPEN', key.address);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('ORCA_LIQUIDITY_EXISTING_ATTEMPT_OBSERVE_ONLY');
    const signed = await sign(s, begin, key);
    const unknown = await s.service.submit(record.id, signed);
    expect(unknown).toMatchObject({ error: 'ORCA_LIQUIDITY_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', attempt: { state: 'SUBMISSION_RESULT_UNKNOWN', signature: expect.any(String) } });
    await expect(s.service.submit(record.id, signed)).rejects.toThrow('ORCA_LIQUIDITY_WALLET_HANDOFF_NOT_AUTHORIZED');
    // Restart after submission: a fresh service observes the durable signature and reconciles the landed transaction.
    const observed = await s.make().observe(record.id);
    expect(observed).toMatchObject({ verdict: 'RECONCILED', attempt: { state: 'CONFIRMED' } });
    expect(s.env.state.sent).toHaveLength(1);
    // Dropped: the signature never lands; only finalized height past validity proves non-execution.
    const d = await setup({ send: 'RPC_ERROR_DROPPED' });
    const dk = await createPositionMintSigner();
    const dr = await reviewed(d, 'OPEN', dk.address);
    const db = await d.service.begin(dr.id, d.wallet.owner, workflow());
    await d.service.submit(dr.id, await sign(d, db, dk));
    expect(await d.service.observe(dr.id)).toMatchObject({ verdict: 'PENDING', error: 'ORCA_LIQUIDITY_TRANSACTION_NOT_OBSERVED' });
    d.env.advance(200);
    const expired = await d.service.observe(dr.id);
    expect(expired).toMatchObject({ verdict: 'NOT_EXECUTED', error: 'ORCA_LIQUIDITY_TRANSACTION_EXPIRED_NOT_EXECUTED', attempt: { state: 'NOT_FOUND' } });
    expect((await d.service.positions(d.wallet.owner))[0]).toMatchObject({ positionMint: dk.address, status: 'NOT_CREATED' });
    expect(d.env.state.sent).toHaveLength(1);
  });
  it('restart before submission cancels the prepared attempt honestly; confirmed-before-restart is reconciled, not repeated', async () => {
    const s = await setup();
    const key = await createPositionMintSigner();
    const record = await reviewed(s, 'OPEN', key.address);
    await s.service.begin(record.id, s.wallet.owner, workflow());
    // The browser tab (and its one-time position key) is gone; no signed bytes ever reached the server.
    const restarted = s.make();
    expect((await restarted.positions(s.wallet.owner))[0]).toMatchObject({ status: 'OPEN_PENDING' });
    const cancelled = await restarted.observe(record.id);
    expect(cancelled).toMatchObject({ notSubmitted: true, error: 'ORCA_LIQUIDITY_WALLET_NOT_SUBMITTED', attempt: { state: 'CANCELLED' } });
    expect((await restarted.positions(s.wallet.owner))[0]).toMatchObject({ status: 'NOT_CREATED' });
    expect(s.env.state.sent).toEqual([]);
    // Confirmed before restart: the next process only observes the existing signature.
    const c = await setup();
    const ck = await createPositionMintSigner();
    const cr = await reviewed(c, 'OPEN', ck.address);
    const cb = await c.service.begin(cr.id, c.wallet.owner, workflow());
    await c.service.submit(cr.id, await sign(c, cb, ck));
    const after = c.make();
    expect(await after.observe(cr.id)).toMatchObject({ verdict: 'RECONCILED' });
    expect(await after.observe(cr.id)).toMatchObject({ verdict: 'RECONCILED' });
    expect(c.env.state.sent).toHaveLength(1);
  });
  it('a price move between Review and landing that exceeds the slippage bound fails on chain within the reviewed maxima', async () => {
    const s = await setup();
    const key = await createPositionMintSigner();
    const record = await reviewed(s, 'OPEN', key.address);
    const begin = await s.service.begin(record.id, s.wallet.owner, workflow());
    s.options.priceShiftTicks = 300;
    await s.service.submit(record.id, await sign(s, begin, key));
    const failed = await s.service.observe(record.id);
    expect(failed).toMatchObject({ verdict: 'DIVERGENT', error: 'ORCA_LIQUIDITY_TRANSACTION_FAILED' });
    expect((await s.service.positions(s.wallet.owner))[0]).toMatchObject({ status: 'NOT_CREATED' });
  });
  it('refuses unknown positions, foreign positions and public provenance without owner execution stays PUBLIC_READ_ONLY', async () => {
    const s = await setup({}, { provenance: 'PUBLIC_DEVNET', executionEnabled: false });
    const key = await createPositionMintSigner();
    const record = await reviewed(s, 'OPEN', key.address);
    expect(record.evidenceClass).toBe('PUBLIC_READ_ONLY');
    await expect(s.service.begin(record.id, s.wallet.owner, workflow())).rejects.toThrow('ORCA_LIQUIDITY_EXECUTION_NOT_ENABLED');
    await expect(s.service.simulate(workflow(), s.wallet.owner, { operation: 'EXIT', positionMint: key.address })).rejects.toThrow('ORCA_POSITION_UNKNOWN');
    expect((await readdir(s.dir)).filter(n => n.endsWith('.jsonl'))).toHaveLength(1);
  });
});

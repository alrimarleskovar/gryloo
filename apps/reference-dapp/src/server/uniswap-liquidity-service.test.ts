// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-UNISWAP-LIQUIDITY-PUBLIC service on a MOCKED in-process Base Sepolia chain: no network, no key, no send path. */
import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { decodeUniswapMint, sqrtRatioAtTick } from '@defi-workflow-engine/reference-compiler';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { editorReducer, initialEditor } from '../domain/editor';
import { uniswapBandInput, type UniswapLiquidityInput } from '../domain/uniswap-liquidity-authoring';
import { createUniswapLiquidityChain, UNI_DELEGATION_MANAGER, UNI_MOCK_CODE_PINS, UNI_OWNER, UNI_RELAYER, type UniswapLiquidityChain } from '../../e2e/uniswap-liquidity-harness';
import { createUniswapLiquidityService, uniswapNeedsObservation, validateUniswapLiquidityLog, type UniswapBegin, type UniswapLiquidityRecord } from './uniswap-liquidity-service';

function workflow(patch: Partial<UniswapLiquidityInput> = {}): SemanticWorkflow {
  const band = uniswapBandInput((sqrtRatioAtTick(225_600) + 123_456_789n).toString(), 1_000);
  const input: UniswapLiquidityInput = { network: 'Base Sepolia', maxUsdc: '10', maxWeth: '0.005', rangeUnit: band.rangeUnit, lower: band.lower, upper: band.upper, slippage: '100', ...patch };
  const result = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
async function setup(chainOptions: Parameters<typeof createUniswapLiquidityChain>[0] = {}, options: { dir?: string; chain?: UniswapLiquidityChain; executionEnabled?: boolean } = {}) {
  const chain = options.chain ?? createUniswapLiquidityChain(chainOptions);
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'flofi-unilp-'));
  const service = createUniswapLiquidityService({ storage: createFileExecutionStorage(dir, 'UNISWAP_LIQUIDITY_BUSY'), rpc: chain.rpc, provenance: 'MOCKED',
    mockedCodePins: UNI_MOCK_CODE_PINS, now: chain.clock, ...options.executionEnabled === false ? { executionEnabled: false } : {} });
  return { chain, dir, service };
}
async function reviewed(s: Awaited<ReturnType<typeof setup>>['service'], w = workflow()) {
  const simulated = await s.simulate(w, UNI_OWNER);
  return s.review(simulated.id, simulated.review.commitment, w);
}
/** The browser's Execute click: begin → durable handoff → the owner's wallet → report the hash. */
async function execute(s: Awaited<ReturnType<typeof setup>>['service'], chain: UniswapLiquidityChain, id: string, w: SemanticWorkflow, mode: { hold?: boolean; revert?: boolean } = {}) {
  const begun: UniswapBegin = await s.begin(id, UNI_OWNER, w);
  await s.handoff(id);
  const hash = chain.wallet.send(begun.transaction, mode);
  await s.report(id, { kind: 'HASH', hash });
  return { begun, hash };
}

describe('Base Sepolia Uniswap v3 liquidity: simulation and Review binding', () => {
  it('binds chain, pool, token order, fee, ticks, prices, exact approvals, minimums, deadline, recipient and calldata', async () => {
    const { service } = await setup(), w = workflow();
    const run = await service.simulate(w, UNI_OWNER), r = run.review;
    expect(r).toMatchObject({ chainId: 84532, owner: UNI_OWNER, recipient: UNI_OWNER, token0: { symbol: 'USDC', address: profile.token0.address },
      token1: { symbol: 'WETH', address: profile.token1.address }, pool: { fee: 500, tickSpacing: 10 }, range: { state: 'IN_RANGE' },
      contracts: { positionManager: profile.positionManager, pool: profile.pool, factory: profile.factory } });
    expect(r.calls.map(c => c.step)).toEqual(['APPROVE_TOKEN0', 'APPROVE_TOKEN1', 'MINT']);
    expect(r.approvals.map(a => [a.symbol, a.amount, a.spender, a.required])).toEqual([['USDC', '10000000', profile.positionManager, true],
      ['WETH', '5000000000000000', profile.positionManager, true]]);
    const mint = decodeUniswapMint(r.calls[2]!.data);
    expect(mint).toMatchObject({ recipient: UNI_OWNER, tickLower: r.range.tickLower, tickUpper: r.range.tickUpper, fee: 500,
      amount0Desired: 10_000_000n, amount1Desired: 5_000_000_000_000_000n, amount0Min: BigInt(r.minimums.amount0Min), amount1Min: BigInt(r.minimums.amount1Min),
      deadline: BigInt(r.deadline) });
    expect(BigInt(r.minimums.amount1Min)).toBe(BigInt(r.expected.amount1) * 9_900n / 10_000n);
    expect(Number(r.range.lowerPrice)).toBeLessThan(Number(r.pool.price));
    expect(Number(r.range.upperPrice)).toBeGreaterThan(Number(r.pool.price));
    expect(r.fees.totalUpperBoundWei).not.toBeNull();
    expect(r.simulation.method).toBe('eth_simulateV1');
    // Review is required before any wallet request; a changed commitment or workflow is refused.
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_REVIEW_REQUIRED');
    await expect(service.review(run.id, '0x' + '0'.repeat(64), w)).rejects.toThrow('UNISWAP_REVIEW_CHANGED');
    await expect(service.review(run.id, r.commitment, workflow({ maxUsdc: '11' }))).rejects.toThrow('UNISWAP_SEMANTIC_REVISION_CHANGED');
  });
  it('fails closed on insufficient balance, unavailable simulation, foreign code, wrong token order and a public run with mocked pins', async () => {
    await expect((await setup({ usdc: 1n, weth: 1n })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow(/UNISWAP_INSUFFICIENT_(USDC|WETH)/);
    await expect((await setup({ simulateV1: false })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_SIMULATION_UNAVAILABLE');
    const chain = createUniswapLiquidityChain(), dir = await mkdtemp(join(tmpdir(), 'flofi-unilp-'));
    const strict = createUniswapLiquidityService({ storage: createFileExecutionStorage(dir, 'B'), rpc: chain.rpc, provenance: 'MOCKED', now: chain.clock });
    await expect(strict.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_UNEXPECTED_CONTRACT');
    expect(() => createUniswapLiquidityService({ storage: createFileExecutionStorage(dir, 'B'), rpc: chain.rpc, provenance: 'PUBLIC_TESTNET', mockedCodePins: UNI_MOCK_CODE_PINS }))
      .toThrow('UNISWAP_CODE_PINS_MOCKED_ONLY');
    const reversed = workflow();
    const node = reversed.nodes.find(n => n.actionType === 'asset.liquidity.concentrated')!;
    const [a, b] = [node.inputs[0]!, node.inputs[1]!];
    node.inputs[0] = { ...b, name: 'amount0-max' } as typeof a; node.inputs[1] = { ...a, name: 'amount1-max' } as typeof b;
    await expect(chain && strict.simulate(reversed, UNI_OWNER)).rejects.toThrow();
  });
});

describe('Base Sepolia Uniswap v3 liquidity: execution, recovery and reconciliation', () => {
  it('full journey: exact approvals, mint to the owner, reconciled position and evidence; duplicate reports are idempotent', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    const first = await execute(service, chain, run.id, w);
    expect(first.begun.attempt.step).toBe('APPROVE_TOKEN0');
    expect(first.begun.transaction).toMatchObject({ chainId: '0x14a34', from: UNI_OWNER, to: profile.token0.address, value: '0x0' });
    // Duplicate tx-hash registration is a no-op; a different hash for the same attempt is refused.
    await service.report(run.id, { kind: 'HASH', hash: first.hash });
    await expect(service.report(run.id, { kind: 'HASH', hash: '0x' + 'f'.repeat(64) })).rejects.toThrow('UNISWAP_HASH_DIVERGENT');
    // A retried begin cannot create a second attempt while one is active.
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    let record = await service.observe(run.id);
    expect(record.attempts.map(a => [a.step, a.state, a.reconciled])).toEqual([['APPROVE_TOKEN0', 'CONFIRMED', true]]);
    expect((await execute(service, chain, run.id, w)).begun.attempt.step).toBe('APPROVE_TOKEN1');
    await service.observe(run.id);
    const mint = await execute(service, chain, run.id, w);
    expect(mint.begun.attempt.step).toBe('MINT');
    expect(mint.begun.transaction.to).toBe(profile.positionManager);
    expect(uniswapNeedsObservation(await service.load(run.id))).toBe(true);
    record = await service.observe(run.id);
    expect(record.verdict).toBe('RECONCILED');
    expect(record.position).toMatchObject({ owner: UNI_OWNER, tickLower: run.review.range.tickLower, tickUpper: run.review.range.tickUpper, pool: profile.pool });
    expect(chain.snapshot.owners[record.position!.tokenId]).toBe(UNI_OWNER);
    expect(BigInt(record.position!.amount0)).toBeGreaterThanOrEqual(BigInt(run.review.minimums.amount0Min));
    expect(record.evidence).toMatchObject({ evidenceClass: 'MOCKED', reconciliation: 'RECONCILED', bundle: { environment: 'MOCKED', outcome: 'RECONCILED' } });
    expect(record.evidence!.transactions.map(t => t.step)).toEqual(['APPROVE_TOKEN0', 'APPROVE_TOKEN1', 'MINT']);
    expect(record.evidence!.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(uniswapNeedsObservation(record)).toBe(false);
    expect(chain.counters.sends).toBe(3);
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_POSITION_ALREADY_MINTED');
    await expect(service.refresh(run.id)).rejects.toThrow();
    expect(chain.counters.sends).toBe(3);
  });
  it('browser closes after approval submission; a restarted service discovers it by nonce, then refresh and a new Review gate the mint', async () => {
    const first = await setup(), w = workflow();
    const run = await reviewed(first.service, w);
    const begun = await first.service.begin(run.id, UNI_OWNER, w);
    await first.service.handoff(run.id);
    first.chain.wallet.send(begun.transaction);           // the hash never reaches the server
    const restarted = await setup({}, { dir: first.dir, chain: first.chain });
    let record = await restarted.service.observe(run.id);
    expect(record.attempts[0]).toMatchObject({ state: 'CONFIRMED', reconciled: true });
    expect(record.attempts[0]!.transactionHash).toMatch(/^0x/);
    // Review expires while the owner is away: a fresh simulation and Review are required.
    first.chain.advance(200);
    await expect(restarted.service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_REVIEW_EXPIRED');
    record = await restarted.service.refresh(run.id);
    expect(record.authorization).toBeNull();
    expect(record.review.calls.map(c => c.step)).toEqual(['APPROVE_TOKEN1', 'MINT']);
    await restarted.service.review(run.id, record.review.commitment, w);
    expect((await execute(restarted.service, first.chain, run.id, w)).begun.attempt.step).toBe('APPROVE_TOKEN1');
    expect(first.chain.counters.sends).toBe(2);
  });
  it('browser closes before the wallet handoff: PREPARED is cancelled, nothing was sent and the same nonce can be re-authorized', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    const begun = await service.begin(run.id, UNI_OWNER, w);
    const record = await service.observe(run.id);
    expect(record.attempts[0]).toMatchObject({ state: 'CANCELLED', note: 'UNISWAP_WALLET_NOT_SUBMITTED' });
    expect(record.authorization).toBeNull();
    await expect(service.handoff(run.id)).rejects.toThrow('UNISWAP_WALLET_HANDOFF_NOT_AUTHORIZED');
    const fresh = await service.refresh(run.id);
    await service.review(run.id, fresh.review.commitment, w);
    const again = await service.begin(run.id, UNI_OWNER, w);
    expect(again.attempt.nonce).toBe(begun.attempt.nonce);
    expect(chain.counters.sends).toBe(0);
  });
  it('a wallet refusal proven before broadcast cancels; an ambiguous error stays observation-only and is never resent', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    await service.begin(run.id, UNI_OWNER, w); await service.handoff(run.id);
    await expect(service.walletFailure(run.id, { invoked: true, calls: [{ method: 'eth_sendTransaction', submission: true, result: 'x' }], code: 'UNISWAP_REJECTED' }))
      .rejects.toThrow('UNISWAP_DIAGNOSTIC_NOT_PRE_SUBMISSION');
    let record = await service.walletFailure(run.id, { invoked: true, calls: [{ method: 'eth_sendTransaction', submission: true, error: { code: 4001 } }],
      code: 'UNISWAP_REJECTED', rejectionCode: 4001 });
    expect(record.attempts[0]!.state).toBe('CANCELLED');
    const fresh = await service.refresh(run.id); await service.review(run.id, fresh.review.commitment, w);
    await service.begin(run.id, UNI_OWNER, w); await service.handoff(run.id);
    record = await service.report(run.id, { kind: 'UNKNOWN' });
    expect(record.attempts.at(-1)!.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    expect(uniswapNeedsObservation(record)).toBe(true);
    record = await service.observe(run.id);
    expect(record.error).toBe('UNISWAP_TRANSACTION_NOT_OBSERVED');
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    expect(chain.counters.sends).toBe(0);
  });
  it('pending, replaced (speed-up) and cancelled transactions; a mint receipt reported late still reconciles', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    const pending = await execute(service, chain, run.id, w, { hold: true });
    let record = await service.observe(run.id);
    expect(record.attempts[0]!.state).toBe('PENDING');
    expect(record.error).toBe('UNISWAP_TRANSACTION_PENDING');
    const replacement = chain.wallet.release({ kind: 'SPEED_UP', hash: pending.hash })!;
    record = await service.observe(run.id);
    expect(record.attempts[0]).toMatchObject({ state: 'CONFIRMED', transactionHash: pending.hash, replacementHash: replacement });
    const second = await execute(service, chain, run.id, w, { hold: true });
    chain.wallet.release({ kind: 'CANCEL', hash: second.hash });
    record = await service.observe(run.id);
    expect(record.attempts[1]).toMatchObject({ step: 'APPROVE_TOKEN1', state: 'NOT_FOUND', note: 'UNISWAP_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION' });
    expect(record.authorization).toBeNull();
  });
  it('reverted mint, changed pool state and stale Review require a new simulation and Review; no blind retry', async () => {
    const { service, chain } = await setup(), w = workflow();
    chain.externalAllowance('token0', 10n ** 9n); chain.externalAllowance('token1', 10n ** 18n);
    let run = await reviewed(service, w);
    expect(run.review.calls.map(c => c.step)).toEqual(['MINT']);
    await execute(service, chain, run.id, w, { revert: true });
    let record = await service.observe(run.id);
    expect(record.attempts[0]).toMatchObject({ step: 'MINT', state: 'REVERTED' });
    expect(record.authorization).toBeNull();
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_REVIEW_REQUIRED');
    run = await service.refresh(run.id);
    await service.review(run.id, run.review.commitment, w);
    chain.movePrice(400);                                  // another trader moves the pool well beyond half the slippage
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_STATE_CHANGED_REVIEW_REQUIRED');
    record = await service.load(run.id);
    expect(record.authorization).toBeNull();
    expect(record.attempts).toHaveLength(1);
    expect(chain.counters.sends).toBe(1);
  });
  it('an unsent mint expires at its deadline; a mint that may have landed blocks any new mint attempt', async () => {
    const { service, chain } = await setup(), w = workflow();
    chain.externalAllowance('token0', 10n ** 9n); chain.externalAllowance('token1', 10n ** 18n);
    let run = await reviewed(service, w);
    const begun = await service.begin(run.id, UNI_OWNER, w); await service.handoff(run.id);
    await service.report(run.id, { kind: 'UNKNOWN' });
    chain.advance(profile.mintDeadlineSeconds + 60);
    const record = await service.observe(run.id);
    expect(record.attempts[0]).toMatchObject({ state: 'NOT_FOUND', note: 'UNISWAP_SUBMISSION_EXPIRED_NOT_EXECUTED' });
    // A lying browser claims refusal while the wallet actually sent the mint: the position count grows.
    run = await service.refresh(run.id); await service.review(run.id, run.review.commitment, w);
    const second = await service.begin(run.id, UNI_OWNER, w); await service.handoff(run.id);
    await service.walletFailure(run.id, { invoked: true, calls: [{ method: 'eth_sendTransaction', submission: true, error: { code: 4001 } }], code: 'UNISWAP_REJECTED', rejectionCode: 4001 });
    chain.wallet.send(second.transaction);
    run = await service.refresh(run.id); await service.review(run.id, run.review.commitment, w);
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_POSITION_MAY_EXIST_OBSERVE');
    expect(begun.attempt.step).toBe('MINT');
    expect(chain.counters.sends).toBe(1);
  });
  it('a reported hash of a different transaction freezes the run for attention; the owner nonce is one economic identity across runs', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    const approval = await execute(service, chain, run.id, w);
    await service.observe(run.id);
    await service.begin(run.id, UNI_OWNER, w); await service.handoff(run.id);
    await service.report(run.id, { kind: 'HASH', hash: approval.hash });
    const record = await service.observe(run.id);
    expect(record).toMatchObject({ verdict: 'DIVERGENT', error: 'UNISWAP_TRANSACTION_MISMATCH' });
    expect(record.attempts.at(-1)!.state).toBe('RECONCILIATION_REQUIRED');
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_RECONCILIATION_REQUIRED');
    const other = await setup({}, { chain: createUniswapLiquidityChain() });
    const a = await reviewed(other.service, w), b = await reviewed(other.service, w);
    await other.service.begin(a.id, UNI_OWNER, w);
    await expect(other.service.begin(b.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_OWNER_NONCE_IN_USE');
  });
  it('MetaMask relayed type-2 depth-1 redemptions (as on Base Sepolia 0x8248b684…5ccc) reconcile every step; the unchanged owner nonce does not block the next step', async () => {
    const { service, chain } = await setup({ delegatedOwner: true }), w = workflow();
    const run = await reviewed(service, w);
    const nonces: string[] = [];
    for (const step of ['APPROVE_TOKEN0', 'APPROVE_TOKEN1', 'MINT']) {
      const begun = await service.begin(run.id, UNI_OWNER, w);
      expect(begun.attempt.step).toBe(step);
      nonces.push(begun.attempt.nonce);
      await service.handoff(run.id);
      await service.report(run.id, { kind: 'HASH', hash: chain.wallet.sendDelegated(begun.transaction) });
      const observed = await service.observe(run.id);
      expect(observed.attempts.at(-1)).toMatchObject({ step, state: 'CONFIRMED', reconciled: true,
        receipt: { submissionKind: 'DELEGATED_SINGLE', from: UNI_RELAYER } });
    }
    // The relayer, not the owner, sent all three transactions: every step prepared on the same owner nonce.
    expect(new Set(nonces).size).toBe(1);
    const record = await service.load(run.id);
    expect(record.verdict).toBe('RECONCILED');
    expect(record.position).toMatchObject({ owner: UNI_OWNER });
    expect(chain.snapshot.owners[record.position!.tokenId]).toBe(UNI_OWNER);
    expect(record.evidence!.transactions.map(t => [t.step, t.submissionKind])).toEqual([['APPROVE_TOKEN0', 'DELEGATED_SINGLE'],
      ['APPROVE_TOKEN1', 'DELEGATED_SINGLE'], ['MINT', 'DELEGATED_SINGLE']]);
    expect([...chain.mined.values()].every(tx => tx.to === UNI_DELEGATION_MANAGER)).toBe(true);
    expect(chain.counters.sends).toBe(3);
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_POSITION_ALREADY_MINTED');
  });
  it('a relayed redemption whose decoded call differs from the reviewed one is never reconciled', async () => {
    const { service, chain } = await setup({ delegatedOwner: true }), w = workflow();
    const run = await reviewed(service, w);
    const begun = await service.begin(run.id, UNI_OWNER, w);
    await service.handoff(run.id);
    // The wallet relays an approval for one more unit than reviewed.
    const changed = { ...begun.transaction, data: begun.transaction.data.slice(0, -1) + (begun.transaction.data.endsWith('0') ? '1' : '0') };
    await service.report(run.id, { kind: 'HASH', hash: chain.wallet.sendDelegated(changed) });
    const record = await service.observe(run.id);
    expect(record).toMatchObject({ verdict: 'DIVERGENT', error: 'UNISWAP_TRANSACTION_MISMATCH' });
    expect(record.attempts[0]).toMatchObject({ state: 'RECONCILIATION_REQUIRED', reconciled: false });
  });
  it('execution can be disabled; tampered or malformed stored state fails closed', async () => {
    const disabled = await setup({}, { executionEnabled: false }), w = workflow();
    const run = await reviewed(disabled.service, w);
    await expect(disabled.service.begin(run.id, UNI_OWNER, w)).rejects.toThrow('UNISWAP_EXECUTION_NOT_ENABLED');
    const record = await disabled.service.load(run.id);
    const tampered: UniswapLiquidityRecord = { ...record, review: { ...record.review, recipient: '0x1111111111111111111111111111111111111111' } };
    await appendFile(join(disabled.dir, run.id + '.jsonl'), JSON.stringify(tampered) + '\n');
    await expect(disabled.service.load(run.id)).rejects.toThrow('UNISWAP_LIQUIDITY_STORE_CORRUPT');
    expect(() => validateUniswapLiquidityLog(new TextEncoder().encode('{"format":"x"}\n'))).toThrow('UNISWAP_LIQUIDITY_STORE_CORRUPT');
    expect(() => validateUniswapLiquidityLog(new TextEncoder().encode('not json\n'))).toThrow('UNISWAP_LIQUIDITY_STORE_CORRUPT');
  });
});

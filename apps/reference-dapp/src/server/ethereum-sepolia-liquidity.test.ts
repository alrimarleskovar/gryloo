// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001: Uniswap v3 concentrated liquidity on Ethereum Sepolia (USDC/WETH 0.3%, tick spacing 60) through the
 * unchanged liquidity service, on a MOCKED in-process chain: no network, no key, no send path.
 */
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext, createEthereumSepoliaReviewContext, validateUniswapLiquidityNode } from '@defi-workflow-engine/reference-linter';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { decodeUniswapMint, sqrtRatioAtTick } from '@defi-workflow-engine/reference-compiler';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as BASE, UNISWAP_V3_ETHEREUM_SEPOLIA_LIQUIDITY as E } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { editorReducer, initialEditor } from '../domain/editor';
import { createUniswapLiquidityNode, uniswapBandInput, type UniswapLiquidityInput } from '../domain/uniswap-liquidity-authoring';
import { createUniswapLiquidityChain, UNI_MOCK_CODE_PINS, UNI_OWNER, type UniswapLiquidityChain } from '../../e2e/uniswap-liquidity-harness';
import { createUniswapLiquidityService, type UniswapBegin } from './uniswap-liquidity-service';
import type { Rpc } from './public-testnet-service';

const TICK = 225_600;
function input(network: UniswapLiquidityInput['network'], patch: Partial<UniswapLiquidityInput> = {}): UniswapLiquidityInput {
  const band = uniswapBandInput((sqrtRatioAtTick(TICK) + 123_456_789n).toString(), 1_000, network);
  return { network, maxUsdc: '10', maxWeth: '0.005', rangeUnit: band.rangeUnit, lower: band.lower, upper: band.upper, slippage: '100', ...patch };
}
function workflow(network: UniswapLiquidityInput['network'] = 'Ethereum Sepolia', patch: Partial<UniswapLiquidityInput> = {}): SemanticWorkflow {
  const context = network === 'Ethereum Sepolia' ? createEthereumSepoliaReviewContext() : createBaseSepoliaReviewContext();
  const result = editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY', input: input(network, patch), source: 'CANVAS', baseRevision: 0 }, context);
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
/** One service holding the Base Sepolia client (`rpc`) and, unless withheld, the Ethereum Sepolia client (`rpcs`). */
async function setup(options: { ethereum?: Rpc | null; base?: Rpc; dir?: string } = {}) {
  const chain = createUniswapLiquidityChain({ profile: E, tick: TICK });
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'flofi-eth-unilp-'));
  const base: Rpc = options.base ?? (async () => { throw new Error('BASE_CLIENT_MUST_NOT_BE_USED'); });
  const ethereum = options.ethereum === undefined ? chain.rpc : options.ethereum;
  const service = createUniswapLiquidityService({ storage: createFileExecutionStorage(dir, 'UNISWAP_LIQUIDITY_BUSY'), rpc: base,
    ...ethereum ? { rpcs: { [E.chain]: ethereum } } : {}, provenance: 'MOCKED', mockedCodePins: UNI_MOCK_CODE_PINS, now: chain.clock });
  return { chain, dir, service };
}
type Service = Awaited<ReturnType<typeof setup>>['service'];
async function reviewed(s: Service, w: SemanticWorkflow) {
  const simulated = await s.simulate(w, UNI_OWNER);
  return s.review(simulated.id, simulated.review.commitment, w);
}
async function execute(s: Service, chain: UniswapLiquidityChain, id: string, w: SemanticWorkflow) {
  const begun: UniswapBegin = await s.begin(id, UNI_OWNER, w);
  await s.handoff(id);
  const hash = chain.wallet.send(begun.transaction);
  await s.report(id, { kind: 'HASH', hash });
  return { begun, hash };
}

describe('Ethereum Sepolia Uniswap v3 liquidity', () => {
  it('authors the verified 0.3% pool on tick spacing 60 and refuses Base Sepolia ticks, fee tier and tokens', () => {
    const node = workflow().nodes.find(n => n.actionType === 'asset.liquidity.concentrated')!;
    expect(node.chainId).toBe('eip155:11155111');
    const ticks = input('Ethereum Sepolia');
    expect(Number(ticks.lower) % 60).toBe(0);
    expect(Number(ticks.upper) % 60).toBe(0);
    // A band aligned to Base's spacing 10 that is not on 60 is not an Ethereum Sepolia range.
    expect(() => createUniswapLiquidityNode('node-002', { ...input('Ethereum Sepolia'), lower: '225010', upper: '226010' })).toThrow('UNISWAP_LIQUIDITY_RANGE_INVALID');
    const base = workflow('Base Sepolia').nodes.find(n => n.actionType === 'asset.liquidity.concentrated')!;
    expect(base.chainId).toBe('eip155:84532');
    // The same "USDC"/"WETH" symbols on another network never select Base tokens or the Base 0.05% fee tier.
    const forged = JSON.parse(JSON.stringify(node).replaceAll(E.token0.address, BASE.token0.address)) as typeof node;
    expect(JSON.stringify(forged)).toContain(BASE.token0.address);
    expect(() => validateUniswapLiquidityNode(forged)).toThrow('UNISWAP_TOKEN_UNSUPPORTED');
    const baseFee = JSON.parse(JSON.stringify(node).replace('"name":"fee-tier","kind":"INTEGER","value":3000', '"name":"fee-tier","kind":"INTEGER","value":500')) as typeof node;
    expect(JSON.stringify(baseFee)).toContain('"value":500');
    expect(() => validateUniswapLiquidityNode(baseFee)).toThrow('UNISWAP_FEE_TIER_UNSUPPORTED');
    expect(() => createUniswapLiquidityNode('node-002', { ...input('Ethereum Sepolia'), slippage: '301' })).toThrow('UNISWAP_SLIPPAGE_OUT_OF_RANGE');
  });

  it('binds chain 11155111, the 0.3% pool, spacing 60, exact approvals, minimums and a zero L1 data fee into Review', async () => {
    const { service } = await setup(), w = workflow();
    const run = await service.simulate(w, UNI_OWNER), r = run.review;
    expect(r).toMatchObject({ chainId: 11155111, owner: UNI_OWNER, recipient: UNI_OWNER, token0: { symbol: 'USDC', address: E.token0.address },
      token1: { symbol: 'WETH', address: E.token1.address }, pool: { fee: 3000, tickSpacing: 60 }, range: { state: 'IN_RANGE' },
      contracts: { positionManager: E.positionManager, pool: E.pool, factory: E.factory } });
    expect(r.range.tickLower % 60).toBe(0);
    expect(r.range.tickUpper % 60).toBe(0);
    expect(r.approvals.map(a => [a.symbol, a.amount, a.spender])).toEqual([['USDC', '10000000', E.positionManager], ['WETH', '5000000000000000', E.positionManager]]);
    expect(r.calls.map(c => [c.step, c.to])).toEqual([['APPROVE_TOKEN0', E.token0.address], ['APPROVE_TOKEN1', E.token1.address], ['MINT', E.positionManager]]);
    expect(decodeUniswapMint(r.calls[2]!.data)).toMatchObject({ token0: E.token0.address, token1: E.token1.address, fee: 3000, recipient: UNI_OWNER,
      tickLower: r.range.tickLower, tickUpper: r.range.tickUpper });
    expect(r.fees.l1FeeUpperBoundWei).toBe('0');
    expect(r.fees.totalUpperBoundWei).toBe(r.fees.executionFeeUpperBoundWei);
  });

  it('approves, mints and reconciles L1 receipts on 0xaa36a7; the Base client is never used', async () => {
    const { service, chain } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    const first = await execute(service, chain, run.id, w);
    expect(first.begun.transaction).toMatchObject({ chainId: '0xaa36a7', from: UNI_OWNER, to: E.token0.address, value: '0x0' });
    await service.observe(run.id);
    await execute(service, chain, run.id, w);
    await service.observe(run.id);
    const mint = await execute(service, chain, run.id, w);
    expect(mint.begun.transaction).toMatchObject({ chainId: '0xaa36a7', to: E.positionManager });
    const record = await service.observe(run.id);
    expect(record.verdict).toBe('RECONCILED');
    expect(record.attempts.map(a => [a.step, a.state, a.receipt?.l1FeeWei])).toEqual([['APPROVE_TOKEN0', 'CONFIRMED', '0'], ['APPROVE_TOKEN1', 'CONFIRMED', '0'], ['MINT', 'CONFIRMED', '0']]);
    expect(record.position).toMatchObject({ owner: UNI_OWNER, pool: E.pool, tickLower: run.review.range.tickLower, tickUpper: run.review.range.tickUpper });
    expect(chain.snapshot.owners[record.position!.tokenId]).toBe(UNI_OWNER);
    expect(record.evidence).toMatchObject({ evidenceClass: 'MOCKED', reconciliation: 'RECONCILED', bundle: { environment: 'MOCKED', outcome: 'RECONCILED' } });
    expect(chain.counters.sends).toBe(3);
  });

  it('chain-qualifies the owner nonce lease so an Ethereum Sepolia nonce never blocks the same Base Sepolia nonce', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flofi-eth-unilp-'));
    const baseChain = createUniswapLiquidityChain({ tick: TICK });
    const { service, chain } = await setup({ base: baseChain.rpc, dir });
    const ew = workflow(), bw = workflow('Base Sepolia');
    const erun = await reviewed(service, ew), brun = await reviewed(service, bw);
    const e = await service.begin(erun.id, UNI_OWNER, ew), b = await service.begin(brun.id, UNI_OWNER, bw);
    expect(e.transaction.chainId).toBe('0xaa36a7');
    expect(b.transaction.chainId).toBe('0x14a34');
    expect(e.attempt.nonce).toBe(b.attempt.nonce);
    const leases = (await readdir(dir, { recursive: true })).map(String).filter(name => name.endsWith('.unilp-intent'));
    expect(leases.some(name => name.includes(`eip155-11155111-${UNI_OWNER}-`))).toBe(true);
    expect(leases.some(name => !name.includes('eip155-'))).toBe(true);
    expect(chain.counters.sends + baseChain.counters.sends).toBe(0);
  });

  it('fails closed on an unconfigured network, a provider on Base or Ethereum Mainnet, and a receipt carrying an L2 data fee', async () => {
    await expect((await setup({ ethereum: null })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_NETWORK_UNAVAILABLE');
    for (const reported of ['0x14a34', '0x1']) {
      const chain = createUniswapLiquidityChain({ profile: E, tick: TICK });
      const lying: Rpc = (method, params) => method === 'eth_chainId' ? Promise.resolve(reported) : chain.rpc(method, params);
      await expect((await setup({ ethereum: lying })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_WRONG_CHAIN');
    }
    // A Base Sepolia chain behind the Ethereum Sepolia client is refused before any economic read.
    const baseChain = createUniswapLiquidityChain({ tick: TICK });
    await expect((await setup({ ethereum: baseChain.rpc })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_WRONG_CHAIN');
    // An L1 receipt must not carry an OP Stack l1Fee: the attempt is frozen for attention, never reconciled.
    const chain = createUniswapLiquidityChain({ profile: E, tick: TICK });
    const l2Receipt: Rpc = async (method, params) => {
      const value = await chain.rpc(method, params);
      return method === 'eth_getTransactionReceipt' && value && typeof value === 'object' ? { ...value, l1Fee: '0x10' } : value;
    };
    const { service } = await setup({ ethereum: l2Receipt }), w = workflow();
    const run = await reviewed(service, w);
    await execute(service, chain, run.id, w);
    const record = await service.observe(run.id);
    expect(record.verdict).toBe('DIVERGENT');
    expect(record.attempts.at(-1)).toMatchObject({ state: 'RECONCILIATION_REQUIRED', reconciled: false });
  });

  it('refuses a different fee tier, a moved pool identity and a stale Review on Ethereum Sepolia', async () => {
    const chain = createUniswapLiquidityChain({ profile: E, tick: TICK });
    const feeLie: Rpc = (method, params) => {
      const call = params[0] as { to?: string; data?: string } | undefined;
      return method === 'eth_call' && call?.to === E.pool && call.data === '0xddca3f43' ? Promise.resolve('0x' + 500n.toString(16).padStart(64, '0')) : chain.rpc(method, params);
    };
    await expect((await setup({ ethereum: feeLie })).service.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_POOL_MISMATCH');
    const strict = createUniswapLiquidityService({ storage: createFileExecutionStorage(await mkdtemp(join(tmpdir(), 'flofi-eth-unilp-')), 'B'),
      rpc: async () => { throw new Error('BASE'); }, rpcs: { [E.chain]: chain.rpc }, provenance: 'MOCKED', now: chain.clock });
    await expect(strict.simulate(workflow(), UNI_OWNER)).rejects.toThrow('UNISWAP_UNEXPECTED_CONTRACT');
    const { service, chain: c } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    c.advance(130);
    await expect(service.begin(run.id, UNI_OWNER, w)).rejects.toThrow();
    expect(c.counters.sends).toBe(0);
  });
});

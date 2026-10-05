// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ETHEREUM-001: the Aave V3 compiler on the Ethereum Sepolia WBTC profile (reserve id 3, 8 decimals). */
import { describe, expect, it } from 'vitest';
import { createBorrowNode, createRepayNode, createSupplyNode, createWithdrawNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as base, AAVE_V3_ETHEREUM_SEPOLIA as eth, assertSupplyReview, compileBorrowCalls, compileRepayCalls, compileSupplyCalls,
  compileWithdrawCalls, estimateBorrow, estimateRepay, readBorrowState, readSupplyLatestNonce, readSupplyState, reserveBits, simulateSupply, supplyCall,
  type AaveLendingProfile } from '../src/index.js';
// @ts-expect-error The MOCKED loopback harness is plain JavaScript shared with the browser suite.
import { createSupplyHarness, mockAllowanceSlot, OWNER } from '../../../apps/reference-dapp/e2e/supply-harness.mjs';

type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
type Model = { state: Record<string, unknown>; rpc: Rpc; transactions: unknown[] };
const assetOf = (p: AaveLendingProfile) => ({ chainId: p.chain, address: p.asset, decimals: p.decimals });
const flow = (node: SemanticWorkflow['nodes'][number]): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'eth', revision: 0, nodes: [node], resourceEdges: [] });
const supply = (amount = '1000000', p: AaveLendingProfile = eth) => flow(createSupplyNode('supply', { chain: p.chain, asset: assetOf(p), amount, beneficiary: OWNER }));
const borrow = (amount = '10000') => flow(createBorrowNode('borrow', { chain: eth.chain, asset: assetOf(eth), amount, beneficiary: OWNER, interestRateMode: 2 }));
const word = (value: string | bigint) => (typeof value === 'string' ? value.slice(2).padStart(64, '0') : value.toString(16).padStart(64, '0'));
const ethereum = (): Model => { const m = createSupplyHarness(eth) as Model; Object.assign(m.state, { price: 6_000_000_000_000n }); return m; };

describe('Ethereum Sepolia Aave calldata', () => {
  it('approves exactly and supplies WBTC to the Ethereum Sepolia Pool on chain 0xaa36a7', () => {
    const calls = compileSupplyCalls(supply('1000000'), OWNER, '0');
    expect(calls).toEqual([
      { from: OWNER, to: eth.asset, value: '0x0', chainId: '0xaa36a7', data: '0x095ea7b3' + word(eth.pool) + word(1_000_000n) },
      { from: OWNER, to: eth.pool, value: '0x0', chainId: '0xaa36a7', data: '0x617ba037' + word(eth.asset) + word(1_000_000n) + word(OWNER) + word(0n) },
    ]);
    expect(compileSupplyCalls(supply('1000000'), OWNER, '1000000')).toHaveLength(1);
  });
  it('borrows, repays and withdraws with the owner as beneficiary, variable mode 2', () => {
    expect(compileBorrowCalls(borrow('10000'), OWNER)).toEqual([{ from: OWNER, to: eth.pool, value: '0x0', chainId: '0xaa36a7',
      data: supplyCall('borrow(address,uint256,uint256,uint16,address)', eth.asset, 10_000n, 2n, 0n, OWNER) }]);
    const repay = flow(createRepayNode('repay', { chain: eth.chain, asset: assetOf(eth), amount: '5000', beneficiary: OWNER, interestRateMode: 2 }));
    expect(compileRepayCalls(repay, OWNER, '0').map(tx => [tx.to, tx.data, tx.chainId])).toEqual([
      [eth.asset, supplyCall('approve(address,uint256)', eth.pool, 5000n), '0xaa36a7'],
      [eth.pool, supplyCall('repay(address,uint256,uint256,address)', eth.asset, 5000n, 2n, OWNER), '0xaa36a7']]);
    const withdraw = flow(createWithdrawNode('withdraw', { chain: eth.chain, asset: assetOf(eth), amount: '100000', recipient: 'CONNECTED_OWNER' }));
    expect(compileWithdrawCalls(withdraw, OWNER)).toEqual([{ from: OWNER, to: eth.pool, value: '0x0', chainId: '0xaa36a7',
      data: supplyCall('withdraw(address,uint256,address)', eth.asset, 100_000n, OWNER) }]);
    expect(() => compileBorrowCalls(borrow(), '0x' + '2'.repeat(40))).toThrow('BORROW_BENEFICIARY_MUST_BE_OWNER');
    expect(() => compileRepayCalls(repay, '0x' + '2'.repeat(40), '0')).toThrow('REPAY_BENEFICIARY_MUST_BE_OWNER');
  });
  it('refuses another network asset in an Ethereum Sepolia node and an unregistered chain', () => {
    const baseUsdc = flow(createSupplyNode('supply', { chain: eth.chain, asset: { ...assetOf(base), chainId: eth.chain }, amount: '1', beneficiary: OWNER }));
    expect(() => compileSupplyCalls(baseUsdc, OWNER, '0')).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    const sixDecimals = flow(createSupplyNode('supply', { chain: eth.chain, asset: { ...assetOf(eth), decimals: 6 }, amount: '1', beneficiary: OWNER }));
    expect(() => compileSupplyCalls(sixDecimals, OWNER, '0')).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    const mainnet = flow(createSupplyNode('supply', { chain: 'eip155:1', asset: { ...assetOf(eth), chainId: 'eip155:1' }, amount: '1', beneficiary: OWNER }));
    expect(() => compileSupplyCalls(mainnet, OWNER, '0')).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  });
});

describe('Ethereum Sepolia reserve arithmetic', () => {
  it('uses reserve id 3 bits and an 8-decimal unit', () => {
    expect(reserveBits(eth)).toEqual({ mask: 0xc0n, borrowing: 0x40n, collateral: 0x80n, scale: 100_000_000n });
    expect(reserveBits(base)).toEqual({ mask: 3n, borrowing: 1n, collateral: 2n, scale: 1_000_000n });
  });
  it('values a WBTC borrow at amount × price / 10^8, rounded up, and keeps HF ≥ 2', async () => {
    const m = ethereum(), state = await readBorrowState(m.rpc, eth, OWNER, OWNER);
    expect(state.borrow).toMatchObject({ collateralBase: '600000000000', debtBase: '0', price: '6000000000000' });
    expect(estimateBorrow('10000', state.borrow!, eth)).toMatchObject({ borrowValueBase: '600000000', debtAfterBase: '600000000' });
    expect(estimateBorrow('1', state.borrow!, eth).borrowValueBase).toBe('60000');
    // A third of the 0.1 WBTC collateral would leave HF < 2.0 at an 86% threshold.
    expect(() => estimateBorrow('5000000', state.borrow!, eth)).toThrow('BORROW_UNSAFE_HEALTH_FACTOR');
    // The same state read with the Base profile's reserve bits and decimals is refused, never reinterpreted.
    expect(() => estimateBorrow('10000', state.borrow!, base)).toThrow();
  });
  it('previews a partial WBTC repayment with the 8-decimal unit', async () => {
    const m = ethereum();
    Object.assign(m.state, { scaledDebt: 8_000n, userConfig: 0xc0n });
    const state = await readBorrowState(m.rpc, eth, OWNER, OWNER);
    const preview = estimateRepay('5000', state.borrow!, eth);
    expect(BigInt(preview.debtAfter)).toBe(5000n);
    expect(preview.debtAfterBase).toBe(((5000n * 6_000_000_000_000n + 99_999_999n) / 100_000_000n).toString());
  });
});

describe('Ethereum Sepolia state reads fail closed', () => {
  it('requires the RPC to report chain 11155111', async () => {
    const m = ethereum();
    expect(await readSupplyLatestNonce(m.rpc, eth, OWNER)).toBe('0');
    for (const chain of ['0x14a34', '0x1', '0xaa36a8']) {
      m.state.chain = chain;
      await expect(readSupplyLatestNonce(m.rpc, eth, OWNER)).rejects.toThrow('SUPPLY_WRONG_CHAIN');
      await expect(readSupplyState(m.rpc, eth, OWNER, OWNER)).rejects.toThrow('SUPPLY_WRONG_CHAIN');
    }
  });
  it('refuses a reserve that reports another id or other decimals, and a Base reserve read as Ethereum Sepolia', async () => {
    const wrongId: Rpc = async (method, params) => {
      const call = params[0] as { to?: string; data?: string } | undefined, result = await (ethereum().rpc)(method, params) as string;
      return method === 'eth_call' && call?.to === eth.pool && call.data === supplyCall('getReserveData(address)', eth.asset) ? result.slice(0, 2 + 7 * 64) + word(0n) + result.slice(2 + 8 * 64) : result;
    };
    await expect(readBorrowState(wrongId, eth, OWNER, OWNER)).rejects.toThrow('BORROW_RESERVE_UNSUPPORTED');
    const sixDecimals = ethereum();
    const rpc: Rpc = async (method, params) => (params[0] as { data?: string })?.data === supplyCall('decimals()') ? '0x' + word(6n) : sixDecimals.rpc(method, params);
    await expect(readSupplyState(rpc, eth, OWNER, OWNER)).rejects.toThrow('SUPPLY_DEPLOYMENT_MISMATCH');
    const baseReserve = createSupplyHarness(base) as Model;
    await expect(readSupplyState(baseReserve.rpc, eth, OWNER, OWNER)).rejects.toThrow('SUPPLY_WRONG_CHAIN');
  });
  it('binds the Review to its chain: a tampered chain or a workflow on another network is refused', async () => {
    const m = ethereum();
    Object.assign(m.state, { owner: OWNER, allowanceSlot: mockAllowanceSlot(OWNER, eth) });
    const workflow = supply(), review = await simulateSupply(workflow, OWNER, m.rpc);
    expect(review).toMatchObject({ chain: eth.chain, pool: eth.pool, asset: eth.asset, aToken: eth.aToken });
    expect(review.manifest.owner.chainId).toBe(eth.chain);
    expect(review.plan.segments[0]!.chainId).toBe(eth.chain);
    expect(() => assertSupplyReview(review, workflow, OWNER, review.state)).not.toThrow();
    expect(() => assertSupplyReview({ ...review, chain: base.chain }, workflow, OWNER, review.state)).toThrow();
    expect(() => assertSupplyReview(review, supply('1000000', base), OWNER, review.state)).toThrow();
    expect(m.transactions).toHaveLength(0);
  });
});

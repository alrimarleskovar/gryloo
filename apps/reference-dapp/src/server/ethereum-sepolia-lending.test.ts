// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001: Aave V3 WBTC on Ethereum Sepolia through the unchanged service, executor model, reconcilers and evidence,
 * against the MOCKED loopback reserve. Every owner transaction is "sent" only by the harness wallet stand-in.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBorrowNode, createRepayNode, createSupplyNode, createWithdrawNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as base, AAVE_V3_ETHEREUM_SEPOLIA as eth, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
import { supplyCall } from '@defi-workflow-engine/reference-compiler';
import { createSupplyService, type SupplyRecord } from './supply-service';
// @ts-expect-error The MOCKED loopback harness is plain JavaScript shared with the browser suite.
import { createSupplyHarness, mockAllowanceSlot, REPAY_OWNER as OWNER } from '../../e2e/supply-harness.mjs';

type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
type Model = { state: Record<string, unknown> & { nonce: number; price: bigint; balance: bigint }; rpc: Rpc; transactions: Record<string, unknown>[];
  receipts: Map<string, Record<string, unknown>> };
const assetOf = (p: AaveLendingProfile) => ({ chainId: p.chain, address: p.asset, decimals: p.decimals });
const flow = (node: SemanticWorkflow['nodes'][number]): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'eth-lending', revision: 0, nodes: [node], resourceEdges: [] });
const supply = (amount = '1000000') => flow(createSupplyNode('supply', { chain: eth.chain, asset: assetOf(eth), amount, beneficiary: OWNER }));
const borrow = (amount = '10000') => flow(createBorrowNode('borrow', { chain: eth.chain, asset: assetOf(eth), amount, beneficiary: OWNER, interestRateMode: 2 }));
const repay = (amount = '5000') => flow(createRepayNode('repay', { chain: eth.chain, asset: assetOf(eth), amount, beneficiary: OWNER, interestRateMode: 2 }));
const withdraw = (amount = '100000') => flow(createWithdrawNode('withdraw', { chain: eth.chain, asset: assetOf(eth), amount, recipient: 'CONNECTED_OWNER' }));
/** The Ethereum Sepolia WBTC reserve: reserve id 3, 8 decimals, WBTC at 60,000 USD, an existing 0.1 WBTC collateral position. */
function ethereumReserve(): Model {
  const model = createSupplyHarness(eth) as Model;
  Object.assign(model.state, { owner: OWNER, allowanceSlot: mockAllowanceSlot(OWNER, eth), price: 6_000_000_000_000n });
  return model;
}
/** Counts reads so a test can prove which network was (or was not) contacted. */
function counted(rpc: Rpc) { const calls: string[] = []; return { calls, rpc: (method: string, params: readonly unknown[]) => { calls.push(method); return rpc(method, params); } }; }
async function fixture(action: (f: { model: Model; dir: string; service: ReturnType<typeof createSupplyService>; baseCalls: string[] }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-lending-')), model = ethereumReserve(), baseModel = counted((createSupplyHarness() as Model).rpc);
  const service = createSupplyService({ rpc: baseModel.rpc, rpcs: { [eth.chain]: model.rpc }, journalDir: dir, provenance: 'MOCKED' });
  try { await action({ model, dir, service, baseCalls: baseModel.calls }); } finally { await rm(dir, { recursive: true, force: true }); }
}
/** Simulate → Review → (begin → durable handoff → owner send → report → observe) until the run settles. */
async function execute(service: ReturnType<typeof createSupplyService>, model: Model, workflow: SemanticWorkflow): Promise<SupplyRecord> {
  let run = await service.simulate(workflow, OWNER);
  run = await service.review(run.id, run.review.commitment, workflow);
  for (let step = 0; run.verdict === 'PENDING' && step < 3; step++) {
    const begin = await service.begin(run.id, OWNER, workflow);
    expect(begin.transaction.chainId).toBe('0xaa36a7');
    await service.handoff(run.id, begin.step);
    const hash = await model.rpc('MOCK_submit', [begin.transaction]) as string;
    await service.report(run.id, begin.step, { kind: 'HASH', hash });
    run = await service.observe(run.id);
  }
  return run;
}

describe('Ethereum Sepolia Aave V3 WBTC lifecycle', () => {
  it('supplies, borrows, repays and withdraws WBTC, each reconciled with honest MOCKED evidence on chain 11155111', async () => fixture(async ({ model, dir, service, baseCalls }) => {
    const supplied = await execute(service, model, supply());
    expect(supplied).toMatchObject({ verdict: 'RECONCILED', review: { chain: eth.chain, pool: eth.pool, asset: eth.asset, aToken: eth.aToken, approvalRequired: true } });
    expect(supplied.attempts.map(a => a.step)).toEqual(['APPROVAL', 'SUPPLY']);
    expect(supplied.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
    expect(supplied.evidence?.bundle.reconciliation.balances[0]?.asset).toEqual({ chainId: eth.chain, address: eth.asset, decimals: 8 });
    expect(supplied.evidence?.publicExecution).toMatchObject({ network: 'Ethereum Sepolia', chainId: 11155111, explorer: 'https://sepolia.etherscan.io' });

    const borrowed = await execute(service, model, borrow());
    expect(borrowed).toMatchObject({ verdict: 'RECONCILED', review: { approvalRequired: false, borrow: { interestRateMode: 2 } } });
    // Reserve id 3: the borrowing bit is 2·3 = 6 and the collateral bit 7.
    expect(BigInt((borrowed.observations.at(-1)?.postPosition?.borrow?.userConfiguration) ?? '0')).toBe((1n << 6n) | (2n << 6n));

    const repaid = await execute(service, model, repay());
    expect(repaid).toMatchObject({ verdict: 'RECONCILED', review: { approvalRequired: true, repay: { interestRateMode: 2 } } });
    expect(repaid.evidence?.publicExecution).toMatchObject({ walletDelta: '-5000', ownerAuthorization: { kind: 'DIRECT_EIP1559', owner: OWNER } });

    const withdrawn = await execute(service, model, withdraw());
    // An Ethereum L1 receipt carries no OP Stack l1Fee: the network cost is gasUsed × effectiveGasPrice and reconciles exactly.
    expect(withdrawn).toMatchObject({ verdict: 'RECONCILED', review: { withdraw: {} } });
    expect(withdrawn.observations.at(-1)?.cost).toBe((140_000n * 1_000_000n).toString());
    expect(model.receipts.size).toBe(6); // approval + Supply, Borrow, approval + Repay, Withdraw
    for (const receipt of model.receipts.values()) expect(receipt).not.toHaveProperty('l1Fee');

    expect(model.transactions.every(tx => tx.chainId === '0xaa36a7' && ([eth.pool, eth.asset] as string[]).includes(String(tx.to)))).toBe(true);
    // The Base Sepolia client was never contacted, and owner nonce leases on Ethereum Sepolia are chain-qualified.
    expect(baseCalls).toEqual([]);
    const leases = (await readdir(dir)).filter(name => name.endsWith('.intent') && name.includes(OWNER));
    expect(leases.length).toBeGreaterThan(0);
    for (const lease of leases) expect(lease.startsWith('eip155-11155111-' + OWNER) || lease.startsWith('borrow-') || lease.startsWith('repay-') || lease.startsWith('withdraw-')).toBe(true);
  }));
});

describe('Ethereum Sepolia lending fails closed before any owner submission', () => {
  it('refuses an Ethereum Sepolia workflow when no Ethereum Sepolia read client is configured, without touching Base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-lending-')), baseModel = counted((createSupplyHarness() as Model).rpc);
    try {
      const service = createSupplyService({ rpc: baseModel.rpc, journalDir: dir, provenance: 'MOCKED' });
      await expect(service.simulate(supply(), OWNER)).rejects.toThrow('SUPPLY_NETWORK_UNAVAILABLE');
      expect(baseModel.calls).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses an RPC that reports Base Sepolia (or Ethereum Mainnet) for an Ethereum Sepolia review', async () => fixture(async ({ model, service }) => {
    for (const chain of ['0x14a34', '0x1']) {
      model.state.chain = chain;
      await expect(service.simulate(supply(), OWNER)).rejects.toThrow('SUPPLY_WRONG_CHAIN');
    }
    expect(model.transactions).toHaveLength(0);
  }));
  it('never lets Base USDC enter an Ethereum Sepolia workflow, although both display as USDC', async () => fixture(async ({ model, service }) => {
    const collision = flow(createSupplyNode('supply', { chain: eth.chain, asset: { ...assetOf(base), chainId: eth.chain }, amount: '1000000', beneficiary: OWNER }));
    await expect(service.simulate(collision, OWNER)).rejects.toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    const reverse = flow(createSupplyNode('supply', { chain: base.chain, asset: { ...assetOf(eth), chainId: base.chain }, amount: '1000000', beneficiary: OWNER }));
    await expect(service.simulate(reverse, OWNER)).rejects.toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    expect(model.transactions).toHaveLength(0);
  }));
  it('stops at begin when the protocol identity changes after Review (Provider resolves another Pool)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-lending-')), model = ethereumReserve();
    let tampered = false;
    const rpc: Rpc = async (method, params) => {
      const call = params[0] as { to?: string; data?: string } | undefined;
      if (tampered && method === 'eth_call' && call?.to === eth.provider && call.data === supplyCall('getPool()')) return '0x' + '0'.repeat(24) + '2'.repeat(40);
      return model.rpc(method, params);
    };
    try {
      const service = createSupplyService({ rpc: (createSupplyHarness() as Model).rpc, rpcs: { [eth.chain]: rpc }, journalDir: dir, provenance: 'MOCKED' });
      const workflow = supply(), run = await service.simulate(workflow, OWNER);
      await service.review(run.id, run.review.commitment, workflow);
      tampered = true;
      await expect(service.begin(run.id, OWNER, workflow)).rejects.toThrow('SUPPLY_DEPLOYMENT_MISMATCH');
      expect(model.transactions).toHaveLength(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('refuses a protocol address that has no code', async () => fixture(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-lending-')), model = ethereumReserve();
    const rpc: Rpc = async (method, params) => method === 'eth_getCode' && params[0] === eth.aToken ? '0x' : model.rpc(method, params);
    try {
      const service = createSupplyService({ rpc: (createSupplyHarness() as Model).rpc, rpcs: { [eth.chain]: rpc }, journalDir: dir, provenance: 'MOCKED' });
      await expect(service.simulate(supply(), OWNER)).rejects.toThrow();
      expect(model.transactions).toHaveLength(0);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }));
  it('treats a changed wallet state after Review as stale, and an expired Review as stale', async () => fixture(async ({ model, service }) => {
    const workflow = supply(), run = await service.simulate(workflow, OWNER);
    await service.review(run.id, run.review.commitment, workflow);
    model.state.balance = 1n;
    await expect(service.begin(run.id, OWNER, workflow)).rejects.toThrow('SUPPLY_AUTHORIZATION_STALE');
    model.state.balance = 100_000_000n;
    const other = await service.simulate(workflow, OWNER);
    await expect(service.review(other.id, '0x' + '0'.repeat(64), workflow)).rejects.toThrow('SUPPLY_AUTHORIZATION_REPLACED');
    expect(model.transactions).toHaveLength(0);
  }));
  it('refuses a review whose workflow was edited to another network', async () => fixture(async ({ model, service }) => {
    const workflow = supply(), run = await service.simulate(workflow, OWNER);
    const edited = flow(createSupplyNode('supply', { chain: base.chain, asset: assetOf(base), amount: '1000000', beneficiary: OWNER }));
    await expect(service.review(run.id, run.review.commitment, edited)).rejects.toThrow();
    expect(model.transactions).toHaveLength(0);
  }));
});

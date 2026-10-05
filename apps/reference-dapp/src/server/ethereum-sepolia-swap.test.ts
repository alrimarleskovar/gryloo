// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ETHEREUM-001: the public Uniswap v3 swap on Ethereum Sepolia (USDC/WETH 0.3%) through the unchanged swap service. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReviewContext, createEthereumSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { createSwapNode } from '../domain/swap-authoring';
import { BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP as E, createPublicTestnetService, type Rpc } from './public-testnet-service';

const account = '0x1111111111111111111111111111111111111111', txHash = '0x' + 'a'.repeat(64), blockHash = '0x' + 'b'.repeat(64);
const word = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const addressWord = (a: string) => '0x' + a.slice(2).padStart(64, '0');
const signed = (n: bigint) => word(n < 0n ? (1n << 256n) + n : n);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function workflow(): SemanticWorkflow {
  const result = editorReducer(initialEditor(), { type: 'ADD_ETHEREUM_SEPOLIA_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CHAT', baseRevision: 0 },
    createBaseSepoliaReviewContext());
  expect(result.error).toBeNull();
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
/** A MOCKED Ethereum Sepolia chain: the official 0.3% pool, an L1 receipt shape (no l1Fee), one owner. */
function chain(options: { reported?: string; fee?: bigint; l1Fee?: string } = {}) {
  let allowance = 0n, usdc = 4_000_000n, weth = 0n, native = 10n ** 18n, step: 'approval' | 'swap' | null = null, clock = 1_790_000_000_000;
  const quoted = 50_849_929_498n;
  const calls: string[] = [];
  const rpc: Rpc = async (method, params) => {
    calls.push(method);
    if (method === 'eth_chainId') return options.reported ?? E.chainHex;
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getBlockByNumber') return params[0] === '0x65' ? { number: '0x65', hash: blockHash, timestamp: '0x' + Math.floor(clock / 1000).toString(16), transactions: [txHash] }
      : { number: '0x64', hash: blockHash, timestamp: '0x' + Math.floor(clock / 1000).toString(16) };
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_gasPrice') return '0x3b9aca00';
    if (method === 'eth_getBalance') return word(native);
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_getTransactionReceipt') {
      if (!step) return null;
      const logs = step === 'approval' ? [] : [
        { address: E.weth, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', addressWord(E.pool), addressWord(account)], data: word(quoted) },
        { address: E.usdc, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', addressWord(account), addressWord(E.pool)], data: word(2_000_000n) },
        { address: E.pool, topics: ['0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67', addressWord(E.router), addressWord(account)], data: word(2_000_000n) + signed(-quoted).slice(2) }];
      return { transactionHash: txHash, status: '0x1', blockNumber: '0x65', blockHash, from: account, to: step === 'approval' ? E.usdc : E.router,
        gasUsed: '0x186a0', effectiveGasPrice: '0x3b9aca00', ...options.l1Fee ? { l1Fee: options.l1Fee } : {}, logs };
    }
    if (method === 'eth_getTransactionByHash') return { hash: txHash, from: account, to: step === 'approval' ? E.usdc : E.router, input: lastData, chainId: E.chainHex,
      type: '0x2', nonce: '0x0', value: '0x0' };
    if (method === 'eth_call') {
      const request = params[0] as { to: string; data: string }, selector = request.data.slice(0, 10);
      if (selector === '0xc45a0155') return addressWord(E.factory);
      if (selector === '0x4aa4a4fc') return addressWord(E.weth);
      if (selector === '0x313ce567') return word(request.to === E.usdc ? 6n : 18n);
      if (selector === '0x1698ee82') return BigInt('0x' + request.data.slice(-64)) === BigInt(E.fee) ? addressWord(E.pool) : addressWord('0x' + '0'.repeat(40));
      if (selector === '0x0dfe1681') return addressWord(E.usdc);
      if (selector === '0xd21220a7') return addressWord(E.weth);
      if (selector === '0xddca3f43') return word(options.fee ?? 3000n);
      if (selector === '0x1a686502') return word(167_517_958_928_882_975n);
      if (selector === '0x3850c7bd') return word(12_652_087_434_586_686_436_818_820_361_995n);
      if (selector === '0xc6a5026a') return word(quoted);
      if (selector === '0xdd62ed3e') return word(allowance);
      if (selector === '0x70a08231') return word(request.to === E.usdc ? usdc : weth);
    }
    throw new Error('UNEXPECTED_RPC_' + method);
  };
  let lastData = '0x';
  return { rpc, calls, advance(ms: number) { clock += ms; }, now: () => new Date(clock),
    send(tx: { data: string }, kind: 'approval' | 'swap') { lastData = tx.data; step = kind; native -= 100_000n * 1_000_000_000n;
      if (kind === 'approval') allowance = 2_000_000n; else { usdc -= 2_000_000n; weth += quoted; } } };
}
function service(c: ReturnType<typeof chain>, withEthereum = true) {
  const dir = mkdtempSync(join(tmpdir(), 'build-ethereum-001-swap-')); dirs.push(dir);
  const base: Rpc = async () => { throw new Error('BASE_CLIENT_MUST_NOT_BE_USED'); };
  return createPublicTestnetService({ rpc: base, ...withEthereum ? { rpcs: { [E.chainRef]: c.rpc } } : {}, journalDir: dir, now: c.now });
}

describe('Ethereum Sepolia Uniswap v3 swap', () => {
  it('quotes the verified 0.3% pool, approves exactly, swaps, and reconciles an L1 receipt on chain 0xaa36a7', async () => {
    const c = chain(), s = service(c), w = workflow();
    expect(w.nodes.at(-1)!.chainId).toBe('eip155:11155111');
    const run = await s.prepare(w);
    expect(run.quote).toMatchObject({ chainId: 11155111, pool: E.pool, fee: 3000, inputToken: E.usdc, outputToken: E.weth, amountIn: '2000000',
      expectedOut: '50849929498', minimumOut: (50_849_929_498n * 9950n / 10000n).toString() });
    s.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await s.begin(run.quote.executionId, account);
    expect(approval.tx).toMatchObject({ chainId: '0xaa36a7', from: account, to: E.usdc, value: '0x0',
      data: '0x095ea7b3' + addressWord(E.router).slice(2) + word(2_000_000n).slice(2) });
    c.send(approval.tx, 'approval'); s.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    const afterApproval = await s.observe(run.quote.executionId);
    expect(afterApproval.attempts.at(-1)).toMatchObject({ step: 'approval', state: 'CONFIRMED', chainId: 11155111, receipt: { l1FeeWei: '0' } });
    const refreshed = await s.refresh(run.quote.executionId);
    s.review(run.quote.executionId, refreshed.quote.manifestHash);
    const swap = await s.begin(run.quote.executionId, account);
    expect(swap.tx).toMatchObject({ chainId: '0xaa36a7', to: E.router });
    expect(swap.tx.data.slice(0, 10)).toBe('0x04e45aaf');
    expect(BigInt('0x' + swap.tx.data.slice(10 + 128, 10 + 192))).toBe(3000n);
    c.send(swap.tx, 'swap'); s.report(run.quote.executionId, swap.attempt.attemptId, { kind: 'HASH', txHash });
    const done = await s.observe(run.quote.executionId);
    expect(done.outcome).toMatchObject({ inputSpent: '2000000', outputReceived: '50849929498', explorer: `https://sepolia.etherscan.io/tx/${txHash}` });
    // The swap service labels evidence for a public RPC; here the chain is MOCKED, so only the reconciled outcome is asserted.
    expect(done.outcome?.evidence).toMatchObject({ outcome: 'RECONCILED' });
    expect(done.outcome?.evidence.reconciliation.ownership).toEqual([{ chainId: 'eip155:11155111', address: account }]);
  });
  it('never accepts Base USDC in an Ethereum Sepolia swap, even though both are USDC', async () => {
    const c = chain(), s = service(c), w = workflow(), node = w.nodes.at(-1)!;
    const forged = createSwapNode(node.nodeId, 'USDC_TO_WETH', '2', '50', createEthereumSepoliaReviewContext());
    const amount = forged.inputs.find(p => p.name === 'amount-in')!;
    if (amount.kind !== 'QUANTITY') throw new Error('fixture');
    const baseUsdc = { chainId: 'eip155:11155111', address: BASE_SEPOLIA.usdc, decimals: 6 };
    const tampered = { ...w, nodes: [...w.nodes.slice(0, -1), { ...forged, inputs: forged.inputs.map(p => p.name === 'amount-in' ? { ...amount, value: { ...amount.value, asset: baseUsdc } } : p) }] };
    await expect(s.prepare(tampered as SemanticWorkflow)).rejects.toThrow();
    expect(c.calls).toEqual([]);
  });
  it('fails closed on a provider on another chain, an unconfigured network, a different fee tier and an L1 receipt with l1Fee', async () => {
    for (const reported of ['0x14a34', '0x1']) await expect(service(chain({ reported })).prepare(workflow())).rejects.toThrow('WRONG_PROVIDER_CHAIN');
    await expect(service(chain(), false).prepare(workflow())).rejects.toThrow('PUBLIC_NETWORK_UNAVAILABLE');
    await expect(service(chain({ fee: 500n })).prepare(workflow())).rejects.toThrow('POOL_METADATA_MISMATCH');
    const c = chain({ l1Fee: '0x10' }), s = service(c), run = await s.prepare(workflow());
    s.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await s.begin(run.quote.executionId, account);
    c.send(approval.tx, 'approval'); s.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    await expect(s.observe(run.quote.executionId)).rejects.toThrow('RECEIPT_INVALID');
  });
  it('expires a stale quote before preparing any transaction', async () => {
    const c = chain(), s = service(c), run = await s.prepare(workflow());
    s.review(run.quote.executionId, run.quote.manifestHash);
    c.advance(61_000);
    await expect(s.begin(run.quote.executionId, account)).rejects.toThrow();
    expect(s.load(run.quote.executionId).attempts).toHaveLength(0);
  });
});

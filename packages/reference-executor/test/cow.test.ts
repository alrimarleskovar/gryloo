// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { compileCow, type CowQuote } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { cowStatus, initialCowRecord, postCowOnce, recoverCowPost, transitionCow, type CowOrderbookTransport } from '../src/cow.js';

const now = Date.parse('2026-09-27T00:00:30.000Z');
const owner = '0x1234567890123456789012345678901234567890';
const weth = { chainId: 'eip155:8453', address: '0x4200000000000000000000000000000000000006', decimals: 18 } as const;
const usdc = { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 } as const;
const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'cow.executor', revision: 1, resourceEdges: [],
  nodes: [{ nodeId: 'swap', actionType: 'asset.swap.exact-input', actionSchemaVersion: '1.0.0', chainId: 'eip155:8453',
    requiredCapabilities: ['swap.direct-transaction'], adapterConstraints: { adapters: [], protocols: ['uniswap', 'cow-protocol'] },
    inputs: [{ name: 'amount-in', kind: 'QUANTITY', value: { asset: weth, amount: '1000000000000000000' } },
      { name: 'asset-out', kind: 'ASSET', value: usdc }],
    expectedOutputs: [{ outputId: 'amount-out', asset: usdc, minimumAmount: '0' }], dependencies: [],
    userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: weth, amount: '1000000000000000000' } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: 100 }], failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A',
    lockedParameters: [], editableBounds: [] }] };
const quote: CowQuote = { quoteId: 'local-executor', sourceId: 'cow.loopback.orderbook', chainId: 'eip155:8453',
  sellToken: (weth as { address: string }).address, buyToken: (usdc as { address: string }).address,
  owner, receiver: owner, sellAmount: '1000000000000000000', buyAmount: '990000000', feeAmount: '0',
  validTo: 1790467800, observedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T00:01:00.000Z',
  sourceBlock: 0, sourceHash: '0x' + '1'.repeat(64), rawHash: '0x' + '2'.repeat(64) };
const at = new Date(now).toISOString();
const signed = () => transitionCow(initialCowRecord('cow-test', quote, compileCow(workflow, quote, now), at), 'SIGNED', at,
  { signature: '0x' + '1'.repeat(130) });

describe('CoW durable order posting and recovery', () => {
  it('persists one attempt before transport, then uses lookup only after an ambiguous post', async () => {
    const saved: string[] = [];
    let posts = 0, lookups = 0;
    const transport: CowOrderbookTransport = {
      async post() { expect(saved.at(-1)).toBe('POSTING'); posts++; throw new Error('connection lost after acceptance'); },
      async lookup(uid) { lookups++; return { uid, status: 'open', executedSellAmount: '0', executedBuyAmount: '0', observedAt: at }; },
      async cancel() { return { accepted: false }; },
    };
    const persist = async (record: { state: string }) => { saved.push(record.state); };
    const unknown = await postCowOnce(signed(), transport, persist, at);
    expect(unknown.state).toBe('POST_RESULT_UNKNOWN');
    expect(unknown.postCount).toBe(1);
    await expect(postCowOnce(unknown, transport, persist, at)).rejects.toThrow('COW_POST_NOT_ALLOWED');
    const recovered = await recoverCowPost(unknown, transport, persist, at);
    expect(recovered.state).toBe('OPEN');
    expect({ posts, lookups, saved }).toEqual({ posts: 1, lookups: 1, saved: ['POSTING', 'POST_RESULT_UNKNOWN', 'OPEN'] });
  });
  it('keeps uncertain status when lookup fails or finds no order; rejects a divergent UID', async () => {
    const record = transitionCow(signed(), 'POST_RESULT_UNKNOWN', at, { postingAttemptId: 'attempt', postCount: 1 });
    const persist = async () => { throw new Error('unexpected write'); };
    const missing: CowOrderbookTransport = { post: async () => { throw new Error('unexpected post'); },
      lookup: async () => null, cancel: async () => ({ accepted: false }) };
    expect(await recoverCowPost(record, missing, persist, at)).toBe(record);
    expect(await recoverCowPost(record, { ...missing, lookup: async () => { throw new Error('network'); } }, persist, at)).toBe(record);
    const fulfilled = transitionCow(record, 'RECONCILIATION_REQUIRED', at);
    expect(await recoverCowPost(fulfilled, missing, persist, at)).toBe(fulfilled);
    const cancelPending = transitionCow(record, 'CANCEL_REQUESTED', at);
    expect(await recoverCowPost(cancelPending, missing, persist, at)).toBe(cancelPending);
    expect(() => cowStatus(record, { uid: '0x' + '0'.repeat(112), status: 'fulfilled', executedSellAmount: '1',
      executedBuyAmount: '1', observedAt: at }, at)).toThrow('COW_ORDERBOOK_RESPONSE_INVALID');
    expect(() => cowStatus(record, { uid: record.compiled.orderUid, status: 'unexpected' as never, executedSellAmount: '0',
      executedBuyAmount: '0', observedAt: at }, at)).toThrow('COW_ORDERBOOK_RESPONSE_INVALID');
  });
  it('does not mark cancellation requested as cancelled without observation', () => {
    const record = transitionCow(signed(), 'CANCEL_REQUESTED', at, { postingAttemptId: 'attempt', postCount: 1 });
    expect(record.state).toBe('CANCEL_REQUESTED');
    const confirmed = cowStatus(record, { uid: record.compiled.orderUid, status: 'cancelled', executedSellAmount: '0',
      executedBuyAmount: '0', observedAt: at }, at);
    expect(confirmed.state).toBe('CANCELLED');
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { cowCancellationDigest, cowOrderDigest } from '@defi-workflow-engine/reference-compiler';
import { signCowDisposable, type CowOrderbookTransport } from '@defi-workflow-engine/reference-executor';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { createSwapNode } from '../domain/swap-authoring';
import { createCowService, discoverCow } from './cow-service';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const workflow = () => ({ schemaVersion: '1.0.0' as const, workflowId: 'cow-service-test', revision: 1,
  nodes: [createSwapNode('swap-1', 'WETH_TO_USDC', '1', '100', context, 'cow')], resourceEdges: [] });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gryloo-cow-test-')); dirs.push(dir);
  const key = randomBytes(32);
  const owner = signCowDisposable('0x' + '1'.repeat(64), key).owner;
  return { service: createCowService(dir), dir, key, owner };
}
const orderSignature = (record: Awaited<ReturnType<ReturnType<typeof createCowService>['prepare']>>, key: Uint8Array) =>
  signCowDisposable(cowOrderDigest(record.record.compiled.order), key).signature;
describe('local CoW signed-intent journey', () => {
  it('discovers the authorized swap, posts once, tracks and reconciles scripted settlement', async () => {
    const { service, key, owner } = await fixture();
    expect(discoverCow(workflow()).available).toBe(true);
    const prepared = await service.prepare(workflow(), owner, 'fill');
    expect(prepared.record.compiled.quote.normalizedValues[1]).toMatchObject({ name: 'evidence-environment', value: 'MOCKED' });
    const posted = await service.signAndPost(prepared.record.executionId, orderSignature(prepared, key));
    expect(posted.record.state).toBe('POSTED');
    expect(posted.record.postCount).toBe(1);
    expect((await service.track(prepared.record.executionId)).record.state).toBe('OPEN');
    expect((await service.track(prepared.record.executionId)).record.state).toBe('RECONCILIATION_REQUIRED');
    const final = await service.reconcile(prepared.record.executionId);
    expect(final.record.state).toBe('RECONCILED');
    expect(final.evidence?.bundle.environment).toBe('MOCKED');
    expect(final.evidence?.bundle.outcome).toBe('RECONCILED');
    expect(final.evidence?.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('recovers an ambiguous post after process restart without a second submission', async () => {
    const { service, dir, key, owner } = await fixture();
    const prepared = await service.prepare(workflow(), owner, 'ambiguous');
    const signed = await service.signAndPost(prepared.record.executionId, orderSignature(prepared, key));
    expect(signed.record.state).toBe('POST_RESULT_UNKNOWN');
    const resumed = createCowService(dir);
    expect((await resumed.status(prepared.record.executionId)).record.postCount).toBe(1);
    expect((await resumed.track(prepared.record.executionId)).record.state).toBe('OPEN');
    expect((await resumed.track(prepared.record.executionId)).record.state).toBe('OPEN');
    expect((await resumed.track(prepared.record.executionId)).record.state).toBe('RECONCILIATION_REQUIRED');
    expect((await resumed.reconcile(prepared.record.executionId)).evidence?.bundle.outcome).toBe('RECONCILED');
    await expect(resumed.signAndPost(prepared.record.executionId, orderSignature(prepared, key))).rejects.toThrow('COW_POST_NOT_ALLOWED');
    expect((await resumed.status(prepared.record.executionId)).record.postCount).toBe(1);
  });
  it('requires a separate cancellation signature and observed orderbook cancellation', async () => {
    const { service, key, owner } = await fixture();
    const prepared = await service.prepare(workflow(), owner, 'hold');
    await service.signAndPost(prepared.record.executionId, orderSignature(prepared, key));
    await service.track(prepared.record.executionId);
    const cancellation = signCowDisposable(cowCancellationDigest(prepared.record.compiled.orderUid), key).signature;
    const requested = await service.cancel(prepared.record.executionId, cancellation);
    expect(requested.record.state).toBe('CANCEL_REQUESTED');
    expect((await service.track(prepared.record.executionId)).record.state).toBe('CANCELLED');
  });
  it('exposes expiry and unresolved posting failure without inventing a fill', async () => {
    const { service, key, owner } = await fixture();
    const expired = await service.prepare(workflow(), owner, 'expire');
    await service.signAndPost(expired.record.executionId, orderSignature(expired, key));
    expect((await service.track(expired.record.executionId)).record.state).toBe('EXPIRED');
    const failure = await service.prepare(workflow(), owner, 'failure');
    expect((await service.signAndPost(failure.record.executionId, orderSignature(failure, key))).record.state).toBe('POST_RESULT_UNKNOWN');
    expect((await service.track(failure.record.executionId)).record.state).toBe('POST_RESULT_UNKNOWN');
    expect((await service.status(failure.record.executionId)).record.postCount).toBe(1);
  });
  it('keeps a scripted fill inconclusive when settlement observations are absent', async () => {
    const { dir, key, owner } = await fixture();
    const transport: CowOrderbookTransport = {
      async post(order) { return { uid: order.uid }; },
      async lookup(uid) { return { uid, status: 'fulfilled', executedSellAmount: '1000000000000000000',
        executedBuyAmount: '990000000', observedAt: new Date().toISOString() }; },
      async cancel() { return { accepted: false }; },
    };
    const service = createCowService(dir, transport);
    const prepared = await service.prepare(workflow(), owner);
    await service.signAndPost(prepared.record.executionId, orderSignature(prepared, key));
    expect((await service.track(prepared.record.executionId)).record.state).toBe('RECONCILIATION_REQUIRED');
    const result = await service.reconcile(prepared.record.executionId);
    expect(result.record.state).toBe('INCONCLUSIVE');
    expect(result.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'INCONCLUSIVE', receipts: [] });
  });
  it('does not call a rejected cancellation complete when a late fill is observed', async () => {
    const { dir, key, owner } = await fixture();
    let lookups = 0;
    const transport: CowOrderbookTransport = {
      async post(order) { return { uid: order.uid }; },
      async lookup(uid) { lookups++; return { uid, status: lookups === 1 ? 'open' : 'fulfilled',
        executedSellAmount: lookups === 1 ? '0' : '1000000000000000000',
        executedBuyAmount: lookups === 1 ? '0' : '990000000', observedAt: new Date().toISOString() }; },
      async cancel() { return { accepted: false }; },
    };
    const service = createCowService(dir, transport);
    const prepared = await service.prepare(workflow(), owner);
    await service.signAndPost(prepared.record.executionId, orderSignature(prepared, key));
    await service.track(prepared.record.executionId);
    const cancellation = signCowDisposable(cowCancellationDigest(prepared.record.compiled.orderUid), key).signature;
    expect((await service.cancel(prepared.record.executionId, cancellation)).record.state).toBe('CANCEL_REQUESTED');
    expect((await service.track(prepared.record.executionId)).record.state).toBe('RECONCILIATION_REQUIRED');
  });
  it('refuses a wrong signer and CoW-unapproved workflow before posting', async () => {
    const { service, key, owner } = await fixture();
    const prepared = await service.prepare(workflow(), owner);
    const other = randomBytes(32);
    await expect(service.signAndPost(prepared.record.executionId, orderSignature(prepared, other))).rejects.toThrow('COW_SIGNER_MISMATCH');
    expect((await service.status(prepared.record.executionId)).record.state).toBe('REVIEWED');
    const legacy = workflow(); legacy.nodes[0]!.adapterConstraints.protocols = ['uniswap'];
    expect(discoverCow(legacy).available).toBe(false);
    await expect(service.prepare(legacy, owner)).rejects.toThrow('COW_CAPABILITY_UNAVAILABLE');
    expect(key).toHaveLength(32);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry, validateActionRegistry } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { COW_ADAPTER, compileCow, cowCancellationDigest, cowOrderDigest, cowOrderUid, verifyCowForPosting, type CowOrder, type CowQuote } from '../src/index.js';

const now = Date.parse('2026-09-27T00:00:30.000Z');
const usdc = baseAssetRegistry.USDC.asset;
const weth = baseAssetRegistry.WETH.asset;
const owner = '0x1234567890123456789012345678901234567890';
const workflow = (): SemanticWorkflow => ({
  schemaVersion: '1.0.0', workflowId: 'cow.test', revision: 1, resourceEdges: [],
  nodes: [{ nodeId: 'cow-swap', actionType: 'asset.swap.exact-input', actionSchemaVersion: '1.0.0',
    chainId: 'eip155:8453', requiredCapabilities: ['swap.direct-transaction'],
    adapterConstraints: { adapters: [], protocols: ['uniswap', 'cow-protocol'] },
    inputs: [{ name: 'amount-in', kind: 'QUANTITY', value: { asset: weth, amount: '1000000000000000000' } },
      { name: 'asset-out', kind: 'ASSET', value: usdc }],
    expectedOutputs: [{ outputId: 'amount-out', asset: usdc, minimumAmount: '0' }],
    dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: weth, amount: '1000000000000000000' } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: 100 }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [] }],
});
const quote = (): CowQuote => ({
  quoteId: 'local-test-1', sourceId: 'cow.loopback.orderbook', chainId: 'eip155:8453',
  sellToken: (weth as { address: string }).address, buyToken: (usdc as { address: string }).address,
  owner, receiver: owner, sellAmount: '1000000000000000000', buyAmount: '990000000',
  feeAmount: '0', validTo: 1790467800, observedAt: '2026-09-27T00:00:00.000Z',
  expiresAt: '2026-09-27T00:01:00.000Z', sourceBlock: 0,
  sourceHash: '0x' + '1'.repeat(64), rawHash: '0x' + '2'.repeat(64),
});
describe('CoW signed-intent compiler', () => {
  it('holds the additive EIP-712 digest, UID and cancellation compatibility vector', () => {
    const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/cow-signed-intent-vectors.json', import.meta.url), 'utf8')) as {
      owner: string; order: CowOrder; digest: string; uid: string; cancellationDigest: string };
    expect(cowOrderDigest(vector.order)).toBe(vector.digest);
    expect(cowOrderUid(vector.order, vector.owner)).toBe(vector.uid);
    expect(cowCancellationDigest(vector.uid)).toBe(vector.cancellationDigest);
  });
  it('extends the same swap action with a declared signed-intent execution kind', () => {
    expect(validateActionRegistry(referenceRegistry)).toBe(true);
    expect(referenceRegistry.actions[0]?.executionKinds).toContain('SIGNED_INTENT');
    expect(referenceRegistry.actions[0]?.id).toBe('asset.swap.exact-input');
  });
  it('links quote, simulation, policy, Manifest, signed order and plan', () => {
    const result = compileCow(workflow(), quote(), now);
    expect(result.manifest.providers).toEqual({ kind: 'FIXED', providerId: COW_ADAPTER.id });
    expect(result.plan.segments[0]?.steps[0]?.executionKind).toBe('SIGNED_INTENT');
    expect(result.orderUid).toBe(cowOrderDigest(result.order) + owner.slice(2) + result.order.validTo.toString(16).padStart(8, '0'));
    expect(result.orderUid).toMatch(/^0x[0-9a-f]{112}$/);
    expect(cowCancellationDigest(result.orderUid)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.typedData.message).toEqual(result.order);
    expect(() => verifyCowForPosting(result, quote(), now)).not.toThrow();
  });
  it('rejects stale, altered and non-preauthorized inputs', () => {
    expect(() => compileCow(workflow(), { ...quote(), receiver: '0x0000000000000000000000000000000000000001' }, now)).toThrow('COW_QUOTE_INVALID');
    expect(() => compileCow(workflow(), quote(), now + 61_000)).toThrow('COW_QUOTE_INVALID');
    const changed = workflow();
    changed.nodes[0]!.adapterConstraints.protocols = ['uniswap'];
    expect(() => compileCow(changed, quote(), now)).toThrow('COW_PROVIDER_NOT_PREAUTHORIZED');
    const result = compileCow(workflow(), quote(), now);
    const tampered = { ...result, order: { ...result.order, buyAmount: '1' } };
    expect(() => verifyCowForPosting(tampered, quote(), now)).toThrow('COW_MANIFEST_ORDER_MISMATCH');
    expect(() => verifyCowForPosting(result, quote(), now + 61_000)).toThrow('COW_QUOTE_EXPIRED');
  });
});

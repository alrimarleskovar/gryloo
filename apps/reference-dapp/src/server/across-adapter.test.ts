// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { fixtureAcrossQuote, normalizeAcrossQuote, normalizeAcrossStatus, requestAcrossQuote, BASE_SPOKE_POOL } from './across-adapter';
const OWNER = '0x1111111111111111111111111111111111111111';
const NOW = 1_780_000_000_000;
function raw() {
  const amount = '1000000', output = '999000';
  return { id: 'direct-1', crossSwapType: 'bridgeableToBridgeable', amountType: 'exactInput',
    inputAmount: amount, expectedOutputAmount: output, minOutputAmount: output, expectedFillTime: 20,
    quoteExpiryTimestamp: Math.floor(NOW / 1000) + 300,
    checks: { allowance: { token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', spender: BASE_SPOKE_POOL, actual: '0', expected: amount } },
    steps: { bridge: { inputAmount: amount, outputAmount: output,
      tokenIn: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chainId: 8453, decimals: 6 },
      tokenOut: { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, decimals: 6 }, provider: 'across' } },
    inputToken: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chainId: 8453, decimals: 6 },
    outputToken: { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', chainId: 42161, decimals: 6 },
    refundToken: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chainId: 8453, decimals: 6 },
    fees: { totalMax: { amount: '1000', token: { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', chainId: 8453, decimals: 6 } } },
    approvalTxns: [{ chainId: 8453, to: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      data: '0x095ea7b3' + BASE_SPOKE_POOL.slice(2).padStart(64, '0') + BigInt(amount).toString(16).padStart(64, '0') }],
    swapTx: { chainId: 8453, to: BASE_SPOKE_POOL, data: '0x110560ad' + '00'.repeat(32),
      gas: '250000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000', simulationSuccess: true } };
}
describe('direct Across Swap API normalization', () => {
  it('normalizes exact Base to Arbitrum route with conditional exact approval and quote expiry', () => {
    const quote = normalizeAcrossQuote(raw(), OWNER, '1000000', NOW, 'LIVE_READ_ONLY');
    expect(quote.provider).toBe('across.direct');
    expect(quote.approvals).toHaveLength(1);
    expect(quote.deposit.to).toBe(BASE_SPOKE_POOL);
    expect(quote.refundAddress).toBe(OWNER);
    expect(quote.quoteExpiresAt).toBe(new Date(NOW + 300_000).toISOString());
    expect(quote.feeMaximum).toBe('1000');
    expect(quote.maximumGasCostWei).toBe('250000000000000');
    expect(fixtureAcrossQuote(OWNER, '1000000', NOW).provenance).toBe('DETERMINISTIC_FIXTURE');
  });
  it('rejects wrong provider shape, swapped target, unlimited approval and stale quote', () => {
    const a = raw(); a.crossSwapType = 'anyToAny';
    expect(() => normalizeAcrossQuote(a, OWNER, '1000000', NOW, 'LIVE_READ_ONLY')).toThrow();
    const b = raw(); b.swapTx.to = OWNER;
    expect(() => normalizeAcrossQuote(b, OWNER, '1000000', NOW, 'LIVE_READ_ONLY')).toThrow();
    const c = raw(); c.approvalTxns[0]!.data = c.approvalTxns[0]!.data.slice(0, 74) + 'f'.repeat(64);
    expect(() => normalizeAcrossQuote(c, OWNER, '1000000', NOW, 'LIVE_READ_ONLY')).toThrow();
    const wrongProvider = raw(); wrongProvider.steps.bridge.provider = 'other';
    expect(() => normalizeAcrossQuote(wrongProvider, OWNER, '1000000', NOW, 'LIVE_READ_ONLY')).toThrow();
    const d = raw(); d.quoteExpiryTimestamp = Math.floor(NOW / 1000) - 1;
    expect(() => normalizeAcrossQuote(d, OWNER, '1000000', NOW, 'LIVE_READ_ONLY')).toThrow();
  });
  it('sends the reviewed slippage with server-only credentials for read-only quotes', async () => {
    const oldKey = process.env.ACROSS_API_KEY, oldIntegrator = process.env.ACROSS_INTEGRATOR_ID;
    const oldFetch = globalThis.fetch;
    process.env.ACROSS_API_KEY = 'test-only-key'; process.env.ACROSS_INTEGRATOR_ID = '0xdead';
    const call = vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('slippage')).toBe('0.005');
      expect(parsed.searchParams.get('refundOnOrigin')).toBe('true');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-only-key' });
      return new Response(JSON.stringify(raw()), { status: 200 });
    });
    globalThis.fetch = call as typeof fetch;
    try { expect((await requestAcrossQuote(OWNER, '1000000', 50, NOW)).provider).toBe('across.direct');
      expect(call).toHaveBeenCalledTimes(1); }
    finally { globalThis.fetch = oldFetch;
      if (oldKey === undefined) delete process.env.ACROSS_API_KEY; else process.env.ACROSS_API_KEY = oldKey;
      if (oldIntegrator === undefined) delete process.env.ACROSS_INTEGRATOR_ID; else process.env.ACROSS_INTEGRATOR_ID = oldIntegrator; }
  });
  it('normalizes distinct pending, filled, expired and refunded statuses', () => {
    const hash = '0x' + '1'.repeat(64);
    for (const status of ['received', 'pending', 'filled', 'expired', 'refunded']) {
      expect(normalizeAcrossStatus({ status }, hash).status).toBe(status);
    expect(normalizeAcrossStatus({ status: 'filled', depositTxnRef: hash, originChainId: 8453, destinationChainId: 42161,
      fillTxnRef: '0x' + '2'.repeat(64) }, hash).fillTxHash).toBe('0x' + '2'.repeat(64));
    }
  });
});

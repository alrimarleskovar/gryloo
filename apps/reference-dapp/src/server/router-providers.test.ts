// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeCommitment } from '@defi-workflow-engine/workflow-contracts';
import { decodeLifiAcrossV4, encodeLifiAcrossV4 } from '@defi-workflow-engine/reference-compiler';
import { acrossQuoteUrl, createRouteProviders, lifiQuoteUrl, normalizeAcrossRoute, normalizeAcrossStatus, normalizeLifiRoute, normalizeLifiStatus,
  type RouteRequest } from './router-providers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./testdata/router/${name}`, import.meta.url), 'utf8'));
const OWNER = '0x1111111111111111111111111111111111111111';
const request: RouteRequest = { owner: OWNER, recipient: OWNER, amount: '10000000', slippageBps: 50, nowMs: 1_791_129_300_000, depositQuoteTimeBuffer: 3600 };

describe('BUILD-ROUTER-001 LI.FI adapter (recorded real response)', () => {
  it('normalizes the real LI.FI → Across quote into the canonical route, from the decoded calldata', () => {
    const route = normalizeLifiRoute(fixture('lifi-quote-across-2026-10-04.json'), request);
    expect(route).toMatchObject({ routingProvider: 'lifi', underlyingProtocol: 'across', inputAmount: '10000000', expectedOutput: '9966227', minimumOutput: '9966227',
      feeTotal: '33773', recipient: OWNER, refundAddress: OWNER, approval: { spender: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', amount: '10000000' } });
    expect(route.steps.map(s => `${s.kind}:${s.protocol}:${s.amountIn}->${s.amountOut}`)).toEqual(['FEE_COLLECTION:lifi-fee:10000000->9975000', 'BRIDGE:across:9975000->9966227']);
    expect(route.fees.find(f => f.kind === 'INTEGRATOR')).toEqual({ kind: 'INTEGRATOR', label: 'LI.FI fee', chainId: 'eip155:8453', token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      amount: '25000', recipient: '0xc06ebbefd94032b85424d51906e2a335efae264b' });
    expect(route.bridge).toMatchObject({ inputAmount: '9975000', outputAmount: '9966227', depositor: OWNER, destinationChainId: 42161 });
    // Expiry is derived from the deposit, five minutes before the SpokePool quote-time limit.
    expect(route.quote.expiresAt).toBe(new Date((route.bridge.quoteTimestamp + 3600 - 300) * 1000).toISOString());
    expect(routeCommitment(route)).toBe(routeCommitment(normalizeLifiRoute(fixture('lifi-quote-across-2026-10-04.json'), request)));
  });
  it('refuses the unrestricted LI.FI route through a bridge Flofi cannot reconcile (polymerStandard)', () => {
    expect(() => normalizeLifiRoute(fixture('lifi-quote-unrestricted-2026-10-04.json'), request)).toThrow('LIFI_UNDERLYING_PROTOCOL_NOT_RECONCILABLE');
  });
  it('refuses API/calldata disagreement: recipient, refund address, fee recipient, amount, spender, value, chain, expiry', () => {
    const q = fixture('lifi-quote-across-2026-10-04.json');
    const other = '0x2222222222222222222222222222222222222222';
    expect(() => normalizeLifiRoute(q, { ...request, recipient: other })).toThrow('LIFI_ROUTE_UNSUPPORTED');
    expect(() => normalizeLifiRoute({ ...q, action: { ...q.action, toAddress: other } }, { ...request, recipient: other })).toThrow('LIFI_CALLDATA_MISMATCH');
    const call = decodeLifiAcrossV4(q.transactionRequest.data.toLowerCase());
    const withRefund = encodeLifiAcrossV4({ ...call, across: { ...call.across, refundAddress: other } });
    expect(() => normalizeLifiRoute({ ...q, transactionRequest: { ...q.transactionRequest, data: withRefund } }, request)).toThrow('LIFI_CALLDATA_MISMATCH');
    const higherOutput = encodeLifiAcrossV4({ ...call, across: { ...call.across, outputAmount: call.across.outputAmount + 1n } });
    expect(() => normalizeLifiRoute({ ...q, transactionRequest: { ...q.transactionRequest, data: higherOutput } }, request)).toThrow('LIFI_CALLDATA_MISMATCH');
    expect(() => normalizeLifiRoute(q, { ...request, amount: '10000001' })).toThrow('LIFI_ROUTE_UNSUPPORTED');
    expect(() => normalizeLifiRoute({ ...q, estimate: { ...q.estimate, approvalAddress: other } }, request)).toThrow('LIFI_SPENDER_UNEXPECTED');
    expect(() => normalizeLifiRoute({ ...q, transactionRequest: { ...q.transactionRequest, value: '0x1' } }, request)).toThrow('LIFI_TRANSACTION_UNSUPPORTED');
    expect(() => normalizeLifiRoute({ ...q, transactionRequest: { ...q.transactionRequest, chainId: 42161 } }, request)).toThrow('LIFI_TRANSACTION_UNSUPPORTED');
    expect(() => normalizeLifiRoute({ ...q, estimate: { ...q.estimate, toAmountMin: '9966228' } }, request)).toThrow('LIFI_OUTPUT_MISMATCH');
    expect(() => normalizeLifiRoute({ ...q, estimate: { ...q.estimate, feeCosts: q.estimate.feeCosts.slice(1) } }, request)).toThrow('LIFI_FEES_INCONSISTENT');
    expect(() => normalizeLifiRoute(q, { ...request, nowMs: (call.across.quoteTimestamp + 3600) * 1000 })).toThrow('LIFI_QUOTE_EXPIRED');
  });
  it('asks LI.FI only for reconcilable bridges and normalizes status as a hint', () => {
    expect(new URL(lifiQuoteUrl(request)).searchParams.get('allowBridges')).toBe('across');
    expect(new URL(lifiQuoteUrl(request)).searchParams.get('allowDestinationCall')).toBe('false');
    const src = '0x' + 'aa'.repeat(32), dst = '0x' + 'bb'.repeat(32);
    expect(normalizeLifiStatus({ status: 'DONE', substatus: 'COMPLETED', sending: { txHash: src }, receiving: { txHash: dst, chainId: 42161 } }, src))
      .toMatchObject({ status: 'FILLED', destinationTxHash: dst });
    expect(normalizeLifiStatus({ status: 'NOT_FOUND' }, src).status).toBe('NOT_FOUND');
    expect(() => normalizeLifiStatus({ status: 'DONE', sending: { txHash: dst } }, src)).toThrow('LIFI_STATUS_MISMATCH');
  });
});

describe('BUILD-ROUTER-001 Across adapter (recorded real response)', () => {
  it('normalizes the real direct Across quote and never uses its unlimited approval', () => {
    const raw = fixture('across-swap-approval-2026-10-04.json');
    expect(raw.approvalTxns[0].data.endsWith('f'.repeat(64))).toBe(true);
    const route = normalizeAcrossRoute(raw, request);
    expect(route).toMatchObject({ routingProvider: 'across', underlyingProtocol: 'across', expectedOutput: '9991223', minimumOutput: '9991223', feeTotal: '8777',
      approval: { spender: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64', amount: '10000000' } });
    expect(route.fees.map(f => [f.kind, f.amount])).toEqual([['BRIDGE_RELAYER_CAPITAL', '1000'], ['BRIDGE_DESTINATION_GAS', '7777']]);
    expect(route.quote.expiresAt).toBe(new Date(Math.min(raw.quoteExpiryTimestamp, route.bridge.quoteTimestamp + 3300) * 1000).toISOString());
    expect(new URL(acrossQuoteUrl(request)).searchParams.get('refundOnOrigin')).toBe('true');
  });
  it('refuses swaps, foreign targets, recipient/output disagreement and inconsistent fees', () => {
    const raw = fixture('across-swap-approval-2026-10-04.json');
    expect(() => normalizeAcrossRoute({ ...raw, steps: { ...raw.steps, originSwap: {} } }, request)).toThrow('ACROSS_ROUTE_UNSUPPORTED');
    expect(() => normalizeAcrossRoute({ ...raw, swapTx: { ...raw.swapTx, to: '0x2222222222222222222222222222222222222222' } }, request)).toThrow('ACROSS_TRANSACTION_UNSUPPORTED');
    expect(() => normalizeAcrossRoute(raw, { ...request, recipient: '0x2222222222222222222222222222222222222222' })).toThrow('ACROSS_CALLDATA_MISMATCH');
    expect(() => normalizeAcrossRoute({ ...raw, minOutputAmount: '9991224' }, request)).toThrow('ACROSS_OUTPUT_MISMATCH');
    expect(() => normalizeAcrossRoute({ ...raw, steps: { ...raw.steps, bridge: { ...raw.steps.bridge, fees: { ...raw.steps.bridge.fees, amount: '1' } } } }, request))
      .toThrow('ACROSS_FEES_INCONSISTENT');
    expect(normalizeAcrossStatus({ status: 'filled', depositTxnRef: '0x' + 'aa'.repeat(32), fillTxnRef: '0x' + 'cc'.repeat(32) }, '0x' + 'aa'.repeat(32)))
      .toMatchObject({ status: 'FILLED', destinationTxHash: '0x' + 'cc'.repeat(32) });
    expect(normalizeAcrossStatus({ status: 'expired' }, '0x' + 'aa'.repeat(32)).status).toBe('EXPIRED');
  });
  it('sends optional credentials only as server-side headers, and validates configuration', async () => {
    const seen: { url: string; headers: Readonly<Record<string, string>> | undefined }[] = [];
    const providers = createRouteProviders({ http: async (url, headers) => { seen.push({ url, headers }); return fixture('across-swap-approval-2026-10-04.json'); },
      acrossApiKey: 'test-key-not-secret', acrossIntegratorId: '0x0abc' });
    await providers.across.quote(request);
    expect(seen[0]!.headers).toEqual({ Authorization: 'Bearer test-key-not-secret' });
    expect(new URL(seen[0]!.url).searchParams.get('integratorId')).toBe('0x0abc');
    expect(() => createRouteProviders({ http: async () => ({}), acrossIntegratorId: 'abc' })).toThrow('ROUTER_CONFIGURATION_INVALID');
  });
});

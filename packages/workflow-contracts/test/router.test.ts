// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { assertRouterTransition, canonicalizeRoute, compareRoutes, createRouterBridgeNode, isRouterBridgeNode, readRouterBridgeNode, routeCommitment,
  ROUTER_PHASE_TRANSITIONS, type CanonicalRoute, type RouterBridgeFields } from '../src/router.js';
import { validateArtifact } from '../src/schemas.js';

const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', ARB_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const OWNER = '0x1111111111111111111111111111111111111111', OTHER = '0x2222222222222222222222222222222222222222';
const DIAMOND = '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', SPOKE = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64';
const fields: RouterBridgeFields = { sourceChain: 'eip155:8453', destinationChain: 'eip155:42161', inputToken: BASE_USDC, outputToken: ARB_USDC,
  amount: '10000000', recipient: 'CONNECTED_OWNER', slippageBps: 50, providers: ['lifi', 'across'] };
/** Shape of the real LI.FI → Across route observed read-only on 2026-10-04 (10 USDC, 0.25% LI.FI fee + Across relayer fees). */
function route(): CanonicalRoute {
  return { format: 'flofi.route.v1', sourceChain: 'eip155:8453', destinationChain: 'eip155:42161',
    inputToken: { chainId: 'eip155:8453', address: BASE_USDC, decimals: 6, symbol: 'USDC' }, outputToken: { chainId: 'eip155:42161', address: ARB_USDC, decimals: 6, symbol: 'USDC' },
    inputAmount: '10000000', expectedOutput: '9966227', minimumOutput: '9966227', recipient: OWNER, depositor: OWNER, refundAddress: OWNER,
    routingProvider: 'lifi', underlyingProtocol: 'across',
    steps: [{ kind: 'FEE_COLLECTION', protocol: 'lifi-fee', fromChain: 'eip155:8453', toChain: 'eip155:8453', fromToken: BASE_USDC, toToken: BASE_USDC, amountIn: '10000000', amountOut: '9975000' },
      { kind: 'BRIDGE', protocol: 'across', fromChain: 'eip155:8453', toChain: 'eip155:42161', fromToken: BASE_USDC, toToken: ARB_USDC, amountIn: '9975000', amountOut: '9966227' }],
    fees: [{ kind: 'INTEGRATOR', label: 'LIFI Fixed Fee', chainId: 'eip155:8453', token: BASE_USDC, amount: '25000', recipient: '0xc06ebbefd94032b85424d51906e2a335efae264b' },
      { kind: 'BRIDGE_RELAYER_CAPITAL', label: 'Relayer fee', chainId: 'eip155:8453', token: BASE_USDC, amount: '997', recipient: null },
      { kind: 'BRIDGE_DESTINATION_GAS', label: 'Relayer gas fee', chainId: 'eip155:8453', token: BASE_USDC, amount: '7776', recipient: null }],
    feeTotal: '33773', slippageBps: 50, approval: { token: BASE_USDC, spender: DIAMOND, amount: '10000000' },
    deposit: { purpose: 'BRIDGE_DEPOSIT', chainId: 'eip155:8453', to: DIAMOND, data: '0x1794958f' + '00'.repeat(64), value: '0x0' },
    bridge: { protocol: 'across', originSpokePool: SPOKE, destinationSpokePool: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a', depositor: OWNER, recipient: OWNER,
      inputToken: BASE_USDC, outputToken: ARB_USDC, inputAmount: '9975000', outputAmount: '9966227', destinationChainId: 42161,
      exclusiveRelayer: '0x0000000000000000000000000000000000000000', quoteTimestamp: 1791129275, fillDeadline: 1791138430, exclusivityParameter: 0, message: '0x' },
    quote: { id: 'c846f3b7-b6db-4234-bffb-d71057801e13:0', rawHash: '0x' + 'ab'.repeat(32), quotedAt: '2026-10-04T16:57:00.000Z', expiresAt: '2026-10-04T17:52:00.000Z',
      estimatedDurationSeconds: 2, providerGasEstimate: '1248222000000' } };
}
const mutate = (patch: (r: CanonicalRoute) => object) => { const r = route(); return { ...r, ...patch(r) } as CanonicalRoute; };

describe('BUILD-ROUTER-001 canonical router node', () => {
  it('authors one closed asset.bridge declaration with recipient and provider preference', () => {
    const node = createRouterBridgeNode('node-002', fields);
    expect(isRouterBridgeNode(node)).toBe(true);
    expect(node.adapterConstraints).toEqual({ adapters: [{ id: 'flofi.router', version: '1.0.0' }], protocols: ['lifi', 'across'] });
    expect(readRouterBridgeNode(node)).toEqual(fields);
    const explicit = createRouterBridgeNode('node-002', { ...fields, recipient: OTHER, providers: ['across'] });
    expect(explicit.inputs.find(p => p.name === 'recipient')).toEqual({ name: 'recipient', kind: 'ACCOUNT', value: { chainId: 'eip155:42161', address: OTHER } });
    expect(readRouterBridgeNode(explicit).recipient).toBe(OTHER);
    for (const n of [node, explicit])
      expect(() => validateArtifact('semantic-workflow', { schemaVersion: '1.0.0', workflowId: 'w', revision: 1, nodes: [n], resourceEdges: [] })).not.toThrow();
  });
  it('rejects unsupported pairs, amounts, slippage, recipients, provider policies and altered declarations', () => {
    expect(() => createRouterBridgeNode('n', { ...fields, destinationChain: 'eip155:10' })).toThrow('ROUTER_PAIR_UNSUPPORTED');
    expect(() => createRouterBridgeNode('n', { ...fields, amount: '100000001' })).toThrow('ROUTER_AMOUNT_OUT_OF_RANGE');
    expect(() => createRouterBridgeNode('n', { ...fields, amount: '99999' })).toThrow('ROUTER_AMOUNT_OUT_OF_RANGE');
    expect(() => createRouterBridgeNode('n', { ...fields, slippageBps: 301 })).toThrow('ROUTER_SLIPPAGE_OUT_OF_RANGE');
    expect(() => createRouterBridgeNode('n', { ...fields, recipient: '0x' + '0'.repeat(40) })).toThrow('ROUTER_RECIPIENT_INVALID');
    expect(() => createRouterBridgeNode('n', { ...fields, recipient: '0x' + 'A'.repeat(40) })).toThrow('ROUTER_RECIPIENT_INVALID');
    for (const providers of [[], ['lifi', 'lifi'], ['stargate'], ['lifi', 'across', 'relay']])
      expect(() => createRouterBridgeNode('n', { ...fields, providers: providers as never })).toThrow('ROUTER_PROVIDER_POLICY_INVALID');
    const node = createRouterBridgeNode('n', fields);
    expect(() => readRouterBridgeNode({ ...node, failurePolicy: 'RETRY' })).toThrow('ROUTER_DECLARATION_INVALID');
    expect(() => readRouterBridgeNode({ ...node, inputs: node.inputs.map(p => p.name === 'recipient' ? { name: 'recipient', kind: 'ACCOUNT', value: { chainId: 'eip155:8453', address: OTHER } } : p) }))
      .toThrow('ROUTER_RECIPIENT_INVALID');
    const otherChain = { ...node, expectedOutputs: [{ ...node.expectedOutputs[0]!, asset: { chainId: 'eip155:1', address: ARB_USDC, decimals: 6 } }] };
    expect(() => validateArtifact('semantic-workflow', { schemaVersion: '1.0.0', workflowId: 'w', revision: 1, nodes: [otherChain], resourceEdges: [] })).toThrow();
  });
});

describe('BUILD-ROUTER-001 canonical route and commitment', () => {
  it('canonicalization is deterministic: key order, fee order and object identity cannot change the commitment', () => {
    const a = route(), b = route();
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as unknown as CanonicalRoute;
    const feesReversed = { ...b, fees: [...b.fees].reverse() };
    expect(routeCommitment(a)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(routeCommitment(reordered)).toBe(routeCommitment(a));
    expect(routeCommitment(feesReversed)).toBe(routeCommitment(a));
    expect(canonicalizeRoute(feesReversed)).toEqual(canonicalizeRoute(a));
  });
  it('every authorization-relevant field changes the commitment', () => {
    const base = routeCommitment(route());
    const mutations: ((r: CanonicalRoute) => object)[] = [
      () => ({ recipient: OTHER, bridge: { ...route().bridge, recipient: OTHER } }),
      r => ({ inputAmount: '10000001', approval: { ...r.approval, amount: '10000001' }, expectedOutput: '9966228', feeTotal: r.feeTotal }),
      r => ({ minimumOutput: '9966226', bridge: { ...r.bridge, outputAmount: '9966226' } }),
      r => ({ routingProvider: 'across' as const, fees: r.fees }),
      r => ({ steps: [r.steps[1]!] }),
      r => ({ fees: r.fees.map(f => f.kind === 'INTEGRATOR' ? { ...f, recipient: OTHER } : f) }),
      () => ({ slippageBps: 51 }),
      r => ({ approval: { ...r.approval, spender: SPOKE }, deposit: { ...r.deposit, to: SPOKE } }),
      r => ({ deposit: { ...r.deposit, data: r.deposit.data.slice(0, -2) + '01' } }),
      r => ({ bridge: { ...r.bridge, fillDeadline: r.bridge.fillDeadline + 1 } }),
      r => ({ quote: { ...r.quote, expiresAt: '2026-10-04T17:52:01.000Z' } }),
    ];
    const seen = new Set([base]);
    for (const patch of mutations) { const c = routeCommitment(mutate(patch)); expect(seen.has(c)).toBe(false); seen.add(c); }
  });
  it('rejects inconsistent or unreconcilable routes', () => {
    expect(() => canonicalizeRoute(mutate(() => ({ underlyingProtocol: 'stargate' })))).toThrow('ROUTE_PROTOCOL_NOT_RECONCILABLE');
    expect(() => canonicalizeRoute(mutate(() => ({ feeTotal: '33772' })))).toThrow('ROUTE_FEES_INCONSISTENT');
    expect(() => canonicalizeRoute(mutate(r => ({ deposit: { ...r.deposit, value: '0x1' } })))).toThrow('ROUTE_TRANSACTION_INVALID');
    expect(() => canonicalizeRoute(mutate(r => ({ approval: { ...r.approval, amount: '1' } })))).toThrow('ROUTE_APPROVAL_INVALID');
    expect(() => canonicalizeRoute(mutate(r => ({ bridge: { ...r.bridge, recipient: OTHER } })))).toThrow('ROUTE_BRIDGE_INVALID');
    expect(() => canonicalizeRoute(mutate(r => ({ bridge: { ...r.bridge, message: '0x01' } })))).toThrow('ROUTE_BRIDGE_INVALID');
    expect(() => canonicalizeRoute(mutate(r => ({ steps: [r.steps[1]!, r.steps[0]!] })))).toThrow('ROUTE_STEPS_INVALID');
    expect(() => canonicalizeRoute(mutate(() => ({ destinationChain: 'eip155:10' })))).toThrow('ROUTE_PAIR_UNSUPPORTED');
  });
});

describe('BUILD-ROUTER-001 route comparison (ROUTE_CHANGED detection)', () => {
  it('an equivalent requote (new quote id, deadline, calldata, cheaper fee) is not a material change, but is under EXACT', () => {
    const requote = mutate(r => ({ quote: { ...r.quote, id: 'next', rawHash: '0x' + 'cd'.repeat(32) }, deposit: { ...r.deposit, data: r.deposit.data.slice(0, -2) + 'ff' },
      bridge: { ...r.bridge, quoteTimestamp: r.bridge.quoteTimestamp + 60, fillDeadline: r.bridge.fillDeadline + 60 } }));
    expect(compareRoutes(route(), requote, 'REQUOTE')).toEqual([]);
    expect(compareRoutes(route(), requote, 'EXACT')).toEqual(['CALLDATA_CHANGED', 'DEADLINE_CHANGED', 'QUOTE_CHANGED']);
  });
  it('reports every material mutation', () => {
    const r = route();
    expect(compareRoutes(r, mutate(x => ({ recipient: OTHER, bridge: { ...x.bridge, recipient: OTHER } })), 'REQUOTE')).toEqual(['RECIPIENT_CHANGED']);
    expect(compareRoutes(r, mutate(x => ({ inputAmount: '10000001', expectedOutput: '9966228', approval: { ...x.approval, amount: '10000001' } })), 'REQUOTE'))
      .toEqual(['AMOUNT_CHANGED', 'APPROVAL_CHANGED']);
    const pricier = mutate(x => ({ fees: x.fees.map(f => f.kind === 'BRIDGE_DESTINATION_GAS' ? { ...f, amount: '8776' } : f), feeTotal: '34773', expectedOutput: '9965227',
      minimumOutput: '9965227', bridge: { ...x.bridge, outputAmount: '9965227' } }));
    expect(compareRoutes(r, pricier, 'REQUOTE')).toEqual(['FEES_OUT_OF_BOUNDS', 'MINIMUM_OUTPUT_DECREASED']);
    expect(compareRoutes(r, mutate(() => ({ routingProvider: 'across' as const })), 'REQUOTE')).toEqual(['PROVIDER_CHANGED']);
    expect(compareRoutes(r, mutate(x => ({ steps: [x.steps[0]!, { ...x.steps[1]!, toToken: x.steps[1]!.toToken }], fees: x.fees.map(f => f.kind === 'INTEGRATOR' ? { ...f, recipient: OTHER } : f) })), 'REQUOTE'))
      .toEqual(['FEE_RECIPIENT_CHANGED']);
    expect(compareRoutes(r, mutate(x => ({ steps: [{ ...x.steps[0]!, protocol: 'other-fee' }, x.steps[1]!] })), 'REQUOTE')).toEqual(['STEPS_CHANGED']);
    expect(compareRoutes(r, mutate(x => ({ approval: { ...x.approval, spender: SPOKE }, deposit: { ...x.deposit, to: SPOKE } })), 'REQUOTE'))
      .toEqual(['APPROVAL_CHANGED', 'TRANSACTION_TARGET_CHANGED']);
    expect(compareRoutes(r, mutate(x => ({ deposit: { ...x.deposit, data: '0xad5425c6' + x.deposit.data.slice(10) } })), 'REQUOTE')).toEqual(['TRANSACTION_FUNCTION_CHANGED']);
  });
});

describe('BUILD-ROUTER-001 cross-chain phases', () => {
  it('success requires an observed destination; terminal phases never move', () => {
    expect(() => assertRouterTransition('SOURCE_CONFIRMED', 'RECONCILED')).toThrow('ROUTER_PHASE_TRANSITION_INVALID');
    expect(() => assertRouterTransition('IN_FLIGHT', 'RECONCILED')).toThrow('ROUTER_PHASE_TRANSITION_INVALID');
    expect(() => assertRouterTransition('PREPARED', 'SOURCE_SUBMITTED')).toThrow('ROUTER_PHASE_TRANSITION_INVALID');
    expect(() => assertRouterTransition('SOURCE_CONFIRMED', 'PREPARED')).toThrow('ROUTER_PHASE_TRANSITION_INVALID');
    expect(() => assertRouterTransition('DESTINATION_OBSERVED', 'RECONCILED')).not.toThrow();
    for (const terminal of ['RECONCILED', 'REFUNDED', 'FAILED', 'RECONCILIATION_REQUIRED'] as const)
      expect(ROUTER_PHASE_TRANSITIONS[terminal]).toEqual([terminal]);
  });
});

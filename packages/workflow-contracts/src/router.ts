// SPDX-License-Identifier: Apache-2.0
/**
 * BUILD-ROUTER-001: the provider-neutral Cross-chain Router contract.
 *
 * Intent lives in the canonical `asset.bridge` node (adapter `flofi.router`): chains, tokens, amount, recipient,
 * slippage and the allowed routing providers in preference order. A route is never intent: it is a provider answer
 * normalized into the canonical route model below, and its commitment (domain-separated SHA-256 of canonical JSON)
 * is what the Review, the Manifest and the owner's authorization bind.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { BRIDGE_ACTION } from './bridge.js';
import type { SemanticWorkflow } from './semantic-workflow.js';

export { ROUTER_ADAPTER, ROUTER_CAPABILITY, ROUTING_PROVIDERS, RECONCILABLE_PROTOCOLS, ROUTER_PAIRS, ROUTER_MAXIMUM_SLIPPAGE_BPS, routerPair } from './router-pairs.js';
export type { RoutingProvider, UnderlyingProtocol, RouterToken, RouterPair } from './router-pairs.js';
import { ROUTER_ADAPTER, ROUTER_CAPABILITY, ROUTING_PROVIDERS, RECONCILABLE_PROTOCOLS, ROUTER_MAXIMUM_SLIPPAGE_BPS, routerPair, type RoutingProvider, type UnderlyingProtocol, type RouterToken } from './router-pairs.js';

const ADDRESS = /^0x[0-9a-f]{40}$/, UNITS = /^(0|[1-9][0-9]{0,77})$/, HASH = /^0x[0-9a-f]{64}$/, HEX = /^0x(?:[0-9a-f]{2})*$/;
const ZERO = '0x0000000000000000000000000000000000000000';
const fail = (code: string): never => { throw new Error(code); };

// ---------------------------------------------------------------------------------------------------------------
// Canonical IR node
// ---------------------------------------------------------------------------------------------------------------

/** `CONNECTED_OWNER` binds the executing owner at Review; an address is an explicit destination-chain recipient. */
export type RouterRecipient = 'CONNECTED_OWNER' | string;
export type RouterBridgeFields = {
  readonly sourceChain: string; readonly destinationChain: string; readonly inputToken: string; readonly outputToken: string;
  readonly amount: string; readonly recipient: RouterRecipient; readonly slippageBps: number; readonly providers: readonly RoutingProvider[];
};
type Node = SemanticWorkflow['nodes'][number];

export function validateRouterProviders(providers: readonly string[]): readonly RoutingProvider[] {
  if (!Array.isArray(providers) || providers.length < 1 || providers.length > ROUTING_PROVIDERS.length ||
      new Set(providers).size !== providers.length || providers.some(p => !(ROUTING_PROVIDERS as readonly string[]).includes(p)))
    fail('ROUTER_PROVIDER_POLICY_INVALID');
  return providers as readonly RoutingProvider[];
}
export function createRouterBridgeNode(nodeId: string, fields: RouterBridgeFields): Node {
  const pair = routerPair(fields.sourceChain, fields.inputToken, fields.destinationChain, fields.outputToken);
  if (!pair) fail('ROUTER_PAIR_UNSUPPORTED');
  if (!UNITS.test(fields.amount) || BigInt(fields.amount) < BigInt(pair!.minimumAmount) || BigInt(fields.amount) > BigInt(pair!.maximumAmount))
    fail('ROUTER_AMOUNT_OUT_OF_RANGE');
  if (!Number.isSafeInteger(fields.slippageBps) || fields.slippageBps < 1 || fields.slippageBps > ROUTER_MAXIMUM_SLIPPAGE_BPS) fail('ROUTER_SLIPPAGE_OUT_OF_RANGE');
  if (fields.recipient !== 'CONNECTED_OWNER' && (!ADDRESS.test(fields.recipient) || fields.recipient === ZERO)) fail('ROUTER_RECIPIENT_INVALID');
  const providers = validateRouterProviders(fields.providers);
  const source = { chainId: pair!.source.chainId, address: pair!.source.address, decimals: pair!.source.decimals };
  const destination = { chainId: pair!.destination.chainId, address: pair!.destination.address, decimals: pair!.destination.decimals };
  const quantity = { asset: source, amount: fields.amount };
  const recipient = fields.recipient === 'CONNECTED_OWNER'
    ? { name: 'recipient', kind: 'IDENTIFIER' as const, value: 'CONNECTED_OWNER' }
    : { name: 'recipient', kind: 'ACCOUNT' as const, value: { chainId: destination.chainId, address: fields.recipient } };
  return { nodeId, actionType: BRIDGE_ACTION, actionSchemaVersion: '1.0.0', chainId: source.chainId, requiredCapabilities: [ROUTER_CAPABILITY],
    adapterConstraints: { adapters: [{ ...ROUTER_ADAPTER }], protocols: [...providers] },
    inputs: [{ name: 'amount-in', kind: 'QUANTITY', value: quantity }, { name: 'asset-out', kind: 'ASSET', value: destination }, recipient],
    expectedOutputs: [{ outputId: 'amount-out', asset: destination, minimumAmount: '0' }], dependencies: [],
    userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity }, { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: fields.slippageBps }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [],
    editableBounds: [{ parameterName: 'amount-in', asset: source, minimumAmount: pair!.minimumAmount, maximumAmount: pair!.maximumAmount }] };
}
export const isRouterBridgeNode = (node: { readonly actionType: string; readonly adapterConstraints: { readonly adapters: readonly { readonly id: string }[] } }) =>
  node.actionType === BRIDGE_ACTION && node.adapterConstraints.adapters.length === 1 && node.adapterConstraints.adapters[0]!.id === ROUTER_ADAPTER.id;
/** Closed declaration: the node must be exactly the canonical construction of its own fields. */
export function readRouterBridgeNode(node: Node): RouterBridgeFields {
  if (!isRouterBridgeNode(node)) fail('ROUTER_NODE_INVALID');
  const amount = node.inputs.find(p => p.name === 'amount-in'), out = node.inputs.find(p => p.name === 'asset-out');
  const recipient = node.inputs.find(p => p.name === 'recipient'), slip = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || !('address' in amount.value.asset) || !('address' in out.value) ||
      slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS' || !recipient) return fail('ROUTER_NODE_INVALID');
  let recipientValue: RouterRecipient;
  if (recipient.kind === 'IDENTIFIER' && recipient.value === 'CONNECTED_OWNER') recipientValue = 'CONNECTED_OWNER';
  else if (recipient.kind === 'ACCOUNT' && recipient.value.chainId === out.value.chainId) recipientValue = recipient.value.address;
  else return fail('ROUTER_RECIPIENT_INVALID');
  const fields: RouterBridgeFields = { sourceChain: node.chainId, destinationChain: out.value.chainId, inputToken: amount.value.asset.address,
    outputToken: out.value.address, amount: amount.value.amount, recipient: recipientValue, slippageBps: slip.maximumBps,
    providers: node.adapterConstraints.protocols as RoutingProvider[] };
  let rebuilt: Node;
  try { rebuilt = createRouterBridgeNode(node.nodeId, fields); } catch (cause) { throw cause instanceof Error ? cause : new Error('ROUTER_NODE_INVALID'); }
  if (canonicalJson(node) !== canonicalJson(rebuilt)) fail('ROUTER_DECLARATION_INVALID');
  return fields;
}

// ---------------------------------------------------------------------------------------------------------------
// Canonical route model
// ---------------------------------------------------------------------------------------------------------------

export type RouteFeeKind = 'INTEGRATOR' | 'BRIDGE_RELAYER_CAPITAL' | 'BRIDGE_DESTINATION_GAS' | 'BRIDGE_LP' | 'BRIDGE_OTHER';
export type RouteFee = { readonly kind: RouteFeeKind; readonly label: string; readonly chainId: string; readonly token: string;
  readonly amount: string; readonly recipient: string | null };
export type RouteStep = { readonly kind: 'FEE_COLLECTION' | 'BRIDGE'; readonly protocol: string; readonly fromChain: string; readonly toChain: string;
  readonly fromToken: string; readonly toToken: string; readonly amountIn: string; readonly amountOut: string };
export type RouteTransaction = { readonly purpose: 'BRIDGE_DEPOSIT'; readonly chainId: string; readonly to: string; readonly data: string; readonly value: '0x0' };
export type RouteBridge = { readonly protocol: UnderlyingProtocol; readonly originSpokePool: string; readonly destinationSpokePool: string;
  readonly depositor: string; readonly recipient: string; readonly inputToken: string; readonly outputToken: string;
  /** Amount the SpokePool deposit takes (after any integrator fee collected before the bridge). */ readonly inputAmount: string;
  /** Exact amount the relayer must deliver on the destination chain. */ readonly outputAmount: string;
  readonly destinationChainId: number; readonly exclusiveRelayer: string; readonly quoteTimestamp: number; readonly fillDeadline: number;
  readonly exclusivityParameter: number; readonly message: string };
export type RouteQuote = { readonly id: string; readonly rawHash: string; readonly quotedAt: string; readonly expiresAt: string;
  readonly estimatedDurationSeconds: number; readonly providerGasEstimate: string | null };
export type CanonicalRoute = {
  readonly format: 'flofi.route.v1';
  readonly sourceChain: string; readonly destinationChain: string; readonly inputToken: RouterToken; readonly outputToken: RouterToken;
  readonly inputAmount: string; readonly expectedOutput: string; readonly minimumOutput: string;
  readonly recipient: string; readonly depositor: string; readonly refundAddress: string;
  readonly routingProvider: RoutingProvider; readonly underlyingProtocol: UnderlyingProtocol;
  readonly steps: readonly RouteStep[]; readonly fees: readonly RouteFee[]; readonly feeTotal: string; readonly slippageBps: number;
  /** The exact allowance the deposit needs: token, spender, amount. Whether an approval transaction is needed is an observation. */
  readonly approval: { readonly token: string; readonly spender: string; readonly amount: string };
  readonly deposit: RouteTransaction; readonly bridge: RouteBridge; readonly quote: RouteQuote;
};

const FEE_KINDS: readonly RouteFeeKind[] = ['INTEGRATOR', 'BRIDGE_RELAYER_CAPITAL', 'BRIDGE_DESTINATION_GAS', 'BRIDGE_LP', 'BRIDGE_OTHER'];
const isoTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const token = (value: RouterToken, chainId: string): RouterToken => {
  if (!value || value.chainId !== chainId || !ADDRESS.test(value.address) || !Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > 36 ||
      typeof value.symbol !== 'string' || !/^[A-Za-z0-9.]{1,16}$/.test(value.symbol)) fail('ROUTE_TOKEN_INVALID');
  return { chainId: value.chainId, address: value.address, decimals: value.decimals, symbol: value.symbol };
};
const units = (value: unknown, code = 'ROUTE_AMOUNT_INVALID'): string => typeof value === 'string' && UNITS.test(value) ? value : fail(code);
const address = (value: unknown, code = 'ROUTE_ADDRESS_INVALID'): string => typeof value === 'string' && ADDRESS.test(value) ? value : fail(code);
const uint32 = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff ? value as number : fail('ROUTE_BRIDGE_INVALID');
/**
 * Validates and normalizes a route: every field typed and bounded, fee lines in one deterministic order, amounts
 * consistent (fees sum to the total; input − fees = expected output; minimum ≤ expected). Throws on anything else.
 */
export function canonicalizeRoute(route: CanonicalRoute): CanonicalRoute {
  if (!route || route.format !== 'flofi.route.v1') fail('ROUTE_FORMAT_INVALID');
  const pair = routerPair(route.sourceChain, route.inputToken?.address, route.destinationChain, route.outputToken?.address);
  if (!pair) fail('ROUTE_PAIR_UNSUPPORTED');
  const inputToken = token(route.inputToken, route.sourceChain), outputToken = token(route.outputToken, route.destinationChain);
  if (inputToken.decimals !== pair!.source.decimals || outputToken.decimals !== pair!.destination.decimals) fail('ROUTE_TOKEN_INVALID');
  const inputAmount = units(route.inputAmount), expectedOutput = units(route.expectedOutput), minimumOutput = units(route.minimumOutput);
  if (BigInt(inputAmount) < 1n || BigInt(minimumOutput) < 1n || BigInt(minimumOutput) > BigInt(expectedOutput) || BigInt(expectedOutput) > BigInt(inputAmount))
    fail('ROUTE_AMOUNT_INVALID');
  if (!(ROUTING_PROVIDERS as readonly string[]).includes(route.routingProvider)) fail('ROUTE_PROVIDER_INVALID');
  if (!(RECONCILABLE_PROTOCOLS as readonly string[]).includes(route.underlyingProtocol)) fail('ROUTE_PROTOCOL_NOT_RECONCILABLE');
  if (!Number.isSafeInteger(route.slippageBps) || route.slippageBps < 1 || route.slippageBps > ROUTER_MAXIMUM_SLIPPAGE_BPS) fail('ROUTE_SLIPPAGE_INVALID');
  if (!Array.isArray(route.steps) || route.steps.length < 1 || route.steps.length > 8) fail('ROUTE_STEPS_INVALID');
  const steps = route.steps.map(s => {
    if (!s || !['FEE_COLLECTION', 'BRIDGE'].includes(s.kind) || typeof s.protocol !== 'string' || !/^[a-z0-9.-]{1,40}$/.test(s.protocol) ||
        ![route.sourceChain, route.destinationChain].includes(s.fromChain) || ![route.sourceChain, route.destinationChain].includes(s.toChain))
      fail('ROUTE_STEPS_INVALID');
    return { kind: s.kind, protocol: s.protocol, fromChain: s.fromChain, toChain: s.toChain, fromToken: address(s.fromToken), toToken: address(s.toToken),
      amountIn: units(s.amountIn), amountOut: units(s.amountOut) };
  });
  const bridges = steps.filter(s => s.kind === 'BRIDGE');
  if (bridges.length !== 1 || steps.at(-1)!.kind !== 'BRIDGE' || bridges[0]!.protocol !== route.underlyingProtocol ||
      bridges[0]!.fromChain !== route.sourceChain || bridges[0]!.toChain !== route.destinationChain || bridges[0]!.toToken !== outputToken.address)
    fail('ROUTE_STEPS_INVALID');
  if (!Array.isArray(route.fees) || route.fees.length > 16) fail('ROUTE_FEES_INVALID');
  const fees = route.fees.map(f => {
    if (!f || !FEE_KINDS.includes(f.kind) || typeof f.label !== 'string' || f.label.length < 1 || f.label.length > 80 || f.chainId !== route.sourceChain ||
        f.token !== inputToken.address || (f.recipient !== null && !ADDRESS.test(String(f.recipient)))) fail('ROUTE_FEES_INVALID');
    return { kind: f.kind, label: f.label, chainId: f.chainId, token: f.token, amount: units(f.amount), recipient: f.recipient };
  }).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
  const feeTotal = units(route.feeTotal);
  if (fees.reduce((sum, f) => sum + BigInt(f.amount), 0n) !== BigInt(feeTotal) || BigInt(inputAmount) - BigInt(feeTotal) !== BigInt(expectedOutput))
    fail('ROUTE_FEES_INCONSISTENT');
  const recipient = address(route.recipient), depositor = address(route.depositor), refundAddress = address(route.refundAddress);
  if (recipient === ZERO || depositor === ZERO || refundAddress === ZERO) fail('ROUTE_ADDRESS_INVALID');
  const approval = { token: address(route.approval?.token), spender: address(route.approval?.spender), amount: units(route.approval?.amount) };
  if (approval.token !== inputToken.address || approval.amount !== inputAmount || approval.spender === ZERO) fail('ROUTE_APPROVAL_INVALID');
  const d = route.deposit;
  if (!d || d.purpose !== 'BRIDGE_DEPOSIT' || d.chainId !== route.sourceChain || !ADDRESS.test(d.to) || typeof d.data !== 'string' || !HEX.test(d.data) ||
      d.data.length < 10 || d.data.length > 100_000 || d.value !== '0x0' || d.to !== approval.spender) fail('ROUTE_TRANSACTION_INVALID');
  const b = route.bridge;
  if (!b || b.protocol !== route.underlyingProtocol || b.recipient !== recipient || b.outputToken !== outputToken.address || b.outputAmount !== minimumOutput ||
      b.destinationChainId !== Number(route.destinationChain.slice(7)) || b.message !== '0x' || BigInt(units(b.inputAmount)) > BigInt(inputAmount) ||
      b.inputToken !== inputToken.address) fail('ROUTE_BRIDGE_INVALID');
  const bridge: RouteBridge = { protocol: b.protocol, originSpokePool: address(b.originSpokePool), destinationSpokePool: address(b.destinationSpokePool),
    depositor: address(b.depositor), recipient: b.recipient, inputToken: b.inputToken, outputToken: b.outputToken, inputAmount: b.inputAmount, outputAmount: b.outputAmount,
    destinationChainId: b.destinationChainId, exclusiveRelayer: address(b.exclusiveRelayer), quoteTimestamp: uint32(b.quoteTimestamp), fillDeadline: uint32(b.fillDeadline),
    exclusivityParameter: uint32(b.exclusivityParameter), message: b.message };
  if (bridge.fillDeadline <= bridge.quoteTimestamp) fail('ROUTE_BRIDGE_INVALID');
  const q = route.quote;
  if (!q || typeof q.id !== 'string' || q.id.length < 1 || q.id.length > 160 || !HASH.test(q.rawHash) || !isoTime(q.quotedAt) || !isoTime(q.expiresAt) ||
      Date.parse(q.expiresAt) <= Date.parse(q.quotedAt) || !Number.isSafeInteger(q.estimatedDurationSeconds) || q.estimatedDurationSeconds < 0 ||
      q.estimatedDurationSeconds > 86_400 || (q.providerGasEstimate !== null && !UNITS.test(q.providerGasEstimate))) fail('ROUTE_QUOTE_INVALID');
  return { format: 'flofi.route.v1', sourceChain: route.sourceChain, destinationChain: route.destinationChain, inputToken, outputToken, inputAmount, expectedOutput,
    minimumOutput, recipient, depositor, refundAddress, routingProvider: route.routingProvider, underlyingProtocol: route.underlyingProtocol, steps, fees, feeTotal,
    slippageBps: route.slippageBps, approval, deposit: { purpose: 'BRIDGE_DEPOSIT', chainId: d.chainId, to: d.to, data: d.data, value: '0x0' }, bridge,
    quote: { id: q.id, rawHash: q.rawHash, quotedAt: q.quotedAt, expiresAt: q.expiresAt, estimatedDurationSeconds: q.estimatedDurationSeconds,
      providerGasEstimate: q.providerGasEstimate } };
}
/** Deterministic route commitment: key order, fee order and address case cannot change it; any material byte does. */
export function routeCommitment(route: CanonicalRoute): string {
  return '0x' + createHash('sha256').update('flofi/route-commitment/v1\n' + canonicalJson(canonicalizeRoute(route))).digest('hex');
}

export type RouteChange = 'CHAIN_CHANGED' | 'TOKEN_CHANGED' | 'AMOUNT_CHANGED' | 'RECIPIENT_CHANGED' | 'DEPOSITOR_CHANGED' | 'REFUND_ADDRESS_CHANGED' |
  'PROVIDER_CHANGED' | 'PROTOCOL_CHANGED' | 'STEPS_CHANGED' | 'FEES_OUT_OF_BOUNDS' | 'FEE_RECIPIENT_CHANGED' | 'MINIMUM_OUTPUT_DECREASED' |
  'SLIPPAGE_CHANGED' | 'APPROVAL_CHANGED' | 'TRANSACTION_TARGET_CHANGED' | 'TRANSACTION_FUNCTION_CHANGED' | 'VALUE_CHANGED' | 'BRIDGE_CONTRACT_CHANGED' |
  'BRIDGE_MESSAGE_CHANGED' | 'CALLDATA_CHANGED' | 'QUOTE_CHANGED' | 'DEADLINE_CHANGED';
/**
 * Material differences between a reviewed route and a candidate.
 * `REQUOTE`: a fresh quote from the same provider is compared to the reviewed route — identity, protocol, steps,
 * approvals, targets and value must be equal, fees may not rise and the minimum may not fall. (The executed bytes are
 * still the reviewed bytes; a fresh quote is only evidence that the provider still offers the reviewed route.)
 * `EXACT`: any byte of the route, including calldata, quote identity and deadlines, is material.
 */
export function compareRoutes(reviewedInput: CanonicalRoute, candidateInput: CanonicalRoute, mode: 'REQUOTE' | 'EXACT'): readonly RouteChange[] {
  const a = canonicalizeRoute(reviewedInput), b = canonicalizeRoute(candidateInput), changes = new Set<RouteChange>();
  const same = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y);
  if (a.sourceChain !== b.sourceChain || a.destinationChain !== b.destinationChain || a.bridge.destinationChainId !== b.bridge.destinationChainId) changes.add('CHAIN_CHANGED');
  if (!same(a.inputToken, b.inputToken) || !same(a.outputToken, b.outputToken) || a.bridge.outputToken !== b.bridge.outputToken) changes.add('TOKEN_CHANGED');
  if (a.inputAmount !== b.inputAmount) changes.add('AMOUNT_CHANGED');
  if (a.recipient !== b.recipient || a.bridge.recipient !== b.bridge.recipient) changes.add('RECIPIENT_CHANGED');
  if (a.depositor !== b.depositor || a.bridge.depositor !== b.bridge.depositor) changes.add('DEPOSITOR_CHANGED');
  if (a.refundAddress !== b.refundAddress) changes.add('REFUND_ADDRESS_CHANGED');
  if (a.routingProvider !== b.routingProvider) changes.add('PROVIDER_CHANGED');
  if (a.underlyingProtocol !== b.underlyingProtocol || a.bridge.protocol !== b.bridge.protocol) changes.add('PROTOCOL_CHANGED');
  const shape = (r: CanonicalRoute) => r.steps.map(s => [s.kind, s.protocol, s.fromChain, s.toChain, s.fromToken, s.toToken]);
  if (!same(shape(a), shape(b))) changes.add('STEPS_CHANGED');
  if (BigInt(b.feeTotal) > BigInt(a.feeTotal)) changes.add('FEES_OUT_OF_BOUNDS');
  const recipients = (r: CanonicalRoute) => [...new Set(r.fees.map(f => `${f.kind}:${f.recipient ?? ''}`))].sort();
  if (!same(recipients(a), recipients(b))) changes.add('FEE_RECIPIENT_CHANGED');
  if (BigInt(b.minimumOutput) < BigInt(a.minimumOutput)) changes.add('MINIMUM_OUTPUT_DECREASED');
  if (a.slippageBps !== b.slippageBps) changes.add('SLIPPAGE_CHANGED');
  if (!same(a.approval, b.approval)) changes.add('APPROVAL_CHANGED');
  if (a.deposit.to !== b.deposit.to || a.deposit.chainId !== b.deposit.chainId) changes.add('TRANSACTION_TARGET_CHANGED');
  if (a.deposit.data.slice(0, 10) !== b.deposit.data.slice(0, 10)) changes.add('TRANSACTION_FUNCTION_CHANGED');
  if (a.deposit.value !== b.deposit.value) changes.add('VALUE_CHANGED');
  if (a.bridge.originSpokePool !== b.bridge.originSpokePool || a.bridge.destinationSpokePool !== b.bridge.destinationSpokePool) changes.add('BRIDGE_CONTRACT_CHANGED');
  if (a.bridge.message !== b.bridge.message) changes.add('BRIDGE_MESSAGE_CHANGED');
  if (mode === 'EXACT') {
    if (a.deposit.data !== b.deposit.data) changes.add('CALLDATA_CHANGED');
    if (!same(a.quote, b.quote) || a.expectedOutput !== b.expectedOutput || a.minimumOutput !== b.minimumOutput || !same(a.fees, b.fees)) changes.add('QUOTE_CHANGED');
    if (a.bridge.quoteTimestamp !== b.bridge.quoteTimestamp || a.bridge.fillDeadline !== b.bridge.fillDeadline ||
        a.bridge.exclusivityParameter !== b.bridge.exclusivityParameter || a.bridge.exclusiveRelayer !== b.bridge.exclusiveRelayer) changes.add('DEADLINE_CHANGED');
  }
  return [...changes].sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-chain lifecycle
// ---------------------------------------------------------------------------------------------------------------

export const ROUTER_PHASES = Object.freeze(['PREPARED', 'AUTHORIZED', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED',
  'RECONCILED', 'RECONCILIATION_REQUIRED', 'RECOVERY_REQUIRED', 'REFUNDED', 'FAILED'] as const);
export type RouterPhase = typeof ROUTER_PHASES[number];
/**
 * Allowed phase changes. A source submission can only move forward; settlement success needs an observed destination
 * fill first; RECONCILED, REFUNDED, FAILED and RECONCILIATION_REQUIRED are terminal.
 */
export const ROUTER_PHASE_TRANSITIONS: Readonly<Record<RouterPhase, readonly RouterPhase[]>> = Object.freeze({
  PREPARED: ['PREPARED', 'AUTHORIZED'],
  AUTHORIZED: ['AUTHORIZED', 'PREPARED', 'SOURCE_SUBMITTED', 'RECONCILIATION_REQUIRED'],
  SOURCE_SUBMITTED: ['SOURCE_SUBMITTED', 'PREPARED', 'SOURCE_CONFIRMED', 'FAILED', 'RECONCILIATION_REQUIRED'],
  SOURCE_CONFIRMED: ['SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED', 'RECONCILIATION_REQUIRED'],
  IN_FLIGHT: ['IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED', 'RECONCILIATION_REQUIRED'],
  DESTINATION_OBSERVED: ['DESTINATION_OBSERVED', 'RECONCILED', 'RECONCILIATION_REQUIRED'],
  RECOVERY_REQUIRED: ['RECOVERY_REQUIRED', 'REFUNDED', 'RECONCILIATION_REQUIRED'],
  RECONCILED: ['RECONCILED'], REFUNDED: ['REFUNDED'], FAILED: ['FAILED'], RECONCILIATION_REQUIRED: ['RECONCILIATION_REQUIRED'],
});
export function assertRouterTransition(from: RouterPhase, to: RouterPhase): void {
  if (!ROUTER_PHASE_TRANSITIONS[from]?.includes(to)) fail('ROUTER_PHASE_TRANSITION_INVALID');
}

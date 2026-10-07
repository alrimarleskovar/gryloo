// SPDX-License-Identifier: Apache-2.0
/**
 * Canonical real-world payment action (Pix and boleto first). A payment is an ordinary semantic workflow node, so it
 * composes with swaps, bridges and withdrawals and goes through the one FloFi pipeline:
 * Author → canonical IR → Quote → Simulate → Review → Strategy Manifest → explicit wallet authorization → Execute →
 * Reconcile → Evidence. There is no separate payment runtime.
 *
 * Authoring channels (FloFi UI, MCP clients such as ChatGPT or Claude, WhatsApp, other agents) are untrusted: they can
 * produce a DRAFT and request quotes and simulations, never authorization. The node binds a destination commitment and the
 * requested amount; both are part of the semantic workflow hash that the Strategy Manifest binds, so any change to the
 * recipient, amount, provider, source or limits after Review invalidates the authorization.
 */
import { canonicalJson, hashRawBytes } from './canonical.js';
import type { SemanticWorkflow } from './semantic-workflow.js';
import type { Asset } from './common.js';
import { parsePixPayload, type PixPayload } from './pix.js';
import { parseBoleto, type Boleto } from './boleto.js';

type Node = SemanticWorkflow['nodes'][number];
export type PaymentRail = 'PIX' | 'BOLETO';
export const PAYMENT_ACTIONS: Readonly<Record<PaymentRail, string>> = Object.freeze({ PIX: 'payment.pix', BOLETO: 'payment.boleto' });
/** Settlement currency as an asset reference (ISO 4217 namespace); amounts are integer centavos. */
export const BRL_SETTLEMENT: Asset = Object.freeze({ chainId: 'iso4217:BRL', nativeId: 'BRL', decimals: 2 });
export const PAYMENT_SCHEMA_VERSION = '1.0.0';

export type PaymentFields = {
  readonly rail: PaymentRail;
  /** `paydest:0x…`: commitment to the rail and the exact destination payload/reference. */
  readonly destinationCommitment: string;
  /** Requested settlement amount in BRL centavos. */
  readonly amountCents: string;
  /** Where the amount truth comes from: encoded in the payload, or entered by the owner because the payload has none. */
  readonly amountSource: 'PAYLOAD' | 'OWNER';
  readonly sourceChain: string;
  readonly sourceAsset: Asset;
  /** Maximum source-asset spend in its native units (bounds conversion, fees and slippage together). */
  readonly maxSourceAmount: string;
  /** Maximum provider fee in BRL centavos. */
  readonly maxFeeCents: string;
  readonly maxSlippageBps: number;
  readonly provider: { readonly id: string; readonly version: string };
  /** Unix seconds after which the payment instruction must not be executed. */
  readonly expiresAt: number;
};

const UNITS = /^[1-9][0-9]{0,77}$/, CENTS = /^(0|[1-9][0-9]{0,15})$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHAIN = /^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/, COMMITMENT = /^paydest:0x[0-9a-f]{64}$/;
function fail(code: string): never { throw new Error(code); }

/** Commitment to the destination: the rail plus the exact validated payload (Pix) or canonical barcode (boleto). */
export function paymentDestinationCommitment(rail: PaymentRail, destination: string): string {
  if (!destination) fail('PAYMENT_DESTINATION_REQUIRED');
  const digest = hashRawBytes('intent', new TextEncoder().encode(canonicalJson({ kind: 'flofi/payment-destination', rail, destination })));
  return `paydest:${digest}`;
}

export function createPaymentNode(nodeId: string, fields: PaymentFields): Node {
  if (!ID.test(nodeId) || !Object.hasOwn(PAYMENT_ACTIONS, fields.rail) || !COMMITMENT.test(fields.destinationCommitment)
    || !CENTS.test(fields.amountCents) || fields.amountCents === '0' || (fields.amountSource !== 'PAYLOAD' && fields.amountSource !== 'OWNER')
    || !CHAIN.test(fields.sourceChain) || fields.sourceAsset.chainId !== fields.sourceChain || !UNITS.test(fields.maxSourceAmount)
    || !CENTS.test(fields.maxFeeCents) || !Number.isInteger(fields.maxSlippageBps) || fields.maxSlippageBps < 0 || fields.maxSlippageBps > 10_000
    || !ID.test(fields.provider.id) || !/^\d+\.\d+\.\d+$/.test(fields.provider.version)
    || !Number.isSafeInteger(fields.expiresAt) || fields.expiresAt <= 0) fail('PAYMENT_FIELDS_INVALID');
  const brl = (amount: string) => ({ asset: BRL_SETTLEMENT, amount });
  return { nodeId, actionType: PAYMENT_ACTIONS[fields.rail]!, actionSchemaVersion: PAYMENT_SCHEMA_VERSION, chainId: fields.sourceChain,
    requiredCapabilities: [PAYMENT_ACTIONS[fields.rail]!],
    adapterConstraints: { adapters: [{ id: fields.provider.id, version: fields.provider.version }], protocols: [fields.rail.toLowerCase()] },
    inputs: [
      { name: 'amount', kind: 'QUANTITY', value: brl(fields.amountCents) },
      { name: 'amount-source', kind: 'IDENTIFIER', value: fields.amountSource },
      { name: 'destination', kind: 'IDENTIFIER', value: fields.destinationCommitment },
      { name: 'expires-at', kind: 'INTEGER', value: fields.expiresAt },
      { name: 'maximum-fee', kind: 'QUANTITY', value: brl(fields.maxFeeCents) },
      { name: 'payer', kind: 'IDENTIFIER', value: 'CONNECTED_OWNER' },
      { name: 'source-asset', kind: 'ASSET', value: fields.sourceAsset },
    ],
    expectedOutputs: [], dependencies: [],
    userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: fields.sourceAsset, amount: fields.maxSourceAmount } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: fields.maxSlippageBps }],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A',
    // Recipient and amount cannot be edited in place: a different destination or amount is a new payment draft.
    lockedParameters: [{ name: 'amount', kind: 'QUANTITY', value: brl(fields.amountCents) }, { name: 'destination', kind: 'IDENTIFIER', value: fields.destinationCommitment }],
    editableBounds: [] };
}
export const isPaymentNode = (node: Pick<Node, 'actionType'>) => Object.values(PAYMENT_ACTIONS).includes(node.actionType);

/** Closed declaration: any extra port, constraint, lock or dependency is refused. */
export function readPaymentNode(node: Node): PaymentFields {
  const rail = (Object.keys(PAYMENT_ACTIONS) as PaymentRail[]).find(key => PAYMENT_ACTIONS[key] === node.actionType);
  if (!rail || node.actionSchemaVersion !== PAYMENT_SCHEMA_VERSION) fail('PAYMENT_ACTION_INVALID');
  const input = (name: string) => node.inputs.find(parameter => parameter.name === name);
  const amount = input('amount'), source = input('amount-source'), destination = input('destination'), expires = input('expires-at');
  const fee = input('maximum-fee'), asset = input('source-asset');
  const maxInput = node.userConstraints.find(constraint => constraint.kind === 'MAXIMUM_INPUT');
  const slippage = node.userConstraints.find(constraint => constraint.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (amount?.kind !== 'QUANTITY' || source?.kind !== 'IDENTIFIER' || destination?.kind !== 'IDENTIFIER' || expires?.kind !== 'INTEGER'
    || fee?.kind !== 'QUANTITY' || asset?.kind !== 'ASSET' || maxInput?.kind !== 'MAXIMUM_INPUT' || slippage?.kind !== 'MAXIMUM_SLIPPAGE_BPS'
    || node.adapterConstraints.adapters.length !== 1) fail('PAYMENT_PORTS_INVALID');
  const fields: PaymentFields = { rail: rail!, destinationCommitment: destination!.value as string, amountCents: (amount!.value as { amount: string }).amount,
    amountSource: source!.value as PaymentFields['amountSource'], sourceChain: node.chainId, sourceAsset: asset!.value as Asset,
    maxSourceAmount: (maxInput as { quantity: { amount: string } }).quantity.amount, maxFeeCents: (fee!.value as { amount: string }).amount,
    maxSlippageBps: (slippage as { maximumBps: number }).maximumBps, provider: { ...node.adapterConstraints.adapters[0]! }, expiresAt: expires!.value as number };
  const ordered = (n: Node) => ({ ...n, inputs: [...n.inputs].sort((a, b) => a.name.localeCompare(b.name)),
    lockedParameters: [...n.lockedParameters].sort((a, b) => a.name.localeCompare(b.name)) });
  if (canonicalJson(ordered(node)) !== canonicalJson(ordered(createPaymentNode(node.nodeId, fields)))) fail('PAYMENT_DECLARATION_INVALID');
  return fields;
}

/** Authorization-relevant payment facts the Review shows and the Strategy Manifest binds (through the workflow hash and owner). */
export type PaymentManifestFacts = PaymentFields & { readonly settlementCurrency: 'BRL'; readonly owner: { readonly chainId: string; readonly address: string } };
export function paymentManifestFacts(node: Node, owner: { readonly chainId: string; readonly address: string }): PaymentManifestFacts {
  if (!CHAIN.test(owner.chainId) || !owner.address) fail('PAYMENT_OWNER_REQUIRED');
  return { ...readPaymentNode(node), settlementCurrency: 'BRL', owner: { chainId: owner.chainId, address: owner.address } };
}
/**
 * Names of the facts that differ between the reviewed and the current payment. Any difference requires a fresh Review and
 * Manifest; there is no tolerance for "small" changes to recipient, amount, provider, source wallet or limits.
 */
export function paymentAuthorizationChanges(reviewed: PaymentManifestFacts, current: PaymentManifestFacts): string[] {
  const keys = Object.keys(reviewed) as (keyof PaymentManifestFacts)[];
  return keys.filter(key => canonicalJson(reviewed[key]) !== canonicalJson(current[key]));
}
export const paymentAuthorizationValid = (reviewed: PaymentManifestFacts, current: PaymentManifestFacts, nowSeconds: number) =>
  paymentAuthorizationChanges(reviewed, current).length === 0 && nowSeconds < current.expiresAt;

/** Lifecycle. A confirmed source transaction is never a settled payment: settlement needs provider/rail evidence. */
export const PAYMENT_STATES = ['DRAFT', 'QUOTED', 'SIMULATED', 'REVIEWED', 'AUTHORIZED', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED',
  'PAYMENT_PENDING', 'PAYMENT_SETTLED', 'RECOVERY_REQUIRED', 'UNKNOWN', 'FAILED', 'EXPIRED', 'CANCELLED'] as const;
export type PaymentState = typeof PAYMENT_STATES[number];
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentState[]>> = Object.freeze({
  DRAFT: ['QUOTED', 'FAILED', 'CANCELLED'],
  QUOTED: ['SIMULATED', 'DRAFT', 'EXPIRED', 'FAILED', 'CANCELLED'],
  SIMULATED: ['REVIEWED', 'DRAFT', 'EXPIRED', 'CANCELLED'],
  REVIEWED: ['AUTHORIZED', 'DRAFT', 'EXPIRED', 'CANCELLED'],
  AUTHORIZED: ['SOURCE_SUBMITTED', 'DRAFT', 'EXPIRED', 'CANCELLED'],
  // Before the source transaction confirms, nothing left the wallet: a revert is a plain failure.
  SOURCE_SUBMITTED: ['SOURCE_CONFIRMED', 'FAILED', 'UNKNOWN'],
  SOURCE_CONFIRMED: ['PAYMENT_PENDING', 'RECOVERY_REQUIRED', 'UNKNOWN'],
  PAYMENT_PENDING: ['PAYMENT_SETTLED', 'RECOVERY_REQUIRED', 'UNKNOWN'],
  // Funds left the wallet and the payment did not settle: never reported as a simple failure.
  RECOVERY_REQUIRED: ['PAYMENT_SETTLED', 'UNKNOWN'],
  UNKNOWN: ['SOURCE_CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_SETTLED', 'RECOVERY_REQUIRED', 'FAILED'],
  PAYMENT_SETTLED: [], FAILED: [], EXPIRED: [], CANCELLED: [],
});
export type PaymentEvidence = {
  readonly providerOrderId: string | null;
  readonly sourceTransaction: { readonly chainId: string; readonly hash: string; readonly confirmations: number } | null;
  readonly railStatus: 'NOT_STARTED' | 'PENDING' | 'SETTLED' | 'REJECTED' | 'UNKNOWN';
  /** Rail-level proof such as the Pix end-to-end id or the boleto payment authentication. */
  readonly railReference: string | null;
  readonly settledAmountCents: string | null;
  readonly feesCents: string | null;
  readonly observedAt: string;
  readonly reconciliation: 'NONE' | 'PENDING' | 'RECONCILED' | 'DIVERGENT';
};
/** Enforces both the transition table and the evidence each claim needs; there is no path that skips settlement evidence. */
export function assertPaymentTransition(from: PaymentState, to: PaymentState, evidence?: PaymentEvidence): void {
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) fail(`PAYMENT_TRANSITION_INVALID_${from}_TO_${to}`);
  if (to === 'SOURCE_CONFIRMED' && !(evidence?.sourceTransaction && evidence.sourceTransaction.confirmations > 0)) fail('PAYMENT_SOURCE_CONFIRMATION_REQUIRED');
  if (to === 'PAYMENT_PENDING' && !evidence?.providerOrderId) fail('PAYMENT_PROVIDER_ORDER_REQUIRED');
  if (to === 'PAYMENT_SETTLED' && !(evidence?.providerOrderId && evidence.railStatus === 'SETTLED' && evidence.railReference && evidence.settledAmountCents))
    fail('PAYMENT_SETTLEMENT_EVIDENCE_REQUIRED');
}

export type PaymentChannel = 'FLOFI_UI' | 'MCP' | 'WHATSAPP' | 'AGENT';
export type PaymentDraftRequest = {
  readonly channel: PaymentChannel;
  readonly rail: PaymentRail;
  /** Pix Copia e Cola text, or a boleto barcode / linha digitável, exactly as received. */
  readonly destination: string;
  /** Only when the payload does not encode an amount. */
  readonly ownerAmountCents?: string;
  readonly sourceAsset: Asset;
  readonly maxSourceAmount: string;
  readonly maxFeeCents: string;
  readonly maxSlippageBps: number;
  readonly provider: { readonly id: string; readonly version: string };
  readonly expiresAt: number;
};
export type PaymentDestinationSummary = { readonly rail: 'PIX'; readonly pix: PixPayload } | { readonly rail: 'BOLETO'; readonly boleto: Boleto };
/** A channel-authored draft. It carries no authority: `authorizes` is always false and the state is always DRAFT. */
export type PaymentDraft = { readonly state: 'DRAFT'; readonly authorizes: false; readonly channel: PaymentChannel; readonly node: Node;
  readonly destination: PaymentDestinationSummary; readonly requiresProviderResolution: boolean };

/**
 * Authors a canonical payment node from untrusted channel input. The destination is parsed and validated locally and fails
 * closed; the amount comes from the payload when encoded and must match any owner-supplied value; without either, the
 * draft is refused rather than an amount being invented.
 */
export function authorPaymentDraft(nodeId: string, request: PaymentDraftRequest, now: Date = new Date()): PaymentDraft {
  let destination: PaymentDestinationSummary, canonical: string, encoded: string | null;
  if (request.rail === 'PIX') {
    const pix = parsePixPayload(request.destination);
    destination = { rail: 'PIX', pix }; canonical = pix.payload; encoded = pix.amount?.cents ?? null;
  } else if (request.rail === 'BOLETO') {
    const boleto = parseBoleto(request.destination, now);
    destination = { rail: 'BOLETO', boleto }; canonical = boleto.barcode; encoded = boleto.amount?.kind === 'EFFECTIVE' ? boleto.amount.cents : null;
  } else return fail('PAYMENT_RAIL_UNSUPPORTED');
  const owner = request.ownerAmountCents;
  if (owner !== undefined && (!CENTS.test(owner) || owner === '0')) fail('PAYMENT_AMOUNT_INVALID');
  if (encoded && owner !== undefined && owner !== encoded) fail('PAYMENT_AMOUNT_CONFLICT');
  const amountCents = encoded ?? owner ?? fail('PAYMENT_AMOUNT_REQUIRED');
  if (request.expiresAt <= Math.floor(now.getTime() / 1000)) fail('PAYMENT_EXPIRED');
  const node = createPaymentNode(nodeId, { rail: request.rail, destinationCommitment: paymentDestinationCommitment(request.rail, canonical),
    amountCents, amountSource: encoded ? 'PAYLOAD' : 'OWNER', sourceChain: request.sourceAsset.chainId, sourceAsset: request.sourceAsset,
    maxSourceAmount: request.maxSourceAmount, maxFeeCents: request.maxFeeCents, maxSlippageBps: request.maxSlippageBps,
    provider: request.provider, expiresAt: request.expiresAt });
  // A dynamic Pix code's recipient and amount live at the PSP location: only the provider can resolve them before Quote.
  const requiresProviderResolution = destination.rail === 'PIX' && destination.pix.locationUrl !== null;
  return { state: 'DRAFT', authorizes: false, channel: request.channel, node, destination, requiresProviderResolution };
}

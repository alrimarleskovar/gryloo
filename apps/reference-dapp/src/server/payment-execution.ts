// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Execution of a payment the owner reviewed in FloFi. This module is deliberately separate from `payment-service.ts`, the
 * channel entry point: chat, MCP, WhatsApp and agents can draft and quote, but nothing they hold reaches these functions.
 *
 * Every step re-checks the FloFi Review authorization against the current canonical payment: the destination commitment,
 * amount, provider, source chain and asset, maximum source amount, maximum fee and slippage, owner and expiry must be
 * exactly what the Strategy Manifest bound, and the quote must be the reviewed one, inside its bounds and unexpired. Any
 * difference invalidates the authorization and needs a fresh Simulation, Review, Manifest and wallet authorization.
 *
 * Money moves only through the owner's own wallet: `initiatePayment` returns the source transfer the owner signs in FloFi's
 * reviewed wallet flow. `submitPayment` runs only with that transfer verified on-chain (from the owner, to the instructed
 * deposit address, the instructed asset and amount). Source confirmation is never reported as settlement.
 */
import { assertPaymentTransition, paymentAuthorizationChanges, paymentDestinationCommitment, pixKeyDestination, type PaymentDestinationSummary,
  type PaymentManifestFacts, type PaymentState } from '@defi-workflow-engine/workflow-contracts';
import type { PaymentAdapter, PaymentOrder, PaymentProgress, ReviewedPaymentAuthorization, SourceConfirmation } from './payment-adapter.ts';

function fail(code: string): never { throw new Error(code); }
const destinationText = (destination: PaymentDestinationSummary) =>
  destination.kind === 'PIX_KEY' ? pixKeyDestination(destination.key) : destination.kind === 'PIX_CODE' ? destination.pix.payload : destination.boleto.barcode;

/** Fails closed unless the authorization is a FloFi Review of exactly this payment and quote, still in time. */
export function assertReviewedPayment(input: { readonly authorization: ReviewedPaymentAuthorization; readonly current: PaymentManifestFacts;
  readonly destination: PaymentDestinationSummary; readonly now: number; readonly requireLiveQuote: boolean }): void {
  const { authorization, current, destination, now } = input;
  if (!authorization || authorization.origin !== 'FLOFI_REVIEW' || !/^0x[0-9a-f]{64}$/.test(authorization.manifestHash)) fail('PAYMENT_AUTHORIZATION_REQUIRED');
  const changed = paymentAuthorizationChanges(authorization.facts, current);
  if (changed.length) fail(`PAYMENT_AUTHORIZATION_INVALIDATED_${changed.sort().join('_').replace(/[^A-Za-z0-9_]/g, '').toUpperCase()}`);
  if (destination.rail !== current.rail || paymentDestinationCommitment(current.rail, destinationText(destination)) !== current.destinationCommitment)
    fail('PAYMENT_DESTINATION_MISMATCH');
  const quote = authorization.quote;
  if (quote.amountCents !== current.amountCents) fail('PAYMENT_QUOTE_AMOUNT_MISMATCH');
  if (BigInt(quote.feeCents) > BigInt(current.maxFeeCents)) fail('PAYMENT_QUOTE_FEE_ABOVE_LIMIT');
  if (BigInt(quote.sourceAmount) > BigInt(current.maxSourceAmount)) fail('PAYMENT_QUOTE_SOURCE_ABOVE_LIMIT');
  if (now >= current.expiresAt) fail('PAYMENT_EXPIRED');
  if (input.requireLiveQuote && now >= quote.expiresAt) fail('PAYMENT_QUOTE_EXPIRED');
}
const adapterFor = (adapters: ReadonlyMap<string, PaymentAdapter>, facts: PaymentManifestFacts) => {
  const adapter = adapters.get(facts.provider.id);
  return adapter && adapter.version === facts.provider.version ? adapter : fail('PAYMENT_PROVIDER_NOT_CONFIGURED');
};

/** The source transfer for the owner to sign in FloFi's wallet flow. Requires a live reviewed quote; moves no money. */
export async function initiatePayment(input: { readonly authorization: ReviewedPaymentAuthorization; readonly current: PaymentManifestFacts;
  readonly destination: PaymentDestinationSummary; readonly adapters: ReadonlyMap<string, PaymentAdapter>; readonly now: number }): Promise<PaymentOrder> {
  assertReviewedPayment({ ...input, requireLiveQuote: true });
  const order = await adapterFor(input.adapters, input.current).initiate(input);
  const facts = input.current;
  if (order.sourceTransfer.chainId !== facts.sourceChain || JSON.stringify(order.sourceTransfer.asset) !== JSON.stringify(facts.sourceAsset)
    || order.sourceTransfer.amount !== input.authorization.quote.sourceAmount || BigInt(order.sourceTransfer.amount) > BigInt(facts.maxSourceAmount))
    fail('PAYMENT_ORDER_OUTSIDE_AUTHORIZATION');
  return order;
}

/**
 * Asks the provider to pay out once the owner's transfer is confirmed. The verified transfer must be exactly the instructed
 * one from the reviewed owner; the quote may have aged during confirmation, so the provider re-prices and the adapter refuses
 * to pay out above what the owner sent.
 */
export async function submitPayment(input: { readonly authorization: ReviewedPaymentAuthorization; readonly current: PaymentManifestFacts;
  readonly destination: PaymentDestinationSummary; readonly order: PaymentOrder; readonly source: SourceConfirmation;
  readonly adapters: ReadonlyMap<string, PaymentAdapter>; readonly now: number; readonly previous: PaymentState }): Promise<PaymentProgress> {
  assertReviewedPayment({ ...input, requireLiveQuote: false });
  const { source, order, current } = input;
  if (input.previous !== 'SOURCE_CONFIRMED' && input.previous !== 'UNKNOWN' && input.previous !== 'RECOVERY_REQUIRED') fail(`PAYMENT_SUBMIT_FROM_${input.previous}`);
  if (!(source.confirmations > 0) || source.chainId !== order.sourceTransfer.chainId || source.to.toLowerCase() !== order.sourceTransfer.to.toLowerCase()
    || JSON.stringify(source.asset) !== JSON.stringify(order.sourceTransfer.asset) || source.amount !== order.sourceTransfer.amount
    || source.from.toLowerCase() !== current.owner.address.toLowerCase() || source.chainId !== current.owner.chainId)
    fail('PAYMENT_SOURCE_NOT_AS_INSTRUCTED');
  return checkedProgress(input.previous, await adapterFor(input.adapters, current).submit(input));
}

/** Reconciles from the provider's own record (also what a verified provider webhook should trigger). */
export async function reconcilePayment(input: { readonly current: PaymentManifestFacts; readonly providerOrderId: string;
  readonly source: SourceConfirmation | null; readonly adapters: ReadonlyMap<string, PaymentAdapter>; readonly now: number; readonly previous: PaymentState }): Promise<PaymentProgress> {
  const progress = await adapterFor(input.adapters, input.current).status({ providerOrderId: input.providerOrderId, amountCents: input.current.amountCents,
    source: input.source, now: input.now });
  return checkedProgress(input.previous, progress);
}
/**
 * The lifecycle's transition table and evidence rules apply to every provider report; staying in a state is a no-op. A
 * provider that already settled when first observed after confirmation went through PAYMENT_PENDING (it accepted the order),
 * so that step is checked with the same evidence rather than skipped.
 */
function checkedProgress(previous: PaymentState, progress: PaymentProgress): PaymentProgress {
  if (progress.state === previous) return progress;
  if (previous === 'SOURCE_CONFIRMED' && progress.state === 'PAYMENT_SETTLED') {
    assertPaymentTransition(previous, 'PAYMENT_PENDING', progress.evidence);
    assertPaymentTransition('PAYMENT_PENDING', progress.state, progress.evidence);
  } else assertPaymentTransition(previous, progress.state, progress.evidence);
  return progress;
}

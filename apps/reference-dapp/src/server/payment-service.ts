// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One payment entry point for every authoring channel (FloFi UI, MCP clients, WhatsApp, agents). The channel's input is
 * untrusted: it becomes a canonical DRAFT payment node through the shared contracts, is quoted by the provider the node names,
 * and ends at a FloFi Review handoff. Nothing here authorizes, signs or initiates a payment; there is deliberately no
 * function in this module that can.
 */
import { authorPaymentDraft, paymentManifestFacts, readPaymentNode, type PaymentDraft, type PaymentDraftRequest } from '@defi-workflow-engine/workflow-contracts';
import { paymentAdapters, paymentProviderStatuses, type PaymentAdapter, type PaymentQuote } from './payment-adapter.ts';

export type PreparedPayment =
  | { readonly status: 'QUOTED'; readonly draft: PaymentDraft; readonly quote: PaymentQuote; readonly next: 'REVIEW_IN_FLOFI'; readonly authorizes: false }
  | { readonly status: 'PROVIDER_UNAVAILABLE'; readonly draft: PaymentDraft; readonly code: string; readonly next: 'NONE'; readonly authorizes: false };

/**
 * Validates and drafts the payment locally (malformed Pix/boleto, missing or conflicting amounts and expired instructions
 * fail closed before any provider is contacted), then asks the named provider for a quote. `owner` is the public account the
 * quote is for; it grants nothing.
 */
export async function preparePayment(nodeId: string, request: PaymentDraftRequest, owner: { readonly chainId: string; readonly address: string },
  options: { readonly now?: Date; readonly adapters?: ReadonlyMap<string, PaymentAdapter> } = {}): Promise<PreparedPayment> {
  const draft = authorPaymentDraft(nodeId, request, options.now);
  const adapters = options.adapters ?? paymentAdapters();
  const adapter = adapters.get(request.provider.id);
  if (!adapter || adapter.version !== request.provider.version) {
    const known = paymentProviderStatuses(process.env, adapters).find(status => status.id === request.provider.id && !status.available);
    return { status: 'PROVIDER_UNAVAILABLE', draft, code: known?.code ?? 'PAYMENT_PROVIDER_NOT_CONFIGURED', next: 'NONE', authorizes: false };
  }
  const facts = paymentManifestFacts(draft.node, owner);
  if (!adapter.rails.includes(facts.rail)) throw new Error('PAYMENT_RAIL_UNSUPPORTED_BY_PROVIDER');
  if (!adapter.destinationKinds.includes(draft.destination.kind)) throw new Error('PAYMENT_DESTINATION_UNSUPPORTED_BY_PROVIDER');
  if (!(await adapter.supportedSources()).some(source => source.chainId === facts.sourceChain && JSON.stringify(source.asset) === JSON.stringify(facts.sourceAsset)))
    throw new Error('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
  const quote = await adapter.quote({ facts, destination: draft.destination });
  // A quote outside the drafted bounds is refused, never silently adopted.
  if (quote.amountCents !== facts.amountCents) throw new Error('PAYMENT_QUOTE_AMOUNT_MISMATCH');
  if (BigInt(quote.feeCents) > BigInt(facts.maxFeeCents)) throw new Error('PAYMENT_QUOTE_FEE_ABOVE_LIMIT');
  if (BigInt(quote.sourceAmount) > BigInt(facts.maxSourceAmount)) throw new Error('PAYMENT_QUOTE_SOURCE_ABOVE_LIMIT');
  if (quote.expiresAt > facts.expiresAt) throw new Error('PAYMENT_QUOTE_OUTLIVES_INSTRUCTION');
  return { status: 'QUOTED', draft, quote, next: 'REVIEW_IN_FLOFI', authorizes: false };
}

const brl = (cents: string) => `R$ ${(BigInt(cents) / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(BigInt(cents) % 100n).toString().padStart(2, '0')}`;
/**
 * The channel-neutral summary a chat or WhatsApp message shows. It always ends with the FloFi Review step and never offers an
 * approve action inside the channel. Recipient keys are masked.
 */
export function paymentChannelSummary(prepared: PreparedPayment): string {
  const fields = readPaymentNode(prepared.draft.node), destination = prepared.draft.destination;
  const recipient = destination.kind === 'PIX_CODE'
    ? `${destination.pix.merchantName}${destination.pix.key ? ` (${destination.pix.key.type} ${mask(destination.pix.key.value)})` : ''}`
    : destination.kind === 'PIX_KEY' ? `Pix key (${destination.key.type} ${mask(destination.key.value)})`
      : `Boleto ${destination.boleto.bankCode ? `bank ${destination.boleto.bankCode}` : `segment ${destination.boleto.segment}`}`;
  const lines = [prepared.status === 'QUOTED' ? 'Payment prepared' : 'Payment drafted — provider unavailable', `Recipient: ${recipient}`,
    `Amount: ${brl(fields.amountCents)}`, `Source: ${fields.sourceAsset.chainId}`, `Provider: ${fields.provider.id}`];
  if (prepared.status === 'QUOTED') lines.push(`Fee: ${brl(prepared.quote.feeCents)}`, `Expires: ${new Date(prepared.quote.expiresAt * 1000).toISOString()}`,
    'Review and approve in FloFi with your own wallet. Nothing has been paid or authorized.');
  else lines.push(`Status: ${prepared.code}. Nothing has been paid or authorized.`);
  return lines.join('\n');
}
function mask(value: string): string { return value.length <= 6 ? '•••' : `${value.slice(0, 3)}•••${value.slice(-2)}`; }

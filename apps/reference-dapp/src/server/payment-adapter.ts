// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pluggable boundary between the FloFi engine and a real-world payment provider (Pix, boleto, later rails). The engine is
 * never bound to one provider: the provider is a field of the canonical payment node, and an adapter is looked up by that id.
 *
 * An adapter quotes, resolves and observes. It never signs and never holds owner keys: `initiate` accepts only a FloFi Review
 * authorization bound to the exact payment facts, and returns the source-chain transaction the owner's own wallet signs in
 * FloFi through the reviewed wallet flow. Settlement is reported only from provider/rail evidence.
 */
import type { Asset, PaymentEvidence, PaymentManifestFacts, PaymentRail } from '@defi-workflow-engine/workflow-contracts';

export type PaymentSource = { readonly chainId: string; readonly asset: Asset };
export type ResolvedPaymentDestination = {
  /** Provider-validated recipient display data (masked where the rail requires). */
  readonly recipientName: string;
  readonly recipientDocumentMasked: string | null;
  readonly amountCents: string | null;
  readonly expiresAt: number | null;
};
export type PaymentQuote = {
  readonly providerQuoteId: string;
  readonly amountCents: string;
  readonly feeCents: string;
  /** Source asset needed, in native units, including provider conversion. */
  readonly sourceAmount: string;
  readonly expiresAt: number;
};
/** Exists only after the owner accepted the Strategy Manifest in FloFi; channels cannot construct one. */
export type ReviewedPaymentAuthorization = { readonly origin: 'FLOFI_REVIEW'; readonly manifestHash: string; readonly facts: PaymentManifestFacts;
  readonly acceptedAt: number };
export type PaymentOrder = { readonly providerOrderId: string;
  /** The unsigned source transfer the owner signs in FloFi's wallet flow (never signed by the adapter). */
  readonly sourceTransfer: { readonly chainId: string; readonly to: string; readonly asset: Asset; readonly amount: string } };

export interface PaymentAdapter {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly rails: readonly PaymentRail[];
  supportedSources(): readonly PaymentSource[];
  resolveDestination(input: { readonly rail: PaymentRail; readonly destination: string }): Promise<ResolvedPaymentDestination>;
  quote(input: { readonly facts: PaymentManifestFacts }): Promise<PaymentQuote>;
  initiate(input: { readonly authorization: ReviewedPaymentAuthorization; readonly quote: PaymentQuote }): Promise<PaymentOrder>;
  status(input: { readonly providerOrderId: string }): Promise<PaymentEvidence>;
}

export type PaymentProviderStatus = { readonly id: string; readonly name: string; readonly available: boolean; readonly code: string; readonly detail: string;
  readonly sources: readonly string[] };
/**
 * PixBlock (pixblock.com.br) investigation, 2026-10-07, official surfaces only. Its published "Developer API" page documents an
 * account API key (`pk_live_…`), webhooks (`charge.created`, `charge.approved`, `charge.expired`, `offramp.completed`) and one
 * example, `POST https://api.pixblock.com.br/charges`, which creates a charge to RECEIVE Pix into a wallet. No endpoint is
 * published for paying a third-party Pix code or boleto, quoting such a payment, or reading its status, no sandbox is published,
 * and FloFi has no PixBlock credential. No endpoint is invented here, so the adapter is unavailable.
 */
export const PIXBLOCK_STATUS: PaymentProviderStatus = Object.freeze({ id: 'pixblock', name: 'PixBlock', available: false,
  code: 'PIXBLOCK_PAYOUT_API_UNAVAILABLE',
  detail: 'PixBlock publishes only charge creation (receiving Pix) and webhooks; no official API for paying a Pix code or boleto, quoting or status, '
    + 'and no FloFi credential is configured.',
  sources: Object.freeze(['https://www.pixblock.com.br/testar/api', 'https://www.pixblock.com.br/testar/tutorials']) });

/** Adapters configured for this deployment. None is configured in this build; every lookup fails closed. */
export function paymentAdapters(): ReadonlyMap<string, PaymentAdapter> { return new Map(); }
export function paymentProviderStatuses(adapters: ReadonlyMap<string, PaymentAdapter> = paymentAdapters()): PaymentProviderStatus[] {
  return [...[...adapters.values()].map(adapter => ({ id: adapter.id, name: adapter.name, available: true, code: 'AVAILABLE', detail: '', sources: [] })),
    ...(adapters.has(PIXBLOCK_STATUS.id) ? [] : [PIXBLOCK_STATUS])];
}

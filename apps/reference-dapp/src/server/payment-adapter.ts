// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pluggable boundary between the FloFi engine and a real-world payment provider (Pix, boleto, later rails). The engine is
 * never bound to one provider: the provider is a field of the canonical payment node, and an adapter is looked up by that id.
 *
 * An adapter quotes, instructs and observes. It never signs and never holds owner keys: `initiate` accepts only a FloFi Review
 * authorization bound to the exact payment facts and quote, and returns the source-chain transfer the owner's own wallet signs
 * in FloFi through the reviewed wallet flow. `submit` asks the provider to pay out only after FloFi verified that transfer
 * on-chain, and settlement is reported only from provider/rail evidence. Source confirmation is never settlement.
 */
import type { Asset, PaymentDestinationSummary, PaymentEvidence, PaymentManifestFacts, PaymentRail, PaymentState } from '@defi-workflow-engine/workflow-contracts';
import { createWooviPixPaymentAdapter, wooviConfiguration, WOOVI_PROVIDER } from './woovi-pix-adapter.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type PaymentSource = { readonly chainId: string; readonly asset: Asset };
export type PaymentDestinationKind = PaymentDestinationSummary['kind'];
export type PaymentQuote = {
  readonly providerQuoteId: string;
  readonly amountCents: string;
  /** Total provider fee in BRL centavos, as the provider reports it. */
  readonly feeCents: string;
  /** Source asset needed, in native units, including provider conversion. */
  readonly sourceAmount: string;
  /** Unix seconds after which FloFi refuses to act on this quote. */
  readonly expiresAt: number;
};
/** Exists only after the owner accepted the Strategy Manifest in FloFi; channels cannot construct one. It binds the exact quote. */
export type ReviewedPaymentAuthorization = { readonly origin: 'FLOFI_REVIEW'; readonly manifestHash: string; readonly facts: PaymentManifestFacts;
  readonly quote: PaymentQuote; readonly acceptedAt: number };
export type PaymentOrder = { readonly providerOrderId: string;
  /** The unsigned source transfer the owner signs in FloFi's wallet flow (never signed by the adapter). */
  readonly sourceTransfer: { readonly chainId: string; readonly to: string; readonly asset: Asset; readonly amount: string } };
/** The owner's source transfer as FloFi verified it on-chain (receipt and transfer log), never as a channel reported it. */
export type SourceConfirmation = { readonly chainId: string; readonly transactionHash: string; readonly from: string; readonly to: string;
  readonly asset: Asset; readonly amount: string; readonly confirmations: number };
/** The provider's view of one payment, mapped onto the canonical lifecycle with only real provider and source facts. */
export type PaymentProgress = { readonly state: PaymentState; readonly evidence: PaymentEvidence; readonly code: string | null };

export interface PaymentAdapter {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly rails: readonly PaymentRail[];
  readonly destinationKinds: readonly PaymentDestinationKind[];
  /** The sources this provider account can actually take, read from the provider (not assumed). */
  supportedSources(): Promise<readonly PaymentSource[]>;
  quote(input: { readonly facts: PaymentManifestFacts; readonly destination: PaymentDestinationSummary }): Promise<PaymentQuote>;
  /** Payment instructions for a reviewed payment. Moves no money anywhere. */
  initiate(input: { readonly authorization: ReviewedPaymentAuthorization; readonly destination: PaymentDestinationSummary; readonly now: number }): Promise<PaymentOrder>;
  /** Pays out at the provider, idempotently, once the owner's own source transfer is confirmed. */
  submit(input: { readonly authorization: ReviewedPaymentAuthorization; readonly destination: PaymentDestinationSummary; readonly order: PaymentOrder;
    readonly source: SourceConfirmation; readonly now: number }): Promise<PaymentProgress>;
  status(input: { readonly providerOrderId: string; readonly amountCents: string; readonly source: SourceConfirmation | null; readonly now: number }): Promise<PaymentProgress>;
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

/** Adapters configured for this deployment. A provider without valid deployment configuration is absent, so lookups fail closed. */
export function paymentAdapters(env: Env = process.env, fetchImpl: typeof fetch = fetch): ReadonlyMap<string, PaymentAdapter> {
  const adapters = new Map<string, PaymentAdapter>();
  const woovi = wooviConfiguration(env);
  if (woovi.configured) adapters.set(WOOVI_PROVIDER.id, createWooviPixPaymentAdapter(woovi, { fetchImpl }));
  return adapters;
}
export function paymentProviderStatuses(env: Env = process.env, adapters: ReadonlyMap<string, PaymentAdapter> = paymentAdapters(env)): PaymentProviderStatus[] {
  const woovi = wooviConfiguration(env);
  return [...[...adapters.values()].map(adapter => ({ id: adapter.id, name: adapter.name, available: true, code: 'AVAILABLE', detail: '', sources: [] })),
    ...(adapters.has(WOOVI_PROVIDER.id) ? [] : [{ id: WOOVI_PROVIDER.id, name: WOOVI_PROVIDER.name, available: false,
      code: woovi.configured ? 'PAYMENT_PROVIDER_NOT_CONFIGURED' : woovi.code, detail: 'Woovi needs its App ID and environment in the deployment configuration.',
      sources: [] }]),
    ...(adapters.has(PIXBLOCK_STATUS.id) ? [] : [PIXBLOCK_STATUS])];
}

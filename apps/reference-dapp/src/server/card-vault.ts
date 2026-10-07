// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Card credentials enter FloFi only through a PCI-appropriate provider's hosted or tokenized entry: the provider's own
 * fields collect the card number and security code, and FloFi receives a payment-method token with brand, last four
 * digits and expiry. FloFi never receives, logs or stores a card number or security code, so there is no code path here
 * that accepts one.
 *
 * No provider is integrated or configured for this deployment. `cardVaultStatus` therefore reports the exact external
 * prerequisite and Add card fails closed. A provider integration implements `CardVaultAdapter` with the provider's
 * official hosted-entry SDK and server API, and is selected here by explicit deployment configuration.
 */
import type { ProviderCardResult } from '../domain/credentials';

export type CardVaultAdapter = {
  readonly id: string;
  readonly name: string;
  /** Starts the provider-hosted entry for one owner; the browser mounts the provider's own fields with this client data. */
  beginHostedEntry(input: { readonly ownerRef: string }): Promise<{ readonly clientConfiguration: Readonly<Record<string, string>> }>;
  /** Exchanges the provider's completed setup reference for tokenized metadata only. */
  completeHostedEntry(input: { readonly ownerRef: string; readonly setupReference: string }): Promise<ProviderCardResult>;
};
export const CARD_PROVIDER_PREREQUISITE = 'A PCI-DSS compliant card provider with hosted or tokenized card entry (for example a payment '
  + 'service provider account with its publishable and server API credentials) must be chosen by the owner, contracted, and configured '
  + 'on the deployment before FloFi can add cards.';
export type CardVaultStatus =
  | { readonly available: false; readonly code: 'CARD_TOKENIZATION_PROVIDER_REQUIRED'; readonly prerequisite: string }
  | { readonly available: true; readonly provider: { readonly id: string; readonly name: string } };

/** The configured adapter, or null. This build integrates no provider, so it is always null. */
export function cardVaultAdapter(): CardVaultAdapter | null { return null; }
export function cardVaultStatus(adapter: CardVaultAdapter | null = cardVaultAdapter()): CardVaultStatus {
  return adapter ? { available: true, provider: { id: adapter.id, name: adapter.name } }
    : { available: false, code: 'CARD_TOKENIZATION_PROVIDER_REQUIRED', prerequisite: CARD_PROVIDER_PREREQUISITE };
}

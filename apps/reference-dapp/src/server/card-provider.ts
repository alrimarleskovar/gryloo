// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Card credentials enter FloFi only through a PCI-appropriate provider's own secure entry: the provider's fields (iframes
 * on the provider's origin) collect the card number, expiry and security code, the provider tokenizes them, and FloFi's
 * server exchanges that one-time token for a saved-card reference at the provider. FloFi receives, stores and displays only
 * provider-safe metadata (provider ids, payment method, brand, last four digits, expiry). No code path here accepts a card
 * number or security code, and adding a card never charges it.
 *
 * The UI talks to this abstraction only. The provider is chosen by deployment configuration; without one, Add card fails
 * closed with the exact prerequisite. A saved card is owned by the browser that added it (Credentials are browser-local):
 * the server seals each saved-card reference into a binding MAC'd with the deployment secret, so only a holder of that
 * binding can act on the card at the provider, and a test binding never acts in production or in another deployment.
 */
import type { CardProviderEnvironment } from './card-binding.ts';
import { createMercadoPagoCardProvider, mercadoPagoConfiguration } from './mercado-pago-card-provider.ts';

export type { CardProviderEnvironment } from './card-binding.ts';
type Env = Readonly<Record<string, string | undefined>>;
/** Public data the browser needs to mount the provider's secure fields. Never a secret. */
export type CardProviderClient = { readonly kind: 'mercado_pago_secure_fields'; readonly publicKey: string; readonly locale: 'pt-BR';
  readonly sdkUrl: 'https://sdk.mercadopago.com/js/v2' };
/** Provider-safe saved-card metadata: what FloFi may persist and show. */
export type SafeProviderCard = {
  readonly provider: string;
  readonly providerName: string;
  readonly providerCustomerId: string;
  /** The provider's saved-card id. Never a card number. */
  readonly providerCardId: string;
  /** Server-sealed ownership reference for exactly this card at this provider and deployment. */
  readonly binding: string;
  readonly paymentMethodId: string;
  readonly brand: string;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
};
export interface CardProvider {
  readonly id: string;
  readonly name: string;
  readonly environment: CardProviderEnvironment;
  /** Starts secure card setup: the public configuration the browser mounts the provider's own fields with. */
  beginSecureCardSetup(): CardProviderClient;
  /** Exchanges the provider's one-time card token for a saved card at the provider (no charge, no authorization). */
  finalizeTokenizedCard(input: { readonly token: string; readonly email: string }): Promise<SafeProviderCard>;
  /** The bound cards that still exist at the provider. Only cards whose bindings are presented are ever returned. */
  listSavedCards(input: { readonly bindings: readonly string[] }): Promise<readonly SafeProviderCard[]>;
  /** Removes the saved-card reference at the provider. The card itself is not affected. Already-removed is success. */
  removeSavedCard(input: { readonly binding: string }): Promise<void>;
}

export const CARD_PROVIDER_PREREQUISITE = 'A PCI-DSS compliant card provider with secure tokenized card entry must be configured on the deployment '
  + '(Mercado Pago: MERCADO_PAGO_ENVIRONMENT, MERCADO_PAGO_PUBLIC_KEY and the server-only MERCADO_PAGO_ACCESS_TOKEN) before FloFi can add cards.';
export type CardProviderStatus =
  | { readonly available: false; readonly code: string; readonly prerequisite: string }
  | { readonly available: true; readonly provider: { readonly id: string; readonly name: string }; readonly client: CardProviderClient };

/** The provider this deployment is configured for, or null (Add card then fails closed). */
export function cardProvider(env: Env = process.env, fetchImpl: typeof fetch = fetch): CardProvider | null {
  const configuration = mercadoPagoConfiguration(env);
  return configuration.configured ? createMercadoPagoCardProvider(configuration, { env, fetchImpl }) : null;
}
export function cardProviderStatus(env: Env = process.env): CardProviderStatus {
  const configuration = mercadoPagoConfiguration(env);
  if (!configuration.configured) return { available: false, code: configuration.code, prerequisite: CARD_PROVIDER_PREREQUISITE };
  const provider = createMercadoPagoCardProvider(configuration, { env, fetchImpl: fetch });
  return { available: true, provider: { id: provider.id, name: provider.name }, client: provider.beginSecureCardSetup() };
}

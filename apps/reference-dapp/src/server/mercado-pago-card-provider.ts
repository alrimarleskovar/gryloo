// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Mercado Pago as FloFi's CardProvider, through its official interfaces only:
 * - browser: MercadoPago.js v2 Secure Fields (`https://sdk.mercadopago.com/js/v2`). The card number, expiry and security code
 *   are typed into iframes served from Mercado Pago's own origin and `mp.fields.createCardToken` returns a one-time card token
 *   (single use, valid 7 days). FloFi's page and server never see the card data.
 * - server: the Customers and Cards REST API on `https://api.mercadopago.com` with the server-only access token:
 *   `POST /v1/customers` (email required), `GET /v1/customers/search?email=`, `POST /v1/customers/{customer_id}/cards`
 *   (`{ token }`), `GET /v1/customers/{customer_id}/cards` and `DELETE /v1/customers/{customer_id}/cards/{id}`.
 * Saving a card is not a payment: no `/v1/payments` or Orders call exists here, so adding a card never charges it.
 *
 * Mercado Pago's saved-card response also carries the BIN (`first_six_digits`), the security-code length/location and the
 * cardholder's name and document. FloFi keeps none of them: `normalizeMercadoPagoCard` keeps only the ids, payment method,
 * brand, last four digits and expiry, and rejects any response that looks like it carries a card number or security code.
 */
import { containsCardNumber, looksLikeCardNumber } from '../domain/credentials.ts';
import { deploymentEnvironment, isHostedDeployment } from './deployment.ts';
import { openCardBinding, sealCardBinding, type CardProviderEnvironment } from './card-binding.ts';
import type { CardProvider, CardProviderClient, SafeProviderCard } from './card-provider.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const MERCADO_PAGO_API = 'https://api.mercadopago.com';
/** The MOCKED loopback provider for browser acceptance only (`GRYLOO_CARD_HARNESS`); refused on any hosted deployment. */
export const MERCADO_PAGO_HARNESS_API = 'http://127.0.0.1:8555';
export const MERCADO_PAGO_SDK = 'https://sdk.mercadopago.com/js/v2';
const PROVIDER = { id: 'mercado_pago', name: 'Mercado Pago' } as const;

export type MercadoPagoConfiguration =
  | { readonly configured: false; readonly code: string }
  | { readonly configured: true; readonly environment: CardProviderEnvironment; readonly publicKey: string; readonly accessToken: string;
    readonly apiBase: string; readonly harness: boolean };
const PUBLIC_KEY = /^(?:TEST|APP_USR)-[A-Za-z0-9-]{8,200}$/, ACCESS_TOKEN = /^(?:TEST|APP_USR)-[A-Za-z0-9-]{8,300}$/;

/**
 * Deployment configuration. `MERCADO_PAGO_ENVIRONMENT` is explicit (`test` or `production`) and must match the deployment:
 * a production deployment uses only production credentials, and previews, development and local servers use only test
 * credentials, so test cards never reach production and production cards are never saved from a preview.
 */
export function mercadoPagoConfiguration(env: Env): MercadoPagoConfiguration {
  if (env.GRYLOO_CARD_HARNESS !== undefined) {
    if (env.GRYLOO_CARD_HARNESS !== 'MOCKED_LOOPBACK_ONLY' || isHostedDeployment(env)) return { configured: false, code: 'CARD_HARNESS_FORBIDDEN' };
    return { configured: true, environment: 'test', publicKey: 'TEST-flofi-loopback-harness', accessToken: 'TEST-flofi-loopback-harness-server-only',
      apiBase: MERCADO_PAGO_HARNESS_API, harness: true };
  }
  const environment = env.MERCADO_PAGO_ENVIRONMENT, publicKey = env.MERCADO_PAGO_PUBLIC_KEY, accessToken = env.MERCADO_PAGO_ACCESS_TOKEN;
  if (!environment && !publicKey && !accessToken) return { configured: false, code: 'CARD_TOKENIZATION_PROVIDER_REQUIRED' };
  if (environment !== 'test' && environment !== 'production') return { configured: false, code: 'CARD_PROVIDER_ENVIRONMENT_INVALID' };
  if (!publicKey || !PUBLIC_KEY.test(publicKey) || !accessToken || !ACCESS_TOKEN.test(accessToken)) return { configured: false, code: 'CARD_PROVIDER_CREDENTIALS_INVALID' };
  if ((deploymentEnvironment(env) === 'production') !== (environment === 'production')) return { configured: false, code: 'CARD_PROVIDER_ENVIRONMENT_MISMATCH' };
  // Legacy `TEST-` credentials are test-only by construction.
  if (environment === 'production' && (publicKey.startsWith('TEST-') || accessToken.startsWith('TEST-'))) return { configured: false, code: 'CARD_PROVIDER_ENVIRONMENT_MISMATCH' };
  return { configured: true, environment, publicKey, accessToken, apiBase: MERCADO_PAGO_API, harness: false };
}

const CUSTOMER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/, CARD_ID = /^[0-9]{1,24}$/, PAYMENT_METHOD = /^[a-z][a-z0-9_]{1,31}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/, EMAIL = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const BRANDS: Readonly<Record<string, string>> = Object.freeze({ visa: 'visa', debvisa: 'visa', master: 'mastercard', debmaster: 'mastercard',
  amex: 'amex', elo: 'elo', debelo: 'elo', hipercard: 'hipercard', diners: 'diners', cabal: 'unknown' });
const RAW_DATA_KEY = /^(?:pan|number|card_?number|cardnumber|cvv|cvc|cvv2|cvc2|cid|csc|security_?code_?value|track[12]?|track_?data|magnetic_?stripe)$/i;
/** Values that are documents or provider ids, not free text: never Luhn-scanned (an id may be Luhn-valid by chance). */
const NOT_SCANNED = new Set(['id', 'customer_id', 'user_id', 'number']);

function fail(code: string): never { throw new Error(code); }

/** Fails closed if any field could carry raw card data: a raw-data key with a value, a primitive security code, or a card number. */
function assertNoRawCardData(value: unknown, path: readonly string[] = []): void {
  if (path.length > 8) fail('CARD_PROVIDER_RESPONSE_INVALID');
  if (typeof value === 'string' || typeof value === 'number') {
    const key = path.at(-1) ?? '';
    // A document number (`cardholder.identification.number`) is checked as a document: digits only, CPF or CNPJ length.
    if (key === 'number' && path.at(-2) === 'identification') { if (!/^\d{11}$|^\d{14}$/.test(String(value))) fail('CARD_PROVIDER_RAW_DATA'); return; }
    if (!NOT_SCANNED.has(key) && containsCardNumber(String(value))) fail('CARD_PROVIDER_RAW_DATA');
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'number' && path.at(-1) !== 'identification' && entry !== null && entry !== undefined && entry !== '') fail('CARD_PROVIDER_RAW_DATA');
    if (key !== 'number' && RAW_DATA_KEY.test(key) && entry !== null && entry !== undefined && entry !== '') fail('CARD_PROVIDER_RAW_DATA');
    // Mercado Pago describes the security code (`{ length, card_location, mode }`); a value there is a raw security code.
    if (key === 'security_code' && entry !== null && entry !== undefined && (typeof entry !== 'object' || Object.keys(entry).some(name => !['length', 'card_location', 'mode'].includes(name))))
      fail('CARD_PROVIDER_RAW_DATA');
    assertNoRawCardData(entry, [...path, key]);
  }
}

/**
 * Normalizes one Mercado Pago saved card to provider-safe metadata. Anything malformed, from another customer, in the other
 * environment (`live_mode`), or carrying raw card data fails closed.
 */
export function normalizeMercadoPagoCard(raw: unknown, expected: { readonly customerId: string; readonly environment: CardProviderEnvironment }):
  Omit<SafeProviderCard, 'binding'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('CARD_PROVIDER_RESPONSE_INVALID');
  assertNoRawCardData(raw);
  const card = raw as Record<string, unknown>, method = card.payment_method as Record<string, unknown> | undefined;
  const id = typeof card.id === 'number' && Number.isSafeInteger(card.id) ? String(card.id) : card.id;
  const last4 = typeof card.last_four_digits === 'number' && Number.isInteger(card.last_four_digits) ? String(card.last_four_digits).padStart(4, '0') : card.last_four_digits;
  if (typeof id !== 'string' || !CARD_ID.test(id) || typeof last4 !== 'string' || !/^\d{4}$/.test(last4) || looksLikeCardNumber(id, last4)
    || card.customer_id !== expected.customerId || !method || typeof method.id !== 'string' || !PAYMENT_METHOD.test(method.id)
    || !Number.isInteger(card.expiration_month) || (card.expiration_month as number) < 1 || (card.expiration_month as number) > 12
    || !Number.isInteger(card.expiration_year) || (card.expiration_year as number) < 2000 || (card.expiration_year as number) > 2100)
    fail('CARD_PROVIDER_RESPONSE_INVALID');
  if (typeof card.live_mode !== 'boolean' || card.live_mode !== (expected.environment === 'production')) fail('CARD_PROVIDER_MODE_MISMATCH');
  return { provider: PROVIDER.id, providerName: PROVIDER.name, providerCustomerId: expected.customerId, providerCardId: id as string,
    paymentMethodId: method.id as string, brand: BRANDS[method.id as string] ?? 'unknown', last4: last4 as string,
    expMonth: card.expiration_month as number, expYear: card.expiration_year as number };
}

type Request = { readonly method: 'GET' | 'POST' | 'DELETE'; readonly path: string; readonly body?: unknown };
type Response = { readonly status: number; readonly body: unknown };
/** Stable FloFi codes for Mercado Pago's documented error causes. */
function providerFailure(response: Response): never {
  const causes = (response.body as { cause?: unknown } | null)?.cause;
  const codes = Array.isArray(causes) ? causes.map(cause => String((cause as { code?: unknown })?.code ?? '')) : [];
  if (response.status === 401 || response.status === 403) fail('CARD_PROVIDER_UNAUTHORIZED');
  if (response.status === 451) fail('CARD_PROVIDER_UNAVAILABLE_FOR_EMAIL');
  if (codes.some(code => code === '106' || code === '128')) fail('CARD_EMAIL_INVALID');
  if (codes.includes('129')) fail('CARD_LIMIT_REACHED');
  if (response.status === 400) fail('CARD_REJECTED_BY_PROVIDER');
  if (response.status === 404) fail('CARD_PROVIDER_NOT_FOUND');
  return fail('CARD_PROVIDER_UNAVAILABLE');
}

export function createMercadoPagoCardProvider(configuration: Extract<MercadoPagoConfiguration, { configured: true }>,
  options: { readonly env: Env; readonly fetchImpl: typeof fetch }): CardProvider {
  const { environment } = configuration;
  async function call(request: Request): Promise<Response> {
    let response: globalThis.Response;
    try {
      response = await options.fetchImpl(`${configuration.apiBase}${request.path}`, { method: request.method, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${configuration.accessToken}`, accept: 'application/json',
          ...request.body === undefined ? {} : { 'content-type': 'application/json' } },
        ...request.body === undefined ? {} : { body: JSON.stringify(request.body) } });
    } catch { return fail('CARD_PROVIDER_UNREACHABLE'); }
    const text = await response.text().catch(() => fail('CARD_PROVIDER_UNREACHABLE'));
    if (text.length > 65_536) fail('CARD_PROVIDER_RESPONSE_INVALID');
    let body: unknown = null;
    if (text) try { body = JSON.parse(text); } catch { if (response.ok) fail('CARD_PROVIDER_RESPONSE_INVALID'); }
    return { status: response.status, body };
  }
  const bound = (binding: unknown) => openCardBinding(options.env, binding, { provider: PROVIDER.id, environment }) ?? fail('CARD_BINDING_INVALID');
  const seal = (card: Omit<SafeProviderCard, 'binding'>): SafeProviderCard => ({ ...card,
    binding: sealCardBinding(options.env, { provider: PROVIDER.id, environment, customerId: card.providerCustomerId, cardId: card.providerCardId }) });

  async function customerFor(email: string): Promise<string> {
    const created = await call({ method: 'POST', path: '/v1/customers', body: { email } });
    const causes = (created.body as { cause?: unknown } | null)?.cause;
    const exists = created.status === 400 && Array.isArray(causes) && causes.some(cause => String((cause as { code?: unknown })?.code) === '101');
    if (!exists) {
      if (created.status < 200 || created.status >= 300) providerFailure(created);
      const id = (created.body as { id?: unknown } | null)?.id;
      return typeof id === 'string' && CUSTOMER_ID.test(id) ? id : fail('CARD_PROVIDER_RESPONSE_INVALID');
    }
    // Mercado Pago keeps one customer per email: reuse it. Only cards this browser holds bindings for are ever listed or removed.
    const found = await call({ method: 'GET', path: `/v1/customers/search?email=${encodeURIComponent(email)}` });
    if (found.status !== 200) providerFailure(found);
    const results = (found.body as { results?: unknown } | null)?.results;
    const match = Array.isArray(results) ? results.find(entry => typeof entry === 'object' && entry && (entry as { email?: unknown }).email === email) as { id?: unknown } | undefined : undefined;
    return typeof match?.id === 'string' && CUSTOMER_ID.test(match.id) ? match.id : fail('CARD_PROVIDER_RESPONSE_INVALID');
  }

  return {
    id: PROVIDER.id, name: PROVIDER.name, environment,
    beginSecureCardSetup: (): CardProviderClient => ({ kind: 'mercado_pago_secure_fields', publicKey: configuration.publicKey, locale: 'pt-BR', sdkUrl: MERCADO_PAGO_SDK }),
    async finalizeTokenizedCard({ token, email }) {
      if (typeof token !== 'string' || !TOKEN.test(token) || containsCardNumber(token)) fail('CARD_TOKEN_INVALID');
      const address = typeof email === 'string' ? email.trim() : '';
      if (address.length > 254 || !EMAIL.test(address) || containsCardNumber(address)) fail('CARD_EMAIL_INVALID');
      const customerId = await customerFor(address);
      // The card token is single-use at Mercado Pago, so a repeated request cannot save the card twice.
      const saved = await call({ method: 'POST', path: `/v1/customers/${encodeURIComponent(customerId)}/cards`, body: { token } });
      if (saved.status < 200 || saved.status >= 300) providerFailure(saved);
      return seal(normalizeMercadoPagoCard(saved.body, { customerId, environment }));
    },
    async listSavedCards({ bindings }) {
      if (!Array.isArray(bindings) || bindings.length > 50) fail('CARD_BINDING_INVALID');
      const wanted = bindings.map(bound), customers = [...new Set(wanted.map(entry => entry.customerId))];
      const cards: SafeProviderCard[] = [];
      for (const customerId of customers) {
        const listed = await call({ method: 'GET', path: `/v1/customers/${encodeURIComponent(customerId)}/cards` });
        if (listed.status !== 200) providerFailure(listed);
        if (!Array.isArray(listed.body)) fail('CARD_PROVIDER_RESPONSE_INVALID');
        const ids = new Set(wanted.filter(entry => entry.customerId === customerId).map(entry => entry.cardId));
        for (const raw of listed.body) {
          const id = (raw as { id?: unknown } | null)?.id;
          if (ids.has(String(id))) cards.push(seal(normalizeMercadoPagoCard(raw, { customerId, environment })));
        }
      }
      return cards;
    },
    async removeSavedCard({ binding }) {
      const { customerId, cardId } = bound(binding);
      const removed = await call({ method: 'DELETE', path: `/v1/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}` });
      if (removed.status === 404 || (removed.status >= 200 && removed.status < 300)) return;
      providerFailure(removed);
    },
  };
}

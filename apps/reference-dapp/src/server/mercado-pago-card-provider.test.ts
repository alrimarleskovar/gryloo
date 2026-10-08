// SPDX-License-Identifier: AGPL-3.0-only
// Mercado Pago CardProvider against a fake of its documented Customers/Cards API. No network, no real credentials, no charge.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cardProvider, cardProviderStatus } from './card-provider';
import { openCardBinding } from './card-binding';
import { mercadoPagoConfiguration, normalizeMercadoPagoCard } from './mercado-pago-card-provider';

const SESSION_KEY = randomBytes(32).toString('hex');
const ENV = { FLOFI_SESSION_SECRET: SESSION_KEY, MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_PUBLIC_KEY: 'TEST-public-0000-test-key',
  MERCADO_PAGO_ACCESS_TOKEN: 'TEST-server-only-access-token-0000' };
const CUSTOMER = '470183340-cpunOI7UsIHlHr', TOKEN = '9b2d63e00d66a8c721607214ceda233a', EMAIL = 'test_payer_12345@testuser.com';
const PAN = '4235647728025682', CVV = '123';
const savedCard = (overrides: Record<string, unknown> = {}) => ({ id: '8987269652', expiration_month: 11, expiration_year: 2030, first_six_digits: '423564',
  last_four_digits: '5682', payment_method: { id: 'visa', name: 'visa', payment_type_id: 'credit_card', thumbnail: 'http://img.mlstatic.com/org-img/MP3/API/logos/visa.gif',
    secure_thumbnail: 'https://www.mercadopago.com/org-img/MP3/API/logos/visa.gif' }, security_code: { length: 3, card_location: 'back' },
  issuer: { id: 25, name: 'visa' }, cardholder: { name: 'APRO', identification: { number: '12345678909', type: 'CPF' } },
  date_created: '2026-10-08T01:00:00.000-04:00', date_last_updated: '2026-10-08T01:00:00.000-04:00', customer_id: CUSTOMER, user_id: '470183340',
  live_mode: false, ...overrides });

type Seen = { method: string; url: string; authorization: string | null; body: string | null };
function fakeApi(routes: Record<string, (body: unknown) => { status: number; body?: unknown; raw?: string }>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET', headers = new Headers(init?.headers);
    seen.push({ method, url, authorization: headers.get('authorization'), body: typeof init?.body === 'string' ? init.body : null });
    const route = routes[`${method} ${url.replace('https://api.mercadopago.com', '')}`];
    if (!route) return new Response(JSON.stringify({ message: 'not_found' }), { status: 404 });
    const result = route(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    return new Response(result.raw ?? JSON.stringify(result.body ?? null), { status: result.status });
  }) as typeof fetch;
  return { seen, fetchImpl };
}
const provider = (fetchImpl: typeof fetch, env: Record<string, string> = ENV) => cardProvider(env, fetchImpl)!;
const happy = () => fakeApi({
  'POST /v1/customers': () => ({ status: 201, body: { id: CUSTOMER, email: EMAIL } }),
  [`POST /v1/customers/${CUSTOMER}/cards`]: () => ({ status: 200, body: savedCard() }),
});

describe('Mercado Pago deployment configuration keeps test and production apart', () => {
  it.each([
    [{}, 'CARD_TOKENIZATION_PROVIDER_REQUIRED'],
    [{ ...ENV, MERCADO_PAGO_ENVIRONMENT: 'sandbox' }, 'CARD_PROVIDER_ENVIRONMENT_INVALID'],
    [{ ...ENV, MERCADO_PAGO_ACCESS_TOKEN: '' }, 'CARD_PROVIDER_CREDENTIALS_INVALID'],
    [{ ...ENV, MERCADO_PAGO_PUBLIC_KEY: 'pk_live_123' }, 'CARD_PROVIDER_CREDENTIALS_INVALID'],
    // Production credentials never run on a preview or local server, and test credentials never on production.
    [{ ...ENV, MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_PUBLIC_KEY: 'APP_USR-public-0000', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-token-0000' }, 'CARD_PROVIDER_ENVIRONMENT_MISMATCH'],
    [{ ...ENV, VERCEL: '1', VERCEL_ENV: 'production' }, 'CARD_PROVIDER_ENVIRONMENT_MISMATCH'],
    [{ ...ENV, VERCEL: '1', VERCEL_ENV: 'production', MERCADO_PAGO_ENVIRONMENT: 'production' }, 'CARD_PROVIDER_ENVIRONMENT_MISMATCH'],
    [{ GRYLOO_CARD_HARNESS: 'MOCKED_LOOPBACK_ONLY', VERCEL: '1', VERCEL_ENV: 'preview' }, 'CARD_HARNESS_FORBIDDEN'],
  ])('refuses %j with %s', (env, code) => {
    expect(mercadoPagoConfiguration(env)).toEqual({ configured: false, code });
    expect(cardProvider(env)).toBeNull();
    expect(cardProviderStatus(env)).toMatchObject({ available: false, code });
  });
  it('accepts test credentials locally and on previews, production credentials only on production', () => {
    expect(mercadoPagoConfiguration(ENV)).toMatchObject({ configured: true, environment: 'test', apiBase: 'https://api.mercadopago.com', harness: false });
    expect(mercadoPagoConfiguration({ ...ENV, VERCEL: '1', VERCEL_ENV: 'preview' })).toMatchObject({ configured: true, environment: 'test' });
    expect(mercadoPagoConfiguration({ VERCEL: '1', VERCEL_ENV: 'production', MERCADO_PAGO_ENVIRONMENT: 'production',
      MERCADO_PAGO_PUBLIC_KEY: 'APP_USR-public-0000', MERCADO_PAGO_ACCESS_TOKEN: 'APP_USR-token-0000' })).toMatchObject({ configured: true, environment: 'production' });
    expect(mercadoPagoConfiguration({ GRYLOO_CARD_HARNESS: 'MOCKED_LOOPBACK_ONLY' })).toMatchObject({ configured: true, apiBase: 'http://127.0.0.1:8555', harness: true });
  });
  it('gives the browser only the public key and the official SDK location, never the access token', () => {
    const status = cardProviderStatus(ENV);
    expect(status).toEqual({ available: true, provider: { id: 'mercado_pago', name: 'Mercado Pago' },
      client: { kind: 'mercado_pago_secure_fields', publicKey: ENV.MERCADO_PAGO_PUBLIC_KEY, locale: 'pt-BR', sdkUrl: 'https://sdk.mercadopago.com/js/v2' } });
    expect(JSON.stringify(status)).not.toContain(ENV.MERCADO_PAGO_ACCESS_TOKEN);
  });
});

describe('Add card saves a tokenized card at Mercado Pago and keeps only safe metadata', () => {
  it('creates the customer, saves the token, returns safe metadata with a sealed binding, and never charges', async () => {
    const api = happy();
    const card = await provider(api.fetchImpl).finalizeTokenizedCard({ token: TOKEN, email: EMAIL });
    expect(card).toEqual({ provider: 'mercado_pago', providerName: 'Mercado Pago', providerCustomerId: CUSTOMER, providerCardId: '8987269652',
      binding: expect.stringMatching(/^cb1\./), paymentMethodId: 'visa', brand: 'visa', last4: '5682', expMonth: 11, expYear: 2030 });
    expect(api.seen.map(request => `${request.method} ${request.url}`)).toEqual([
      'POST https://api.mercadopago.com/v1/customers', `POST https://api.mercadopago.com/v1/customers/${CUSTOMER}/cards`]);
    expect(api.seen.map(request => request.body)).toEqual([JSON.stringify({ email: EMAIL }), JSON.stringify({ token: TOKEN })]);
    expect(api.seen.every(request => request.authorization === `Bearer ${ENV.MERCADO_PAGO_ACCESS_TOKEN}`)).toBe(true);
    // No payment, order or card-token creation endpoint is ever called: adding a card is not a charge.
    expect(api.seen.some(request => /\/v1\/(?:payments|orders|card_tokens)/.test(request.url))).toBe(false);
    // Nothing FloFi keeps or returns carries the BIN, the security code description or the cardholder's document.
    expect(JSON.stringify(card)).not.toMatch(/423564|12345678909|APRO|security|first_six/);
    expect(openCardBinding(ENV, card.binding, { provider: 'mercado_pago', environment: 'test' })).toEqual({ provider: 'mercado_pago', environment: 'test',
      tenant: 'default', customerId: CUSTOMER, cardId: '8987269652' });
  });
  it('reuses the existing Mercado Pago customer for the email', async () => {
    const api = fakeApi({
      'POST /v1/customers': () => ({ status: 400, body: { message: 'the customer already exist.', cause: [{ code: '101', description: 'the customer already exist.' }] } }),
      [`GET /v1/customers/search?email=${encodeURIComponent(EMAIL)}`]: () => ({ status: 200, body: { paging: { total: 1 }, results: [{ id: CUSTOMER, email: EMAIL }] } }),
      [`POST /v1/customers/${CUSTOMER}/cards`]: () => ({ status: 200, body: savedCard() }),
    });
    await expect(provider(api.fetchImpl).finalizeTokenizedCard({ token: TOKEN, email: EMAIL })).resolves.toMatchObject({ providerCustomerId: CUSTOMER });
    expect(api.seen).toHaveLength(3);
  });
  it('refuses a card number or security code in place of the token or email before contacting Mercado Pago', async () => {
    const api = happy();
    for (const token of [PAN, `tok_${PAN}`, '4235-6477-2802-5682', 'short']) await expect(provider(api.fetchImpl).finalizeTokenizedCard({ token, email: EMAIL })).rejects.toThrow('CARD_TOKEN_INVALID');
    for (const email of [PAN, `${PAN}@testuser.com`, 'not-an-email', '']) await expect(provider(api.fetchImpl).finalizeTokenizedCard({ token: TOKEN, email })).rejects.toThrow('CARD_EMAIL_INVALID');
    expect(api.seen).toEqual([]);
  });
  it.each([
    ['a raw card number field', { card_number: PAN }, 'CARD_PROVIDER_RAW_DATA'],
    ['a raw security code value', { security_code: CVV }, 'CARD_PROVIDER_RAW_DATA'],
    ['a security code value inside its description', { security_code: { length: 3, card_location: 'back', value: CVV } }, 'CARD_PROVIDER_RAW_DATA'],
    ['a card number hidden in the cardholder name', { cardholder: { name: `APRO ${PAN}`, identification: { number: '12345678909', type: 'CPF' } } }, 'CARD_PROVIDER_RAW_DATA'],
    ['track data', { track2: ';4235647728025682=30111010000000000?' }, 'CARD_PROVIDER_RAW_DATA'],
    ['a card id shaped like this card number', { id: PAN }, 'CARD_PROVIDER_RESPONSE_INVALID'],
    ['another customer', { customer_id: '999-other' }, 'CARD_PROVIDER_RESPONSE_INVALID'],
    ['a malformed expiry', { expiration_month: 13 }, 'CARD_PROVIDER_RESPONSE_INVALID'],
    ['no last four digits', { last_four_digits: undefined }, 'CARD_PROVIDER_RESPONSE_INVALID'],
    ['a production card in test mode', { live_mode: true }, 'CARD_PROVIDER_MODE_MISMATCH'],
    ['an unstated mode', { live_mode: undefined }, 'CARD_PROVIDER_MODE_MISMATCH'],
  ])('fails closed on a provider response with %s', async (_label, overrides, code) => {
    expect(() => normalizeMercadoPagoCard(savedCard(overrides), { customerId: CUSTOMER, environment: 'test' })).toThrow(code);
    const api = fakeApi({ 'POST /v1/customers': () => ({ status: 201, body: { id: CUSTOMER } }),
      [`POST /v1/customers/${CUSTOMER}/cards`]: () => ({ status: 200, body: savedCard(overrides) }) });
    await expect(provider(api.fetchImpl).finalizeTokenizedCard({ token: TOKEN, email: EMAIL })).rejects.toThrow(code);
  });
  it('maps documented provider errors and transport failures to stable codes', async () => {
    const run = (route: () => { status: number; body?: unknown; raw?: string }) =>
      provider(fakeApi({ 'POST /v1/customers': () => ({ status: 201, body: { id: CUSTOMER } }), [`POST /v1/customers/${CUSTOMER}/cards`]: route }).fetchImpl)
        .finalizeTokenizedCard({ token: TOKEN, email: EMAIL });
    await expect(run(() => ({ status: 401, body: { message: 'unauthorized' } }))).rejects.toThrow('CARD_PROVIDER_UNAUTHORIZED');
    await expect(run(() => ({ status: 400, body: { cause: [{ code: 129 }] } }))).rejects.toThrow('CARD_LIMIT_REACHED');
    await expect(run(() => ({ status: 400, body: { cause: [{ code: '121' }] } }))).rejects.toThrow('CARD_REJECTED_BY_PROVIDER');
    await expect(run(() => ({ status: 200, raw: '{not json' }))).rejects.toThrow('CARD_PROVIDER_RESPONSE_INVALID');
    await expect(run(() => ({ status: 200, body: [] }))).rejects.toThrow('CARD_PROVIDER_RESPONSE_INVALID');
    const offline = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(provider(offline).finalizeTokenizedCard({ token: TOKEN, email: EMAIL })).rejects.toThrow('CARD_PROVIDER_UNREACHABLE');
  });
});

describe('saved-card bindings scope listing and removal to the browser that added the card', () => {
  async function added() {
    const api = happy();
    return provider(api.fetchImpl).finalizeTokenizedCard({ token: TOKEN, email: EMAIL });
  }
  it('removes only the bound saved-card reference at Mercado Pago, treating already-removed as done', async () => {
    const card = await added();
    for (const status of [200, 404]) {
      const api = fakeApi({ [`DELETE /v1/customers/${CUSTOMER}/cards/8987269652`]: () => ({ status, body: savedCard() }) });
      await expect(provider(api.fetchImpl).removeSavedCard({ binding: card.binding })).resolves.toBeUndefined();
      expect(api.seen.map(request => `${request.method} ${request.url}`)).toEqual([`DELETE https://api.mercadopago.com/v1/customers/${CUSTOMER}/cards/8987269652`]);
    }
    const failing = fakeApi({ [`DELETE /v1/customers/${CUSTOMER}/cards/8987269652`]: () => ({ status: 503 }) });
    await expect(provider(failing.fetchImpl).removeSavedCard({ binding: card.binding })).rejects.toThrow('CARD_PROVIDER_UNAVAILABLE');
  });
  it('refuses tampered bindings and bindings from another environment or deployment without calling Mercado Pago', async () => {
    const card = await added(), api = happy();
    const [prefix, body, mac] = card.binding.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), c: 'someone-else' })).toString('base64url');
    for (const binding of [`${prefix}.${forged}.${mac}`, `${card.binding}x`, 'cb1.x.y', 'not a binding'])
      await expect(provider(api.fetchImpl).removeSavedCard({ binding })).rejects.toThrow('CARD_BINDING_INVALID');
    // Another Vercel Preview branch is another tenant; another secret is another deployment.
    await expect(provider(api.fetchImpl, { ...ENV, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'other' }).removeSavedCard({ binding: card.binding }))
      .rejects.toThrow('CARD_BINDING_INVALID');
    await expect(provider(api.fetchImpl, { ...ENV, FLOFI_SESSION_SECRET: randomBytes(32).toString('hex') }).removeSavedCard({ binding: card.binding })).rejects.toThrow('CARD_BINDING_INVALID');
    expect(openCardBinding(ENV, card.binding, { provider: 'mercado_pago', environment: 'production' })).toBeNull();
    expect(api.seen).toEqual([]);
  });
  it('lists only the cards whose bindings are presented, even when the customer has others', async () => {
    const card = await added();
    const api = fakeApi({ [`GET /v1/customers/${CUSTOMER}/cards`]: () => ({ status: 200,
      body: [savedCard(), savedCard({ id: '1111111111', last_four_digits: '3311', payment_method: { id: 'master' } })] }) });
    const listed = await provider(api.fetchImpl).listSavedCards({ bindings: [card.binding] });
    expect(listed.map(entry => [entry.providerCardId, entry.last4])).toEqual([['8987269652', '5682']]);
  });
});

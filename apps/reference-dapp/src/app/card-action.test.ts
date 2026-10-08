// SPDX-License-Identifier: AGPL-3.0-only
// The Add card server action is the only FloFi server boundary card entry crosses: it takes the provider's one-time token and
// the email, and nothing else. Fake provider endpoint and published test-card digits only: no network, no card, no charge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addProviderCard } from './card-action';

const PAN = '4235647728025682', TOKEN = 'ff8080814c11e237014c1ff593b57b4d', EMAIL = 'test_payer_12345@testuser.com';
let calls: { url: string; body: unknown; authorization: string | null }[];
beforeEach(() => {
  calls = [];
  for (const [name, value] of Object.entries({ MERCADO_PAGO_ENVIRONMENT: 'test', MERCADO_PAGO_PUBLIC_KEY: 'TEST-public-0123456789',
    MERCADO_PAGO_ACCESS_TOKEN: 'TEST-access-0123456789', GRYLOO_CARD_HARNESS: undefined, VERCEL: undefined, VERCEL_ENV: undefined })) vi.stubEnv(name, value);
  vi.stubGlobal('fetch', (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null, authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 });
  }) as typeof fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Add card server action', () => {
  it('refuses any card data before contacting the provider', async () => {
    for (const extra of [{ cardNumber: PAN }, { securityCode: '123' }, { expirationDate: '11/30' }, { cardholderName: 'APRO' }, { pan: PAN }])
      expect(await addProviderCard({ token: TOKEN, email: EMAIL, ...extra } as unknown as { token: string; email: string })).toEqual({ ok: false, code: 'CARD_INPUT_INVALID' });
    // A card number presented as the "token" is refused too.
    expect(await addProviderCard({ token: PAN, email: EMAIL })).toEqual({ ok: false, code: 'CARD_TOKEN_INVALID' });
    expect(calls).toEqual([]);
  });

  it('sends the provider only the email and then the token, with the server-side credential', async () => {
    await addProviderCard({ token: TOKEN, email: EMAIL });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe('https://api.mercadopago.com');
      expect(call.authorization).toBe('Bearer TEST-access-0123456789');
      expect(call.body === null || ['email', 'token'].includes(Object.keys(call.body as object).join(','))).toBe(true);
      expect(JSON.stringify(call.body)).not.toContain(PAN);
    }
  });

  it('fails clearly without a configured provider', async () => {
    vi.stubEnv('MERCADO_PAGO_ENVIRONMENT', undefined); vi.stubEnv('MERCADO_PAGO_PUBLIC_KEY', undefined); vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', undefined);
    expect(await addProviderCard({ token: TOKEN, email: EMAIL })).toEqual({ ok: false, code: 'CARD_TOKENIZATION_PROVIDER_REQUIRED' });
    expect(calls).toEqual([]);
  });
});

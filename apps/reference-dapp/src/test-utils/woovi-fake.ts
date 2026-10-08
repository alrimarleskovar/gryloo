// SPDX-License-Identifier: AGPL-3.0-only
// A fake of Woovi's published Stablecoin payout API for isolated server tests. No network, no credentials, no money moves.
import type { PaymentDraftRequest } from '@defi-workflow-engine/workflow-contracts';
import type { PaymentAdapter } from '../server/payment-adapter';
import { createWooviPixPaymentAdapter } from '../server/woovi-pix-adapter';

export const NOW = 1_791_460_800; // 2026-10-08T12:00:00Z
export const APP_ID = 'Q2xpZW50X0lkX3Rlc3Q6Q2xpZW50X1NlY3JldF90ZXN0';
export const ENV = { WOOVI_APP_ID: APP_ID, WOOVI_ENVIRONMENT: 'sandbox' };
export const USDC_BASE = { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 };
export const OWNER = { chainId: 'eip155:8453', address: '0x1111111111111111111111111111111111111111' };
export const DEPOSIT = '0x2222222222222222222222222222222222222222';
export const PIX_KEY = 'pagamentos@example.com', OTHER_KEY = 'outra@example.com';
export const BR_CODE = '00020101021126460014br.gov.bcb.pix0111529982247250209Pedido 425204000053039865406742.315802BR5912Loja Exemplo6009SAO PAULO62120508PEDIDO426304E574';
export const QUOTE = { status: 'ok', quote: { basePrice: 5.4, inputAmount: 18.518519, inputCurrency: 'USDC', outputAmount: 100, outputCurrency: 'BRL', wooviFee: 0.5,
  providerFee: 0.5, fee: 1, appliedFees: [{ type: 'Out Fee', amount: 0.5, currency: 'BRL' }], pairName: 'USDCBRL' } };

export const request = (overrides: Partial<PaymentDraftRequest> = {}): PaymentDraftRequest => ({ channel: 'WHATSAPP', rail: 'PIX', destination: PIX_KEY, pixDestination: 'PIX_KEY',
  ownerAmountCents: '10000', sourceAsset: USDC_BASE, maxSourceAmount: '25000000', maxFeeCents: '300', maxSlippageBps: 50,
  provider: { id: 'woovi', version: '1.0.0' }, expiresAt: NOW + 600, ...overrides });

type Payout = Record<string, unknown>;
/** A fake of the documented endpoints, with the state machine Woovi describes (PENDING → PROCESSING → COMPLETED | FAILED). */
export function fakeWoovi(options: { quote?: unknown; quoteStatus?: number; wallets?: unknown; createStatus?: number; offline?: boolean } = {}) {
  const seen: { method: string; path: string; authorization: string | null; body: unknown }[] = [];
  const payouts = new Map<string, Payout>();
  let approvals = 0;
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    if (options.offline) throw new TypeError('fetch failed');
    const url = new URL(String(input)), method = init?.method ?? 'GET', body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    seen.push({ method, path: `${url.origin}${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get('authorization'), body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
    const route = `${method} ${url.pathname}`;
    if (route === 'GET /api/v1/stablecoin/wallets') return json(200, options.wallets ?? { status: 'ok', companyBankAccountId: 'cba-1', subAccountId: 'sub-1',
      wallets: [{ address: DEPOSIT, currency: 'USDC', network: 'BASE' }, { address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', currency: 'USDT', network: 'TRON' }] });
    if (route === 'GET /api/v1/stablecoin/payout/quote') return json(options.quoteStatus ?? 200, options.quote ?? QUOTE);
    if (route === 'POST /api/v1/stablecoin/payout') {
      if (options.createStatus) return json(options.createStatus, { error: 'Pix key not found' });
      const existing = payouts.get(body.correlationId);
      const payout = existing ?? { status: 'PENDING', payoutId: '6a721b1e3c785acfaebfa01c', correlationId: body.correlationId, pixKey: body.pixKey, isRefunded: false,
        createdAt: '2026-10-08T12:00:01.000Z', updatedAt: '2026-10-08T12:00:01.000Z',
        quote: { inputAmount: 18.518519, inputCurrency: body.currency, outputAmount: body.value / 100, outputCurrency: 'BRL', rate: 5.4, fee: 1 } };
      payouts.set(body.correlationId, payout);
      return json(200, { ...payout, pixKeyOwner: { name: 'Fulano de Tal', taxId: '***.456.789-**', bankName: 'Banco Teste' } });
    }
    if (route === 'POST /api/v1/stablecoin/payout/approve') {
      const payout = payouts.get(body.correlationId);
      if (!payout || payout.status !== 'PENDING') return json(400, { error: 'Payout not PENDING' });
      approvals += 1; payout.status = 'PROCESSING';
      return json(200, { status: 'PROCESSING', correlationId: body.correlationId, payoutId: payout.payoutId });
    }
    if (route === 'GET /api/v1/stablecoin/payout') {
      const payout = payouts.get(url.searchParams.get('correlationId') ?? '');
      return payout ? json(200, payout) : json(404, { error: 'not found' });
    }
    return json(404, { error: 'unknown route' });
  }) as typeof fetch;
  const adapter = createWooviPixPaymentAdapter({ configured: true, environment: 'sandbox', appId: APP_ID, apiBase: 'https://api.woovi-sandbox.com' },
    { fetchImpl, now: () => NOW });
  return { seen, payouts, approvals: () => approvals, fetch: fetchImpl, adapter, adapters: new Map<string, PaymentAdapter>([[adapter.id, adapter]]) };
}

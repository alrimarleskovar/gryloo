// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { readPaymentNode, type PaymentDraftRequest } from '@defi-workflow-engine/workflow-contracts';
import * as service from './payment-service';
import { paymentAdapters, paymentProviderStatuses, PIXBLOCK_STATUS, type PaymentAdapter } from './payment-adapter';

const PIX = '00020101021126460014br.gov.bcb.pix0111529982247250209Pedido 425204000053039865406742.315802BR5912Loja Exemplo6009SAO PAULO62120508PEDIDO426304E574';
const NOW = new Date('2026-10-07T12:00:00.000Z'), SECONDS = Math.floor(NOW.getTime() / 1000);
const USDC_BASE = { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 };
const OWNER = { chainId: 'eip155:8453', address: '0x1111111111111111111111111111111111111111' };
const request = (overrides: Partial<PaymentDraftRequest> = {}): PaymentDraftRequest => ({ channel: 'WHATSAPP', rail: 'PIX', destination: PIX, sourceAsset: USDC_BASE,
  maxSourceAmount: '140000000', maxFeeCents: '1500', maxSlippageBps: 50, provider: { id: 'payments.test', version: '1.0.0' }, expiresAt: SECONDS + 600, ...overrides });
function adapter(quote: Partial<Awaited<ReturnType<PaymentAdapter['quote']>>> = {}) {
  const value: PaymentAdapter = { id: 'payments.test', version: '1.0.0', name: 'Test provider', rails: ['PIX', 'BOLETO'],
    supportedSources: () => [{ chainId: 'eip155:8453', asset: USDC_BASE }],
    resolveDestination: vi.fn(), status: vi.fn(), initiate: vi.fn(),
    quote: vi.fn(async () => ({ providerQuoteId: 'q-1', amountCents: '74231', feeCents: '900', sourceAmount: '135000000', expiresAt: SECONDS + 300, ...quote })) };
  return { value, adapters: new Map([[value.id, value]]) };
}

describe('payment engine facade for every channel', () => {
  it('fails closed without a configured provider and never claims PixBlock is connected', async () => {
    expect(paymentAdapters().size).toBe(0);
    expect(paymentProviderStatuses()).toEqual([PIXBLOCK_STATUS]);
    expect(PIXBLOCK_STATUS).toMatchObject({ available: false, code: 'PIXBLOCK_PAYOUT_API_UNAVAILABLE' });
    const prepared = await service.preparePayment('pay-1', request(), OWNER, { now: NOW });
    expect(prepared).toMatchObject({ status: 'PROVIDER_UNAVAILABLE', code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', next: 'NONE', authorizes: false, draft: { state: 'DRAFT', authorizes: false } });
    expect(await service.preparePayment('pay-1', request({ provider: { id: 'pixblock', version: '1.0.0' } }), OWNER, { now: NOW }))
      .toMatchObject({ status: 'PROVIDER_UNAVAILABLE', code: 'PIXBLOCK_PAYOUT_API_UNAVAILABLE' });
    expect(service.paymentChannelSummary(prepared)).toMatch(/provider unavailable[\s\S]*Nothing has been paid or authorized\.$/);
  });
  it('quotes through the adapter named by the canonical node and ends at a FloFi Review handoff', async () => {
    const { value, adapters } = adapter();
    const prepared = await service.preparePayment('pay-1', request(), OWNER, { now: NOW, adapters });
    expect(prepared).toMatchObject({ status: 'QUOTED', next: 'REVIEW_IN_FLOFI', authorizes: false });
    expect(value.quote).toHaveBeenCalledExactlyOnceWith({ facts: expect.objectContaining({ amountCents: '74231', settlementCurrency: 'BRL', owner: OWNER }) });
    expect(value.initiate).not.toHaveBeenCalled();
    const summary = service.paymentChannelSummary(prepared);
    expect(summary).toContain('Amount: R$ 742,31');
    expect(summary).toContain('Recipient: Loja Exemplo (CPF 529•••25)');
    expect(summary).not.toContain('52998224725');
    expect(summary.split('\n').at(-1)).toBe('Review and approve in FloFi with your own wallet. Nothing has been paid or authorized.');
  });
  it('refuses provider quotes outside the drafted bounds instead of adopting them', async () => {
    for (const [quote, code] of [[{ amountCents: '74000' }, 'PAYMENT_QUOTE_AMOUNT_MISMATCH'], [{ feeCents: '1501' }, 'PAYMENT_QUOTE_FEE_ABOVE_LIMIT'],
      [{ sourceAmount: '140000001' }, 'PAYMENT_QUOTE_SOURCE_ABOVE_LIMIT'], [{ expiresAt: SECONDS + 601 }, 'PAYMENT_QUOTE_OUTLIVES_INSTRUCTION']] as const)
      await expect(service.preparePayment('pay-1', request(), OWNER, { now: NOW, adapters: adapter(quote).adapters })).rejects.toThrow(code);
    await expect(service.preparePayment('pay-1', request({ sourceAsset: { ...USDC_BASE, chainId: 'eip155:84532' } }), OWNER, { now: NOW, adapters: adapter().adapters }))
      .rejects.toThrow('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
  });
  it('rejects malformed destinations before any provider is contacted', async () => {
    const { value, adapters } = adapter();
    await expect(service.preparePayment('pay-1', request({ destination: PIX.slice(0, -1) + '0' }), OWNER, { now: NOW, adapters })).rejects.toThrow('PIX_CRC_MISMATCH');
    await expect(service.preparePayment('pay-1', request({ rail: 'BOLETO', destination: '1234' }), OWNER, { now: NOW, adapters })).rejects.toThrow('BOLETO_LENGTH_INVALID');
    expect(value.quote).not.toHaveBeenCalled();
  });
  it('gives channels no authorize, sign, initiate or execute entry point', async () => {
    expect(Object.keys(service).sort()).toEqual(['paymentChannelSummary', 'preparePayment']);
    const { value, adapters } = adapter();
    const prepared = await service.preparePayment('pay-1', request({ channel: 'MCP' }), OWNER, { now: NOW, adapters });
    expect(prepared.draft).toMatchObject({ channel: 'MCP', state: 'DRAFT', authorizes: false });
    expect(readPaymentNode(prepared.draft.node).provider).toEqual({ id: 'payments.test', version: '1.0.0' });
    expect(value.initiate).not.toHaveBeenCalled(); expect(value.status).not.toHaveBeenCalled();
  });
});

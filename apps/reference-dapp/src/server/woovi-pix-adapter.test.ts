// SPDX-License-Identifier: AGPL-3.0-only
// Woovi Pix PaymentAdapter against a fake of its published Stablecoin payout API. No network, no credentials, no money moves.
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorPaymentDraft, paymentManifestFacts, type PaymentDestinationSummary, type PaymentDraftRequest, type PaymentManifestFacts } from '@defi-workflow-engine/workflow-contracts';
import { paymentAdapters, paymentProviderStatuses, type ReviewedPaymentAuthorization, type SourceConfirmation } from './payment-adapter';
import { initiatePayment, reconcilePayment, submitPayment } from './payment-execution';
import { preparePayment } from './payment-service';
import { readWooviPayout, verifyWooviWebhook, wooviConfiguration, wooviProgress, wooviUnits, wooviWebhookCorrelationId,
  type WooviPayout } from './woovi-pix-adapter';
import { APP_ID, BR_CODE, DEPOSIT, ENV, fakeWoovi, NOW, OTHER_KEY, OWNER, PIX_KEY, QUOTE, request, USDC_BASE } from '../test-utils/woovi-fake';

const draftOf = (overrides: Partial<PaymentDraftRequest> = {}) => authorPaymentDraft('pay-1', request(overrides), new Date(NOW * 1000));
const factsOf = (overrides: Partial<PaymentDraftRequest> = {}): PaymentManifestFacts => paymentManifestFacts(draftOf(overrides).node, OWNER);

const destinationOf = (key = PIX_KEY): PaymentDestinationSummary => draftOf({ destination: key }).destination;
async function reviewed(woovi: ReturnType<typeof fakeWoovi>, overrides: Partial<PaymentDraftRequest> = {}) {
  const prepared = await preparePayment('pay-1', request(overrides), OWNER, { now: new Date(NOW * 1000), adapters: woovi.adapters });
  if (prepared.status !== 'QUOTED') throw new Error(prepared.code);
  const facts = paymentManifestFacts(prepared.draft.node, OWNER);
  // Constructed here only to stand for the owner accepting the Strategy Manifest in FloFi's Review.
  const authorization: ReviewedPaymentAuthorization = { origin: 'FLOFI_REVIEW', manifestHash: `0x${'ab'.repeat(32)}`, facts, quote: prepared.quote, acceptedAt: NOW };
  return { prepared, facts, authorization, destination: prepared.draft.destination };
}
const confirmation = (amount: string, overrides: Partial<SourceConfirmation> = {}): SourceConfirmation => ({ chainId: 'eip155:8453',
  transactionHash: `0x${'cd'.repeat(32)}`, from: OWNER.address, to: DEPOSIT, asset: USDC_BASE, amount, confirmations: 2, ...overrides });

describe('Woovi configuration separates sandbox and production', () => {
  it.each([
    [{}, 'PAYMENT_PROVIDER_NOT_CONFIGURED'],
    [{ WOOVI_APP_ID: APP_ID }, 'WOOVI_ENVIRONMENT_INVALID'],
    [{ ...ENV, WOOVI_APP_ID: 'short' }, 'WOOVI_APP_ID_INVALID'],
    [{ ...ENV, WOOVI_ENVIRONMENT: 'production' }, 'WOOVI_ENVIRONMENT_MISMATCH'],
    [{ ...ENV, VERCEL: '1', VERCEL_ENV: 'production' }, 'WOOVI_ENVIRONMENT_MISMATCH'],
  ])('refuses %j with %s and registers no adapter', (env, code) => {
    expect(wooviConfiguration(env)).toEqual({ configured: false, code });
    expect(paymentAdapters(env).has('woovi')).toBe(false);
    // An unconfigured Woovi is never reported as connected.
    expect(paymentProviderStatuses(env).find(status => status.id === 'woovi')).toMatchObject({ available: false, code });
  });
  it('uses the sandbox API off production and the production API only on a production deployment', () => {
    expect(wooviConfiguration(ENV)).toEqual({ configured: true, environment: 'sandbox', appId: APP_ID, apiBase: 'https://api.woovi-sandbox.com' });
    expect(wooviConfiguration({ ...ENV, VERCEL: '1', VERCEL_ENV: 'preview' })).toMatchObject({ configured: true, apiBase: 'https://api.woovi-sandbox.com' });
    expect(wooviConfiguration({ WOOVI_APP_ID: APP_ID, WOOVI_ENVIRONMENT: 'production', VERCEL: '1', VERCEL_ENV: 'production' }))
      .toMatchObject({ configured: true, apiBase: 'https://api.woovi.com' });
    expect(paymentAdapters(ENV).get('woovi')).toMatchObject({ id: 'woovi', version: '1.0.0', rails: ['PIX'], destinationKinds: ['PIX_KEY'] });
    expect(paymentProviderStatuses(ENV).find(status => status.id === 'woovi')).toMatchObject({ available: true });
  });
});

describe('Woovi quote and source discovery', () => {
  it('maps the official payout quote exactly and conservatively, server-side only', async () => {
    const woovi = fakeWoovi();
    const { prepared } = await reviewed(woovi);
    expect(prepared).toMatchObject({ status: 'QUOTED', next: 'REVIEW_IN_FLOFI', authorizes: false,
      quote: { amountCents: '10000', feeCents: '100', sourceAmount: '18518519', expiresAt: NOW + 60, providerQuoteId: expect.stringMatching(/^woovi:[0-9a-f]{32}$/) } });
    expect(woovi.seen.map(entry => `${entry.method} ${entry.path}`)).toEqual(['GET https://api.woovi-sandbox.com/api/v1/stablecoin/wallets',
      'GET https://api.woovi-sandbox.com/api/v1/stablecoin/payout/quote?value=10000&currency=USDC']);
    expect(woovi.seen.every(entry => entry.authorization === APP_ID)).toBe(true);
  });
  it.each([
    ['no quote object', { status: 'ok' }, 'WOOVI_RESPONSE_INVALID'],
    ['another currency', { quote: { ...QUOTE.quote, inputCurrency: 'USDT' } }, 'WOOVI_RESPONSE_INVALID'],
    ['another BRL amount', { quote: { ...QUOTE.quote, outputAmount: 99.99 } }, 'PAYMENT_QUOTE_AMOUNT_MISMATCH'],
    ['an unpriced Woovi fee', { quote: { ...QUOTE.quote, wooviFee: null } }, 'WOOVI_FEE_UNPRICED'],
    ['an inconsistent fee total', { quote: { ...QUOTE.quote, fee: 0.2 } }, 'WOOVI_RESPONSE_INVALID'],
    ['a string amount', { quote: { ...QUOTE.quote, inputAmount: '18.5' } }, 'WOOVI_RESPONSE_INVALID'],
    ['a zero source amount', { quote: { ...QUOTE.quote, inputAmount: 0 } }, 'WOOVI_RESPONSE_INVALID'],
    ['an exponent amount', { quote: { ...QUOTE.quote, inputAmount: 1e-7 } }, 'WOOVI_RESPONSE_INVALID'],
  ])('fails closed on a malformed quote: %s', async (_label, quote, code) => {
    await expect(reviewed(fakeWoovi({ quote }))).rejects.toThrow(code);
  });
  it('fails closed when Woovi refuses or cannot quote', async () => {
    await expect(reviewed(fakeWoovi({ quoteStatus: 401 }))).rejects.toThrow('WOOVI_UNAUTHORIZED');
    await expect(reviewed(fakeWoovi({ quoteStatus: 502 }))).rejects.toThrow('WOOVI_UNAVAILABLE');
    await expect(reviewed(fakeWoovi({ offline: true }))).rejects.toThrow('WOOVI_UNREACHABLE');
  });
  it('takes only the sources the Woovi account lists and FloFi can verify, and only Pix keys', async () => {
    expect(await fakeWoovi().adapter.supportedSources()).toEqual([{ chainId: 'eip155:8453', asset: USDC_BASE }]);
    expect(await fakeWoovi({ wallets: { status: 'ok', wallets: [{ address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', currency: 'USDT', network: 'TRON' }] } })
      .adapter.supportedSources()).toEqual([]);
    const woovi = fakeWoovi();
    await expect(reviewed(woovi, { sourceAsset: { ...USDC_BASE, chainId: 'eip155:84532' } })).rejects.toThrow('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
    await expect(reviewed(woovi, { sourceAsset: { chainId: 'eip155:42161', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', decimals: 6 } }))
      .rejects.toThrow('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
    // Woovi's payout API takes a Pix key; it has no BR Code (Copia e Cola) input, so a code is refused rather than reinterpreted.
    await expect(reviewed(woovi, { destination: BR_CODE, pixDestination: 'PIX_CODE', ownerAmountCents: '74231' })).rejects.toThrow('PAYMENT_DESTINATION_UNSUPPORTED_BY_PROVIDER');
    expect(woovi.seen.some(entry => entry.path.includes('/payout/quote'))).toBe(false);
  });
  it('rejects an invalid Pix destination before contacting Woovi', async () => {
    const woovi = fakeWoovi();
    for (const destination of ['123.456.789-00', '11999998888', 'not a key', '']) await expect(reviewed(woovi, { destination })).rejects.toThrow('PIX_KEY_INVALID');
    expect(woovi.seen).toEqual([]);
  });
});

describe('reviewed execution: authorization, invalidation and the owner-signed source', () => {
  it('instructs only the owner-signed transfer, and pays out once after on-chain confirmation, idempotently', async () => {
    const woovi = fakeWoovi();
    const { facts, authorization, destination } = await reviewed(woovi);
    woovi.seen.length = 0;
    const order = await initiatePayment({ authorization, current: facts, destination, adapters: woovi.adapters, now: NOW + 5 });
    expect(order).toEqual({ providerOrderId: expect.stringMatching(/^flofi-[0-9a-f]{48}$/),
      sourceTransfer: { chainId: 'eip155:8453', to: DEPOSIT, asset: USDC_BASE, amount: '18518519' } });
    // Instructions move nothing: only the deposit addresses were read.
    expect(woovi.seen.map(entry => entry.method)).toEqual(['GET']);
    const source = confirmation(order.sourceTransfer.amount);
    const first = await submitPayment({ authorization, current: facts, destination, order, source, adapters: woovi.adapters, now: NOW + 30, previous: 'SOURCE_CONFIRMED' });
    expect(first).toMatchObject({ state: 'PAYMENT_PENDING', code: null, evidence: { providerOrderId: order.providerOrderId, railStatus: 'PENDING', railReference: null,
      settledAmountCents: null, reconciliation: 'PENDING', sourceTransaction: { chainId: 'eip155:8453', hash: source.transactionHash, confirmations: 2 } } });
    const created = woovi.seen.find(entry => entry.method === 'POST' && entry.path.endsWith('/api/v1/stablecoin/payout'));
    expect(created?.body).toEqual({ value: 10000, currency: 'USDC', pixKey: PIX_KEY, correlationId: order.providerOrderId });
    // A repeated submit (retry, double click, second tab) observes; it never creates or approves again.
    const second = await submitPayment({ authorization, current: facts, destination, order, source, adapters: woovi.adapters, now: NOW + 31, previous: 'PAYMENT_PENDING' as never })
      .catch(cause => cause as Error);
    expect(second).toBeInstanceOf(Error);
    const retried = await submitPayment({ authorization, current: facts, destination, order, source, adapters: woovi.adapters, now: NOW + 31, previous: 'UNKNOWN' });
    expect(retried.state).toBe('PAYMENT_PENDING');
    expect(woovi.approvals()).toBe(1);
    expect(woovi.seen.filter(entry => entry.method === 'POST' && entry.path.endsWith('/payout')).length).toBe(1);
    // Settlement only with Woovi's Pix end-to-end id for the exact amount.
    Object.assign(woovi.payouts.get(order.providerOrderId)!, { status: 'COMPLETED', endToEndId: 'E18236120202610081200s0123456789' });
    const settled = await reconcilePayment({ current: facts, providerOrderId: order.providerOrderId, source, adapters: woovi.adapters, now: NOW + 90, previous: 'PAYMENT_PENDING' });
    expect(settled).toEqual({ state: 'PAYMENT_SETTLED', code: null, evidence: { providerOrderId: order.providerOrderId,
      sourceTransaction: { chainId: 'eip155:8453', hash: source.transactionHash, confirmations: 2 }, railStatus: 'SETTLED',
      railReference: 'E18236120202610081200s0123456789', settledAmountCents: '10000', feesCents: null, observedAt: new Date((NOW + 90) * 1000).toISOString(),
      reconciliation: 'RECONCILED' } });
  });
  it('invalidates the authorization when the recipient, amount, provider, source or limits change', async () => {
    const woovi = fakeWoovi();
    const { facts, authorization, destination } = await reviewed(woovi);
    const run = (current: PaymentManifestFacts, target = destination) => initiatePayment({ authorization, current, destination: target, adapters: woovi.adapters, now: NOW + 5 });
    await expect(run(factsOf({ destination: OTHER_KEY }), destinationOf(OTHER_KEY))).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_DESTINATIONCOMMITMENT');
    await expect(run(factsOf({ ownerAmountCents: '10001' }))).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_AMOUNTCENTS');
    await expect(run(factsOf({ provider: { id: 'woovi', version: '1.0.1' } }))).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_PROVIDER');
    await expect(run(factsOf({ sourceAsset: { ...USDC_BASE, chainId: 'eip155:84532' } }))).rejects.toThrow(/PAYMENT_AUTHORIZATION_INVALIDATED_.*SOURCE/);
    await expect(run(factsOf({ maxSourceAmount: '30000000' }))).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_MAXSOURCEAMOUNT');
    await expect(run(factsOf({ maxFeeCents: '301' }))).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_MAXFEECENTS');
    await expect(run({ ...facts, owner: { ...facts.owner, address: '0x3333333333333333333333333333333333333333' } })).rejects.toThrow('PAYMENT_AUTHORIZATION_INVALIDATED_OWNER');
    // Same facts, but a different key handed to the provider: the commitment does not match.
    await expect(run(facts, destinationOf(OTHER_KEY))).rejects.toThrow('PAYMENT_DESTINATION_MISMATCH');
    // The reviewed quote must still bound the payment.
    await expect(initiatePayment({ authorization: { ...authorization, quote: { ...authorization.quote, sourceAmount: '25000001' } }, current: facts, destination,
      adapters: woovi.adapters, now: NOW + 5 })).rejects.toThrow('PAYMENT_QUOTE_SOURCE_ABOVE_LIMIT');
    expect(woovi.seen.some(entry => entry.method === 'POST')).toBe(false);
  });
  it('refuses an expired quote or instruction', async () => {
    const woovi = fakeWoovi();
    const { facts, authorization, destination } = await reviewed(woovi);
    await expect(initiatePayment({ authorization, current: facts, destination, adapters: woovi.adapters, now: NOW + 60 })).rejects.toThrow('PAYMENT_QUOTE_EXPIRED');
    await expect(initiatePayment({ authorization, current: facts, destination, adapters: woovi.adapters, now: NOW + 600 })).rejects.toThrow('PAYMENT_EXPIRED');
  });
  it('gives a channel no way to authorize: only a FloFi Review authorization and the owner-signed transfer reach the provider', async () => {
    const woovi = fakeWoovi();
    const { facts, authorization, destination, prepared } = await reviewed(woovi);
    expect(prepared.authorizes).toBe(false);
    for (const forged of [{ ...authorization, origin: 'MCP' }, { ...authorization, origin: 'WHATSAPP' }, { ...prepared, facts }, { ...authorization, manifestHash: 'approved' }])
      await expect(initiatePayment({ authorization: forged as never, current: facts, destination, adapters: woovi.adapters, now: NOW + 5 })).rejects.toThrow('PAYMENT_AUTHORIZATION_REQUIRED');
    const order = await initiatePayment({ authorization, current: facts, destination, adapters: woovi.adapters, now: NOW + 5 });
    const submit = (source: SourceConfirmation) => submitPayment({ authorization, current: facts, destination, order, source, adapters: woovi.adapters, now: NOW + 30, previous: 'SOURCE_CONFIRMED' });
    for (const source of [confirmation('18518519', { from: '0x4444444444444444444444444444444444444444' }), confirmation('18518518'),
      confirmation('18518519', { to: '0x5555555555555555555555555555555555555555' }), confirmation('18518519', { confirmations: 0 }),
      confirmation('18518519', { chainId: 'eip155:84532' })])
      await expect(submit(source)).rejects.toThrow('PAYMENT_SOURCE_NOT_AS_INSTRUCTED');
    expect(woovi.seen.some(entry => entry.method === 'POST')).toBe(false);
  });
  it('never pays out above what the owner sent and reports funds held by the provider as recovery, not failure', async () => {
    const pricier = fakeWoovi({ quote: { quote: { ...QUOTE.quote, inputAmount: 18.6 } } });
    const reviewedPayment = await reviewed(fakeWoovi());
    const order = await initiatePayment({ ...reviewedPayment, current: reviewedPayment.facts, adapters: pricier.adapters, now: NOW + 5 });
    const above = await submitPayment({ ...reviewedPayment, current: reviewedPayment.facts, order, source: confirmation(order.sourceTransfer.amount),
      adapters: pricier.adapters, now: NOW + 30, previous: 'SOURCE_CONFIRMED' });
    expect(above).toMatchObject({ state: 'RECOVERY_REQUIRED', code: 'PAYMENT_PROVIDER_REQUOTE_ABOVE_SOURCE', evidence: { railStatus: 'NOT_STARTED', reconciliation: 'DIVERGENT' } });
    expect(pricier.seen.some(entry => entry.method === 'POST')).toBe(false);
    const refused = fakeWoovi({ createStatus: 400 });
    const refusedOrder = await initiatePayment({ ...reviewedPayment, current: reviewedPayment.facts, adapters: refused.adapters, now: NOW + 5 });
    expect(await submitPayment({ ...reviewedPayment, current: reviewedPayment.facts, order: refusedOrder, source: confirmation(refusedOrder.sourceTransfer.amount),
      adapters: refused.adapters, now: NOW + 30, previous: 'SOURCE_CONFIRMED' })).toMatchObject({ state: 'RECOVERY_REQUIRED', code: 'WOOVI_PAYOUT_REFUSED' });
    expect(refused.approvals()).toBe(0);
  });
  it('keeps UNKNOWN distinct from FAILED when Woovi cannot be reached', async () => {
    const woovi = fakeWoovi();
    const { facts, authorization, destination } = await reviewed(woovi);
    const order = await initiatePayment({ authorization, current: facts, destination, adapters: woovi.adapters, now: NOW + 5 });
    const offline = fakeWoovi({ offline: true });
    const progress = await submitPayment({ authorization, current: facts, destination, order, source: confirmation(order.sourceTransfer.amount), adapters: offline.adapters,
      now: NOW + 30, previous: 'SOURCE_CONFIRMED' });
    expect(progress).toMatchObject({ state: 'UNKNOWN', code: 'WOOVI_UNREACHABLE', evidence: { railStatus: 'UNKNOWN' } });
    expect(await reconcilePayment({ current: facts, providerOrderId: order.providerOrderId, source: confirmation(order.sourceTransfer.amount), adapters: offline.adapters,
      now: NOW + 40, previous: 'UNKNOWN' })).toMatchObject({ state: 'UNKNOWN', code: 'WOOVI_UNREACHABLE' });
  });
});

describe('Woovi status mapping and evidence', () => {
  const source = confirmation('18518519');
  const context = { correlationId: `flofi-${'0'.repeat(48)}`, amountCents: '10000', source, now: NOW };
  const payout = (overrides: Partial<WooviPayout> = {}): WooviPayout => ({ status: 'COMPLETED', payoutId: 'p-1', correlationId: context.correlationId, pixKey: PIX_KEY,
    brCode: null, endToEndId: 'E18236120202610081200s0123456789', isRefunded: false, refundStatus: null,
    quote: { inputAmount: 18.518519, inputCurrency: 'USDC', outputAmount: 100, outputCurrency: 'BRL' }, ...overrides });
  it.each([
    ['no payout yet', null, 'SOURCE_CONFIRMED', 'NOT_STARTED', 'WOOVI_PAYOUT_NOT_CREATED'],
    ['created, awaiting approval', payout({ status: 'PENDING', endToEndId: null }), 'SOURCE_CONFIRMED', 'NOT_STARTED', 'WOOVI_PAYOUT_AWAITING_APPROVAL'],
    ['approved, Pix in flight', payout({ status: 'PROCESSING', endToEndId: null }), 'PAYMENT_PENDING', 'PENDING', null],
    ['paid with end-to-end id', payout(), 'PAYMENT_SETTLED', 'SETTLED', null],
    ['completed without end-to-end id', payout({ endToEndId: null }), 'UNKNOWN', 'UNKNOWN', 'WOOVI_SETTLEMENT_PROOF_MISSING'],
    ['completed for another amount', payout({ quote: { inputAmount: 18.518519, inputCurrency: 'USDC', outputAmount: 99, outputCurrency: 'BRL' } }), 'UNKNOWN', 'UNKNOWN', 'WOOVI_SETTLED_AMOUNT_MISMATCH'],
    ['Pix never left', payout({ status: 'FAILED', endToEndId: null }), 'RECOVERY_REQUIRED', 'REJECTED', 'WOOVI_PAYOUT_FAILED'],
    ['returned, funds back in the float', payout({ isRefunded: true, refundStatus: 'CONFIRMED' }), 'RECOVERY_REQUIRED', 'REJECTED', 'WOOVI_PAYOUT_RETURNED'],
    ['returned, funds not available', payout({ isRefunded: true, refundStatus: 'FAILED' }), 'RECOVERY_REQUIRED', 'REJECTED', 'WOOVI_PAYOUT_RETURNED_REFUND_FAILED'],
    ['paid but debited above the source', payout({ quote: { inputAmount: 18.7, inputCurrency: 'USDC', outputAmount: 100, outputCurrency: 'BRL' } }), 'PAYMENT_SETTLED', 'SETTLED', 'WOOVI_DEBIT_ABOVE_SOURCE'],
    ['another payout', payout({ correlationId: `flofi-${'1'.repeat(48)}` }), 'UNKNOWN', 'UNKNOWN', 'WOOVI_CORRELATION_MISMATCH'],
  ] as const)('%s', (_label, value, state, railStatus, code) => {
    const progress = wooviProgress(value, context);
    expect(progress).toMatchObject({ state, code, evidence: { railStatus } });
    // Once the owner's funds left the wallet nothing is reported as FAILED, and only real facts reach the evidence.
    expect(progress.state).not.toBe('FAILED');
    expect(progress.evidence.settledAmountCents).toBe(state === 'PAYMENT_SETTLED' ? '10000' : null);
    expect(progress.evidence.feesCents).toBeNull();
    expect(Object.keys(progress.evidence).sort()).toEqual(['feesCents', 'observedAt', 'providerOrderId', 'railReference', 'railStatus', 'reconciliation',
      'settledAmountCents', 'sourceTransaction']);
  });
  it('reads payouts strictly and converts amounts exactly', () => {
    expect(() => readWooviPayout({ status: 'PAID', payoutId: 'p', correlationId: 'c', isRefunded: false })).toThrow('WOOVI_RESPONSE_INVALID');
    expect(() => readWooviPayout({ status: 'COMPLETED', payoutId: 'p', correlationId: 'c' })).toThrow('WOOVI_RESPONSE_INVALID');
    expect(() => readWooviPayout({ status: 'COMPLETED', payoutId: 'p', correlationId: 'c', isRefunded: false, endToEndId: 'E1; DROP' })).toThrow('WOOVI_RESPONSE_INVALID');
    expect(wooviUnits(18.518519, 6, 'CEIL')).toBe(18518519n);
    expect(wooviUnits(18.5185191, 6, 'CEIL')).toBe(18518520n);
    expect(wooviUnits(742.31, 2, 'EXACT')).toBe(74231n);
    expect(() => wooviUnits(742.315, 2, 'EXACT')).toThrow('WOOVI_RESPONSE_INVALID');
    expect(() => wooviUnits(-1, 2, 'CEIL')).toThrow('WOOVI_RESPONSE_INVALID');
  });
});

describe('Woovi webhooks are verified hints, never evidence by themselves', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }), other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = (pair: typeof keys) => pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = JSON.stringify({ event: 'STABLECOIN_PAYOUT_COMPLETED', stablePayout: { id: 'p-1', status: 'COMPLETED', correlationID: `flofi-${'a'.repeat(48)}`, endToEndId: 'E1' } });
  const signature = sign('sha256', Buffer.from(body), keys.privateKey).toString('base64');
  it('accepts only an RSA-SHA256 signature over the exact raw body from a published key', () => {
    expect(verifyWooviWebhook(body, signature, [pem(keys)])).toBe(true);
    expect(verifyWooviWebhook(body, signature, [pem(other), pem(keys)])).toBe(true); // rotation: any published key
    expect(verifyWooviWebhook(body.replace('COMPLETED', 'FAILED'), signature, [pem(keys)])).toBe(false);
    expect(verifyWooviWebhook(JSON.stringify(JSON.parse(body), null, 1), signature, [pem(keys)])).toBe(false);
    expect(verifyWooviWebhook(body, signature, [pem(other)])).toBe(false);
    expect(verifyWooviWebhook(body, null, [pem(keys)])).toBe(false);
    expect(verifyWooviWebhook(body, signature, [])).toBe(false);
  });
  it('yields only the FloFi correlation id to re-read through the API', () => {
    expect(wooviWebhookCorrelationId(JSON.parse(body))).toBe(`flofi-${'a'.repeat(48)}`);
    expect(wooviWebhookCorrelationId({ event: 'OPENPIX:CHARGE_COMPLETED', stablePayout: { correlationID: `flofi-${'a'.repeat(48)}` } })).toBeNull();
    expect(wooviWebhookCorrelationId({ event: 'STABLECOIN_PAYOUT_COMPLETED', stablePayout: { correlationID: 'someone-else' } })).toBeNull();
  });
});

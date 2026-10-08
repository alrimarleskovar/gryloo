// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { crc16Ccitt, parsePixKey, parsePixPayload, PixPayloadError } from '../src/pix.js';
import { boletoDueDate, parseBoleto, BoletoError } from '../src/boleto.js';
import { assertPaymentTransition, authorPaymentDraft, createPaymentNode, paymentAuthorizationChanges, paymentAuthorizationValid,
  paymentDestinationCommitment, paymentManifestFacts, PAYMENT_STATES, PAYMENT_TRANSITIONS, pixKeyDestination, readPaymentNode, type PaymentDraftRequest,
  type PaymentEvidence, type PaymentFields } from '../src/payment.js';
import { validateArtifact } from '../src/schemas.js';
import { hashArtifactValue } from '../src/canonical.js';

// The Banco Central do Brasil manual's own BR Code example (CRC 1D3D).
const BCB_EXAMPLE = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
// Built and checksummed by an independent implementation (Python binascii.crc_hqx, init 0xFFFF).
const PIX_STATIC_AMOUNT = '00020101021126460014br.gov.bcb.pix0111529982247250209Pedido 425204000053039865406742.315802BR5912Loja Exemplo6009SAO PAULO62120508PEDIDO426304E574';
const PIX_DYNAMIC = '00020101021226920014br.gov.bcb.pix2570pix.example-psp.com.br/qr/v2/cobv/9d36b84f-c70b-478f-b95c-12729b90ca255204000053039865802BR5915Empresa Exemplo6014RIO DE JANEIRO62070503***6304DE46';
// Bank boleto (bank 001, R$ 742,31, due 2026-11-10) and two arrecadação codes (modulo 10 and modulo 11), independently computed.
const BANK_BARCODE = '00195162600000742310000002800010000000100017';
const BANK_LINE = '00190000090280001000700001000173516260000074231';
const CONVENIO_MOD10 = { barcode: '82610000001599000091111111111111111111111111', line: '826100000015599000091117111111111113111111111113' };
const CONVENIO_MOD11 = { barcode: '82840000001599000091111111111111111111111111', line: '828400000017599000091112111111111112111111111112' };
const NOW = new Date('2026-10-07T12:00:00.000Z');
const code = (run: () => unknown) => { try { run(); return null; } catch (error) { return (error as { code?: string; message: string }).code ?? (error as Error).message; } };
const replaceAt = (text: string, index: number, value: string) => text.slice(0, index) + value + text.slice(index + 1);
const recrc = (body: string) => body + crc16Ccitt(body);

describe('Pix Copia e Cola (BR Code) local validation', () => {
  it('accepts the official BCB example and reports only the fields present', () => {
    expect(crc16Ccitt(BCB_EXAMPLE.slice(0, -4))).toBe('1D3D');
    expect(parsePixPayload(BCB_EXAMPLE)).toMatchObject({ initiation: 'UNSPECIFIED', key: { type: 'EVP', value: '123e4567-e12b-12d1-a456-426655440000' },
      locationUrl: null, amount: null, currency: 'BRL', merchantName: 'Fulano de Tal', merchantCity: 'BRASILIA', txid: null });
  });
  it('reads an encoded amount exactly and verifies CPF check digits', () => {
    expect(parsePixPayload(` ${PIX_STATIC_AMOUNT}\n`)).toMatchObject({ initiation: 'STATIC', key: { type: 'CPF', value: '52998224725' },
      amount: { cents: '74231', text: '742.31' }, txid: 'PEDIDO42', description: 'Pedido 42' });
  });
  it('keeps a dynamic code amount-less: its recipient and amount are resolved only by a provider', () => {
    expect(parsePixPayload(PIX_DYNAMIC)).toMatchObject({ initiation: 'DYNAMIC', key: null, amount: null,
      locationUrl: 'pix.example-psp.com.br/qr/v2/cobv/9d36b84f-c70b-478f-b95c-12729b90ca25' });
  });
  it.each([
    ['empty', '', 'PIX_PAYLOAD_EMPTY'],
    ['checksum altered', BCB_EXAMPLE.slice(0, -1) + 'E', 'PIX_CRC_MISMATCH'],
    ['amount tampered without new checksum', PIX_STATIC_AMOUNT.replace('742.31', '942.31'), 'PIX_CRC_MISMATCH'],
    ['checksum missing', BCB_EXAMPLE.slice(0, -8), 'PIX_CRC_MISSING'],
    ['truncated TLV', BCB_EXAMPLE.slice(0, 40), 'PIX_TLV_MALFORMED'],
    ['non-ASCII', BCB_EXAMPLE.replace('Fulano', 'Fulanô'), 'PIX_PAYLOAD_CHARSET'],
    ['invalid CPF key', recrc(PIX_STATIC_AMOUNT.slice(0, -4).replace('52998224725', '52998224726')), 'PIX_KEY_INVALID'],
    ['non-BRL currency', recrc(BCB_EXAMPLE.slice(0, -4).replace('5303986', '5303840')), 'PIX_CURRENCY_NOT_BRL'],
    ['zero amount', recrc(PIX_STATIC_AMOUNT.slice(0, -4).replace('5406742.31', '54040.00')), 'PIX_AMOUNT_INVALID'],
    ['not a Pix account', recrc(BCB_EXAMPLE.slice(0, -4).replace('br.gov.bcb.pix', 'br.gov.bcb.pax')), 'PIX_MERCHANT_ACCOUNT_MISSING'],
  ])('fails closed: %s', (_label, payload, expected) => {
    expect(code(() => parsePixPayload(payload))).toBe(expected);
    expect(() => parsePixPayload(payload)).toThrow(PixPayloadError);
  });
});

describe('Pix key destinations', () => {
  it('accepts DICT key formats, normalizes only CPF/CNPJ punctuation and never guesses', () => {
    expect(parsePixKey(' 529.982.247-25 ')).toEqual({ type: 'CPF', value: '52998224725' });
    expect(parsePixKey('11.222.333/0001-81')).toEqual({ type: 'CNPJ', value: '11222333000181' });
    expect(parsePixKey('+5511999998888')).toEqual({ type: 'PHONE', value: '+5511999998888' });
    expect(parsePixKey('pagamentos@example.com')).toEqual({ type: 'EMAIL', value: 'pagamentos@example.com' });
    expect(parsePixKey('123e4567-e12b-12d1-a456-426655440000')).toEqual({ type: 'EVP', value: '123e4567-e12b-12d1-a456-426655440000' });
    // A wrong CPF check digit, a phone without +55, spaces inside, an over-long value or a non-string: refused.
    for (const value of ['529.982.247-26', '11999998888', 'pag amentos@example.com', `${'a'.repeat(70)}@example.com`, '', 52998224725])
      expect(code(() => parsePixKey(value))).toBe('PIX_KEY_INVALID');
  });
  it('drafts a key payment with an owner-stated amount and a commitment distinct from any BR Code', () => {
    const draft = authorPaymentDraft('pay-1', request({ destination: '529.982.247-25', pixDestination: 'PIX_KEY', ownerAmountCents: '10000' }), NOW);
    expect(draft).toMatchObject({ state: 'DRAFT', authorizes: false, requiresProviderResolution: false,
      destination: { rail: 'PIX', kind: 'PIX_KEY', key: { type: 'CPF', value: '52998224725' } } });
    const fields = readPaymentNode(draft.node);
    expect(fields).toMatchObject({ rail: 'PIX', amountCents: '10000', amountSource: 'OWNER' });
    expect(fields.destinationCommitment).toBe(paymentDestinationCommitment('PIX', pixKeyDestination({ type: 'CPF', value: '52998224725' })));
    expect(JSON.stringify(draft.node)).not.toContain('52998224725');
    // The same key inside a BR Code is a different destination (the code also binds merchant, city and txid).
    expect(fields.destinationCommitment).not.toBe(readPaymentNode(authorPaymentDraft('pay-1', request(), NOW).node).destinationCommitment);
    expect(code(() => authorPaymentDraft('p', request({ destination: '52998224725', pixDestination: 'PIX_KEY' }), NOW))).toBe('PAYMENT_AMOUNT_REQUIRED');
    expect(code(() => authorPaymentDraft('p', request({ pixDestination: 'PIX_KEY' }), NOW))).toBe('PIX_KEY_INVALID');
    expect(code(() => authorPaymentDraft('p', request({ destination: '52998224725', pixDestination: 'PIX_CODE', ownerAmountCents: '100' }), NOW))).toBe('PIX_TLV_MALFORMED');
    expect(code(() => authorPaymentDraft('p', request({ rail: 'BOLETO', destination: BANK_LINE, pixDestination: 'PIX_KEY' }), NOW))).toBe('PAYMENT_DESTINATION_KIND_INVALID');
  });
});

describe('boleto local validation', () => {
  it('parses a bank boleto from either representation to the same canonical facts', () => {
    const fromLine = parseBoleto(BANK_LINE, NOW), fromBarcode = parseBoleto(BANK_BARCODE, NOW);
    expect(fromLine).toEqual(fromBarcode);
    expect(fromLine).toMatchObject({ kind: 'BANK', bankCode: '001', barcode: BANK_BARCODE, digitableLine: BANK_LINE,
      amount: { cents: '74231', kind: 'EFFECTIVE' }, dueDate: '2026-11-10', dueDateFactor: '1626' });
    expect(parseBoleto('00190.00009 02800.010007 00001.000173 5 16260000074231', NOW)).toEqual(fromLine);
  });
  it('resolves the due-date factor across the February 2025 restart', () => {
    expect(boletoDueDate('9999', new Date('2025-01-01'))).toBe('2025-02-21');
    expect(boletoDueDate('1000', NOW)).toBe('2025-02-22');
    expect(boletoDueDate('1000', new Date('2001-01-01'))).toBe('2000-07-03');
    expect(boletoDueDate('0000', NOW)).toBeNull();
  });
  it('parses arrecadação codes with modulo 10 and modulo 11 and reports the encoded value', () => {
    for (const vector of [CONVENIO_MOD10, CONVENIO_MOD11]) {
      expect(parseBoleto(vector.line, NOW)).toEqual(parseBoleto(vector.barcode, NOW));
      expect(parseBoleto(vector.line, NOW)).toMatchObject({ kind: 'CONVENIO', segment: '2', amount: { cents: '15990', kind: 'EFFECTIVE' }, dueDate: null });
    }
  });
  it.each([
    ['field check digit', replaceAt(BANK_LINE, 9, '1'), 'BOLETO_FIELD_CHECK_DIGIT_INVALID'],
    ['general check digit', replaceAt(BANK_BARCODE, 4, '7'), 'BOLETO_CHECK_DIGIT_INVALID'],
    ['amount digit altered', replaceAt(BANK_BARCODE, 18, '2'), 'BOLETO_CHECK_DIGIT_INVALID'],
    ['arrecadação block digit', replaceAt(CONVENIO_MOD11.line, 11, '9'), 'BOLETO_FIELD_CHECK_DIGIT_INVALID'],
    ['arrecadação general digit', replaceAt(CONVENIO_MOD10.barcode, 3, '9'), 'BOLETO_CHECK_DIGIT_INVALID'],
    ['wrong length', BANK_LINE.slice(1), 'BOLETO_LENGTH_INVALID'],
    ['letters', BANK_LINE.replace('0', 'O'), 'BOLETO_CHARACTERS_INVALID'],
    ['empty', '   ', 'BOLETO_EMPTY'],
  ])('fails closed without repair: %s', (_label, input, expected) => {
    expect(code(() => parseBoleto(input, NOW))).toBe(expected);
    expect(() => parseBoleto(input, NOW)).toThrow(BoletoError);
  });
});

const USDC_BASE = { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 };
const request = (overrides: Partial<PaymentDraftRequest> = {}): PaymentDraftRequest => ({ channel: 'MCP', rail: 'PIX', destination: PIX_STATIC_AMOUNT,
  sourceAsset: USDC_BASE, maxSourceAmount: '140000000', maxFeeCents: '1500', maxSlippageBps: 50,
  provider: { id: 'payments.example', version: '1.0.0' }, expiresAt: Math.floor(NOW.getTime() / 1000) + 600, ...overrides });
const workflow = (node: ReturnType<typeof createPaymentNode>) => ({ schemaVersion: '1.0.0', workflowId: 'payment-workflow', revision: 1, nodes: [node], resourceEdges: [] });
const OWNER = { chainId: 'eip155:8453', address: '0x1111111111111111111111111111111111111111' };

describe('canonical payment IR', () => {
  it('authors a schema-valid DRAFT node that carries no authority and binds a destination commitment', () => {
    const draft = authorPaymentDraft('pay-1', request(), NOW);
    expect(draft).toMatchObject({ state: 'DRAFT', authorizes: false, channel: 'MCP', requiresProviderResolution: false });
    expect(() => validateArtifact('semantic-workflow', workflow(draft.node))).not.toThrow();
    const fields = readPaymentNode(draft.node);
    expect(fields).toMatchObject({ rail: 'PIX', amountCents: '74231', amountSource: 'PAYLOAD', sourceChain: 'eip155:8453', maxFeeCents: '1500' });
    expect(fields.destinationCommitment).toBe(paymentDestinationCommitment('PIX', PIX_STATIC_AMOUNT));
    // The IR holds a commitment, not the recipient's key or payload.
    expect(JSON.stringify(draft.node)).not.toContain('52998224725');
    expect(draft.node.requiredAuthorizationClass).toBe('MODE_A');
  });
  it('serializes deterministically and round-trips through the closed declaration', () => {
    const node = authorPaymentDraft('pay-1', request(), NOW).node;
    const reordered = { ...node, inputs: [...node.inputs].reverse() };
    expect(hashArtifactValue('semantic-workflow', workflow(reordered))).toBe(hashArtifactValue('semantic-workflow', workflow(node)));
    expect(readPaymentNode(JSON.parse(JSON.stringify(node)))).toEqual(readPaymentNode(node));
    expect(code(() => readPaymentNode({ ...node, inputs: [...node.inputs, { name: 'note', kind: 'IDENTIFIER', value: 'x' }] }))).toBe('PAYMENT_DECLARATION_INVALID');
    expect(code(() => readPaymentNode({ ...node, lockedParameters: [] }))).toBe('PAYMENT_DECLARATION_INVALID');
    expect(code(() => readPaymentNode({ ...node, requiredAuthorizationClass: 'NONE' }))).toBe('PAYMENT_DECLARATION_INVALID');
  });
  it('commits recipient and amount into the workflow hash that the Strategy Manifest binds', () => {
    const base = authorPaymentDraft('pay-1', request(), NOW).node;
    const hash = (node: typeof base) => hashArtifactValue('semantic-workflow', workflow(node));
    const otherRecipient = authorPaymentDraft('pay-1', request({ destination: BCB_EXAMPLE, ownerAmountCents: '74231' }), NOW).node;
    expect(readPaymentNode(otherRecipient).amountCents).toBe('74231');
    expect(hash(otherRecipient)).not.toBe(hash(base));
    expect(paymentDestinationCommitment('PIX', PIX_STATIC_AMOUNT)).not.toBe(paymentDestinationCommitment('BOLETO', PIX_STATIC_AMOUNT));
    const fields = readPaymentNode(base);
    expect(hash(createPaymentNode('pay-1', { ...fields, amountCents: '74232' }))).not.toBe(hash(base));
  });
  it('invalidates authorization on any recipient, amount, provider, source-wallet or limit change, and on expiry', () => {
    const node = authorPaymentDraft('pay-1', request(), NOW).node, fields: PaymentFields = readPaymentNode(node);
    const reviewed = paymentManifestFacts(node, OWNER), now = Math.floor(NOW.getTime() / 1000);
    expect(paymentAuthorizationChanges(reviewed, paymentManifestFacts(node, OWNER))).toEqual([]);
    expect(paymentAuthorizationValid(reviewed, paymentManifestFacts(node, OWNER), now)).toBe(true);
    const changed = (next: Partial<PaymentFields>) => paymentManifestFacts(createPaymentNode('pay-1', { ...fields, ...next }), OWNER);
    expect(paymentAuthorizationChanges(reviewed, changed({ destinationCommitment: paymentDestinationCommitment('PIX', BCB_EXAMPLE) }))).toEqual(['destinationCommitment']);
    expect(paymentAuthorizationChanges(reviewed, changed({ amountCents: '80000' }))).toEqual(['amountCents']);
    expect(paymentAuthorizationChanges(reviewed, changed({ provider: { id: 'payments.other', version: '1.0.0' } }))).toEqual(['provider']);
    expect(paymentAuthorizationChanges(reviewed, changed({ maxSourceAmount: '150000000' }))).toEqual(['maxSourceAmount']);
    expect(paymentAuthorizationChanges(reviewed, changed({ maxFeeCents: '9900' }))).toEqual(['maxFeeCents']);
    expect(paymentAuthorizationChanges(reviewed, paymentManifestFacts(node, { ...OWNER, address: '0x2222222222222222222222222222222222222222' }))).toEqual(['owner']);
    expect(paymentAuthorizationValid(reviewed, paymentManifestFacts(node, OWNER), reviewed.expiresAt)).toBe(false);
  });
  it('never invents or silently alters the amount, and fails closed on malformed destinations', () => {
    expect(code(() => authorPaymentDraft('p', request({ ownerAmountCents: '50000' }), NOW))).toBe('PAYMENT_AMOUNT_CONFLICT');
    expect(code(() => authorPaymentDraft('p', request({ destination: BCB_EXAMPLE }), NOW))).toBe('PAYMENT_AMOUNT_REQUIRED');
    expect(code(() => authorPaymentDraft('p', request({ destination: PIX_STATIC_AMOUNT.slice(0, -1) + '0' }), NOW))).toBe('PIX_CRC_MISMATCH');
    expect(code(() => authorPaymentDraft('p', request({ rail: 'BOLETO', destination: replaceAt(BANK_LINE, 20, '9') }), NOW))).toBe('BOLETO_FIELD_CHECK_DIGIT_INVALID');
    expect(code(() => authorPaymentDraft('p', request({ expiresAt: Math.floor(NOW.getTime() / 1000) }), NOW))).toBe('PAYMENT_EXPIRED');
    const boleto = authorPaymentDraft('p', request({ rail: 'BOLETO', destination: BANK_LINE }), NOW);
    expect(readPaymentNode(boleto.node)).toMatchObject({ rail: 'BOLETO', amountCents: '74231', amountSource: 'PAYLOAD' });
    expect(boleto.node.actionType).toBe('payment.boleto');
    const dynamic = authorPaymentDraft('p', request({ destination: PIX_DYNAMIC, ownerAmountCents: '50000' }), NOW);
    expect(dynamic).toMatchObject({ requiresProviderResolution: true, authorizes: false });
    expect(readPaymentNode(dynamic.node).amountSource).toBe('OWNER');
  });
});

describe('payment lifecycle truthfulness', () => {
  const evidence = (overrides: Partial<PaymentEvidence> = {}): PaymentEvidence => ({ providerOrderId: null, sourceTransaction: null, railStatus: 'NOT_STARTED',
    railReference: null, settledAmountCents: null, feesCents: null, observedAt: NOW.toISOString(), reconciliation: 'NONE', ...overrides });
  it('a confirmed source transaction is never a settled payment', () => {
    expect(PAYMENT_TRANSITIONS.SOURCE_CONFIRMED).not.toContain('PAYMENT_SETTLED');
    expect(code(() => assertPaymentTransition('SOURCE_CONFIRMED', 'PAYMENT_SETTLED', evidence({ railStatus: 'SETTLED' })))).toBe('PAYMENT_TRANSITION_INVALID_SOURCE_CONFIRMED_TO_PAYMENT_SETTLED');
  });
  it('requires rail settlement evidence before PAYMENT_SETTLED and source confirmations before SOURCE_CONFIRMED', () => {
    const tx = { chainId: 'eip155:8453', hash: '0x' + 'a'.repeat(64), confirmations: 0 };
    expect(code(() => assertPaymentTransition('SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', evidence({ sourceTransaction: tx })))).toBe('PAYMENT_SOURCE_CONFIRMATION_REQUIRED');
    expect(code(() => assertPaymentTransition('SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', evidence({ sourceTransaction: { ...tx, confirmations: 2 } })))).toBeNull();
    expect(code(() => assertPaymentTransition('SOURCE_CONFIRMED', 'PAYMENT_PENDING', evidence()))).toBe('PAYMENT_PROVIDER_ORDER_REQUIRED');
    expect(code(() => assertPaymentTransition('PAYMENT_PENDING', 'PAYMENT_SETTLED', evidence({ providerOrderId: 'order-1', railStatus: 'PENDING' })))).toBe('PAYMENT_SETTLEMENT_EVIDENCE_REQUIRED');
    expect(code(() => assertPaymentTransition('PAYMENT_PENDING', 'PAYMENT_SETTLED', evidence({ providerOrderId: 'order-1', railStatus: 'SETTLED', railReference: 'E2E-ID', settledAmountCents: '74231' })))).toBeNull();
  });
  it('funds that left the wallet without settlement require recovery, never a silent failure', () => {
    for (const from of ['SOURCE_CONFIRMED', 'PAYMENT_PENDING'] as const) expect(PAYMENT_TRANSITIONS[from]).not.toContain('FAILED');
    expect(PAYMENT_TRANSITIONS.PAYMENT_PENDING).toContain('RECOVERY_REQUIRED');
  });
  it('has no transition into authorization or execution from a channel draft without Review', () => {
    expect(PAYMENT_TRANSITIONS.DRAFT).not.toContain('AUTHORIZED');
    expect(PAYMENT_TRANSITIONS.QUOTED).not.toContain('AUTHORIZED');
    expect(PAYMENT_TRANSITIONS.SIMULATED).not.toContain('AUTHORIZED');
    for (const state of PAYMENT_STATES) for (const next of PAYMENT_TRANSITIONS[state]) expect(PAYMENT_STATES).toContain(next);
    expect(PAYMENT_STATES.filter(state => PAYMENT_TRANSITIONS[state].includes('SOURCE_SUBMITTED'))).toEqual(['AUTHORIZED']);
  });
});

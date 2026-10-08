// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Woovi (OpenPix) as FloFi's first Brazilian PaymentAdapter: stablecoin → Pix through Woovi's official Stablecoin payout
 * (off-ramp) API, as published in its OpenAPI document (`https://api.woovi.com/api/openapi.json`, servers
 * `https://api.woovi.com` and the sandbox `https://api.woovi-sandbox.com`; the AppID goes in `Authorization`):
 * - `GET  /api/v1/stablecoin/wallets`          the account's INTERNAL float deposit addresses per currency and network
 * - `GET  /api/v1/stablecoin/payout/quote`     target BRL amount (centavos) → asset debited, Woovi and provider fees
 * - `POST /api/v1/stablecoin/payout`           creates a PENDING payout to a Pix key, idempotent by `correlationId`
 * - `POST /api/v1/stablecoin/payout/approve`   opens the ticket: debits the float and sends the Pix (re-prices first)
 * - `GET  /api/v1/stablecoin/payout?correlationId=`  status, re-read from the provider while in flight
 * - `GET  /api/v1/webhook/public-keys`         keys for the RSA-SHA256 `x-webhook-signature` over the raw body
 * Requirements on the operator's Woovi account (not FloFi code): a KYB-confirmed stablecoin subaccount, an App with the
 * `STABLECOIN_PAYOUT_CREATE` and `STABLECOIN_SUBACCOUNT_LIST` scopes, and available OUT limit.
 *
 * Supported here, and only here: destination = a Pix key (the payout API takes `pixKey`; it has no BR Code input), source =
 * USDC on Base, and only when Woovi's own wallets response lists a USDC/BASE deposit address for the account. USDT, BRLA and
 * other networks are not mapped because FloFi cannot sign or verify them today (Ethereum Mainnet is refused by FloFi's wallet).
 *
 * Money moves in this order and no other: the owner signs a USDC transfer to the account's Woovi deposit address in FloFi's
 * reviewed wallet flow; FloFi verifies it on-chain; only then is the payout created and approved, and only if Woovi's fresh
 * price debits no more than the owner sent. Settlement is claimed only with Woovi's Pix end-to-end id for the exact amount.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { pixKeyDestination, paymentDestinationCommitment, type Asset, type PaymentDestinationSummary, type PaymentEvidence,
  type PaymentManifestFacts } from '@defi-workflow-engine/workflow-contracts';
import { deploymentEnvironment } from './deployment.ts';
import type { PaymentAdapter, PaymentOrder, PaymentProgress, PaymentQuote, PaymentSource, ReviewedPaymentAuthorization, SourceConfirmation } from './payment-adapter.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const WOOVI_PROVIDER = Object.freeze({ id: 'woovi', version: '1.0.0', name: 'Woovi' } as const);
export const WOOVI_API = Object.freeze({ sandbox: 'https://api.woovi-sandbox.com', production: 'https://api.woovi.com' } as const);
/**
 * FloFi's own bound on acting on a payout quote. Woovi publishes no payout-quote validity (its deposit quote is cached for 60 s)
 * and re-prices at approval, so FloFi re-quotes before paying out instead of trusting an old price.
 */
export const WOOVI_QUOTE_TTL_SECONDS = 60;
/** Woovi currency/network pairs FloFi can sign and verify, mapped to FloFi's canonical asset (Circle USDC on Base). */
export const WOOVI_SOURCES: readonly { readonly currency: 'USDC'; readonly network: 'BASE'; readonly asset: Asset }[] = Object.freeze([
  Object.freeze({ currency: 'USDC' as const, network: 'BASE' as const,
    asset: Object.freeze({ chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }) }),
]);

export type WooviConfiguration = { readonly configured: false; readonly code: string }
  | { readonly configured: true; readonly environment: 'sandbox' | 'production'; readonly appId: string; readonly apiBase: string };
/**
 * `WOOVI_APP_ID` (server-only) and an explicit `WOOVI_ENVIRONMENT` (`sandbox` or `production`). A production deployment uses
 * only the production API, and previews, development and local servers only the sandbox: never the other way around.
 */
export function wooviConfiguration(env: Env): WooviConfiguration {
  const appId = env.WOOVI_APP_ID, environment = env.WOOVI_ENVIRONMENT;
  if (!appId && !environment) return { configured: false, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' };
  if (environment !== 'sandbox' && environment !== 'production') return { configured: false, code: 'WOOVI_ENVIRONMENT_INVALID' };
  if (!appId || appId.length < 16 || appId.length > 1024 || !/^[\x21-\x7e]+$/.test(appId)) return { configured: false, code: 'WOOVI_APP_ID_INVALID' };
  if ((deploymentEnvironment(env) === 'production') !== (environment === 'production')) return { configured: false, code: 'WOOVI_ENVIRONMENT_MISMATCH' };
  return { configured: true, environment, appId, apiBase: WOOVI_API[environment] };
}

function fail(code: string): never { throw new Error(code); }
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/, CORRELATION = /^flofi-[0-9a-f]{48}$/;
/** A non-negative JSON number to exact native units; `CEIL` rounds a finer value up (conservative for spend bounds). */
export function wooviUnits(value: unknown, decimals: number, rounding: 'CEIL' | 'EXACT'): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail('WOOVI_RESPONSE_INVALID');
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) fail('WOOVI_RESPONSE_INVALID');
  const [whole, fraction = ''] = text.split('.');
  let units = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0');
  if (/[1-9]/.test(fraction.slice(decimals))) { if (rounding === 'EXACT') fail('WOOVI_RESPONSE_INVALID'); units += 1n; }
  return units;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('WOOVI_RESPONSE_INVALID');
const text = (value: unknown, pattern = /^[\x20-\x7e]{1,256}$/) => typeof value === 'string' && pattern.test(value) ? value : fail('WOOVI_RESPONSE_INVALID');
const optionalText = (value: unknown) => value === undefined || value === null ? null : text(value);

/** The Woovi payout fields FloFi reads; everything else in the response is ignored, never echoed into evidence. */
export type WooviPayout = { readonly status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'; readonly payoutId: string; readonly correlationId: string;
  readonly pixKey: string | null; readonly brCode: string | null; readonly endToEndId: string | null; readonly isRefunded: boolean;
  readonly refundStatus: 'CONFIRMED' | 'FAILED' | null;
  readonly quote: { readonly inputAmount: number; readonly inputCurrency: string; readonly outputAmount: number; readonly outputCurrency: string } | null };
export function readWooviPayout(body: unknown): WooviPayout {
  const value = object(body);
  const status = value.status;
  if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'COMPLETED' && status !== 'FAILED') fail('WOOVI_RESPONSE_INVALID');
  if (typeof value.isRefunded !== 'boolean') fail('WOOVI_RESPONSE_INVALID');
  const refund = value.refund === undefined || value.refund === null ? null : object(value.refund);
  const refundStatus = refund ? refund.status === 'CONFIRMED' || refund.status === 'FAILED' ? refund.status : fail('WOOVI_RESPONSE_INVALID') : null;
  const quote = value.quote === undefined || value.quote === null ? null : object(value.quote);
  if (quote && (typeof quote.inputAmount !== 'number' || typeof quote.outputAmount !== 'number' || typeof quote.inputCurrency !== 'string'
    || typeof quote.outputCurrency !== 'string')) fail('WOOVI_RESPONSE_INVALID');
  return { status: status as WooviPayout['status'], payoutId: text(value.payoutId), correlationId: text(value.correlationId), pixKey: optionalText(value.pixKey),
    brCode: optionalText(value.brCode), endToEndId: value.endToEndId === undefined || value.endToEndId === null ? null : text(value.endToEndId, /^[A-Za-z0-9]{8,64}$/),
    isRefunded: value.isRefunded, refundStatus,
    quote: quote ? { inputAmount: quote.inputAmount as number, inputCurrency: quote.inputCurrency as string, outputAmount: quote.outputAmount as number,
      outputCurrency: quote.outputCurrency as string } : null };
}

/**
 * Maps one Woovi payout (or its absence) onto the canonical lifecycle. Only facts Woovi and the verified source transfer
 * actually state reach the evidence: no settlement without Woovi's end-to-end id for the exact amount, and once the owner's
 * funds have left the wallet nothing is ever reported as a plain failure.
 */
export function wooviProgress(payout: WooviPayout | null, input: { readonly correlationId: string; readonly amountCents: string;
  readonly source: SourceConfirmation | null; readonly now: number; readonly unreachable?: boolean }): PaymentProgress {
  const evidence = (railStatus: PaymentEvidence['railStatus'], reconciliation: PaymentEvidence['reconciliation'], settled = false): PaymentEvidence => ({
    providerOrderId: payout?.correlationId ?? (input.source ? input.correlationId : null),
    sourceTransaction: input.source ? { chainId: input.source.chainId, hash: input.source.transactionHash, confirmations: input.source.confirmations } : null,
    railStatus, railReference: payout?.endToEndId ?? null, settledAmountCents: settled ? input.amountCents : null, feesCents: null,
    observedAt: new Date(input.now * 1000).toISOString(), reconciliation });
  const progress = (state: PaymentProgress['state'], value: PaymentEvidence, code: string | null): PaymentProgress => ({ state, evidence: value, code });
  if (input.unreachable) return progress('UNKNOWN', evidence('UNKNOWN', 'PENDING'), 'WOOVI_UNREACHABLE');
  if (!payout) return input.source ? progress('SOURCE_CONFIRMED', evidence('NOT_STARTED', 'NONE'), 'WOOVI_PAYOUT_NOT_CREATED')
    : progress('UNKNOWN', evidence('UNKNOWN', 'NONE'), 'WOOVI_PAYOUT_NOT_FOUND');
  if (payout.correlationId !== input.correlationId) return progress('UNKNOWN', evidence('UNKNOWN', 'DIVERGENT'), 'WOOVI_CORRELATION_MISMATCH');
  const debit = payout.quote && input.source ? wooviUnits(payout.quote.inputAmount, input.source.asset.decimals, 'CEIL') : null;
  const debitAboveSource = debit !== null && input.source !== null && debit > BigInt(input.source.amount);
  if (payout.status === 'PENDING') return progress(input.source ? 'SOURCE_CONFIRMED' : 'UNKNOWN', evidence('NOT_STARTED', 'NONE'), 'WOOVI_PAYOUT_AWAITING_APPROVAL');
  if (payout.status === 'PROCESSING') return progress('PAYMENT_PENDING', evidence('PENDING', 'PENDING'), null);
  if (payout.status === 'FAILED') return progress('RECOVERY_REQUIRED', evidence('REJECTED', 'DIVERGENT'), 'WOOVI_PAYOUT_FAILED');
  // COMPLETED: the Pix left. A returned payout keeps COMPLETED; `isRefunded`/`refund` say it came back.
  if (payout.isRefunded) return progress('RECOVERY_REQUIRED', evidence('REJECTED', 'DIVERGENT'),
    payout.refundStatus === 'CONFIRMED' ? 'WOOVI_PAYOUT_RETURNED' : payout.refundStatus === 'FAILED' ? 'WOOVI_PAYOUT_RETURNED_REFUND_FAILED' : 'WOOVI_PAYOUT_RETURN_PENDING');
  if (!payout.endToEndId) return progress('UNKNOWN', evidence('UNKNOWN', 'PENDING'), 'WOOVI_SETTLEMENT_PROOF_MISSING');
  if (!payout.quote || payout.quote.outputCurrency !== 'BRL' || wooviUnits(payout.quote.outputAmount, 2, 'EXACT').toString() !== input.amountCents)
    return progress('UNKNOWN', evidence('UNKNOWN', 'DIVERGENT'), 'WOOVI_SETTLED_AMOUNT_MISMATCH');
  return progress('PAYMENT_SETTLED', evidence('SETTLED', debitAboveSource ? 'DIVERGENT' : 'RECONCILED', true), debitAboveSource ? 'WOOVI_DEBIT_ABOVE_SOURCE' : null);
}

/** Verifies Woovi's `x-webhook-signature` (base64 RSA-SHA256 over the raw body) against any published key (rotation-safe). */
export function verifyWooviWebhook(rawBody: string | Uint8Array, signature: string | null | undefined, publicKeys: readonly string[]): boolean {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/=]{16,2048}$/.test(signature)) return false;
  const bytes = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody), signed = Buffer.from(signature, 'base64');
  return publicKeys.some(pem => { try { return verify('RSA-SHA256', bytes, createPublicKey(pem), signed); } catch { return false; } });
}
/**
 * The FloFi payout a verified stablecoin-payout webhook refers to. A webhook is only a hint to re-read the payout through the
 * API (at-least-once delivery, possibly reordered); its body is never used as settlement evidence by itself.
 */
export function wooviWebhookCorrelationId(body: unknown): string | null {
  try {
    const value = object(body), payout = object(value.stablePayout);
    if (typeof value.event !== 'string' || !value.event.startsWith('STABLECOIN_PAYOUT_')) return null;
    return typeof payout.correlationID === 'string' && CORRELATION.test(payout.correlationID) ? payout.correlationID : null;
  } catch { return null; }
}

type Response = { readonly status: number; readonly body: unknown };
export function createWooviPixPaymentAdapter(configuration: Extract<WooviConfiguration, { configured: true }>,
  options: { readonly fetchImpl: typeof fetch; readonly now?: () => number }): PaymentAdapter & {
    webhookPublicKeys(): Promise<readonly string[]>; correlationId(authorization: ReviewedPaymentAuthorization): string } {
  const clock = options.now ?? (() => Math.floor(Date.now() / 1000));
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    let response: globalThis.Response;
    try {
      response = await options.fetchImpl(`${configuration.apiBase}${path}`, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
        headers: { authorization: configuration.appId, accept: 'application/json', ...body === undefined ? {} : { 'content-type': 'application/json' } },
        ...body === undefined ? {} : { body: JSON.stringify(body) } });
    } catch { return fail('WOOVI_UNREACHABLE'); }
    const raw = await response.text().catch(() => fail('WOOVI_UNREACHABLE'));
    if (raw.length > 262_144) fail('WOOVI_RESPONSE_INVALID');
    let parsed: unknown = null;
    if (raw) try { parsed = JSON.parse(raw); } catch { if (response.ok) fail('WOOVI_RESPONSE_INVALID'); }
    return { status: response.status, body: parsed };
  }
  const refused = (response: Response, operation: string): never =>
    fail(response.status === 401 || response.status === 403 ? 'WOOVI_UNAUTHORIZED' : response.status >= 500 ? 'WOOVI_UNAVAILABLE' : `WOOVI_${operation}_REFUSED`);
  const sourceFor = (facts: Pick<PaymentManifestFacts, 'sourceChain' | 'sourceAsset'>) =>
    WOOVI_SOURCES.find(source => source.asset.chainId === facts.sourceChain && JSON.stringify(source.asset) === JSON.stringify(facts.sourceAsset)) ?? fail('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
  const pixKey = (destination: PaymentDestinationSummary) => destination.kind === 'PIX_KEY' ? destination.key : fail('PAYMENT_DESTINATION_UNSUPPORTED_BY_PROVIDER');
  const correlationId = (authorization: ReviewedPaymentAuthorization) =>
    `flofi-${createHash('sha256').update(`flofi/woovi-payout/v1/${authorization.manifestHash}`).digest('hex').slice(0, 48)}`;

  async function wallets(): Promise<readonly { readonly address: string; readonly currency: string; readonly network: string }[]> {
    const response = await call('GET', '/api/v1/stablecoin/wallets');
    if (response.status !== 200) refused(response, 'WALLETS');
    const list = object(response.body).wallets;
    if (!Array.isArray(list) || list.length > 64) fail('WOOVI_RESPONSE_INVALID');
    return list.map(entry => { const wallet = object(entry); return { address: text(wallet.address), currency: text(wallet.currency), network: text(wallet.network) }; });
  }
  async function depositAddress(source: typeof WOOVI_SOURCES[number]): Promise<string> {
    const wallet = (await wallets()).find(entry => entry.currency === source.currency && entry.network === source.network);
    return wallet && EVM_ADDRESS.test(wallet.address) ? wallet.address.toLowerCase() : fail('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
  }
  async function freshQuote(facts: PaymentManifestFacts): Promise<{ readonly sourceAmount: bigint; readonly feeCents: bigint; readonly body: unknown }> {
    const source = sourceFor(facts);
    if (!/^[1-9][0-9]{0,15}$/.test(facts.amountCents) || !Number.isSafeInteger(Number(facts.amountCents))) fail('PAYMENT_AMOUNT_INVALID');
    const response = await call('GET', `/api/v1/stablecoin/payout/quote?value=${facts.amountCents}&currency=${source.currency}`);
    if (response.status !== 200) refused(response, 'QUOTE');
    const quote = object(object(response.body).quote);
    if (quote.inputCurrency !== source.currency || quote.outputCurrency !== 'BRL') fail('WOOVI_RESPONSE_INVALID');
    if (wooviUnits(quote.outputAmount, 2, 'EXACT').toString() !== facts.amountCents) fail('PAYMENT_QUOTE_AMOUNT_MISMATCH');
    const sourceAmount = wooviUnits(quote.inputAmount, source.asset.decimals, 'CEIL');
    if (sourceAmount <= 0n) fail('WOOVI_RESPONSE_INVALID');
    // Woovi's fee is debited separately in BRL on approval; `null` means Woovi could not price it, so FloFi cannot bound it.
    if (quote.wooviFee === null || quote.wooviFee === undefined) fail('WOOVI_FEE_UNPRICED');
    const total = wooviUnits(quote.fee, 2, 'CEIL'), parts = wooviUnits(quote.wooviFee, 2, 'CEIL') + wooviUnits(quote.providerFee, 2, 'CEIL');
    if (total + 1n < parts || total > parts + 1n) fail('WOOVI_RESPONSE_INVALID');
    return { sourceAmount, feeCents: total > parts ? total : parts, body: response.body };
  }
  async function readPayout(id: string): Promise<WooviPayout | null> {
    const response = await call('GET', `/api/v1/stablecoin/payout?correlationId=${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (response.status !== 200) refused(response, 'STATUS');
    return readWooviPayout(response.body);
  }

  return {
    ...WOOVI_PROVIDER, rails: Object.freeze(['PIX'] as const), destinationKinds: Object.freeze(['PIX_KEY'] as const),
    correlationId,
    async supportedSources(): Promise<readonly PaymentSource[]> {
      const listed = await wallets();
      return WOOVI_SOURCES.filter(source => listed.some(wallet => wallet.currency === source.currency && wallet.network === source.network && EVM_ADDRESS.test(wallet.address)))
        .map(source => ({ chainId: source.asset.chainId, asset: source.asset }));
    },
    async quote({ facts, destination }): Promise<PaymentQuote> {
      pixKey(destination);
      if (facts.rail !== 'PIX' || facts.provider.id !== WOOVI_PROVIDER.id || facts.provider.version !== WOOVI_PROVIDER.version) fail('PAYMENT_PROVIDER_MISMATCH');
      const quote = await freshQuote(facts), now = clock();
      return { providerQuoteId: `woovi:${createHash('sha256').update(`${JSON.stringify(quote.body)}\n${now}`).digest('hex').slice(0, 32)}`,
        amountCents: facts.amountCents, feeCents: quote.feeCents.toString(), sourceAmount: quote.sourceAmount.toString(), expiresAt: now + WOOVI_QUOTE_TTL_SECONDS };
    },
    async initiate({ authorization, destination }): Promise<PaymentOrder> {
      const source = sourceFor(authorization.facts);
      pixKey(destination);
      return { providerOrderId: correlationId(authorization),
        sourceTransfer: { chainId: source.asset.chainId, to: await depositAddress(source), asset: source.asset, amount: authorization.quote.sourceAmount } };
    },
    async submit({ authorization, destination, order, source, now }): Promise<PaymentProgress> {
      const facts = authorization.facts, key = pixKey(destination), id = correlationId(authorization), currency = sourceFor(facts).currency;
      if (order.providerOrderId !== id) fail('PAYMENT_ORDER_MISMATCH');
      if (paymentDestinationCommitment('PIX', pixKeyDestination(key)) !== facts.destinationCommitment) fail('PAYMENT_DESTINATION_MISMATCH');
      const context = { correlationId: id, amountCents: facts.amountCents, source, now };
      // The owner's funds are in the provider float and the Pix was not sent: recovery, never a plain failure.
      const recovery = (code: string): PaymentProgress => {
        const base = wooviProgress(null, context);
        return { state: 'RECOVERY_REQUIRED', evidence: { ...base.evidence, reconciliation: 'DIVERGENT' }, code };
      };
      let payout: WooviPayout | null;
      try { payout = await readPayout(id); } catch { return wooviProgress(null, { ...context, unreachable: true }); }
      // Duplicate submits never re-approve: anything past PENDING is only observed.
      if (payout && payout.status !== 'PENDING') return wooviProgress(payout, context);
      if (!payout) {
        let quote: Awaited<ReturnType<typeof freshQuote>>;
        try { quote = await freshQuote(facts); } catch (cause) {
          return cause instanceof Error && cause.message === 'WOOVI_UNREACHABLE' ? wooviProgress(null, { ...context, unreachable: true })
            : { ...wooviProgress(null, context), code: cause instanceof Error ? cause.message : 'WOOVI_QUOTE_REFUSED' };
        }
        if (quote.sourceAmount > BigInt(source.amount)) return recovery('PAYMENT_PROVIDER_REQUOTE_ABOVE_SOURCE');
        if (quote.feeCents > BigInt(facts.maxFeeCents)) return recovery('PAYMENT_PROVIDER_FEE_ABOVE_LIMIT');
        let created: Response;
        try { created = await call('POST', '/api/v1/stablecoin/payout', { value: Number(facts.amountCents), currency, pixKey: key.value, correlationId: id }); }
        catch { return wooviProgress(null, { ...context, unreachable: true }); }
        // Woovi refused to create it (for example an unknown key, insufficient float or OUT limit): the Pix was not sent.
        if (created.status === 400) return recovery('WOOVI_PAYOUT_REFUSED');
        if (created.status !== 200) return wooviProgress(null, { ...context, unreachable: true });
        const body = object(created.body), createdQuote = body.quote ? object(body.quote) : null;
        if (body.correlationId !== id || body.pixKey !== key.value || !createdQuote || createdQuote.inputCurrency !== currency
          || wooviUnits(createdQuote.outputAmount, 2, 'EXACT').toString() !== facts.amountCents) return recovery('WOOVI_PAYOUT_MISMATCH');
        if (wooviUnits(createdQuote.inputAmount, source.asset.decimals, 'CEIL') > BigInt(source.amount)) return recovery('PAYMENT_PROVIDER_REQUOTE_ABOVE_SOURCE');
        if (body.status !== 'PENDING') { try { return wooviProgress(await readPayout(id), context); } catch { return wooviProgress(null, { ...context, unreachable: true }); } }
      }
      let approved: Response;
      try { approved = await call('POST', '/api/v1/stablecoin/payout/approve', { correlationId: id }); }
      catch { return wooviProgress(null, { ...context, unreachable: true }); }
      // 400 also means "already approved": the payout is re-read, never approved twice.
      if (approved.status !== 200 && approved.status !== 400) return wooviProgress(null, { ...context, unreachable: true });
      try { return wooviProgress(await readPayout(id), context); } catch { return wooviProgress(null, { ...context, unreachable: true }); }
    },
    async status({ providerOrderId, amountCents, source, now }): Promise<PaymentProgress> {
      const context = { correlationId: providerOrderId, amountCents, source, now };
      if (!CORRELATION.test(providerOrderId)) fail('PAYMENT_ORDER_MISMATCH');
      try { return wooviProgress(await readPayout(providerOrderId), context); } catch { return wooviProgress(null, { ...context, unreachable: true }); }
    },
    async webhookPublicKeys() {
      const response = await call('GET', '/api/v1/webhook/public-keys');
      if (response.status !== 200) refused(response, 'WEBHOOK_KEYS');
      const keys = object(response.body).public_keys;
      if (!Array.isArray(keys) || !keys.length || keys.length > 8) fail('WOOVI_RESPONSE_INVALID');
      return keys.map(entry => { const key = object(entry).key; return typeof key === 'string' && key.includes('BEGIN PUBLIC KEY') && key.length < 8_192 ? key : fail('WOOVI_RESPONSE_INVALID'); });
    },
  };
}

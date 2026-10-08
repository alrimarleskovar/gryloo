// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: how a rendered WhatsApp message leaves FloFi.
 *
 *   fixture   records the request in process memory and answers like the Cloud API with a synthetic message id. Nothing leaves the
 *             machine. The provider of tests and local MOCKED demonstrations, and the only one usable without recorded clearance (D1).
 *   graph     the Cloud API over HTTPS (`core/provider-http.ts`): `POST https://graph.facebook.com/<version>/<phone number id>/messages`,
 *             the bearer token only in the Authorization header, no redirects, 10 s, a 64 KiB answer cap.
 *
 * Answers become Channel Core's closed failure classes (`SendFailure`), from the Cloud API's error codes:
 *   PERMANENT     131047 (customer service window closed), 368 (policy restriction), 0/10/190 (authorization), 131026/130403/131021
 *                 (recipient undeliverable), any other 4xx
 *   RATE_LIMITED  HTTP 429, 4/80007/130429 (throughput), 131056 (pair rate limit) — retried after the backoff or Retry-After
 *   TRANSIENT     131000/131016/131057/133004 and a 5xx carrying the API's error body: the API reported it did not take the message;
 *                 a connection that never reached Meta
 *   UNCERTAIN     a timeout or lost connection, a 5xx without the API's error body, a 2xx without a message id: Meta may have taken it,
 *                 so it is never resent; Meta's status webhook (it echoes `biz_opaque_callback_data`) confirms it
 * No outcome carries the token, the request or the answer's body.
 */
import { randomBytes } from 'node:crypto';
import { providerRequest, type ProviderHttpResult } from '../core/provider-http.ts';
import type { SendResult } from '../core/types.ts';

export type WhatsAppTransport = (request: { readonly body: Record<string, unknown> }) => Promise<ProviderHttpResult>;
export const GRAPH_HOST = 'https://graph.facebook.com';

export type FixtureRecord = { readonly at: Date; readonly body: Record<string, unknown> };
/** A recording transport: what would have been sent, kept in memory for tests and local MOCKED demonstrations only. */
export function fixtureTransport(record: FixtureRecord[] = []): WhatsAppTransport & { readonly sent: readonly FixtureRecord[] } {
  const transport = (async request => {
    record.push({ at: new Date(), body: structuredClone(request.body) });
    return { kind: 'ANSWER', status: 200, retryAfterMs: null,
      body: JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.FIXTURE${randomBytes(12).toString('hex')}` }] }) };
  }) as WhatsAppTransport & { sent: readonly FixtureRecord[] };
  Object.defineProperty(transport, 'sent', { value: record });
  return transport;
}

/** The live Cloud API transport (reachable only with recorded policy clearance, see `config.ts`). */
export function graphTransport(options: { readonly accessToken: string; readonly graphVersion: string; readonly phoneNumberId: string; readonly timeoutMs?: number },
  fetchImpl: typeof fetch = fetch): WhatsAppTransport {
  if (!/^v[0-9]{2,3}\.0$/.test(options.graphVersion) || !/^[0-9]{5,32}$/.test(options.phoneNumberId)) throw new Error('WHATSAPP_TRANSPORT_INVALID');
  const url = `${GRAPH_HOST}/${options.graphVersion}/${options.phoneNumberId}/messages`;
  return ({ body }) => providerRequest({ url, body: JSON.stringify(body), timeoutMs: options.timeoutMs ?? 10_000,
    headers: { authorization: `Bearer ${options.accessToken}`, 'content-type': 'application/json' } }, fetchImpl);
}

const RATE_CODES = new Set([4, 80007, 130429, 131056]);
const TRANSIENT_CODES = new Set([1, 2, 131000, 131016, 131057, 133004]);
const PERMANENT: Readonly<Record<number, string>> = { 131047: 'PROVIDER_WINDOW_CLOSED', 368: 'PROVIDER_POLICY_RESTRICTED', 0: 'PROVIDER_AUTHORIZATION',
  10: 'PROVIDER_AUTHORIZATION', 190: 'PROVIDER_AUTHORIZATION', 131026: 'PROVIDER_UNDELIVERABLE', 130403: 'PROVIDER_UNDELIVERABLE', 131021: 'PROVIDER_UNDELIVERABLE',
  132000: 'PROVIDER_TEMPLATE_INVALID', 132001: 'PROVIDER_TEMPLATE_INVALID', 132005: 'PROVIDER_TEMPLATE_INVALID', 132012: 'PROVIDER_TEMPLATE_INVALID' };
const failed = (code: string, failure: Extract<SendResult, { ok: false }>['failure'], retryAfterMs: number | null = null): SendResult =>
  ({ ok: false, code, failure, retryAfterMs });

/** A Cloud API answer (or network failure) as a closed outcome. */
export function classifyResponse(result: ProviderHttpResult): SendResult {
  if (result.kind !== 'ANSWER') return failed(result.code, result.kind === 'NOT_SENT' ? 'TRANSIENT' : 'UNCERTAIN');
  type Answer = { readonly messages?: readonly { readonly id?: unknown }[]; readonly error?: { readonly code?: unknown } };
  let parsed: Answer | null;
  try { parsed = JSON.parse(result.body) as Answer; } catch { parsed = null; }
  if (result.status >= 200 && result.status < 300) {
    const id = parsed?.messages?.[0]?.id;
    return typeof id === 'string' && /^[A-Za-z0-9_.=+/:-]{1,512}$/.test(id) ? { ok: true, providerMessageId: id } : failed('PROVIDER_RESPONSE_INVALID', 'UNCERTAIN');
  }
  const code = typeof parsed?.error?.code === 'number' ? parsed.error.code : null;
  if (code !== null && PERMANENT[code]) return failed(PERMANENT[code]!, 'PERMANENT');
  if (result.status === 429 || (code !== null && RATE_CODES.has(code))) return failed('PROVIDER_THROTTLED', 'RATE_LIMITED', result.retryAfterMs);
  if (code !== null && TRANSIENT_CODES.has(code)) return failed('PROVIDER_UNAVAILABLE', 'TRANSIENT', result.retryAfterMs);
  if (result.status >= 500) return code !== null ? failed('PROVIDER_UNAVAILABLE', 'TRANSIENT', result.retryAfterMs) : failed('PROVIDER_GATEWAY_ERROR', 'UNCERTAIN');
  return failed('PROVIDER_REJECTED', 'PERMANENT');
}

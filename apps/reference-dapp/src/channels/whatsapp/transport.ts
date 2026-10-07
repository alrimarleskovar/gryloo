// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: how a rendered WhatsApp message leaves FloFi.
 *
 *   fixture   (the only transport reachable in this build, owner decision D1) — records the request in process memory and answers like
 *             the Cloud API with a synthetic message id. Nothing leaves the machine.
 *   graph     the Cloud API over HTTPS: one fixed host, the bearer token only in the Authorization header, no redirects, a hard
 *             timeout and a byte cap. Implemented for a future, policy-cleared activation and exercised only against a fake `fetch`.
 *
 * Provider errors become closed classes: throughput and transient errors are retryable; the customer-service-window, policy (368),
 * authorization (0/10/190) and undeliverable errors are terminal. No error carries the token, the request or the response body.
 */
import { randomBytes } from 'node:crypto';

export type TransportResponse = { readonly status: number; readonly body: string };
export type WhatsAppTransport = (request: { readonly body: Record<string, unknown> }) => Promise<TransportResponse>;
export const GRAPH_HOST = 'https://graph.facebook.com';
const MAX_RESPONSE_BYTES = 65_536;

export type FixtureRecord = { readonly at: Date; readonly body: Record<string, unknown> };
/** A recording transport: what would have been sent, kept in memory for tests and local MOCKED demonstrations only. */
export function fixtureTransport(record: FixtureRecord[] = []): WhatsAppTransport & { readonly sent: readonly FixtureRecord[] } {
  const transport = (async request => {
    record.push({ at: new Date(), body: structuredClone(request.body) });
    return { status: 200, body: JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: `wamid.FIXTURE${randomBytes(12).toString('hex')}` }] }) };
  }) as WhatsAppTransport & { sent: readonly FixtureRecord[] };
  Object.defineProperty(transport, 'sent', { value: record });
  return transport;
}

/** The live Cloud API transport (unreachable in this build: the adapter configuration refuses the `live` provider). */
export function graphTransport(options: { readonly accessToken: string; readonly graphVersion: string; readonly phoneNumberId: string; readonly timeoutMs?: number },
  fetchImpl: typeof fetch = fetch): WhatsAppTransport {
  if (!/^v[0-9]{2,3}\.0$/.test(options.graphVersion) || !/^[0-9]{5,32}$/.test(options.phoneNumberId)) throw new Error('WHATSAPP_TRANSPORT_INVALID');
  const url = `${GRAPH_HOST}/${options.graphVersion}/${options.phoneNumberId}/messages`;
  return async ({ body }) => {
    try {
      const response = await fetchImpl(url, { method: 'POST', body: JSON.stringify(body), redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000), headers: { authorization: `Bearer ${options.accessToken}`, 'content-type': 'application/json' } });
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) { await response.body?.cancel().catch(() => undefined); return { status: 502, body: '' }; }
      const text = await response.text();
      return { status: response.status, body: text.length > MAX_RESPONSE_BYTES ? '' : text };
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : '';
      return { status: name === 'TimeoutError' || name === 'AbortError' ? 504 : 503, body: '' };
    }
  };
}

export type SendOutcome = { readonly ok: true; readonly providerMessageId: string } | { readonly ok: false; readonly code: string; readonly retryable: boolean };
const RETRYABLE_CODES = new Set([4, 80007, 130429, 131000, 131016, 131056, 131057, 133004]);
const TERMINAL: Readonly<Record<number, string>> = { 131047: 'PROVIDER_WINDOW_CLOSED', 368: 'PROVIDER_POLICY_RESTRICTED', 0: 'PROVIDER_AUTHORIZATION', 10: 'PROVIDER_AUTHORIZATION',
  190: 'PROVIDER_AUTHORIZATION', 131026: 'PROVIDER_UNDELIVERABLE', 130403: 'PROVIDER_UNDELIVERABLE', 131021: 'PROVIDER_UNDELIVERABLE' };
/** A Cloud API answer as a closed outcome. */
export function classifyResponse(response: TransportResponse): SendOutcome {
  type Answer = { readonly messages?: readonly { readonly id?: unknown }[]; readonly error?: { readonly code?: unknown } };
  let parsed: Answer | null;
  try { parsed = JSON.parse(response.body) as Answer; } catch { parsed = null; }
  if (response.status >= 200 && response.status < 300) {
    const id = parsed?.messages?.[0]?.id;
    return typeof id === 'string' && /^[A-Za-z0-9_.=+/:-]{1,512}$/.test(id) ? { ok: true, providerMessageId: id } : { ok: false, code: 'PROVIDER_RESPONSE_INVALID', retryable: false };
  }
  const code = typeof parsed?.error?.code === 'number' ? parsed.error.code : null;
  if (code !== null && TERMINAL[code]) return { ok: false, code: TERMINAL[code]!, retryable: false };
  if (response.status === 429 || (code !== null && RETRYABLE_CODES.has(code))) return { ok: false, code: 'PROVIDER_THROTTLED', retryable: true };
  if (response.status >= 500) return { ok: false, code: 'PROVIDER_UNAVAILABLE', retryable: true };
  return { ok: false, code: 'PROVIDER_REJECTED', retryable: false };
}

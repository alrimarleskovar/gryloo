// SPDX-License-Identifier: Apache-2.0
/**
 * Webhook verification (Standard Webhooks). FloFi signs `<webhook-id>.<webhook-timestamp>.<raw body>` with HMAC-SHA-256 under the
 * endpoint's secret (`whsec_<base64 key>`) and sends `webhook-signature: v1,<base64 signature>`. Verify the RAW body (before any JSON
 * parsing), reject timestamps outside the tolerance (default ±5 minutes) and deduplicate on `webhook-id`: retries and rotations deliver
 * the same event id more than once. Web Crypto only, so it runs on Node ≥ 20 and edge runtimes.
 *
 * A webhook is a notification, never an instruction: fetch the approval or execution from the API for its current state.
 */
import { FloFiWebhookError } from './errors.js';
import type { WebhookEvent } from './types.js';

export type WebhookHeaders = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
export type VerifyWebhookOptions = {
  /** The raw request body, exactly as received. */
  readonly payload: string | Uint8Array;
  readonly headers: WebhookHeaders;
  /** The endpoint's `whsec_` secret; during a rotation, both the old and the new one. */
  readonly secret: string | readonly string[];
  /** Accepted clock difference in seconds (default 300). */
  readonly toleranceSeconds?: number;
  /** The current time (default `Date.now()`), for tests. */
  readonly now?: () => number;
};

const header = (headers: WebhookHeaders, name: string): string | null => {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name);
  const record = headers as Record<string, string | readonly string[] | undefined>;
  const key = Object.keys(record).find(k => k.toLowerCase() === name), value = key === undefined ? undefined : record[key];
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null;
};
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new FloFiWebhookError('WEBHOOK_SECRET_INVALID');
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const toBase64 = (bytes: Uint8Array) => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };
/** Constant-time comparison of two ASCII strings of any length. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function sign(secret: string, content: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!secret.startsWith('whsec_')) throw new FloFiWebhookError('WEBHOOK_SECRET_INVALID');
  const key = await crypto.subtle.importKey('raw', fromBase64(secret.slice('whsec_'.length)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, content)));
}

/** Verifies a FloFi webhook delivery and returns its event; throws `FloFiWebhookError` when it must not be trusted. */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<WebhookEvent> {
  const id = header(options.headers, 'webhook-id'), timestamp = header(options.headers, 'webhook-timestamp'), signatures = header(options.headers, 'webhook-signature');
  if (!id || !timestamp || !signatures) throw new FloFiWebhookError('WEBHOOK_HEADERS_MISSING');
  if (!/^\d{1,12}$/.test(timestamp)) throw new FloFiWebhookError('WEBHOOK_TIMESTAMP_INVALID');
  const now = Math.floor((options.now?.() ?? Date.now()) / 1000), tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(now - Number(timestamp)) > tolerance) throw new FloFiWebhookError('WEBHOOK_TIMESTAMP_OUT_OF_RANGE');
  const body = typeof options.payload === 'string' ? options.payload : new TextDecoder('utf-8', { fatal: true }).decode(options.payload);
  const content = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const secrets = typeof options.secret === 'string' ? [options.secret] : [...options.secret];
  if (secrets.length === 0) throw new FloFiWebhookError('WEBHOOK_SECRET_INVALID');
  const offered = signatures.split(' ').filter(s => s.startsWith('v1,')).map(s => s.slice(3));
  let valid = false;
  for (const secret of secrets) {
    const expected = await sign(secret, content);
    for (const candidate of offered) valid = same(candidate, expected) || valid;
  }
  if (!valid) throw new FloFiWebhookError('WEBHOOK_SIGNATURE_INVALID');
  let event: unknown;
  try { event = JSON.parse(body); } catch { throw new FloFiWebhookError('WEBHOOK_PAYLOAD_INVALID'); }
  if (!event || typeof event !== 'object' || (event as { id?: unknown }).id !== id || (event as { object?: unknown }).object !== 'event')
    throw new FloFiWebhookError('WEBHOOK_PAYLOAD_INVALID');
  return event as WebhookEvent;
}

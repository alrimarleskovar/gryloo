// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: one HTTPS request to a messaging provider's API (WhatsApp Cloud API, Telegram Bot API), the same way for every
 * provider: a fixed origin chosen by the adapter, no redirects, a hard timeout, a response byte cap, no cache. Nothing here logs: the
 * URL can hold a credential (Telegram puts the bot token in the path) and the body holds a user's message.
 *
 * Network failures are classified for Channel Core's retry policy:
 *   NOT_SENT    the request certainly never reached the provider (DNS failure, connection refused, TLS failure before sending): a retry
 *               cannot duplicate anything
 *   UNCERTAIN   the request may have reached the provider (a timeout, a reset or an abort after the connection was open): retrying could
 *               deliver the message twice
 */
import { randomBytes } from 'node:crypto';

export type ProviderAnswer = { readonly kind: 'ANSWER'; readonly status: number; readonly body: string; readonly retryAfterMs: number | null };
export type ProviderNetworkFailure = { readonly kind: 'NOT_SENT' | 'UNCERTAIN'; readonly code: string };
export type ProviderHttpResult = ProviderAnswer | ProviderNetworkFailure;
export type ProviderRequest = { readonly url: string; readonly method?: 'GET' | 'POST'; readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array; readonly timeoutMs?: number; readonly maxBytes?: number };

/** BUILD-WORKFLOW-VISUAL-PRESENTATION-001: one file of a multipart upload (a rendered picture), sent as bytes. */
export type MultipartFile = { readonly field: string; readonly filename: string; readonly mimeType: string; readonly bytes: Uint8Array };
const FIELD = /^[A-Za-z0-9_.-]{1,64}$/;
/**
 * A `multipart/form-data` body (RFC 7578) of plain text fields and one file, for the providers' media uploads (Telegram `sendPhoto`,
 * WhatsApp `/media`). Field names, file name and type are FloFi's own constants; a random boundary that appears in no part is chosen.
 */
export function multipartBody(fields: Readonly<Record<string, string>>, file: MultipartFile): { readonly body: Uint8Array; readonly contentType: string } {
  if (![...Object.keys(fields), file.field].every(name => FIELD.test(name)) || !FIELD.test(file.filename) || !/^[a-z]+\/[a-z0-9.+-]+$/.test(file.mimeType))
    throw new Error('MULTIPART_INVALID');
  for (;;) {
    const boundary = `flofi-${randomBytes(18).toString('hex')}`, marker = Buffer.from(boundary);
    const text = Object.entries(fields).map(([name, value]) => `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
    const parts = [Buffer.from(text), Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
      `content-type: ${file.mimeType}\r\n\r\n`), Buffer.from(file.bytes), Buffer.from(`\r\n--${boundary}--\r\n`)];
    if (Object.values(fields).some(value => value.includes(boundary)) || Buffer.from(file.bytes).includes(marker)) continue;
    return { body: new Uint8Array(Buffer.concat(parts)), contentType: `multipart/form-data; boundary=${boundary}` };
  }
}

const NOT_SENT_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UND_ERR_CONNECT_TIMEOUT']);
/** The innermost system error code of a fetch failure (undici wraps it as `cause`). */
function causeCode(error: unknown): string | null {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++)
    if (typeof e.code === 'string' && e.code !== 'ERR_INVALID_STATE') return e.code;
  return null;
}
/** Retry-After in seconds (the only form providers use here), bounded to a day. */
export function retryAfterHeader(value: string | null): number | null {
  if (!value || !/^[0-9]{1,6}$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()), 86_400) * 1000;
}

export async function providerRequest(request: ProviderRequest, fetchImpl: typeof fetch = fetch): Promise<ProviderHttpResult> {
  const maxBytes = request.maxBytes ?? 65_536;
  let response: Response;
  try {
    // A binary body (a multipart upload) is passed as an ArrayBuffer-backed copy, which every fetch accepts.
    const body = request.body === undefined ? null : typeof request.body === 'string' ? request.body : new Uint8Array(request.body);
    response = await fetchImpl(request.url, { method: request.method ?? 'POST', body, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(request.timeoutMs ?? 10_000), headers: { ...request.headers } });
  } catch (error) {
    const name = error instanceof Error ? error.name : '', code = causeCode(error);
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'UNCERTAIN', code: 'PROVIDER_TIMEOUT' };
    if (code && NOT_SENT_CODES.has(code)) return { kind: 'NOT_SENT', code: 'PROVIDER_UNREACHABLE' };
    return { kind: 'UNCERTAIN', code: 'PROVIDER_CONNECTION_LOST' };
  }
  const retryAfterMs = retryAfterHeader(response.headers.get('retry-after'));
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel().catch(() => undefined); return { kind: 'ANSWER', status: response.status, body: '', retryAfterMs }; }
  let text: string;
  try { text = await response.text(); } catch { return { kind: 'ANSWER', status: response.status, body: '', retryAfterMs }; }
  return { kind: 'ANSWER', status: response.status, body: text.length > maxBytes ? '' : text, retryAfterMs };
}

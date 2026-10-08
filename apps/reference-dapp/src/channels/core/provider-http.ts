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
export type ProviderAnswer = { readonly kind: 'ANSWER'; readonly status: number; readonly body: string; readonly retryAfterMs: number | null };
export type ProviderNetworkFailure = { readonly kind: 'NOT_SENT' | 'UNCERTAIN'; readonly code: string };
export type ProviderHttpResult = ProviderAnswer | ProviderNetworkFailure;
export type ProviderRequest = { readonly url: string; readonly method?: 'GET' | 'POST'; readonly headers?: Readonly<Record<string, string>>; readonly body?: string;
  readonly timeoutMs?: number; readonly maxBytes?: number };

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
    response = await fetchImpl(request.url, { method: request.method ?? 'POST', body: request.body ?? null, redirect: 'error', cache: 'no-store',
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

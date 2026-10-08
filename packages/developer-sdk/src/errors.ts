// SPDX-License-Identifier: Apache-2.0
/**
 * Stable errors. `code` is the API's small public set (e.g. UNAUTHORIZED, STRATEGY_CHANGED, RATE_LIMITED) or one of the SDK's own
 * (NETWORK_ERROR, TIMEOUT, INVALID_RESPONSE, FLOFI_SDK_SERVER_ONLY, CONFIGURATION_INVALID); `reason` is FloFi's classified cause.
 */
export type Issue = { readonly path: string; readonly rule: string };
export class FloFiError extends Error {
  override readonly name = 'FloFiError';
  readonly status: number;
  readonly code: string;
  readonly reason: string;
  readonly requestId: string | null;
  readonly issues: readonly Issue[];
  /** Seconds the server asked the client to wait before retrying (429/503), when it said so. */
  readonly retryAfter: number | null;
  constructor(init: { status: number; code: string; reason?: string; message?: string; requestId?: string | null; issues?: readonly Issue[]; retryAfter?: number | null }) {
    super(init.message ?? init.code);
    this.status = init.status;
    this.code = init.code;
    this.reason = init.reason ?? init.code;
    this.requestId = init.requestId ?? null;
    this.issues = init.issues ?? [];
    this.retryAfter = init.retryAfter ?? null;
  }
}
/** A webhook delivery that must not be trusted: missing headers, a bad or stale timestamp, a wrong signature or a malformed payload. */
export class FloFiWebhookError extends Error {
  override readonly name = 'FloFiWebhookError';
  constructor(readonly code: 'WEBHOOK_HEADERS_MISSING' | 'WEBHOOK_TIMESTAMP_INVALID' | 'WEBHOOK_TIMESTAMP_OUT_OF_RANGE' | 'WEBHOOK_SIGNATURE_INVALID'
    | 'WEBHOOK_SECRET_INVALID' | 'WEBHOOK_PAYLOAD_INVALID') { super(code); }
}

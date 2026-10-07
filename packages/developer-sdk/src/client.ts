// SPDX-License-Identifier: Apache-2.0
/**
 * The FloFi Developer API client. Thin by design: it sends typed requests with your server-side API key and returns FloFi's answers.
 * It contains no FloFi logic — FloFi composes, validates, simulates, hands approvals to the end user and executes nothing without
 * that user's own wallet signature in FloFi. Your API key is never a wallet and authorizes no transaction.
 *
 *   - server-side only: constructing it in a browser throws FLOFI_SDK_SERVER_ONLY (and FloFi refuses browser requests anyway)
 *   - creating POSTs get an Idempotency-Key (yours, or a random UUID) that is reused across the client's own retries
 *   - retries only what is safe: GETs and keyed POSTs, after network errors, 429, 502, 503 and 504, honouring Retry-After
 *   - timeouts: 60 s by default, 300 s for simulations; redirects are refused (your key never follows one)
 */
import { FloFiError, type Issue } from './errors.js';
import type { Approval, CapabilitiesQuery, CapabilityList, CreateApprovalRequest, CreateStrategyRequest, CreateWebhookEndpointRequest, DeletedWebhookEndpoint, ErrorBody,
  Evidence, Execution, SimulateStrategyRequest, Simulation, Strategy, StrategyValidation, WebhookEndpoint } from './types.js';

export const SDK_VERSION = '0.1.0';
export const API_PATH = '/api/developer/v1';
export type FloFiOptions = {
  /** Your FloFi Developer API key (`flofi_sk_test_…`). Keep it in your server's secret store. */
  readonly apiKey: string;
  /** The FloFi deployment's origin, e.g. `https://flofi.example`. */
  readonly baseUrl: string;
  /** A fetch implementation (default: the global `fetch`). */
  readonly fetch?: typeof fetch;
  /** Request timeout in milliseconds (default 60 000; simulations 300 000). */
  readonly timeoutMs?: number;
  /** Retries of safe requests (default 2). */
  readonly maxRetries?: number;
  /** The longest Retry-After the client waits for itself (default 20 000 ms); longer ones are returned as errors. */
  readonly maxRetryDelayMs?: number;
};
export type RequestOptions = { readonly idempotencyKey?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal };

type Method = 'GET' | 'POST' | 'DELETE';
type Call = { readonly method: Method; readonly path: string; readonly query?: Readonly<Record<string, string | undefined>>; readonly body?: unknown;
  readonly idempotent?: boolean; readonly timeoutMs?: number; readonly options?: RequestOptions };
const KEY = /^flofi_sk_(test|live)_[A-Za-z0-9_-]{43}$/;
const RETRYABLE = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const id = (value: string) => encodeURIComponent(value);

export class FloFi {
  readonly #key: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #maxRetryDelayMs: number;

  constructor(options: FloFiOptions) {
    // Server-side only: a key in a browser is a leaked key.
    if ((globalThis as { window?: { document?: unknown } }).window?.document !== undefined)
      throw new FloFiError({ status: 0, code: 'FLOFI_SDK_SERVER_ONLY', message: 'The FloFi SDK runs on your server only; never ship an API key to a browser.' });
    if (typeof options?.apiKey !== 'string' || !KEY.test(options.apiKey)) throw new FloFiError({ status: 0, code: 'CONFIGURATION_INVALID', reason: 'API_KEY_FORMAT' });
    let base: URL;
    try { base = new URL(options.baseUrl); } catch { throw new FloFiError({ status: 0, code: 'CONFIGURATION_INVALID', reason: 'BASE_URL' }); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash || !(base.protocol === 'https:' || base.protocol === 'http:' && loopback))
      throw new FloFiError({ status: 0, code: 'CONFIGURATION_INVALID', reason: 'BASE_URL' });
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new FloFiError({ status: 0, code: 'CONFIGURATION_INVALID', reason: 'FETCH_UNAVAILABLE' });
    this.#key = options.apiKey;
    this.#base = base.origin + base.pathname.replace(/\/+$/, '') + API_PATH;
    this.#fetch = fetchImpl;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#maxRetries = Math.max(0, Math.min(5, options.maxRetries ?? 2));
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 20_000;
  }

  /** What FloFi can do per action × network on this deployment, and why not where it cannot. Any valid key. */
  readonly capabilities = {
    list: (query: CapabilitiesQuery = {}, options?: RequestOptions) =>
      this.#call<CapabilityList>({ method: 'GET', path: '/capabilities', query: { network: query.network, action: query.action }, ...options ? { options } : {} }),
  };
  /** Immutable strategies: FloFi stores the canonical StrategySpec and its workflow hash. A changed intent is a new strategy. */
  readonly strategies = {
    create: (body: CreateStrategyRequest, options?: RequestOptions) =>
      this.#call<Strategy>({ method: 'POST', path: '/strategies', body, idempotent: true, ...options ? { options } : {} }),
    /** Re-checks the stored strategy against FloFi's current engine and deployment. */
    validate: (strategyId: string, options?: RequestOptions) =>
      this.#call<StrategyValidation>({ method: 'POST', path: `/strategies/${id(strategyId)}/validate`, body: {}, ...options ? { options } : {} }),
    /** FloFi's own read-only simulation preview: nothing is stored, signed or sent, and it authorizes nothing. */
    simulate: (strategyId: string, body: SimulateStrategyRequest, options?: RequestOptions) =>
      this.#call<Simulation>({ method: 'POST', path: `/strategies/${id(strategyId)}/simulate`, body, timeoutMs: 300_000, ...options ? { options } : {} }),
  };
  /** Approval handoffs: a FloFi link where the end user proves a wallet, re-simulates, reviews and signs — or not. */
  readonly approvals = {
    create: (body: CreateApprovalRequest | { readonly strategy: Pick<Strategy, 'id' | 'workflowHash'> }, options?: RequestOptions) => {
      const request: CreateApprovalRequest = 'strategy' in body ? { strategyId: body.strategy.id, workflowHash: body.strategy.workflowHash } : body;
      return this.#call<Approval>({ method: 'POST', path: '/approvals', body: request, idempotent: true, ...options ? { options } : {} });
    },
    get: (approvalId: string, options?: RequestOptions) => this.#call<Approval>({ method: 'GET', path: `/approvals/${id(approvalId)}`, ...options ? { options } : {} }),
  };
  /** Runs the end user chose to share with your project (sharing is off by default and can be turned off at any time). */
  readonly executions = {
    get: (executionId: string, options?: RequestOptions) => this.#call<Execution>({ method: 'GET', path: `/executions/${id(executionId)}`, ...options ? { options } : {} }),
    evidence: (executionId: string, options?: RequestOptions) =>
      this.#call<Evidence>({ method: 'GET', path: `/executions/${id(executionId)}/evidence`, ...options ? { options } : {} }),
  };
  /** Signed webhook endpoints. Rotation: create a new endpoint, accept both secrets, then delete the old one. */
  readonly webhookEndpoints = {
    create: (body: CreateWebhookEndpointRequest, options?: RequestOptions) =>
      this.#call<WebhookEndpoint>({ method: 'POST', path: '/webhook-endpoints', body, idempotent: true, ...options ? { options } : {} }),
    delete: (endpointId: string, options?: RequestOptions) =>
      this.#call<DeletedWebhookEndpoint>({ method: 'DELETE', path: `/webhook-endpoints/${id(endpointId)}`, ...options ? { options } : {} }),
  };

  async #call<T>(call: Call): Promise<T> {
    const url = new URL(this.#base + call.path);
    for (const [name, value] of Object.entries(call.query ?? {})) if (value !== undefined) url.searchParams.set(name, value);
    const key = call.idempotent ? call.options?.idempotencyKey ?? crypto.randomUUID() : undefined;
    const retriable = call.method === 'GET' || key !== undefined, timeoutMs = call.options?.timeoutMs ?? call.timeoutMs ?? this.#timeoutMs;
    const headers: Record<string, string> = { authorization: `Bearer ${this.#key}`, accept: 'application/json',
      ...call.body === undefined ? {} : { 'content-type': 'application/json' }, ...key === undefined ? {} : { 'idempotency-key': key } };
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      const abort = () => controller.abort();
      call.options?.signal?.addEventListener('abort', abort, { once: true });
      let status: number, text: string, retryAfter: string | null;
      try {
        const response = await this.#fetch(url, { method: call.method, headers, redirect: 'error', signal: controller.signal,
          ...call.body === undefined ? {} : { body: JSON.stringify(call.body) } });
        status = response.status; retryAfter = response.headers.get('retry-after'); text = await response.text();
      } catch {
        const error = new FloFiError({ status: 0, code: controller.signal.aborted && !call.options?.signal?.aborted ? 'TIMEOUT' : 'NETWORK_ERROR' });
        if (retriable && attempt < this.#maxRetries && !call.options?.signal?.aborted) { await sleep(this.#backoff(attempt)); continue; }
        throw error;
      } finally { clearTimeout(timer); call.options?.signal?.removeEventListener('abort', abort); }
      let parsed: unknown;
      try { parsed = text === '' ? null : JSON.parse(text); } catch { parsed = undefined; }
      if (status >= 200 && status < 300) {
        if (parsed === undefined || parsed === null) throw new FloFiError({ status, code: 'INVALID_RESPONSE' });
        return parsed as T;
      }
      const body = (parsed as ErrorBody | undefined)?.error, wait = retryAfter !== null && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : null;
      const error = new FloFiError({ status, code: typeof body?.code === 'string' ? body.code : `HTTP_${status}`, reason: typeof body?.reason === 'string' ? body.reason : `HTTP_${status}`,
        message: typeof body?.message === 'string' ? body.message : `FloFi answered HTTP ${status}.`, requestId: typeof body?.requestId === 'string' ? body.requestId : null,
        issues: Array.isArray(body?.issues) ? body.issues as Issue[] : [], retryAfter: wait });
      const transient = RETRYABLE.has(status) || status === 409 && error.code === 'IDEMPOTENCY_IN_PROGRESS';
      const delay = wait !== null ? wait * 1000 : this.#backoff(attempt);
      if (retriable && transient && attempt < this.#maxRetries && delay <= this.#maxRetryDelayMs) { await sleep(delay); continue; }
      throw error;
    }
  }
  #backoff(attempt: number) { return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250); }
}

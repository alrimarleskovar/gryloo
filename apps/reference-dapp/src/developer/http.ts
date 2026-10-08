// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the HTTP boundary of the FloFi Developer API (`/api/developer/v1/*`), framework-free (the Next.js route only
 * passes the request through). Order of checks, each failing closed before any engine work:
 *
 *   enablement → browser refusal (an `Origin` or `Sec-Fetch-Site` header: API keys are server-side only, no CORS) → API key (a
 *   live key is refused: no production in this build) → the project's request rate → route and method → scope → closed input
 *   schemas → idempotency → the operation (`service.ts`) → the output guard → the response.
 *
 * A key is digested and looked up in PostgreSQL on every request (revocation and disabling are immediate). Every response carries a
 * `request-id` and `cache-control: no-store`. Logs carry ids, the route TEMPLATE, status, code and duration — never the key, a body,
 * a query value, an address, an approval URL, a webhook URL or a secret. Work after the response (event sync and webhook delivery for
 * the project, usage counters, retention) is handed to `schedule` (Next.js `after()`); nothing the developer sees depends on it.
 *
 * `/internal/dispatch` (GET for Vercel Cron, or POST) is not an API-key route: a scheduler's bearer whose SHA-256 is
 * FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256 runs one bounded event sync and delivery sweep for the whole deployment. Without that
 * setting it does not exist (404).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { TSchema } from '@sinclair/typebox';
import { createIdempotencyStore, IDEMPOTENCY_KEY, requestHash } from '@defi-workflow-engine/cloud-runtime';
import { compileSchema, strategyInputIssues } from '../engine/strategy-spec';
import { assertSafeOutput, createPgHandoffStore, deploymentEngineRuntime, fixedWindow, typedId, type ApprovalHost, type EngineRuntime } from '../platform/index.ts';
import { platformStateHost } from '../server/platform-state-host.ts';
import { readDeveloperConfig, type DeveloperConfig, type DeveloperScope } from './config.ts';
import { syncAndDispatch, type WebhookTransport } from './dispatch.ts';
import { classify, DeveloperError, fail, PUBLIC_ERRORS } from './errors.ts';
import { apiKeyDigest, presentedKey } from './keys.ts';
import { limitsOf } from './limits.ts';
import { createPgDeveloperStore } from './pg-store.ts';
import { CapabilitiesQuery, CreateApprovalRequest, CreateStrategyRequest, CreateWebhookEndpointRequest, SimulateStrategyRequest, ValidateStrategyRequest,
  type ApprovalBody, type WebhookEndpointBody } from './schemas.ts';
import { createApproval, createStrategy, createWebhookEndpoint, deleteWebhookEndpoint, getApproval, getEvidence, getExecution, limitBucket, listCapabilities,
  replayApproval, simulateStoredStrategy, validateStoredStrategy, type DeveloperContext } from './service.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Fields = Readonly<Record<string, string | number | boolean | null>>;
export type DeveloperLogger = { readonly info: (event: string, fields?: Fields) => void; readonly warn: (event: string, fields?: Fields) => void };
export type DeveloperHttpOptions = {
  readonly env?: Env; readonly runtime?: EngineRuntime;
  /** The deployment's database and tenant (default: the shared durable platform state host). */
  readonly host?: ApprovalHost;
  readonly now?: () => Date; readonly logger?: DeveloperLogger;
  /** Runs work after the response (Next.js `after()`); tests pass a collector. Without it, that work runs before responding. */
  readonly schedule?: (work: () => Promise<unknown>) => void;
  /** Webhook delivery transport (default: pinned HTTPS; loopback HTTP only with the local test seam). */
  readonly transport?: WebhookTransport;
};
/** Bounds of the sweeps: after a Developer API response, and one scheduler call. */
export const AFTER_REQUEST_SWEEP = Object.freeze({ approvals: 3, deliveries: 5, minAgeMs: 15_000 });
export const SCHEDULED_SWEEP = Object.freeze({ approvals: 50, deliveries: 50 });
export const DEVELOPER_API_PREFIX = '/api/developer/v1';
export const DEVELOPER_MAX_BODY_BYTES = 65_536;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

type Method = 'GET' | 'POST' | 'DELETE';
type Input = { readonly params: readonly string[]; readonly body: Record<string, unknown>; readonly query: Record<string, string> };
type Route = {
  readonly method: Method; readonly path: RegExp; readonly template: string; readonly scope: DeveloperScope | null;
  /** Closed schema of the JSON body (POST) or the query (GET); `null` = none may be sent. */
  readonly input: TSchema | null; readonly status: 200 | 201;
  /** Idempotent creation: the operation name of its idempotency scope, what is stored for a replay, and how a replay is answered. */
  readonly idempotent?: { readonly operation: string; readonly stored: (body: unknown) => unknown; readonly replay?: (ctx: DeveloperContext, stored: unknown) => Promise<unknown> };
  /** A usage metric counted after a success (write-side metering only). */
  readonly metric?: (body: unknown) => { readonly metric: string; readonly dimension: string };
  readonly run: (ctx: DeveloperContext, input: Input) => Promise<unknown>;
};
const ID = (prefix: string) => `(${prefix}_[a-z2-7]{26})`;
const EXECUTION = '([A-Za-z0-9][A-Za-z0-9._-]{0,127})';
const ROUTES: readonly Route[] = [
  { method: 'GET', path: /^\/capabilities$/, template: '/capabilities', scope: null, input: CapabilitiesQuery, status: 200, run: (ctx, i) => listCapabilities(ctx, i.query) },
  { method: 'POST', path: /^\/strategies$/, template: '/strategies', scope: 'strategies', input: CreateStrategyRequest, status: 201,
    idempotent: { operation: 'strategies.create', stored: body => body }, metric: () => ({ metric: 'strategy.create', dimension: '' }),
    run: (ctx, i) => createStrategy(ctx, i.body as { strategy: unknown }) },
  { method: 'POST', path: new RegExp(`^/strategies/${ID('str')}/validate$`), template: '/strategies/{id}/validate', scope: 'strategies', input: ValidateStrategyRequest,
    status: 200, run: (ctx, i) => validateStoredStrategy(ctx, i.params[0]!) },
  { method: 'POST', path: new RegExp(`^/strategies/${ID('str')}/simulate$`), template: '/strategies/{id}/simulate', scope: 'strategies', input: SimulateStrategyRequest,
    status: 200, metric: body => ({ metric: 'simulation.run', dimension: String((body as { kind?: unknown }).kind ?? '') }),
    run: (ctx, i) => simulateStoredStrategy(ctx, i.params[0]!, i.body as { simulationSubject: string }) },
  { method: 'POST', path: /^\/approvals$/, template: '/approvals', scope: 'approvals', input: CreateApprovalRequest, status: 201,
    // The approval link is a credential to SEE the proposal: never stored; a replay mints a fresh short-lived one.
    idempotent: { operation: 'approvals.create', stored: body => ({ ...body as ApprovalBody, approvalUrl: null, approvalUrlExpiresAt: null }),
      replay: (ctx, stored) => replayApproval(ctx, stored as ApprovalBody) },
    metric: body => ({ metric: 'approval.create', dimension: (body as ApprovalBody).executionPlan.kind }),
    run: (ctx, i) => createApproval(ctx, i.body as { strategyId: string; workflowHash: string }) },
  { method: 'GET', path: new RegExp(`^/approvals/${ID('apr')}$`), template: '/approvals/{id}', scope: 'approvals', input: null, status: 200,
    run: (ctx, i) => getApproval(ctx, i.params[0]!) },
  { method: 'GET', path: new RegExp(`^/executions/${EXECUTION}$`), template: '/executions/{id}', scope: 'executions', input: null, status: 200,
    run: (ctx, i) => getExecution(ctx, i.params[0]!) },
  { method: 'GET', path: new RegExp(`^/executions/${EXECUTION}/evidence$`), template: '/executions/{id}/evidence', scope: 'executions', input: null, status: 200,
    run: (ctx, i) => getEvidence(ctx, i.params[0]!) },
  { method: 'POST', path: /^\/webhook-endpoints$/, template: '/webhook-endpoints', scope: 'webhooks', input: CreateWebhookEndpointRequest, status: 201,
    // The signing secret is returned once: a replay says it was already issued.
    idempotent: { operation: 'webhook-endpoints.create', stored: body => ({ ...body as WebhookEndpointBody, secret: null, secretAlreadyIssued: true }) },
    run: (ctx, i) => createWebhookEndpoint(ctx, i.body as { url: string }) },
  { method: 'DELETE', path: new RegExp(`^/webhook-endpoints/${ID('whe')}$`), template: '/webhook-endpoints/{id}', scope: 'webhooks', input: null, status: 200,
    run: (ctx, i) => deleteWebhookEndpoint(ctx, i.params[0]!) },
];
/** The public route table (method, path template, scope): the OpenAPI document must describe exactly these. */
export const DEVELOPER_ROUTE_TABLE = Object.freeze(ROUTES.map(r => Object.freeze({ method: r.method, template: r.template, scope: r.scope })));
/** Shapes of resource paths whose id is malformed: answered exactly like an absent resource. */
const RESOURCE_SHAPES: readonly { readonly path: RegExp; readonly methods: readonly Method[] }[] = [
  { path: /^\/strategies\/[^/]+\/(validate|simulate)$/, methods: ['POST'] }, { path: /^\/approvals\/[^/]+$/, methods: ['GET'] },
  { path: /^\/executions\/[^/]+(\/evidence)?$/, methods: ['GET'] }, { path: /^\/webhook-endpoints\/[^/]+$/, methods: ['DELETE'] },
];
type Validator = { readonly check: (value: unknown) => boolean; readonly issues: (value: unknown) => readonly { readonly path: string; readonly rule: string }[] };
const validators = new Map<TSchema, Validator>();
const validator = (schema: TSchema): Validator => { let v = validators.get(schema); if (!v) { v = compileSchema(schema); validators.set(schema, v); } return v; };

function json(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...HEADERS, 'request-id': requestId, ...extra } });
}
function errorResponse(error: DeveloperError, requestId: string, extra: Record<string, string> = {}): Response {
  const body = { error: { code: error.code, reason: error.reason, message: PUBLIC_ERRORS[error.code][1], ...error.detail.issues ? { issues: error.detail.issues } : {}, requestId } };
  const retry = error.detail.retryAfter !== undefined ? { 'retry-after': String(Math.max(1, Math.ceil(error.detail.retryAfter))) } : {};
  return json(error.status, body, requestId, { ...retry, ...extra });
}
/** Seconds until a fixed window of `windowSeconds` starts again. */
const untilWindow = (now: Date, windowSeconds: number) => windowSeconds - Math.floor(now.getTime() / 1000) % windowSeconds;
const RETRY_AFTER: Readonly<Record<string, (now: Date) => number>> = Object.freeze({ APPROVALS_PER_HOUR: now => untilWindow(now, 3_600),
  SIMULATIONS_PER_HOUR: now => untilWindow(now, 3_600), PENDING_APPROVALS: () => 60 });

/**
 * Fails closed on anything executable or secret in a response (the platform's guard); only a webhook endpoint's own creation may carry
 * its `whsec_` secret, and a list's `data` envelope key is not transaction data (each item is checked).
 */
function guardOutput(body: unknown): void {
  if (body && typeof body === 'object' && (body as { object?: unknown }).object === 'list' && Array.isArray((body as { data?: unknown }).data)) {
    const { data, ...rest } = body as { data: unknown[] };
    assertSafeOutput(rest);
    for (const item of data) guardOutput(item);
    return;
  }
  if (body && typeof body === 'object' && (body as { object?: unknown }).object === 'webhook_endpoint' && 'secret' in body) {
    const { secret, ...rest } = body as { secret: unknown };
    if (secret !== null && !(typeof secret === 'string' && /^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))) throw new Error('OUTPUT_GUARD');
    assertSafeOutput(rest);
    return;
  }
  assertSafeOutput(body);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > DEVELOPER_MAX_BODY_BYTES) fail('INVALID_REQUEST', 'REQUEST_TOO_LARGE', { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > DEVELOPER_MAX_BODY_BYTES) fail('INVALID_REQUEST', 'REQUEST_TOO_LARGE', { status: 413 });
  if (text.trim() === '') return null;
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) fail('INVALID_REQUEST', 'CONTENT_TYPE_NOT_JSON');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('INVALID_REQUEST', 'MALFORMED_JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST', 'BODY_NOT_OBJECT');
  return value as Record<string, unknown>;
}
/** The closed-schema check of a request; a strategy is reported against its own action's schema (as MCP does), never echoed. */
function checked(schema: TSchema, value: Record<string, unknown>): Record<string, unknown> {
  const v = validator(schema);
  if (v.check(value)) return value;
  if (schema === CreateStrategyRequest && Object.keys(value).length === 1 && 'strategy' in value) {
    const issues = strategyInputIssues(value.strategy).map(i => ({ path: '/strategy' + (i.path === '/' ? '' : i.path), rule: i.rule }));
    fail('INVALID_STRATEGY', 'STRATEGY_SCHEMA_INVALID', { issues: issues.slice(0, 50) });
  }
  return fail('INVALID_REQUEST', 'SCHEMA_INVALID', { issues: v.issues(value).slice(0, 50).map(i => ({ path: i.path, rule: i.rule })) });
}
function queryOf(url: URL): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) { if (Object.hasOwn(query, key)) fail('INVALID_REQUEST', 'QUERY_PARAMETER_REPEATED'); query[key] = value; }
  return query;
}

async function hostOf(env: Env, options: DeveloperHttpOptions): Promise<ApprovalHost> {
  if (options.host) return options.host;
  try { return await platformStateHost(env); }
  catch { return fail('SERVICE_UNAVAILABLE', 'DEVELOPER_STORE_UNAVAILABLE'); }
}

/** The scheduler's sweep: one bounded event sync and delivery pass for every project of this deployment. */
async function internalDispatch(request: Request, method: string, config: DeveloperConfig, env: Env, options: DeveloperHttpOptions, requestId: string) {
  if (method !== 'GET' && method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'METHOD_NOT_ALLOWED');
  if (request.headers.get('origin') !== null || request.headers.get('sec-fetch-site') !== null) fail('FORBIDDEN', 'BROWSER_ORIGIN_FORBIDDEN');
  if (!config.dispatchTokenDigest) return fail('NOT_FOUND', 'ROUTE_NOT_FOUND');
  const bearer = /^Bearer ([^\s]{16,512})$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (!timingSafeEqual(createHash('sha256').update(bearer, 'utf8').digest(), config.dispatchTokenDigest)) fail('UNAUTHORIZED', 'DISPATCH_TOKEN_INVALID');
  const host = await hostOf(env, options), store = createPgDeveloperStore(host.db, host.tenantId);
  const result = await syncAndDispatch({ config, tenantId: host.tenantId, store, handoffs: createPgHandoffStore(host.db, host.tenantId),
    runtime: options.runtime ?? deploymentEngineRuntime(env), ...options.transport ? { transport: options.transport } : {}, ...options.now ? { now: options.now } : {} },
  {}, SCHEDULED_SWEEP);
  if (Math.random() < 0.1) await store.purge(options.now?.() ?? new Date());
  return json(200, { object: 'dispatch', approvalsSynced: result.approvals, deliveries: result.deliveries }, requestId);
}

export async function handleDeveloperRequest(request: Request, options: DeveloperHttpOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, logger = options.logger, clock = options.now ?? (() => new Date()), started = performance.now();
  const requestId = typedId('req'), now = clock();
  const log: Record<string, string | number | boolean | null> = { request_id: requestId, method: request.method, route: 'UNMATCHED' };
  const finish = (response: Response, code: string) => {
    logger?.info('developer.request', { ...log, status: response.status, code, duration_ms: Math.round(performance.now() - started) });
    return response;
  };
  const config = readDeveloperConfig(env);
  if (!config.enabled) {
    if (config.code === 'DEVELOPER_CONFIGURATION_INVALID') logger?.warn('developer.configuration_invalid', { reason: config.reason ?? null });
    const error = config.code === 'DEVELOPER_API_NOT_ENABLED' ? new DeveloperError('NOT_FOUND', 'DEVELOPER_API_NOT_ENABLED')
      : new DeveloperError('SERVICE_UNAVAILABLE', 'DEVELOPER_CONFIGURATION_INVALID');
    return finish(errorResponse(error, requestId), error.reason);
  }
  try {
    const url = new URL(request.url), method = request.method.toUpperCase();
    if (!url.pathname.startsWith(DEVELOPER_API_PREFIX + '/')) fail('NOT_FOUND', 'ROUTE_NOT_FOUND');
    const path = url.pathname.slice(DEVELOPER_API_PREFIX.length).replace(/\/$/, '') || '/';
    if (path === '/internal/dispatch') { log.route = '/internal/dispatch'; return finish(await internalDispatch(request, method, config, env, options, requestId), 'OK'); }
    // Server-side credentials only: a browser context (any Origin, or Fetch Metadata) is refused before the key is even read.
    if (request.headers.get('origin') !== null || request.headers.get('sec-fetch-site') !== null) fail('FORBIDDEN', 'BROWSER_ORIGIN_FORBIDDEN');
    const presented = presentedKey(request.headers.get('authorization'));
    if (!presented.ok) return fail('UNAUTHORIZED', presented.reason === 'MISSING' ? 'API_KEY_REQUIRED' : 'API_KEY_INVALID');
    if (presented.environment !== 'sandbox') return fail('FORBIDDEN', 'LIVE_MODE_DISABLED');
    const host = await hostOf(env, options);
    if (host.tenantId !== config.tenantId) fail('SERVICE_UNAVAILABLE', 'DEVELOPER_STORE_UNAVAILABLE');
    const store = createPgDeveloperStore(host.db, host.tenantId);
    const principal = await store.authenticate(apiKeyDigest(config, presented.key), now).catch(() => fail('SERVICE_UNAVAILABLE', 'DEVELOPER_STORE_UNAVAILABLE'));
    if (!principal || principal.environment !== presented.environment) return fail('UNAUTHORIZED', 'API_KEY_INVALID');
    Object.assign(log, { tenant: host.tenantId, project: principal.projectId, key: principal.keyId, environment: principal.environment });
    const scope = { projectId: principal.projectId, environment: principal.environment }, limits = limitsOf(principal.plan), window = fixedWindow(host.db, host.tenantId);
    const rate = await window.hit(limitBucket(scope, 'requests'), limits.requestsPerMinute, 60, now);
    if (!rate.allowed) fail('RATE_LIMITED', 'REQUESTS_PER_MINUTE', { retryAfter: (rate.resetAt.getTime() - now.getTime()) / 1000 });

    const route = ROUTES.find(r => r.method === method && r.path.test(path));
    if (!route) {
      const allowed = ROUTES.filter(r => r.path.test(path)).map(r => r.method);
      if (allowed.length) return finish(errorResponse(new DeveloperError('METHOD_NOT_ALLOWED', 'METHOD_NOT_ALLOWED'), requestId, { allow: allowed.join(', ') }), 'METHOD_NOT_ALLOWED');
      const shape = RESOURCE_SHAPES.find(s => s.path.test(path));
      return fail('NOT_FOUND', shape?.methods.includes(method as Method) ? 'RESOURCE_NOT_FOUND' : 'ROUTE_NOT_FOUND');
    }
    log.route = route.template;
    if (route.scope && !principal.scopes.includes(route.scope)) fail('FORBIDDEN', 'INSUFFICIENT_SCOPE');
    const query = queryOf(url);
    let body: Record<string, unknown> = {};
    if (method === 'GET') { if (route.input) checked(route.input, query); else if (Object.keys(query).length) fail('INVALID_REQUEST', 'QUERY_NOT_ALLOWED'); }
    else {
      if (Object.keys(query).length) fail('INVALID_REQUEST', 'QUERY_NOT_ALLOWED');
      const read = await readBody(request);
      if (route.input) body = checked(route.input, read ?? {});
      else if (read !== null) fail('INVALID_REQUEST', 'BODY_NOT_ALLOWED');
    }
    const ctx: DeveloperContext = { config, tenantId: host.tenantId, principal, scope, store, handoffs: createPgHandoffStore(host.db, host.tenantId),
      runtime: options.runtime ?? deploymentEngineRuntime(env), limits, allow: window.allow, now };
    const input: Input = { params: route.path.exec(path)!.slice(1), body, query };

    let result: unknown, replayed = false;
    const key = route.idempotent ? request.headers.get('idempotency-key') : null;
    if (route.idempotent && key !== null) {
      if (!IDEMPOTENCY_KEY.test(key)) fail('INVALID_REQUEST', 'IDEMPOTENCY_KEY_INVALID');
      const idem = createIdempotencyStore({ db: host.db, tenantId: host.tenantId });
      const scopeName = `developer/${principal.projectId.slice(4)}/${principal.environment}/${route.idempotent.operation}`, hash = requestHash(scopeName, body);
      const begun = await idem.begin(scopeName, key, hash);
      if (begun.kind === 'CONFLICT') fail('IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT');
      if (begun.kind === 'IN_PROGRESS') fail('IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_IN_PROGRESS', { retryAfter: 1 });
      if (begun.kind === 'REPLAY') {
        replayed = true;
        result = route.idempotent.replay ? await route.idempotent.replay(ctx, begun.response) : begun.response;
      } else {
        try { result = await route.run(ctx, input); } catch (error) { await idem.release(scopeName, key, hash).catch(() => undefined); throw error; }
        await idem.complete(scopeName, key, hash, route.idempotent.stored(result));
      }
    } else result = await route.run(ctx, input);

    try { guardOutput(result); } catch { logger?.warn('developer.output_guard', { request_id: requestId, route: route.template }); return fail('INTERNAL_ERROR', 'OUTPUT_GUARD'); }
    const after = async () => {
      if (route.metric && !replayed) { const m = route.metric(result); await store.incrementUsage(scope, m.metric, m.dimension, now); }
      // This project's notifications advance with its own traffic (the embedded runtime has no worker).
      await syncAndDispatch({ config, tenantId: host.tenantId, store, handoffs: ctx.handoffs, runtime: ctx.runtime, ...options.transport ? { transport: options.transport } : {},
        now: clock }, { scope, minAgeMs: AFTER_REQUEST_SWEEP.minAgeMs }, AFTER_REQUEST_SWEEP);
      // Bounded retention, opportunistically.
      if (Math.random() < 0.01) await store.purge(now);
    };
    const background = () => after().catch(() => logger?.warn('developer.after_failed', { request_id: requestId }));
    if (options.schedule) options.schedule(background); else await background();
    return finish(json(route.status, result, requestId, replayed ? { 'idempotent-replayed': 'true' } : {}), 'OK');
  } catch (cause) {
    const error = classify(cause);
    if (error.code === 'RATE_LIMITED' && error.detail.retryAfter === undefined && RETRY_AFTER[error.reason])
      return finish(errorResponse(new DeveloperError(error.code, error.reason, { ...error.detail, retryAfter: RETRY_AFTER[error.reason]!(now) }), requestId), error.reason);
    if (error.code === 'INTERNAL_ERROR') logger?.warn('developer.internal_error', { request_id: requestId, route: String(log.route) });
    return finish(errorResponse(error, requestId, error.code === 'UNAUTHORIZED' ? { 'www-authenticate': 'Bearer realm="flofi-developer"' } : {}), error.reason);
  }
}

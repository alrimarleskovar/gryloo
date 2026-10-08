// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the OpenAPI 3.1 description of the Developer API v1, generated from the same TypeBox schemas the server validates
 * and answers with (`schemas.ts`), so it cannot drift from the implementation (`openapi.test.ts` compares it with the committed
 * `docs/developer/openapi.json`; regenerate with `UPDATE_DEVELOPER_OPENAPI=1`). The generated document is published under Apache-2.0,
 * like the SDK.
 */
import type { TSchema } from '@sinclair/typebox';
import { NETWORK_IDS, STRATEGY_ACTIONS } from '../engine/strategy-spec';
import { ApprovalView, CapabilityList, CreateApprovalRequest, CreateStrategyRequest, CreateWebhookEndpointRequest, DeletedView, ErrorView, EvidenceView, ExecutionView,
  SimulateStrategyRequest, SimulationView, StrategyValidationView, StrategyView, ValidateStrategyRequest, WebhookEndpointView, WebhookEventView } from './schemas.ts';

const plain = (schema: TSchema): Record<string, unknown> => JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (name: string, description: string) => ({ required: true, description, content: { 'application/json': { schema: ref(name) } } });
const REQUEST_ID = { description: 'This request\'s id (quote it to FloFi support).', schema: { type: 'string', pattern: '^req_[a-z2-7]{26}$' } };
const ok = (status: '200' | '201', name: string, description: string, extra: Record<string, unknown> = {}) =>
  ({ [status]: { description, headers: { 'request-id': REQUEST_ID, ...extra }, content: { 'application/json': { schema: ref(name) } } } });
const ERRORS: Readonly<Record<string, string>> = Object.freeze({
  400: 'INVALID_REQUEST or INVALID_STRATEGY', 401: 'UNAUTHORIZED: missing, malformed, unknown or revoked key, or disabled project',
  403: 'FORBIDDEN (INSUFFICIENT_SCOPE, BROWSER_ORIGIN_FORBIDDEN, LIVE_MODE_DISABLED, WEBHOOK_ENDPOINT_LIMIT) or MAINNET_DISABLED',
  404: 'NOT_FOUND: absent or another project\'s resource (indistinguishable)', 409: 'STRATEGY_CHANGED, STRATEGY_STALE, IDEMPOTENCY_CONFLICT or IDEMPOTENCY_IN_PROGRESS',
  410: 'APPROVAL_EXPIRED', 413: 'INVALID_REQUEST: body larger than 64 KiB', 422: 'CAPABILITY_NOT_SUPPORTED, REVIEW_BLOCKED or SIMULATION_FAILED',
  429: 'RATE_LIMITED (see Retry-After)', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE (see Retry-After when given)' });
const errors = (...statuses: number[]) => Object.fromEntries(statuses.map(s => [String(s), { description: ERRORS[s], headers: { 'request-id': REQUEST_ID },
  content: { 'application/json': { schema: ref('Error') } } }]));
const COMMON = [401, 403, 429, 500, 503];
const IDEMPOTENCY = { name: 'Idempotency-Key', in: 'header', required: false, description: 'Makes this creation safe to retry (8–128 of `A-Z a-z 0-9 . _ : -`, kept 24 h). ' +
  'The same key with another body is IDEMPOTENCY_CONFLICT.', schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' } };
const REPLAYED = { 'idempotent-replayed': { description: '`true` when this is the stored result of an earlier request with the same Idempotency-Key.', schema: { type: 'string' } } };
const id = (prefix: string, description: string) => ({ name: 'id', in: 'path', required: true, description, schema: { type: 'string', pattern: `^${prefix}_[a-z2-7]{26}$` } });
const EXECUTION_ID = { name: 'id', in: 'path', required: true, description: 'A FloFi execution id (from an approval or an event). It is a lookup key, not an access grant.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' } };

export function developerOpenApi(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'FloFi Developer API', version: '1.0.0',
      summary: 'Developers build the experience. FloFi handles the DeFi workflow lifecycle.',
      description: 'Server-side API for third-party applications: discover capabilities, store immutable FloFi strategies, validate and simulate them, and hand ' +
        'them to the end user for approval in FloFi. The API key has zero financial authority: it never signs, submits or approves anything. Only the end ' +
        'user\'s own wallet, in FloFi, after a fresh simulation and the Strategy Manifest Review, can sign. Execution status and evidence are visible only for ' +
        'runs the end user chose to share (off by default). Sandbox credentials only in this release: test funds, every mainnet off.',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' } },
    servers: [{ url: 'https://{deployment}/api/developer/v1', variables: { deployment: { default: 'flofi.example', description: 'Your FloFi deployment\'s host.' } } }],
    security: [{ apiKey: [] }],
    tags: [{ name: 'Discovery' }, { name: 'Strategies' }, { name: 'Approvals' }, { name: 'Executions' }, { name: 'Webhooks' }],
    paths: {
      '/capabilities': { get: { operationId: 'listCapabilities', tags: ['Discovery'], summary: 'What FloFi can do per action and network on this deployment (any valid key).',
        parameters: [{ name: 'network', in: 'query', required: false, schema: { type: 'string', enum: [...NETWORK_IDS] } },
          { name: 'action', in: 'query', required: false, schema: { type: 'string', enum: [...STRATEGY_ACTIONS] } }],
        responses: { ...ok('200', 'CapabilityList', 'Capability rows with the four facts and the operations available.'), ...errors(400, ...COMMON) } } },
      '/strategies': { post: { operationId: 'createStrategy', tags: ['Strategies'], summary: 'Store an immutable strategy (scope `strategies`).',
        parameters: [IDEMPOTENCY], requestBody: body('CreateStrategyRequest', 'A FloFi StrategySpec.'),
        responses: { ...ok('201', 'Strategy', 'The canonical strategy, its workflow hash, plan, review and availability.', REPLAYED), ...errors(400, 409, 413, ...COMMON) } } },
      '/strategies/{id}/validate': { post: { operationId: 'validateStrategy', tags: ['Strategies'], summary: 'Re-check a stored strategy against the current engine and deployment.',
        parameters: [id('str', 'A strategy id.')], requestBody: { ...body('ValidateStrategyRequest', 'Empty object (or no body).'), required: false },
        responses: { ...ok('200', 'StrategyValidation', 'The current review and availability.'), ...errors(400, 404, 409, ...COMMON) } } },
      '/strategies/{id}/simulate': { post: { operationId: 'simulateStrategy', tags: ['Strategies'], summary: 'FloFi\'s own read-only simulation preview (never authorizable).',
        parameters: [id('str', 'A strategy id.')], requestBody: body('SimulateStrategyRequest', 'The account whose public balances the preview reads.'),
        responses: { ...ok('200', 'Simulation', 'The allowlisted facts of the flow\'s own simulation; nothing persisted, signed or sent.'), ...errors(400, 404, 409, 422, ...COMMON) } } },
      '/approvals': { post: { operationId: 'createApproval', tags: ['Approvals'], summary: 'Hand one strategy revision to its owner in FloFi (scope `approvals`).',
        parameters: [IDEMPOTENCY], requestBody: body('CreateApprovalRequest', 'The strategy and its exact workflow hash.'),
        responses: { ...ok('201', 'Approval', 'A PENDING approval and the FloFi link to give the end user (authority NONE).', REPLAYED),
          ...errors(400, 404, 409, 410, 422, ...COMMON) } } },
      '/approvals/{id}': { get: { operationId: 'getApproval', tags: ['Approvals'], summary: 'The approval\'s state; its runs and evidence only while the owner shares them.',
        parameters: [id('apr', 'An approval id.')], responses: { ...ok('200', 'Approval', 'The approval now.'), ...errors(400, 404, ...COMMON) } } },
      '/executions/{id}': { get: { operationId: 'getExecution', tags: ['Executions'], summary: 'A run the owner shared with this project (scope `executions`).',
        parameters: [EXECUTION_ID], responses: { ...ok('200', 'Execution', 'Status and attempts as FloFi\'s durable state records them.'), ...errors(400, 404, ...COMMON) } } },
      '/executions/{id}/evidence': { get: { operationId: 'getEvidence', tags: ['Executions'], summary: 'The reconciled Evidence Bundle of a shared run (never upgraded).',
        parameters: [EXECUTION_ID], responses: { ...ok('200', 'Evidence', 'The canonical Evidence Bundle, or why there is none yet.'), ...errors(400, 404, ...COMMON) } } },
      '/webhook-endpoints': { post: { operationId: 'createWebhookEndpoint', tags: ['Webhooks'], summary: 'Register a signed webhook endpoint (scope `webhooks`).',
        parameters: [IDEMPOTENCY], requestBody: body('CreateWebhookEndpointRequest', 'An https URL on port 443 and, optionally, the event types to receive.'),
        responses: { ...ok('201', 'WebhookEndpoint', 'The endpoint and its signing secret, returned once.', REPLAYED), ...errors(400, 409, 413, ...COMMON) } } },
      '/webhook-endpoints/{id}': { delete: { operationId: 'deleteWebhookEndpoint', tags: ['Webhooks'], summary: 'Delete an endpoint: its secret is never used again.',
        parameters: [id('whe', 'A webhook endpoint id.')], responses: { ...ok('200', 'DeletedWebhookEndpoint', 'Deleted.'), ...errors(400, 404, ...COMMON) } } },
      '/internal/dispatch': { get: { operationId: 'dispatchNotifications', 'x-internal': true, tags: ['Webhooks'], security: [{ dispatchToken: [] }],
        summary: 'For the deployment\'s scheduler only (e.g. Vercel Cron): one bounded event sync and delivery sweep. Absent unless configured.',
        responses: { 200: { description: 'The sweep\'s counts.' }, ...errors(401, 403, 404, 500, 503) } } },
    },
    webhooks: { event: { post: { summary: 'A signed notification (Standard Webhooks). Verify the raw body, reject timestamps outside ±5 min, deduplicate on webhook-id.',
      parameters: [{ name: 'webhook-id', in: 'header', required: true, schema: { type: 'string' }, description: 'The event id: the same on every retry and endpoint.' },
        { name: 'webhook-timestamp', in: 'header', required: true, schema: { type: 'string' }, description: 'Unix seconds of this attempt.' },
        { name: 'webhook-signature', in: 'header', required: true, schema: { type: 'string' },
          description: '`v1,` + base64 HMAC-SHA-256 of `<webhook-id>.<webhook-timestamp>.<raw body>` under the endpoint secret\'s base64 key.' },
        { name: 'flofi-delivery-id', in: 'header', required: true, schema: { type: 'string' } }, { name: 'flofi-delivery-attempt', in: 'header', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: ref('WebhookEvent') } } },
      responses: { 200: { description: 'Any 2xx acknowledges; anything else is retried (30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h, 12 h, 24 h), then dropped.' } } } } },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'A FloFi Developer API key (`flofi_sk_test_…`). Server-side only: browser requests are refused.' },
        dispatchToken: { type: 'http', scheme: 'bearer', description: 'The scheduler token whose SHA-256 is FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256.' } },
      schemas: { CreateStrategyRequest: plain(CreateStrategyRequest), ValidateStrategyRequest: plain(ValidateStrategyRequest), SimulateStrategyRequest: plain(SimulateStrategyRequest),
        CreateApprovalRequest: plain(CreateApprovalRequest), CreateWebhookEndpointRequest: plain(CreateWebhookEndpointRequest), CapabilityList: plain(CapabilityList),
        Strategy: plain(StrategyView), StrategyValidation: plain(StrategyValidationView), Simulation: plain(SimulationView), Approval: plain(ApprovalView),
        Execution: plain(ExecutionView), Evidence: plain(EvidenceView), WebhookEndpoint: plain(WebhookEndpointView), DeletedWebhookEndpoint: plain(DeletedView),
        WebhookEvent: plain(WebhookEventView), Error: plain(ErrorView) } },
  };
}

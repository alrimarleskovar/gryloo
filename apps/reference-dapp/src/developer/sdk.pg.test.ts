// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the TypeScript SDK against the real Developer API handler (its injected `fetch` calls the handler in process; a
 * disposable loopback PostgreSQL; no network). Its types are exactly the server's response schemas (a type-level check that fails on
 * any drift), its errors carry the server's stable codes, and its idempotency keys make creation safe to retry. The SDK holds no FloFi
 * logic: every value it returns came from the server.
 */
import type { Static } from '@sinclair/typebox';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { FloFi, FloFiError } from '../../../../packages/developer-sdk/src/index.ts';
import type * as Sdk from '../../../../packages/developer-sdk/src/types.ts';
import { developerEnv, developerProject, NO_NETWORK, ORIGIN, recordingRuntime } from './developer.test-harness.ts';
import { handleDeveloperRequest } from './http.ts';
import type * as Server from './schemas.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
/** The SDK, whose `fetch` is the real handler (as a third-party server reaches FloFi over HTTPS). */
function sdk(apiKey: string, requests: Request[] = []) {
  const runtime = recordingRuntime();
  return new FloFi({ apiKey, baseUrl: ORIGIN, maxRetryDelayMs: 0, fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return handleDeveloperRequest(request, { env: developerEnv(), host: { db: t.db, tenantId: 'default' }, runtime, transport: NO_NETWORK, schedule: () => undefined });
  }) as typeof fetch });
}

describe('BUILD-DEVELOPER-001 SDK parity', () => {
  it('types every request and response exactly as the server schemas do', () => {
    expectTypeOf<Sdk.CapabilityList>().toEqualTypeOf<Static<typeof Server.CapabilityList>>();
    expectTypeOf<Sdk.Strategy>().toEqualTypeOf<Static<typeof Server.StrategyView>>();
    expectTypeOf<Sdk.StrategyValidation>().toEqualTypeOf<Static<typeof Server.StrategyValidationView>>();
    expectTypeOf<Sdk.Simulation>().toEqualTypeOf<Static<typeof Server.SimulationView>>();
    expectTypeOf<Sdk.Approval>().toEqualTypeOf<Static<typeof Server.ApprovalView>>();
    expectTypeOf<Sdk.Execution>().toEqualTypeOf<Static<typeof Server.ExecutionView>>();
    expectTypeOf<Sdk.Evidence>().toEqualTypeOf<Static<typeof Server.EvidenceView>>();
    expectTypeOf<Sdk.WebhookEndpoint>().toEqualTypeOf<Static<typeof Server.WebhookEndpointView>>();
    expectTypeOf<Sdk.DeletedWebhookEndpoint>().toEqualTypeOf<Static<typeof Server.DeletedView>>();
    expectTypeOf<Sdk.WebhookEvent>().toEqualTypeOf<Static<typeof Server.WebhookEventView>>();
    expectTypeOf<Sdk.ErrorBody>().toEqualTypeOf<Static<typeof Server.ErrorView>>();
    expectTypeOf<Sdk.CreateApprovalRequest>().toEqualTypeOf<Static<typeof Server.CreateApprovalRequest>>();
    expectTypeOf<Sdk.SimulateStrategyRequest>().toEqualTypeOf<Static<typeof Server.SimulateStrategyRequest>>();
    expectTypeOf<Sdk.CreateWebhookEndpointRequest>().toEqualTypeOf<Static<typeof Server.CreateWebhookEndpointRequest>>();
    expectTypeOf<Sdk.DeveloperEventType>().toEqualTypeOf<Static<typeof Server.EventType>>();
  });

  it('drives the real API end to end: create, validate, approve, read, webhook endpoints, errors and idempotent retries', async () => {
    const p = await developerProject(t.db), requests: Request[] = [], flofi = sdk(p.key, requests);
    const capabilities = await flofi.capabilities.list({ network: 'base-sepolia', action: 'bridge' });
    expect(capabilities.data.every(row => row.action === 'bridge')).toBe(true);
    const strategy = await flofi.strategies.create({ strategy: BRIDGE });
    expect(strategy).toMatchObject({ object: 'strategy', environment: 'sandbox', authority: 'NONE', executionPlan: { kind: 'SINGLE_FLOW' } });
    expect((await flofi.strategies.validate(strategy.id)).validation.valid).toBe(true);
    const approval = await flofi.approvals.create({ strategy });
    expect(approval.approvalUrl).toMatch(/\/approve#flofi_dhs_[A-Za-z0-9_-]{43}$/);
    expect(await flofi.approvals.get(approval.id)).toMatchObject({ id: approval.id, status: 'PENDING', approvalUrl: null, statusShared: false });
    const endpoint = await flofi.webhookEndpoints.create({ url: 'https://hooks.example.com/sdk', events: ['execution.reconciled'] });
    expect(endpoint.secret).toMatch(/^whsec_/);
    expect(await flofi.webhookEndpoints.delete(endpoint.id)).toEqual({ id: endpoint.id, object: 'webhook_endpoint', deleted: true });

    // Server errors arrive as stable FloFiErrors.
    const changed = await flofi.approvals.create({ strategyId: strategy.id, workflowHash: '0x' + '0'.repeat(64) }).catch(e => e as FloFiError);
    expect(changed).toBeInstanceOf(FloFiError);
    expect(changed).toMatchObject({ status: 409, code: 'STRATEGY_CHANGED', reason: 'WORKFLOW_HASH_MISMATCH', requestId: expect.stringMatching(/^req_/) });
    await expect(flofi.executions.get('run-unknown')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', reason: 'EXECUTION_NOT_FOUND' });
    await expect(flofi.strategies.create({ strategy: { ...BRIDGE, privateKey: 'x' } })).rejects.toMatchObject({ code: 'INVALID_STRATEGY' });
    await expect(sdk('flofi_sk_test_' + 'Z'.repeat(43)).capabilities.list()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });

    // A creation retried by the integrator with its own key is the same strategy; the SDK never sends an Origin.
    const again = await flofi.strategies.create({ strategy: BRIDGE }, { idempotencyKey: 'order-1234-attempt' });
    expect((await flofi.strategies.create({ strategy: BRIDGE }, { idempotencyKey: 'order-1234-attempt' })).id).toBe(again.id);
    expect(requests.every(r => r.headers.get('origin') === null && r.headers.get('authorization') === `Bearer ${p.key}` || r.headers.get('authorization')?.includes('Z'.repeat(43))))
      .toBe(true);
  });
});

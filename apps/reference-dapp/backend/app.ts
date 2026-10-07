// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 backend composition: the stateless API routes and the worker handlers, both built on the
 * same flow services and the same PostgreSQL-backed storage. No request or worker keeps execution state in
 * memory; every instance can serve every request and every work item.
 */
import { archiveEvidence, backoffMs, createAutomationStore, createIdempotencyStore, createPostgresLeaseStore, createPostgresLogStore, createRunQueries, HttpError,
  readVerifiedEvidence, requestHash, withSpan, type Database, type EvidenceStore, type HttpRequest, type HttpResponse, type Logger, type Route,
  type WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import type { ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { JupiterHttp } from '@defi-workflow-engine/reference-compiler';
import { disabledCode, flowMode, FLOWS, isFlowName, type FlowDeps, type FlowName, type FlowService, type Rpc } from './flows.ts';
import { PREVIEW_METHODS, previewStorage } from './preview.ts';
import { assertRunOwnership, normalizePrincipal, WALLET_PRINCIPAL_HEADER } from '../src/server/run-ownership.ts';
import { automationEventExpiry, nextScheduledOccurrence, validateAutomationSpec } from '../src/domain/automation.ts';

/** Methods that could put a transaction on any network. Observer (worker) transports reject them unconditionally. */
const SUBMISSION_METHODS = new Set(['sendTransaction', 'eth_sendRawTransaction', 'eth_sendTransaction']);
export function observeOnly(rpc: Rpc): Rpc {
  return (method, params) => SUBMISSION_METHODS.has(method) ? Promise.reject(new Error('WORKER_SUBMISSION_FORBIDDEN')) : rpc(method, params);
}

export type FlowResult = { ok: true; value: unknown } | { ok: false; code: string };
export type BackendOptions = {
  readonly db: Database; readonly env: Readonly<Record<string, string | undefined>>; readonly logger: Logger; readonly tenantId: string;
  readonly holderId: string; readonly evidenceStore: EvidenceStore | null;
  /** Test seam: loopback MOCKED chains replace the network clients. Never used by the deployed entry point. */
  readonly rpc?: Partial<Record<FlowName, Rpc>>; readonly http?: JupiterHttp; readonly leaseTtlMs?: number; readonly busyRetries?: number;
  /** Test seam (BUILD-ROUTER-001): the MOCKED destination chain and providers used with `rpc['crosschain-router']`. */
  readonly router?: FlowDeps['router'];
  /** Test seam (BUILD-JOURNEY-001): per-flow MOCKED destination chains when both Router networks run in one test. */
  readonly routers?: Partial<Record<FlowName, FlowDeps['router']>>;
};
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

export function createBackend(options: BackendOptions) {
  const { db, env, logger } = options;
  const transports = new Map<FlowName, Omit<FlowDeps, 'mode' | 'env'>>(), services = new Map<string, FlowService>();
  /** One shared, paced transport per flow and process; tests substitute MOCKED chains. */
  const depsFor = (flow: FlowName, readOnly: boolean): FlowDeps => {
    const mode = flowMode(flow, env) === 'harness' ? 'harness' : 'live';
    let transport = transports.get(flow);
    if (!transport) {
      const override = options.rpc?.[flow];
      const router = options.routers?.[flow] ?? options.router;
      transport = override ? { rpc: override, ...options.http ? { http: options.http } : {}, ...router ? { router } : {} } : FLOWS[flow].transport(mode, env);
      transports.set(flow, transport);
    }
    const router = transport.router && readOnly ? { router: { ...transport.router, destinationRpc: observeOnly(transport.router.destinationRpc) } } : {};
    return { ...transport, ...router, mode, env, rpc: readOnly ? observeOnly(transport.rpc) : transport.rpc };
  };
  function storage(flow: FlowName, tenantId: string): ExecutionStorage {
    const definition = FLOWS[flow], namespace = definition.namespace ?? flow;
    return { log: createPostgresLogStore({ db, tenantId, namespace, projector: definition.projector }),
      leases: createPostgresLeaseStore({ db, tenantId, namespace, busyCode: definition.busyCode, holderId: options.holderId,
        ...options.leaseTtlMs ? { ttlMs: options.leaseTtlMs } : {} }) };
  }
  /** `observer` services (workers) get a transport that cannot submit anything, whatever a handler does. */
  function service(flow: FlowName, tenantId: string, observer = false): FlowService {
    const key = `${tenantId}\0${flow}\0${observer}`;
    let value = services.get(key);
    if (!value) {
      value = FLOWS[flow].create(storage(flow, tenantId), depsFor(flow, observer));
      services.set(key, value);
    }
    return value;
  }

  /**
   * The server-action contract over HTTP. A BUSY run (another request or a worker observing it) is retried briefly.
   * BUILD-JOURNEY-001: `principal` is the wallet session the BFF verified; flows with an ownership policy refuse any call whose
   * principal is not the durable run's owner (or claims another owner) before the service is touched.
   */
  async function callFlow(flow: FlowName, method: string, args: readonly unknown[], tenantId = options.tenantId, principal: string | null = null): Promise<FlowResult> {
    const definition = FLOWS[flow], mode = flowMode(flow, env);
    if (method === 'mode') return { ok: true, value: mode };
    const spec = Object.hasOwn(definition.methods, method) ? definition.methods[method] : undefined;
    if (!spec || !spec.validate(args)) throw new HttpError(400, 'ARGUMENTS_INVALID');
    if (mode === 'off') return { ok: false, code: disabledCode(flow) };
    const runId = typeof args[0] === 'string' && definition.runId.test(args[0]) ? args[0] : undefined;
    const ownership = definition.ownership;
    if (ownership) {
      try { await assertRunOwnership(ownership.policy, method, args, principal, async id => ownership.ownerOf(await service(flow, tenantId).load(id))); }
      catch (error) {
        const code = error instanceof Error && CODE.test(error.message) ? error.message : definition.unavailableCode;
        if (code === 'RUN_OWNER_MISMATCH') logger.warn('flow.ownership_refused', { flow, action: method, run_id: runId });
        return { ok: false, code };
      }
    }
    return withSpan(logger, 'flow.call', { tenant_id: tenantId, flow, action: method, run_id: runId }, async () => {
      for (let attempt = 0; ; attempt++) {
        try { return { ok: true, value: await service(flow, tenantId).call(method, args) } as const; }
        catch (error) {
          const code = error instanceof Error && CODE.test(error.message) ? error.message : definition.unavailableCode;
          if (code === definition.busyCode && attempt < (options.busyRetries ?? 12)) { await new Promise(resolve => setTimeout(resolve, Math.min(1_000, 100 * 2 ** attempt))); continue; }
          if (!(error instanceof Error && CODE.test(error.message))) logger.warn('flow.unclassified_error', { flow, action: method, run_id: runId });
          return { ok: false, code } as const;
        }
      }
    });
  }

  /**
   * BUILD-MCP-001: the flow's unchanged simulation on an observe-only transport and a per-call run log (`preview.ts`). It writes
   * nothing durable and binds nothing to the account argument, so no ownership policy applies: there is no run to own.
   */
  async function previewFlow(flow: FlowName, args: readonly unknown[]): Promise<FlowResult> {
    const definition = FLOWS[flow], method = PREVIEW_METHODS[flow];
    if (!method) return { ok: false, code: 'PREVIEW_NOT_AVAILABLE' };
    if (!definition.methods[method]!.validate(args)) throw new HttpError(400, 'ARGUMENTS_INVALID');
    if (flowMode(flow, env) === 'off') return { ok: false, code: disabledCode(flow) };
    return withSpan(logger, 'flow.preview', { flow, action: method }, async () => {
      try { return { ok: true, value: await definition.create(previewStorage(), depsFor(flow, true)).call(method, args) } as const; }
      catch (error) {
        if (!(error instanceof Error && CODE.test(error.message))) logger.warn('flow.unclassified_error', { flow, action: method });
        return { ok: false, code: error instanceof Error && CODE.test(error.message) ? error.message : definition.unavailableCode } as const;
      }
    });
  }

  const idempotency = (tenantId: string) => createIdempotencyStore({ db, tenantId });
  const queries = (tenantId: string) => createRunQueries(db, tenantId);
  const automations = (tenantId: string) => createAutomationStore(db, tenantId);
  const runIdOf = (value: string | undefined) => { if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new HttpError(400, 'RUN_ID_INVALID'); return value; };
  /** BUILD-JOURNEY-001: the wallet session principal the BFF verified (absent for operator calls made with the bearer token alone). */
  const principalOf = (request: HttpRequest) => {
    const raw = request.headers[WALLET_PRINCIPAL_HEADER];
    if (raw === undefined) return null;
    const principal = normalizePrincipal(raw);
    if (!principal) throw new HttpError(400, 'WALLET_PRINCIPAL_INVALID');
    return principal;
  };
  /** A run is visible to a principal only when it is that wallet's run; operator calls (no principal) see the tenant. */
  const visibleRun = async (request: HttpRequest, runId: string) => {
    const run = await queries(options.tenantId).getRun(runId), principal = principalOf(request);
    if (!run || principal !== null && run.ownerAccount !== principal) throw new HttpError(404, 'RUN_NOT_FOUND');
    return run;
  };
  const automationPrincipal = (request: HttpRequest) => {
    const principal = principalOf(request);
    if (!principal) throw new HttpError(401, 'WALLET_SESSION_REQUIRED');
    return principal;
  };
  const integerParam = (value: string | null) => value === null ? null : /^-?\d{1,9}$/.test(value) ? Number(value) : NaN;
  const wrap = (handler: (request: HttpRequest, match: RegExpExecArray) => Promise<HttpResponse>) => async (request: HttpRequest, match: RegExpExecArray) => {
    try { return await handler(request, match); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && /^(CURSOR_INVALID|LIMIT_INVALID)$/.test(error.message)) throw new HttpError(400, error.message);
      throw error;
    }
  };

  const routes: Route[] = [
    { method: 'POST', name: 'flow', pattern: /^\/v1\/flows\/([a-z-]{1,40})\/([A-Za-z]{1,40})$/, handler: wrap(async (request, match) => {
      const flow = match[1]!, method = match[2]!;
      if (!isFlowName(flow)) throw new HttpError(404, 'FLOW_NOT_FOUND');
      const body = request.body as { args?: unknown } | null;
      if (!body || typeof body !== 'object' || !Array.isArray(body.args) || Object.keys(body).length !== 1) throw new HttpError(400, 'ARGUMENTS_INVALID');
      const args = body.args, tenantId = options.tenantId, key = request.headers['idempotency-key'], principal = principalOf(request);
      const mutates = method !== 'mode' && FLOWS[flow].methods[method]?.mutates === true;
      if (typeof key !== 'string' || !mutates) return { status: 200, body: await callFlow(flow, method, args, tenantId, principal) };
      // The principal is part of the request identity: a key replayed under another wallet session is a conflict, never a replay.
      const scope = `flows/${flow}/${method.toLowerCase()}`, hash = requestHash(scope, principal === null ? args : [{ principal }, ...args]), store = idempotency(tenantId);
      let claim;
      try { claim = await store.begin(scope, key, hash); } catch (error) { if ((error as Error).message === 'IDEMPOTENCY_KEY_INVALID') throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID'); throw error; }
      if (claim.kind === 'REPLAY') return { status: 200, body: claim.response };
      if (claim.kind === 'CONFLICT') throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED');
      if (claim.kind === 'IN_PROGRESS') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS');
      let result: FlowResult;
      try { result = await callFlow(flow, method, args, tenantId, principal); } catch (error) { await store.release(scope, key, hash).catch(() => undefined); throw error; }
      if (result.ok) await store.complete(scope, key, hash, result); else await store.release(scope, key, hash);
      return { status: 200, body: result };
    }) },
    // BUILD-MCP-001: read-only simulation previews (no run, no idempotency record: nothing durable happens).
    { method: 'POST', name: 'preview', pattern: /^\/v1\/previews\/([a-z-]{1,40})$/, handler: wrap(async (request, match) => {
      const flow = match[1]!;
      if (!isFlowName(flow)) throw new HttpError(404, 'FLOW_NOT_FOUND');
      const body = request.body as { args?: unknown } | null;
      if (!body || typeof body !== 'object' || !Array.isArray(body.args) || Object.keys(body).length !== 1) throw new HttpError(400, 'ARGUMENTS_INVALID');
      return { status: 200, body: await previewFlow(flow, body.args) };
    }) },
    { method: 'GET', name: 'automations', pattern: /^\/v1\/automations$/, handler: wrap(async request => {
      const principal = automationPrincipal(request);
      return { status: 200, body: { ok: true, value: await automations(options.tenantId).list(principal) } };
    }) },
    { method: 'POST', name: 'automations.create', pattern: /^\/v1\/automations$/, handler: wrap(async request => {
      const principal = automationPrincipal(request), body = request.body as { spec?: unknown } | null;
      if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'spec')) throw new HttpError(400, 'AUTOMATION_SPEC_INVALID');
      const valid = validateAutomationSpec(body.spec);
      if ('code' in valid) throw new HttpError(400, valid.code);
      const next = nextScheduledOccurrence(valid.spec.trigger, new Date());
      const created = await automations(options.tenantId).create({ ownerAccount: principal, spec: valid.spec, workflowHash: valid.workflowHash, nextEvaluationAt: next });
      return { status: 200, body: { ok: true, value: created } };
    }) },
    { method: 'POST', name: 'automations.state', pattern: /^\/v1\/automations\/(auto-[0-9a-f]{24})\/state$/, handler: wrap(async (request, match) => {
      const principal = automationPrincipal(request), body = request.body as { state?: unknown } | null;
      if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !['ACTIVE','PAUSED'].includes(String(body.state))) throw new HttpError(400, 'AUTOMATION_STATE_INVALID');
      const value = await automations(options.tenantId).setState(principal, match[1]!, body.state as 'ACTIVE' | 'PAUSED');
      if (!value) throw new HttpError(404, 'AUTOMATION_NOT_FOUND');
      return { status: 200, body: { ok: true, value } };
    }) },
    { method: 'GET', name: 'automation.events', pattern: /^\/v1\/automation-events$/, handler: wrap(async request => {
      const principal = automationPrincipal(request);
      return { status: 200, body: { ok: true, value: await automations(options.tenantId).events(principal) } };
    }) },
    { method: 'POST', name: 'automation.event.open', pattern: /^\/v1\/automation-events\/(evt-[0-9a-f]{24})\/open$/, handler: wrap(async (request, match) => {
      const principal = automationPrincipal(request), value = await automations(options.tenantId).open(principal, match[1]!);
      if (!value) throw new HttpError(404, 'AUTOMATION_EVENT_NOT_FOUND');
      return { status: 200, body: { ok: true, value } };
    }) },
    { method: 'POST', name: 'automation.event.dismiss', pattern: /^\/v1\/automation-events\/(evt-[0-9a-f]{24})\/dismiss$/, handler: wrap(async (request, match) => {
      const principal = automationPrincipal(request);
      if (!await automations(options.tenantId).dismiss(principal, match[1]!)) throw new HttpError(404, 'AUTOMATION_EVENT_NOT_FOUND');
      return { status: 200, body: { ok: true, value: { dismissed: true } } };
    }) },
    { method: 'GET', name: 'runs', pattern: /^\/v1\/runs$/, handler: wrap(async request => {
      const limit = integerParam(request.query.get('limit')), flow = request.query.get('flow');
      if (flow !== null && !isFlowName(flow)) throw new HttpError(400, 'FLOW_INVALID');
      // A wallet session sees only its own runs.
      return { status: 200, body: { ok: true, value: await queries(options.tenantId).listRuns(request.query.get('cursor'), limit, { owner: principalOf(request), flow }) } };
    }) },
    { method: 'GET', name: 'run', pattern: /^\/v1\/runs\/([^/]+)$/, handler: wrap(async (request, match) => {
      return { status: 200, body: { ok: true, value: await visibleRun(request, runIdOf(match[1])) } };
    }) },
    { method: 'GET', name: 'run.journal', pattern: /^\/v1\/runs\/([^/]+)\/journal$/, handler: wrap(async (request, match) => {
      const runId = runIdOf(match[1]), q = queries(options.tenantId);
      await visibleRun(request, runId);
      return { status: 200, body: { ok: true, value: await q.journal(runId, integerParam(request.query.get('after')), integerParam(request.query.get('limit'))) } };
    }) },
    { method: 'GET', name: 'run.evidence', pattern: /^\/v1\/runs\/([^/]+)\/evidence$/, handler: wrap(async (request, match) => {
      const runId = runIdOf(match[1]), q = queries(options.tenantId);
      await visibleRun(request, runId);
      const items = await q.evidence(runId), store = options.evidenceStore;
      const value = await Promise.all(items.map(async item => {
        if (!store || store.id !== item.storeId) return { ...item, verified: false, content: null };
        const bytes = await readVerifiedEvidence(store, item);
        return { ...item, verified: true, content: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
      }));
      return { status: 200, body: { ok: true, value } };
    }) },
  ];

  const payload = (item: Parameters<WorkHandler>[0]) => {
    const flow = item.payload.namespace, runId = item.payload.runId;
    if (typeof flow !== 'string' || !isFlowName(flow) || typeof runId !== 'string' || !FLOWS[flow].runId.test(runId) || item.runId !== runId) return null;
    return { flow, runId, definition: FLOWS[flow] };
  };
  const failure = (error: unknown) => error instanceof Error && CODE.test(error.message) ? error.message : 'WORK_HANDLER_FAILED';

  /** Read-only observation of an attempt that may have reached the network. Never submits; never touches PREPARED. */
  const reconcile: WorkHandler = async (item, settle, log) => {
    const target = payload(item);
    if (!target) { await settle({ outcome: 'DEAD', reason: 'WORK_PAYLOAD_INVALID' }); return; }
    const { flow, runId, definition } = target;
    if (flowMode(flow, env) === 'off') { await settle({ outcome: 'RETRY', delayMs: 300_000, reason: disabledCode(flow) }); return; }
    const leases = storage(flow, item.tenantId).leases, svc = service(flow, item.tenantId, true);
    try {
      await leases.hold(runId, async () => {
        // Re-checked under the run lease: a stale item cannot act on an attempt created after it was queued.
        const record = await svc.load(runId);
        if (!definition.needsObservation(record)) { await settle({ outcome: 'DONE' }); return; }
        const next = await svc.observe(runId) as { error?: string | null; verdict?: string };
        const pending = definition.needsObservation(next);
        log.info('reconcile.observed', { flow, run_id: runId, reconciliation_state: next.verdict ?? null, error_code: next.error ?? null, still_pending: pending });
        await settle(pending ? { outcome: 'RETRY', delayMs: backoffMs(item.deliveries), reason: next.error ?? 'OBSERVATION_PENDING' } : { outcome: 'DONE' });
      });
    } catch (error) {
      const code = failure(error);
      if (code === definition.busyCode || code === 'EXECUTION_LEASE_LOST') { await settle({ outcome: 'RETRY', delayMs: 2_000, reason: code }); return; }
      // Stored state that fails validation is never acted on; it needs an operator.
      if (/CORRUPT/.test(code)) { log.error('reconcile.state_corrupt', { flow, run_id: runId, error_code: code }); await settle({ outcome: 'DEAD', reason: code }); return; }
      throw error;
    }
  };
  /** Copies the reconciled Evidence Bundle export to the EvidenceStore and records its integrity metadata. */
  const archive: WorkHandler = async (item, settle, log) => {
    const target = payload(item);
    if (!target) { await settle({ outcome: 'DEAD', reason: 'WORK_PAYLOAD_INVALID' }); return; }
    const store = options.evidenceStore;
    if (!store) { await settle({ outcome: 'RETRY', delayMs: 600_000, reason: 'EVIDENCE_STORE_NOT_CONFIGURED' }); return; }
    const record = await service(target.flow, item.tenantId, true).load(target.runId), evidence = target.definition.evidence(record);
    if (!evidence) { await settle({ outcome: 'DONE' }); return; }
    const stored = await archiveEvidence(store, evidence.bytes);
    await queries(item.tenantId).recordEvidence(target.runId, { ...stored, bundleHash: evidence.bundleHash, storeId: store.id,
      environment: evidence.environment, outcome: evidence.outcome });
    log.info('evidence.archived', { flow: target.flow, run_id: target.runId, evidence_sha256: stored.sha256, byte_length: stored.byteLength });
    await settle({ outcome: 'DONE' });
  };

  const automationFire: WorkHandler = async (item, settle, log) => {
    const automationId = item.payload.automationId, expectedDueAt = item.payload.expectedDueAt;
    if (typeof automationId !== 'string' || typeof expectedDueAt !== 'string' || !/^auto-[0-9a-f]{24}$/.test(automationId) || !Number.isFinite(Date.parse(expectedDueAt))) {
      await settle({ outcome: 'DEAD', reason: 'AUTOMATION_WORK_INVALID' }); return;
    }
    const store = automations(item.tenantId), current = await store.getInternal(automationId);
    if (!current || current.state !== 'ACTIVE' || current.nextEvaluationAt !== new Date(expectedDueAt).toISOString()) {
      await settle({ outcome: 'DONE' }); return;
    }
    const valid = validateAutomationSpec(current.spec);
    if ('code' in valid || valid.workflowHash !== current.workflowHash) {
      await settle({ outcome: 'DEAD', reason: 'AUTOMATION_STATE_INVALID' }); return;
    }
    const occurrence = new Date(expectedDueAt), next = nextScheduledOccurrence(valid.spec.trigger, occurrence);
    const result = await store.fire({ automationId, expectedDueAt: occurrence.toISOString(), nextDueAt: next,
      expiresAt: automationEventExpiry(next), strategy: valid.spec.strategy, workflowHash: valid.workflowHash });
    if (result.fired) log.info('automation.fired', { automation_id: automationId, event_id: result.event?.eventId ?? null,
      owner_account: current.ownerAccount, next_evaluation_at: next.toISOString() });
    await settle({ outcome: 'DONE' });
  };

  return { routes, callFlow, previewFlow, service, storage,
    handlers: { reconcile, 'evidence.archive': archive, 'automation.fire': automationFire } as Record<string, WorkHandler> };
}
export type Backend = ReturnType<typeof createBackend>;

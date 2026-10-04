// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 backend composition: the stateless API routes and the worker handlers, both built on the
 * same flow services and the same PostgreSQL-backed storage. No request or worker keeps execution state in
 * memory; every instance can serve every request and every work item.
 */
import { archiveEvidence, backoffMs, createIdempotencyStore, createPostgresLeaseStore, createPostgresLogStore, createRunQueries, HttpError,
  readVerifiedEvidence, requestHash, withSpan, type Database, type EvidenceStore, type HttpRequest, type HttpResponse, type Logger, type Route,
  type WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import type { ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { JupiterHttp } from '@defi-workflow-engine/reference-compiler';
import { disabledCode, flowMode, FLOWS, isFlowName, type FlowDeps, type FlowName, type FlowService, type Rpc } from './flows.ts';

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
      transport = override ? { rpc: override, ...options.http ? { http: options.http } : {} } : FLOWS[flow].transport(mode, env);
      transports.set(flow, transport);
    }
    return { ...transport, mode, env, rpc: readOnly ? observeOnly(transport.rpc) : transport.rpc };
  };
  function storage(flow: FlowName, tenantId: string): ExecutionStorage {
    const definition = FLOWS[flow];
    return { log: createPostgresLogStore({ db, tenantId, namespace: flow, projector: definition.projector }),
      leases: createPostgresLeaseStore({ db, tenantId, namespace: flow, busyCode: definition.busyCode, holderId: options.holderId,
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

  /** The server-action contract over HTTP. A BUSY run (another request or a worker observing it) is retried briefly. */
  async function callFlow(flow: FlowName, method: string, args: readonly unknown[], tenantId = options.tenantId): Promise<FlowResult> {
    const definition = FLOWS[flow], mode = flowMode(flow, env);
    if (method === 'mode') return { ok: true, value: mode };
    const spec = Object.hasOwn(definition.methods, method) ? definition.methods[method] : undefined;
    if (!spec || !spec.validate(args)) throw new HttpError(400, 'ARGUMENTS_INVALID');
    if (mode === 'off') return { ok: false, code: disabledCode(flow) };
    const runId = typeof args[0] === 'string' && definition.runId.test(args[0]) ? args[0] : undefined;
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

  const idempotency = (tenantId: string) => createIdempotencyStore({ db, tenantId });
  const queries = (tenantId: string) => createRunQueries(db, tenantId);
  const runIdOf = (value: string | undefined) => { if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new HttpError(400, 'RUN_ID_INVALID'); return value; };
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
      const args = body.args, tenantId = options.tenantId, key = request.headers['idempotency-key'];
      const mutates = method !== 'mode' && FLOWS[flow].methods[method]?.mutates === true;
      if (typeof key !== 'string' || !mutates) return { status: 200, body: await callFlow(flow, method, args, tenantId) };
      const scope = `flows/${flow}/${method.toLowerCase()}`, hash = requestHash(scope, args), store = idempotency(tenantId);
      let claim;
      try { claim = await store.begin(scope, key, hash); } catch (error) { if ((error as Error).message === 'IDEMPOTENCY_KEY_INVALID') throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID'); throw error; }
      if (claim.kind === 'REPLAY') return { status: 200, body: claim.response };
      if (claim.kind === 'CONFLICT') throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED');
      if (claim.kind === 'IN_PROGRESS') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS');
      let result: FlowResult;
      try { result = await callFlow(flow, method, args, tenantId); } catch (error) { await store.release(scope, key, hash).catch(() => undefined); throw error; }
      if (result.ok) await store.complete(scope, key, hash, result); else await store.release(scope, key, hash);
      return { status: 200, body: result };
    }) },
    { method: 'GET', name: 'runs', pattern: /^\/v1\/runs$/, handler: wrap(async request => {
      const limit = integerParam(request.query.get('limit'));
      return { status: 200, body: { ok: true, value: await queries(options.tenantId).listRuns(request.query.get('cursor'), limit) } };
    }) },
    { method: 'GET', name: 'run', pattern: /^\/v1\/runs\/([^/]+)$/, handler: wrap(async (_request, match) => {
      const run = await queries(options.tenantId).getRun(runIdOf(match[1]));
      if (!run) throw new HttpError(404, 'RUN_NOT_FOUND');
      return { status: 200, body: { ok: true, value: run } };
    }) },
    { method: 'GET', name: 'run.journal', pattern: /^\/v1\/runs\/([^/]+)\/journal$/, handler: wrap(async (request, match) => {
      const runId = runIdOf(match[1]), q = queries(options.tenantId);
      if (!await q.getRun(runId)) throw new HttpError(404, 'RUN_NOT_FOUND');
      return { status: 200, body: { ok: true, value: await q.journal(runId, integerParam(request.query.get('after')), integerParam(request.query.get('limit'))) } };
    }) },
    { method: 'GET', name: 'run.evidence', pattern: /^\/v1\/runs\/([^/]+)\/evidence$/, handler: wrap(async (_request, match) => {
      const runId = runIdOf(match[1]), q = queries(options.tenantId);
      if (!await q.getRun(runId)) throw new HttpError(404, 'RUN_NOT_FOUND');
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

  return { routes, callFlow, service, storage, handlers: { reconcile, 'evidence.archive': archive } as Record<string, WorkHandler> };
}
export type Backend = ReturnType<typeof createBackend>;

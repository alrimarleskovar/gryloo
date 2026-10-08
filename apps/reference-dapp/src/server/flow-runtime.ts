// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: the one place that decides where a cloud-capable server action runs.
 *
 *  - `remote`       `API_BASE_URL` is set: forward the identical contract to the Flofi API (BUILD-CLOUD-001, unchanged).
 *  - `embedded`     `DATABASE_URL` on a hosted deployment (or locally with `FLOFI_RUNTIME=embedded`): run the SAME backend
 *                   composition (`backend/app.ts`: flow registry, strict argument validation, ownership policy, PostgreSQL
 *                   log and lease stores) inside this server function. Any request may reach any instance; all state is in
 *                   PostgreSQL, so a Vercel Preview is a complete, isolated runtime at its own commit.
 *  - `unconfigured` a hosted deployment with neither: every cloud flow fails closed with `CLOUD_RUNTIME_NOT_CONFIGURED`.
 *                   It never falls back to a local journal, `/tmp` or process memory.
 *  - `local`        development and the deterministic test suites: the caller keeps its existing local service.
 *
 * Nothing here signs, holds a key or submits a transaction: the flows are the same read/simulate/review/record services the API
 * runs, and every wallet request still needs the owner's Review, Execute click and wallet signature.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import type { Backend, BackendOptions } from '../../backend/app.ts';
import type { FlowName } from '../../backend/flows.ts';
import { callCloudFlow, listCloudRuns, previewCloudFlow, readCloudRun, type CloudRunSummary, type FlowResult } from './cloud-api-client.ts';
import { isHostedDeployment } from './deployment.ts';
import { serverlessPostgresConfig } from './postgres-config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type FlowRuntimeKind = 'remote' | 'embedded' | 'local' | 'unconfigured';
export type FlowRuntimeMode = 'live' | 'harness' | 'off';
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const classified = (error: unknown, fallback: string) => error instanceof Error && CODE.test(error.message) ? error.message : fallback;

export function flowRuntimeKind(env: Env): FlowRuntimeKind {
  if (env.API_BASE_URL) return 'remote';
  const embedded = env.FLOFI_RUNTIME === 'embedded';
  if (env.DATABASE_URL && (embedded || isHostedDeployment(env))) return 'embedded';
  return embedded || isHostedDeployment(env) ? 'unconfigured' : 'local';
}

/** BUILD-MCP-001: one durable run as the read model projects it (status, owner, attempts). */
export type CloudRun = { runId: string; workflowId: string; flow: string; status: string; provenance: string; ownerAccount: string | null; errorCode: string | null;
  needsObservation: boolean; attentionRequired: boolean; hasEvidence: boolean; createdAt: string; updatedAt: string; attempts: unknown[] };
export type CloudJournalPage = { items: Record<string, unknown>[]; next: string | null };
export type EmbeddedRuntime = { readonly backend: Backend; readonly tenantId: string;
  readonly runs: (flow: FlowName, owner: string) => Promise<CloudRunSummary[]>; readonly schemaVersion: number;
  readonly ping: () => Promise<void>;
  /** BUILD-MCP-001: one run of `owner` in this deployment's tenant; `null` when absent or owned by anyone else. */
  readonly run: (runId: string, owner: string) => Promise<CloudRun | null>;
  readonly journal: (runId: string, owner: string, after: number | null, limit: number) => Promise<CloudJournalPage | null>;
  /** BUILD-MCP-002: the same pool, for the MCP OAuth, handoff and wallet-link stores (tenant-scoped by their own queries). */
  readonly db: Database };
/** Test seams of the backend (MOCKED in-process chains). The deployed path never passes any. */
export type EmbeddedSeams = Pick<BackendOptions, 'rpc' | 'http' | 'router' | 'routers' | 'busyRetries'>;
/** A new runtime instance (one serverless instance's worth of state). Callers normally use the cached `embeddedRuntime`. */
export async function createEmbeddedRuntime(env: Env, seams: EmbeddedSeams = {}): Promise<EmbeddedRuntime & { readonly close: () => Promise<void> }> {
  const { databaseUrl, tenantId, maxConnections } = serverlessPostgresConfig(env);
  // Evidence lives in the durable run log; an optional export store must itself be durable (never a function's disk).
  if (isHostedDeployment(env) && env.EVIDENCE_DIRECTORY && !env.OBJECT_STORE_ENDPOINT && !env.OBJECT_STORE_BUCKET) throw new Error('EVIDENCE_STORE_FILESYSTEM_FORBIDDEN');
  // Loaded only when this runtime is selected, so local development never loads the database driver.
  const runtime = await import('@defi-workflow-engine/cloud-runtime');
  const { createBackend } = await import('../../backend/app.ts');
  const db = runtime.createDatabase({ connectionString: databaseUrl, maxConnections, applicationName: 'flofi-web' });
  let schemaVersion: number;
  try {
    schemaVersion = await runtime.assertSchemaCurrent(db, runtime.SHIPPED_MIGRATIONS);
    await runtime.ensureTenant(db, tenantId);
  } catch (error) { await db.close().catch(() => undefined); throw error; }
  const instance = (env.VERCEL_DEPLOYMENT_ID ?? 'local').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'local';
  const backend = createBackend({ db, env, logger: runtime.createLogger({ service: 'flofi-web' }), tenantId, holderId: `web-${instance}-${randomBytes(4).toString('hex')}`,
    evidenceStore: env.OBJECT_STORE_ENDPOINT || env.OBJECT_STORE_BUCKET ? runtime.readEvidenceStore(env) : null, ...seams });
  const queries = runtime.createRunQueries(db, tenantId);
  const owned = async (runId: string, owner: string) => { const run = await queries.getRun(runId); return run && run.ownerAccount === owner ? run : null; };
  return { backend, tenantId, schemaVersion, db, ping: async () => { await db.query('SELECT 1'); }, close: () => db.close(),
    runs: async (flow, owner) => (await queries.listRuns(null, 25, { owner, flow })).items.map(r => ({ runId: r.runId, flow: r.flow, status: r.status,
      ownerAccount: r.ownerAccount, hasEvidence: r.hasEvidence, updatedAt: r.updatedAt })),
    run: owned,
    journal: async (runId, owner, after, limit) => await owned(runId, owner) ? queries.journal(runId, after, limit) : null };
}
/**
 * One pool and one service map per function instance and configuration: a performance cache only; correctness never depends on
 * it surviving. A failed start (database unreachable, schema behind) is not cached: the next request tries again.
 */
const HOSTS = Symbol.for('flofi.embedded-runtime');
export function embeddedRuntime(env: Env = process.env): Promise<EmbeddedRuntime> {
  const { databaseUrl, tenantId, maxConnections } = serverlessPostgresConfig(env);
  const holder = globalThis as unknown as Record<symbol, Map<string, Promise<EmbeddedRuntime>> | undefined>;
  const hosts = holder[HOSTS] ??= new Map(), key = `${databaseUrl}\0${tenantId}\0${maxConnections}`;
  let host = hosts.get(key);
  if (!host) {
    host = createEmbeddedRuntime(env).catch(error => { hosts.delete(key); throw error; });
    hosts.set(key, host);
  }
  return host;
}

/**
 * Runs one flow method on the deployment's cloud runtime. Resolves `null` only in `local` mode, where the caller keeps using
 * its in-process development service. `principal` is the verified wallet session (Router ownership), never browser input.
 */
export async function cloudFlow<T>(flow: FlowName, method: string, args: readonly unknown[],
  options: { readonly principal?: string | null; readonly env?: Env; readonly transport?: typeof fetch } = {}):
  Promise<FlowResult<T> | null> {
  const env = options.env ?? process.env, kind = flowRuntimeKind(env), principal = options.principal ?? null;
  if (kind === 'local') return null;
  if (kind === 'unconfigured') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  if (kind === 'remote') return callCloudFlow<T>(flow, method, args, { env, principal, ...options.transport ? { transport: options.transport } : {} });
  try { return await (await embeddedRuntime(env)).backend.callFlow(flow, method, args, undefined, principal) as FlowResult<T>; }
  catch (error) { return { ok: false, code: classified(error, 'CLOUD_RUNTIME_UNAVAILABLE') }; }
}
/** The deployment's enablement of one flow (`null` in local mode). Any runtime failure reads as `off`: fail closed. */
export async function cloudFlowMode(flow: FlowName, env: Env = process.env, transport?: typeof fetch): Promise<FlowRuntimeMode | null> {
  const result = await cloudFlow<unknown>(flow, 'mode', [], { env, ...transport ? { transport } : {} });
  if (result === null) return null;
  return result.ok && (result.value === 'live' || result.value === 'harness') ? result.value : 'off';
}
/**
 * BUILD-MCP-001: a read-only simulation preview (`backend/preview.ts`) on the deployment's cloud runtime — the flow's
 * unchanged simulation with nothing persisted. Resolves `null` in local mode: the local services keep file journals, so a
 * local caller must not preview through them (use `FLOFI_RUNTIME=embedded` with a database instead).
 */
export async function cloudPreview<T>(flow: FlowName, args: readonly unknown[], options: { readonly env?: Env; readonly transport?: typeof fetch } = {}):
  Promise<FlowResult<T> | null> {
  const env = options.env ?? process.env, kind = flowRuntimeKind(env);
  if (kind === 'local') return null;
  if (kind === 'unconfigured') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  if (kind === 'remote') return previewCloudFlow<T>(flow, args, { env, ...options.transport ? { transport: options.transport } : {} });
  try { return await (await embeddedRuntime(env)).backend.previewFlow(flow, args) as FlowResult<T>; }
  catch (error) { return { ok: false, code: classified(error, 'CLOUD_RUNTIME_UNAVAILABLE') }; }
}
/**
 * BUILD-MCP-001: one durable run, or one page of its journal, read as `owner`: `null` when the run is absent or belongs to
 * anyone else (never distinguishable). `null` result in local mode, where runs are not durable.
 */
export async function cloudRun(runId: string, owner: string, options: { readonly env?: Env; readonly transport?: typeof fetch } = {}):
  Promise<FlowResult<CloudRun | null> | null> {
  const env = options.env ?? process.env, kind = flowRuntimeKind(env);
  if (kind === 'local') return null;
  if (kind === 'unconfigured') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  if (kind === 'remote') return readCloudRun<CloudRun>(runId, owner, { env, ...options.transport ? { transport: options.transport } : {} });
  try { return { ok: true, value: await (await embeddedRuntime(env)).run(runId, owner) }; }
  catch (error) { return { ok: false, code: classified(error, 'CLOUD_RUNTIME_UNAVAILABLE') }; }
}
export async function cloudRunJournal(runId: string, owner: string, after: number | null, limit: number, options: { readonly env?: Env; readonly transport?: typeof fetch } = {}):
  Promise<FlowResult<CloudJournalPage | null> | null> {
  const env = options.env ?? process.env, kind = flowRuntimeKind(env);
  if (kind === 'local') return null;
  if (kind === 'unconfigured') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  if (kind === 'remote') return readCloudRun<CloudJournalPage>(runId, owner, { env, journal: { after, limit }, ...options.transport ? { transport: options.transport } : {} });
  try { return { ok: true, value: await (await embeddedRuntime(env)).journal(runId, owner, after, limit) }; }
  catch (error) { return { ok: false, code: classified(error, 'CLOUD_RUNTIME_UNAVAILABLE') }; }
}
/** The signed-in wallet's most recent runs of one flow (`null` in local mode). */
export async function cloudRuns(flow: FlowName, principal: string, env: Env = process.env): Promise<FlowResult<CloudRunSummary[]> | null> {
  const kind = flowRuntimeKind(env);
  if (kind === 'local') return null;
  if (kind === 'unconfigured') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
  if (kind === 'remote') return listCloudRuns(flow, principal, { env });
  try { return { ok: true, value: (await (await embeddedRuntime(env)).runs(flow, principal)).filter(r => r.ownerAccount === principal && r.flow === flow) }; }
  catch (error) { return { ok: false, code: classified(error, 'CLOUD_RUNTIME_UNAVAILABLE') }; }
}

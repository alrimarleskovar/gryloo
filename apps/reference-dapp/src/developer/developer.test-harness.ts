// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001 test harness: speaks HTTP to the real Developer API handler exactly as a third-party server does (no network),
 * creates projects and sandbox keys with the operator functions, and offers a recording runtime whose every call is visible — any
 * call that is not discovery, a preview or an owner-scoped read fails the test.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import type { FlowName } from '../../backend/flows.ts';
import type { EngineRuntime } from '../platform/index.ts';
import { createPgHandoffStore } from '../platform/index.ts';
import { createProject, issueSandboxKey } from './admin.ts';
import { readDeveloperConfig, type DeveloperConfig, type DeveloperScope } from './config.ts';
import type { WebhookTransport } from './dispatch.ts';
import { handleDeveloperRequest, type DeveloperLogger } from './http.ts';
import { createPgDeveloperStore } from './pg-store.ts';

export const ORIGIN = 'https://flofi.test';
export const SECRET = 'flofi-developer-test-secret-'.padEnd(48, 'x');
export const developerEnv = (extra: Record<string, string> = {}): Record<string, string> =>
  ({ FLOFI_DEVELOPER: 'enabled', FLOFI_PUBLIC_ORIGIN: ORIGIN, FLOFI_DEVELOPER_SECRET: SECRET, ...extra });
export function developerConfig(env: Record<string, string> = developerEnv()): DeveloperConfig {
  const config = readDeveloperConfig(env);
  if (!config.enabled) throw new Error(config.code);
  return config;
}
export type LogLine = { readonly event: string; readonly fields: Readonly<Record<string, unknown>> };
export function memoryLogger(): DeveloperLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return { lines, info: (event, fields = {}) => { lines.push({ event, fields }); }, warn: (event, fields = {}) => { lines.push({ event, fields }); } };
}

/** A project with one sandbox key (all scopes unless narrowed). The key exists only in test memory. */
export async function developerProject(db: Database, options: { tenantId?: string; name?: string; scopes?: readonly DeveloperScope[] } = {}) {
  const tenantId = options.tenantId ?? 'default', config = developerConfig();
  const deps = { store: createPgDeveloperStore(db, tenantId), handoffs: createPgHandoffStore(db, tenantId), config, now: () => new Date() };
  const { projectId } = await createProject(deps, options.name ?? 'Acme Wallet');
  const issued = await issueSandboxKey(deps, projectId, options.scopes);
  return { projectId, key: issued.key, keyId: issued.keyId, deps };
}

export type ApiResponse<T = Record<string, unknown>> = { readonly status: number; readonly headers: Headers; readonly body: T; readonly text: string };
export type ApiOptions = { readonly env?: Record<string, string>; readonly db: Database; readonly tenantId?: string; readonly runtime: EngineRuntime;
  readonly logger?: DeveloperLogger; readonly now?: () => Date; readonly after?: (() => Promise<unknown>)[];
  /** Webhook transport; by default every delivery fails closed (tests never reach a network). */
  readonly transport?: WebhookTransport };
/** The default test transport: no network, ever. */
export const NO_NETWORK: WebhookTransport = async () => { throw new Error('WEBHOOK_TEST_NO_NETWORK'); };
/** One integration's server: `key: null` sends no Authorization header. Work scheduled after a response runs before the call returns. */
export function developerApi(options: ApiOptions, key: string | null) {
  return async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> => {
    const scheduled: (() => Promise<unknown>)[] = [];
    const request = new Request(`${ORIGIN}/api/developer/v1${path}`, { method, body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
      headers: { ...key === null ? {} : { authorization: `Bearer ${key}` }, ...body === undefined ? {} : { 'content-type': 'application/json' }, ...headers } });
    const response = await handleDeveloperRequest(request, { env: options.env ?? developerEnv(), host: { db: options.db, tenantId: options.tenantId ?? 'default' },
      runtime: options.runtime, transport: options.transport ?? NO_NETWORK, ...options.logger ? { logger: options.logger } : {}, ...options.now ? { now: options.now } : {},
      schedule: work => { scheduled.push(work); } });
    const text = await response.text();
    for (const work of scheduled) { if (options.after) options.after.push(work); else await work(); }
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : null) as T, text };
  };
}

/**
 * A MOCKED-harness deployment runtime that records every call. `preview` answers with `previews[flow]` (or a refusal); run reads
 * answer from `runs` (owner-scoped). Anything that could prepare, authorize or send does not exist on the port at all.
 */
export function recordingRuntime(options: { readonly calls?: string[]; readonly modes?: Partial<Record<FlowName, 'live' | 'harness' | 'off'>>;
  readonly previews?: Partial<Record<FlowName, unknown>>; readonly runs?: EngineRuntime['run']; readonly runList?: EngineRuntime['runs'];
  readonly record?: EngineRuntime['record']; readonly evidence?: EngineRuntime['evidence'] } = {}): EngineRuntime {
  const calls = options.calls ?? [], modes = options.modes ?? { 'crosschain-router-testnet': 'harness', 'lending-composition': 'harness', 'aave-supply': 'harness' };
  const none = async () => ({ ok: true as const, value: null });
  return {
    kind: 'embedded',
    mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; },
    info: async flow => { calls.push(`info:${flow}`); return { executionEnabled: true }; },
    preview: async flow => { calls.push(`preview:${flow}`); return flow in (options.previews ?? {}) ? { ok: true, value: options.previews![flow] } : { ok: false, code: 'PREVIEW_UNAVAILABLE_IN_TEST' }; },
    run: async (runId, owner) => { calls.push('run'); return options.runs ? options.runs(runId, owner) : none(); },
    journal: async () => { calls.push('journal'); return none(); },
    evidence: async (flow, runId, owner) => { calls.push('evidence'); return options.evidence ? options.evidence(flow, runId, owner) : none(); },
    runs: async (flow, owner) => { calls.push('runs'); return options.runList ? options.runList(flow, owner) : { ok: true, value: [] }; },
    record: async (flow, runId, owner) => { calls.push('record'); return options.record ? options.record(flow, runId, owner) : none(); },
  };
}
/** The runtime calls a Developer API journey may make: discovery, previews and owner-scoped reads. */
export const READ_ONLY_CALL = /^(mode:|info:|preview:|run$|journal$|evidence$|runs$|record$)/;

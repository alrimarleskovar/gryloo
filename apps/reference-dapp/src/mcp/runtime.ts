// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the gateway's view of the deployment's runtime (BUILD-CLOUD-PARITY-001 `flow-runtime.ts`), never a second one.
 *
 *   remote        previews and reads go to the Flofi API (bearer `API_AUTH_TOKEN`, server-to-server only)
 *   embedded      the same backend composition inside this function, on PostgreSQL
 *   local         development: previews, status and evidence fail closed (MCP_CLOUD_RUNTIME_REQUIRED) — local services keep
 *                 file journals, which the gateway must not read or write; use FLOFI_RUNTIME=embedded with a database
 *   unconfigured  hosted without a runtime: CLOUD_RUNTIME_NOT_CONFIGURED
 *
 * Reads are always made AS the owning wallet (`owner`), which comes from the operator's grant for the credential, never from
 * a tool argument; the runtime answers `null` for any run that wallet does not own.
 */
import type { FlowName } from '../../backend/flows.ts';
import { cloudFlow, cloudFlowMode, cloudPreview, cloudRun, cloudRunJournal, flowRuntimeKind, type CloudJournalPage, type CloudRun, type EmbeddedRuntime,
  type FlowRuntimeKind, type FlowRuntimeMode } from '../server/flow-runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
export type EvidenceRecord = { readonly bundleHash: string; readonly environment: string; readonly outcome: string; readonly content: unknown };
export type McpRuntime = {
  readonly kind: FlowRuntimeKind;
  /** The flow's enablement on this deployment; `null` when it cannot be known here (local). */
  readonly mode: (flow: FlowName) => Promise<FlowRuntimeMode | null>;
  /**
   * BUILD-MCP-002: the flow's own owner-execution switch (`info.executionEnabled`, e.g. a mainnet flow whose Simulate/Review are on
   * but whose owner execution needs a separate opt-in). Only called for flows that expose `info`; `null` when unknown.
   */
  readonly info?: (flow: FlowName) => Promise<{ readonly executionEnabled: boolean } | null>;
  readonly preview: (flow: FlowName, args: readonly unknown[]) => Promise<Result<unknown>>;
  readonly run: (runId: string, owner: string) => Promise<Result<CloudRun | null>>;
  readonly journal: (runId: string, owner: string, after: number | null, limit: number) => Promise<Result<CloudJournalPage | null>>;
  /** The evidence the flow derives from its durable record (`FLOWS[flow].evidence`), read with the owner's read-only `status`. */
  readonly evidence: (flow: FlowName, runId: string, owner: string) => Promise<Result<EvidenceRecord | null>>;
};

const REQUIRED: Result<never> = { ok: false, code: 'MCP_CLOUD_RUNTIME_REQUIRED' };
async function evidenceOf(flow: FlowName, record: Result<unknown> | null): Promise<Result<EvidenceRecord | null>> {
  if (!record) return REQUIRED;
  if (!record.ok) return record;
  const { FLOWS } = await import('../../backend/flows.ts');
  const evidence = FLOWS[flow].evidence(record.value);
  if (!evidence) return { ok: true, value: null };
  return { ok: true, value: { bundleHash: evidence.bundleHash, environment: evidence.environment, outcome: evidence.outcome,
    content: JSON.parse(new TextDecoder().decode(evidence.bytes)) as unknown } };
}

const infoOf = (result: { ok: boolean; value?: unknown } | null) => {
  const value = result?.ok ? result.value as { executionEnabled?: unknown } | null : null;
  return value && typeof value.executionEnabled === 'boolean' ? { executionEnabled: value.executionEnabled } : null;
};

/** The deployment's runtime through the existing selection (`flow-runtime.ts`). */
export function deploymentRuntime(env: Env = process.env): McpRuntime {
  return {
    kind: flowRuntimeKind(env),
    mode: flow => cloudFlowMode(flow, env),
    info: async flow => infoOf(await cloudFlow<unknown>(flow, 'info', [], { env })),
    preview: async (flow, args) => await cloudPreview(flow, args, { env }) ?? REQUIRED,
    run: async (runId, owner) => await cloudRun(runId, owner, { env }) ?? REQUIRED,
    journal: async (runId, owner, after, limit) => await cloudRunJournal(runId, owner, after, limit, { env }) ?? REQUIRED,
    evidence: async (flow, runId, owner) => evidenceOf(flow, await cloudFlow(flow, 'status', [runId], { env, principal: owner })),
  };
}

/** An embedded runtime instance, e.g. one built with MOCKED seams in tests: the same calls `flow-runtime.ts` makes in embedded mode. */
export function embeddedMcpRuntime(runtime: Pick<EmbeddedRuntime, 'backend' | 'run' | 'journal'>): McpRuntime {
  const guard = async <T>(action: () => Promise<T>): Promise<Result<T>> => {
    try { return { ok: true, value: await action() }; }
    catch (error) { return { ok: false, code: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'CLOUD_RUNTIME_UNAVAILABLE' }; }
  };
  return {
    kind: 'embedded',
    mode: async flow => { const r = await runtime.backend.callFlow(flow, 'mode', []); return r.ok && (r.value === 'live' || r.value === 'harness') ? r.value : 'off'; },
    info: async flow => infoOf(await runtime.backend.callFlow(flow, 'info', []).catch(() => null)),
    preview: async (flow, args) => { const r = await guard(() => runtime.backend.previewFlow(flow, args)); return r.ok ? r.value : r; },
    run: (runId, owner) => guard(() => runtime.run(runId, owner)),
    journal: (runId, owner, after, limit) => guard(() => runtime.journal(runId, owner, after, limit)),
    evidence: async (flow, runId, owner) => evidenceOf(flow, await guard(() => runtime.backend.callFlow(flow, 'status', [runId], undefined, owner)).then(r => r.ok ? r.value : r)),
  };
}

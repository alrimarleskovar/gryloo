// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: owner-scoped execution status and evidence reads shared by every surface (moved from the MCP
 * `get_execution_status` / `get_evidence` handlers without change). A run is read only AS one of the wallets the caller may read
 * (granted, linked or shared — the caller decides and names it in `accessBasis`); an absent run and another wallet's run are
 * indistinguishable, so an execution id is never an access grant. Only allowlisted public facts leave: never calldata, unsigned
 * transactions, nonces, Review commitments or journal internals.
 */
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import type { CloudRun } from '../server/flow-runtime.ts';
import type { McpRuntime as EngineRuntime } from '../mcp/runtime.ts';
import { refuse } from './refusal.ts';

export type OwnedRun = { readonly run: CloudRun; readonly owner: string };
type Row = Record<string, unknown>;

/** The run as the first of `wallets` that owns it, or `RUN_NOT_FOUND`; a runtime failure is refused with its own code. */
export async function findOwnedRun(runtime: EngineRuntime, wallets: readonly string[], executionId: string): Promise<OwnedRun> {
  for (const wallet of wallets) {
    const result = await runtime.run(executionId, wallet);
    if (!result.ok) refuse(result.code);
    if (result.ok && result.value) return { run: result.value, owner: wallet };
  }
  // Absent and not-granted are indistinguishable: an execution id is never an access grant.
  return refuse('RUN_NOT_FOUND');
}
/** Copies exactly `keys` whose values are scalars, null or dates (as ISO strings); anything else is dropped. */
export const pickRow = (value: unknown, keys: readonly string[]): Row => {
  const source = value && typeof value === 'object' ? value as Row : {}, out: Row = {};
  for (const key of keys) { const v = source[key]; if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[key] = v; else if (v instanceof Date) out[key] = v.toISOString(); }
  return out;
};

export type JournalPageRequest = { readonly after?: number | undefined; readonly limit?: number | undefined };
/** Status, attempts and one journal page of an owned run, as FloFi's durable state records them. */
export async function executionStatusView(runtime: EngineRuntime, found: OwnedRun, executionId: string, accessBasis: string, journal: JournalPageRequest = {}) {
  const { run, owner } = found;
  const page = await runtime.journal(executionId, owner, journal.after ?? null, journal.limit ?? 25);
  if (!page.ok) return refuse(page.code);
  return { executionId: run.runId, flow: run.flow, status: run.status, provenance: run.provenance, owner, accessBasis,
    ...pickRow(run, ['errorCode', 'needsObservation', 'attentionRequired', 'hasEvidence', 'createdAt', 'updatedAt']),
    attempts: (Array.isArray(run.attempts) ? run.attempts : []).slice(0, 64).map(a => pickRow(a, ['attemptId', 'step', 'state', 'transactionHash', 'reconciled', 'preparedAtBlock', 'updatedAt'])),
    journal: { items: (page.value?.items ?? []).map(e => pickRow(e, ['sequence', 'entryHash', 'level', 'entityId', 'attemptId', 'fromState', 'toState', 'recordedAt'])),
      next: page.value?.next ?? null } };
}

/**
 * The reconciled Evidence Bundle of an owned run with its own environment and outcome, exactly as FloFi recorded them (never
 * upgraded); `canonical` says whether the bundle validated against its schema. No evidence yet → `evidence: null` and a reason.
 */
export async function evidenceView(runtime: EngineRuntime, found: OwnedRun, executionId: string, accessBasis: string) {
  const { run, owner } = found;
  const base = { executionId: run.runId, flow: run.flow, provenance: run.provenance, status: run.status, owner, accessBasis };
  if (!run.hasEvidence) return { ...base, evidence: null, reason: 'NO_RECONCILED_EVIDENCE_YET' as const };
  const record = await runtime.evidence(run.flow as Parameters<EngineRuntime['evidence']>[0], executionId, owner);
  if (!record.ok) return refuse(record.code);
  if (!record.value) return { ...base, evidence: null, reason: 'NO_RECONCILED_EVIDENCE_YET' as const };
  const content = record.value.content as { bundle?: unknown; evidence?: unknown } | null;
  let bundle: unknown = null;
  for (const candidate of [content?.bundle, content?.evidence]) { try { bundle = validateArtifact('evidence-bundle', candidate); break; } catch { /* next */ } }
  return { ...base, evidence: { bundleHash: record.value.bundleHash, environment: record.value.environment, outcome: record.value.outcome, canonicalBundle: bundle,
    canonical: bundle !== null } };
}

// SPDX-License-Identifier: AGPL-3.0-only
import type { ChainReview, MockedArtifactChain } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';

/** Display mirror of the frozen v1 invalidation matrix; Node tests prove equality. */
export const INVALIDATION_V1 = Object.freeze({
  SEMANTIC_EDIT: Object.freeze(['quote-state-artifact', 'artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization']),
  QUOTE_REFRESH: Object.freeze(['artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization']),
  ARTIFACT_EXPIRED: Object.freeze(['artifact-set', 'simulation-bundle', 'authorization-policy', 'strategy-manifest', 'execution-plan', 'authorization']),
} as const);
export const VALIDITY_MS = 60_000;

export interface ChainRecord {
  readonly chain: MockedArtifactChain;
  readonly review: ChainReview;
  readonly sourceWorkflow: Workflow;
  readonly generation: number;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly monotonicStartMs: number;
}
export type RetiredReason = 'SEMANTIC_EDIT' | 'ARTIFACT_EXPIRED';
export interface ChainState {
  readonly record: ChainRecord | null;
  readonly retired: { readonly reason: RetiredReason; readonly atRevision: number } | null;
  readonly rejected: string | null;
  readonly pending: { readonly workflow: Workflow; readonly generation: number } | null;
  readonly notice: string | null;
}
export type ChainStatus = 'EMPTY' | 'GENERATING' | 'CURRENT' | 'INVALIDATED' | 'EXPIRED' | 'REJECTED';
export type ChainEvent =
  | { readonly type: 'GENERATE_STARTED'; readonly workflow: Workflow; readonly generation: number }
  | { readonly type: 'GENERATE_SUCCEEDED'; readonly record: ChainRecord; readonly currentWorkflow: Workflow }
  | { readonly type: 'GENERATE_FAILED'; readonly code: string; readonly generation: number }
  | { readonly type: 'REVISION_ACCEPTED'; readonly workflow: Workflow }
  | { readonly type: 'ACCESS_CHECK'; readonly workflow: Workflow; readonly wallNowMs: number; readonly monotonicNowMs: number };
export type ChainAccess =
  | { readonly ok: true; readonly record: ChainRecord }
  | { readonly ok: false; readonly code: 'ARTIFACTS_UNAVAILABLE' | 'ARTIFACTS_STALE' | 'ARTIFACTS_EXPIRED' };

export const initialChainState = (): ChainState => Object.freeze({ record: null, retired: null, rejected: null, pending: null, notice: null });

export function chainStatus(state: ChainState): ChainStatus {
  if (state.pending) return 'GENERATING';
  if (state.rejected) return 'REJECTED';
  if (!state.record) return 'EMPTY';
  if (!state.retired) return 'CURRENT';
  return state.retired.reason === 'SEMANTIC_EDIT' ? 'INVALIDATED' : 'EXPIRED';
}

/**
 * The single synchronous guard for every access to or use of chain content.
 * It re-evaluates binding and expiry at the moment of access and never trusts
 * a stored flag, timer or countdown. The earliest expiry condition wins.
 */
export function checkChainAccess(state: ChainState, currentWorkflow: Workflow, wallNowMs: number, monotonicNowMs: number): ChainAccess {
  const record = state.record;
  if (!record || state.pending || state.rejected) return { ok: false, code: 'ARTIFACTS_UNAVAILABLE' };
  if (state.retired) return { ok: false, code: state.retired.reason === 'SEMANTIC_EDIT' ? 'ARTIFACTS_STALE' : 'ARTIFACTS_EXPIRED' };
  if (currentWorkflow.revision !== record.review.revision || currentWorkflow !== record.sourceWorkflow) {
    return { ok: false, code: 'ARTIFACTS_STALE' };
  }
  if (!Number.isFinite(wallNowMs) || !Number.isFinite(monotonicNowMs)
      || wallNowMs >= record.expiresAtMs || wallNowMs < record.observedAtMs
      || monotonicNowMs - record.monotonicStartMs >= VALIDITY_MS || monotonicNowMs < record.monotonicStartMs) {
    return { ok: false, code: 'ARTIFACTS_EXPIRED' };
  }
  return { ok: true, record };
}

export function requireCurrentChain(state: ChainState, currentWorkflow: Workflow, wallNowMs: number, monotonicNowMs: number): ChainRecord {
  const access = checkChainAccess(state, currentWorkflow, wallNowMs, monotonicNowMs);
  if (!access.ok) throw new Error(access.code);
  return access.record;
}

/** Pure transitions; artifacts are never mutated, only replaced or retired. */
export function chainReducer(state: ChainState, event: ChainEvent): ChainState {
  switch (event.type) {
    case 'GENERATE_STARTED':
      if (state.pending) return state;
      return { ...state, pending: { workflow: event.workflow, generation: event.generation }, rejected: null, notice: null };
    case 'GENERATE_SUCCEEDED': {
      const pending = state.pending;
      if (!pending || event.record.generation !== pending.generation) return state;
      if (event.currentWorkflow !== pending.workflow || event.record.sourceWorkflow !== pending.workflow) {
        // Completed for a superseded revision: discard the result and keep the prior status.
        return {
          ...state, pending: null, notice: 'GENERATION_DISCARDED_SUPERSEDED_REVISION',
          retired: state.record && !state.retired && state.record.sourceWorkflow !== event.currentWorkflow
            ? { reason: 'SEMANTIC_EDIT', atRevision: event.currentWorkflow.revision } : state.retired,
        };
      }
      return { record: event.record, retired: null, rejected: null, pending: null, notice: null };
    }
    case 'GENERATE_FAILED':
      if (!state.pending || event.generation !== state.pending.generation) return state;
      // A failed self-check or review withdraws any earlier chain as well.
      return { record: null, retired: null, rejected: event.code, pending: null, notice: null };
    case 'REVISION_ACCEPTED':
      if (!state.record || state.record.sourceWorkflow === event.workflow
          || state.retired?.reason === 'SEMANTIC_EDIT') return state;
      return { ...state, retired: { reason: 'SEMANTIC_EDIT', atRevision: event.workflow.revision } };
    case 'ACCESS_CHECK': {
      if (!state.record || state.retired || state.pending || state.rejected) return state;
      const access = checkChainAccess(state, event.workflow, event.wallNowMs, event.monotonicNowMs);
      if (access.ok) return state;
      return {
        ...state,
        retired: access.code === 'ARTIFACTS_STALE'
          ? { reason: 'SEMANTIC_EDIT', atRevision: event.workflow.revision }
          : { reason: 'ARTIFACT_EXPIRED', atRevision: event.workflow.revision },
      };
    }
    default:
      return state;
  }
}

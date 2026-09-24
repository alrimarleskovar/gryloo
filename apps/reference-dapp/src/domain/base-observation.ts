// SPDX-License-Identifier: AGPL-3.0-only
import {
  BASE_OBSERVATION_PROFILE, BaseObservationError, reviewBaseObservation,
  type BaseObservationReview, type ReviewContext, type Symbol, type TierStatus,
} from '@defi-workflow-engine/reference-linter';
import type { QuoteStateArtifact } from '@defi-workflow-engine/workflow-contracts';
import type { Workflow } from './initial-workflow';
import { formatHumanAmount } from './swap-authoring';

/** What the single Server Action returns. It never carries keys, URLs or user addresses. */
export type ReadResult =
  | { readonly ok: true; readonly transcript: string; readonly artifact: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly requestsSent: number };

export interface ObservationRecord {
  readonly nodeId: string;
  readonly artifact: QuoteStateArtifact;
  readonly artifactJson: string;
  readonly transcript: string;
  readonly review: BaseObservationReview;
  readonly sourceWorkflow: Workflow;
  readonly observedAtMs: number;
  readonly expiresAtMs: number;
  readonly receivedAtMs: number;
  readonly monotonicStartMs: number;
}
export type RetiredReason = 'SEMANTIC_EDIT' | 'EXPIRED';
export type NodeObservation =
  | { readonly status: 'READING'; readonly token: number; readonly workflow: Workflow }
  | { readonly status: 'FAILED'; readonly code: string; readonly message: string }
  | { readonly status: 'CURRENT'; readonly record: ObservationRecord }
  | { readonly status: 'RETIRED'; readonly reason: RetiredReason; readonly record: ObservationRecord; readonly atRevision: number };
export type ObservationState = Readonly<Record<string, NodeObservation>>;
export type ObservationEvent =
  | { readonly type: 'READ_STARTED'; readonly nodeId: string; readonly token: number; readonly workflow: Workflow }
  | { readonly type: 'READ_SUCCEEDED'; readonly nodeId: string; readonly token: number; readonly record: ObservationRecord; readonly currentWorkflow: Workflow }
  | { readonly type: 'READ_FAILED'; readonly nodeId: string; readonly token: number; readonly code: string; readonly message: string }
  | { readonly type: 'REVISION_ACCEPTED'; readonly workflow: Workflow }
  | { readonly type: 'ACCESS_CHECK'; readonly workflow: Workflow; readonly wallNowMs: number; readonly monotonicNowMs: number };
export type ObservationAccess =
  | { readonly ok: true; readonly record: ObservationRecord }
  | { readonly ok: false; readonly code: 'OBSERVATION_UNAVAILABLE' | 'OBSERVATION_STALE' | 'OBSERVATION_EXPIRED' };

export const initialObservationState = (): ObservationState => Object.freeze({});

/**
 * The single synchronous guard for every access to an observation. Binding
 * and expiry are re-evaluated at the moment of access; no stored flag, timer
 * or countdown is trusted.
 */
export function checkObservationAccess(entry: NodeObservation | undefined, workflow: Workflow, wallNowMs: number, monotonicNowMs: number): ObservationAccess {
  if (!entry || entry.status !== 'CURRENT') return { ok: false, code: 'OBSERVATION_UNAVAILABLE' };
  const record = entry.record;
  if (workflow.revision !== record.review.revision || workflow !== record.sourceWorkflow) return { ok: false, code: 'OBSERVATION_STALE' };
  const skewMs = BASE_OBSERVATION_PROFILE.maximumClockSkewSeconds * 1000;
  if (!Number.isFinite(wallNowMs) || !Number.isFinite(monotonicNowMs)
      || wallNowMs >= record.expiresAtMs || wallNowMs < record.observedAtMs - skewMs
      || monotonicNowMs < record.monotonicStartMs
      || monotonicNowMs - record.monotonicStartMs >= record.expiresAtMs - record.receivedAtMs) {
    return { ok: false, code: 'OBSERVATION_EXPIRED' };
  }
  return { ok: true, record };
}

function retire(entry: NodeObservation, reason: RetiredReason, atRevision: number): NodeObservation {
  return entry.status === 'CURRENT' ? { status: 'RETIRED', reason, record: entry.record, atRevision } : entry;
}

/** Pure transitions. A new read retires the previous observation for that swap. */
export function observationReducer(state: ObservationState, event: ObservationEvent): ObservationState {
  switch (event.type) {
    case 'READ_STARTED':
      if (state[event.nodeId]?.status === 'READING') return state;
      return { ...state, [event.nodeId]: { status: 'READING', token: event.token, workflow: event.workflow } };
    case 'READ_SUCCEEDED': {
      const entry = state[event.nodeId];
      if (entry?.status !== 'READING' || entry.token !== event.token || event.record.sourceWorkflow !== entry.workflow) return state;
      // Completed for a superseded revision: keep it retired, never current.
      if (event.currentWorkflow !== entry.workflow) {
        return { ...state, [event.nodeId]: { status: 'RETIRED', reason: 'SEMANTIC_EDIT', record: event.record, atRevision: event.currentWorkflow.revision } };
      }
      return { ...state, [event.nodeId]: { status: 'CURRENT', record: event.record } };
    }
    case 'READ_FAILED': {
      const entry = state[event.nodeId];
      if (entry?.status !== 'READING' || entry.token !== event.token) return state;
      return { ...state, [event.nodeId]: { status: 'FAILED', code: event.code, message: event.message } };
    }
    case 'REVISION_ACCEPTED': {
      let changed = false;
      const next: Record<string, NodeObservation> = { ...state };
      for (const [nodeId, entry] of Object.entries(state)) {
        if (entry.status === 'CURRENT' && entry.record.sourceWorkflow !== event.workflow) {
          next[nodeId] = retire(entry, 'SEMANTIC_EDIT', event.workflow.revision);
          changed = true;
        }
      }
      return changed ? next : state;
    }
    case 'ACCESS_CHECK': {
      let changed = false;
      const next: Record<string, NodeObservation> = { ...state };
      for (const [nodeId, entry] of Object.entries(state)) {
        const access = checkObservationAccess(entry, event.workflow, event.wallNowMs, event.monotonicNowMs);
        if (entry.status === 'CURRENT' && !access.ok) {
          next[nodeId] = retire(entry, access.code === 'OBSERVATION_STALE' ? 'SEMANTIC_EDIT' : 'EXPIRED', event.workflow.revision);
          changed = true;
        }
      }
      return changed ? next : state;
    }
    default:
      return state;
  }
}

/**
 * Receipt verification in the browser: the self-checked digest recomputes
 * the transcript hash, the linter re-derives the artifact from the transcript
 * alone, and the revision binding is checked. Failures carry a code only.
 */
export async function receiveObservation(
  result: ReadResult, input: { readonly nodeId: string; readonly sourceWorkflow: Workflow; readonly currentWorkflow: Workflow; readonly wallNowMs: number; readonly monotonicNowMs: number },
  context: ReviewContext,
): Promise<ObservationRecord> {
  if (!result.ok) throw new BaseObservationError(result.code, result.requestsSent);
  let artifact: QuoteStateArtifact;
  try { artifact = JSON.parse(result.artifact) as QuoteStateArtifact; } catch { throw new BaseObservationError('DERIVATION_MISMATCH'); }
  const review = await reviewBaseObservation({
    artifact, transcript: new TextEncoder().encode(result.transcript),
    sourceWorkflow: input.sourceWorkflow, currentWorkflow: input.currentWorkflow, nowMs: input.wallNowMs,
  }, context);
  if (review.nodeId !== input.nodeId) throw new BaseObservationError('DERIVATION_MISMATCH');
  return Object.freeze({
    nodeId: input.nodeId, artifact, artifactJson: JSON.stringify(artifact, null, 2), transcript: result.transcript, review,
    sourceWorkflow: input.sourceWorkflow, observedAtMs: Date.parse(review.observedAt), expiresAtMs: Date.parse(review.expiresAt),
    receivedAtMs: input.wallNowMs, monotonicStartMs: input.monotonicNowMs,
  });
}

export const MODE_LABEL = Object.freeze({ LIVE_READ_ONLY: 'LIVE READ-ONLY · NOT EVIDENCE', RECORDED_REPLAY: 'RECORDED REPLAY · NOT LIVE' } as const);
const STATUS_LABEL: Readonly<Record<TierStatus, string>> = Object.freeze({
  NO_POOL: 'No pool',
  QUOTED: 'Quoted · full input proven',
  FULL_INPUT_NOT_PROVEN: 'Withheld · full input not proven',
  ZERO_OUTPUT: 'Zero output · no number shown',
  QUOTE_REVERTED: 'Quote reverted · no number shown',
});

export interface TierView {
  readonly fee: number;
  readonly feeLabel: string;
  readonly pool: string | null;
  readonly status: TierStatus;
  readonly statusLabel: string;
  /** Null unless the tier is QUOTED; withheld numbers never reach the view. */
  readonly amount: { readonly units: string; readonly human: string; readonly symbol: Symbol } | null;
}
export interface ObservationView {
  readonly from: Symbol;
  readonly to: Symbol;
  readonly amountIn: { readonly units: string; readonly human: string };
  readonly modeLabel: string;
  readonly block: { readonly number: number; readonly hash: string; readonly time: string };
  readonly tiers: readonly TierView[];
  readonly checks: readonly string[];
}

export function observationView(record: ObservationRecord, context: ReviewContext): ObservationView {
  const facts = record.review.facts;
  const { from, to, amountIn } = facts.swap;
  const pin = (label: string, digest: string) => `${label} · code present · SHA-256 ${digest} equals the reviewed pin`;
  return Object.freeze({
    from, to,
    amountIn: { units: amountIn, human: formatHumanAmount(amountIn, from, context) },
    modeLabel: MODE_LABEL[facts.mode],
    block: { number: facts.block.number, hash: facts.block.hash, time: new Date(facts.block.timestamp * 1000).toISOString() },
    tiers: facts.tiers.map(tier => ({
      fee: tier.fee, feeLabel: `${tier.fee} (${tier.fee / 100} bps)`, pool: tier.pool, status: tier.status, statusLabel: STATUS_LABEL[tier.status],
      amount: tier.status === 'QUOTED' && tier.amountOut !== null ? { units: tier.amountOut, human: formatHumanAmount(tier.amountOut, to, context), symbol: to } : null,
    })),
    checks: [
      `${pin('USDC', facts.code.usdc)} · decimals ${facts.assets.USDC.decimals} · symbol ${facts.assets.USDC.symbol}`,
      `${pin('WETH', facts.code.weth)} · decimals ${facts.assets.WETH.decimals} · symbol ${facts.assets.WETH.symbol}`,
      pin('UniswapV3Factory', facts.code.factory),
      `${pin('QuoterV2', facts.code.quoter)} · factory() and WETH9() equal the documented factory and WETH`,
      `Every state read was pinned to block hash ${facts.block.hash} (requireCanonical) and the block was re-read unchanged`,
    ],
  });
}

/** Plain-language messages for failures detected in the browser. */
export function browserFailureMessage(code: string): string {
  if (code === 'DIGEST_UNAVAILABLE') return 'The hashing self-check failed in this browser. No values are shown.';
  if (code === 'MOCK_MARKER_FORBIDDEN') return 'The result carried a MOCKED marker and was rejected. No values are shown.';
  if (code === 'INTERNAL_ERROR') return 'The local server did not return a usable result. No values are shown.';
  return `Browser verification failed (${code}). No values are shown.`;
}

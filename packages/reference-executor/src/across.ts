// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic MOCKED Across financial lifecycle; no wallet or network transport. */
import { createHash } from 'node:crypto';
import { prepareAttemptState, transitionAttemptState, type Attempt } from './attempts.js';
import type { AcrossReview } from '@defi-workflow-engine/reference-compiler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type AcrossRoute = { readonly provider: 'across.direct'; readonly provenance: 'LIVE_READ_ONLY' | 'DETERMINISTIC_FIXTURE';
  readonly quoteId: string; readonly rawHash: string; readonly owner: string; readonly sourceChainId: 8453;
  readonly destinationChainId: 42161; readonly inputToken: string; readonly outputToken: string; readonly inputAmount: string;
  readonly expectedOutput: string; readonly minimumOutput: string; readonly allowance: string; readonly approvalSpender: string;
  readonly approvals: readonly { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0' }[];
  readonly deposit: { readonly chainId: 8453; readonly to: string; readonly data: string; readonly value: '0x0'; readonly gas: string };
  readonly refundAddress: string; readonly refundOnOrigin: true; readonly feeMaximum: string; readonly maximumGasCostWei: string; readonly observedAt: string;
  readonly quoteExpiresAt: string; readonly expectedFillSeconds: number };
export type AcrossState = 'QUOTED' | 'AUTHORIZED' | 'APPROVAL_CONFIRMED' | 'DEPOSIT_PREPARED'
  | 'DEPOSIT_UNKNOWN' | 'DEPOSIT_SUBMITTED' | 'SOURCE_CONFIRMED' | 'FILL_PENDING' | 'FILL_DELAYED'
  | 'FILLED' | 'RECONCILED' | 'REFUND_ELIGIBLE' | 'REFUND_PENDING' | 'REFUNDED';
export type AcrossEvent = { readonly sequence: number; readonly state: AcrossState; readonly at: string; readonly note: string };
export type AcrossExecution = { readonly format: 'gryloo.across.mocked.v1'; readonly executionId: string;
  readonly workflow: SemanticWorkflow; readonly quote: AcrossRoute; readonly review: AcrossReview;
  readonly state: AcrossState; readonly events: readonly AcrossEvent[]; readonly attempts: readonly Attempt[];
  readonly depositHash: string | null; readonly fillHash: string | null; readonly refundHash: string | null;
  readonly received: string | null; readonly fillDeadlineMs: number | null };
const tx = (input: string) => '0x' + createHash('sha256').update(input).digest('hex');
function fail(): never { throw new Error('ACROSS_TRANSITION_INVALID'); }
function advance(run: AcrossExecution, state: AcrossState, note: string, patch: Partial<AcrossExecution> = {}, nowMs = Date.now()): AcrossExecution {
  return { ...run, ...patch, state, events: [...run.events, { sequence: run.events.length, state, at: new Date(nowMs).toISOString(), note }] };
}
export function acrossQuoteFresh(run: AcrossExecution, nowMs: number): boolean {
  return Number.isFinite(nowMs) && Date.parse(run.quote.quoteExpiresAt) > nowMs;
}
export function newAcrossExecution(executionId: string, workflow: SemanticWorkflow, quote: AcrossRoute,
  review: AcrossReview, nowMs: number): AcrossExecution {
  if (!/^across-[0-9a-f]{24}$/.test(executionId) || quote.provider !== 'across.direct'
    || review.provider.kind !== 'FIXED' || review.provider.providerId !== quote.provider
    || !Number.isFinite(nowMs) || Date.parse(quote.quoteExpiresAt) <= nowMs) fail();
  return { format: 'gryloo.across.mocked.v1', executionId, workflow, quote, review, state: 'QUOTED',
    events: [{ sequence: 0, state: 'QUOTED', at: new Date(nowMs).toISOString(), note: 'Across read-only quote; financial steps are simulated' }],
    attempts: [], depositHash: null, fillHash: null, refundHash: null, received: null, fillDeadlineMs: null };
}
export function authorizeAcross(run: AcrossExecution, manifestHash: string, nowMs: number): AcrossExecution {
  if (run.state !== 'QUOTED' || !acrossQuoteFresh(run, nowMs) || manifestHash !== run.review.manifestHash
    || run.review.provider.providerId !== 'across.direct') fail();
  return advance(run, 'AUTHORIZED', 'Fixed Across provider reviewed for simulation', {}, nowMs);
}
export function approveAcross(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'AUTHORIZED' || !acrossQuoteFresh(run, nowMs)) fail();
  const attempts = [...run.attempts];
  for (const [index, payloadHash] of run.review.approvalHashes.entries()) {
    const stepId = 'across.approval.' + index;
    const result = prepareAttemptState(attempts, { executionId: run.executionId, stepId,
      idempotencyKey: run.executionId + ':' + stepId, payloadHash, preparedAtBlock: 0, priorStepConfirmed: true });
    if (result.kind !== 'PREPARED') fail();
    const submitting = transitionAttemptState(result.attempt, 'SUBMITTING');
    const pending = transitionAttemptState(submitting, 'PENDING', tx(result.attempt.executionAttemptId + payloadHash));
    attempts.push(transitionAttemptState(pending, 'CONFIRMED'));
  }
  return advance(run, 'APPROVAL_CONFIRMED', run.quote.approvals.length ? 'MOCKED exact approval confirmed' : 'Existing allowance sufficient; no approval needed', { attempts }, nowMs);
}
export function prepareAcrossDeposit(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'APPROVAL_CONFIRMED' || !acrossQuoteFresh(run, nowMs) || run.attempts.some(a => a.stepId === 'across.deposit')) fail();
  const result = prepareAttemptState(run.attempts, { executionId: run.executionId, stepId: 'across.deposit',
    idempotencyKey: run.executionId + ':across.deposit', payloadHash: run.review.depositHash,
    preparedAtBlock: 0, priorStepConfirmed: true });
  if (result.kind !== 'PREPARED') fail();
  return advance(run, 'DEPOSIT_PREPARED', 'Deposit payload and one attempt durably prepared',
    { attempts: [...run.attempts, result.attempt] }, nowMs);
}
export function submitAcrossDeposit(run: AcrossExecution, uncertain: boolean, nowMs: number): AcrossExecution {
  if (run.state !== 'DEPOSIT_PREPARED' || !acrossQuoteFresh(run, nowMs)) fail();
  const prior = run.attempts.find(a => a.stepId === 'across.deposit'); if (!prior || prior.state !== 'PREPARED') fail();
  const submitting = transitionAttemptState(prior, 'SUBMITTING');
  const next = uncertain ? transitionAttemptState(submitting, 'SUBMISSION_RESULT_UNKNOWN')
    : transitionAttemptState(submitting, 'PENDING', tx(prior.executionAttemptId + prior.payloadHash));
  return advance(run, uncertain ? 'DEPOSIT_UNKNOWN' : 'DEPOSIT_SUBMITTED',
    uncertain ? 'MOCKED response uncertain; read back this attempt' : 'MOCKED deposit submitted',
    { attempts: run.attempts.map(a => a.executionAttemptId === prior.executionAttemptId ? next : a),
      depositHash: next.transactionHash,
      fillDeadlineMs: nowMs + 3_600_000 }, nowMs);
}
export function recheckAcrossDeposit(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'DEPOSIT_UNKNOWN') fail();
  const prior = run.attempts.find(a => a.stepId === 'across.deposit');
  if (!prior || prior.state !== 'SUBMISSION_RESULT_UNKNOWN') fail();
  const found = transitionAttemptState(prior, 'PENDING', tx(prior.executionAttemptId + prior.payloadHash));
  return advance(run, 'DEPOSIT_SUBMITTED', 'MOCKED readback found existing deposit; no resend',
    { attempts: run.attempts.map(a => a.executionAttemptId === prior.executionAttemptId ? found : a), depositHash: found.transactionHash }, nowMs);
}
export function confirmAcrossSource(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'DEPOSIT_SUBMITTED') fail();
  const prior = run.attempts.find(a => a.stepId === 'across.deposit'); if (!prior || prior.state !== 'PENDING') fail();
  const confirmed = transitionAttemptState(prior, 'CONFIRMED');
  return advance(run, 'SOURCE_CONFIRMED', 'MOCKED origin deposit receipt confirmed; destination pending',
    { attempts: run.attempts.map(a => a.executionAttemptId === prior.executionAttemptId ? confirmed : a) }, nowMs);
}
export function progressAcrossFill(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'SOURCE_CONFIRMED') fail();
  return advance(run, 'FILL_PENDING', 'MOCKED deposit indexed; fill pending', {}, nowMs);
}
export function delayAcrossFill(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'FILL_PENDING' && run.state !== 'FILL_DELAYED') fail();
  return advance(run, 'FILL_DELAYED', 'Expected fill time passed; source remains confirmed and funds are in transit', {}, nowMs);
}
export function fillAcross(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (!['FILL_PENDING', 'FILL_DELAYED'].includes(run.state) || run.fillDeadlineMs === null || nowMs >= run.fillDeadlineMs) fail();
  return advance(run, 'FILLED', 'MOCKED Across destination fill observed; reconciliation required',
    { fillHash: tx(run.executionId + ':fill') }, nowMs);
}
export function reconcileAcross(run: AcrossExecution, observation: { readonly owner: string; readonly token: string;
  readonly sourceHash: string; readonly fillHash: string; readonly before: string; readonly after: string }, nowMs: number): AcrossExecution {
  if (run.state !== 'FILLED' || observation.owner !== run.quote.owner || observation.token !== run.quote.outputToken
    || observation.sourceHash !== run.depositHash || observation.fillHash !== run.fillHash
    || !/^[0-9]+$/.test(observation.before) || !/^[0-9]+$/.test(observation.after)) fail();
  const received = BigInt(observation.after) - BigInt(observation.before);
  if (received < BigInt(run.quote.minimumOutput) || received > BigInt(run.quote.expectedOutput)) fail();
  return advance(run, 'RECONCILED', 'MOCKED receipt and destination balance delta reconciled', { received: received.toString() }, nowMs);
}
export function expireAcrossDeposit(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (!['SOURCE_CONFIRMED', 'FILL_PENDING', 'FILL_DELAYED'].includes(run.state)
    || run.fillDeadlineMs === null || nowMs < run.fillDeadlineMs) fail();
  return advance(run, 'REFUND_ELIGIBLE', 'MOCKED fill deadline passed without fill; refund eligible', {}, nowMs);
}
export function pendingAcrossRefund(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'REFUND_ELIGIBLE') fail();
  return advance(run, 'REFUND_PENDING', 'MOCKED Across settlement refund pending', {}, nowMs);
}
export function confirmAcrossRefund(run: AcrossExecution, nowMs: number): AcrossExecution {
  if (run.state !== 'REFUND_PENDING') fail();
  return advance(run, 'REFUNDED', 'MOCKED origin refund confirmed', { refundHash: tx(run.executionId + ':refund') }, nowMs);
}
export function validateAcrossExecution(value: unknown): AcrossExecution {
  if (!value || typeof value !== 'object') fail();
  const run = value as AcrossExecution;
  if (run.format !== 'gryloo.across.mocked.v1' || !/^across-[0-9a-f]{24}$/.test(run.executionId)
    || run.quote.provider !== 'across.direct' || run.review.provider.kind !== 'FIXED'
    || run.review.provider.providerId !== 'across.direct' || !Array.isArray(run.events) || !run.events.length
    || run.events.at(-1)?.state !== run.state || run.events.some((event, index) => event.sequence !== index)
    || !Array.isArray(run.attempts) || run.attempts.filter(a => a.stepId === 'across.deposit').length > 1) fail();
  return run;
}

// SPDX-License-Identifier: AGPL-3.0-only
/** Deterministic MOCKED bridge execution over the canonical journal and per-step attempt rules. */
import { createHash } from 'node:crypto';
import { BRIDGE_SOURCE, BRIDGE_DESTINATION, validateBridgeJournal,
  type BridgeJournal, type BridgeState, type ExecutionJournal, type EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import type { BridgeCompiled, BridgeRoute } from '@defi-workflow-engine/reference-compiler';
import { prepareAttemptState, transitionAttemptState, type Attempt } from './attempts.js';
import { createJournal, appendJournalState } from './journal.js';

export type BridgeExecution = { readonly format: 'gryloo.bridge-execution.v1'; readonly executionId: string;
  readonly route: BridgeRoute; readonly compiled: BridgeCompiled; readonly authorized: boolean;
  readonly scenario: 'normal' | 'uncertain'; readonly attempts: readonly Attempt[];
  readonly bridgeJournal: BridgeJournal; readonly canonicalJournal: ExecutionJournal;
  readonly destination: null | { readonly transactionHash: string; readonly receivedAmount: string;
    readonly recipient: string; readonly token: string; readonly chainId: typeof BRIDGE_DESTINATION };
  readonly evidence: { readonly bundle: EvidenceBundle; readonly hash: string } | null };
const at = () => new Date().toISOString();
const tx = (seed: string) => '0x' + createHash('sha256').update(seed).digest('hex');
function appendCanonical(run: BridgeExecution, level: 'workflow' | 'segment' | 'step' | 'attempt', entityId: string, toState: string, attemptId: string | null = null, stepId: string | null = null): ExecutionJournal {
  const actualStep = level === 'attempt' ? stepId : level === 'step' ? entityId : null;
  return appendJournalState(run.canonicalJournal, { level, entityId: level === 'workflow' ? run.canonicalJournal.workflowId : entityId,
    segmentId: level === 'workflow' ? null : 'bridge.segment.base', stepId: actualStep,
    executionAttemptId: attemptId, toState: toState as Attempt['state'], recordedAt: at() }).journal;
}
function setJournal(run: BridgeExecution, level: 'workflow' | 'segment' | 'step', entityId: string, state: string): BridgeExecution {
  return { ...run, canonicalJournal: appendCanonical(run, level, entityId, state) };
}
function event(run: BridgeExecution, state: BridgeState, step: 'approval' | 'source' | 'bridge' | 'destination', transactionHash: string | null, note: string): BridgeExecution {
  const bridgeJournal = validateBridgeJournal({ ...run.bridgeJournal, events: [...run.bridgeJournal.events,
    { sequence: run.bridgeJournal.events.length, at: at(), state, sourceChainId: BRIDGE_SOURCE,
      destinationChainId: BRIDGE_DESTINATION, step, transactionHash, note }] });
  return { ...run, bridgeJournal };
}
function advance(run: BridgeExecution, attemptId: string, state: Attempt['state'], hash: string | null = null): BridgeExecution {
  const prior = run.attempts.find(x => x.executionAttemptId === attemptId);
  if (!prior) throw new Error('BRIDGE_ATTEMPT_MISSING');
  const next = transitionAttemptState(prior, state, hash ?? prior.transactionHash);
  const updated = { ...run, attempts: run.attempts.map(x => x.executionAttemptId === attemptId ? next : x) };
  return { ...updated, canonicalJournal: appendCanonical(updated, 'attempt', attemptId, state, attemptId, prior.stepId) };
}
function prepare(run: BridgeExecution, stepId: string, payloadHash: string): BridgeExecution {
  const result = prepareAttemptState(run.attempts, { executionId: run.executionId, stepId,
    idempotencyKey: run.executionId + ':' + stepId, payloadHash, preparedAtBlock: 0, priorStepConfirmed: true });
  if (result.kind !== 'PREPARED') throw new Error('BRIDGE_STEP_ALREADY_PREPARED');
  const updated = { ...run, attempts: [...run.attempts, result.attempt] };
  const executing = setJournal(updated, 'step', stepId, 'EXECUTING');
  return { ...executing, canonicalJournal: appendCanonical(executing, 'attempt', result.attempt.executionAttemptId, 'PREPARED', result.attempt.executionAttemptId, stepId) };
}
export function bridgeState(run: BridgeExecution): BridgeState { return run.bridgeJournal.events.at(-1)?.state ?? 'NOT_SENT'; }
export function newBridgeExecution(executionId: string, route: BridgeRoute, compiled: BridgeCompiled,
  scenario: 'normal' | 'uncertain' = 'normal'): BridgeExecution {
  if (!/^bridge-[0-9a-f]{24}$/.test(executionId)) throw new Error('BRIDGE_EXECUTION_ID_INVALID');
  let canonical = createJournal({ journalId: executionId + '.journal', workflowId: 'workflow-local',
    executionPlanHash: compiled.hashes.plan, manifestHash: compiled.hashes.manifest });
  for (const state of ['DRAFT', 'REVIEWED', 'SIMULATED'] as const) {
    canonical = appendJournalState(canonical, { level: 'workflow', entityId: canonical.workflowId, segmentId: null,
      stepId: null, executionAttemptId: null, toState: state, recordedAt: at() }).journal;
  }
  for (const state of ['PLANNED', 'READY'] as const) {
    canonical = appendJournalState(canonical, { level: 'segment', entityId: 'bridge.segment.base', segmentId: 'bridge.segment.base',
      stepId: null, executionAttemptId: null, toState: state, recordedAt: at() }).journal;
  }
  for (const stepId of ['bridge.step.approval', 'bridge.step.source']) {
    for (const state of ['PLANNED', 'READY'] as const) {
      canonical = appendJournalState(canonical, { level: 'step', entityId: stepId, segmentId: 'bridge.segment.base',
        stepId, executionAttemptId: null, toState: state, recordedAt: at() }).journal;
    }
  }
  const bridgeJournal = validateBridgeJournal({ format: 'gryloo.bridge-journal.v1', executionId,
    workflowHash: compiled.hashes.workflow, manifestHash: compiled.hashes.manifest, quoteHash: compiled.hashes.quote,
    events: [{ sequence: 0, at: at(), state: 'NOT_SENT', sourceChainId: BRIDGE_SOURCE,
      destinationChainId: BRIDGE_DESTINATION, step: 'source', transactionHash: null, note: 'Prepared; no submission' }] });
  return { format: 'gryloo.bridge-execution.v1', executionId, route, compiled, authorized: false, scenario,
    attempts: [], bridgeJournal, canonicalJournal: canonical, destination: null, evidence: null };
}
export function authorizeBridge(run: BridgeExecution, manifestHash: string, nowMs: number): BridgeExecution {
  if (run.authorized || manifestHash !== run.compiled.hashes.manifest || Date.parse(run.route.expiresAt) <= nowMs
    || bridgeState(run) !== 'NOT_SENT') throw new Error('BRIDGE_AUTHORIZATION_INVALID');
  const updated = { ...run, authorized: true };
  return { ...updated, canonicalJournal: appendCanonical(updated, 'workflow', run.executionId, 'AUTHORIZED', null) };
}
export function rehearseBridgeApproval(run: BridgeExecution, nowMs: number): BridgeExecution {
  if (!run.authorized || run.attempts.length || Date.parse(run.route.expiresAt) <= nowMs) throw new Error('BRIDGE_APPROVAL_NOT_READY');
  let next = prepare(run, 'bridge.step.approval', run.compiled.hashes.approvalPayload);
  const id = next.attempts.at(-1)!.executionAttemptId;
  next = advance(next, id, 'SUBMITTING');
  next = advance(next, id, 'PENDING', tx(id + run.compiled.hashes.approvalPayload));
  next = advance(next, id, 'CONFIRMED');
  next = setJournal(next, 'step', 'bridge.step.approval', 'RECONCILING');
  next = setJournal(next, 'step', 'bridge.step.approval', 'COMPLETED');
  return event(next, 'NOT_SENT', 'approval', next.attempts.at(-1)!.transactionHash, 'MOCKED exact USDC approval confirmed');
}
export function rehearseBridgeSource(run: BridgeExecution, nowMs: number): BridgeExecution {
  if (!run.authorized || Date.parse(run.route.expiresAt) <= nowMs || bridgeState(run) !== 'NOT_SENT'
    || run.attempts.find(x => x.stepId === 'bridge.step.approval')?.state !== 'CONFIRMED'
    || run.attempts.some(x => x.stepId === 'bridge.step.source')) throw new Error('BRIDGE_SOURCE_NOT_READY');
  let next = prepare(run, 'bridge.step.source', run.compiled.hashes.sourcePayload);
  next = { ...next, canonicalJournal: appendCanonical(next, 'workflow', run.executionId, 'EXECUTING', null) };
  const id = next.attempts.at(-1)!.executionAttemptId;
  next = advance(next, id, 'SUBMITTING');
  if (run.scenario === 'uncertain') {
    next = advance(next, id, 'SUBMISSION_RESULT_UNKNOWN');
    return event(next, 'UNKNOWN', 'source', null, 'MOCKED response lost; submission cannot be repeated');
  }
  next = advance(next, id, 'PENDING', tx(id + run.compiled.hashes.sourcePayload));
  return event(next, 'SOURCE_SUBMITTED', 'source', next.attempts.at(-1)!.transactionHash, 'MOCKED source transaction submitted');
}
export function recheckBridgeSource(run: BridgeExecution): BridgeExecution {
  if (bridgeState(run) !== 'UNKNOWN') throw new Error('BRIDGE_RECHECK_NOT_REQUIRED');
  const source = run.attempts.find(x => x.stepId === 'bridge.step.source');
  if (!source || source.state !== 'SUBMISSION_RESULT_UNKNOWN') throw new Error('BRIDGE_UNKNOWN_STATE_INVALID');
  const next = advance(run, source.executionAttemptId, 'PENDING', tx(source.executionAttemptId + run.compiled.hashes.sourcePayload));
  return event(next, 'SOURCE_SUBMITTED', 'source', next.attempts.find(x => x.stepId === source.stepId)!.transactionHash,
    'MOCKED readback found the exact existing source attempt; no retry');
}
export function confirmBridgeSource(run: BridgeExecution): BridgeExecution {
  if (bridgeState(run) !== 'SOURCE_SUBMITTED') throw new Error('BRIDGE_SOURCE_NOT_SUBMITTED');
  const source = run.attempts.find(x => x.stepId === 'bridge.step.source');
  if (!source || source.state !== 'PENDING') throw new Error('BRIDGE_SOURCE_NOT_PENDING');
  let next = advance(run, source.executionAttemptId, 'CONFIRMED');
  next = setJournal(next, 'step', 'bridge.step.source', 'RECONCILING');
  next = setJournal(next, 'step', 'bridge.step.source', 'COMPLETED');
  return event(next, 'SOURCE_CONFIRMED', 'source', source.transactionHash, 'MOCKED source receipt confirmed');
}
export function progressBridge(run: BridgeExecution): BridgeExecution {
  if (bridgeState(run) !== 'SOURCE_CONFIRMED') throw new Error('BRIDGE_PROGRESS_NOT_READY');
  return event(run, 'BRIDGE_IN_PROGRESS', 'bridge', run.attempts.find(x => x.stepId === 'bridge.step.source')!.transactionHash,
    'MOCKED LI.FI route in progress');
}
export function confirmBridgeDestination(run: BridgeExecution): BridgeExecution {
  if (bridgeState(run) !== 'BRIDGE_IN_PROGRESS') throw new Error('BRIDGE_DESTINATION_NOT_READY');
  const destination = { transactionHash: tx(run.executionId + '/destination'), receivedAmount: run.route.minimumOut,
    recipient: run.route.owner, token: 'USDC', chainId: BRIDGE_DESTINATION } as const;
  return event({ ...run, destination }, 'DESTINATION_CONFIRMED', 'destination', destination.transactionHash,
    'MOCKED destination receipt observed; reconciliation still required');
}
export function failBridge(run: BridgeExecution, note: string): BridgeExecution {
  if (bridgeState(run) === 'RECONCILED' || note.length > 256) throw new Error('BRIDGE_FAILURE_INVALID');
  return event(run, 'FAILED', 'bridge', null, note);
}

export function markBridgeReconciled(run: BridgeExecution): BridgeExecution {
  if (bridgeState(run) !== 'DESTINATION_CONFIRMED' || !run.destination) throw new Error('BRIDGE_RECONCILIATION_NOT_READY');
  let next = setJournal(run, 'segment', 'bridge.segment.base', 'EXECUTING');
  next = setJournal(next, 'segment', 'bridge.segment.base', 'RECONCILING');
  next = setJournal(next, 'segment', 'bridge.segment.base', 'COMPLETED');
  next = setJournal(next, 'workflow', run.executionId, 'RECONCILING');
  next = setJournal(next, 'workflow', run.executionId, 'COMPLETED');
  return event(next, 'RECONCILED', 'destination', run.destination.transactionHash,
    'MOCKED destination receipt and balance delta independently reconciled');
}

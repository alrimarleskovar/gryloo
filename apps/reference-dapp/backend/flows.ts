// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 flow registry for the cloud backend. Each cloud-enabled flow binds the UNCHANGED service
 * (the same code the in-process server actions run) to shared durable storage, and declares:
 *  - the exact server-action methods exposed over HTTP, with strict argument validation (the browser is never
 *    trusted: only IDs, the authoring workflow and wallet results are accepted, and the service re-validates
 *    every transition against durable state);
 *  - a projector deriving run/attempt/journal rows and required durable work from each snapshot;
 *  - when a run needs background observation. Observation is read-only discovery and reconciliation; no
 *    backend path can sign or submit. PREPARED attempts are never observed by workers, because observing a
 *    PREPARED attempt cancels it and the owner's browser may be between `begin` and `handoff`.
 */
import { hashJournalBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { Projection, Projector, WorkRequest } from '@defi-workflow-engine/cloud-runtime';
import { createRobinhoodTransferService, type TransferRecord, type TransferWalletDiagnostic } from '../src/server/robinhood-transfer-service.ts';
import { createSupplyService, type SupplyRecord, type SupplyWalletDiagnostic } from '../src/server/supply-service.ts';
import type { TransferRpc, SupplyRpc } from '@defi-workflow-engine/reference-compiler';

export type FlowName = 'robinhood-transfer' | 'aave-supply';
export type FlowMode = 'live' | 'harness' | 'off';
type Args = readonly unknown[];
export type FlowService = { readonly call: (method: string, args: Args) => Promise<unknown>; readonly load: (runId: string) => Promise<unknown>;
  readonly observe: (runId: string) => Promise<unknown> };
export type FlowDefinition = {
  readonly name: FlowName; readonly busyCode: string; readonly runId: RegExp; readonly unavailableCode: string;
  readonly methods: Readonly<Record<string, { readonly mutates: boolean; readonly validate: (args: Args) => boolean }>>;
  readonly create: (storage: ExecutionStorage, rpc: TransferRpc & SupplyRpc, provenance: 'MOCKED' | 'PUBLIC_TESTNET') => FlowService;
  readonly needsObservation: (record: unknown) => boolean;
  readonly projector: Projector;
  readonly evidence: (record: unknown) => { bundleHash: string; environment: string; outcome: string; bytes: Uint8Array } | null;
};

const ACCOUNT = /^0x[0-9a-fA-F]{40}$/, COMMITMENT = /^0x[0-9a-f]{64}$/, HASH = /^0x[0-9a-fA-F]{64}$/, CODE = /^[A-Z][A-Z0-9_]{1,80}$/;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const workflow = (value: unknown) => isObject(value) && Array.isArray(value.nodes) && typeof value.workflowId === 'string';
const diagnostic = (value: unknown) => isObject(value) && typeof value.invoked === 'boolean' && Array.isArray(value.calls) && typeof value.code === 'string';
const result = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.hash === 'string' && HASH.test(value.hash) && Object.keys(value).length === 2
  : (value.kind === 'UNKNOWN' || value.kind === 'REJECTED') && (value.code === undefined || typeof value.code === 'string' && CODE.test(value.code)) &&
    Object.keys(value).every(k => k === 'kind' || k === 'code'));
const shape = (...checks: ((value: unknown) => boolean)[]) => (args: Args) => args.length === checks.length && checks.every((check, i) => check(args[i]));
const optionalShape = (required: number, ...checks: ((value: unknown) => boolean)[]) => (args: Args) =>
  args.length >= required && args.length <= checks.length && args.every((value, i) => checks[i]!(value));
const id = (pattern: RegExp) => (value: unknown) => typeof value === 'string' && pattern.test(value);
const account = (value: unknown) => typeof value === 'string' && ACCOUNT.test(value);
const commitment = (value: unknown) => typeof value === 'string' && COMMITMENT.test(value);
const STEPS = ['APPROVAL', 'SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW'];
const step = (value: unknown) => typeof value === 'string' && STEPS.includes(value);
const OBSERVABLE = ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];

function lastRecord<T>(bytes: Uint8Array): T {
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimEnd().split('\n');
  return JSON.parse(lines.at(-1)!) as T;
}
function journalRows(journal: TransferRecord['journal']) {
  const hashes = hashJournalBytes(new TextEncoder().encode(JSON.stringify(journal)));
  return journal.entries.map((entry, index) => ({ sequence: entry.sequence, entryHash: hashes[index]!, level: entry.level, entityId: entry.entityId,
    attemptId: entry.executionAttemptId, fromState: entry.fromState, toState: entry.toState, recordedAt: entry.recordedAt }));
}
const errorCode = (value: string | null | undefined) => value && CODE.test(value) ? value : value ? 'UNCLASSIFIED_ERROR' : null;
function work(flow: FlowName, runId: string, observe: boolean, firstDelayMs: number, hasEvidence: boolean): WorkRequest[] {
  const payload = { namespace: flow, runId }, dedupeKey = `${flow}:${runId}`;
  return [...observe ? [{ kind: 'reconcile', dedupeKey, runId, payload, delayMs: firstDelayMs }] : [],
    ...hasEvidence ? [{ kind: 'evidence.archive', dedupeKey, runId, payload }] : []];
}
function evidenceOf(record: { evidence: unknown; verdict: string }) {
  const evidence = record.evidence as { bundle?: { environment?: unknown; outcome?: unknown }; bundleHash?: unknown } | null;
  if (!evidence || record.verdict !== 'RECONCILED' || typeof evidence.bundleHash !== 'string' || !evidence.bundle) return null;
  return { bundleHash: evidence.bundleHash, environment: String(evidence.bundle.environment), outcome: String(evidence.bundle.outcome),
    bytes: new TextEncoder().encode(JSON.stringify(evidence)) };
}

const transferNeedsObservation = (value: unknown) => {
  const record = value as TransferRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && !!record.attempt && OBSERVABLE.includes(record.attempt.state);
};
const robinhood: FlowDefinition = {
  name: 'robinhood-transfer', busyCode: 'TRANSFER_BUSY', runId: /^rhx-[a-f0-9]{32}$/, unavailableCode: 'TRANSFER_SERVICE_UNAVAILABLE',
  methods: {
    simulate: { mutates: true, validate: shape(workflow, account) },
    review: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/), commitment, workflow) },
    invalidate: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/)) },
    begin: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/), account, workflow) },
    handoff: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/)) },
    report: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/), result) },
    walletFailure: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/), diagnostic) },
    observe: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/)) },
    status: { mutates: false, validate: shape(id(/^rhx-[a-f0-9]{32}$/)) },
    recoverReview: { mutates: true, validate: shape(id(/^rhx-[a-f0-9]{32}$/)) },
  },
  create(storage, rpc, provenance) {
    const s = createRobinhoodTransferService({ storage, rpc, provenance });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      simulate: ([w, a]) => s.simulate(w, a as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i]) => s.invalidate(i as string),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      handoff: ([i]) => s.handoff(i as string),
      report: ([i, r]) => s.report(i as string, r as Parameters<typeof s.report>[1]),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as TransferWalletDiagnostic),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
      recoverReview: ([i]) => s.recoverReview(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: transferNeedsObservation,
  projector(name, bytes): Projection | null {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<TransferRecord>(bytes), attempt = record.attempt, observe = transferNeedsObservation(record);
    const evidence = evidenceOf(record);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow: 'robinhood-transfer',
      status: record.verdict !== 'PENDING' ? record.verdict : attempt ? attempt.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.review.account.toLowerCase(), recoveryOf: record.recoveryOf ?? null, errorCode: errorCode(record.error),
      needsObservation: observe, hasEvidence: evidence !== null,
      attempts: attempt ? [{ attemptId: `${record.id}.TRANSFER`, step: 'TRANSFER', state: attempt.state, nonce: attempt.nonce,
        transactionHash: attempt.transactionHash, preparedAtBlock: attempt.preparedAtBlock, reconciled: attempt.reconciled }] : [],
      journal: journalRows(record.journal) },
    // SUBMITTING usually means the owner's wallet prompt is open: give the browser time to report first.
    work: work('robinhood-transfer', record.id, observe, attempt?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
  },
  evidence: record => evidenceOf(record as TransferRecord),
};

const supplyNeedsObservation = (value: unknown) => {
  const record = value as SupplyRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && record.attempts.some(a => !a.reconciled && OBSERVABLE.includes(a.state));
};
const SUPPLY_ID = /^supply-[a-f0-9]{32}$/;
const supply: FlowDefinition = {
  name: 'aave-supply', busyCode: 'SUPPLY_BUSY', runId: SUPPLY_ID, unavailableCode: 'SUPPLY_SERVICE_UNAVAILABLE',
  methods: {
    simulate: { mutates: true, validate: shape(workflow, account) },
    review: { mutates: true, validate: shape(id(SUPPLY_ID), commitment, workflow) },
    begin: { mutates: true, validate: shape(id(SUPPLY_ID), account, workflow) },
    report: { mutates: true, validate: shape(id(SUPPLY_ID), step, result) },
    observe: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    status: { mutates: false, validate: shape(id(SUPPLY_ID)) },
    invalidate: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    recoverReview: { mutates: true, validate: shape(id(SUPPLY_ID)) },
    walletFailure: { mutates: true, validate: shape(id(SUPPLY_ID), diagnostic) },
    walletTrace: { mutates: true, validate: shape(id(SUPPLY_ID), diagnostic) },
    handoff: { mutates: true, validate: optionalShape(2, id(SUPPLY_ID), step, v => typeof v === 'boolean') },
  },
  create(storage, rpc, provenance) {
    const s = createSupplyService({ storage, rpc, provenance });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      simulate: ([w, a]) => s.simulate(w, a as string),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      begin: ([i, a, w]) => s.begin(i as string, a as string, w as SemanticWorkflow),
      report: ([i, st, r]) => s.report(i as string, st as Parameters<typeof s.report>[1], r as Parameters<typeof s.report>[2]),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
      invalidate: ([i]) => s.invalidate(i as string),
      recoverReview: ([i]) => s.recoverReview(i as string),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as SupplyWalletDiagnostic),
      walletTrace: ([i, d]) => s.walletTrace(i as string, d as SupplyWalletDiagnostic),
      handoff: ([i, st, managed]) => s.handoff(i as string, st as Parameters<typeof s.handoff>[1], managed === true),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: supplyNeedsObservation,
  projector(name, bytes): Projection | null {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<SupplyRecord>(bytes), observe = supplyNeedsObservation(record), evidence = evidenceOf(record);
    const open = record.attempts.find(a => !a.reconciled);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow: 'aave-supply',
      status: record.verdict !== 'PENDING' ? record.verdict : open ? open.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.review.account.toLowerCase(), recoveryOf: record.recoveryOf ?? null, errorCode: errorCode(record.error),
      needsObservation: observe, hasEvidence: evidence !== null,
      attempts: record.attempts.map(a => ({ attemptId: `${record.id}.${a.step}`, step: a.step, state: a.state, nonce: a.nonce,
        transactionHash: a.transactionHash, preparedAtBlock: a.preparedAtBlock, reconciled: a.reconciled })),
      journal: journalRows(record.journal) },
    work: work('aave-supply', record.id, observe, open?.state === 'SUBMITTING' ? 60_000 : 5_000, evidence !== null) };
  },
  evidence: record => evidenceOf(record as SupplyRecord),
};

export const FLOWS: Readonly<Record<FlowName, FlowDefinition>> = Object.freeze({ 'robinhood-transfer': robinhood, 'aave-supply': supply });
export const isFlowName = (value: string): value is FlowName => Object.hasOwn(FLOWS, value);

/**
 * Backend enablement is explicit per flow and independent of NODE_ENV (a deployed backend is never in
 * development mode). The MOCKED loopback harness takes precedence so automated tests can never reach a
 * public network.
 */
export function flowMode(flow: FlowName, env: Readonly<Record<string, string | undefined>>): FlowMode {
  if (flow === 'robinhood-transfer') {
    if (env.GRYLOO_ROBINHOOD_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
    return env.GRYLOO_ROBINHOOD_TESTNET === 'live' ? 'live' : 'off';
  }
  if (env.GRYLOO_SUPPLY_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_SUPPLY_TESTNET === 'live' ? 'live' : 'off';
}
export const disabledCode = (flow: FlowName) => flow === 'robinhood-transfer' ? 'TRANSFER_PUBLIC_TESTNET_NOT_ENABLED' : 'SUPPLY_PUBLIC_TESTNET_NOT_ENABLED';

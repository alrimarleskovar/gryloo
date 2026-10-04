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
import { createDurablePublicTestnetService, type PublicRun } from '../src/server/public-testnet-service.ts';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY } from '@defi-workflow-engine/action-registry';
import type { JupiterHttp } from '@defi-workflow-engine/reference-compiler';
import { createRobinhoodReadRpc } from '../src/server/robinhood-rpc.ts';
import { createSupplyReadRpc } from '../src/server/supply-rpc.ts';
import { publicTestnetRpc } from '../src/server/public-testnet-rpc.ts';
import { createSolanaRpc, solanaRpcOverride } from '../src/server/solana-rpc.ts';
import { createJupiterHttp } from '../src/server/jupiter-http.ts';
import { createJupiterService, createSolanaDevnetService, type JupiterRecord, type JupiterWalletDiagnostic } from '../src/server/jupiter-service.ts';
import { createOrcaLiquidityService, type OrcaLiquidityRecord, type OrcaLiquidityWalletDiagnostic } from '../src/server/orca-liquidity-service.ts';

export type FlowName = 'robinhood-transfer' | 'aave-supply' | 'base-sepolia-swap' | 'solana-devnet-swap' | 'orca-liquidity' | 'jupiter-swap';
export type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
/** Network transport for one flow. Built from configuration in production; replaced by MOCKED chains in tests. */
export type FlowDeps = { readonly rpc: Rpc; readonly mode: 'live' | 'harness'; readonly env: Readonly<Record<string, string | undefined>>; readonly http?: JupiterHttp };
export type FlowMode = 'live' | 'harness' | 'off';
type Args = readonly unknown[];
export type FlowService = { readonly call: (method: string, args: Args) => Promise<unknown>; readonly load: (runId: string) => Promise<unknown>;
  readonly observe: (runId: string) => Promise<unknown> };
export type FlowDefinition = {
  readonly name: FlowName; readonly busyCode: string; readonly runId: RegExp; readonly unavailableCode: string;
  readonly methods: Readonly<Record<string, { readonly mutates: boolean; readonly validate: (args: Args) => boolean }>>;
  readonly create: (storage: ExecutionStorage, deps: FlowDeps) => FlowService;
  readonly transport: (mode: 'live' | 'harness', env: Readonly<Record<string, string | undefined>>) => Omit<FlowDeps, 'mode' | 'env'>;
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
  transport: mode => ({ rpc: createRobinhoodReadRpc(mode) }),
  create(storage, { rpc, mode }) {
    const s = createRobinhoodTransferService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET' });
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
  transport: mode => ({ rpc: createSupplyReadRpc(mode === 'harness') }),
  create(storage, { rpc, mode }) {
    const s = createSupplyService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET' });
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

/**
 * The existing exact-profile Base Sepolia Uniswap v3 swap (USDC <-> WETH). Read-only public preflight (pinned
 * contracts, pool, quote, freshness, gas), explicit Review, then the owner's wallet sends the exact approval or
 * swap. Workers only read receipts for attempts that already carry the owner's transaction hash.
 */
const SWAP_ID = /^pub-[0-9a-f]{24}$/;
const swapNeedsObservation = (value: unknown) => {
  const run = value as PublicRun, last = run.attempts.at(-1);
  return !run.outcome && !!last?.txHash && (last.state === 'HASH' || last.state === 'PENDING');
};
const swapEvidence = (value: unknown) => {
  const outcome = (value as PublicRun).outcome;
  if (!outcome) return null;
  return { bundleHash: outcome.evidenceBundleHash, environment: outcome.evidence.environment, outcome: outcome.evidence.outcome,
    bytes: new TextEncoder().encode(JSON.stringify(outcome)) };
};
const swapResult = (value: unknown) => isObject(value) && (value.kind === 'HASH' ? typeof value.txHash === 'string' && HASH.test(value.txHash) &&
  Object.keys(value).length === 2 : (value.kind === 'REJECTED' || value.kind === 'UNKNOWN') && Object.keys(value).length === 1);
const swap: FlowDefinition = {
  name: 'base-sepolia-swap', busyCode: 'EXECUTION_BUSY', runId: SWAP_ID, unavailableCode: 'PUBLIC_INTERNAL_ERROR',
  methods: {
    prepare: { mutates: true, validate: shape(workflow) },
    refresh: { mutates: true, validate: shape(id(SWAP_ID)) },
    review: { mutates: true, validate: shape(id(SWAP_ID), commitment) },
    begin: { mutates: true, validate: shape(id(SWAP_ID), account) },
    report: { mutates: true, validate: shape(id(SWAP_ID), v => typeof v === 'string' && /^pub-[0-9a-f]{24}\.(approval|swap)\.[1-8]$/.test(v), swapResult) },
    observe: { mutates: true, validate: shape(id(SWAP_ID)) },
    status: { mutates: false, validate: shape(id(SWAP_ID)) },
  },
  transport: () => ({ rpc: publicTestnetRpc }),
  create(storage, { rpc }) {
    const s = createDurablePublicTestnetService({ storage, rpc });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      prepare: ([w]) => s.prepare(w as SemanticWorkflow),
      refresh: ([i]) => s.refresh(i as string),
      review: ([i, h]) => s.review(i as string, h as string),
      begin: ([i, a]) => s.begin(i as string, a as string),
      report: ([i, attempt, r]) => s.report(i as string, attempt as string, r as Parameters<typeof s.report>[2]),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: swapNeedsObservation,
  projector(name, bytes): Projection | null {
    if (!name.endsWith('.jsonl')) return null;
    const run = lastRecord<PublicRun>(bytes), observe = swapNeedsObservation(run), evidence = swapEvidence(run), last = run.attempts.at(-1);
    return { run: { runId: run.quote.executionId, workflowId: run.workflow.workflowId, flow: 'base-sepolia-swap',
      status: run.outcome ? 'RECONCILED' : last ? last.state : run.reviewedManifestHash ? 'AUTHORIZED' : 'SIMULATED',
      provenance: 'PUBLIC_TESTNET', ownerAccount: last?.account ?? null, recoveryOf: null, errorCode: null, needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: run.attempts.map(a => ({ attemptId: a.attemptId, step: a.step.toUpperCase(), state: a.state, nonce: null, transactionHash: a.txHash,
        preparedAtBlock: a.preBlock, reconciled: a.state === 'CONFIRMED' && (a.step === 'approval' || run.outcome !== null) })),
      journal: [] },
    work: work('base-sepolia-swap', run.quote.executionId, observe, 5_000, evidence !== null) };
  },
  evidence: run => swapEvidence(run),
};

/**
 * Solana flows (BUILD-014 Jupiter mainnet-beta swap, BUILD-DEMO-001 Orca Devnet swap, BUILD-015 Orca Devnet liquidity).
 * The owner's wallet signs in the browser; the API verifies the exact reviewed bytes and owner signature, persists the
 * signature and relays the owner-signed bytes once — only on the browser's explicit `submit`. Workers only observe by
 * signature (their transport cannot send at all) and never touch PREPARED attempts.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const solanaOwner = (value: unknown) => typeof value === 'string' && SOLANA_ADDRESS.test(value);
const signedTransaction = (value: unknown) => typeof value === 'string' && value.length <= 8_192 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const solanaDiagnostic = (value: unknown) => isObject(value) && ['CONNECT', 'SIGN', 'PREFLIGHT'].includes(String(value.stage)) && typeof value.code === 'string' &&
  JSON.stringify(value).length <= 16_384;
const liquidityRequest = (value: unknown) => isObject(value) && ['OPEN', 'DECREASE_PARTIAL', 'EXIT'].includes(String(value.operation)) &&
  solanaOwner(value.positionMint) && (value.partBps === undefined || Number.isSafeInteger(value.partBps)) &&
  Object.keys(value).every(k => ['operation', 'positionMint', 'partBps'].includes(k));
type SolanaRecord = { id: string; review: { owner: string; workflow: SemanticWorkflow }; provenance: 'PUBLIC_MAINNET' | 'PUBLIC_DEVNET' | 'MOCKED';
  authorization: string | null; verdict: string; notSubmitted?: boolean; error: string | null; journal: TransferRecord['journal']; evidence: unknown;
  attempt: { state: string; signature: string | null; preparedAtBlockHeight: number; reconciled: boolean } | null };
const solanaNeedsObservation = (value: unknown) => {
  const record = value as SolanaRecord;
  return record.verdict === 'PENDING' && !record.notSubmitted && !!record.attempt && OBSERVABLE.includes(record.attempt.state);
};
function solanaProjector(flow: FlowName, step: (record: SolanaRecord) => string) {
  return (name: string, bytes: Uint8Array): Projection | null => {
    if (!name.endsWith('.jsonl')) return null;
    const record = lastRecord<SolanaRecord>(bytes), attempt = record.attempt, observe = solanaNeedsObservation(record), evidence = evidenceOf(record);
    return { run: { runId: record.id, workflowId: record.review.workflow.workflowId, flow,
      status: record.verdict !== 'PENDING' ? record.verdict : attempt ? attempt.state : record.authorization ? 'AUTHORIZED' : 'SIMULATED',
      provenance: record.provenance, ownerAccount: record.review.owner, recoveryOf: null, errorCode: errorCode(record.error), needsObservation: observe,
      hasEvidence: evidence !== null,
      attempts: attempt ? [{ attemptId: `${record.id}.${step(record).toLowerCase()}`, step: step(record), state: attempt.state, nonce: null,
        transactionHash: attempt.signature, preparedAtBlock: attempt.preparedAtBlockHeight, reconciled: attempt.reconciled }] : [],
      journal: journalRows(record.journal) },
    work: work(flow, record.id, observe, 5_000, evidence !== null) };
  };
}
const solanaSwapMethods = (idPattern: RegExp) => ({
  info: { mutates: false, validate: shape() },
  simulate: { mutates: true, validate: shape(workflow, solanaOwner) },
  review: { mutates: true, validate: shape(id(idPattern), commitment, workflow) },
  invalidate: { mutates: true, validate: shape(id(idPattern)) },
  begin: { mutates: true, validate: shape(id(idPattern), solanaOwner, workflow) },
  walletFailure: { mutates: true, validate: shape(id(idPattern), solanaDiagnostic) },
  submit: { mutates: true, validate: shape(id(idPattern), signedTransaction) },
  observe: { mutates: true, validate: shape(id(idPattern)) },
  status: { mutates: false, validate: shape(id(idPattern)) },
});
function solanaSwapTable(s: ReturnType<typeof createSolanaDevnetService>): Record<string, (args: Args) => Promise<unknown>> {
  return {
    info: async () => ({ executionEnabled: s.executionEnabled }),
    simulate: ([w, o]) => s.simulate(w, o as string),
    review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
    invalidate: ([i]) => s.invalidate(i as string),
    begin: ([i, o, w]) => s.begin(i as string, o as string, w as SemanticWorkflow),
    walletFailure: ([i, d]) => s.walletFailure(i as string, d as JupiterWalletDiagnostic),
    submit: ([i, t]) => s.submit(i as string, t as string),
    observe: ([i]) => s.observe(i as string),
    status: ([i]) => s.load(i as string),
  };
}
const DEVNET_SWAP_ID = /^orca-[a-f0-9]{32}$/;
const solanaDevnetSwap: FlowDefinition = {
  name: 'solana-devnet-swap', busyCode: 'DEVNET_SWAP_BUSY', runId: DEVNET_SWAP_ID, unavailableCode: 'DEVNET_SWAP_SERVICE_UNAVAILABLE',
  methods: solanaSwapMethods(DEVNET_SWAP_ID),
  transport: (mode, env) => ({ rpc: createSolanaRpc(mode === 'harness' ? 'http://127.0.0.1:8552/rpc'
    : solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'DEVNET_SWAP_RPC_CONFIGURATION_INVALID') ?? ORCA_WHIRLPOOLS_DEVNET.rpc, mode === 'harness') }),
  create(storage, { rpc, mode, env }) {
    const s = createSolanaDevnetService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_DEVNET',
      executionEnabled: env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED' });
    const table = solanaSwapTable(s);
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation, projector: solanaProjector('solana-devnet-swap', () => 'SWAP'), evidence: record => evidenceOf(record as JupiterRecord),
};
const JUPITER_ID = /^jupiter-[a-f0-9]{32}$/;
const jupiterSwap: FlowDefinition = {
  name: 'jupiter-swap', busyCode: 'JUPITER_BUSY', runId: JUPITER_ID, unavailableCode: 'JUPITER_SERVICE_UNAVAILABLE',
  methods: solanaSwapMethods(JUPITER_ID),
  transport: (mode, env) => ({
    rpc: createSolanaRpc(mode === 'harness' ? 'http://127.0.0.1:8551/rpc'
      : solanaRpcOverride(env.GRYLOO_SOLANA_RPC_URL, 'JUPITER_RPC_CONFIGURATION_INVALID') ?? JUPITER_SOLANA_MAINNET.rpc, mode === 'harness'),
    http: createJupiterHttp(mode === 'harness' ? 'http://127.0.0.1:8551/swap/v2/build' : JUPITER_SOLANA_MAINNET.api + JUPITER_SOLANA_MAINNET.endpoint,
      mode === 'harness' ? undefined : env.JUPITER_API_KEY) }),
  create(storage, { rpc, http, mode, env }) {
    if (!http) throw new Error('JUPITER_CONFIGURATION_INVALID');
    // Real-funds execution stays a separate explicit owner opt-in; Simulate and Review remain read-only without it.
    const s = createJupiterService({ storage, rpc, http, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_MAINNET',
      executionEnabled: mode === 'harness' || env.GRYLOO_JUPITER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED' });
    const table = solanaSwapTable(s);
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation, projector: solanaProjector('jupiter-swap', () => 'SWAP'), evidence: record => evidenceOf(record as JupiterRecord),
};
const ORCA_LP_ID = /^orcalp-[a-f0-9]{32}$/;
const orcaLiquidity: FlowDefinition = {
  name: 'orca-liquidity', busyCode: 'ORCA_LIQUIDITY_BUSY', runId: ORCA_LP_ID, unavailableCode: 'ORCA_LIQUIDITY_SERVICE_UNAVAILABLE',
  methods: { ...solanaSwapMethods(ORCA_LP_ID),
    simulate: { mutates: true, validate: shape(workflow, solanaOwner, liquidityRequest) },
    price: { mutates: false, validate: shape() },
    positions: { mutates: false, validate: shape(solanaOwner) },
    inspect: { mutates: false, validate: shape(solanaOwner, solanaOwner) } },
  transport: (mode, env) => ({ rpc: createSolanaRpc(mode === 'harness' ? 'http://127.0.0.1:8552/rpc'
    : solanaRpcOverride(env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'ORCA_LIQUIDITY_RPC_CONFIGURATION_INVALID') ?? ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.rpc, mode === 'harness') }),
  create(storage, { rpc, mode, env }) {
    const s = createOrcaLiquidityService({ storage, rpc, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_DEVNET',
      executionEnabled: env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED' });
    const table: Record<string, (args: Args) => Promise<unknown>> = {
      info: async () => ({ executionEnabled: s.executionEnabled }),
      price: () => s.price(),
      positions: ([o]) => s.positions(o as string),
      inspect: ([o, m]) => s.inspect(o as string, m as string),
      simulate: ([w, o, r]) => s.simulate(w as SemanticWorkflow, o as string, r as Parameters<typeof s.simulate>[2]),
      review: ([i, c, w]) => s.review(i as string, c as string, w as SemanticWorkflow),
      invalidate: ([i]) => s.invalidate(i as string),
      begin: ([i, o, w]) => s.begin(i as string, o as string, w as SemanticWorkflow),
      walletFailure: ([i, d]) => s.walletFailure(i as string, d as OrcaLiquidityWalletDiagnostic),
      submit: ([i, t]) => s.submit(i as string, t as string),
      observe: ([i]) => s.observe(i as string),
      status: ([i]) => s.load(i as string),
    };
    return { call: (method, args) => table[method]!(args), load: runId => s.load(runId), observe: runId => s.observe(runId) };
  },
  needsObservation: solanaNeedsObservation,
  projector: solanaProjector('orca-liquidity', record => (record as unknown as OrcaLiquidityRecord).operation),
  evidence: record => evidenceOf(record as OrcaLiquidityRecord),
};

export const FLOWS: Readonly<Record<FlowName, FlowDefinition>> = Object.freeze({ 'robinhood-transfer': robinhood, 'aave-supply': supply, 'base-sepolia-swap': swap,
  'solana-devnet-swap': solanaDevnetSwap, 'orca-liquidity': orcaLiquidity, 'jupiter-swap': jupiterSwap });
export const isFlowName = (value: string): value is FlowName => Object.hasOwn(FLOWS, value);

/**
 * Backend enablement is explicit per flow and independent of NODE_ENV (a deployed backend is never in
 * development mode). The MOCKED loopback harness takes precedence so automated tests can never reach a
 * public network.
 */
export function flowMode(flow: FlowName, env: Readonly<Record<string, string | undefined>>): FlowMode {
  // The existing public-swap gate value; in the separately deployed backend it does not also require NODE_ENV=development.
  if (flow === 'base-sepolia-swap') return env.GRYLOO_PUBLIC_TESTNET === 'record' ? 'live' : 'off';
  // Solana Devnet (valueless test tokens): explicit backend enablement; the MOCKED loopback harness wins.
  if (flow === 'solana-devnet-swap' || flow === 'orca-liquidity')
    return env.GRYLOO_SOLANA_DEVNET_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_SOLANA_DEVNET === 'live' ? 'live' : 'off';
  // Jupiter mainnet-beta: `live` enables read-only Simulate/Review; real-funds execution additionally needs GRYLOO_JUPITER_OWNER_EXECUTION.
  if (flow === 'jupiter-swap') return env.GRYLOO_JUPITER_HARNESS === 'MOCKED_LOOPBACK_ONLY' ? 'harness' : env.GRYLOO_JUPITER === 'live' ? 'live' : 'off';
  if (flow === 'robinhood-transfer') {
    if (env.GRYLOO_ROBINHOOD_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
    return env.GRYLOO_ROBINHOOD_TESTNET === 'live' ? 'live' : 'off';
  }
  if (env.GRYLOO_SUPPLY_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_SUPPLY_TESTNET === 'live' ? 'live' : 'off';
}
const DISABLED: Readonly<Record<FlowName, string>> = { 'robinhood-transfer': 'TRANSFER_PUBLIC_TESTNET_NOT_ENABLED', 'aave-supply': 'SUPPLY_PUBLIC_TESTNET_NOT_ENABLED',
  'base-sepolia-swap': 'PUBLIC_RECORDING_OFF', 'solana-devnet-swap': 'DEVNET_SWAP_PUBLIC_DEVNET_NOT_ENABLED', 'orca-liquidity': 'ORCA_LIQUIDITY_PUBLIC_DEVNET_NOT_ENABLED',
  'jupiter-swap': 'JUPITER_PUBLIC_MAINNET_NOT_ENABLED' };
export const disabledCode = (flow: FlowName) => DISABLED[flow];

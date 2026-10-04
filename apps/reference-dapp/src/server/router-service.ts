// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001: the canonical Cross-chain Router service, Base USDC → Arbitrum USDC.
 *
 * One implementation on the `ExecutionStorage` port (files locally, PostgreSQL in the cloud). It never signs or sends:
 * it asks the allowed routing providers for routes (LI.FI first by default, Across direct), normalizes them into the
 * canonical route model, simulates the exact Base transactions with `eth_simulateV1`, compiles the route-bound artifact
 * chain, binds a Review commitment, persists each attempt before the owner's wallet is called, and observes and
 * reconciles both chains from chain reads alone. Provider status APIs are hints, never settlement proof.
 *
 * Run = append-only snapshot log `xroute-<32 hex>.jsonl`. Phases follow `ROUTER_PHASE_TRANSITIONS`; every transition is
 * validated when the log is extended, and terminal phases never change.
 */
import { createHash, randomBytes } from 'node:crypto';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile, resolveWorkflowCapability } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow, validateRouterBridgeWorkflow } from '@defi-workflow-engine/reference-linter';
import { compileRouterArtifacts, decodeErc20Approval, decodeErc20Transfer, decodeFilledRelay, decodeFundsDeposited, decodeRouterApprove, encodeRouterApprove,
  EIP1967_IMPLEMENTATION_SLOT, ROUTER_SELECTORS as SEL, ROUTER_TOPICS as TOPIC, type FilledRelay, type FundsDeposited, type RouterArtifacts,
  type RouterLog } from '@defi-workflow-engine/reference-compiler';
import { assertRouterTransition, compareRoutes, hashArtifactBytes, routeCommitment, ROUTER_PHASES, type CanonicalRoute, type EvidenceBundle, type RouteChange,
  type RouterPhase, type RoutingProvider, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { utf8, type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { verifyOwnerSubmission, type Rpc } from './public-testnet-service.ts';
import type { RouteProvider, RouteRequest, TransferHint } from './router-providers.ts';

const SRC = profile.source, DST = profile.destination;
export const ROUTER_RUN_ID = /^xroute-[a-f0-9]{32}$/;
export type RouterStep = 'APPROVAL' | 'DEPOSIT';
export type RouterAttemptState = 'PREPARED' | 'CANCELLED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'NOT_FOUND' | 'PENDING' | 'CONFIRMED' | 'REVERTED' |
  'RECONCILIATION_REQUIRED';
export type RouterTx = { readonly chainId: '0x2105'; readonly from: string; readonly to: string; readonly data: string; readonly value: '0x0'; readonly gas: string;
  readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string };
export type RouterCall = { readonly purpose: 'APPROVAL' | 'BRIDGE_DEPOSIT'; readonly to: string; readonly data: string; readonly gasUsed: string; readonly gasLimit: string };
export type ProviderConsideration = { readonly provider: RoutingProvider; readonly outcome: 'SELECTED' | 'AVAILABLE' | 'REFUSED' | 'UNAVAILABLE';
  readonly code: string | null; readonly minimumOutput: string | null; readonly feeTotal: string | null; readonly routeCommitment: string | null };
export type RouterReview = {
  readonly format: 'flofi.router-review.v1'; readonly commitment: string;
  readonly owner: string; readonly recipient: string; readonly recipientKind: 'CONNECTED_OWNER' | 'EXPLICIT';
  readonly workflowHash: string; readonly revision: number; readonly nodeId: string; readonly observedAt: string; readonly expiresAt: string;
  readonly intent: { readonly sourceChain: string; readonly destinationChain: string; readonly inputToken: string; readonly outputToken: string; readonly amount: string;
    readonly slippageBps: number; readonly providers: readonly RoutingProvider[] };
  readonly selection: { readonly policy: 'PREFERENCE_ORDER'; readonly selected: RoutingProvider; readonly considered: readonly ProviderConsideration[] };
  readonly route: CanonicalRoute; readonly routeCommitment: string;
  /** What the routing provider claims. Not a simulation. */
  readonly quote: { readonly provenance: 'PROVIDER_QUOTE'; readonly provider: RoutingProvider; readonly quoteId: string; readonly rawHash: string;
    readonly expectedOutput: string; readonly minimumOutput: string; readonly feeTotal: string; readonly estimatedDurationSeconds: number;
    readonly providerGasEstimate: string | null; readonly quotedAt: string; readonly expiresAt: string };
  /** What a real `eth_simulateV1` of the exact Base transactions returned. The destination fill is not simulated. */
  readonly simulation: { readonly provenance: 'TRANSACTION_SIMULATION'; readonly method: 'eth_simulateV1'; readonly chainId: number; readonly block: number;
    readonly calls: readonly { readonly purpose: RouterCall['purpose']; readonly gasUsed: string }[];
    readonly deposit: { readonly spokePool: string; readonly depositId: string; readonly depositor: string; readonly recipient: string; readonly inputToken: string;
      readonly outputToken: string; readonly inputAmount: string; readonly outputAmount: string; readonly destinationChainId: number; readonly quoteTimestamp: number;
      readonly fillDeadline: number; readonly exclusiveRelayer: string };
    readonly ownerDebit: string; readonly notSimulated: readonly ['DESTINATION_FILL', 'RELAYER_BEHAVIOUR', 'ORIGIN_REFUND'] };
  /** What was read from both chains at Review. */
  readonly observation: { readonly provenance: 'CHAIN_OBSERVATION';
    readonly source: { readonly chainId: number; readonly block: { readonly number: number; readonly hash: string; readonly timestamp: number };
      readonly usdcBalance: string; readonly nativeBalance: string; readonly allowance: string; readonly nonce: string;
      readonly codeSha256: Readonly<Record<string, string>>; readonly implementations: Readonly<Record<string, string>>;
      readonly depositQuoteTimeBuffer: number; readonly fillDeadlineBuffer: number };
    readonly destination: { readonly chainId: number; readonly block: { readonly number: number; readonly hash: string; readonly timestamp: number };
      readonly recipientUsdcBalance: string; readonly recipientHasCode: boolean; readonly codeSha256: Readonly<Record<string, string>>;
      readonly implementations: Readonly<Record<string, string>> } };
  readonly approvals: readonly { readonly token: string; readonly spender: string; readonly amount: string; readonly currentAllowance: string; readonly required: boolean }[];
  readonly calls: readonly RouterCall[];
  readonly fees: { readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly gasLimitTotal: string; readonly executionFeeUpperBoundWei: string;
    readonly l1FeeUpperBoundWei: string | null; readonly totalUpperBoundWei: string | null };
  readonly deadlines: { readonly reviewExpiresAt: string; readonly quoteExpiresAt: string; readonly depositMustLandBy: number; readonly fillDeadline: number };
  readonly artifacts: RouterArtifacts;
  readonly nonce: string;
};
export type RouterReceipt = { readonly transactionHash: string; readonly status: 0 | 1; readonly blockNumber: number; readonly blockHash: string; readonly from: string;
  readonly gasCostWei: string; readonly submissionKind: 'DIRECT' | 'DELEGATED_SINGLE'; readonly contentHash: string };
export type RouterAttempt = { readonly attemptId: string; readonly step: RouterStep; readonly state: RouterAttemptState; readonly reviewCommitment: string;
  readonly nonce: string; readonly preparedAtBlock: number; readonly createdAt: string; readonly tx: RouterTx;
  readonly transactionHash: string | null; readonly replacementHash: string | null; readonly receipt: RouterReceipt | null; readonly reconciled: boolean;
  readonly note: string | null };
export type SourceSettlement = { readonly transactionHash: string; readonly blockNumber: number; readonly blockHash: string; readonly timestamp: number;
  readonly spokePool: string; readonly depositId: string; readonly depositor: string; readonly recipient: string; readonly inputAmount: string; readonly outputAmount: string;
  readonly quoteTimestamp: number; readonly fillDeadline: number; readonly ownerDebit: string; readonly safe: boolean };
export type DestinationFill = { readonly transactionHash: string; readonly blockNumber: number; readonly blockHash: string; readonly timestamp: number;
  readonly spokePool: string; readonly relayer: string; readonly recipient: string; readonly outputToken: string; readonly outputAmount: string;
  readonly transferAmount: string; readonly fillType: number; readonly discoveredBy: 'PROVIDER_HINT' | 'LOG_SCAN'; readonly contentHash: string; readonly safe: boolean };
export type RefundRecord = { readonly transactionHash: string; readonly blockNumber: number; readonly blockHash: string; readonly amount: string; readonly recipient: string };
export type RouterEvidence = { readonly bundle: EvidenceBundle; readonly bundleHash: string; readonly evidenceClass: 'MAINNET_EXECUTED' | 'MOCKED';
  readonly route: { readonly provider: RoutingProvider; readonly underlyingProtocol: string; readonly routeCommitment: string; readonly manifestHash: string };
  readonly source: SourceSettlement; readonly destination: DestinationFill; readonly recipient: string; readonly minimumOutput: string;
  readonly transactions: readonly { readonly chain: string; readonly step: string; readonly transactionHash: string; readonly blockNumber: number; readonly blockHash: string;
    readonly explorer: string }[];
  readonly reconciliation: 'RECONCILED'; readonly observedAt: string };
export type RouterRecord = { readonly format: 'flofi.router-run.v1'; readonly id: string; readonly provenance: 'PUBLIC_MAINNET' | 'MOCKED';
  readonly workflow: SemanticWorkflow; readonly owner: string; readonly review: RouterReview; readonly authorization: string | null; readonly phase: RouterPhase;
  readonly attempts: readonly RouterAttempt[]; readonly source: SourceSettlement | null; readonly destination: DestinationFill | null; readonly refund: RefundRecord | null;
  /** Next Arbitrum block to scan for the fill (durable cursor). */ readonly scanFrom: number;
  readonly lastHint: TransferHint | null; readonly routeChanges: readonly RouteChange[];
  /** A fresh quote, simulation and Review are required before this run can be authorized again (route changed, state changed, expired). */
  readonly requote: boolean; readonly evidence: RouterEvidence | null;
  readonly verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT' | 'FAILED' | 'REFUNDED'; readonly error: string | null };
export type RouterBegin = { readonly record: RouterRecord; readonly attempt: RouterAttempt; readonly transaction: RouterTx };
export type RouterWalletDiagnostic = { invoked: boolean; calls: { method: string; submission?: boolean; result?: string | null; error?: unknown }[]; code: string; rejectionCode?: number };
export type RouterCodePins = Readonly<Record<keyof typeof profile.codeSha256, string>>;

const ADDRESS = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/;
const ACTIVE: readonly RouterAttemptState[] = ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];
export const ROUTER_OBSERVABLE: readonly RouterAttemptState[] = ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];
const TERMINAL: readonly RouterAttemptState[] = ['CANCELLED', 'NOT_FOUND', 'CONFIRMED', 'REVERTED', 'RECONCILIATION_REQUIRED'];
const SETTLING: readonly RouterPhase[] = ['SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED'];
const REFUSALS = [4001, 4100, 4200];
const APPROVAL_ABANDON_MS = 15 * 60_000;
/** Provider failures that say nothing about the route (retry later) rather than "the reviewed route is no longer offered". */
const AVAILABILITY = /_(HTTP_\d+|RATE_LIMITED|UNAVAILABLE|RESPONSE_TOO_LARGE|RESPONSE_INVALID|URL_INVALID)$/;
/** Destination blocks scanned per observation, and the cursor step persisted (smaller, so one call always reaches the head). */
const SCAN_WINDOWS_PER_OBSERVATION = 5, SCAN_PERSIST_BLOCKS = 8_000;
/** A provider hint is stored only when its meaning changes (status or referenced transactions), never for a new response hash. */
const sameHint = (a: TransferHint | null, b: TransferHint | null) => a?.source === b?.source && a?.status === b?.status &&
  a?.destinationTxHash === b?.destinationTxHash && a?.refundTxHash === b?.refundTxHash;

function fail(code: string): never { throw new Error(code); }
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function hex(value: unknown): string { if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) fail('ROUTER_RPC_INVALID'); return value.toLowerCase(); }
function quantity(value: unknown): bigint { const h = hex(value); if (h === '0x') fail('ROUTER_RPC_INVALID'); return BigInt(h); }
function address(value: unknown, code = 'ROUTER_ADDRESS_INVALID'): string { if (typeof value !== 'string' || !ADDRESS.test(value.toLowerCase())) fail(code); return value.toLowerCase(); }
const tag = (n: number | bigint) => '0x' + n.toString(16);
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const addrWord = (a: string) => a.slice(2).padStart(64, '0');
function wordAt(data: string, index: number): bigint {
  if (!/^0x[0-9a-f]*$/.test(data) || data.length < 66 + index * 64) fail('ROUTER_RPC_INVALID');
  return BigInt('0x' + data.slice(2 + index * 64, 66 + index * 64));
}
function sha256Hex(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
}
const digest = (value: unknown) => '0x' + sha256Hex(typeof value === 'string' ? value : canonical(value));
export function routerReviewCommitment(review: RouterReview): string { const rest: Record<string, unknown> = { ...review }; delete rest.commitment; return digest(rest); }
export const routerExplorerTx = (chain: 'source' | 'destination', hash: string) => (chain === 'source' ? SRC.explorer : DST.explorer) + 'tx/' + hash;

/** Append-only run history: identity, reviewed calls, hashes, terminal states, settlements and evidence never change; phases only move forward. */
export function validateRouterLog(bytes: Uint8Array): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\n') || bytes.length > 16_777_216) fail('ROUTER_STORE_CORRUPT');
  let prior: RouterRecord | null = null;
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  for (const line of text.trimEnd().split('\n')) {
    let run: RouterRecord;
    try { run = JSON.parse(line) as RouterRecord; } catch { fail('ROUTER_STORE_CORRUPT'); }
    if (!isObject(run) || run.format !== 'flofi.router-run.v1' || !ROUTER_RUN_ID.test(String(run.id)) || !['PUBLIC_MAINNET', 'MOCKED'].includes(run.provenance) ||
        !ADDRESS.test(String(run.owner)) || !isObject(run.workflow) || !isObject(run.review) || run.review.owner !== run.owner ||
        run.review.commitment !== routerReviewCommitment(run.review) || run.review.routeCommitment !== routeCommitment(run.review.route) ||
        run.review.route.depositor !== run.owner || run.review.route.recipient !== run.review.recipient ||
        (run.authorization !== null && run.authorization !== run.review.commitment) || !(ROUTER_PHASES as readonly string[]).includes(run.phase) ||
        !Array.isArray(run.attempts) || run.attempts.length > 16 || !['PENDING', 'RECONCILED', 'DIVERGENT', 'FAILED', 'REFUNDED'].includes(run.verdict) ||
        new Set(run.attempts.map(a => a.attemptId)).size !== run.attempts.length ||
        run.attempts.some(a => !isObject(a as unknown) || !a.attemptId.startsWith(run.id + '.') || a.tx.from !== run.owner || a.tx.chainId !== SRC.chainHex ||
          (a.transactionHash !== null && !HASH.test(a.transactionHash)) || (a.replacementHash !== null && !HASH.test(a.replacementHash)) ||
          (a.reconciled && (a.state !== 'CONFIRMED' || a.transactionHash === null))) ||
        run.attempts.filter(a => ACTIVE.includes(a.state)).length > 1 || run.attempts.filter(a => a.step === 'DEPOSIT' && a.state === 'CONFIRMED').length > 1 ||
        (run.verdict === 'RECONCILED') !== (run.evidence !== null) || (run.verdict === 'RECONCILED') !== (run.phase === 'RECONCILED') ||
        (run.evidence !== null && (run.destination === null || run.source === null)) || (run.destination !== null && run.source === null) ||
        (run.phase !== 'RECONCILIATION_REQUIRED' && (SETTLING.includes(run.phase) || run.phase === 'RECONCILED' || run.phase === 'REFUNDED') !== (run.source !== null)) ||
        (run.phase === 'REFUNDED') !== (run.refund !== null) || ((run.phase === 'REFUNDED') !== (run.verdict === 'REFUNDED')) ||
        ((run.phase === 'FAILED') !== (run.verdict === 'FAILED')) || (run.phase === 'RECONCILIATION_REQUIRED') !== (run.verdict === 'DIVERGENT') ||
        // Authorization exists exactly while the owner may still be asked to sign: AUTHORIZED, or a deposit request outstanding.
        (['AUTHORIZED', 'SOURCE_SUBMITTED'].includes(run.phase) ? run.authorization !== run.review.commitment : run.authorization !== null) ||
        (run.phase === 'SOURCE_SUBMITTED' && !run.attempts.some(a => a.step === 'DEPOSIT' && ROUTER_OBSERVABLE.includes(a.state))) ||
        typeof run.requote !== 'boolean' || (run.requote && run.phase !== 'PREPARED') || !Number.isSafeInteger(run.scanFrom) || run.scanFrom < 0)
      fail('ROUTER_STORE_CORRUPT');
    if (prior) {
      if (run.id !== prior.id || run.owner !== prior.owner || run.provenance !== prior.provenance || !same(run.workflow, prior.workflow) ||
          run.attempts.length < prior.attempts.length || (prior.evidence && !same(run.evidence, prior.evidence)) || (prior.refund && !same(run.refund, prior.refund)) ||
          (prior.source && !same({ ...run.source, safe: null }, { ...prior.source, safe: null })) || (prior.source?.safe && !run.source?.safe) ||
          (prior.destination && !same({ ...run.destination, safe: null }, { ...prior.destination, safe: null })) || (prior.destination?.safe && !run.destination?.safe) ||
          (prior.verdict !== 'PENDING' && run.verdict !== prior.verdict) || run.scanFrom < prior.scanFrom ||
          // The reviewed route can only be replaced (refresh) while no deposit attempt exists.
          (!same(run.review, prior.review) && prior.attempts.some(a => a.step === 'DEPOSIT' && a.state !== 'CANCELLED')))
        fail('ROUTER_STORE_CORRUPT');
      try { assertRouterTransition(prior.phase, run.phase); } catch { fail('ROUTER_STORE_CORRUPT'); }
      for (const [index, before] of prior.attempts.entries()) {
        const after = run.attempts[index]!;
        if (after.attemptId !== before.attemptId || after.step !== before.step || after.nonce !== before.nonce || !same(after.tx, before.tx) ||
            after.reviewCommitment !== before.reviewCommitment || after.preparedAtBlock !== before.preparedAtBlock ||
            (before.transactionHash !== null && after.transactionHash !== before.transactionHash) ||
            (before.replacementHash !== null && after.replacementHash !== before.replacementHash) ||
            (TERMINAL.includes(before.state) && (after.state !== before.state || !same(after.receipt, before.receipt))))
          fail('ROUTER_STORE_CORRUPT');
      }
    }
    prior = run;
  }
}
export function routerNeedsObservation(value: unknown): boolean {
  const record = value as RouterRecord, last = record.attempts.at(-1);
  return record.verdict === 'PENDING' && (!!last && ROUTER_OBSERVABLE.includes(last.state) || SETTLING.includes(record.phase));
}

type Block = { number: number; hash: string; timestamp: number; baseFee: bigint };
type SourceState = { block: Block; codeSha256: Record<string, string>; implementations: Record<string, string>; usdc: bigint; native: bigint;
  /** Owner allowance to the selected spender (SpokePool for Across, Diamond for LI.FI). */ allowance: bigint;
  nonce: bigint; pendingNonce: bigint; depositQuoteTimeBuffer: number; fillDeadlineBuffer: number };
type DestinationState = { block: Block; codeSha256: Record<string, string>; implementations: Record<string, string>; recipientUsdc: bigint; recipientHasCode: boolean };
type Simulated = { purpose: RouterCall['purpose']; gasUsed: bigint; logs: RouterLog[] };

export function createRouterService(input: { readonly storage: ExecutionStorage; readonly sourceRpc: Rpc; readonly destinationRpc: Rpc;
  readonly providers: Readonly<Record<RoutingProvider, RouteProvider>>; readonly provenance: 'PUBLIC_MAINNET' | 'MOCKED'; readonly executionEnabled?: boolean;
  readonly now?: () => Date; /** MOCKED harness only: the synthetic chains' code pins. A public run always uses the profile's verified pins. */ readonly mockedCodePins?: RouterCodePins }) {
  const { sourceRpc: rpc, destinationRpc: drpc, providers, provenance } = input, { log, leases } = input.storage;
  if (input.mockedCodePins && provenance !== 'MOCKED') fail('ROUTER_CODE_PINS_MOCKED_ONLY');
  const pins: RouterCodePins = input.mockedCodePins ?? profile.codeSha256;
  const now = input.now ?? (() => new Date());
  const executionEnabled = input.executionEnabled === true;
  const runName = (id: string) => { if (!ROUTER_RUN_ID.test(id)) fail('ROUTER_RUN_ID_INVALID'); return id + '.jsonl'; };
  async function load(id: string): Promise<RouterRecord> {
    const bytes = await log.read(runName(id));
    if (!bytes) fail('ROUTER_RUN_NOT_FOUND');
    try { validateRouterLog(bytes); } catch { fail('ROUTER_STORE_CORRUPT'); }
    const record = JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!) as RouterRecord;
    if (record.id !== id) fail('ROUTER_STORE_CORRUPT');
    return record;
  }
  async function save(record: RouterRecord): Promise<RouterRecord> {
    const name = runName(record.id), prior = await log.read(name);
    // Observation repeats often while a bridge is in flight: an unchanged snapshot is not appended again.
    if (prior && canonical(JSON.parse(utf8(prior).trimEnd().split('\n').at(-1)!)) === canonical(record)) return record;
    await log.extend(name, new TextEncoder().encode(utf8(prior) + JSON.stringify(record) + '\n'), validateRouterLog);
    return record;
  }
  const locked = <T,>(id: string, action: () => Promise<T>): Promise<T> => leases.hold(runName(id).slice(0, -6), action);
  const replaceAttempt = (record: RouterRecord, attempt: RouterAttempt): RouterRecord => ({ ...record, attempts: record.attempts.map(a => a.attemptId === attempt.attemptId ? attempt : a) });
  const active = (record: RouterRecord) => record.attempts.find(a => ACTIVE.includes(a.state)) ?? null;
  const sameWorkflow = (a: SemanticWorkflow, b: SemanticWorkflow) => canonical(a) === canonical(b);
  /** Clears the authorization: the run must go back through Quote → Simulation → Review → new Manifest → new Authorization. */
  const deauthorized = (record: RouterRecord, error: string, changes: readonly RouteChange[] = record.routeChanges, requote = record.requote): RouterRecord =>
    ({ ...record, authorization: null, phase: record.phase === 'AUTHORIZED' || record.phase === 'SOURCE_SUBMITTED' ? 'PREPARED' : record.phase, error, routeChanges: changes,
      requote: requote && (record.phase === 'AUTHORIZED' || record.phase === 'SOURCE_SUBMITTED' || record.phase === 'PREPARED') });

  // --- chain reads ------------------------------------------------------------------------------------------------
  async function head(r: Rpc, chainId: number, code: string): Promise<Block> {
    if (quantity(await r('eth_chainId', [])) !== BigInt(chainId)) fail(code);
    const block = await r('eth_getBlockByNumber', ['latest', false]);
    if (!isObject(block)) fail('ROUTER_RPC_INVALID');
    const number = Number(quantity(block.number)), hash = hex(block.hash), timestamp = Number(quantity(block.timestamp));
    if (!Number.isSafeInteger(number) || !HASH.test(hash)) fail('ROUTER_RPC_INVALID');
    return { number, hash, timestamp, baseFee: block.baseFeePerGas === undefined ? 0n : quantity(block.baseFeePerGas) };
  }
  const call = async (r: Rpc, to: string, data: string, at: string) => hex(await r('eth_call', [{ to, data }, at]));
  async function codeHash(r: Rpc, target: string, at: string): Promise<string> {
    const code = hex(await r('eth_getCode', [target, at]));
    if (code.length <= 2) fail('ROUTER_CONTRACT_CODE_MISSING');
    return sha256Hex(Buffer.from(code.slice(2), 'hex'));
  }
  async function implementation(r: Rpc, proxy: string, at: string): Promise<string> {
    const slot = hex(await r('eth_getStorageAt', [proxy, EIP1967_IMPLEMENTATION_SLOT, at]));
    return '0x' + (slot.length > 2 ? BigInt(slot) : 0n).toString(16).padStart(40, '0');
  }
  async function readSource(owner: string, spender: string | null): Promise<SourceState> {
    const block = await head(rpc, SRC.chainId, 'ROUTER_WRONG_SOURCE_CHAIN'), at = tag(block.number);
    const age = now().getTime() - block.timestamp * 1000;
    if (age > 120_000 || age < -30_000) fail('ROUTER_STALE_SOURCE_HEAD');
    const codeSha256: Record<string, string> = { baseSpokePool: await codeHash(rpc, SRC.spokePool, at), baseLifiDiamond: await codeHash(rpc, SRC.lifiDiamond, at),
      baseLifiFeeForwarder: await codeHash(rpc, SRC.lifiFeeForwarder, at), baseUsdc: await codeHash(rpc, SRC.usdc, at) };
    for (const key of Object.keys(codeSha256)) if (codeSha256[key] !== pins[key as keyof RouterCodePins]) fail('ROUTER_UNEXPECTED_CONTRACT');
    const implementations = { baseSpokePool: await implementation(rpc, SRC.spokePool, at) };
    if (wordAt(await call(rpc, SRC.spokePool, SEL.chainId, at), 0) !== BigInt(SRC.chainId)) fail('ROUTER_DEPLOYMENT_MISMATCH');
    if (wordAt(await call(rpc, SRC.spokePool, SEL.pausedDeposits, at), 0) !== 0n) fail('ROUTER_DEPOSITS_PAUSED');
    if (wordAt(await call(rpc, SRC.usdc, SEL.decimals, at), 0) !== 6n) fail('ROUTER_TOKEN_MISMATCH');
    const depositQuoteTimeBuffer = Number(wordAt(await call(rpc, SRC.spokePool, SEL.depositQuoteTimeBuffer, at), 0));
    const fillDeadlineBuffer = Number(wordAt(await call(rpc, SRC.spokePool, SEL.fillDeadlineBuffer, at), 0));
    if (!Number.isSafeInteger(depositQuoteTimeBuffer) || depositQuoteTimeBuffer < 600 || !Number.isSafeInteger(fillDeadlineBuffer) || fillDeadlineBuffer < 600)
      fail('ROUTER_DEPLOYMENT_MISMATCH');
    const [usdc, allowance, native, nonce, pendingNonce] = await Promise.all([
      call(rpc, SRC.usdc, SEL.balanceOf + addrWord(owner), at).then(d => wordAt(d, 0)),
      spender ? call(rpc, SRC.usdc, SEL.allowance + addrWord(owner) + addrWord(spender), at).then(d => wordAt(d, 0)) : Promise.resolve(0n),
      rpc('eth_getBalance', [owner, at]).then(quantity), rpc('eth_getTransactionCount', [owner, at]).then(quantity),
      rpc('eth_getTransactionCount', [owner, 'pending']).then(quantity)]);
    const again = await rpc('eth_getBlockByNumber', [at, false]);
    if (!isObject(again) || hex(again.hash) !== block.hash) fail('ROUTER_SOURCE_REORG');
    return { block, codeSha256, implementations, usdc, native, allowance, nonce, pendingNonce, depositQuoteTimeBuffer, fillDeadlineBuffer };
  }
  async function readDestination(recipient: string): Promise<DestinationState> {
    const block = await head(drpc, DST.chainId, 'ROUTER_WRONG_DESTINATION_CHAIN'), at = tag(block.number);
    const codeSha256: Record<string, string> = { arbitrumSpokePool: await codeHash(drpc, DST.spokePool, at), arbitrumUsdc: await codeHash(drpc, DST.usdc, at) };
    for (const key of Object.keys(codeSha256)) if (codeSha256[key] !== pins[key as keyof RouterCodePins]) fail('ROUTER_UNEXPECTED_CONTRACT');
    if (wordAt(await call(drpc, DST.spokePool, SEL.chainId, at), 0) !== BigInt(DST.chainId)) fail('ROUTER_DEPLOYMENT_MISMATCH');
    if (wordAt(await call(drpc, DST.spokePool, SEL.pausedFills, at), 0) !== 0n) fail('ROUTER_FILLS_PAUSED');
    const recipientUsdc = wordAt(await call(drpc, DST.usdc, SEL.balanceOf + addrWord(recipient), at), 0);
    const recipientCode = hex(await drpc('eth_getCode', [recipient, at]));
    return { block, codeSha256, implementations: { arbitrumSpokePool: await implementation(drpc, DST.spokePool, at) }, recipientUsdc, recipientHasCode: recipientCode.length > 2 };
  }
  /** Real public-network simulation of the exact call sequence, from the owner, at the observed block. */
  async function simulate(owner: string, calls: readonly { purpose: RouterCall['purpose']; to: string; data: string }[], at: number): Promise<Simulated[]> {
    let result: unknown;
    try { result = await rpc('eth_simulateV1', [{ blockStateCalls: [{ calls: calls.map(c => ({ from: owner, to: c.to, data: c.data, value: '0x0' })) }],
      validation: false, traceTransfers: false }, tag(at)]); }
    catch (cause) { if (cause instanceof Error && cause.message === 'PUBLIC_RPC_METHOD_DENIED') throw cause; return fail('ROUTER_SIMULATION_UNAVAILABLE'); }
    const outputs = Array.isArray(result) && result.length === 1 && isObject(result[0]) && Array.isArray(result[0].calls) ? result[0].calls : null;
    if (!outputs || outputs.length !== calls.length) fail('ROUTER_SIMULATION_INVALID');
    return calls.map((c, i) => {
      const out = outputs[i];
      if (!isObject(out)) fail('ROUTER_SIMULATION_INVALID');
      if (quantity(out.status) !== 1n) fail(c.purpose === 'APPROVAL' ? 'ROUTER_SIMULATION_APPROVAL_REVERTED' : 'ROUTER_SIMULATION_DEPOSIT_REVERTED');
      return { purpose: c.purpose, gasUsed: quantity(out.gasUsed), logs: Array.isArray(out.logs) ? out.logs.filter(isObject) as unknown as RouterLog[] : [] };
    });
  }
  /** Exactly one Across deposit from the origin SpokePool, matching the reviewed route field by field. */
  function depositMatches(route: CanonicalRoute, logs: readonly RouterLog[], owner: string): { deposit: FundsDeposited; ownerDebit: bigint } {
    const deposits = logs.filter(l => typeof l.address === 'string' && l.address.toLowerCase() === SRC.spokePool && String(l.topics?.[0]).toLowerCase() === TOPIC.fundsDeposited);
    if (deposits.length !== 1) fail('ROUTER_DEPOSIT_EVENT_MISMATCH');
    const d = decodeFundsDeposited(deposits[0]!), b = route.bridge;
    if (d.destinationChainId !== BigInt(DST.chainId) || d.depositor !== b.depositor || d.recipient !== route.recipient || d.inputToken !== SRC.usdc ||
        d.outputToken !== DST.usdc || d.inputAmount !== BigInt(b.inputAmount) || d.outputAmount !== BigInt(b.outputAmount) || d.quoteTimestamp !== b.quoteTimestamp ||
        d.fillDeadline !== b.fillDeadline || d.message !== '0x' || d.exclusiveRelayer !== '0x' + addrWord(b.exclusiveRelayer)) fail('ROUTER_DEPOSIT_EVENT_MISMATCH');
    const debits = logs.filter(l => typeof l.address === 'string' && l.address.toLowerCase() === SRC.usdc && String(l.topics?.[0]).toLowerCase() === TOPIC.transfer)
      .map(decodeErc20Transfer).filter(t => t.from === owner);
    if (debits.length !== 1 || debits[0]!.amount !== BigInt(route.inputAmount)) fail('ROUTER_OWNER_DEBIT_MISMATCH');
    return { deposit: d, ownerDebit: debits[0]!.amount };
  }
  async function l1FeeUpperBound(dataBytes: number, at: string): Promise<bigint | null> {
    try { return wordAt(await call(rpc, '0x420000000000000000000000000000000000000f', '0xf1c7a58b' + word(BigInt(dataBytes + 120)), at), 0); } catch { return null; }
  }
  function intentOf(workflow: SemanticWorkflow) {
    const checked = validateAuthoringWorkflow(workflow, createBaseSepoliaReviewContext()) as SemanticWorkflow;
    const fields = validateRouterBridgeWorkflow(checked);
    const capability = resolveWorkflowCapability(checked, { environment: 'MAINNET' });
    if (!capability.executionSupported || capability.nodes[0]?.adapterId !== profile.adapterId) fail('ROUTER_CAPABILITY_UNAVAILABLE');
    return fields;
  }
  const routeRequest = (owner: string, recipient: string, amount: string, slippageBps: number, buffer: number): RouteRequest =>
    ({ owner, recipient, amount, slippageBps, nowMs: now().getTime(), depositQuoteTimeBuffer: buffer });

  /** Quote (each allowed provider, in preference order) → simulation → artifact chain → Review commitment. */
  async function buildReview(workflow: SemanticWorkflow, owner: string): Promise<RouterReview> {
    const f = intentOf(workflow), recipient = f.recipient === 'CONNECTED_OWNER' ? owner : f.recipient;
    // The SpokePool's quote-time buffer bounds the provider quotes' validity; the spender is known only after selection.
    const probe = await readSource(owner, null);
    const considered: ProviderConsideration[] = [];
    let selected: CanonicalRoute | null = null;
    for (const id of f.providers) {
      try {
        const route = await providers[id].quote(routeRequest(owner, recipient, f.amount, f.slippageBps, probe.depositQuoteTimeBuffer));
        considered.push({ provider: id, outcome: selected ? 'AVAILABLE' : 'SELECTED', code: null, minimumOutput: route.minimumOutput, feeTotal: route.feeTotal,
          routeCommitment: routeCommitment(route) });
        selected ??= route;
      } catch (cause) {
        const code = cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'ROUTER_PROVIDER_FAILED';
        considered.push({ provider: id, outcome: AVAILABILITY.test(code) ? 'UNAVAILABLE' : 'REFUSED', code, minimumOutput: null, feeTotal: null, routeCommitment: null });
      }
    }
    if (!selected) fail('ROUTER_NO_EXECUTABLE_ROUTE');
    const route = selected!;
    if (route.recipient !== recipient || route.depositor !== owner || route.inputAmount !== f.amount) fail('ROUTER_ROUTE_INTENT_MISMATCH');
    const allowance = wordAt(await call(rpc, SRC.usdc, SEL.allowance + addrWord(owner) + addrWord(route.approval.spender), tag(probe.block.number)), 0);
    const source: SourceState = { ...probe, allowance }, destination = await readDestination(recipient), at = tag(source.block.number);
    if (source.usdc < BigInt(route.inputAmount)) fail('ROUTER_INSUFFICIENT_USDC');
    const approvals = [{ token: route.approval.token, spender: route.approval.spender, amount: route.approval.amount, currentAllowance: source.allowance.toString(),
      required: source.allowance < BigInt(route.approval.amount) }];
    const plan = [...approvals[0]!.required ? [{ purpose: 'APPROVAL' as const, to: route.approval.token, data: encodeRouterApprove(route.approval.spender, BigInt(route.approval.amount)) }] : [],
      { purpose: 'BRIDGE_DEPOSIT' as const, to: route.deposit.to, data: route.deposit.data }];
    const simulated = await simulate(owner, plan, source.block.number);
    const { deposit, ownerDebit } = depositMatches(route, simulated.at(-1)!.logs, owner);
    const priority = quantity(await rpc('eth_maxPriorityFeePerGas', [])), maxFeePerGas = source.block.baseFee * 2n + priority;
    const calls: RouterCall[] = plan.map((c, i) => ({ ...c, gasUsed: simulated[i]!.gasUsed.toString(), gasLimit: (simulated[i]!.gasUsed * 13n / 10n + 25_000n).toString() }));
    const gasLimitTotal = calls.reduce((sum, c) => sum + BigInt(c.gasLimit), 0n), execution = gasLimitTotal * maxFeePerGas;
    const l1 = await Promise.all(calls.map(c => l1FeeUpperBound((c.data.length - 2) / 2, at)));
    const l1Total = l1.every(v => v !== null) ? l1.reduce((sum, v) => sum + v!, 0n) : null;
    if (source.native < execution + (l1Total ?? 0n)) fail('ROUTER_INSUFFICIENT_GAS_ETH');
    const observed = now(), depositMustLandBy = route.bridge.quoteTimestamp + source.depositQuoteTimeBuffer;
    const expiresMs = Math.min(observed.getTime() + profile.reviewTtlSeconds * 1000, Date.parse(route.quote.expiresAt));
    if (expiresMs <= observed.getTime()) fail('ROUTER_QUOTE_EXPIRED');
    const expiresAt = new Date(expiresMs).toISOString(), commitment = routeCommitment(route);
    const artifacts = compileRouterArtifacts({ workflow, nodeId: f.nodeId, route, routeCommitment: commitment, owner, calls,
      simulation: { block: source.block.number, observedAt: observed.toISOString(), gasLimitTotal: gasLimitTotal.toString(), executionFeeUpperBoundWei: execution.toString(),
        depositId: deposit.depositId.toString() }, expiresAt });
    const review: Omit<RouterReview, 'commitment'> = {
      format: 'flofi.router-review.v1', owner, recipient, recipientKind: f.recipient === 'CONNECTED_OWNER' ? 'CONNECTED_OWNER' : 'EXPLICIT',
      workflowHash: hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow))), revision: workflow.revision, nodeId: f.nodeId,
      observedAt: observed.toISOString(), expiresAt,
      intent: { sourceChain: f.sourceChain, destinationChain: f.destinationChain, inputToken: f.inputToken, outputToken: f.outputToken, amount: f.amount,
        slippageBps: f.slippageBps, providers: [...f.providers] },
      selection: { policy: 'PREFERENCE_ORDER', selected: route.routingProvider, considered }, route, routeCommitment: commitment,
      quote: { provenance: 'PROVIDER_QUOTE', provider: route.routingProvider, quoteId: route.quote.id, rawHash: route.quote.rawHash, expectedOutput: route.expectedOutput,
        minimumOutput: route.minimumOutput, feeTotal: route.feeTotal, estimatedDurationSeconds: route.quote.estimatedDurationSeconds,
        providerGasEstimate: route.quote.providerGasEstimate, quotedAt: route.quote.quotedAt, expiresAt: route.quote.expiresAt },
      simulation: { provenance: 'TRANSACTION_SIMULATION', method: 'eth_simulateV1', chainId: SRC.chainId, block: source.block.number,
        calls: simulated.map(s => ({ purpose: s.purpose, gasUsed: s.gasUsed.toString() })),
        deposit: { spokePool: deposit.spokePool, depositId: deposit.depositId.toString(), depositor: deposit.depositor, recipient: deposit.recipient,
          inputToken: deposit.inputToken, outputToken: deposit.outputToken, inputAmount: deposit.inputAmount.toString(), outputAmount: deposit.outputAmount.toString(),
          destinationChainId: Number(deposit.destinationChainId), quoteTimestamp: deposit.quoteTimestamp, fillDeadline: deposit.fillDeadline,
          exclusiveRelayer: route.bridge.exclusiveRelayer },
        ownerDebit: ownerDebit.toString(), notSimulated: ['DESTINATION_FILL', 'RELAYER_BEHAVIOUR', 'ORIGIN_REFUND'] },
      observation: { provenance: 'CHAIN_OBSERVATION',
        source: { chainId: SRC.chainId, block: { number: source.block.number, hash: source.block.hash, timestamp: source.block.timestamp }, usdcBalance: source.usdc.toString(),
          nativeBalance: source.native.toString(), allowance: source.allowance.toString(), nonce: source.nonce.toString(), codeSha256: source.codeSha256,
          implementations: source.implementations, depositQuoteTimeBuffer: source.depositQuoteTimeBuffer, fillDeadlineBuffer: source.fillDeadlineBuffer },
        destination: { chainId: DST.chainId, block: { number: destination.block.number, hash: destination.block.hash, timestamp: destination.block.timestamp },
          recipientUsdcBalance: destination.recipientUsdc.toString(), recipientHasCode: destination.recipientHasCode, codeSha256: destination.codeSha256,
          implementations: destination.implementations } },
      approvals, calls,
      fees: { maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: priority.toString(), gasLimitTotal: gasLimitTotal.toString(),
        executionFeeUpperBoundWei: execution.toString(), l1FeeUpperBoundWei: l1Total?.toString() ?? null, totalUpperBoundWei: l1Total === null ? null : (execution + l1Total).toString() },
      deadlines: { reviewExpiresAt: expiresAt, quoteExpiresAt: route.quote.expiresAt, depositMustLandBy, fillDeadline: route.bridge.fillDeadline },
      artifacts, nonce: source.nonce.toString(),
    };
    return { ...review, commitment: routerReviewCommitment(review as RouterReview) };
  }

  // --- duplicate-effect guards ---------------------------------------------------------------------------------------
  /**
   * Claims an exclusive economic identity, then persists the attempt while still holding it. An entry whose attempt was
   * never persisted was never handed to a wallet (`begin` returns the transaction only after this save), so it is stale.
   */
  async function claim<T>(key: string, name: string, code: string, record: RouterRecord, attemptId: string, inner: () => Promise<T>): Promise<T> {
    return leases.hold(key, async () => {
      const entry = new TextEncoder().encode(JSON.stringify({ runId: record.id, attemptId }) + '\n'), existing = await log.read(name);
      if (existing === null) { if (!await log.create(name, entry)) fail(code); }
      else {
        const prior = JSON.parse(utf8(existing).trimEnd().split('\n').at(-1)!) as { runId: string; attemptId: string };
        const holder = prior.runId === record.id ? record : await load(prior.runId);
        const held = holder.attempts.find(a => a.attemptId === prior.attemptId);
        if (held && ACTIVE.includes(held.state)) fail(code);
        await log.extend(name, new TextEncoder().encode(utf8(existing) + new TextDecoder().decode(entry)), () => undefined);
      }
      return inner();
    });
  }
  /**
   * Owner + nonce is one economic identity, and at most one unresolved bridge deposit may exist per owner across all runs:
   * a delegated (relayed) submission does not consume the owner's nonce, so the nonce alone cannot exclude a second deposit
   * while the first one's outcome is unknown.
   */
  function prepareAttempt(record: RouterRecord, attempt: RouterAttempt): Promise<RouterRecord> {
    const persist = () => save({ ...record, attempts: [...record.attempts, attempt], error: null });
    const nonce = () => claim(`${record.owner}-${attempt.nonce}`, `${record.owner}-${attempt.nonce}.xroute-intent`, 'ROUTER_OWNER_NONCE_IN_USE', record, attempt.attemptId, persist);
    return attempt.step === 'DEPOSIT'
      ? claim(`${record.owner}-deposit`, `${record.owner}-deposit.xroute-guard`, 'ROUTER_OWNER_DEPOSIT_IN_FLIGHT', record, attempt.attemptId, nonce) : nonce();
  }

  // --- source observation --------------------------------------------------------------------------------------------
  async function discoverByNonce(attempt: RouterAttempt): Promise<{ consumed: false } | { consumed: true; tx: Record<string, unknown> }> {
    const owner = attempt.tx.from, nonce = BigInt(attempt.nonce);
    const count = async (block: number) => quantity(await rpc('eth_getTransactionCount', [owner, tag(block)]));
    const latest = Number(quantity(await rpc('eth_blockNumber', [])));
    if (!Number.isSafeInteger(latest) || latest < attempt.preparedAtBlock) fail('ROUTER_RPC_INVALID');
    if (await count(latest) <= nonce) return { consumed: false };
    if (await count(attempt.preparedAtBlock) > nonce) fail('ROUTER_NONCE_CONSUMED_BEFORE_PREPARATION');
    let low = attempt.preparedAtBlock, high = latest;
    while (high - low > 1) { const middle = low + Math.floor((high - low) / 2); if (await count(middle) > nonce) high = middle; else low = middle; }
    const block = await rpc('eth_getBlockByNumber', [tag(high), true]);
    if (!isObject(block) || !Array.isArray(block.transactions)) fail('ROUTER_RPC_INVALID');
    const found = block.transactions.find(tx => isObject(tx) && typeof tx.from === 'string' && tx.from.toLowerCase() === owner && quantity(tx.nonce) === nonce);
    if (!isObject(found)) fail('ROUTER_DISCOVERY_INCONSISTENT');
    return { consumed: true, tx: found };
  }
  /**
   * The reviewed deposit's own on-chain identity: Across indexes the depositor in `FundsDeposited`, so a deposit is found even
   * when its hash was lost and the owner's nonce never moved (a relayed MetaMask redemption). Only blocks in which the deposit
   * could still land (before the SpokePool quote window closes) are scanned.
   */
  async function discoverDeposit(record: RouterRecord, attempt: RouterAttempt): Promise<string | null> {
    const b = record.review.route.bridge, latest = Number(quantity(await rpc('eth_blockNumber', [])));
    const window = Math.max(0, Math.min(4_000, Math.ceil((record.review.deadlines.depositMustLandBy * 1000 - Date.parse(attempt.createdAt)) / 2_000) + 60));
    const last = Math.min(latest, attempt.preparedAtBlock + window);
    for (let from = attempt.preparedAtBlock; from <= last; from += 1_000) {
      const logs = await rpc('eth_getLogs', [{ address: SRC.spokePool, fromBlock: tag(from), toBlock: tag(Math.min(from + 999, last)),
        topics: [TOPIC.fundsDeposited, '0x' + word(BigInt(DST.chainId)), null, '0x' + addrWord(b.depositor)] }]);
      if (!Array.isArray(logs)) fail('ROUTER_RPC_INVALID');
      for (const entry of logs) {
        if (!isObject(entry) || typeof entry.transactionHash !== 'string') fail('ROUTER_RPC_INVALID');
        const d = decodeFundsDeposited(entry as unknown as RouterLog);
        if (d.recipient === record.review.route.recipient && d.inputAmount === BigInt(b.inputAmount) && d.outputAmount === BigInt(b.outputAmount) &&
            d.quoteTimestamp === b.quoteTimestamp && d.fillDeadline === b.fillDeadline && d.outputToken === DST.usdc) return entry.transactionHash.toLowerCase();
      }
    }
    return null;
  }
  const sameIntent = (attempt: RouterAttempt, tx: Record<string, unknown>) => typeof tx.to === 'string' && tx.to.toLowerCase() === attempt.tx.to &&
    typeof tx.input === 'string' && tx.input.toLowerCase() === attempt.tx.data && quantity(tx.value) === 0n && quantity(tx.chainId) === BigInt(SRC.chainId);
  const transition = (record: RouterRecord, phase: RouterPhase): RouterRecord => { assertRouterTransition(record.phase, phase); return { ...record, phase }; };

  async function settleSource(record: RouterRecord, attempt: RouterAttempt, hash: string, raw: Record<string, unknown>): Promise<RouterRecord> {
    const tx = await rpc('eth_getTransactionByHash', [hash]);
    let verified: Awaited<ReturnType<typeof verifyOwnerSubmission>>;
    try { verified = await verifyOwnerSubmission(rpc, { txHash: hash, account: record.owner, target: attempt.tx.to, data: attempt.tx.data, preBlock: attempt.preparedAtBlock },
      tx, raw, SRC.chainId); }
    catch (cause) {
      if (cause instanceof Error && cause.message === 'RECEIPT_NOT_CANONICAL') return save({ ...record, error: 'ROUTER_RECEIPT_NOT_CANONICAL' });
      if (cause instanceof Error && /^(TRANSACTION_MISMATCH|RECEIPT_INVALID)$/.test(cause.message))
        return save(replaceAttempt({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', authorization: null, error: 'ROUTER_TRANSACTION_MISMATCH' },
          { ...attempt, state: 'RECONCILIATION_REQUIRED', note: 'ROUTER_TRANSACTION_MISMATCH' }));
      throw cause;
    }
    const receipt: RouterReceipt = { transactionHash: hash, status: verified.status, blockNumber: verified.blockNumber, blockHash: hex(raw.blockHash), from: verified.txFrom,
      gasCostWei: (verified.gasUsed * verified.effectiveGasPrice + verified.l1Fee).toString(), submissionKind: verified.delegated ? 'DELEGATED_SINGLE' : 'DIRECT', contentHash: digest(raw) };
    if (verified.status === 0) {
      if (attempt.step === 'DEPOSIT') return save(replaceAttempt({ ...transition(record, 'FAILED'), verdict: 'FAILED', authorization: null, error: 'ROUTER_DEPOSIT_REVERTED' },
        { ...attempt, state: 'REVERTED', receipt, note: 'ROUTER_DEPOSIT_REVERTED' }));
      return save(replaceAttempt(deauthorized(record, 'ROUTER_APPROVAL_REVERTED'), { ...attempt, state: 'REVERTED', receipt, note: 'ROUTER_APPROVAL_REVERTED' }));
    }
    const logs = Array.isArray(raw.logs) ? raw.logs.filter(isObject) as unknown as RouterLog[] : fail('ROUTER_RECEIPT_INVALID');
    try {
      if (attempt.step === 'APPROVAL') {
        const { spender, amount } = decodeRouterApprove(attempt.tx.data);
        const approvals = logs.filter(l => String(l.address).toLowerCase() === SRC.usdc && String(l.topics[0]).toLowerCase() === TOPIC.approval).map(decodeErc20Approval);
        if (approvals.length !== 1 || approvals[0]!.owner !== record.owner || approvals[0]!.spender !== spender || approvals[0]!.amount !== amount) fail('ROUTER_APPROVAL_MISMATCH');
        const effective = wordAt(await call(rpc, SRC.usdc, SEL.allowance + addrWord(record.owner) + addrWord(spender), tag(verified.blockNumber)), 0);
        if (effective !== amount) fail('ROUTER_APPROVAL_NOT_EFFECTIVE');
        return save(replaceAttempt({ ...record, error: null }, { ...attempt, state: 'CONFIRMED', receipt, reconciled: true }));
      }
      const { deposit, ownerDebit } = depositMatches(record.review.route, logs, record.owner);
      const block = await rpc('eth_getBlockByNumber', [tag(verified.blockNumber), false]);
      if (!isObject(block)) fail('ROUTER_RPC_INVALID');
      const settled: SourceSettlement = { transactionHash: hash, blockNumber: verified.blockNumber, blockHash: receipt.blockHash, timestamp: Number(quantity(block.timestamp)),
        spokePool: deposit.spokePool, depositId: deposit.depositId.toString(), depositor: deposit.depositor, recipient: deposit.recipient,
        inputAmount: deposit.inputAmount.toString(), outputAmount: deposit.outputAmount.toString(), quoteTimestamp: deposit.quoteTimestamp, fillDeadline: deposit.fillDeadline,
        ownerDebit: ownerDebit.toString(), safe: false };
      // The authorization is consumed by the confirmed deposit; it can never authorize another one.
      return save(replaceAttempt({ ...transition(record, 'SOURCE_CONFIRMED'), authorization: null, source: settled, error: null },
        { ...attempt, state: 'CONFIRMED', receipt, reconciled: true }));
    } catch (cause) {
      const code = cause instanceof Error && /^ROUTER_[A-Z0-9_]+$/.test(cause.message) ? cause.message : null;
      if (!code || code === 'ROUTER_RPC_INVALID') throw cause;
      return save(replaceAttempt({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', authorization: null, error: code },
        { ...attempt, state: 'RECONCILIATION_REQUIRED', receipt, note: code }));
    }
  }
  async function observeAttempt(record: RouterRecord, attempt: RouterAttempt): Promise<RouterRecord> {
    if (attempt.state === 'PREPARED') {
      // The browser stopped before the durable handoff: no wallet request can exist for this attempt.
      return save(replaceAttempt(deauthorized(record, 'ROUTER_WALLET_NOT_SUBMITTED'), { ...attempt, state: 'CANCELLED', note: 'ROUTER_WALLET_NOT_SUBMITTED' }));
    }
    let hash = attempt.replacementHash ?? attempt.transactionHash;
    let raw = hash ? await rpc('eth_getTransactionReceipt', [hash]) : null;
    if (raw === null && attempt.step === 'DEPOSIT') {
      const logged = await discoverDeposit(record, attempt);
      if (logged && logged !== hash) {
        const current: RouterAttempt = { ...attempt, state: 'PENDING', transactionHash: attempt.transactionHash ?? logged,
          replacementHash: attempt.transactionHash !== null && attempt.transactionHash !== logged ? logged : attempt.replacementHash };
        const saved = await save(replaceAttempt({ ...record, error: null }, current)), receipt = await rpc('eth_getTransactionReceipt', [logged]);
        if (!isObject(receipt)) return save({ ...saved, error: 'ROUTER_TRANSACTION_PENDING' });
        return settleSource(saved, current, logged, receipt);
      }
    }
    if (raw === null) {
      const found = await discoverByNonce(attempt);
      if (!found.consumed) {
        const latest = await head(rpc, SRC.chainId, 'ROUTER_WRONG_SOURCE_CHAIN');
        const pending = quantity(await rpc('eth_getTransactionCount', [record.owner, 'pending']));
        // A deposit can no longer move funds once the SpokePool's quote-time window has passed; an abandoned approval is dropped.
        const expired = attempt.step === 'DEPOSIT' ? latest.timestamp > record.review.deadlines.depositMustLandBy
          : now().getTime() - Date.parse(attempt.createdAt) > APPROVAL_ABANDON_MS && pending === BigInt(attempt.nonce);
        if (expired) {
          const next = { ...attempt, state: 'NOT_FOUND' as const, note: 'ROUTER_SUBMISSION_EXPIRED_NOT_EXECUTED' };
          return save(replaceAttempt(attempt.step === 'DEPOSIT' ? { ...transition(record, 'FAILED'), verdict: 'FAILED', authorization: null, error: next.note }
            : deauthorized(record, next.note), next));
        }
        return save({ ...record, error: hash ? 'ROUTER_TRANSACTION_PENDING' : 'ROUTER_TRANSACTION_NOT_OBSERVED' });
      }
      const foundHash = hex(found.tx.hash);
      if (!sameIntent(attempt, found.tx)) {
        const next = { ...attempt, state: 'NOT_FOUND' as const, transactionHash: attempt.transactionHash ?? foundHash, note: 'ROUTER_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION' };
        return save(replaceAttempt(attempt.step === 'DEPOSIT' ? { ...transition(record, 'FAILED'), verdict: 'FAILED', authorization: null, error: next.note }
          : deauthorized(record, next.note), next));
      }
      const replaced = attempt.transactionHash !== null && attempt.transactionHash !== foundHash;
      const current: RouterAttempt = { ...attempt, state: 'PENDING', transactionHash: attempt.transactionHash ?? foundHash, replacementHash: replaced ? foundHash : attempt.replacementHash };
      hash = foundHash;
      raw = await rpc('eth_getTransactionReceipt', [hash]);
      const saved = await save(replaceAttempt(record, current));
      if (raw === null) return save({ ...saved, error: 'ROUTER_TRANSACTION_PENDING' });
      if (!isObject(raw)) fail('ROUTER_RECEIPT_INVALID');
      return settleSource(saved, current, hash, raw);
    }
    if (!isObject(raw)) fail('ROUTER_RECEIPT_INVALID');
    return settleSource(record, attempt, hash!, raw);
  }

  // --- settlement observation ----------------------------------------------------------------------------------------
  async function safeHead(r: Rpc): Promise<number> {
    const block = await r('eth_getBlockByNumber', [profile.finality, false]);
    if (!isObject(block)) fail('ROUTER_RPC_INVALID');
    return Number(quantity(block.number));
  }
  /** Canonical inclusion: non-zero block hash that is the canonical block at that height and lists the transaction. */
  async function canonicalReceipt(r: Rpc, hash: string): Promise<Record<string, unknown> | null> {
    const raw = await r('eth_getTransactionReceipt', [hash]);
    if (raw === null) return null;
    if (!isObject(raw) || hex(raw.transactionHash) !== hash) fail('ROUTER_RECEIPT_INVALID');
    const blockHash = hex(raw.blockHash);
    if (/^0x0{64}$/.test(blockHash)) return null;
    const block = await r('eth_getBlockByNumber', [tag(Number(quantity(raw.blockNumber))), false]);
    if (!isObject(block) || hex(block.hash) !== blockHash || !Array.isArray(block.transactions) ||
        !block.transactions.some(entry => (isObject(entry) ? String(entry.hash).toLowerCase() : String(entry).toLowerCase()) === hash)) return null;
    return { ...raw, timestamp: block.timestamp };
  }
  type FillCheck = { ok: true; fill: DestinationFill } | { ok: false; divergent: string | null };
  /** Independent destination proof for one candidate transaction. A transaction without our fill is not ours; a fill of our deposit that disagrees is divergent. */
  async function verifyFill(record: RouterRecord, hash: string, discoveredBy: DestinationFill['discoveredBy']): Promise<FillCheck> {
    const source = record.source!, route = record.review.route;
    const raw = await canonicalReceipt(drpc, hash);
    if (!raw || quantity(raw.status) !== 1n) return { ok: false, divergent: null };
    const logs = Array.isArray(raw.logs) ? raw.logs.filter(isObject) as unknown as RouterLog[] : [];
    const fills = logs.filter(l => String(l.address).toLowerCase() === DST.spokePool && String(l.topics?.[0]).toLowerCase() === TOPIC.filledRelay).map(decodeFilledRelay)
      .filter(f => f.originChainId === BigInt(SRC.chainId) && f.depositId === BigInt(source.depositId));
    if (fills.length === 0) return { ok: false, divergent: null };
    if (fills.length !== 1) return { ok: false, divergent: 'ROUTER_FILL_DUPLICATED' };
    const f: FilledRelay = fills[0]!;
    if (f.inputToken !== SRC.usdc || f.outputToken !== DST.usdc || f.inputAmount !== BigInt(source.inputAmount) || f.outputAmount !== BigInt(source.outputAmount) ||
        f.depositor !== source.depositor || f.recipient !== route.recipient || f.fillDeadline !== source.fillDeadline || !/^0x0{64}$/.test(f.messageHash))
      return { ok: false, divergent: 'ROUTER_FILL_MISMATCH' };
    if (f.updatedRecipient !== route.recipient) return { ok: false, divergent: 'ROUTER_FILL_RECIPIENT_MISMATCH' };
    if (f.updatedOutputAmount < BigInt(route.minimumOutput)) return { ok: false, divergent: 'ROUTER_FILL_BELOW_MINIMUM' };
    const transfers = logs.filter(l => String(l.address).toLowerCase() === DST.usdc && String(l.topics?.[0]).toLowerCase() === TOPIC.transfer).map(decodeErc20Transfer)
      .filter(t => t.to === route.recipient);
    if (transfers.length !== 1 || transfers[0]!.amount !== f.updatedOutputAmount) return { ok: false, divergent: 'ROUTER_FILL_TRANSFER_MISMATCH' };
    return { ok: true, fill: { transactionHash: hash, blockNumber: Number(quantity(raw.blockNumber)), blockHash: hex(raw.blockHash), timestamp: Number(quantity(raw.timestamp)),
      spokePool: DST.spokePool, relayer: f.relayer, recipient: f.updatedRecipient, outputToken: f.outputToken, outputAmount: f.updatedOutputAmount.toString(),
      transferAmount: transfers[0]!.amount.toString(), fillType: f.fillType, discoveredBy, contentHash: digest(raw), safe: false } };
  }
  async function hint(record: RouterRecord): Promise<TransferHint | null> {
    const sourceHash = record.source!.transactionHash;
    // Underlying-protocol status first (both providers end in Across), then the routing provider's own status. Hints only.
    for (const id of [...new Set<RoutingProvider>(['across', record.review.route.routingProvider])]) {
      try { const h = await providers[id].status(sourceHash); if (h.status !== 'UNKNOWN' && h.status !== 'NOT_FOUND') return h; } catch { /* a provider outage never blocks chain observation */ }
    }
    return null;
  }
  async function observeSettlement(record0: RouterRecord): Promise<RouterRecord> {
    let record = record0;
    const route = record.review.route;
    // 1. Source finality (`safe` head) and canonical hash at that height.
    if (!record.source!.safe) {
      const safe = await safeHead(rpc);
      if (record.source!.blockNumber <= safe) {
        const block = await rpc('eth_getBlockByNumber', [tag(record.source!.blockNumber), false]);
        if (!isObject(block) || hex(block.hash) !== record.source!.blockHash)
          return save({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', error: 'ROUTER_SOURCE_REORGANIZED' });
        record = { ...record, source: { ...record.source!, safe: true }, ...record.phase === 'SOURCE_CONFIRMED' ? { phase: 'IN_FLIGHT' as const } : {} };
      }
    }
    // 2. Destination fill: provider hint verified on chain, else a durable log scan by (origin chain, deposit id).
    let lastHint = record.lastHint;
    if (!record.destination && record.phase !== 'RECOVERY_REQUIRED') {
      const h = await hint(record);
      if (h && !sameHint(h, lastHint)) lastHint = h;
      let found: DestinationFill | null = null;
      if (h?.destinationTxHash) {
        const check = await verifyFill(record, h.destinationTxHash, 'PROVIDER_HINT');
        if (check.ok) found = check.fill;
        else if (check.divergent) return save({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', lastHint, error: check.divergent });
      }
      let scanFrom = record.scanFrom;
      const latest = Number(quantity(await drpc('eth_blockNumber', [])));
      for (let window = 0; !found && window < SCAN_WINDOWS_PER_OBSERVATION && scanFrom <= latest; window++) {
        const to = Math.min(scanFrom + profile.destinationScanBlocks - 1, latest);
        const logs = await drpc('eth_getLogs', [{ address: DST.spokePool, fromBlock: tag(scanFrom), toBlock: tag(to),
          topics: [TOPIC.filledRelay, '0x' + word(BigInt(SRC.chainId)), '0x' + word(BigInt(record.source!.depositId))] }]);
        if (!Array.isArray(logs)) fail('ROUTER_RPC_INVALID');
        // The topic filter already names our deposit; a matching log whose receipt is not canonical yet is revisited next time.
        let revisit: number | null = null;
        for (const entry of logs) {
          if (!isObject(entry) || typeof entry.transactionHash !== 'string') fail('ROUTER_RPC_INVALID');
          const check = await verifyFill(record, entry.transactionHash.toLowerCase(), 'LOG_SCAN');
          if (check.ok) { found = check.fill; break; }
          if (check.divergent) return save({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', lastHint, scanFrom, error: check.divergent });
          revisit = Math.min(revisit ?? Number.MAX_SAFE_INTEGER, Number(quantity(entry.blockNumber)));
        }
        if (found) break;
        if (revisit !== null) { scanFrom = Math.max(scanFrom, revisit); break; }
        scanFrom = to + 1;
      }
      // The cursor only saves rescanning (logs are idempotent to re-read): persist it in large steps, or with the fill.
      const durableScan = found || scanFrom - record.scanFrom >= SCAN_PERSIST_BLOCKS ? scanFrom : record.scanFrom;
      const scannedTo = scanFrom - 1;
      record = { ...record, scanFrom: durableScan, lastHint };
      if (found) record = { ...transition(record, 'DESTINATION_OBSERVED'), destination: found, error: null };
      else {
        // No fill can land after the fill deadline: once the scan has covered a destination block past it, recovery is required.
        const covered = scannedTo >= 0 ? await drpc('eth_getBlockByNumber', [tag(Math.min(scannedTo, latest)), false]) : null;
        const pastDeadline = isObject(covered) && Number(quantity(covered.timestamp)) > record.source!.fillDeadline;
        if (pastDeadline) return save({ ...transition(record, 'RECOVERY_REQUIRED'), scanFrom, error: 'ROUTER_FILL_DEADLINE_PASSED_REFUND_EXPECTED' });
        return save({ ...record, error: 'ROUTER_DESTINATION_PENDING' });
      }
    }
    // 3. Recovery: a refund to the refund address on the source chain, verified on chain from a provider hint.
    if (record.phase === 'RECOVERY_REQUIRED') {
      const h = await hint(record);
      if (h && !sameHint(h, record.lastHint)) record = { ...record, lastHint: h };
      if (h?.refundTxHash) {
        const raw = await canonicalReceipt(rpc, h.refundTxHash);
        if (raw && quantity(raw.status) === 1n) {
          const refunds = (Array.isArray(raw.logs) ? raw.logs.filter(isObject) as unknown as RouterLog[] : [])
            .filter(l => String(l.address).toLowerCase() === SRC.usdc && String(l.topics?.[0]).toLowerCase() === TOPIC.transfer).map(decodeErc20Transfer)
            .filter(t => t.from === SRC.spokePool && t.to === route.refundAddress && t.amount === BigInt(record.source!.inputAmount));
          if (refunds.length === 1) return save({ ...transition(record, 'REFUNDED'), verdict: 'REFUNDED', error: null,
            refund: { transactionHash: h.refundTxHash, blockNumber: Number(quantity(raw.blockNumber)), blockHash: hex(raw.blockHash), amount: refunds[0]!.amount.toString(),
              recipient: route.refundAddress } });
        }
      }
      return save({ ...record, error: 'ROUTER_REFUND_NOT_OBSERVED' });
    }
    // 4. Destination finality, then success.
    if (record.destination && !record.destination.safe) {
      const safe = await safeHead(drpc);
      if (record.destination.blockNumber <= safe) {
        const block = await drpc('eth_getBlockByNumber', [tag(record.destination.blockNumber), false]);
        if (!isObject(block) || hex(block.hash) !== record.destination.blockHash)
          return save({ ...transition(record, 'RECONCILIATION_REQUIRED'), verdict: 'DIVERGENT', error: 'ROUTER_DESTINATION_REORGANIZED' });
        record = { ...record, destination: { ...record.destination, safe: true } };
      }
    }
    if (record.source!.safe && record.destination?.safe) {
      const evidence = await buildEvidence(record);
      return save({ ...transition(record, 'RECONCILED'), evidence, verdict: 'RECONCILED', error: null });
    }
    return save({ ...record, error: record.destination ? 'ROUTER_AWAITING_FINALITY' : record.error });
  }
  async function buildEvidence(record: RouterRecord): Promise<RouterEvidence> {
    const source = record.source!, destination = record.destination!, route = record.review.route, a = record.review.artifacts;
    const confirmed = record.attempts.filter(x => x.state === 'CONFIRMED' && x.receipt);
    const [ownerUsdc, allowance, recipientUsdc] = await Promise.all([
      call(rpc, SRC.usdc, SEL.balanceOf + addrWord(record.owner), tag(source.blockNumber)).then(d => wordAt(d, 0)),
      call(rpc, SRC.usdc, SEL.allowance + addrWord(record.owner) + addrWord(route.approval.spender), tag(source.blockNumber)).then(d => wordAt(d, 0)),
      call(drpc, DST.usdc, SEL.balanceOf + addrWord(route.recipient), tag(destination.blockNumber)).then(d => wordAt(d, 0))]);
    const src = { chainId: SRC.chain, address: SRC.usdc, decimals: 6 }, dst = { chainId: DST.chain, address: DST.usdc, decimals: 6 };
    const gas = confirmed.reduce((sum, x) => sum + BigInt(x.receipt!.gasCostWei), 0n);
    const reconciliation = { balances: [{ asset: src, amount: ownerUsdc.toString() }, { asset: dst, amount: recipientUsdc.toString() }],
      allowances: [{ asset: src, amount: allowance.toString() }], debt: [], positions: [],
      fees: [{ asset: { chainId: SRC.chain, nativeId: 'ETH', decimals: 18 }, amount: gas.toString() }, { asset: src, amount: route.feeTotal }],
      residualAssets: [{ asset: src, amount: ownerUsdc.toString() }], ownership: [{ chainId: SRC.chain, address: record.owner }, { chainId: DST.chain, address: route.recipient }],
      limitations: [provenance === 'PUBLIC_MAINNET' ? 'PUBLIC_MAINNET_OWNER_EXECUTED' : 'MOCKED_CHAINS_ONLY', 'SAFE_HEAD_FINALITY'] };
    const transactions = [...confirmed.map(x => ({ chain: SRC.chain, step: x.step, transactionHash: x.receipt!.transactionHash, blockNumber: x.receipt!.blockNumber,
      blockHash: x.receipt!.blockHash, explorer: routerExplorerTx('source', x.receipt!.transactionHash) })),
      { chain: DST.chain, step: 'FILL', transactionHash: destination.transactionHash, blockNumber: destination.blockNumber, blockHash: destination.blockHash,
        explorer: routerExplorerTx('destination', destination.transactionHash) }];
    const bundle = validateArtifact('evidence-bundle', { schemaVersion: '1.0.0', evidenceBundleId: record.id + '.evidence', version: 1, supersedes: null,
      semanticWorkflowHash: a.hashes.workflow, artifactSetHash: a.hashes.artifactSet, simulationHash: a.hashes.simulation, policyHash: a.hashes.policy,
      manifestHash: a.hashes.manifest, executionPlanHash: a.hashes.plan, journalHeadHash: digest(record), observedAt: now().toISOString(),
      environment: provenance === 'PUBLIC_MAINNET' ? 'MAINNET_EXECUTED' : 'MOCKED', outcome: 'RECONCILED',
      receipts: [...confirmed.map(x => ({ receiptId: x.receipt!.transactionHash, contentHash: x.receipt!.contentHash })),
        { receiptId: destination.transactionHash, contentHash: destination.contentHash }], differences: [], reconciliation,
      evidence: [{ evidenceId: 'route-commitment', kind: 'EXTERNAL_REFERENCE', contentHash: record.review.routeCommitment },
        { evidenceId: 'source-deposit', kind: 'EXTERNAL_REFERENCE', contentHash: digest(source) },
        { evidenceId: 'destination-fill', kind: 'EXTERNAL_REFERENCE', contentHash: digest(destination) },
        { evidenceId: 'public-explorer', kind: 'EXTERNAL_REFERENCE', contentHash: digest(transactions.map(t => t.explorer).join('\n')) }] }) as EvidenceBundle;
    return { bundle, bundleHash: hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(bundle))),
      evidenceClass: provenance === 'PUBLIC_MAINNET' ? 'MAINNET_EXECUTED' : 'MOCKED',
      route: { provider: route.routingProvider, underlyingProtocol: route.underlyingProtocol, routeCommitment: record.review.routeCommitment, manifestHash: a.hashes.manifest },
      source, destination, recipient: route.recipient, minimumOutput: route.minimumOutput, transactions, reconciliation: 'RECONCILED', observedAt: now().toISOString() };
  }

  return {
    executionEnabled,
    /** Read-only: a new run with fresh quotes, a fresh simulation and a route-bound Manifest for this owner. */
    async simulate(workflowInput: unknown, ownerInput: string): Promise<RouterRecord> {
      const workflow = workflowInput as SemanticWorkflow, owner = address(ownerInput, 'ROUTER_OWNER_INVALID');
      const review = await buildReview(workflow, owner);
      return save({ format: 'flofi.router-run.v1', id: 'xroute-' + randomBytes(16).toString('hex'), provenance, workflow, owner, review, authorization: null,
        phase: 'PREPARED', attempts: [], source: null, destination: null, refund: null, scanFrom: review.observation.destination.block.number, lastHint: null,
        routeChanges: [], requote: false, evidence: null, verdict: 'PENDING', error: null });
    },
    /** New quote, simulation and Review for the same run; only before any deposit attempt exists. */
    async refresh(id: string): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id);
      if (record.verdict !== 'PENDING' || active(record) || !['PREPARED', 'AUTHORIZED'].includes(record.phase) ||
          record.attempts.some(a => a.step === 'DEPOSIT' && a.state !== 'CANCELLED')) fail('ROUTER_REFRESH_NOT_ALLOWED');
      const review = await buildReview(record.workflow, record.owner);
      return save({ ...record, phase: 'PREPARED', review, authorization: null, error: null, requote: false,
        routeChanges: compareRoutes(record.review.route, review.route, 'REQUOTE'),
        scanFrom: Math.max(record.scanFrom, review.observation.destination.block.number) });
    }); },
    async review(id: string, commitment: string, workflow: SemanticWorkflow): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id);
      if (!sameWorkflow(workflow, record.workflow)) fail('ROUTER_SEMANTIC_REVISION_CHANGED');
      if (record.verdict !== 'PENDING' || active(record) || record.phase !== 'PREPARED') fail('ROUTER_REVIEW_NOT_ALLOWED');
      if (record.requote) fail('ROUTER_REQUOTE_REQUIRED');
      if (commitment !== record.review.commitment) fail('ROUTER_REVIEW_CHANGED');
      if (now().getTime() >= Date.parse(record.review.expiresAt)) fail('ROUTER_REVIEW_EXPIRED');
      return save({ ...record, phase: 'AUTHORIZED', authorization: commitment, error: null });
    }); },
    async invalidate(id: string): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id);
      return record.authorization && record.phase === 'AUTHORIZED' && !active(record) ? save(deauthorized(record, 'ROUTER_SEMANTIC_EDIT_REQUIRES_REVIEW')) : record;
    }); },
    /**
     * Re-verifies the Review against fresh chain state, re-quotes the SAME provider and compares (no fallback of any kind),
     * re-simulates the remaining reviewed calls, then persists PREPARED with the exact next wallet request.
     */
    async begin(id: string, ownerInput: string, workflow: SemanticWorkflow): Promise<RouterBegin> { return locked(id, async () => {
      let record = await load(id);
      const owner = address(ownerInput, 'ROUTER_OWNER_INVALID');
      if (!executionEnabled) fail('ROUTER_EXECUTION_NOT_ENABLED');
      if (owner !== record.owner) fail('ROUTER_WRONG_OWNER');
      if (!sameWorkflow(workflow, record.workflow)) fail('ROUTER_SEMANTIC_REVISION_CHANGED');
      if (record.verdict !== 'PENDING' || SETTLING.includes(record.phase)) fail('ROUTER_DEPOSIT_ALREADY_CONFIRMED');
      if (active(record)) fail('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
      if (record.phase !== 'AUTHORIZED' || record.authorization !== record.review.commitment) fail('ROUTER_REVIEW_REQUIRED');
      const review = record.review, route = review.route;
      const invalidate = async (code: string, changes: readonly RouteChange[] = []): Promise<never> => { await save(deauthorized(record, code, changes, true)); return fail(code); };
      if (now().getTime() >= Date.parse(review.expiresAt)) return invalidate('ROUTER_REVIEW_EXPIRED');
      if (record.attempts.some(a => a.step === 'DEPOSIT' && !['CANCELLED', 'NOT_FOUND'].includes(a.state))) fail('ROUTER_DEPOSIT_MAY_EXIST_OBSERVE');
      const state = await readSource(owner, route.approval.spender);
      const dest = await readDestination(review.recipient);
      if (canonical(state.codeSha256) !== canonical(review.observation.source.codeSha256) || canonical(state.implementations) !== canonical(review.observation.source.implementations) ||
          canonical(dest.codeSha256) !== canonical(review.observation.destination.codeSha256) ||
          canonical(dest.implementations) !== canonical(review.observation.destination.implementations) ||
          state.depositQuoteTimeBuffer !== review.observation.source.depositQuoteTimeBuffer) return invalidate('ROUTER_STATE_CHANGED_REVIEW_REQUIRED');
      // Route revalidation with the same provider: any material change is ROUTE_CHANGED, never a substitution.
      let fresh: CanonicalRoute;
      try { fresh = await providers[route.routingProvider].quote(routeRequest(owner, review.recipient, route.inputAmount, route.slippageBps, state.depositQuoteTimeBuffer)); }
      catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (AVAILABILITY.test(code) || !/^[A-Z][A-Z0-9_]{2,80}$/.test(code)) fail('ROUTER_ROUTE_REVALIDATION_UNAVAILABLE');
        return invalidate('ROUTE_CHANGED', ['PROTOCOL_CHANGED']);
      }
      const changes = compareRoutes(route, fresh, 'REQUOTE');
      if (changes.length) return invalidate('ROUTE_CHANGED', changes);
      const needsApproval = state.allowance < BigInt(route.approval.amount);
      const step: RouterStep = needsApproval ? 'APPROVAL' : 'DEPOSIT';
      const purpose = step === 'APPROVAL' ? 'APPROVAL' : 'BRIDGE_DEPOSIT';
      const index = review.calls.findIndex(c => c.purpose === purpose);
      if (index < 0) return invalidate('ROUTER_STATE_CHANGED_REVIEW_REQUIRED');
      const remaining = review.calls.slice(index);
      let simulated: Simulated[];
      try { simulated = await simulate(owner, remaining, state.block.number); }
      catch (cause) { if (cause instanceof Error && /^ROUTER_SIMULATION_(APPROVAL|DEPOSIT)_REVERTED$/.test(cause.message)) return invalidate('ROUTER_STATE_CHANGED_REVIEW_REQUIRED'); throw cause; }
      try { depositMatches(route, simulated.at(-1)!.logs, owner); } catch { return invalidate('ROUTER_STATE_CHANGED_REVIEW_REQUIRED'); }
      if (state.usdc < BigInt(route.inputAmount)) fail('ROUTER_INSUFFICIENT_USDC');
      if (state.nonce !== state.pendingNonce) fail('ROUTER_PENDING_TRANSACTION');
      if (step === 'DEPOSIT' && state.block.timestamp + 120 > review.deadlines.depositMustLandBy - profile.depositSafetyMarginSeconds) return invalidate('ROUTER_REVIEW_EXPIRED');
      const reviewed = review.calls[index]!;
      const priority = BigInt(review.fees.maxPriorityFeePerGas), maxFeePerGas = state.block.baseFee * 2n + priority;
      if (state.native < BigInt(reviewed.gasLimit) * maxFeePerGas) fail('ROUTER_INSUFFICIENT_GAS_ETH');
      const attemptId = `${id}.${step.toLowerCase()}.${record.attempts.length + 1}`;
      const tx: RouterTx = { chainId: SRC.chainHex, from: owner, to: reviewed.to, data: reviewed.data, value: '0x0', gas: tag(BigInt(reviewed.gasLimit)),
        maxFeePerGas: tag(maxFeePerGas), maxPriorityFeePerGas: tag(priority) };
      const attempt: RouterAttempt = { attemptId, step, state: 'PREPARED', reviewCommitment: review.commitment, nonce: state.nonce.toString(), preparedAtBlock: state.block.number,
        createdAt: now().toISOString(), tx, transactionHash: null, replacementHash: null, receipt: null, reconciled: false, note: null };
      record = await prepareAttempt(record, attempt);
      return { record, attempt, transaction: tx };
    }); },
    /** The handoff boundary: SUBMITTING is durable before the browser calls the wallet. */
    async handoff(id: string): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id), attempt = record.attempts.at(-1);
      if (!executionEnabled || attempt?.state !== 'PREPARED' || record.authorization !== attempt.reviewCommitment || now().getTime() >= Date.parse(record.review.expiresAt))
        fail('ROUTER_WALLET_HANDOFF_NOT_AUTHORIZED');
      const [latest, pending] = await Promise.all([rpc('eth_getTransactionCount', [record.owner, 'latest']).then(quantity),
        rpc('eth_getTransactionCount', [record.owner, 'pending']).then(quantity)]);
      if (latest !== BigInt(attempt.nonce) || pending !== BigInt(attempt.nonce)) fail('ROUTER_NONCE_CHANGED');
      const next = replaceAttempt(record, { ...attempt, state: 'SUBMITTING' });
      return save(attempt.step === 'DEPOSIT' ? transition(next, 'SOURCE_SUBMITTED') : next);
    }); },
    /** Wallet result. A hash is recorded once (a repeated identical report is a no-op); ambiguity is observed, never resent. */
    async report(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id), attempt = record.attempts.at(-1);
      if (!attempt) fail('ROUTER_ATTEMPT_MISSING');
      if (result.kind === 'HASH') {
        const hash = result.hash.toLowerCase();
        if (!HASH.test(hash)) fail('ROUTER_HASH_INVALID');
        if (attempt.transactionHash) { if (attempt.transactionHash !== hash) fail('ROUTER_HASH_DIVERGENT'); return record; }
        if (!['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state)) fail('ROUTER_ATTEMPT_STATE_INVALID');
        return save(replaceAttempt({ ...record, error: null }, { ...attempt, state: 'PENDING', transactionHash: hash }));
      }
      if (attempt.state !== 'SUBMITTING') return record;
      return save(replaceAttempt({ ...record, error: 'ROUTER_SUBMISSION_UNKNOWN' }, { ...attempt, state: 'SUBMISSION_RESULT_UNKNOWN',
        note: result.kind === 'REJECTED' ? 'ROUTER_REPORTED_REJECTED_UNPROVEN' : 'ROUTER_SUBMISSION_UNKNOWN' }));
    }); },
    /** Records a proven pre-broadcast failure or refusal. Anything that may have reached the network stays observation-only. */
    async walletFailure(id: string, diagnostic: RouterWalletDiagnostic): Promise<RouterRecord> { return locked(id, async () => {
      const record = await load(id), attempt = record.attempts.at(-1);
      if (JSON.stringify(diagnostic).length > 65_536 || typeof diagnostic.invoked !== 'boolean' || !Array.isArray(diagnostic.calls) || !/^ROUTER_[A-Z0-9_]{2,70}$/.test(diagnostic.code))
        fail('ROUTER_DIAGNOSTIC_INVALID');
      const send = diagnostic.calls.find(c => c.submission === true), error = send?.error as { code?: unknown } | undefined;
      const refused = diagnostic.invoked && send !== undefined && send.result === undefined && typeof error?.code === 'number' && error.code === diagnostic.rejectionCode &&
        REFUSALS.includes(error.code);
      if ((diagnostic.invoked || send) && !refused || !attempt || attempt.transactionHash || !['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state))
        fail('ROUTER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
      return save(replaceAttempt(deauthorized(record, diagnostic.code), { ...attempt, state: 'CANCELLED', note: diagnostic.code }));
    }); },
    /** Read-only observation and reconciliation (API and worker). There is no send path here. */
    async observe(id: string): Promise<RouterRecord> { return locked(id, async () => {
      let record = await load(id);
      if (record.verdict !== 'PENDING') return record;
      const attempt = active(record);
      if (attempt) {
        record = await observeAttempt(record, attempt);
        if (record.verdict !== 'PENDING' || active(record)) return record;
      }
      return SETTLING.includes(record.phase) ? observeSettlement(record) : record;
    }); },
    load,
  };
}
export type RouterService = ReturnType<typeof createRouterService>;

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F Mode A fork service: one exact-payload USDC/WETH swap on local chain 31337.
 *
 * This module is the single orchestration used by the application server, the owner recording
 * scenario and the offline replay. It imports only workspace packages and Node built-ins and uses
 * erasable TypeScript only, so the fork harness loads this exact file. It never signs, never
 * broadcasts and never holds a key: the user's wallet submits, and every effect is read back
 * independently from the fork. Unknown results never authorize a retry.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BASE_CODE_PINS, FORK_CHAIN_ID, FORK_CHAIN_ID_HEX, FORK_CONTRACTS, SOURCE_CHAIN_ID, SWAP_ROUTER_02,
  buildModeAPair, buildRevocationPayload, collectScriptedForkQuote, compileEnforcementMatrix, compileExecutionPlan,
  compileManifest, compilePolicy, decodeApprove, decodeSwap, decodeUnsignedPayload, encodeApprove, encodeUnsignedPayload,
  fromHex, payloadIdentity, reviewModeAPayloads, runScriptedExactSimulation, toHex, validateForkQuote,
} from '@defi-workflow-engine/reference-compiler';
import type { CompileContext, ExactSimulation, ForkQuoteFacts, ForkQuoteQuery, ReviewFinding, UnsignedPayload } from '@defi-workflow-engine/reference-compiler';
import {
  appendJournalState, classifyUnknownResult, createJournal, prepareAttemptState, readValidatedFile,
  transitionAttemptState, writeExtendingFile,
} from '@defi-workflow-engine/reference-executor';
import type { Attempt } from '@defi-workflow-engine/reference-executor';
import { APPROVAL_TOPIC, TRANSFER_TOPIC, buildEvidenceBundle, reconcileModeA, verifySignedPayload } from '@defi-workflow-engine/reference-reconciler';
import { hashArtifactBytes, hashJournalBytes, hashRawBytes } from '@defi-workflow-engine/workflow-contracts';
import type {
  ArtifactSet, AuthorizationPolicy, EnforcementMatrix, EvidenceBundle, ExecutionPlan, QuoteStateArtifact,
  SemanticWorkflow, SimulationBundle, StrategyManifest,
} from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';

export type ForkCall = (method: string, params?: readonly unknown[]) => Promise<unknown>;
export type ModeAEnvironment = 'FORK_REPRODUCED' | 'MOCKED';
export type CodePinSet = { readonly usdc: string; readonly weth: string; readonly factory: string; readonly quoter: string };
export type ModeAProfile = {
  readonly format: 'gryloo.mode-a-fork-profile.v1';
  readonly environment: ModeAEnvironment;
  readonly rpcUrl: string;
  readonly sourceChainId: 8453;
  readonly sourceBlockNumber: number;
  readonly sourceBlockHash: string;
  /** Digest of the transcript identity (source chain, N/H, Anvil pin, account pins), fixed at session start. */
  readonly stateSourceHash: string;
  readonly owner: string;
  /** MOCKED only: reviewed digests of the synthetic contracts that stand in for the Base code pins. */
  readonly syntheticCodePins: CodePinSet | null;
};
export type StepId = 'step-approve' | 'step-swap' | 'step-revoke';
export type Direction = 'WETH_TO_USDC' | 'USDC_TO_WETH';
export type StepOutcome = 'PENDING' | 'CONFIRMED_NOT_RECONCILED' | 'REVERTED' | 'DIVERGENT' | 'INCONCLUSIVE' | 'NOT_FOUND';
export type SubmissionReport = { readonly kind: 'HASH'; readonly transactionHash: string }
  | { readonly kind: 'REJECTED' } | { readonly kind: 'UNKNOWN' };
export type WalletRequest = {
  readonly from: string; readonly to: string; readonly nonce: string; readonly gas: string;
  readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly value: '0x0';
  readonly data: string; readonly chainId: typeof FORK_CHAIN_ID_HEX; readonly type: '0x2';
};
export type DecodedPayload = {
  readonly chainId: number; readonly nonce: string; readonly to: string; readonly value: string;
  readonly gasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string;
  readonly functionSelector: string;
  readonly approve: { readonly spender: string; readonly amount: string } | null;
  readonly swap: { readonly tokenIn: string; readonly tokenOut: string; readonly fee: number; readonly recipient: string;
    readonly amountIn: string; readonly amountOutMinimum: string; readonly sqrtPriceLimitX96: string; readonly deadline: string } | null;
};
export type PayloadView = { readonly stepId: StepId; readonly bytes: string; readonly payloadHash: string;
  readonly decoded: DecodedPayload; readonly request: WalletRequest };
export type PreparedExecution = {
  readonly format: 'gryloo.mode-a-prepared.v1';
  readonly executionId: string;
  readonly environment: ModeAEnvironment;
  readonly profileHash: string;
  readonly preparedAt: string;
  readonly owner: string;
  readonly direction: Direction;
  readonly nodeId: string;
  readonly revision: number;
  /** Mock nodes have no financial meaning; they are excluded from execution and disclosed. */
  readonly excludedMockNodes: readonly string[];
  readonly tokenIn: string; readonly tokenOut: string;
  readonly symbolIn: 'USDC' | 'WETH'; readonly symbolOut: 'USDC' | 'WETH';
  readonly decimalsIn: number; readonly decimalsOut: number;
  readonly amountIn: string; readonly quotedOut: string; readonly minimumOut: string;
  readonly slippageBps: number; readonly fee: number; readonly nonce: string; readonly deadline: string;
  readonly maxFeePerGas: string;
  readonly source: { readonly chainId: 8453; readonly blockNumber: number; readonly blockHash: string; readonly stateSourceHash: string };
  readonly quoteBlock: { readonly number: number; readonly hash: string; readonly timestamp: string };
  readonly quoteExpiresAt: string;
  readonly tiers: readonly { readonly fee: number; readonly status: string; readonly pool: string | null; readonly amountOut: string | null }[];
  readonly codeHashes: Readonly<Record<string, string>>;
  readonly simulation: { readonly approveGasUsed: string; readonly swapGasUsed: string; readonly approveGasLimit: string;
    readonly swapGasLimit: string; readonly allowanceAfterSwap: string; readonly residualAllowanceOnSwapFailure: string };
  readonly workflow: SemanticWorkflow;
  readonly artifacts: { readonly quote: QuoteStateArtifact; readonly artifactSet: ArtifactSet; readonly simulation: SimulationBundle;
    readonly policy: AuthorizationPolicy; readonly manifest: StrategyManifest; readonly plan: ExecutionPlan; readonly matrix: EnforcementMatrix };
  readonly hashes: { readonly semanticWorkflowHash: string; readonly quoteHash: string; readonly artifactSetHash: string;
    readonly simulationHash: string; readonly simulationRawHash: string; readonly quoteRawHash: string; readonly policyHash: string;
    readonly manifestHash: string; readonly executionPlanHash: string; readonly enforcementMatrixHash: string };
  readonly payloads: readonly [PayloadView, PayloadView];
  readonly findings: readonly ReviewFinding[];
};
export type StepObservation = { readonly attemptId: string; readonly stepId: StepId; readonly outcome: StepOutcome;
  readonly code: string; readonly transactionHash: string | null; readonly blockHash: string | null;
  readonly blockNumber: string | null; readonly status: string | null; readonly observedAt: string };
export type EvidenceRecord = { readonly version: number; readonly evidenceBundleHash: string; readonly bundle: EvidenceBundle;
  readonly environment: ModeAEnvironment; readonly outcome: EvidenceBundle['outcome']; readonly code: string;
  readonly observedOut: string | null; readonly totalFee: string | null;
  readonly residualAllowance: string; readonly revocationConfirmed: boolean };
export type RevocationRecord = { readonly format: 'gryloo.mode-a-revocation.v1'; readonly revocationId: string;
  readonly executionId: string; readonly preparedAt: string; readonly residualAllowance: string;
  readonly payload: PayloadView; readonly simulatedAllowanceAfter: string; readonly gasUsed: string };
export type ExecutionStatus = {
  readonly prepared: PreparedExecution;
  readonly attempts: readonly Attempt[];
  readonly observations: readonly StepObservation[];
  readonly evidence: readonly EvidenceRecord[];
  readonly revocation: RevocationRecord | null;
  readonly frozen: string | null;
};

const MAX_UINT = (1n << 256n) - 1n;
const QUOTE_VALIDITY_SECONDS = 60n;
const DEADLINE_SECONDS = 180n;
const PRIORITY_FEE = 1_000_000n;
const INITIAL_APPROVE_GAS = 200_000n;
const INITIAL_SWAP_GAS = 600_000n;
const REVOKE_GAS = 100_000n;
const MAX_SCAN_BLOCKS = 256;
const ANVIL_DEFAULT_ACCOUNTS = new Set([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc', '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9', '0x14dc79964da2c08b23698b3d3cc7ca32193d9955',
  '0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f', '0xa0ee7a142d267c1f36714e4a8f75612f20a79720',
]);
const TOKENS = { USDC: { address: FORK_CONTRACTS.usdc, decimals: 6 }, WETH: { address: FORK_CONTRACTS.weth, decimals: 18 } } as const;
const SWAP_ACTION = 'asset.swap.exact-input';
const L1_BLOCK = '0x4200000000000000000000000000000000000015';

/** FastLZ compressed length, as the OP stack computes it for its Fjord L1 data fee (op-geth FlzCompressLen). */
export function flzCompressLen(input: Uint8Array): number {
  let n = 0;
  const table = new Uint32Array(8192);
  const u24 = (i: number) => input[i]! | (input[i + 1]! << 8) | (input[i + 2]! << 16);
  const compare = (p: number, q: number, e: number) => {
    let l = 0;
    for (e -= q; l < e; l++) if (input[p + l] !== input[q + l]) e = 0;
    return l;
  };
  const literals = (r: number) => { n += 0x21 * Math.floor(r / 0x20); r %= 0x20; if (r !== 0) n += r + 1; };
  const match = (l: number) => { l--; n += 3 * Math.floor(l / 262); n += l % 262 >= 6 ? 3 : 2; };
  const hash = (v: number) => Number((2654435769n * BigInt(v >>> 0)) >> 19n) & 0x1fff;
  const setNextHash = (ip: number) => { table[hash(u24(ip))] = ip; return ip + 1; };
  let a = 0;
  const ipLimit = input.length < 13 ? 0 : input.length - 13;
  for (let ip = a + 2; ip < ipLimit;) {
    let r: number;
    for (;;) {
      const v = u24(ip);
      const h = hash(v);
      r = table[h]!;
      table[h] = ip;
      const d = ip - r;
      if (ip >= ipLimit) break;
      ip++;
      if (d <= 0x1fff && v === u24(r)) break;
    }
    if (ip >= ipLimit) break;
    ip--;
    if (ip > a) literals(ip - a);
    const l = compare(r + 3, ip + 3, ipLimit + 9);
    match(l);
    ip = setNextHash(setNextHash(ip + l));
    a = ip;
  }
  literals(input.length - a);
  return n;
}
/**
 * OP-stack L1 data fee (Fjord FastLZ estimate) plus the Jovian operator fee (gas used × scalar × 100 + constant),
 * from L1Block storage values; this is the fee rule the pinned Anvil applies on a Base fork of this era.
 */
export function opStackFee(signedRaw: Uint8Array, gasUsed: bigint, l1Block: { readonly slot1: bigint; readonly slot3: bigint; readonly slot7: bigint; readonly slot8: bigint }): bigint {
  const baseFeeScalar = (l1Block.slot3 >> 96n) & 0xffff_ffffn;
  const blobBaseFeeScalar = (l1Block.slot3 >> 64n) & 0xffff_ffffn;
  const operatorFeeScalar = (l1Block.slot8 >> 64n) & 0xffff_ffffn;
  const operatorFeeConstant = l1Block.slot8 & 0xffff_ffff_ffff_ffffn;
  let estimatedSize = -42_585_600n + 836_500n * BigInt(flzCompressLen(signedRaw));
  if (estimatedSize < 100_000_000n) estimatedSize = 100_000_000n;
  const l1FeeScaled = baseFeeScalar * l1Block.slot1 * 16n + blobBaseFeeScalar * l1Block.slot7;
  return estimatedSize * l1FeeScaled / 1_000_000_000_000n + gasUsed * operatorFeeScalar * 100n + operatorFeeConstant;
}
const FORK_REF = 'eip155:31337';
const text = new TextEncoder();

function fail(code: string): never { throw new Error(code); }
const isHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const isAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) fail('FORK_RESPONSE_INVALID');
  return BigInt(value);
};
const hex = (value: bigint): string => `0x${value.toString(16)}`;
const word = (value: bigint): string => value.toString(16).padStart(64, '0');
const addressWord = (value: string): string => value.slice(2).padStart(64, '0');
const sha256Hex = (bytes: Uint8Array | string): string => `0x${createHash('sha256').update(bytes).digest('hex')}`;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('FORK_RESPONSE_INVALID');
  return value as Record<string, unknown>;
};
const artifactHash = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown): string =>
  hashArtifactBytes(kind, text.encode(JSON.stringify(value)));
const isoFromSeconds = (seconds: bigint): string => new Date(Number(seconds) * 1000).toISOString();

/** Strict profile parser; a FORK_REPRODUCED profile never carries a substitute pin set. */
export function parseModeAProfile(input: unknown): ModeAProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('MODE_A_PROFILE_INVALID');
  const value = input as Record<string, unknown>;
  const keys = ['format', 'environment', 'rpcUrl', 'sourceChainId', 'sourceBlockNumber', 'sourceBlockHash',
    'stateSourceHash', 'owner', 'syntheticCodePins'];
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) fail('MODE_A_PROFILE_INVALID');
  const url = typeof value.rpcUrl === 'string' ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value.rpcUrl) : null;
  if (value.format !== 'gryloo.mode-a-fork-profile.v1' || (value.environment !== 'FORK_REPRODUCED' && value.environment !== 'MOCKED')
    || !url || Number(url[1]) > 65535 || value.sourceChainId !== SOURCE_CHAIN_ID
    || typeof value.sourceBlockNumber !== 'number' || !Number.isSafeInteger(value.sourceBlockNumber) || value.sourceBlockNumber < 0
    || !isHash(value.sourceBlockHash) || !isHash(value.stateSourceHash) || !isAddress(value.owner)) fail('MODE_A_PROFILE_INVALID');
  let pins: CodePinSet | null = null;
  if (value.environment === 'MOCKED') {
    const raw = value.syntheticCodePins as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('MODE_A_PROFILE_INVALID');
    if (Object.keys(raw).sort().join() !== 'factory,quoter,usdc,weth'
      || !['usdc', 'weth', 'factory', 'quoter'].every(key => isHash(raw[key]))) fail('MODE_A_PROFILE_INVALID');
    pins = { usdc: raw.usdc as string, weth: raw.weth as string, factory: raw.factory as string, quoter: raw.quoter as string };
    for (const key of ['usdc', 'weth', 'factory', 'quoter'] as const) if (pins[key] === BASE_CODE_PINS[key]) fail('MODE_A_PROFILE_INVALID');
  } else {
    if (value.syntheticCodePins !== null) fail('MODE_A_PROFILE_INVALID');
    if (ANVIL_DEFAULT_ACCOUNTS.has(value.owner as string)) fail('MODE_A_DEFAULT_ACCOUNT_REFUSED');
  }
  return Object.freeze({ format: 'gryloo.mode-a-fork-profile.v1', environment: value.environment, rpcUrl: value.rpcUrl as string,
    sourceChainId: SOURCE_CHAIN_ID, sourceBlockNumber: value.sourceBlockNumber, sourceBlockHash: value.sourceBlockHash as string,
    stateSourceHash: value.stateSourceHash as string, owner: value.owner as string, syntheticCodePins: pins });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function profileHash(profile: ModeAProfile): string {
  return sha256Hex(canonical(profile));
}

/**
 * The exact workflow shape Mode A may execute: one USDC/WETH swap. Mock nodes carry no financial meaning
 * and are excluded from execution, exactly as in the mocked chain; none may connect to the swap.
 */
export function modeASwapFromWorkflow(workflow: SemanticWorkflow): {
  readonly nodeId: string; readonly direction: Direction; readonly amountIn: bigint; readonly slippageBps: number;
  readonly excludedMockNodes: readonly string[];
} {
  if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.resourceEdges)) fail('WORKFLOW_NOT_ELIGIBLE');
  const swaps = workflow.nodes.filter(item => item.actionType === SWAP_ACTION);
  const others = workflow.nodes.filter(item => item.actionType !== SWAP_ACTION);
  if (swaps.length !== 1 || others.some(item => !/^mock-[a-z]+$/.test(item.actionType) || item.chainId !== 'mock:local')) fail('WORKFLOW_NOT_ELIGIBLE');
  const node = swaps[0]!;
  if (node.chainId !== 'eip155:8453' || node.dependencies.length !== 0
    || others.some(item => item.dependencies.includes(node.nodeId))
    || workflow.resourceEdges.some(edge => JSON.stringify(edge).includes(`"${node.nodeId}"`))) fail('WORKFLOW_NOT_ELIGIBLE');
  const amount = node.inputs.find(input => input.name === 'amount-in');
  const out = node.inputs.find(input => input.name === 'asset-out');
  const slippage = node.userConstraints.filter(constraint => constraint.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET' || slippage.length !== 1 || slippage[0]?.kind !== 'MAXIMUM_SLIPPAGE_BPS') fail('WORKFLOW_NOT_ELIGIBLE');
  const tokenIn = 'address' in amount.value.asset ? amount.value.asset.address : null;
  const tokenOut = 'address' in out.value ? out.value.address : null;
  const direction: Direction | null = tokenIn === TOKENS.WETH.address && tokenOut === TOKENS.USDC.address ? 'WETH_TO_USDC'
    : tokenIn === TOKENS.USDC.address && tokenOut === TOKENS.WETH.address ? 'USDC_TO_WETH' : null;
  if (!direction || !/^[1-9][0-9]{0,77}$/.test(amount.value.amount)) fail('WORKFLOW_NOT_ELIGIBLE');
  const bps = slippage[0].maximumBps;
  if (!Number.isInteger(bps) || bps < 0 || bps > 300) fail('SLIPPAGE_NOT_ELIGIBLE');
  return { nodeId: node.nodeId, direction, amountIn: BigInt(amount.value.amount), slippageBps: bps,
    excludedMockNodes: others.map(item => item.nodeId).sort() };
}

export function decodePayloadView(bytes: Uint8Array): DecodedPayload {
  const payload = decodeUnsignedPayload(bytes);
  const selector = toHex(payload.data.subarray(0, 4));
  let approve: DecodedPayload['approve'];
  let swap: DecodedPayload['swap'] = null;
  try { const value = decodeApprove(payload.data); approve = { spender: value.spender, amount: value.amount.toString() }; } catch { approve = null; }
  if (!approve) {
    try {
      const value = decodeSwap(payload.data);
      swap = { tokenIn: value.tokenIn, tokenOut: value.tokenOut, fee: value.fee, recipient: value.recipient,
        amountIn: value.amountIn.toString(), amountOutMinimum: value.amountOutMinimum.toString(),
        sqrtPriceLimitX96: value.sqrtPriceLimitX96.toString(), deadline: value.deadline.toString() };
    } catch { swap = null; }
  }
  return { chainId: FORK_CHAIN_ID, nonce: payload.nonce.toString(), to: payload.to, value: '0',
    gasLimit: payload.gasLimit.toString(), maxFeePerGas: payload.maxFeePerGas.toString(),
    maxPriorityFeePerGas: payload.maxPriorityFeePerGas.toString(), functionSelector: selector, approve, swap };
}
/** The EIP-1193 request is derived field by field from the reviewed bytes only. */
export function walletRequestFor(bytes: Uint8Array, owner: string): WalletRequest {
  const payload = decodeUnsignedPayload(bytes);
  return { from: owner, to: payload.to, nonce: hex(payload.nonce), gas: hex(payload.gasLimit),
    maxFeePerGas: hex(payload.maxFeePerGas), maxPriorityFeePerGas: hex(payload.maxPriorityFeePerGas), value: '0x0',
    data: toHex(payload.data), chainId: FORK_CHAIN_ID_HEX, type: '0x2' };
}
function payloadView(stepId: StepId, bytes: Uint8Array, owner: string): PayloadView {
  return { stepId, bytes: toHex(bytes), payloadHash: payloadIdentity(bytes).payloadHash,
    decoded: decodePayloadView(bytes), request: walletRequestFor(bytes, owner) };
}

/** Append-only hash-chained JSON snapshots, written through the executor's fsynced file store. */
function snapshotValidate(bytes: Uint8Array): void {
  const content = Buffer.from(bytes).toString('utf8');
  if (!content.endsWith('\n')) fail('JOURNAL_CORRUPT');
  let previous: string | null = null;
  let expected = 0;
  for (const line of content.trimEnd().split('\n')) {
    const item = JSON.parse(line) as { sequence: number; previous: string | null; value: unknown; digest: string };
    if (item.sequence !== expected++ || item.previous !== previous
      || item.digest !== sha256Hex(JSON.stringify({ sequence: item.sequence, previous: item.previous, value: item.value }))) fail('JOURNAL_CORRUPT');
    previous = item.digest;
  }
}
async function readOptional(path: string): Promise<Uint8Array | null> {
  try { return await readFile(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    fail('JOURNAL_CORRUPT');
  }
}
function snapshotStore<T>(path: string) {
  const raw = async (): Promise<Uint8Array> => {
    if (await readOptional(path) === null) return new Uint8Array();
    return readValidatedFile(path, snapshotValidate);
  };
  return {
    read: async (fallback: T): Promise<T> => {
      const bytes = await raw();
      if (!bytes.length) return fallback;
      return (JSON.parse(Buffer.from(bytes).toString('utf8').trimEnd().split('\n').at(-1)!) as { value: T }).value;
    },
    history: async (): Promise<T[]> => {
      const bytes = await raw();
      if (!bytes.length) return [];
      return Buffer.from(bytes).toString('utf8').trimEnd().split('\n').map(line => (JSON.parse(line) as { value: T }).value);
    },
    write: async (value: T): Promise<void> => {
      const prior = await raw();
      const lines = prior.length ? Buffer.from(prior).toString('utf8').trimEnd().split('\n') : [];
      const previous = lines.length ? (JSON.parse(lines.at(-1)!) as { digest: string }).digest : null;
      const item = { sequence: lines.length, previous, value };
      const next = `${Buffer.from(prior).toString('utf8')}${JSON.stringify({ ...item, digest: sha256Hex(JSON.stringify(item)) })}\n`;
      await writeExtendingFile(path, text.encode(next), snapshotValidate);
    },
  };
}
function onceValidate(format: string) {
  return (bytes: Uint8Array): void => {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as { format?: unknown };
    if (value.format !== format) fail('JOURNAL_CORRUPT');
  };
}
async function writeOnce(path: string, value: { readonly format: string }): Promise<void> {
  if (await readOptional(path) !== null) fail('JOURNAL_RECORD_EXISTS');
  await writeExtendingFile(path, text.encode(`${JSON.stringify(value)}\n`), onceValidate(value.format));
}
async function readOnce<T>(path: string, format: string): Promise<T> {
  return JSON.parse(Buffer.from(await readValidatedFile(path, onceValidate(format))).toString('utf8')) as T;
}

type Head = { readonly number: number; readonly hash: string; readonly timestamp: bigint; readonly baseFeePerGas: bigint };
type AccountState = { readonly input: bigint; readonly output: bigint; readonly eth: bigint; readonly allowance: bigint;
  readonly nonce: bigint; readonly routerInputResidue: bigint; readonly routerOutputResidue: bigint };

export type ModeAServiceOptions = {
  readonly call: ForkCall;
  readonly profile: ModeAProfile;
  readonly journalDir: string;
  /** ISO-8601 millisecond timestamps for journal and evidence records. */
  readonly clock: () => Promise<string>;
};

export function createModeAService(options: ModeAServiceOptions) {
  const { call, profile, journalDir, clock } = options;
  const lanes = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const prior = lanes.get(key) ?? Promise.resolve();
    const result = prior.then(action, action);
    lanes.set(key, result.then(() => undefined, () => undefined));
    return result;
  }
  const directory = (executionId: string): string => {
    if (!/^(exec|revoke)-[0-9a-f]{24}$/.test(executionId)) fail('EXECUTION_ID_INVALID');
    return join(journalDir, executionId);
  };
  const stores = (executionId: string) => ({
    attempts: snapshotStore<Attempt[]>(join(directory(executionId), 'attempts.jsonl')),
    observations: snapshotStore<StepObservation[]>(join(directory(executionId), 'observations.jsonl')),
    evidence: snapshotStore<EvidenceRecord[]>(join(directory(executionId), 'evidence.jsonl')),
  });

  async function head(): Promise<Head> {
    const block = record(await call('eth_getBlockByNumber', ['latest', false]));
    if (!isHash(block.hash)) fail('FORK_RESPONSE_INVALID');
    return { number: Number(quantity(block.number)), hash: block.hash, timestamp: quantity(block.timestamp),
      baseFeePerGas: quantity(block.baseFeePerGas) };
  }
  /** Chain, source N/H and owner-code boundary; checked before every compile and wallet request. */
  async function requireForkBoundary(): Promise<void> {
    if (await call('eth_chainId') !== FORK_CHAIN_ID_HEX) fail('FORK_CHAIN_MISMATCH');
    const metadata = record(await call('anvil_metadata'));
    const fork = record(metadata.forkedNetwork);
    if (Number(fork.chainId) !== SOURCE_CHAIN_ID || Number(fork.forkBlockNumber) !== profile.sourceBlockNumber
      || fork.forkBlockHash !== profile.sourceBlockHash) fail('FORK_SOURCE_MISMATCH');
  }
  const ethCall = (to: string, data: string, at: unknown): Promise<unknown> => call('eth_call', [{ to, data }, at]);
  function decodeSymbol(value: unknown): string {
    if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(value)) fail('TOKEN_METADATA_INVALID');
    const bytes = Buffer.from(value.slice(2), 'hex');
    if (bytes.length < 64) fail('TOKEN_METADATA_INVALID');
    const start = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
    if (start + 32 > bytes.length) fail('TOKEN_METADATA_INVALID');
    const size = Number(BigInt(`0x${bytes.subarray(start, start + 32).toString('hex')}`));
    if (size < 1 || size > 32 || start + 32 + size > bytes.length) fail('TOKEN_METADATA_INVALID');
    return bytes.subarray(start + 32, start + 32 + size).toString('utf8');
  }
  /** Fixed read order of §3.4; each exchange is kept for the quote's raw-response digest. */
  async function collectFacts(owner: string, tokenIn: string, tokenOut: string, amountIn: bigint, exchanges: unknown[]): Promise<ForkQuoteFacts> {
    const logged = async (method: string, params: readonly unknown[]): Promise<unknown> => {
      const result = await call(method, params);
      exchanges.push({ method, params, result });
      return result;
    };
    const transport = async (query: ForkQuoteQuery): Promise<unknown> => {
      if (query.kind === 'CHAIN') return Number(quantity(await logged('eth_chainId', [])));
      if (query.kind === 'METADATA') {
        // Only the verified source identity enters the raw record; Anvil's instance fields are process-local.
        const data = record(await call('anvil_metadata', []));
        const fork = record(data.forkedNetwork);
        const source = { chainId: Number(fork.chainId), forkBlockNumber: Number(fork.forkBlockNumber), forkBlockHash: fork.forkBlockHash };
        exchanges.push({ method: 'anvil_metadata', params: [], result: { forkedNetwork: source } });
        return { sourceChainId: source.chainId, sourceBlockHash: source.forkBlockHash };
      }
      if (query.kind === 'LATEST') {
        const block = record(await logged('eth_getBlockByNumber', ['latest', false]));
        return { number: Number(quantity(block.number)), hash: block.hash, timestamp: quantity(block.timestamp) };
      }
      if (query.kind === 'TAIL') {
        const block = record(await logged('eth_getBlockByNumber', [hex(BigInt(query.blockNumber)), false]));
        return { hash: block.hash, timestamp: quantity(block.timestamp) };
      }
      const at = { blockHash: query.blockHash, requireCanonical: true };
      const read = (to: string, data: string) => logged('eth_call', [{ to, data }, at]);
      if (query.kind === 'CODE') {
        const code = await logged('eth_getCode', [query.address, at]);
        if (typeof code !== 'string') fail('FORK_RESPONSE_INVALID');
        return sha256Hex(Buffer.from(code.slice(2), 'hex'));
      }
      if (query.kind === 'TOKEN_METADATA') return {
        decimals: Number(BigInt(normalizeWord(await read(query.address, '0x313ce567')))),
        symbol: decodeSymbol(await read(query.address, '0x95d89b41')),
      };
      if (query.kind === 'DEPLOYMENT') return {
        factory: `0x${String(await read(query.address, '0xc45a0155')).slice(-40)}`,
        weth9: `0x${String(await read(query.address, '0x4aa4a4fc')).slice(-40)}`,
      };
      if (query.kind === 'POOL') {
        const result = await read(FORK_CONTRACTS.factory, `0x1698ee82${addressWord(query.tokenIn)}${addressWord(query.tokenOut)}${word(BigInt(query.fee))}`);
        const pool = `0x${String(result).slice(-40)}`;
        return pool === `0x${'00'.repeat(20)}` ? null : pool;
      }
      if (query.kind === 'QUOTE') {
        let result: unknown;
        try {
          result = await read(FORK_CONTRACTS.quoter,
            `0xc6a5026a${addressWord(query.tokenIn)}${addressWord(query.tokenOut)}${word(query.amountIn)}${word(BigInt(query.fee))}${word(0n)}`);
        } catch (error) {
          if (/execution reverted|revert/i.test(String(error)) && !String(error).includes('FORK_STATE_UNRECORDED')) return null;
          throw error;
        }
        if (typeof result !== 'string' || !/^0x[0-9a-f]{256,}$/.test(result)) fail('QUOTE_INVALID');
        return { amountOut: BigInt(`0x${result.slice(2, 66)}`), sqrtPriceX96After: BigInt(`0x${result.slice(66, 130)}`) };
      }
      if (query.kind === 'ACCOUNT') return {
        inputBalance: BigInt(normalizeWord(await read(query.tokenIn, `0x70a08231${addressWord(query.owner)}`))),
        ethBalance: quantity(await logged('eth_getBalance', [query.owner, at])),
        allowance: BigInt(normalizeWord(await read(query.tokenIn, `0xdd62ed3e${addressWord(query.owner)}${addressWord(SWAP_ROUTER_02)}`))),
        nonce: quantity(await logged('eth_getTransactionCount', [query.owner, at])),
        code: await logged('eth_getCode', [query.owner, at]),
      };
      fail('FORK_QUERY_INVALID');
    };
    const routerCode = await logged('eth_getCode', [FORK_CONTRACTS.router, 'latest']);
    if (typeof routerCode !== 'string') fail('FORK_RESPONSE_INVALID');
    return collectScriptedForkQuote(transport, { owner, tokenIn, tokenOut, amountIn, selectedFee: null,
      reviewedRouterCodeHash: sha256Hex(Buffer.from(routerCode.slice(2), 'hex')) });
  }
  function normalizeWord(value: unknown): string {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) fail('FORK_RESPONSE_INVALID');
    return value;
  }
  /** MOCKED only: the reviewed synthetic digests stand in for the Base pins; FORK_REPRODUCED never maps. */
  function pinnedFacts(facts: ForkQuoteFacts): ForkQuoteFacts {
    if (profile.environment === 'FORK_REPRODUCED') return facts;
    const pins = profile.syntheticCodePins ?? fail('MODE_A_PROFILE_INVALID');
    const mapped = { ...facts.codeHashes } as Record<keyof typeof BASE_CODE_PINS | 'router', string>;
    for (const name of ['usdc', 'weth', 'factory', 'quoter'] as const) {
      if (facts.codeHashes[name] !== pins[name]) fail('CODE_DIGEST_MISMATCH');
      mapped[name] = BASE_CODE_PINS[name];
    }
    return { ...facts, codeHashes: mapped };
  }

  /** eth_simulateV1 with validation: approval, swap and a trailing allowance read at the quote block. */
  function simulationTransport(owner: string, tokenIn: string, tokenOut: string, blockHash: string, raw: { last: string; approveGasUsed: bigint; swapGasUsed: bigint }) {
    return async (request: { readonly calls: readonly [Uint8Array, Uint8Array] }): Promise<ExactSimulation> => {
      const approve = decodeUnsignedPayload(request.calls[0]);
      const swap = decodeUnsignedPayload(request.calls[1]);
      const tx = (payload: UnsignedPayload) => ({ from: owner, to: payload.to, nonce: hex(payload.nonce), gas: hex(payload.gasLimit),
        maxFeePerGas: hex(payload.maxFeePerGas), maxPriorityFeePerGas: hex(payload.maxPriorityFeePerGas), value: '0x0', data: toHex(payload.data) });
      const allowanceRead = { from: owner, to: tokenIn, nonce: hex(swap.nonce + 1n), gas: hex(100_000n),
        maxFeePerGas: hex(swap.maxFeePerGas), maxPriorityFeePerGas: hex(swap.maxPriorityFeePerGas), value: '0x0',
        data: `0xdd62ed3e${addressWord(owner)}${addressWord(SWAP_ROUTER_02)}` };
      const result = await call('eth_simulateV1', [{ blockStateCalls: [{ calls: [tx(approve), tx(swap), allowanceRead] }],
        validation: true, traceTransfers: false, returnFullTransactions: false }, { blockHash, requireCanonical: true }]);
      raw.last = JSON.stringify(result);
      if (!Array.isArray(result) || result.length !== 1) fail('SIMULATION_SHAPE_INVALID');
      const calls = record(result[0]).calls;
      if (!Array.isArray(calls) || calls.length !== 3) fail('SIMULATION_SHAPE_INVALID');
      const [approveCall, swapCall, allowanceCall] = calls.map(record) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
      const status = (entry: Record<string, unknown>) => entry.status === '0x1' ? 'SUCCESS' as const : 'REVERTED' as const;
      const logs = (entry: Record<string, unknown>) => (Array.isArray(entry.logs) ? entry.logs : []).map(record)
        .map(log => ({ address: String(log.address).toLowerCase(), topics: (log.topics as string[]).map(topic => topic.toLowerCase()), data: String(log.data).toLowerCase() }));
      const ownerTopic = `0x${addressWord(owner)}`;
      const sum = (entries: { address: string; topics: string[]; data: string }[], token: string, from: string | null, to: string | null) =>
        entries.filter(log => log.address === token && log.topics[0] === TRANSFER_TOPIC && log.topics.length === 3
          && (from === null || log.topics[1] === from) && (to === null || log.topics[2] === to))
          .reduce((total, log) => total + BigInt(log.data), 0n);
      const swapLogs = logs(swapCall);
      const approvalLog = logs(approveCall).find(log => log.address === tokenIn && log.topics[0] === APPROVAL_TOPIC
        && log.topics[1] === ownerTopic && log.topics[2] === `0x${addressWord(SWAP_ROUTER_02)}`);
      const allowanceAfterSwap = status(allowanceCall) === 'SUCCESS' ? BigInt(normalizeWord(allowanceCall.returnData)) : MAX_UINT;
      raw.approveGasUsed = quantity(approveCall.gasUsed);
      raw.swapGasUsed = quantity(swapCall.gasUsed);
      return {
        approval: { status: status(approveCall), gasUsed: quantity(approveCall.gasUsed), gasLimit: approve.gasLimit, revertReason: null },
        swap: { status: status(swapCall), gasUsed: quantity(swapCall.gasUsed), gasLimit: swap.gasLimit, revertReason: null },
        decodedAmountOut: status(swapCall) === 'SUCCESS' ? multicallAmountOut(swapCall.returnData) : 0n,
        ownerTransferAmountOut: sum(swapLogs, tokenOut, null, ownerTopic),
        inputDebited: sum(swapLogs, tokenIn, ownerTopic, null),
        allowanceAfterSwap,
        residualAllowanceIfSwapFails: approvalLog ? BigInt(approvalLog.data) : 0n,
        stateOverrides: [], validation: true,
      };
    };
  }
  function multicallAmountOut(value: unknown): bigint {
    // multicall(uint256,bytes[]) returns bytes[] holding one 32-byte exactInputSingle result.
    if (typeof value !== 'string' || !/^0x[0-9a-f]{320}$/.test(value)) fail('SIMULATION_RETURN_INVALID');
    const words = Array.from({ length: 5 }, (_, index) => BigInt(`0x${value.slice(2 + index * 64, 66 + index * 64)}`));
    if (words[0] !== 0x20n || words[1] !== 1n || words[2] !== 0x20n || words[3] !== 0x20n) fail('SIMULATION_RETURN_INVALID');
    return words[4]!;
  }

  async function prepare(input: { readonly workflow: SemanticWorkflow }): Promise<PreparedExecution> {
    const swap = modeASwapFromWorkflow(input.workflow);
    const workflow = validateArtifact('semantic-workflow', input.workflow);
    const semanticWorkflowHash = artifactHash('semantic-workflow', workflow);
    const symbolIn = swap.direction === 'WETH_TO_USDC' ? 'WETH' as const : 'USDC' as const;
    const symbolOut = symbolIn === 'WETH' ? 'USDC' as const : 'WETH' as const;
    const tokenIn = TOKENS[symbolIn].address, tokenOut = TOKENS[symbolOut].address;
    const owner = profile.owner;
    await requireForkBoundary();
    const exchanges: unknown[] = [];
    const rawFacts = await collectFacts(owner, tokenIn, tokenOut, swap.amountIn, exchanges);
    const best = rawFacts.tiers.filter(row => row.status === 'QUOTED' && row.amountOut !== null)
      .sort((a, b) => a.amountOut === b.amountOut ? a.fee - b.fee : (a.amountOut! > b.amountOut! ? -1 : 1))[0];
    if (!best) fail('NO_QUOTED_TIER');
    const facts = { ...rawFacts, selectedFee: best.fee };
    if (facts.sourceBlockHash !== profile.sourceBlockHash) fail('FORK_SOURCE_MISMATCH');
    const quote = validateForkQuote(pinnedFacts(facts), facts.block.timestamp, swap.amountIn, swap.slippageBps);
    const current = await head();
    if (current.hash !== facts.block.hash) fail('FORK_HEAD_MOVED');
    const maxFeePerGas = 2n * current.baseFeePerGas + PRIORITY_FEE;
    const deadline = facts.block.timestamp + DEADLINE_SECONDS;
    const pairContext = { owner, tokenIn, tokenOut, amountIn: swap.amountIn, amountOutMinimum: quote.minimumOut,
      fee: quote.fee, deadline, nonce: facts.ownerNonce };
    const initial = buildModeAPair({ ...pairContext, approveGasLimit: INITIAL_APPROVE_GAS, swapGasLimit: INITIAL_SWAP_GAS, maxFeePerGas });
    const raw = { last: '', approveGasUsed: 0n, swapGasUsed: 0n };
    const simulated = await runScriptedExactSimulation(simulationTransport(owner, tokenIn, tokenOut, facts.block.hash, raw),
      initial.approveBytes, initial.swapBytes, pairContext, quote.amountOut);
    const simulationRawHash = hashRawBytes('raw-response', text.encode(raw.last));
    const quoteRaw = text.encode(JSON.stringify(exchanges, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value));
    const quoteRawHash = hashRawBytes('raw-response', quoteRaw);
    const revision = workflow.revision;
    const assetIn = { chainId: FORK_REF, address: tokenIn, decimals: TOKENS[symbolIn].decimals };
    const assetOut = { chainId: FORK_REF, address: tokenOut, decimals: TOKENS[symbolOut].decimals };
    const observedAt = isoFromSeconds(facts.block.timestamp);
    const freshness = { observedAt, expiresAt: isoFromSeconds(quote.expiresAt), maximumAgeSeconds: Number(QUOTE_VALIDITY_SECONDS) };
    const environmentUncertainty = profile.environment === 'MOCKED'
      ? [{ code: 'MOCKED_SYNTHETIC_CONTRACTS', description: 'MOCKED: synthetic local contracts stand in for Base code; this is engineering evidence only, never fork evidence.' }]
      : [{ code: 'FORK_REPRODUCED_NOT_MAINNET', description: 'Recorded finalized Base state replayed on local chain 31337. No public-chain effect.' }];
    const uncertainty = [...environmentUncertainty,
      { code: 'NOT_CURRENT_MARKET', description: 'State is pinned to one historical source block; current markets differ.' },
      { code: 'SINGLE_PROVIDER_STATE_SOURCE', description: 'Source state came from one provider recording and is not cross-checked.' },
      { code: 'USD_VALUES_NOT_MODELED', description: 'USD values: not modeled.' },
      { code: 'CODE_PINS_TRUST_ON_FIRST_USE', description: 'Code digests detect changes but do not prove authenticity.' }];
    const quoteArtifact = validateArtifact('quote-state-artifact', {
      schemaVersion: '1.0.0', artifactId: `FORK.quote.${swap.nodeId}.r${revision}.b${facts.block.number}`,
      semanticWorkflowHash, nodeId: swap.nodeId, sourceId: 'fork.anvil-31337', adapter: { id: 'fork.uniswap-v3-quoter-v2', version: '1.0.0' },
      chainId: FORK_REF, chainPosition: { kind: 'BLOCK', height: facts.block.number }, retrievedAt: observedAt, freshness,
      rawResponseHash: quoteRawHash,
      normalizedValues: [
        { name: 'evidence-environment', kind: 'IDENTIFIER', value: profile.environment },
        { name: 'source-block-number', kind: 'INTEGER', value: profile.sourceBlockNumber },
        { name: 'source-block-hash', kind: 'IDENTIFIER', value: profile.sourceBlockHash },
        { name: 'fork-block-hash', kind: 'IDENTIFIER', value: facts.block.hash },
        { name: 'amount-in', kind: 'QUANTITY', value: { asset: assetIn, amount: swap.amountIn.toString() } },
        { name: 'asset-out', kind: 'ASSET', value: assetOut },
        { name: 'selected-fee', kind: 'INTEGER', value: quote.fee },
        ...(['usdc', 'weth', 'factory', 'quoter', 'router'] as const).map(name => ({ name: `code-sha256.${name}`, kind: 'IDENTIFIER' as const, value: facts.codeHashes[name] })),
        ...facts.tiers.flatMap(tier => [
          { name: `tier-${tier.fee}.status`, kind: 'IDENTIFIER' as const, value: tier.status },
          ...(tier.amountOut === null ? [] : [{ name: `tier-${tier.fee}.quoted-output`, kind: 'QUANTITY' as const, value: { asset: assetOut, amount: tier.amountOut.toString() } }]),
        ]),
      ],
      providerReference: { kind: 'NONE' },
      proposedContracts: [{ chainId: FORK_REF, address: tokenIn, version: 'reviewed-code-pin' }, { chainId: FORK_REF, address: SWAP_ROUTER_02, version: 'reviewed-code-pin' }],
      proposedSpenders: [{ chainId: FORK_REF, address: SWAP_ROUTER_02 }], proposedRecipients: [{ chainId: FORK_REF, address: owner }],
      fees: [], gas: [], outputBounds: [{ outputId: 'amount-out', expected: { asset: assetOut, amount: quote.amountOut.toString() },
        minimum: { asset: assetOut, amount: quote.minimumOut.toString() }, adverse: { asset: assetOut, amount: quote.minimumOut.toString() } }],
      uncertainty, registryValidation: { registryVersion: '1.0.0', actionType: SWAP_ACTION, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' },
    });
    const quoteHash = artifactHash('quote-state-artifact', quoteArtifact);
    const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: `FORK.artifact-set.r${revision}.b${facts.block.number}`,
      semanticWorkflowHash, artifacts: [{ artifactId: quoteArtifact.artifactId, nodeId: swap.nodeId, artifactHash: quoteHash }] });
    const artifactSetHash = artifactHash('artifact-set', artifactSet);
    const simulation = validateArtifact('simulation-bundle', {
      schemaVersion: '1.0.0', simulationId: `FORK.simulation.r${revision}.b${facts.block.number}`, semanticWorkflowRevision: revision,
      semanticWorkflowHash, artifactSetHash, adapters: [{ id: 'uniswap-v3.swap-router-02', version: '1.0.0' }],
      contracts: [{ chainId: FORK_REF, address: tokenIn, version: 'reviewed-code-pin' }, { chainId: FORK_REF, address: SWAP_ROUTER_02, version: 'reviewed-code-pin' }],
      outputs: [{ nodeId: swap.nodeId, outputId: 'amount-out', expected: { asset: assetOut, amount: quote.amountOut.toString() },
        minimum: { asset: assetOut, amount: quote.minimumOut.toString() }, adverse: { asset: assetOut, amount: quote.minimumOut.toString() } }],
      propagatedOutputs: [],
      failurePaths: [{ failedNodeId: swap.nodeId, blockedNodeIds: [], residualAssets: [{ asset: assetIn, amount: swap.amountIn.toString() }] }],
      uncertainty,
      unsupportedAssumptions: ['Exact two-pass eth_simulateV1 with validation at the quote block; later blocks can differ.',
        'A reverted swap leaves the finite router allowance in place until a separate revocation.',
        ...(swap.excludedMockNodes.length ? [`Mock nodes excluded from execution: ${swap.excludedMockNodes.join(', ')}.`] : [])],
      freshness,
    });
    const simulationHash = artifactHash('simulation-bundle', simulation);
    const context: CompileContext = { nodeId: swap.nodeId, revision, forkBlock: facts.block.number, semanticWorkflowHash,
      artifactSetHash, simulationHash, owner, tokenIn, tokenOut, tokenInDecimals: TOKENS[symbolIn].decimals,
      tokenOutDecimals: TOKENS[symbolOut].decimals, amountIn: swap.amountIn, quotedOut: quote.amountOut, minimumOut: quote.minimumOut,
      slippageBps: swap.slippageBps, fee: quote.fee, nonce: facts.ownerNonce, deadline,
      approveGasLimit: simulated.result.approveGasLimit, swapGasLimit: simulated.result.swapGasLimit, maxFeePerGas };
    const { policy, policyHash } = compilePolicy(context);
    const { manifest, manifestHash, executionId } = compileManifest(context, policy, policyHash);
    const { plan, executionPlanHash } = compileExecutionPlan(context, manifestHash, simulated.approveBytes, simulated.swapBytes);
    const { matrix, enforcementMatrixHash } = compileEnforcementMatrix(context,
      { sourceBlock: { height: profile.sourceBlockNumber, hash: profile.sourceBlockHash }, stateSourceHash: profile.stateSourceHash,
        simulationRawHash }, { policyHash, manifestHash, executionPlanHash }, simulated.approveBytes, simulated.swapBytes);
    const approvePayloadHash = payloadIdentity(simulated.approveBytes).payloadHash;
    const swapPayloadHash = payloadIdentity(simulated.swapBytes).payloadHash;
    const findings = reviewModeAPayloads({ context, approveBytes: simulated.approveBytes, swapBytes: simulated.swapBytes,
      approvePayloadHash, swapPayloadHash, currentForkQuote: true, lintBlocks: [], warnings: [], acknowledgedWarnings: [] });
    if (findings.some(item => item.severity === 'BLOCK')) fail(`REVIEW_BLOCKED:${findings.map(item => item.code).join(',')}`);
    const prepared: PreparedExecution = {
      format: 'gryloo.mode-a-prepared.v1', executionId, environment: profile.environment, profileHash: profileHash(profile),
      preparedAt: await clock(), owner, direction: swap.direction, nodeId: swap.nodeId, revision, excludedMockNodes: swap.excludedMockNodes,
      tokenIn, tokenOut, symbolIn, symbolOut,
      decimalsIn: TOKENS[symbolIn].decimals, decimalsOut: TOKENS[symbolOut].decimals, amountIn: swap.amountIn.toString(),
      quotedOut: quote.amountOut.toString(), minimumOut: quote.minimumOut.toString(), slippageBps: swap.slippageBps, fee: quote.fee,
      nonce: facts.ownerNonce.toString(), deadline: deadline.toString(), maxFeePerGas: maxFeePerGas.toString(),
      source: { chainId: SOURCE_CHAIN_ID, blockNumber: profile.sourceBlockNumber, blockHash: profile.sourceBlockHash, stateSourceHash: profile.stateSourceHash },
      quoteBlock: { number: facts.block.number, hash: facts.block.hash, timestamp: facts.block.timestamp.toString() },
      quoteExpiresAt: quote.expiresAt.toString(),
      tiers: facts.tiers.map(tier => ({ fee: tier.fee, status: tier.status, pool: tier.pool, amountOut: tier.amountOut === null ? null : tier.amountOut.toString() })),
      codeHashes: { ...facts.codeHashes },
      simulation: { approveGasUsed: raw.approveGasUsed.toString(), swapGasUsed: raw.swapGasUsed.toString(),
        approveGasLimit: simulated.result.approveGasLimit.toString(), swapGasLimit: simulated.result.swapGasLimit.toString(),
        allowanceAfterSwap: '0', residualAllowanceOnSwapFailure: simulated.result.residualAllowanceOnSwapFailure.toString() },
      workflow, artifacts: { quote: quoteArtifact, artifactSet, simulation, policy, manifest, plan, matrix },
      hashes: { semanticWorkflowHash, quoteHash, artifactSetHash, simulationHash, simulationRawHash, quoteRawHash, policyHash,
        manifestHash, executionPlanHash, enforcementMatrixHash },
      payloads: [payloadView('step-approve', simulated.approveBytes, owner), payloadView('step-swap', simulated.swapBytes, owner)],
      findings,
    };
    await serial(executionId, async () => {
      const path = join(directory(executionId), 'prepared.json');
      const existing = await readOptional(path);
      // The same inputs at the same fork state compile to the same identity; reuse is idempotent only when byte-equal.
      if (existing !== null) {
        const prior = await readOnce<PreparedExecution>(path, 'gryloo.mode-a-prepared.v1');
        if (JSON.stringify({ ...prior, preparedAt: null }) !== JSON.stringify({ ...prepared, preparedAt: null })) fail('EXECUTION_ID_CONFLICT');
        return;
      }
      await writeOnce(path, prepared);
    });
    return loadPrepared(executionId);
  }

  async function loadPrepared(executionId: string): Promise<PreparedExecution> {
    const prepared = await readOnce<PreparedExecution>(join(directory(executionId), 'prepared.json'), 'gryloo.mode-a-prepared.v1');
    if (prepared.executionId !== executionId || prepared.environment !== profile.environment || prepared.profileHash !== profileHash(profile)) fail('JOURNAL_PROFILE_MISMATCH');
    // Recompute every payload binding from the stored bytes; a changed record freezes the execution.
    for (const view of prepared.payloads) {
      const bytes = fromHex(view.bytes);
      if (payloadIdentity(bytes).payloadHash !== view.payloadHash
        || JSON.stringify(walletRequestFor(bytes, prepared.owner)) !== JSON.stringify(view.request)) fail('JOURNAL_CORRUPT');
    }
    if (artifactHash('strategy-manifest', prepared.artifacts.manifest) !== prepared.hashes.manifestHash
      || artifactHash('execution-plan', prepared.artifacts.plan) !== prepared.hashes.executionPlanHash
      || prepared.artifacts.plan.segments[0]?.steps.map(step => 'payloadHash' in step ? step.payloadHash : null).join() !== prepared.payloads.map(view => view.payloadHash).join()) fail('JOURNAL_CORRUPT');
    return prepared;
  }
  async function loadRevocation(executionId: string): Promise<RevocationRecord | null> {
    const path = join(directory(executionId), 'revocation.json');
    if (await readOptional(path) === null) return null;
    return readOnce<RevocationRecord>(path, 'gryloo.mode-a-revocation.v1');
  }

  async function status(executionId: string): Promise<ExecutionStatus> {
    const prepared = await loadPrepared(executionId);
    const s = stores(executionId);
    return { prepared, attempts: await s.attempts.read([]), observations: await s.observations.read([]),
      evidence: await s.evidence.read([]), revocation: await loadRevocation(executionId), frozen: null };
  }
  async function list(): Promise<readonly string[]> {
    let names: string[];
    try { names = await readdir(journalDir); } catch { return []; }
    return names.filter(name => /^exec-[0-9a-f]{24}$/.test(name)).sort();
  }

  function stepBytes(prepared: PreparedExecution, revocation: RevocationRecord | null, stepId: StepId): PayloadView {
    if (stepId === 'step-revoke') return revocation?.payload ?? fail('REVOCATION_NOT_PREPARED');
    return prepared.payloads.find(view => view.stepId === stepId) ?? fail('STEP_INVALID');
  }
  const latestAttempt = (attempts: readonly Attempt[], stepId: StepId): Attempt | undefined =>
    attempts.filter(item => item.stepId === stepId).at(-1);

  /** Durable PREPARED then SUBMITTING before the browser may send any wallet request. */
  async function beginStep(executionId: string, stepId: StepId, idempotencyKey: string): Promise<{ readonly attempt: Attempt; readonly payload: PayloadView }> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) fail('IDEMPOTENCY_KEY_INVALID');
    return serial(executionId, async () => {
      const prepared = await loadPrepared(executionId);
      const revocation = await loadRevocation(executionId);
      const s = stores(executionId);
      const attempts = await s.attempts.read([]);
      const payload = stepBytes(prepared, revocation, stepId);
      const existing = attempts.find(item => item.stepId === stepId && item.idempotencyKey === idempotencyKey);
      if (existing) {
        if (existing.payloadHash !== payload.payloadHash) fail('IDEMPOTENCY_CONFLICT');
        if (existing.state !== 'SUBMITTING') fail('ATTEMPT_ALREADY_REQUESTED');
        return { attempt: existing, payload };
      }
      if (stepId === 'step-swap' && latestAttempt(attempts, 'step-approve')?.state !== 'CONFIRMED') fail('STEP_ORDER_INVALID');
      if (stepId === 'step-revoke') {
        const evidence = await s.evidence.read([]);
        if (!evidence.length || evidence.at(-1)!.residualAllowance === '0') fail('REVOCATION_NOT_REQUIRED');
      }
      // The durable journal decides first: an in-progress, unknown or exhausted step refuses before any chain read.
      const planned = { executionId, stepId, idempotencyKey, payloadHash: payload.payloadHash, preparedAtBlock: 0,
        priorStepConfirmed: stepId !== 'step-swap' || latestAttempt(attempts, 'step-approve')?.state === 'CONFIRMED' };
      prepareAttemptState(attempts, planned);
      await requireForkBoundary();
      const current = await head();
      const decoded = decodeUnsignedPayload(fromHex(payload.bytes));
      if (stepId === 'step-approve' && current.timestamp >= BigInt(prepared.quoteExpiresAt)) fail('QUOTE_EXPIRED');
      if (stepId === 'step-swap' && current.timestamp >= BigInt(prepared.deadline)) fail('DEADLINE_EXPIRED');
      const nonce = quantity(await call('eth_getTransactionCount', [prepared.owner, 'latest']));
      if (nonce !== decoded.nonce) fail('NONCE_MISMATCH');
      const code = await call('eth_getCode', [prepared.owner, 'latest']);
      if (code !== '0x') fail('OWNER_HAS_CODE');
      const preparation = prepareAttemptState(attempts, { ...planned, preparedAtBlock: current.number });
      if (preparation.kind !== 'PREPARED') fail('ATTEMPT_ALREADY_REQUESTED');
      await s.attempts.write([...attempts, preparation.attempt]);
      const submitting = transitionAttemptState(preparation.attempt, 'SUBMITTING');
      await s.attempts.write([...attempts, submitting]);
      return { attempt: submitting, payload };
    });
  }

  async function recordSubmission(executionId: string, attemptId: string, report: SubmissionReport): Promise<Attempt> {
    return serial(executionId, async () => {
      const s = stores(executionId);
      const attempts = await s.attempts.read([]);
      const index = attempts.findIndex(item => item.executionAttemptId === attemptId);
      const prior = attempts[index] ?? fail('ATTEMPT_UNKNOWN');
      if (prior.state !== 'SUBMITTING') return prior;
      let next: Attempt;
      if (report.kind === 'HASH' && isHash(report.transactionHash)) next = transitionAttemptState(prior, 'PENDING', report.transactionHash);
      else next = transitionAttemptState(prior, 'SUBMISSION_RESULT_UNKNOWN');
      await s.attempts.write(attempts.map((item, at) => at === index ? next : item));
      return next;
    });
  }

  async function observation(prepared: PreparedExecution, attempt: Attempt, payload: PayloadView, hash: string): Promise<StepObservation | null> {
    const receipt = await call('eth_getTransactionReceipt', [hash]);
    const observedAt = await clock();
    if (receipt === null) return null;
    const value = record(receipt);
    if (value.transactionHash !== hash || !isHash(value.blockHash)) {
      return { attemptId: attempt.executionAttemptId, stepId: attempt.stepId as StepId, outcome: 'INCONCLUSIVE', code: 'RECEIPT_MISMATCH',
        transactionHash: hash, blockHash: null, blockNumber: null, status: null, observedAt };
    }
    const block = record(await call('eth_getBlockByHash', [value.blockHash, false]));
    const raw = await call('eth_getRawTransactionByHash', [hash]);
    const base = { attemptId: attempt.executionAttemptId, stepId: attempt.stepId as StepId, transactionHash: hash,
      blockHash: value.blockHash, blockNumber: String(value.blockNumber), status: String(value.status), observedAt };
    if (block.hash !== value.blockHash || typeof raw !== 'string') return { ...base, outcome: 'INCONCLUSIVE', code: 'CHAIN_DATA_UNAVAILABLE' };
    try { verifySignedPayload(fromHex(raw), hash, prepared.owner, fromHex(payload.bytes)); }
    catch (error) { return { ...base, outcome: 'DIVERGENT', code: error instanceof Error ? error.message : 'PAYLOAD_FIDELITY_FAILED' }; }
    return { ...base, outcome: value.status === '0x1' ? 'CONFIRMED_NOT_RECONCILED' : 'REVERTED', code: value.status === '0x1' ? 'RECEIPT_SUCCESS' : 'RECEIPT_REVERTED' };
  }

  /** Independent read of the attempt's effect; a null lookup never means NOT_FOUND by itself. */
  async function observeStep(executionId: string, stepId: StepId): Promise<{ readonly attempt: Attempt; readonly observation: StepObservation | null }> {
    return serial(executionId, async () => {
      const prepared = await loadPrepared(executionId);
      const revocation = await loadRevocation(executionId);
      const s = stores(executionId);
      const attempts = await s.attempts.read([]);
      const attempt = latestAttempt(attempts, stepId) ?? fail('ATTEMPT_UNKNOWN');
      const payload = stepBytes(prepared, revocation, stepId);
      const index = attempts.indexOf(attempt);
      const save = async (next: Attempt, seen: StepObservation | null) => {
        await s.attempts.write(attempts.map((item, at) => at === index ? next : item));
        if (seen) await s.observations.write([...await s.observations.read([]), seen]);
        return { attempt: next, observation: seen };
      };
      if (attempt.state === 'PENDING' && attempt.transactionHash) {
        const seen = await observation(prepared, attempt, payload, attempt.transactionHash);
        if (!seen) return { attempt, observation: null };
        if (seen.outcome === 'CONFIRMED_NOT_RECONCILED') return save(transitionAttemptState(attempt, 'CONFIRMED'), seen);
        if (seen.outcome === 'REVERTED') return save(transitionAttemptState(attempt, 'REVERTED'), seen);
        return save(transitionAttemptState(attempt, 'RECONCILIATION_REQUIRED'), seen);
      }
      if (attempt.state === 'SUBMISSION_RESULT_UNKNOWN') {
        const decoded = decodeUnsignedPayload(fromHex(payload.bytes));
        const latest = await head();
        const latestNonce = quantity(await call('eth_getTransactionCount', [prepared.owner, 'latest']));
        const from = Math.max(attempt.preparedAtBlock, latest.number - MAX_SCAN_BLOCKS + 1);
        const matches: { hash: string; exactPayload: boolean; confirmed: boolean }[] = [];
        for (let number = from; number <= latest.number; number++) {
          const block = record(await call('eth_getBlockByNumber', [hex(BigInt(number)), true]));
          for (const entry of Array.isArray(block.transactions) ? block.transactions.map(record) : []) {
            if (String(entry.from).toLowerCase() !== prepared.owner || quantity(entry.nonce) !== decoded.nonce || !isHash(entry.hash)) continue;
            const raw = await call('eth_getRawTransactionByHash', [entry.hash]);
            let exact: boolean;
            try { verifySignedPayload(fromHex(String(raw)), entry.hash, prepared.owner, fromHex(payload.bytes)); exact = true; } catch { exact = false; }
            matches.push({ hash: entry.hash, exactPayload: exact, confirmed: true });
          }
        }
        const pool = record(await call('txpool_content'));
        const pending = record(pool.pending ?? {});
        const ownerPending = Object.entries(pending).find(([account]) => account.toLowerCase() === prepared.owner);
        const txpoolContainsNonce = ownerPending ? Object.keys(record(ownerPending[1])).some(nonce => BigInt(nonce) === decoded.nonce) : false;
        // The wait is measured on the fork's own clock from the block the attempt was prepared at.
        const preparedBlock = record(await call('eth_getBlockByNumber', [hex(BigInt(attempt.preparedAtBlock)), false]));
        const waitedMs = Math.max(0, Number(latest.timestamp - quantity(preparedBlock.timestamp)) * 1000);
        const match = matches[0];
        const receipt = match ? record(await call('eth_getTransactionReceipt', [match.hash])) : null;
        const decision = classifyUnknownResult({ payloadNonce: decoded.nonce, latestNonce, scannedBlocks: latest.number - from + 1,
          scanComplete: true, matchingNonceTransactions: matches, txpoolChecked: true, txpoolContainsNonce,
          waitedMs, observedBlocks: latest.number - attempt.preparedAtBlock,
          receiptLookup: receipt ? { status: receipt.status === '0x1' ? 1 : 0 } : null,
          transactionLookup: match ? { hash: match.hash } : null, deadlineNear: latest.timestamp + 30n >= BigInt(prepared.deadline) });
        if ((decision.outcome === 'CONFIRMED' || decision.outcome === 'REVERTED') && match) {
          const seen = await observation(prepared, attempt, payload, match.hash);
          if (!seen) return { attempt, observation: null };
          const withHash = transitionAttemptState(attempt, decision.outcome === 'CONFIRMED' ? 'CONFIRMED' : 'REVERTED', match.hash);
          if (seen.outcome === 'DIVERGENT' || seen.outcome === 'INCONCLUSIVE') return save(transitionAttemptState(attempt, 'RECONCILIATION_REQUIRED'), seen);
          return save(withHash, { ...seen, code: `RECOVERED_${seen.code}` });
        }
        if (decision.outcome === 'PENDING' && match) return save(transitionAttemptState(attempt, 'PENDING', match.hash), null);
        if (decision.outcome === 'NOT_FOUND') {
          return save(transitionAttemptState(attempt, 'NOT_FOUND'), { attemptId: attempt.executionAttemptId, stepId, outcome: 'NOT_FOUND',
            code: decision.reason, transactionHash: null, blockHash: null, blockNumber: null, status: null, observedAt: await clock() });
        }
        if (decision.outcome === 'DIVERGENT') {
          return save(transitionAttemptState(attempt, 'RECONCILIATION_REQUIRED'), { attemptId: attempt.executionAttemptId, stepId,
            outcome: 'DIVERGENT', code: decision.reason, transactionHash: match?.hash ?? null, blockHash: null, blockNumber: null, status: null, observedAt: await clock() });
        }
        return { attempt, observation: { attemptId: attempt.executionAttemptId, stepId, outcome: 'INCONCLUSIVE', code: decision.reason,
          transactionHash: null, blockHash: null, blockNumber: null, status: null, observedAt: await clock() } };
      }
      return { attempt, observation: (await s.observations.read([])).filter(item => item.attemptId === attempt.executionAttemptId).at(-1) ?? null };
    });
  }

  async function accountState(prepared: PreparedExecution, blockHash: string): Promise<AccountState> {
    const at = { blockHash, requireCanonical: true };
    const balance = async (token: string, account: string) => BigInt(normalizeWord(await ethCall(token, `0x70a08231${addressWord(account)}`, at)));
    return { input: await balance(prepared.tokenIn, prepared.owner), output: await balance(prepared.tokenOut, prepared.owner),
      eth: quantity(await call('eth_getBalance', [prepared.owner, at])),
      allowance: BigInt(normalizeWord(await ethCall(prepared.tokenIn, `0xdd62ed3e${addressWord(prepared.owner)}${addressWord(SWAP_ROUTER_02)}`, at))),
      nonce: quantity(await call('eth_getTransactionCount', [prepared.owner, at])),
      routerInputResidue: await balance(prepared.tokenIn, SWAP_ROUTER_02), routerOutputResidue: await balance(prepared.tokenOut, SWAP_ROUTER_02) };
  }
  /**
   * Anvil charges the OP-stack L1 data and operator fees on a Base fork but omits them from receipts, so each
   * fee is derived independently from the signed bytes and L1Block storage at the transaction's block.
   */
  async function l1FeeFor(value: Record<string, unknown>, raw: unknown): Promise<bigint> {
    if (typeof raw !== 'string') fail('CHAIN_DATA_UNAVAILABLE');
    const at = { blockHash: String(value.blockHash), requireCanonical: true };
    const slot = async (index: bigint) => BigInt(normalizeWord(await call('eth_getStorageAt', [L1_BLOCK, hex(index), at])));
    const derived = opStackFee(fromHex(raw), quantity(value.gasUsed), { slot1: await slot(1n), slot3: await slot(3n), slot7: await slot(7n), slot8: await slot(8n) });
    if (value.l1Fee != null && quantity(value.l1Fee) !== derived) fail('L1_FEE_DERIVATION_MISMATCH');
    return derived;
  }
  const receiptFor = (value: Record<string, unknown>, l1Fee: bigint) => ({ transactionHash: String(value.transactionHash), blockHash: String(value.blockHash),
    status: value.status === '0x1' ? 1 as const : 0 as const, gasUsed: quantity(value.gasUsed), effectiveGasPrice: quantity(value.effectiveGasPrice),
    l1Fee,
    logs: (value.logs as Record<string, unknown>[]).map(log => ({ address: String(log.address).toLowerCase(),
      topics: (log.topics as string[]).map(topic => topic.toLowerCase()), data: String(log.data).toLowerCase() })) });

  /**
   * Execution Journal artifact from the durable attempt snapshots: every attempt state is recorded in
   * the order it was persisted, so an unknown-result recovery keeps its SUBMISSION_RESULT_UNKNOWN entry.
   */
  function journalFor(journalId: string, prepared: PreparedExecution, history: readonly (readonly Attempt[])[],
    steps: readonly StepId[], outcome: EvidenceBundle['outcome'], observedAt: string) {
    let journal = createJournal({ journalId, workflowId: `workflow-${journalId}`,
      executionPlanHash: prepared.hashes.executionPlanHash, manifestHash: prepared.hashes.manifestHash });
    const add = (level: 'workflow' | 'segment' | 'step' | 'attempt', entityId: string, toState: string, stepId: string | null = null, attemptId: string | null = null) => {
      journal = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : 'seg-fork-31337', stepId,
        executionAttemptId: attemptId, toState: toState as never, recordedAt: observedAt }).journal;
    };
    add('workflow', journal.workflowId, 'DRAFT');
    add('segment', 'seg-fork-31337', 'PLANNED');
    for (const step of steps) add('step', step, 'PLANNED', step);
    for (const state of ['REVIEWED', 'SIMULATED', 'AUTHORIZED', 'EXECUTING']) add('workflow', journal.workflowId, state);
    for (const state of ['READY', 'EXECUTING']) add('segment', 'seg-fork-31337', state);
    for (const step of steps) for (const state of ['READY', 'EXECUTING']) add('step', step, state, step);
    const last = new Map<string, string>();
    for (const snapshot of history) {
      for (const attempt of snapshot) {
        if (!steps.includes(attempt.stepId as StepId) || last.get(attempt.executionAttemptId) === attempt.state) continue;
        add('attempt', attempt.executionAttemptId, attempt.state, attempt.stepId, attempt.executionAttemptId);
        last.set(attempt.executionAttemptId, attempt.state);
      }
    }
    const final = history.at(-1) ?? [];
    const done = outcome === 'RECONCILED';
    for (const step of steps) {
      const confirmed = final.filter(item => item.stepId === step).at(-1)?.state === 'CONFIRMED';
      add('step', step, 'RECONCILING', step);
      add('step', step, confirmed && (done || step !== 'step-swap') ? 'COMPLETED' : outcome === 'INCONCLUSIVE' ? 'RECOVERY_REQUIRED' : 'FAILED', step);
    }
    add('segment', 'seg-fork-31337', 'RECONCILING');
    add('segment', 'seg-fork-31337', done ? 'COMPLETED' : outcome === 'INCONCLUSIVE' ? 'RECOVERY_REQUIRED' : 'FAILED');
    add('workflow', journal.workflowId, 'RECONCILING');
    add('workflow', journal.workflowId, done ? 'COMPLETED' : outcome === 'INCONCLUSIVE' ? 'RECOVERY_REQUIRED' : 'FAILED');
    return journal;
  }
  const journalHead = (journal: ReturnType<typeof journalFor>): string =>
    hashJournalBytes(text.encode(JSON.stringify(journal))).at(-1) ?? fail('JOURNAL_CORRUPT');

  /** Independent reconciliation from fork reads only, then a hash-linked Evidence Bundle. */
  async function reconcile(executionId: string): Promise<EvidenceRecord> {
    return serial(executionId, async () => {
      const prepared = await loadPrepared(executionId);
      const s = stores(executionId);
      const attempts = await s.attempts.read([]);
      const approve = latestAttempt(attempts, 'step-approve');
      const swap = latestAttempt(attempts, 'step-swap');
      if (!approve?.transactionHash || approve.state !== 'CONFIRMED' || !swap?.transactionHash || !['CONFIRMED', 'REVERTED'].includes(swap.state)) fail('RECONCILIATION_NOT_READY');
      await requireForkBoundary();
      const approveReceipt = record(await call('eth_getTransactionReceipt', [approve.transactionHash]));
      const swapReceipt = record(await call('eth_getTransactionReceipt', [swap.transactionHash]));
      const approveRaw = await call('eth_getRawTransactionByHash', [approve.transactionHash]);
      const swapRaw = await call('eth_getRawTransactionByHash', [swap.transactionHash]);
      const afterHash = String(swapReceipt.blockHash);
      const before = await accountState(prepared, prepared.quoteBlock.hash);
      const afterApproval = await accountState(prepared, String(approveReceipt.blockHash));
      const after = await accountState(prepared, afterHash);
      const consistency = record(await call('eth_getBlockByHash', [afterHash, false]));
      const [approveBytes, swapBytes] = prepared.payloads.map(view => fromHex(view.bytes)) as [Uint8Array, Uint8Array];
      const result = reconcileModeA({ owner: prepared.owner, tokenIn: prepared.tokenIn, tokenOut: prepared.tokenOut,
        amountIn: BigInt(prepared.amountIn), minimumOut: BigInt(prepared.minimumOut), quotedOut: BigInt(prepared.quotedOut),
        fee: prepared.fee as 100 | 500 | 3000 | 10000, deadline: BigInt(prepared.deadline), nonce: BigInt(prepared.nonce),
        reviewedApprove: approveBytes, reviewedSwap: swapBytes,
        approveRaw: typeof approveRaw === 'string' ? fromHex(approveRaw) : null, swapRaw: typeof swapRaw === 'string' ? fromHex(swapRaw) : null,
        approveHash: approve.transactionHash, swapHash: swap.transactionHash,
        approveReceipt: receiptFor(approveReceipt, await l1FeeFor(approveReceipt, approveRaw)),
        swapReceipt: receiptFor(swapReceipt, await l1FeeFor(swapReceipt, swapRaw)), before,
        afterApproval: { allowance: afterApproval.allowance, nonce: afterApproval.nonce }, after,
        lastReadBlockHash: afterHash, consistencyReadBlockHash: String(consistency.hash) });
      const observedAt = await clock();
      const journalHeadHash = journalHead(journalFor(`journal-${executionId}`, prepared, await s.attempts.history(),
        ['step-approve', 'step-swap'], result.outcome, observedAt));
      const assetIn = { chainId: FORK_REF, address: prepared.tokenIn, decimals: prepared.decimalsIn };
      const assetOut = { chainId: FORK_REF, address: prepared.tokenOut, decimals: prepared.decimalsOut };
      const native = { chainId: FORK_REF, nativeId: 'ETH', decimals: 18 };
      const differences = result.outcome === 'RECONCILED' ? [] : [
        { field: 'input-debited', expected: { asset: assetIn, amount: prepared.amountIn }, observed: { asset: assetIn, amount: (before.input - after.input).toString() } },
        { field: 'output-received', expected: { asset: assetOut, amount: prepared.quotedOut }, observed: { asset: assetOut, amount: (after.output > before.output ? after.output - before.output : 0n).toString() } },
      ];
      const limitations = ['FORK_REPRODUCED_NOT_MAINNET', 'NOT_CURRENT_MARKET', 'SINGLE_PROVIDER_STATE_SOURCE', 'USD values: not modeled',
        'OP_STACK_L1_AND_OPERATOR_FEES_DERIVED_FROM_L1BLOCK_STATE_AND_SIGNED_BYTES',
        ...(profile.environment === 'MOCKED' ? ['MOCKED_SYNTHETIC_ENVIRONMENT_NOT_FORK_EVIDENCE'] : [])];
      const built = buildEvidenceBundle({ evidenceBundleId: `evidence-${executionId}`, version: 1, supersedes: null,
        semanticWorkflowHash: prepared.hashes.semanticWorkflowHash, artifactSetHash: prepared.hashes.artifactSetHash,
        simulationHash: prepared.hashes.simulationHash, policyHash: prepared.hashes.policyHash, manifestHash: prepared.hashes.manifestHash,
        executionPlanHash: prepared.hashes.executionPlanHash, journalHeadHash, observedAt,
        outcome: result.outcome, receipts: [approveReceipt, swapReceipt].map(value => ({ transactionHash: String(value.transactionHash),
          exactRawResponse: text.encode(JSON.stringify(value)) })),
        matrixHash: prepared.hashes.enforcementMatrixHash,
        signedRawDigests: [approveRaw, swapRaw].map(raw => hashRawBytes('raw-response', fromHex(String(raw)))),
        reconciliationTranscript: text.encode(JSON.stringify({ outcome: result.outcome, code: result.code, observedOut: String(result.observedOut),
          totalFee: String(result.totalFee), before: stringify(before), afterApproval: stringify(afterApproval), after: stringify(after) })),
        forkTranscriptHash: prepared.source.stateSourceHash, differences,
        reconciliation: { balances: [{ asset: assetIn, amount: after.input.toString() }, { asset: assetOut, amount: after.output.toString() }],
          allowances: [{ asset: assetIn, amount: after.allowance.toString() }], debt: [], positions: [],
          fees: result.totalFee === null ? [] : [{ asset: native, amount: result.totalFee.toString() }],
          residualAssets: [{ asset: assetIn, amount: after.routerInputResidue.toString() }, { asset: assetOut, amount: after.routerOutputResidue.toString() }],
          ownership: [{ chainId: FORK_REF, address: prepared.owner }], limitations },
      });
      const bundle = profile.environment === 'MOCKED' ? validateArtifact('evidence-bundle', { ...built.bundle, environment: 'MOCKED' }) : built.bundle;
      const evidence: EvidenceRecord = { version: 1, evidenceBundleHash: artifactHash('evidence-bundle', bundle), bundle,
        environment: profile.environment, outcome: result.outcome, code: result.code,
        observedOut: result.observedOut === null ? null : result.observedOut.toString(),
        totalFee: result.totalFee === null ? null : result.totalFee.toString(), residualAllowance: after.allowance.toString(), revocationConfirmed: false };
      const prior = await s.evidence.read([]);
      if (prior.some(item => item.version === 1)) return prior.find(item => item.version === 1)!;
      await s.evidence.write([...prior, evidence]);
      return evidence;
    });
  }
  const stringify = (value: AccountState) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toString()]));

  /** A separate, reviewed Mode A approve(router, 0) for a residual allowance; never automatic. */
  async function prepareRevocation(executionId: string): Promise<RevocationRecord> {
    return serial(executionId, async () => {
      const prepared = await loadPrepared(executionId);
      const s = stores(executionId);
      const evidence = await s.evidence.read([]);
      const existing = await loadRevocation(executionId);
      if (existing) return existing;
      if (!evidence.length || evidence.at(-1)!.residualAllowance === '0') fail('REVOCATION_NOT_REQUIRED');
      await requireForkBoundary();
      const current = await head();
      const residual = BigInt(normalizeWord(await ethCall(prepared.tokenIn, `0xdd62ed3e${addressWord(prepared.owner)}${addressWord(SWAP_ROUTER_02)}`, 'latest')));
      const nonce = quantity(await call('eth_getTransactionCount', [prepared.owner, 'latest']));
      const maxFeePerGas = 2n * current.baseFeePerGas + PRIORITY_FEE;
      const draft = encodeUnsignedPayload({ chainId: FORK_CHAIN_ID, nonce, maxPriorityFeePerGas: PRIORITY_FEE, maxFeePerGas,
        gasLimit: REVOKE_GAS, to: prepared.tokenIn, value: 0n, accessList: [], data: encodeApprove(SWAP_ROUTER_02, 0n) });
      const payload = decodeUnsignedPayload(draft);
      const simulated = await call('eth_simulateV1', [{ blockStateCalls: [{ calls: [
        { from: prepared.owner, to: payload.to, nonce: hex(nonce), gas: hex(REVOKE_GAS), maxFeePerGas: hex(maxFeePerGas),
          maxPriorityFeePerGas: hex(PRIORITY_FEE), value: '0x0', data: toHex(payload.data) },
        { from: prepared.owner, to: prepared.tokenIn, nonce: hex(nonce + 1n), gas: hex(100_000n), maxFeePerGas: hex(maxFeePerGas),
          maxPriorityFeePerGas: hex(PRIORITY_FEE), value: '0x0', data: `0xdd62ed3e${addressWord(prepared.owner)}${addressWord(SWAP_ROUTER_02)}` },
      ] }], validation: true, traceTransfers: false, returnFullTransactions: false }, { blockHash: current.hash, requireCanonical: true }]);
      const calls = Array.isArray(simulated) ? record(simulated[0]).calls : null;
      if (!Array.isArray(calls) || calls.length !== 2) fail('SIMULATION_SHAPE_INVALID');
      const [revokeCall, readCall] = calls.map(record) as [Record<string, unknown>, Record<string, unknown>];
      const after = readCall.status === '0x1' ? BigInt(normalizeWord(readCall.returnData)) : MAX_UINT;
      const built = buildRevocationPayload({ owner: prepared.owner, tokenIn: prepared.tokenIn, nonce, residualAllowance: residual,
        gasLimit: REVOKE_GAS, maxFeePerGas, simulatedAllowanceAfter: after, simulationSucceeded: revokeCall.status === '0x1' });
      const revocation: RevocationRecord = { format: 'gryloo.mode-a-revocation.v1', revocationId: `revoke-${executionId.slice(5)}`,
        executionId, preparedAt: await clock(), residualAllowance: residual.toString(),
        payload: payloadView('step-revoke', built.bytes, prepared.owner), simulatedAllowanceAfter: after.toString(),
        gasUsed: quantity(revokeCall.gasUsed).toString() };
      await writeOnce(join(directory(executionId), 'revocation.json'), revocation);
      return revocation;
    });
  }

  /** Superseding Evidence Bundle version once the fork allowance is independently read as zero. */
  async function confirmRevocation(executionId: string): Promise<EvidenceRecord> {
    return serial(executionId, async () => {
      const prepared = await loadPrepared(executionId);
      const s = stores(executionId);
      const attempts = await s.attempts.read([]);
      const revoke = latestAttempt(attempts, 'step-revoke');
      const evidence = await s.evidence.read([]);
      const prior = evidence.at(-1) ?? fail('RECONCILIATION_NOT_READY');
      if (prior.revocationConfirmed) return prior;
      if (revoke?.state !== 'CONFIRMED' || !revoke.transactionHash) fail('REVOCATION_NOT_CONFIRMED');
      const receipt = record(await call('eth_getTransactionReceipt', [revoke.transactionHash]));
      const raw = await call('eth_getRawTransactionByHash', [revoke.transactionHash]);
      const revocation = await loadRevocation(executionId) ?? fail('REVOCATION_NOT_PREPARED');
      verifySignedPayload(fromHex(String(raw)), revoke.transactionHash, prepared.owner, fromHex(revocation.payload.bytes));
      const allowance = BigInt(normalizeWord(await ethCall(prepared.tokenIn, `0xdd62ed3e${addressWord(prepared.owner)}${addressWord(SWAP_ROUTER_02)}`,
        { blockHash: String(receipt.blockHash), requireCanonical: true })));
      if (receipt.status !== '0x1' || allowance !== 0n) fail('REVOCATION_NOT_CONFIRMED');
      const observedAt = await clock();
      // The revocation is its own authorization with its own journal, linked from the superseding bundle.
      const revocationJournalHead = journalHead(journalFor(`journal-${revocation.revocationId}`, prepared, await s.attempts.history(),
        ['step-revoke'], 'RECONCILED', observedAt));
      const assetIn = { chainId: FORK_REF, address: prepared.tokenIn, decimals: prepared.decimalsIn };
      const previous = prior.bundle;
      const draft = { ...previous, version: prior.version + 1, supersedes: prior.evidenceBundleHash, observedAt,
        receipts: [...previous.receipts, { receiptId: revoke.transactionHash, contentHash: hashRawBytes('raw-response', text.encode(JSON.stringify(receipt))) }],
        reconciliation: { ...previous.reconciliation, allowances: [{ asset: assetIn, amount: '0' }] },
        evidence: [...previous.evidence, { evidenceId: 'revocation-signed-raw', kind: 'EXTERNAL_REFERENCE' as const,
          contentHash: hashRawBytes('raw-response', fromHex(String(raw))) },
          { evidenceId: 'revocation-journal-head', kind: 'JOURNAL_ENTRY' as const, contentHash: revocationJournalHead }] };
      const bundle = validateArtifact('evidence-bundle', draft);
      const next: EvidenceRecord = { ...prior, version: prior.version + 1, evidenceBundleHash: artifactHash('evidence-bundle', bundle), bundle,
        residualAllowance: '0', revocationConfirmed: true };
      await s.evidence.write([...evidence, next]);
      return next;
    });
  }

  return { profile, prepare, status, list, beginStep, recordSubmission, observeStep, reconcile, prepareRevocation, confirmRevocation, loadPrepared };
}
export type ModeAService = ReturnType<typeof createModeAService>;

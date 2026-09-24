// SPDX-License-Identifier: AGPL-3.0-only
import canonicalize from 'canonicalize';
import type { QuoteStateArtifact, SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { assetSymbol, createReviewContext, hasKeys, isRecord, type ReviewContext, type Symbol } from './context.js';
import { validateAuthoringWorkflow } from './validation.js';
import { digestArtifact, digestRawResponse, digestSelfCheck, validateDigestInput } from './artifact-digest.js';

const SWAP = 'asset.swap.exact-input';
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
const UINT256 = (1n << 256n) - 1n;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The BUILD-003C read-only Base observation profile. Every value here is a
 * reviewed constant; nothing is taken from the network or the environment.
 * The code pins were taken on first use from the recorded transcripts.
 */
export const BASE_OBSERVATION_PROFILE = freeze({
  idPrefix: 'OBSERVED',
  sourceId: 'base.json-rpc',
  adapter: { id: 'base.uniswap-v3-quoter-v2', version: '1.0.0' },
  transcriptFormat: 'gryloo.base-observation-transcript.v1',
  chainId: 'eip155:8453',
  chainIdHex: '0x2105',
  providerHost: 'base-mainnet.g.alchemy.com',
  validitySeconds: 30,
  maximumBlockAgeSeconds: 15,
  maximumClockSkewSeconds: 2,
  maximumDurationMs: 20_000,
  maximumRequests: 21,
  maximumTranscriptBytes: 1_048_576,
  maximumResponseBytes: 131_072,
  feeTiers: [100, 500, 3000, 10000],
  methods: ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'],
  contracts: {
    usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    weth: '0x4200000000000000000000000000000000000006',
    factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
    quoter: '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
  },
  selectors: {
    decimals: '0x313ce567',
    symbol: '0x95d89b41',
    factory: '0xc45a0155',
    weth9: '0x4aa4a4fc',
    getPool: '0x1698ee82',
    quoteExactInputSingle: '0xc6a5026a',
  },
  codePins: {
    usdc: '0x98d785fcb1bf847f287adc2310759fd94cc13e754b974bc72131382e8266f607',
    weth: '0x667c900c2c6da80d452501a9c6332e046384a0c438c3334ce6f71c86dd7b8735',
    factory: '0x8545609892cc8d7d608dd4420ee110ab98448730570824fb029228e33846d28c',
    quoter: '0xa204e355059d9c809bfc026503d49b4ecf8655f482a76040dec4bcb4618047b4',
  },
  priceLimits: { zeroForOne: (MIN_SQRT_RATIO + 1n).toString(), oneForZero: (MAX_SQRT_RATIO - 1n).toString() },
  registryValidation: { registryVersion: '1.0.0', actionType: SWAP, result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' },
  uncertainty: [
    { code: 'SINGLE_PROVIDER', description: 'Every value was read from one JSON-RPC provider and is not cross-checked against another source.' },
    { code: 'UNSAFE_HEAD', description: 'The block was the latest sealed block when read. It can still be reorganized later.' },
    { code: 'SINGLE_PROVIDER_FREE_PLAN_LOCAL_ONLY', description: 'Alchemy Free is the sole read provider for explicitly enabled local development. Its availability and rate limits do not make the observation an authorization input.' },
    { code: 'NO_ROUTE_SELECTION', description: 'Fee tiers are listed in a fixed order. No route, tier or provider is selected, ranked or recommended.' },
    { code: 'NO_MINIMUM_OUTPUT', description: 'No minimum output, slippage bound or output bounds are derived.' },
    { code: 'NOT_AN_AUTHORIZATION_INPUT', description: 'This observation is never an authorization input and cannot enable signing or execution.' },
    { code: 'GAS_AND_FEES_NOT_MODELED', description: 'Transaction gas, protocol fees and platform fees are not modeled. The quoter gas figure is not transaction gas.' },
    { code: 'PRICE_MOVES_AFTER_BLOCK', description: 'Pool state changes after the observed block. A later swap can receive a different amount.' },
    { code: 'CODE_PINS_TRUST_ON_FIRST_USE', description: 'Code digests are compared with pins taken on first use from a single-provider recording. They detect changes but do not prove authenticity.' },
    { code: 'IMPLEMENTATION_NOT_PINNED', description: 'For proxy contracts only the proxy code is pinned. The implementation behind a proxy is not observed.' },
    { code: 'SOURCE_EQUIVALENCE_NOT_VERIFIED', description: 'The full-input rule relies on the pinned Uniswap v3 source. Equivalence of the deployed bytecode to that source is not verified.' },
    { code: 'NOT_EVIDENCE', description: 'A read-only observation is not financial evidence and carries no evidence environment label.' },
  ],
  recordedUncertainty: { code: 'RECORDED_NOT_CURRENT', description: 'Served from a committed recording. It is historical and not a current market read.' },
} as const);

export type ObservationMode = 'LIVE_READ_ONLY' | 'RECORDED_REPLAY';
export type TierStatus = 'NO_POOL' | 'QUOTED' | 'FULL_INPUT_NOT_PROVEN' | 'ZERO_OUTPUT' | 'QUOTE_REVERTED';
export interface ObservationSwap { readonly from: Symbol; readonly to: Symbol; readonly amountIn: string }
export interface ObservationTier {
  readonly fee: number;
  readonly pool: string | null;
  readonly status: TierStatus;
  /** Present only when full consumption of the input is proven. */
  readonly amountOut: string | null;
}
export interface BaseObservationFacts {
  readonly mode: ObservationMode;
  readonly providerHost: string;
  readonly chainId: string;
  readonly swap: ObservationSwap;
  readonly block: { readonly number: number; readonly hash: string; readonly timestamp: number };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly requests: number;
  readonly code: { readonly usdc: string; readonly weth: string; readonly factory: string; readonly quoter: string };
  readonly assets: Readonly<Record<Symbol, { readonly decimals: number; readonly symbol: string }>>;
  readonly deployment: { readonly factory: string; readonly weth9: string };
  readonly tiers: readonly ObservationTier[];
}
export interface DerivedBaseObservation { readonly artifact: QuoteStateArtifact; readonly facts: BaseObservationFacts }
/** Collected transcript plus its decoded facts. Code pins are not yet compared. */
export interface CollectedBaseTranscript { readonly transcript: Uint8Array; readonly facts: BaseObservationFacts }
export interface BaseObservationReview {
  readonly status: 'CURRENT' | 'INVALIDATED' | 'EXPIRED';
  readonly nodeId: string;
  readonly revision: number;
  readonly artifactHash: string;
  readonly rawResponseHash: string;
  readonly semanticWorkflowHash: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly retrievedAt: string;
  readonly facts: BaseObservationFacts;
  readonly evidence: 'NOT_EVIDENCE';
  readonly authorizable: false;
  readonly executable: false;
  readonly authorization: 'NONE';
  readonly enforcement: 'NOT_ENFORCED';
}
export type BaseTransport = (request: string) => Promise<string>;
export interface CollectOptions {
  readonly transport: BaseTransport;
  readonly now: () => number;
  readonly wait: (milliseconds: number) => Promise<void>;
  /** Pause after the head read so load-balanced nodes can import block H. */
  readonly settleMs: number;
}

/** A coded observation failure. It never carries response values. */
export class BaseObservationError extends Error {
  readonly code: string;
  readonly requestsSent: number;
  readonly providerErrorCode: number | null;
  constructor(code: string, requestsSent = 0, providerErrorCode: number | null = null) {
    super(code);
    this.name = 'BaseObservationError';
    this.code = code;
    this.requestsSent = requestsSent;
    this.providerErrorCode = providerErrorCode;
  }
}
function fail(code: string, providerErrorCode: number | null = null): never {
  throw new BaseObservationError(code, 0, providerErrorCode);
}
const same = (left: unknown, right: unknown) => canonicalize(left) === canonicalize(right);

/**
 * Strict RFC 8259 parser: duplicate keys, lone surrogates, depth above 64 and
 * trailing data are rejected. JSON.parse would silently keep the last duplicate.
 */
function parseStrictJson(text: string): unknown {
  let at = 0;
  function bad(): never { throw new Error('STRICT_JSON'); }
  const ws = () => { while (at < text.length && ' \t\n\r'.includes(text[at]!)) at += 1; };
  const string = (): string => {
    if (text[at] !== '"') bad();
    at += 1;
    let out = '';
    for (;;) {
      const char = text[at];
      if (char === undefined) bad();
      at += 1;
      if (char === '"') break;
      if (char === '\\') {
        const escape = text[at];
        at += 1;
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (escape !== undefined && escape in simple) out += simple[escape];
        else if (escape === 'u') {
          const hex = text.slice(at, at + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad();
          out += String.fromCharCode(parseInt(hex, 16));
          at += 4;
        } else bad();
      } else if (char < ' ') bad();
      else out += char;
    }
    if (!out.isWellFormed()) bad();
    return out;
  };
  const value = (depth: number): unknown => {
    if (depth > 64) bad();
    ws();
    const char = text[at];
    if (char === '{') {
      at += 1;
      const object: Record<string, unknown> = {};
      const keys = new Set<string>();
      ws();
      if (text[at] === '}') { at += 1; return object; }
      for (;;) {
        ws();
        const key = string();
        if (keys.has(key)) bad();
        keys.add(key);
        ws();
        if (text[at] !== ':') bad();
        at += 1;
        Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        ws();
        if (text[at] === ',') { at += 1; continue; }
        if (text[at] === '}') { at += 1; return object; }
        bad();
      }
    }
    if (char === '[') {
      at += 1;
      const array: unknown[] = [];
      ws();
      if (text[at] === ']') { at += 1; return array; }
      for (;;) {
        array.push(value(depth + 1));
        ws();
        if (text[at] === ',') { at += 1; continue; }
        if (text[at] === ']') { at += 1; return array; }
        bad();
      }
    }
    if (char === '"') return string();
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, at)) { at += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(at, at + 400));
    if (!number) bad();
    at += number[0].length;
    const parsed = Number(number[0]);
    if (!Number.isFinite(parsed)) bad();
    return parsed;
  };
  const result = value(0);
  ws();
  if (at !== text.length) bad();
  return result;
}

const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const DATA = /^0x(?:[0-9a-f]{2})*$/;
const HASH = /^0x[0-9a-f]{64}$/;
const quantity = (value: number) => `0x${value.toString(16)}`;
const word = (value: bigint) => value.toString(16).padStart(64, '0');
const addressWord = (address: string) => address.slice(2).padStart(64, '0');

function safeQuantity(value: unknown): number {
  if (typeof value !== 'string' || !QUANTITY.test(value)) fail('RPC_RESPONSE_INVALID');
  const parsed = Number.parseInt(value.slice(2), 16);
  if (!Number.isSafeInteger(parsed)) fail('RPC_RESPONSE_INVALID');
  return parsed;
}
function words(data: string, count: number): bigint[] {
  if (data.length !== 2 + 64 * count) fail('RPC_RESPONSE_INVALID');
  return Array.from({ length: count }, (_, index) => BigInt(`0x${data.slice(2 + 64 * index, 66 + 64 * index)}`));
}
function uintOf(data: string, bits: number): bigint {
  const value = words(data, 1)[0]!;
  if (value >= 1n << BigInt(bits)) fail('RPC_RESPONSE_INVALID');
  return value;
}
function addressOf(data: string): string {
  const value = uintOf(data, 160);
  return `0x${value.toString(16).padStart(40, '0')}`;
}
function stringOf(data: string): string {
  if (data.length < 2 + 128) fail('RPC_RESPONSE_INVALID');
  const [offset, length] = words(data.slice(0, 2 + 128), 2) as [bigint, bigint];
  if (offset !== 32n || length > 32n) fail('RPC_RESPONSE_INVALID');
  const size = Number(length);
  const expectedLength = 2 + 128 + (size === 0 ? 0 : 64);
  if (data.length !== expectedLength) fail('RPC_RESPONSE_INVALID');
  const body = data.slice(130);
  if (!/^0*$/.test(body.slice(size * 2))) fail('RPC_RESPONSE_INVALID');
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = parseInt(body.slice(index * 2, index * 2 + 2), 16);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('RPC_RESPONSE_INVALID'); }
}
function hexBytes(data: string): Uint8Array {
  const bytes = new Uint8Array((data.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(data.slice(2 + index * 2, 4 + index * 2), 16);
  return bytes;
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return `0x${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

type RpcOutcome = { readonly result: unknown } | { readonly error: { readonly code: number; readonly message: string } };
function envelope(text: string, id: number): RpcOutcome {
  let value: unknown;
  try { value = parseStrictJson(text); } catch { fail('RPC_RESPONSE_INVALID'); }
  if (!isRecord(value) || value.jsonrpc !== '2.0' || value.id !== id) fail('RPC_RESPONSE_INVALID');
  if (hasKeys(value, ['jsonrpc', 'id', 'result'])) return { result: value.result };
  if (!hasKeys(value, ['jsonrpc', 'id', 'error'])) fail('RPC_RESPONSE_INVALID');
  const error = value.error;
  if (!isRecord(error) || !(hasKeys(error, ['code', 'message']) || hasKeys(error, ['code', 'message', 'data']))
      || typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || typeof error.message !== 'string') fail('RPC_RESPONSE_INVALID');
  return { error: { code: error.code, message: error.message } };
}
const isQuoteRevert = (error: { code: number; message: string }) =>
  error.code === 3 || (error.code === -32000 && error.message.startsWith('execution reverted'));

type Block = { number: number; hash: string; timestamp: number };
function blockOf(result: unknown): Block {
  if (result === null) fail('BLOCK_INCONSISTENT');
  if (!isRecord(result) || typeof result.hash !== 'string' || !HASH.test(result.hash)) fail('RPC_RESPONSE_INVALID');
  // Additional block fields, such as Denim's optional millisecond timestamps, are kept in the transcript but not used.
  return { number: safeQuantity(result.number), hash: result.hash, timestamp: safeQuantity(result.timestamp) };
}

interface Exchange { readonly request: string; readonly response: string }
type Ask = (request: string) => Promise<string>;

/**
 * The fixed read plan (plan §3.2). The same interpreter drives live collection
 * and re-derivation from a transcript, so both apply identical checks. Code
 * pins are compared separately, in derivation.
 */
async function interpret(swap: ObservationSwap, ask: Ask, context: ReviewContext, afterHead: () => Promise<void>) {
  const profile = BASE_OBSERVATION_PROFILE;
  const tokenIn = context.assets[swap.from].asset, tokenOut = context.assets[swap.to].asset;
  if (!('address' in tokenIn) || !('address' in tokenOut)) fail('INPUT_INVALID');
  let id = 0;
  const exchanges: Exchange[] = [];
  const call = async (method: string, params: unknown[]): Promise<RpcOutcome> => {
    if (id >= profile.maximumRequests) fail('REQUEST_BUDGET_EXCEEDED');
    id += 1;
    const request = canonicalize({ jsonrpc: '2.0', id, method, params })!;
    const response = await ask(request);
    exchanges.push({ request, response });
    return envelope(response, id);
  };
  const plain = async (method: string, params: unknown[]): Promise<unknown> => {
    const outcome = await call(method, params);
    if ('error' in outcome) fail('PROVIDER_ERROR', outcome.error.code);
    return outcome.result;
  };

  // 1-2. Chain and head block.
  const chainId = await plain('eth_chainId', []);
  if (typeof chainId !== 'string' || !QUANTITY.test(chainId)) fail('RPC_RESPONSE_INVALID');
  if (chainId !== profile.chainIdHex) fail('WRONG_CHAIN');
  const head = blockOf(await plain('eth_getBlockByNumber', ['latest', false]));
  await afterHead();

  // 3-7. Every state read is bound to the same canonical block hash (D-6 = B). No fallback exists.
  const at = { blockHash: head.hash, requireCanonical: true };
  const pinned = async (method: 'eth_getCode' | 'eth_call', first: unknown): Promise<RpcOutcome> => call(method, [first, at]);
  const data = (outcome: RpcOutcome): string => {
    if ('error' in outcome) fail('PINNED_READ_REJECTED', outcome.error.code);
    if (typeof outcome.result !== 'string' || !DATA.test(outcome.result)) fail('RPC_RESPONSE_INVALID');
    return outcome.result;
  };
  const read = async (to: string, selector: string, args = '') => data(await pinned('eth_call', { to, data: selector + args }));

  const code = {} as Record<'usdc' | 'weth' | 'factory' | 'quoter', string>;
  for (const label of ['usdc', 'weth', 'factory', 'quoter'] as const) {
    const bytecode = data(await pinned('eth_getCode', profile.contracts[label]));
    if (bytecode === '0x') fail('CODE_MISSING');
    code[label] = await sha256Hex(hexBytes(bytecode));
  }
  const assets = {} as Record<Symbol, { decimals: number; symbol: string }>;
  for (const symbol of ['USDC', 'WETH'] as const) {
    const record = context.assets[symbol].asset;
    if (!('address' in record)) fail('INPUT_INVALID');
    const decimals = Number(uintOf(await read(record.address, profile.selectors.decimals), 8));
    if (decimals !== record.decimals) fail('ASSET_METADATA_MISMATCH');
    const name = stringOf(await read(record.address, profile.selectors.symbol));
    if (name !== symbol) fail('ASSET_METADATA_MISMATCH');
    assets[symbol] = { decimals, symbol: name };
  }
  const factory = addressOf(await read(profile.contracts.quoter, profile.selectors.factory));
  if (factory !== profile.contracts.factory) fail('DEPLOYMENT_MISMATCH');
  const weth9 = addressOf(await read(profile.contracts.quoter, profile.selectors.weth9));
  if (weth9 !== profile.contracts.weth) fail('DEPLOYMENT_MISMATCH');
  const deployment = { factory, weth9 };

  const pools: (string | null)[] = [];
  for (const fee of profile.feeTiers) {
    const pool = addressOf(await read(profile.contracts.factory, profile.selectors.getPool,
      addressWord(tokenIn.address) + addressWord(tokenOut.address) + word(BigInt(fee))));
    pools.push(/^0x0{40}$/.test(pool) ? null : pool);
  }
  const limit = tokenIn.address < tokenOut.address ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n;
  const tiers: ObservationTier[] = [];
  for (const [index, fee] of profile.feeTiers.entries()) {
    const pool = pools[index]!;
    if (pool === null) { tiers.push({ fee, pool, status: 'NO_POOL', amountOut: null }); continue; }
    const outcome = await pinned('eth_call', { to: profile.contracts.quoter, data: profile.selectors.quoteExactInputSingle
      + addressWord(tokenIn.address) + addressWord(tokenOut.address) + word(BigInt(swap.amountIn)) + word(BigInt(fee)) + word(0n) });
    if ('error' in outcome) {
      if (!isQuoteRevert(outcome.error)) fail('PINNED_READ_REJECTED', outcome.error.code);
      tiers.push({ fee, pool, status: 'QUOTE_REVERTED', amountOut: null });
      continue;
    }
    const returned = data(outcome);
    const [amountOut, sqrtPriceX96After, ticksCrossed] = words(returned, 4) as [bigint, bigint, bigint, bigint];
    if (sqrtPriceX96After <= MIN_SQRT_RATIO || sqrtPriceX96After >= MAX_SQRT_RATIO || ticksCrossed >= 1n << 32n) fail('RPC_RESPONSE_INVALID');
    // The pool loop exits only with no input left or at the price limit; ending at the limit proves nothing (plan §3.2.2).
    if (sqrtPriceX96After === limit) tiers.push({ fee, pool, status: 'FULL_INPUT_NOT_PROVEN', amountOut: null });
    else if (amountOut === 0n) tiers.push({ fee, pool, status: 'ZERO_OUTPUT', amountOut: null });
    else tiers.push({ fee, pool, status: 'QUOTED', amountOut: amountOut.toString() });
  }

  // 8. Final check of the same block by number.
  const final = await plain('eth_getBlockByNumber', [quantity(head.number), false]);
  const tail = blockOf(final);
  if (tail.hash !== head.hash) fail('REORG_DETECTED');
  if (tail.number !== head.number || tail.timestamp !== head.timestamp) fail('BLOCK_INCONSISTENT');
  return { exchanges, block: head, code, assets, deployment, tiers };
}

const TIMESTAMP = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;

function checkTimes(block: Block, startedMs: number, completedMs: number): void {
  const profile = BASE_OBSERVATION_PROFILE;
  if (completedMs < startedMs || completedMs - startedMs > profile.maximumDurationMs) fail('TRANSPORT_FAILED');
  const blockMs = block.timestamp * 1000;
  if (completedMs - blockMs > profile.maximumBlockAgeSeconds * 1000) fail('STALE_BLOCK');
  if (blockMs - completedMs > profile.maximumClockSkewSeconds * 1000) fail('CLOCK_SKEW');
}

function swapInput(value: unknown, context: ReviewContext): ObservationSwap {
  if (!isRecord(value) || !hasKeys(value, ['from', 'to', 'amountIn'])) fail('INPUT_INVALID');
  const { from, to, amountIn } = value;
  if ((from !== 'USDC' && from !== 'WETH') || (to !== 'USDC' && to !== 'WETH') || from === to) fail('INPUT_INVALID');
  if (typeof amountIn !== 'string' || !/^[1-9][0-9]{0,77}$/.test(amountIn)) fail('INPUT_INVALID');
  const units = BigInt(amountIn);
  if (units > UINT256 || units > BigInt(context.assets[from].maximumAmountUnits)) fail('INPUT_INVALID');
  return { from, to, amountIn };
}

/** Swap facts of one authored swap node, taken only from the validated IR. */
function nodeSwap(workflow: SemanticWorkflow, nodeId: unknown, context: ReviewContext): { node: SemanticWorkflow['nodes'][number]; swap: ObservationSwap } {
  const node = workflow.nodes.find(candidate => candidate.nodeId === nodeId);
  if (!node || node.actionType !== SWAP || node.chainId !== BASE_OBSERVATION_PROFILE.chainId) fail('INPUT_INVALID');
  const amount = node.inputs.find(input => input.name === 'amount-in');
  const assetOut = node.inputs.find(input => input.name === 'asset-out');
  if (amount?.kind !== 'QUANTITY' || assetOut?.kind !== 'ASSET') fail('INPUT_INVALID');
  const from = assetSymbol(amount.value.asset, context), to = assetSymbol(assetOut.value, context);
  return { node, swap: swapInput({ from, to, amountIn: amount.value.amount }, context) };
}

/**
 * Runs the read plan through an injected transport and returns the canonical
 * transcript bytes. It applies every check except the code-pin comparison and
 * performs no I/O of its own. The transport is the only network boundary.
 */
export async function collectBaseTranscript(input: unknown, options: CollectOptions, context: unknown): Promise<CollectedBaseTranscript> {
  const trusted = createReviewContext(context);
  let sent = 0;
  try {
    await digestSelfCheck();
    if (!isRecord(input) || !hasKeys(input, ['swap', 'mode', 'providerHost'])
        || (input.mode !== 'LIVE_READ_ONLY' && input.mode !== 'RECORDED_REPLAY')
        || input.providerHost !== BASE_OBSERVATION_PROFILE.providerHost) fail('INPUT_INVALID');
    const swap = swapInput(input.swap, trusted);
    const startedMs = options.now();
    let bytes = 0;
    const ask: Ask = async (request) => {
      if (options.now() - startedMs > BASE_OBSERVATION_PROFILE.maximumDurationMs) fail('TRANSPORT_FAILED');
      sent += 1;
      const response = await options.transport(request);
      if (typeof response !== 'string') fail('TRANSPORT_FAILED');
      bytes += request.length + response.length;
      if (bytes > BASE_OBSERVATION_PROFILE.maximumTranscriptBytes) fail('TRANSCRIPT_TOO_LARGE');
      return response;
    };
    const result = await interpret(swap, ask, trusted, () => options.wait(options.settleMs));
    const completedMs = options.now();
    checkTimes(result.block, startedMs, completedMs);
    const mode = input.mode as ObservationMode;
    const startedAt = new Date(startedMs).toISOString(), completedAt = new Date(completedMs).toISOString();
    const text = canonicalize({
      format: BASE_OBSERVATION_PROFILE.transcriptFormat, mode, providerHost: BASE_OBSERVATION_PROFILE.providerHost,
      chainId: BASE_OBSERVATION_PROFILE.chainId, swap, startedAt, completedAt, exchanges: result.exchanges,
    })!;
    const encoded = new TextEncoder().encode(text);
    if (encoded.length > BASE_OBSERVATION_PROFILE.maximumTranscriptBytes) fail('TRANSCRIPT_TOO_LARGE');
    // Typed arrays cannot be frozen; the bytes are returned as a fresh copy owned by the caller.
    return Object.freeze({ transcript: encoded, facts: freeze(factsOf(mode, swap, startedAt, completedAt, result)) });
  } catch (cause) {
    if (cause instanceof BaseObservationError) throw new BaseObservationError(cause.code, sent, cause.providerErrorCode);
    if (cause instanceof Error && cause.message === 'DIGEST_UNAVAILABLE') throw new BaseObservationError('DIGEST_UNAVAILABLE', sent);
    if (cause instanceof Error && cause.message === 'INVALID_REVIEW_CONTEXT') throw new BaseObservationError('INPUT_INVALID', sent);
    throw new BaseObservationError('INTERNAL_ERROR', sent);
  }
}

function factsOf(mode: ObservationMode, swap: ObservationSwap, startedAt: string, completedAt: string,
  result: Awaited<ReturnType<typeof interpret>>): BaseObservationFacts {
  return {
    mode, providerHost: BASE_OBSERVATION_PROFILE.providerHost, chainId: BASE_OBSERVATION_PROFILE.chainId, swap,
    block: result.block, startedAt, completedAt, requests: result.exchanges.length,
    code: result.code, assets: result.assets, deployment: result.deployment, tiers: result.tiers,
  };
}

function parseTranscript(bytes: unknown) {
  const profile = BASE_OBSERVATION_PROFILE;
  if (!(bytes instanceof Uint8Array) || bytes.length > profile.maximumTranscriptBytes) fail('DERIVATION_MISMATCH');
  let text: string, value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = parseStrictJson(text);
  } catch { fail('DERIVATION_MISMATCH'); }
  if (canonicalize(value) !== text) fail('DERIVATION_MISMATCH');
  if (!isRecord(value) || !hasKeys(value, ['format', 'mode', 'providerHost', 'chainId', 'swap', 'startedAt', 'completedAt', 'exchanges'])
      || value.format !== profile.transcriptFormat || (value.mode !== 'LIVE_READ_ONLY' && value.mode !== 'RECORDED_REPLAY')
      || value.providerHost !== profile.providerHost || value.chainId !== profile.chainId
      || !TIMESTAMP(value.startedAt) || !TIMESTAMP(value.completedAt) || !Array.isArray(value.exchanges)
      || value.exchanges.length === 0 || value.exchanges.length > profile.maximumRequests
      || value.exchanges.some(item => !isRecord(item) || !hasKeys(item, ['request', 'response'])
        || typeof item.request !== 'string' || typeof item.response !== 'string')) fail('DERIVATION_MISMATCH');
  return value as { mode: ObservationMode; providerHost: string; swap: unknown; startedAt: string; completedAt: string; exchanges: Exchange[] };
}

/**
 * Re-derives the artifact from transcript bytes alone. The server and the
 * browser call this same function, so a displayed value always follows from
 * the recorded responses under every check, including the code pins.
 */
export async function deriveBaseObservation(transcript: unknown, input: unknown, context: unknown): Promise<DerivedBaseObservation> {
  const trusted = createReviewContext(context);
  const profile = BASE_OBSERVATION_PROFILE;
  await digestSelfCheck();
  if (!isRecord(input) || !hasKeys(input, ['workflow', 'nodeId']) || typeof input.nodeId !== 'string') fail('INPUT_INVALID');
  let workflow: SemanticWorkflow;
  try { workflow = validateAuthoringWorkflow(input.workflow, trusted); } catch { fail('INPUT_INVALID'); }
  const { node, swap } = nodeSwap(workflow, input.nodeId, trusted);
  const parsed = parseTranscript(transcript);
  if (!same(parsed.swap, swap)) fail('DERIVATION_MISMATCH');

  let index = 0;
  const replayed = await interpret(swap, async (request) => {
    const exchange = parsed.exchanges[index];
    if (!exchange || exchange.request !== request) fail('DERIVATION_MISMATCH');
    index += 1;
    return exchange.response;
  }, trusted, async () => {});
  if (index !== parsed.exchanges.length) fail('DERIVATION_MISMATCH');
  const startedMs = Date.parse(parsed.startedAt), completedMs = Date.parse(parsed.completedAt);
  checkTimes(replayed.block, startedMs, completedMs);
  for (const label of ['usdc', 'weth', 'factory', 'quoter'] as const) {
    if (replayed.code[label] !== profile.codePins[label]) fail('CODE_DIGEST_MISMATCH');
  }

  const assetIn = trusted.assets[swap.from].asset, assetOut = trusted.assets[swap.to].asset;
  const observedMs = replayed.block.timestamp * 1000;
  const labels = { usdc: 'usdc', weth: 'weth', factory: 'uniswap-v3-factory', quoter: 'quoter-v2' } as const;
  const artifact: QuoteStateArtifact = {
    schemaVersion: '1.0.0',
    artifactId: `${profile.idPrefix}.base-quote.${node.nodeId}.r${workflow.revision}.b${replayed.block.number}`,
    semanticWorkflowHash: await digestArtifact('semantic-workflow', workflow),
    nodeId: node.nodeId,
    sourceId: profile.sourceId,
    adapter: { ...profile.adapter },
    chainId: node.chainId,
    chainPosition: { kind: 'BLOCK', height: replayed.block.number },
    retrievedAt: parsed.completedAt,
    freshness: {
      observedAt: new Date(observedMs).toISOString(),
      expiresAt: new Date(observedMs + profile.validitySeconds * 1000).toISOString(),
      maximumAgeSeconds: profile.validitySeconds,
    },
    rawResponseHash: await digestRawResponse(transcript as Uint8Array),
    normalizedValues: [
      { name: 'observation-mode', kind: 'IDENTIFIER', value: parsed.mode },
      { name: 'provider-host', kind: 'IDENTIFIER', value: parsed.providerHost },
      { name: 'block-hash', kind: 'IDENTIFIER', value: replayed.block.hash },
      { name: 'amount-in', kind: 'QUANTITY', value: { asset: { ...assetIn }, amount: swap.amountIn } },
      { name: 'asset-out', kind: 'ASSET', value: { ...assetOut } },
      ...(['usdc', 'weth', 'factory', 'quoter'] as const).map(label => ({ name: `code-sha256.${labels[label]}`, kind: 'IDENTIFIER' as const, value: replayed.code[label] })),
      ...(['USDC', 'WETH'] as const).flatMap(symbol => [
        { name: `decimals.${symbol.toLowerCase()}`, kind: 'INTEGER' as const, value: replayed.assets[symbol].decimals },
        { name: `symbol.${symbol.toLowerCase()}`, kind: 'IDENTIFIER' as const, value: replayed.assets[symbol].symbol },
      ]),
      ...replayed.tiers.flatMap(tier => [
        { name: `tier-${tier.fee}.status`, kind: 'IDENTIFIER' as const, value: tier.status },
        ...(tier.pool === null ? [] : [{ name: `tier-${tier.fee}.pool`, kind: 'ACCOUNT' as const, value: { chainId: profile.chainId, address: tier.pool } }]),
        ...(tier.amountOut === null ? [] : [{ name: `tier-${tier.fee}.quoted-output`, kind: 'QUANTITY' as const, value: { asset: { ...assetOut }, amount: tier.amountOut } }]),
      ]),
    ],
    providerReference: { kind: 'NONE' },
    proposedContracts: [], proposedSpenders: [], proposedRecipients: [], fees: [], gas: [], outputBounds: [],
    uncertainty: [...profile.uncertainty, ...(parsed.mode === 'RECORDED_REPLAY' ? [profile.recordedUncertainty] : [])].map(entry => ({ ...entry })),
    registryValidation: { ...profile.registryValidation },
  };
  try { validateDigestInput('quote-state-artifact', artifact); } catch { fail('DERIVATION_MISMATCH'); }
  return freeze({ artifact, facts: factsOf(parsed.mode, swap, parsed.startedAt, parsed.completedAt, replayed) });
}

const MOCK_MARKERS = (artifact: QuoteStateArtifact) => artifact.artifactId.startsWith('MOCKED.')
  || artifact.sourceId.startsWith('mock.') || artifact.adapter.id.startsWith('mock.')
  || artifact.normalizedValues.some(value => value.name === 'evidence-environment' || value.name === 'fixture-id')
  || artifact.uncertainty.some(entry => entry.code.startsWith('MOCKED') || entry.code === 'SYNTHETIC_RATE');

/**
 * Receipt and access review of one observation. It recomputes the raw hash,
 * re-derives the artifact from the transcript and checks the revision binding
 * and the 30-second validity. It never makes anything authorizable.
 */
export async function reviewBaseObservation(input: unknown, context: unknown): Promise<BaseObservationReview> {
  const trusted = createReviewContext(context);
  await digestSelfCheck();
  if (!isRecord(input) || !hasKeys(input, ['artifact', 'transcript', 'sourceWorkflow', 'currentWorkflow', 'nowMs'])
      || typeof input.nowMs !== 'number' || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) fail('INPUT_INVALID');
  try { validateDigestInput('quote-state-artifact', input.artifact); } catch { fail('DERIVATION_MISMATCH'); }
  const artifact = input.artifact as QuoteStateArtifact;
  if (MOCK_MARKERS(artifact)) fail('MOCK_MARKER_FORBIDDEN');
  if (!(input.transcript instanceof Uint8Array) || artifact.rawResponseHash !== await digestRawResponse(input.transcript)) fail('RAW_HASH_MISMATCH');
  let source: SemanticWorkflow;
  try { source = validateAuthoringWorkflow(input.sourceWorkflow, trusted); } catch { fail('INPUT_INVALID'); }
  const semanticWorkflowHash = await digestArtifact('semantic-workflow', source);
  if (artifact.semanticWorkflowHash !== semanticWorkflowHash) fail('WORKFLOW_BINDING_MISMATCH');
  let derived: DerivedBaseObservation;
  try { derived = await deriveBaseObservation(input.transcript, { workflow: source, nodeId: artifact.nodeId }, trusted); }
  catch (cause) { throw cause instanceof BaseObservationError ? cause : new BaseObservationError('DERIVATION_MISMATCH'); }
  if (!same(derived.artifact, artifact)) fail('DERIVATION_MISMATCH');

  let currentHash: string | null;
  try { currentHash = await digestArtifact('semantic-workflow', input.currentWorkflow); } catch { currentHash = null; }
  const invalidated = currentHash !== semanticWorkflowHash || !isRecord(input.currentWorkflow)
    || input.currentWorkflow.revision !== source.revision;
  const observedMs = Date.parse(artifact.freshness.observedAt), expiresMs = Date.parse(artifact.freshness.expiresAt);
  const expired = input.nowMs >= expiresMs || input.nowMs < observedMs - BASE_OBSERVATION_PROFILE.maximumClockSkewSeconds * 1000;
  return freeze({
    status: invalidated ? 'INVALIDATED' : expired ? 'EXPIRED' : 'CURRENT',
    nodeId: artifact.nodeId, revision: source.revision,
    artifactHash: await digestArtifact('quote-state-artifact', artifact),
    rawResponseHash: artifact.rawResponseHash, semanticWorkflowHash,
    observedAt: artifact.freshness.observedAt, expiresAt: artifact.freshness.expiresAt, retrievedAt: artifact.retrievedAt,
    facts: derived.facts,
    evidence: 'NOT_EVIDENCE', authorizable: false, executable: false, authorization: 'NONE', enforcement: 'NOT_ENFORCED',
  });
}

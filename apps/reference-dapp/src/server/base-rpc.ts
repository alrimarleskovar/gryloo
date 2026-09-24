// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashArtifactBytes, parseJsonBytes } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import {
  BASE_OBSERVATION_PROFILE, BaseObservationError, collectBaseTranscript, createReviewContext, deriveBaseObservation,
  digestArtifact, validateAuthoringWorkflow, type BaseTransport, type ObservationSwap,
} from '@defi-workflow-engine/reference-linter';
import type { ReadResult } from '../domain/base-observation';
import { SWAP_ACTION, swapDetails } from '../domain/swap-authoring';

/** The single fixed Alchemy destination. The API key is sent only in a server-side Bearer header. */
export const BASE_RPC_URL = 'https://base-mainnet.g.alchemy.com/v2';
export const REPLAY_FILE = join('e2e', 'observations', 'base-recorded-observations.json');
/** Amendment 1: requests about 400 ms apart (start to start) and a 1-second pause after the head read. */
export const LIVE_LIMITS = Object.freeze({ attempts: 3, requests: 63, intervalMs: 10_000, requestTimeoutMs: 5_000, settleMs: 1_000, requestSpacingMs: 400 });
const RECORDINGS_FORMAT = 'gryloo.base-observation-recordings.v1';

const MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  OBSERVATION_OFF: 'Base reads are off on this server. Live reads are for explicitly enabled local development only.',
  CONFIGURATION_INVALID: 'The Base read configuration is invalid. Live Base reads are for local development only.',
  THROTTLED: 'A Base read is already running, or the last live read started less than 10 seconds ago.',
  LIVE_LIMIT_REACHED: 'This server process has used its live read limit of 3 attempts and 63 requests.',
  LIVE_SESSION_STOPPED: 'Live reads stopped for this server process after a provider failure. Restart the local server to read again.',
  INPUT_INVALID: 'The workflow or swap node is not valid for a Base read.',
  PROVIDER_RATE_LIMITED: 'The Base provider rate-limited the read (HTTP 429). Live reads stopped for this server process.',
  PROVIDER_ERROR: 'The provider returned an error. No values are shown.',
  PINNED_READ_REJECTED: 'The provider rejected a read pinned to the block hash. No fallback read was made.',
  TRANSPORT_FAILED: 'The provider could not be reached in time, or its response was not acceptable.',
  RPC_RESPONSE_INVALID: 'The provider returned a malformed response.',
  WRONG_CHAIN: 'The provider is not serving Base mainnet (chain ID 8453).',
  REORG_DETECTED: 'The pinned block was replaced during the read.',
  BLOCK_INCONSISTENT: 'The provider returned inconsistent block data.',
  STALE_BLOCK: "The provider's latest block was more than 15 seconds old at completion.",
  CLOCK_SKEW: "The block time is ahead of this computer's clock.",
  CODE_MISSING: 'A required contract has no code at the pinned block.',
  CODE_DIGEST_MISMATCH: 'Contract code differs from the reviewed pin.',
  ASSET_METADATA_MISMATCH: 'Token decimals or symbol differ from the registry.',
  DEPLOYMENT_MISMATCH: 'QuoterV2 is not linked to the documented factory and WETH.',
  REPLAY_MISMATCH: 'No committed recording matches this swap exactly. Replay covers only the recorded swaps.',
  TRANSCRIPT_TOO_LARGE: 'The transcript exceeded 1,048,576 bytes.',
  REQUEST_BUDGET_EXCEEDED: 'The read plan exceeded 21 requests.',
  DIGEST_UNAVAILABLE: 'The hashing self-check failed. No values are shown.',
  DERIVATION_MISMATCH: 'The transcript did not re-derive to the same observation.',
  INTERNAL_ERROR: 'The Base read failed unexpectedly. No values are shown.',
});
/** Provider failures and inconsistent responses stop live reads for the rest of the process. */
const TRIPS = new Set(['PROVIDER_RATE_LIMITED', 'PROVIDER_ERROR', 'PINNED_READ_REJECTED', 'TRANSPORT_FAILED', 'RPC_RESPONSE_INVALID',
  'WRONG_CHAIN', 'REORG_DETECTED', 'BLOCK_INCONSISTENT', 'STALE_BLOCK', 'CLOCK_SKEW', 'CODE_MISSING', 'CODE_DIGEST_MISMATCH',
  'ASSET_METADATA_MISMATCH', 'DEPLOYMENT_MISMATCH', 'TRANSCRIPT_TOO_LARGE', 'REQUEST_BUDGET_EXCEEDED', 'DERIVATION_MISMATCH', 'INTERNAL_ERROR']);

export type ServerMode = 'off' | 'live' | 'replay';
type Env = Readonly<Record<string, string | undefined>>;

/** Live mode requires the Next development phase; production builds refuse it. */
export function observationMode(env: Env): ServerMode {
  const value = env.GRYLOO_BASE_OBSERVATION;
  if (value === undefined || value === '' || value === 'off') return 'off';
  if (value === 'replay') return 'replay';
  if (value === 'live' && env.NODE_ENV === 'development') return 'live';
  throw new BaseObservationError('CONFIGURATION_INVALID');
}

interface LiveState { attempts: number; requests: number; inFlight: boolean; lastStartMs: number | null; lastSendMs: number | null; stopped: string | null; highestBlock: number | null }
/** Held on globalThis so development module reloads cannot reset the limits. */
function liveState(): LiveState {
  const key = Symbol.for('gryloo.base-observation.live');
  const holder = globalThis as unknown as Record<symbol, LiveState | undefined>;
  holder[key] ??= { attempts: 0, requests: 0, inFlight: false, lastStartMs: null, lastSendMs: null, stopped: null, highestBlock: null };
  return holder[key];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keysAre = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;

/** Re-checks every outgoing request against the method, target and selector allowlists. */
export function assertAllowed(text: string): void {
  function deny(): never { throw new BaseObservationError('INTERNAL_ERROR'); }
  let request: unknown;
  try { request = JSON.parse(text); } catch { deny(); }
  if (!isRecord(request) || !keysAre(request, ['id', 'jsonrpc', 'method', 'params']) || request.jsonrpc !== '2.0'
      || typeof request.id !== 'number' || !Number.isSafeInteger(request.id) || request.id < 1
      || request.id > BASE_OBSERVATION_PROFILE.maximumRequests || !Array.isArray(request.params)) deny();
  const { contracts: c, selectors: s } = BASE_OBSERVATION_PROFILE;
  const params = (request as { params: unknown[] }).params;
  const pinned = (value: unknown) => isRecord(value) && keysAre(value, ['blockHash', 'requireCanonical'])
    && typeof value.blockHash === 'string' && /^0x[0-9a-f]{64}$/.test(value.blockHash) && value.requireCanonical === true;
  switch ((request as { method: unknown }).method) {
    case 'eth_chainId':
      if (params.length !== 0) deny();
      return;
    case 'eth_getBlockByNumber':
      if (params.length !== 2 || params[1] !== false || !(params[0] === 'latest' || (typeof params[0] === 'string' && QUANTITY.test(params[0])))) deny();
      return;
    case 'eth_getCode':
      if (params.length !== 2 || ![c.usdc, c.weth, c.factory, c.quoter].includes(params[0] as never) || !pinned(params[1])) deny();
      return;
    case 'eth_call': {
      const call = params[0];
      if (params.length !== 2 || !pinned(params[1]) || !isRecord(call) || !keysAre(call, ['data', 'to'])
          || typeof call.to !== 'string' || typeof call.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(call.data)) deny();
      const { to, data } = call as { to: string; data: string };
      const selector = data.slice(0, 10), size = data.length;
      const allowed = ((selector === s.decimals || selector === s.symbol) && (to === c.usdc || to === c.weth) && size === 10)
        || ((selector === s.factory || selector === s.weth9) && to === c.quoter && size === 10)
        || (selector === s.getPool && to === c.factory && size === 10 + 192)
        || (selector === s.quoteExactInputSingle && to === c.quoter && size === 10 + 320);
      if (!allowed) deny();
      return;
    }
    default:
      deny();
  }
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new BaseObservationError('TRANSPORT_FAILED');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch { throw new BaseObservationError('TRANSPORT_FAILED'); }
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new BaseObservationError('TRANSPORT_FAILED');
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** The live transport: the only network egress in application and linter source. */
function liveTransport(state: LiveState, credential: string, deadline: AbortSignal, now: () => number, wait: (milliseconds: number) => Promise<void>): BaseTransport {
  return async (request) => {
    assertAllowed(request);
    if (state.requests >= LIVE_LIMITS.requests) throw new BaseObservationError('LIVE_LIMIT_REACHED');
    // Space consecutive requests; the pause never skips the limit or deadline checks.
    const spacing = state.lastSendMs === null ? 0 : state.lastSendMs + LIVE_LIMITS.requestSpacingMs - now();
    if (spacing > 0) await wait(spacing);
    state.requests += 1;
    state.lastSendMs = now();
    let response: Response;
    try {
      response = await fetch(BASE_RPC_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${credential}` }, body: request,
        redirect: 'error', cache: 'no-store', credentials: 'omit',
        signal: AbortSignal.any([AbortSignal.timeout(LIVE_LIMITS.requestTimeoutMs), deadline]),
      });
    } catch { throw new BaseObservationError('TRANSPORT_FAILED'); }
    if (response.status === 429) throw new BaseObservationError('PROVIDER_RATE_LIMITED');
    if (response.status !== 200) throw new BaseObservationError('PROVIDER_ERROR');
    if (!/^application\/json\s*(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new BaseObservationError('TRANSPORT_FAILED');
    const bytes = await readCapped(response, BASE_OBSERVATION_PROFILE.maximumResponseBytes);
    try { parseJsonBytes(bytes); } catch { throw new BaseObservationError('RPC_RESPONSE_INVALID'); }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
}

interface Recording { swap: ObservationSwap; startedAt: string; completedAt: string; exchanges: { request: string; response: string }[] }
function loadRecordings(file: string): Recording[] {
  let value: unknown;
  try { value = parseJsonBytes(new Uint8Array(readFileSync(file))); } catch { throw new BaseObservationError('REPLAY_MISMATCH'); }
  if (!isRecord(value) || !keysAre(value, ['format', 'recordings']) || value.format !== RECORDINGS_FORMAT
      || !Array.isArray(value.recordings)) throw new BaseObservationError('REPLAY_MISMATCH');
  return value.recordings.map(item => {
    if (!isRecord(item) || item.mode !== 'LIVE_READ_ONLY' || !isRecord(item.swap) || typeof item.startedAt !== 'string'
        || typeof item.completedAt !== 'string' || !Array.isArray(item.exchanges)) throw new BaseObservationError('REPLAY_MISMATCH');
    return item as unknown as Recording;
  });
}
/** Replay serves recorded responses byte-for-byte and never calls fetch. */
function replay(recordings: Recording[], swap: ObservationSwap): { transport: BaseTransport; now: () => number } {
  const recording = recordings.find(item => item.swap.from === swap.from && item.swap.to === swap.to && item.swap.amountIn === swap.amountIn);
  if (!recording) throw new BaseObservationError('REPLAY_MISMATCH');
  let index = 0, calls = 0;
  return {
    transport: async (request) => {
      const exchange = recording.exchanges[index];
      if (!exchange || exchange.request !== request) throw new BaseObservationError('REPLAY_MISMATCH');
      index += 1;
      return exchange.response;
    },
    now: () => Date.parse(calls++ === 0 ? recording.startedAt : recording.completedAt),
  };
}

export const referenceContext = () => createReviewContext({
  registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry,
});
const failure = (code: string, requestsSent = 0): ReadResult =>
  ({ ok: false, code: code in MESSAGES ? code : 'INTERNAL_ERROR', message: MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR!, requestsSent });

export interface ServerOptions {
  readonly env?: Env;
  readonly replayFile?: string;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/**
 * Reads one Base observation for one authored swap. Validation happens before
 * any request; every failure is a code with no values.
 */
export async function readBaseQuoteOnServer(input: unknown, options: ServerOptions = {}): Promise<ReadResult> {
  let mode: ServerMode;
  try { mode = observationMode(options.env ?? process.env); } catch { return failure('CONFIGURATION_INVALID'); }
  if (mode === 'off') return failure('OBSERVATION_OFF');
  const context = referenceContext();
  if (!isRecord(input) || !keysAre(input, ['workflow', 'nodeId']) || typeof input.nodeId !== 'string' || input.nodeId.length > 128) return failure('INPUT_INVALID');
  let swap: ObservationSwap;
  try {
    const workflow = validateAuthoringWorkflow(input.workflow, context);
    const node = workflow.nodes.find(candidate => candidate.nodeId === input.nodeId);
    const details = node && node.actionType === SWAP_ACTION ? swapDetails(node, context) : null;
    if (!details) return failure('INPUT_INVALID');
    swap = { from: details.from, to: details.to, amountIn: details.units };
  } catch { return failure('INPUT_INVALID'); }

  if (mode === 'replay') {
    try {
      const source = replay(loadRecordings(options.replayFile ?? join(process.cwd(), REPLAY_FILE)), swap);
      const { transcript } = await collectBaseTranscript({ swap, mode: 'RECORDED_REPLAY', providerHost: BASE_OBSERVATION_PROFILE.providerHost },
        { transport: source.transport, now: source.now, wait: async () => undefined, settleMs: 0 }, context);
      return await finish(transcript, input, context);
    } catch (cause) {
      return failure(cause instanceof BaseObservationError ? cause.code : 'INTERNAL_ERROR');
    }
  }

  // Read only from the local server environment. Never return or log the credential.
  const credential = (options.env ?? process.env).GRYLOO_ALCHEMY_API_KEY;
  if (!credential || !/^[A-Za-z0-9_-]{8,128}$/.test(credential)) return failure('CONFIGURATION_INVALID');
  const state = liveState();
  const now = options.now ?? Date.now;
  if (state.stopped) return failure('LIVE_SESSION_STOPPED');
  if (state.attempts >= LIVE_LIMITS.attempts || state.requests >= LIVE_LIMITS.requests) return failure('LIVE_LIMIT_REACHED');
  if (state.inFlight || (state.lastStartMs !== null && now() - state.lastStartMs < LIVE_LIMITS.intervalMs)) return failure('THROTTLED');
  state.inFlight = true;
  state.attempts += 1;
  state.lastStartMs = now();
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), BASE_OBSERVATION_PROFILE.maximumDurationMs);
  let requestsSent = 0;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  try {
    const collected = await collectBaseTranscript({ swap, mode: 'LIVE_READ_ONLY', providerHost: BASE_OBSERVATION_PROFILE.providerHost }, {
      transport: liveTransport(state, credential, deadline.signal, now, wait), now, wait, settleMs: LIVE_LIMITS.settleMs,
    }, context);
    requestsSent = collected.facts.requests;
    // The head never moves backwards within one process.
    if (state.highestBlock !== null && collected.facts.block.number < state.highestBlock) throw new BaseObservationError('BLOCK_INCONSISTENT');
    state.highestBlock = collected.facts.block.number;
    return await finish(collected.transcript, input, context);
  } catch (cause) {
    const code = cause instanceof BaseObservationError ? cause.code : 'INTERNAL_ERROR';
    if (cause instanceof BaseObservationError) requestsSent = Math.max(requestsSent, cause.requestsSent);
    if (TRIPS.has(code)) state.stopped = code;
    return failure(code, requestsSent);
  } finally {
    clearTimeout(timer);
    state.inFlight = false;
  }
}

async function finish(transcript: Uint8Array, input: Record<string, unknown>, context: ReturnType<typeof referenceContext>): Promise<ReadResult> {
  const { artifact } = await deriveBaseObservation(transcript, { workflow: input.workflow, nodeId: input.nodeId }, context);
  const json = JSON.stringify(artifact);
  // The frozen Node contracts and the browser-safe digest must agree on the artifact.
  if (hashArtifactBytes('quote-state-artifact', new TextEncoder().encode(json)) !== await digestArtifact('quote-state-artifact', artifact)) {
    throw new BaseObservationError('INTERNAL_ERROR');
  }
  return { ok: true, transcript: new TextDecoder('utf-8', { fatal: true }).decode(transcript), artifact: json };
}

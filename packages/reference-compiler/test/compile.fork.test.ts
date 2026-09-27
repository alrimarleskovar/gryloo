// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Fork harness readiness and lifecycle (BUILD-003D §3.2.1, §3.3.5; G5 incident of 2026-09-24).
 *
 * The exact pinned Anvil binary runs against in-test synthetic loopback upstreams on the fixed
 * harness ports 8545 and 8546. No network access, no credential and no recording; the synthetic
 * state is test-only and never a fixture or evidence input. The transcript-backed §6 compile
 * integration joins this file at G6.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_DEFAULT_ACCOUNTS, FORK_CHAIN_ID_HEX, routeForkUpstreamRequest, verifiedSourceBlockReply } from '../src/profile.js';
import {
  RPC_TIMEOUT_MS, forkRpcTimeoutMs, probePort, rpc, startFork, startReplayUpstream, stopFork, stopReplayUpstream, withFork, requirePinnedForkAddresses, verifyOwnerForkAccountSource, readOwnerForkPhrase, forkDevAccounts, transcriptIdentity,
} from '../../../apps/reference-dapp/e2e/fork/harness.mjs';
import { canonical, verifyTranscriptDocument } from '../../../apps/reference-dapp/e2e/fork/replay-upstream.mjs';
import { RecordingSession, RECORDING_POLICY, buildTranscript, readRotatedCredential, validateBilling } from '../../../apps/reference-dapp/e2e/fork/recording-proxy.mjs';
import { selectForkAccounts, sendSetupTransaction } from '../../../apps/reference-dapp/e2e/fork/fork-setup.mjs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type WireCall = { id?: Json; method?: string; params?: Json[] };
type Mode = { readonly kind: 'serve'; readonly pacingMs?: number } | { readonly kind: 'close-on'; readonly method: string } | { readonly kind: 'hang' };
type Stats = { requests: number; open: number; maxOpen: number; stops: string[]; paramsOmitted: string[]; forwardStarts: number[] };

const FORK_DEV_ACCOUNTS = forkDevAccounts();
const HARNESS = fileURLToPath(new URL('../../../apps/reference-dapp/e2e/fork/harness.mjs', import.meta.url));
const REPLAY = fileURLToPath(new URL('../../../apps/reference-dapp/e2e/fork/replay-upstream.mjs', import.meta.url));
const N = 51_800_000;
const N_HEX = `0x${N.toString(16)}`;
const H = `0x${'ab'.repeat(32)}`;
const hex = (value: bigint | number) => `0x${BigInt(value).toString(16)}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function block(): Json {
  const empty = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
  return {
    number: N_HEX, hash: H, parentHash: `0x${'cd'.repeat(32)}`, nonce: '0x0000000000000000',
    sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347', logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: empty, stateRoot: `0x${'11'.repeat(32)}`, receiptsRoot: empty,
    miner: '0x4200000000000000000000000000000000000011', difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x220',
    gasLimit: hex(150_000_000), gasUsed: '0x0', timestamp: hex(1_790_000_000), transactions: [], uncles: [],
    baseFeePerGas: hex(1_000_000), mixHash: `0x${'22'.repeat(32)}`, withdrawals: [], withdrawalsRoot: empty,
    blobGasUsed: '0x0', excessBlobGas: '0x0', parentBeaconBlockRoot: `0x${'33'.repeat(32)}`,
    requestsHash: '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };
}

/** Answers exactly as the D-5 proxy routes the raw wire request; approved forwards get synthetic state. */
function reply(call: WireCall, stats: Stats): string {
  const route = routeForkUpstreamRequest(call, N, H);
  if (!('params' in call) && typeof call.method === 'string') stats.paramsOmitted.push(call.method);
  let body: { result: Json } | { error: { code: number; message: string } };
  if (route.kind === 'stop') { stats.stops.push(`${String(call.method)}: ${route.reason}`); body = { error: { code: -32000, message: 'STOP' } }; }
  else if (route.kind === 'local-error') body = { error: { code: route.code, message: route.message } };
  else if (route.kind === 'local-null') body = { result: null };
  else if (route.kind === 'local-source-block') body = { result: verifiedSourceBlockReply(block(), N, H) as Json };
  else if (route.method === 'eth_getBlockByNumber') body = { result: block() };
  else if (route.method === 'eth_chainId') body = { result: '0x2105' };
  else if (route.method === 'eth_getCode') body = { result: codeAt.get(String(route.params[0])) ?? '0x' };
  else if (route.method === 'eth_getStorageAt') body = { result: `0x${'00'.repeat(32)}` };
  else body = { result: '0x0' };
  return JSON.stringify({ jsonrpc: '2.0', id: call.id ?? null, ...body });
}

/** Synthetic Base code per address (default empty); the EIP-7702 designator mirrors the attempt-2 evidence. */
const codeAt = new Map<string, string>();
const DESIGNATOR = '0xef01008a67b5020ee254ef48e3b6a04927f39baf7e408a';
let upstream: Server | undefined;
let blocker: TcpServer | undefined;
const children: ChildProcess[] = [];

async function listen(server: Server | TcpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
}
async function eventually(port: number, state: string): Promise<string> {
  let observed = '';
  for (let i = 0; i < 100; i++) { observed = await probePort(port); if (observed === state) break; await sleep(20); }
  return observed;
}

/**
 * `serve` answers like the approved proxy; with `pacingMs` it serves one request at a time and
 * starts approved forwards at least that far apart, as the recording proxy must. `close-on` is
 * the consumed G5 proxy's fail-closed shape: HTTP 503, then the listener is removed. `hang`
 * accepts connections and never answers.
 */
async function startUpstream(mode: Mode): Promise<Stats> {
  const stats: Stats = { requests: 0, open: 0, maxOpen: 0, stops: [], paramsOmitted: [], forwardStarts: [] };
  const pacingMs = mode.kind === 'serve' ? mode.pacingMs ?? 0 : 0;
  let queue = Promise.resolve();
  let lastForward = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    stats.open++;
    stats.maxOpen = Math.max(stats.maxOpen, stats.open);
    response.on('close', () => { stats.open--; });
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    request.on('end', () => {
      if (mode.kind === 'hang') return;
      const call = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireCall;
      stats.requests++;
      if (mode.kind === 'close-on' && call.method === mode.method) { response.writeHead(503).end(); server.close(); return; }
      const send = () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(reply(call, stats)); };
      if (pacingMs === 0) { send(); return; }
      const forward = routeForkUpstreamRequest(call, N, H).kind === 'forward';
      queue = queue.then(async () => {
        if (forward) {
          const target = lastForward + pacingMs;
          // Monotonic clock: the WSL2 wall clock was measured stepping by seconds.
          while (performance.now() < target) await sleep(Math.ceil(target - performance.now()));
          lastForward = performance.now();
          stats.forwardStarts.push(lastForward);
        }
        send();
      });
    });
  });
  await listen(server, 8546);
  upstream = server;
  return stats;
}

function anvilBinary(): string {
  const binary = process.env.GRYLOO_ANVIL_BIN;
  if (!binary || basename(binary) !== 'anvil' || basename(dirname(binary)) !== 'foundry-v1.8.3') {
    throw new Error('GRYLOO_ANVIL_BIN must name the verified foundry-v1.8.3/anvil binary');
  }
  return binary;
}
function signalDriverEnvironment(ownerFilePath: string, pinFilePath = process.env.GRYLOO_F2_PUBLIC_PIN_FILE) {
  return { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GRYLOO_ANVIL_BIN: anvilBinary(),
    GRYLOO_FORK_ACCOUNT_PHRASE_FILE: ownerFilePath,
    ...(pinFilePath ? { GRYLOO_F2_PUBLIC_PIN_FILE: pinFilePath } : {}) };
}
const fork = (extra: Record<string, unknown> = {}) => ({ binary: anvilBinary(), blockNumber: N, blockHash: H, ...extra });
async function started<T extends ChildProcess>(child: Promise<T>): Promise<T> { const value = await child; children.push(value); return value; }

function genesisTranscript(): string {
  const exchanges: { anvilRequest: string; providerResponse?: string; localResponse?: string }[] = [];
  const provider = (method: string, params: Json[], result: Json) => exchanges.push({ anvilRequest: canonical({ method, params }), providerResponse: JSON.stringify({ jsonrpc: '2.0', id: 1, result }) });
  const local = (method: string, params: Json[]) => exchanges.push({ anvilRequest: canonical({ method, params }), localResponse: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } }) });
  provider('eth_getBlockByNumber', [N_HEX, false], block());
  local('eth_gasPrice', []);
  for (const account of FORK_DEV_ACCOUNTS) {
    local('eth_getAccountInfo', [account, H]);
    provider('eth_getBalance', [account, H], '0x0');
    provider('eth_getTransactionCount', [account, H], '0x0');
    provider('eth_getCode', [account, H], '0x');
  }
  const path = join(mkdtempSync(join(tmpdir(), 'gryloo-replay-readiness-')), 'synthetic-transcript.json');
  writeFileSync(path, `${JSON.stringify({ format: 'gryloo.base-fork-state-transcript.v1', sourceChainId: 8453, sourceBlockHash: H, exchanges })}\n`);
  return path;
}

beforeAll(() => { anvilBinary(); });

afterEach(async () => {
  codeAt.clear();
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const server of [upstream, blocker]) {
    if (!server) continue;
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  upstream = undefined;
  blocker = undefined;
  // Every test must leave both fixed ports released.
  expect(await eventually(8545, 'free')).toBe('free');
  expect(await eventually(8546, 'free')).toBe('free');
});

describe('owner-secret boundary (offline, no secret supplied)', () => {
  it('fails closed before Anvil startup or any upstream request', async () => {
    const previous = process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
    delete process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
    try {
      await expect(startFork(fork())).rejects.toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
      expect(await probePort(8545)).toBe('free');
      expect(await probePort(8546)).toBe('free');
    } finally {
      if (previous !== undefined) process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = previous;
    }
  });
  it('rejects nonmatching derived public addresses without revealing inputs', () => {
    expect(() => requirePinnedForkAddresses([...FORK_DEV_ACCOUNTS].reverse())).toThrow(/^FORK_ACCOUNT_DERIVATION_MISMATCH$/);
    expect(() => requirePinnedForkAddresses([])).toThrow(/^FORK_ACCOUNT_DERIVATION_MISMATCH$/);
    expect(() => requirePinnedForkAddresses([...FORK_DEV_ACCOUNTS])).not.toThrow();
  });
});

describe('credential-free secret and inclusion boundaries', () => {
  it('passes only a non-secret file path to deferred signal children', () => {
    const filePath = '/tmp/gryloo-f2-placeholder-owner-file';
    const env = signalDriverEnvironment(filePath);
    expect(env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE).toBe(filePath);
    expect(Object.keys(env).sort()).toEqual(['GRYLOO_ANVIL_BIN', 'GRYLOO_FORK_ACCOUNT_PHRASE_FILE', ...(process.env.GRYLOO_F2_PUBLIC_PIN_FILE ? ['GRYLOO_F2_PUBLIC_PIN_FILE'] : []), 'HOME', 'PATH'].sort());
    expect(signalDriverEnvironment(filePath, '/tmp/gryloo-f2-placeholder-public-pins').GRYLOO_F2_PUBLIC_PIN_FILE).toBe('/tmp/gryloo-f2-placeholder-public-pins');
  });
  it('rejects missing or mismatched public derivation without leakage', async () => {
    const opaque = Object.freeze({ tag: 'owner-input-never-a-secret' });
    let deriveCalls = 0;
    await expect(verifyOwnerForkAccountSource({ load: () => { throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE'); },
      derive: async () => { deriveCalls++; return [...FORK_DEV_ACCOUNTS]; } })).rejects.toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
    expect(deriveCalls).toBe(0);
    const mismatch = await verifyOwnerForkAccountSource({ load: () => opaque,
      derive: async (value: unknown) => { expect(value).toBe(opaque); return [...FORK_DEV_ACCOUNTS].reverse(); } })
      .then(() => null, (error: Error) => error);
    expect(mismatch?.message).toBe('FORK_ACCOUNT_DERIVATION_MISMATCH');
    expect(mismatch?.message).not.toContain(opaque.tag);
    expect(await verifyOwnerForkAccountSource({ load: () => opaque,
      derive: async () => [...FORK_DEV_ACCOUNTS] })).toBe(opaque);
  });

  it('rejects unsafe owner-file permissions, symlinks and malformed input without outputting its bytes', () => {
    const previous = process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
    const directory = mkdtempSync(join(tmpdir(), 'gryloo-f1-secret-boundary-'));
    const path = join(directory, 'owner-input');
    const alias = join(directory, 'alias');
    const marker = 'not-a-phrase';
    writeFileSync(path, marker, { mode: 0o600 });
    symlinkSync(path, alias);
    try {
      process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = alias;
      expect(() => readOwnerForkPhrase()).toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
      process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = path;
      chmodSync(path, 0o644);
      expect(() => readOwnerForkPhrase()).toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
      chmodSync(path, 0o600);
      const error = (() => { try { readOwnerForkPhrase(); return null; } catch (failure) { return failure as Error; } })();
      expect(error?.message).toBe('FORK_ACCOUNT_SECRET_INVALID');
      expect(error?.message).not.toContain(marker);
    } finally {
      if (previous === undefined) delete process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
      else process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = previous;
    }
  });

  it('polls through delayed receipt visibility and verifies block, nonce and order', async () => {
    const from = FORK_DEV_ACCOUNTS[0], to = FORK_DEV_ACCOUNTS[1];
    const hash = `0x${'12'.repeat(32)}`, blockHash = `0x${'34'.repeat(32)}`;
    let polls = 0, submitted = false;
    const call = async (method: string, params: unknown[] = []): Promise<unknown> => {
      if (method === 'eth_getTransactionCount') return params[1] === 'pending' ? '0x0' : '0x1';
      if (method === 'eth_getBlockByNumber') return params[0] === 'latest' ? { baseFeePerGas: '0x1' }
        : { hash: blockHash, number: '0x2', transactions: [{ hash }] };
      if (method === 'eth_sendTransaction') return hash;
      if (method === 'eth_getTransactionReceipt') {
        polls++;
        return polls < 3 ? null : { transactionHash: hash, status: '0x1', blockHash,
          blockNumber: '0x2', transactionIndex: '0x0' };
      }
      if (method === 'eth_getTransactionByHash') return { hash, from, to, nonce: '0x0', blockHash, blockNumber: '0x2' };
      throw new Error('UNEXPECTED_TEST_CALL');
    };
    const result = await sendSetupTransaction(from, to, '0x', 0n,
      { call, pollIntervalMs: 1, receiptDeadlineMs: 1_000, onSubmitted: () => { submitted = true; } });
    expect(submitted).toBe(true);
    expect(polls).toBe(3);
    expect(result).toEqual({ hash, nonce: '0x0', blockNumber: '0x2', blockHash });
  });

  it('rejects a wrong receipt, nonce, index and failed status before advancing setup', async () => {
    const from = FORK_DEV_ACCOUNTS[0], to = FORK_DEV_ACCOUNTS[1];
    const hash = `0x${'ab'.repeat(32)}`, blockHash = `0x${'cd'.repeat(32)}`;
    for (const fault of ['receipt-hash', 'status', 'nonce', 'index'] as const) {
      const call = async (method: string, params: unknown[] = []): Promise<unknown> => {
        if (method === 'eth_getTransactionCount') return params[1] === 'pending' ? '0x0' : '0x1';
        if (method === 'eth_getBlockByNumber') return params[0] === 'latest' ? { baseFeePerGas: '0x1' }
          : { hash: blockHash, number: '0x2', transactions: [{ hash }] };
        if (method === 'eth_sendTransaction') return hash;
        if (method === 'eth_getTransactionReceipt') return { transactionHash: fault === 'receipt-hash' ? `0x${'ef'.repeat(32)}` : hash,
          status: fault === 'status' ? '0x0' : '0x1', blockHash, blockNumber: '0x2',
          transactionIndex: fault === 'index' ? '0x1' : '0x0' };
        if (method === 'eth_getTransactionByHash') return { hash, from, to,
          nonce: fault === 'nonce' ? '0x1' : '0x0', blockHash, blockNumber: '0x2' };
        throw new Error('UNEXPECTED_TEST_CALL');
      };
      await expect(sendSetupTransaction(from, to, '0x', 0n, { call })).rejects.toThrow(
        fault === 'receipt-hash' || fault === 'status' ? /^SETUP_TRANSACTION_FAILED$/ : /^SETUP_INCLUSION_MISMATCH$/);
    }
  });

  it('rejects a mismatched mined block and an inclusion timeout', async () => {
    const from = FORK_DEV_ACCOUNTS[0], to = FORK_DEV_ACCOUNTS[1];
    const hash = `0x${'56'.repeat(32)}`, blockHash = `0x${'78'.repeat(32)}`;
    const prefix = async (method: string, params: unknown[] = []): Promise<unknown> => {
      if (method === 'eth_getTransactionCount') return params[1] === 'pending' ? '0x0' : '0x1';
      if (method === 'eth_getBlockByNumber') return params[0] === 'latest' ? { baseFeePerGas: '0x1' }
        : { hash: `0x${'90'.repeat(32)}`, number: '0x2', transactions: [{ hash }] };
      if (method === 'eth_sendTransaction') return hash;
      if (method === 'eth_getTransactionReceipt') return { transactionHash: hash, status: '0x1', blockHash,
        blockNumber: '0x2', transactionIndex: '0x0' };
      if (method === 'eth_getTransactionByHash') return { hash, from, to, nonce: '0x0', blockHash, blockNumber: '0x2' };
      throw new Error('UNEXPECTED_TEST_CALL');
    };
    await expect(sendSetupTransaction(from, to, '0x', 0n, { call: prefix })).rejects.toThrow(/^SETUP_INCLUSION_MISMATCH$/);
    const neverIncluded = async (method: string, params: unknown[] = []) =>
      method === 'eth_getTransactionCount' ? (params[1] === 'pending' ? '0x0' : '0x1')
        : method === 'eth_getBlockByNumber' ? { baseFeePerGas: '0x1' }
          : method === 'eth_sendTransaction' ? hash : null;
    await expect(sendSetupTransaction(from, to, '0x', 0n,
      { call: neverIncluded, pollIntervalMs: 1, receiptDeadlineMs: 3 })).rejects.toThrow(/^SETUP_RECEIPT_TIMEOUT$/);
  });
});

describe('fork harness readiness and lifecycle (offline)', () => {
  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('starts Anvil only once its upstream listens, and is ready on Anvil\'s own readiness line', async () => {
    const stats = await startUpstream({ kind: 'serve' });
    const child = await started(startFork(fork()));
    expect(await rpc('eth_chainId')).toBe(FORK_CHAIN_ID_HEX);
    // The G5 wire form (eth_gasPrice without params) is routed locally and nothing stops.
    expect(stats.paramsOmitted).toEqual(['eth_gasPrice']);
    expect(stats.stops).toEqual([]);
    await stopFork(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(await probePort(8545)).toBe('free');
  }, 30_000);

  // Without the owner secret the secret boundary fails first; with it, the port guards themselves must refuse.
  const secretSupplied = Boolean(process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE);
  it('refuses to start Anvil before its upstream is listening', async () => {
    expect(await probePort(8546)).toBe('free');
    await expect(startFork(fork())).rejects.toThrow(secretSupplied ? /^UPSTREAM_NOT_READY$/ : /^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
    expect(await probePort(8545)).toBe('free');
  });

  it('refuses an occupied Anvil port without starting Anvil or touching the other listener', async () => {
    const stats = await startUpstream({ kind: 'serve' });
    blocker = createTcpServer((socket) => socket.destroy());
    await listen(blocker, 8545);
    await expect(startFork(fork())).rejects.toThrow(secretSupplied ? /^FORK_PORT_OCCUPIED:8545$/ : /^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
    expect(stats.requests).toBe(0);
    expect(await probePort(8545)).toBe('listening');
  });

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('reports Anvil\'s exit with the closed upstream (the G5 shape) and quotes stderr only', async () => {
    await startUpstream({ kind: 'close-on', method: 'eth_gasPrice' });
    const error = await startFork(fork()).then(() => null, (reason: unknown) => reason as Error);
    expect(error?.message).toMatch(/^ANVIL_EXITED:upstream=free:code=1:signal=null:genesis_connection_refused$/);
    expect(error?.message).not.toMatch(/Private Keys|Mnemonic|Listening on/);
  }, 30_000);

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('times out a hung startup, then kills Anvil and releases its port', async () => {
    await startUpstream({ kind: 'hang' });
    const begin = performance.now();
    await expect(startFork(fork({ startupDeadlineMs: 1_500 }))).rejects.toThrow(/^ANVIL_START_TIMEOUT:upstream=listening:/);
    expect(performance.now() - begin).toBeLessThan(10_000);
  }, 30_000);

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('waits for a paced recording-mode genesis beyond the former fixed ten-second loop', async () => {
    const stats = await startUpstream({ kind: 'serve', pacingMs: 400 });
    const begin = performance.now();
    const child = await started(startFork(fork({ recording: true })));
    expect(performance.now() - begin).toBeGreaterThan(10_000);
    // Block N plus balance, nonce and code for ten dev accounts: 31 approved forwards before readiness.
    expect(stats.forwardStarts).toHaveLength(31);
    const gaps = stats.forwardStarts.slice(1).map((time, index) => time - stats.forwardStarts[index]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(400);
    // Anvil sends its genesis reads concurrently, so a paced upstream must queue rather than stop.
    expect(stats.maxOpen).toBeGreaterThan(1);
    expect(stats.stops).toEqual([]);
    expect(forkRpcTimeoutMs()).toBe(RPC_TIMEOUT_MS.recording);
    await stopFork(child);
    expect(forkRpcTimeoutMs()).toBe(RPC_TIMEOUT_MS.replay);
  }, 60_000);

  for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
    it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)(`kills Anvil when the harness process receives ${signal}`, async () => {
      await startUpstream({ kind: 'serve' });
      const driver = join(mkdtempSync(join(tmpdir(), 'gryloo-harness-interrupt-')), 'driver.mjs');
      writeFileSync(driver, [
        `import { withFork } from ${JSON.stringify(HARNESS)};`,
        `await withFork({ binary: process.env.GRYLOO_ANVIL_BIN, blockNumber: ${N}, blockHash: ${JSON.stringify(H)} }, async () => {`,
        `  process.stdout.write('FORK_READY\\n');`,
        '  await new Promise(() => {});',
        '});',
      ].join('\n'));
      const child = spawn(process.execPath, [driver], { stdio: ['ignore', 'pipe', 'pipe'],
        env: signalDriverEnvironment(process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE!) });
      children.push(child);
      const exited = new Promise<number | null>((resolve) => child.once('exit', (exitCode) => resolve(exitCode)));
      await new Promise<void>((resolve, reject) => {
        child.stdout?.on('data', (chunk: Buffer) => { if (chunk.toString('utf8').includes('FORK_READY')) resolve(); });
        void exited.then(() => reject(new Error('driver exited before readiness')));
      });
      expect(await probePort(8545)).toBe('listening');
      child.kill(signal);
      expect(await exited).toBe(code);
      expect(await eventually(8545, 'free')).toBe('free');
    }, 30_000);
  }

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('stops Anvil and releases its port when the scenario fails', async () => {
    await startUpstream({ kind: 'serve' });
    await expect(withFork(fork(), async () => { throw new Error('SCENARIO_FAILED'); })).rejects.toThrow(/^SCENARIO_FAILED$/);
    expect(await probePort(8545)).toBe('free');
  }, 30_000);
});

describe('closed replay upstream readiness (offline)', () => {
  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('starts Anvil from a closed transcript only after the replay upstream reports its bind', async () => {
    const replay = await started(startReplayUpstream(genesisTranscript()));
    expect(await probePort(8546)).toBe('listening');
    // The params-omitted wire form is served from its canonical `[]` entry.
    const response = await fetch('http://127.0.0.1:8546', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'eth_gasPrice' }) });
    expect(await response.json()).toEqual({ jsonrpc: '2.0', id: 9, error: { code: -32601, message: 'method not found' } });
    const child = await started(startFork(fork()));
    const metadata = await rpc('anvil_metadata') as { forkedNetwork: { forkBlockNumber: number; forkBlockHash: string } };
    expect(metadata.forkedNetwork).toMatchObject({ forkBlockNumber: N, forkBlockHash: H });
    await stopFork(child);
    await stopReplayUpstream(replay);
  }, 30_000);

  it('refuses an occupied upstream port', async () => {
    blocker = createTcpServer((socket) => socket.destroy());
    await listen(blocker, 8546);
    await expect(startReplayUpstream(genesisTranscript())).rejects.toThrow(/^FORK_PORT_OCCUPIED:8546$/);
  });

  it('reports a replay upstream that exits before readiness', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gryloo-replay-invalid-')), 'invalid.json');
    writeFileSync(path, '{}\n');
    await expect(startReplayUpstream(path)).rejects.toThrow(/^REPLAY_UPSTREAM_EXITED:code=1:/);
  }, 30_000);

  it('prints its readiness line only after a successful bind', async () => {
    blocker = createTcpServer((socket) => socket.destroy());
    await listen(blocker, 8546);
    const child = spawn(process.execPath, [REPLAY, genesisTranscript()], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const exitCode = await new Promise<number | null>((resolve) => child.once('close', (value) => resolve(value)));
    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('REPLAY_UPSTREAM_BIND_FAILED:EADDRINUSE\n');
  }, 30_000);
});

describe('Amendment 6 account derivation and clean-account selection (offline)', () => {
  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('exposes exactly the ten pinned Gryloo test accounts and selects the lowest two with empty code', async () => {
    await startUpstream({ kind: 'serve' });
    const child = await started(startFork(fork()));
    const accounts = (await rpc('eth_accounts') as string[]).map(a => a.toLowerCase());
    expect(accounts).toEqual([...FORK_DEV_ACCOUNTS]);
    expect(accounts.some(a => (ANVIL_DEFAULT_ACCOUNTS as readonly string[]).includes(a))).toBe(false);
    expect(await selectForkAccounts(rpc)).toMatchObject({ ownerIndex: 0, setupIndex: 1, owner: FORK_DEV_ACCOUNTS[0], setup: FORK_DEV_ACCOUNTS[1] });
    await stopFork(child);
  }, 30_000);

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('disqualifies EIP-7702 designators recorded on Base: recording selects the next clean indices, replay refuses changed pins', async () => {
    codeAt.set(FORK_DEV_ACCOUNTS[0], DESIGNATOR); codeAt.set(FORK_DEV_ACCOUNTS[1], DESIGNATOR);
    await startUpstream({ kind: 'serve' });
    const child = await started(startFork(fork()));
    expect(await rpc('eth_getCode', [FORK_DEV_ACCOUNTS[0], 'latest'])).toBe(DESIGNATOR); // forked code is kept, never wiped
    expect(await selectForkAccounts(rpc, { requirePinnedIndices: false })).toMatchObject({ ownerIndex: 2, setupIndex: 3 });
    await expect(selectForkAccounts(rpc)).rejects.toThrow(/^DEV_ACCOUNT_PINS_DIFFER:2,3$/);
    await stopFork(child);
  }, 30_000);

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('disqualifies any other non-empty code and stops when fewer than two accounts are clean', async () => {
    FORK_DEV_ACCOUNTS.slice(0, 9).forEach((account, i) => codeAt.set(account, i % 2 ? DESIGNATOR : '0x6000'));
    await startUpstream({ kind: 'serve' });
    const child = await started(startFork(fork()));
    await expect(selectForkAccounts(rpc, { requirePinnedIndices: false })).rejects.toThrow(/^DEV_ACCOUNTS_NOT_CLEAN$/);
    await stopFork(child);
  }, 30_000);

  it('rejects wrong chain or account code before setup', async () => {
    let sends = 0;
    const wrongChain = async (method: string) => { if (method === 'eth_sendTransaction') sends++; return '0x2105'; };
    await expect(selectForkAccounts(wrongChain)).rejects.toThrow(/^MAINNET_CHAIN_REFUSED$/);
    const coded = async (method: string) => method === 'eth_chainId' ? FORK_CHAIN_ID_HEX
      : method === 'eth_accounts' ? [...FORK_DEV_ACCOUNTS]
        : method === 'eth_getCode' ? '0xef0100' : (sends++, null);
    await expect(selectForkAccounts(coded)).rejects.toThrow(/^DEV_ACCOUNTS_NOT_CLEAN$/);
    expect(sends).toBe(0);
  });

  it('stops on any account set other than the exact pinned derivation', async () => {
    const stub = (accounts: string[]) => async (method: string) => (method === 'eth_chainId' ? FORK_CHAIN_ID_HEX : method === 'eth_accounts' ? accounts : '0x');
    await expect(selectForkAccounts(stub([...ANVIL_DEFAULT_ACCOUNTS]))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub([...FORK_DEV_ACCOUNTS].reverse()))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub(FORK_DEV_ACCOUNTS.slice(0, 9)))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub([...FORK_DEV_ACCOUNTS]))).resolves.toMatchObject({ ownerIndex: 0, setupIndex: 1 });
  });
});

describe('BUILD-003F recording proxy preflight (zero provider requests, scripted replies)', () => {
  const MARKER = 'syntheticcredentialmarker0123456789';
  const OWNER = '0x0000000000000000000000000000000000000abc';
  const billing = { format: 'gryloo.build-003f-provider-billing.v1', provider: 'Alchemy', plan: 'Free', network: 'Base Mainnet',
    paymentMethod: false, paidAddOn: false, overage: false, autoUpgrade: false, credentialRotated: true, previousCredentialDeleted: true,
    rotatedOn: '2026-09-25', reportedOn: '2026-09-25', remainingMonthlyCu: 39_000 };
  const finalized = { number: N_HEX, hash: H, timestamp: hex(1_790_000_000) };
  type Reply = { status?: number; body?: string; error?: Error };
  function session(script: (request: { method: string; params: Json[]; id: number }) => Reply, options: { clockStep?: number } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'gryloo-proxy-preflight-'));
    const sent: { method: string; params: Json[] }[] = [];
    const sleeps: number[] = [];
    let now = 0;
    const provider = async (body: string) => {
      const request = JSON.parse(body) as { method: string; params: Json[]; id: number };
      sent.push({ method: request.method, params: request.params });
      const reply = script(request);
      if (reply.error) throw reply.error;
      return { status: reply.status ?? 200, body: reply.body ?? JSON.stringify({ jsonrpc: '2.0', id: request.id, result: null }) };
    };
    const value = new RecordingSession({ journalPath: join(directory, 'journal.json'), logPath: join(directory, 'requests.jsonl'),
      stopFile: join(directory, 'STOP'), provider, credential: MARKER, billing,
      clock: () => { now += options.clockStep ?? 0; return now; }, sleep: async (ms: number) => { sleeps.push(ms); now += ms; } });
    value.activate();
    return { value, sent, sleeps, directory, advance: (ms: number) => { now += ms; } };
  }
  const answer = (result: Json) => (request: { id: number }) => ({ body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
  const standard = (request: { method: string; params: Json[]; id: number }): Reply => {
    if (request.method === 'eth_getBlockByNumber') return answer(finalized)(request);
    if (request.method === 'eth_chainId') return answer('0x2105')(request);
    return answer('0x0')(request);
  };
  const rpcRequest = (id: number, method: string, params?: Json[]) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

  it('requires the finalized read first, rewrites state reads to the canonical hash pin, paces sends and logs no credential', async () => {
    const early = session(standard);
    await expect(early.value.handle(rpcRequest(1, 'eth_chainId', []))).rejects.toThrow(/^FINALIZED_FIRST_REQUIRED$/);
    expect(early.sent).toHaveLength(0);
    const { value, sent, sleeps, directory } = session(standard);
    await value.handle(rpcRequest(1, 'eth_getBlockByNumber', ['finalized', false]));
    await value.handle(rpcRequest(2, 'eth_chainId', []));
    await value.handle(rpcRequest(3, 'eth_getBalance', [OWNER, H]));
    await value.handle(rpcRequest(4, 'eth_gasPrice'));
    await value.handle(rpcRequest(5, 'eth_getBlockByNumber', [N_HEX, false]));
    expect(sent).toEqual([{ method: 'eth_getBlockByNumber', params: ['finalized', false] }, { method: 'eth_chainId', params: [] },
      { method: 'eth_getBalance', params: [OWNER, { blockHash: H, requireCanonical: true }] }, { method: 'eth_getBlockByNumber', params: [N_HEX, false] }]);
    expect(sleeps.every(ms => ms === RECORDING_POLICY.spacingMs)).toBe(true);
    expect(sleeps).toHaveLength(3);
    const journal = JSON.parse(readFileSync(join(directory, 'journal.json'), 'utf8'));
    expect(journal).toMatchObject({ status: 'ACTIVE', requests: 4, reservedCu: 104, localReplies: 1, source: { blockNumber: N, blockHash: H } });
    const log = readFileSync(join(directory, 'requests.jsonl'), 'utf8');
    expect(log).not.toContain(MARKER);
    expect(log).not.toMatch(/authorization|bearer/i);
  });

  it('permanently stops on the first provider, policy, canonicality, budget, time or owner stop condition', async () => {
    const cases: [string, (request: { method: string; params: Json[]; id: number }) => Reply, (s: ReturnType<typeof session>) => Promise<unknown>][] = [
      ['PROVIDER_HTTP_429', request => request.method === 'eth_chainId' ? { status: 429, body: '' } : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['PROVIDER_RPC_ERROR', request => request.method === 'eth_chainId' ? { body: JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'x' } }) } : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['PROVIDER_INVALID_JSON', request => request.method === 'eth_chainId' ? { body: '{' } : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['PROVIDER_RESPONSE_TOO_LARGE', request => request.method === 'eth_chainId' ? { body: ' '.repeat(RECORDING_POLICY.maxResponseBytes + 1) } : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['PROVIDER_TIMEOUT', request => request.method === 'eth_chainId' ? { error: new Error('PROVIDER_TIMEOUT') } : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['SOURCE_CHAIN_MISMATCH', request => request.method === 'eth_chainId' ? answer('0x1')(request) : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['SOURCE_BLOCK_CHANGED', request => request.params[0] === N_HEX ? answer({ ...finalized, hash: `0x${'ef'.repeat(32)}` })(request) : standard(request), s => s.value.handle(rpcRequest(2, 'eth_getBlockByNumber', [N_HEX, false]))],
      ['SENSITIVE_RESPONSE_REJECTED', request => request.method === 'eth_chainId' ? answer(`0x2105${MARKER}`)(request) : standard(request), s => s.value.handle(rpcRequest(2, 'eth_chainId', []))],
      ['UNAPPROVED_UPSTREAM', standard, s => s.value.handle(rpcRequest(2, 'eth_call', [{ to: OWNER }, H]))],
      ['UNAPPROVED_UPSTREAM', standard, s => s.value.handle(rpcRequest(2, 'eth_getBalance', [OWNER, 'latest']))],
      ['INVALID_OR_BATCH_REQUEST', standard, s => s.value.handle([rpcRequest(2, 'eth_chainId', [])])],
      ['OWNER_STOP_FILE', standard, async s => { writeFileSync(join(s.directory, 'STOP'), ''); return s.value.handle(rpcRequest(2, 'eth_chainId', [])); }],
      ['SESSION_TIMEOUT', standard, async s => { s.advance(RECORDING_POLICY.sessionTimeoutMs + 1); return s.value.handle(rpcRequest(2, 'eth_chainId', [])); }],
      ['REQUEST_CAP_REACHED', standard, async s => { s.value.state.requests = RECORDING_POLICY.maxRequests; return s.value.handle(rpcRequest(2, 'eth_chainId', [])); }],
      ['CU_CAP_REACHED', standard, async s => { s.value.state.reservedCu = RECORDING_POLICY.maxReservedCu; return s.value.handle(rpcRequest(2, 'eth_chainId', [])); }],
    ];
    for (const [code, script, trigger] of cases) {
      const current = session(script);
      await current.value.handle(rpcRequest(1, 'eth_getBlockByNumber', ['finalized', false]));
      await expect(trigger(current), code).rejects.toThrow(new RegExp(`^${code}$`));
      const sentAtStop = current.sent.length;
      const journal = JSON.parse(readFileSync(join(current.directory, 'journal.json'), 'utf8'));
      expect(journal.status, code).toBe('STOPPED');
      expect(journal.stopReason, code).toBe(code);
      expect(JSON.stringify(journal)).not.toContain(MARKER);
      await expect(current.value.handle(rpcRequest(9, 'eth_chainId', [])), code).rejects.toThrow(/^SESSION_STOPPED$/);
      expect(current.sent.length, code).toBe(sentAtStop);
    }
    expect(RECORDING_POLICY).toMatchObject({ maxRequests: 1500, cuPerRequest: 26, maxReservedCu: 39000, spacingMs: 400,
      requestTimeoutMs: 30_000, sessionTimeoutMs: 1_800_000, maxResponseBytes: 1_048_576 });
  });

  it('completes only with the bound scenario proof and builds a verifiable credential-free transcript', async () => {
    const { value, directory } = session(request => {
      if (request.method === 'eth_getBlockByNumber') return answer(finalized)(request);
      if (request.method === 'eth_chainId') return answer('0x2105')(request);
      if (request.method === 'eth_getCode') return answer('0x')(request);
      return answer('0x0')(request);
    });
    await value.handle(rpcRequest(1, 'eth_getBlockByNumber', ['finalized', false]));
    await value.handle(rpcRequest(2, 'eth_chainId', []));
    await value.handle(rpcRequest(3, 'eth_gasPrice'));
    for (const [index, account] of FORK_DEV_ACCOUNTS.entries()) await value.handle(rpcRequest(10 + index, 'eth_getCode', [account, H]));
    expect(() => value.complete({ format: 'gryloo.build-003f-scenario-results.v1', sourceBlockHash: `0x${'00'.repeat(32)}`, sourceBlockNumber: N })).toThrow(/^COMPLETION_REFUSED$/);
    value.complete({ format: 'gryloo.build-003f-scenario-results.v1', sourceBlockHash: H, sourceBlockNumber: N });
    const journal = JSON.parse(readFileSync(join(directory, 'journal.json'), 'utf8'));
    const { identity, identityHash } = transcriptIdentity({ sourceBlockNumber: N, sourceBlockHash: H, accounts: [...FORK_DEV_ACCOUNTS] });
    const transcript = buildTranscript({ logPath: join(directory, 'requests.jsonl'), journal, identity, identityHash,
      scenarioResultsSha256: 'ab'.repeat(32), codeFingerprints: {} });
    expect(verifyTranscriptDocument(transcript, { accounts: [...FORK_DEV_ACCOUNTS] })).toEqual({ providerRequests: 12, localReplies: 1 });
    expect(JSON.stringify(transcript)).not.toContain(MARKER);
    const tampered = structuredClone(transcript);
    tampered.exchanges[0].providerResponse = tampered.exchanges[0].providerResponse.replace('0x2105', '0x2106');
    expect(() => verifyTranscriptDocument(tampered, { accounts: [...FORK_DEV_ACCOUNTS] })).toThrow(/^TRANSCRIPT_ENTRY_INVALID$/);
    expect(() => verifyTranscriptDocument({ ...transcript, note: 'an authorization header was logged' }, { accounts: [...FORK_DEV_ACCOUNTS] })).toThrow(/^TRANSCRIPT_SECRET_PATTERN$/);
    expect(() => verifyTranscriptDocument(transcript, { accounts: [...FORK_DEV_ACCOUNTS].reverse() })).toThrow(/^TRANSCRIPT_IDENTITY_INVALID$/);
  });

  it('accepts only a newly written owner-only credential file and a complete non-secret billing report', () => {
    const directory = mkdtempSync(join(tmpdir(), 'gryloo-credential-boundary-'));
    const path = join(directory, 'rotated');
    writeFileSync(path, `${MARKER}\n`, { mode: 0o600 });
    const repository = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
    const probe = (file: string, notBeforeMs: number) => { try { return readRotatedCredential(file, { notBeforeMs, repository }); } catch (error) { return (error as Error).message; } };
    expect(probe(path, 0)).toBe(MARKER);
    expect(probe(path, Date.now() + 60_000)).toBe('CREDENTIAL_NOT_ROTATED');
    chmodSync(path, 0o644);
    expect(probe(path, 0)).toBe('CREDENTIAL_FILE_INVALID');
    chmodSync(path, 0o600);
    symlinkSync(path, join(directory, 'alias'));
    expect(probe(join(directory, 'alias'), 0)).toBe('CREDENTIAL_FILE_INVALID');
    expect(probe(join(repository, 'package.json'), 0)).toBe('CREDENTIAL_FILE_INVALID');
    expect(probe('relative-path', 0)).toBe('CREDENTIAL_FILE_INVALID');
    expect(() => validateBilling(billing)).not.toThrow();
    for (const bad of [{ ...billing, plan: 'Growth' }, { ...billing, paymentMethod: true }, { ...billing, credentialRotated: false },
      { ...billing, previousCredentialDeleted: false }, { ...billing, remainingMonthlyCu: 38_999 }, { ...billing, rotatedOn: 'today' }]) {
      expect(() => validateBilling(bad)).toThrow(/^BILLING_CONFIRMATION_INCOMPLETE$/);
    }
  });
});

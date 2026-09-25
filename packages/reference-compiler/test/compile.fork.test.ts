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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ANVIL_DEFAULT_ACCOUNTS, FORK_CHAIN_ID_HEX, FORK_DEV_ACCOUNTS, routeForkUpstreamRequest, verifiedSourceBlockReply } from '../src/profile.js';
import {
  RPC_TIMEOUT_MS, forkRpcTimeoutMs, probePort, rpc, startFork, startReplayUpstream, stopFork, stopReplayUpstream, withFork, requirePinnedForkAddresses,
} from '../../../apps/reference-dapp/e2e/fork/harness.mjs';
import { canonical } from '../../../apps/reference-dapp/e2e/fork/replay-upstream.mjs';
import { selectForkAccounts } from '../../../apps/reference-dapp/e2e/fork/fork-setup.mjs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type WireCall = { id?: Json; method?: string; params?: Json[] };
type Mode = { readonly kind: 'serve'; readonly pacingMs?: number } | { readonly kind: 'close-on'; readonly method: string } | { readonly kind: 'hang' };
type Stats = { requests: number; open: number; maxOpen: number; stops: string[]; paramsOmitted: string[]; forwardStarts: number[] };

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

  it('refuses to start Anvil before its upstream is listening', async () => {
    expect(await probePort(8546)).toBe('free');
    await expect(startFork(fork())).rejects.toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
  });

  it('refuses an occupied Anvil port without starting Anvil or touching the other listener', async () => {
    const stats = await startUpstream({ kind: 'serve' });
    blocker = createTcpServer((socket) => socket.destroy());
    await listen(blocker, 8545);
    await expect(startFork(fork())).rejects.toThrow(/^FORK_ACCOUNT_SECRET_UNAVAILABLE$/);
    expect(stats.requests).toBe(0);
    expect(await probePort(8545)).toBe('listening');
  });

  it.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('reports Anvil\'s exit with the closed upstream (the G5 shape) and quotes stderr only', async () => {
    await startUpstream({ kind: 'close-on', method: 'eth_gasPrice' });
    const error = await startFork(fork()).then(() => null, (reason: unknown) => reason as Error);
    expect(error?.message).toMatch(/^ANVIL_EXITED:upstream=free:code=1:signal=null:[\s\S]*failed to create genesis[\s\S]*Connection refused/);
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
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GRYLOO_ANVIL_BIN: anvilBinary() } });
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

  it('stops on any account set other than the exact pinned derivation', async () => {
    const stub = (accounts: string[]) => async (method: string) => (method === 'eth_chainId' ? FORK_CHAIN_ID_HEX : method === 'eth_accounts' ? accounts : '0x');
    await expect(selectForkAccounts(stub([...ANVIL_DEFAULT_ACCOUNTS]))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub([...FORK_DEV_ACCOUNTS].reverse()))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub(FORK_DEV_ACCOUNTS.slice(0, 9)))).rejects.toThrow(/^DEV_ACCOUNTS_DERIVATION_MISMATCH$/);
    await expect(selectForkAccounts(stub([...FORK_DEV_ACCOUNTS]))).resolves.toMatchObject({ ownerIndex: 0, setupIndex: 1 });
  });
});

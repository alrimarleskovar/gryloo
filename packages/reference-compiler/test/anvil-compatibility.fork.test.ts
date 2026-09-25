// SPDX-License-Identifier: AGPL-3.0-only
/**
 * G1 — offline anvil compatibility gate (BUILD-003D §3.2.6, Amendment 1).
 *
 * Runs the exact pinned anvil binary against an in-test synthetic upstream on
 * 127.0.0.1. No network access and no credential. The synthetic state is
 * test-only: it is never a fixture, an evidence input or a recording.
 * Any failure stops the build for an owner decision (D-14, D-5 or D-3).
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { deriveForkPublicAddresses, readOwnerForkPhrase, requirePinnedForkAddresses } from '../../../apps/reference-dapp/e2e/fork/harness.mjs';
import { ANVIL_DEFAULT_ACCOUNTS, ANVIL_PIN, FORK_ACCOUNT_DERIVATION_PATH, FORK_CHAIN_ID_HEX, FORK_DEV_ACCOUNTS, FORK_UPSTREAM_PARAMS_OMITTED, FORK_UPSTREAM_POLICY, SOURCE_CHAIN_ID, forkAnvilArgs, forkUpstreamCall, routeForkUpstreamRequest, verifiedSourceBlockReply } from '../src/profile.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Outcome = 'forwarded' | 'local-error' | 'local-null' | 'local-source-block' | 'stop';
export type UpstreamEntry = { readonly method: string; readonly params: readonly Json[]; readonly outcome: Outcome; readonly paramsOmitted?: true } | { readonly batch: number };
type ProviderEntry = { readonly method: string; readonly params: readonly Json[] };
type Check = { id: string; pass: boolean; detail: string };

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const N = 51_800_000;
const N_HEX = `0x${N.toString(16)}`;
const H = `0x${'ab'.repeat(32)}`;
const ERROR_ADDRESS = '0x000000000000000000000000000000000000dead';
const HTTP_ERROR_ADDRESS = '0x000000000000000000000000000000000000beef';
const UNKNOWN_HASH = `0x${'5a'.repeat(32)}`;
const B = '0x000000000000000000000000000000000000b0b0';
// Hand-assembled contract: returns its first calldata word and emits it with topic 0x..01.
const RUNTIME = '0x60206000600037600160206000a160206000f3';
const INIT = `0x6013600c60003960136000f3${RUNTIME.slice(2)}`;
const WORD = `0x${'07'.repeat(32)}`;
const hex = (value: bigint | number) => `0x${BigInt(value).toString(16)}`;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** C1 — pure binary identity check (also exercised by negative self-tests). */
export function binaryFailures(bytes: Uint8Array, versionText: string): string[] {
  const failures: string[] = [];
  if (bytes.length !== ANVIL_PIN.binarySize) failures.push(`binary size ${bytes.length} != ${ANVIL_PIN.binarySize}`);
  if (sha256(bytes) !== ANVIL_PIN.binarySha256) failures.push('binary SHA-256 differs from the approved pin');
  if (versionText.trim() !== ANVIL_PIN.version) failures.push('anvil --version differs from the approved string');
  return failures;
}

function pinnedToForkBlock(param: Json | undefined): boolean {
  return typeof param === 'object' && param !== null && !Array.isArray(param)
    && Object.keys(param).sort().join(',') === 'blockHash,requireCanonical'
    && param.blockHash === H && param.requireCanonical === true;
}

/** C4 checks the provider-facing side after the D-5 proxy has routed and rewritten requests. */
export function inventoryFailures(entries: readonly UpstreamEntry[]): string[] {
  const failures: string[] = [];
  const pinned: readonly string[] = FORK_UPSTREAM_POLICY.hashPinnedStateReads;
  for (const entry of entries) {
    if ('batch' in entry) { failures.push(`batch request of ${entry.batch}`); continue; }
    if (entry.outcome === 'stop') { failures.push(`method or form outside the D-5 policy: ${entry.method}`); continue; }
    if (entry.outcome !== 'forwarded') continue;
    if (!(FORK_UPSTREAM_POLICY.forward as readonly string[]).includes(entry.method)) failures.push(`method outside the provider allowlist: ${entry.method}`);
    if (pinned.includes(entry.method) && !pinnedToForkBlock(entry.params.at(-1))) failures.push(`${entry.method} not canonically hash-pinned`);
    if (entry.method === 'eth_getBlockByNumber' && (entry.params[0] !== N_HEX || typeof entry.params[1] !== 'boolean')) failures.push('eth_getBlockByNumber for a block other than N or wrong form');
  }
  return [...new Set(failures)];
}

function block(full: boolean): Json {
  const empty = '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421';
  return {
    number: N_HEX, hash: H, parentHash: `0x${'cd'.repeat(32)}`, nonce: '0x0000000000000000',
    sha3Uncles: '0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347', logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: empty, stateRoot: `0x${'11'.repeat(32)}`, receiptsRoot: empty,
    miner: '0x4200000000000000000000000000000000000011', difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x220',
    gasLimit: hex(150_000_000), gasUsed: '0x0', timestamp: hex(1_790_000_000), transactions: full ? [] : [], uncles: [],
    baseFeePerGas: hex(1_000_000), mixHash: `0x${'22'.repeat(32)}`, withdrawals: [], withdrawalsRoot: empty,
    blobGasUsed: '0x0', excessBlobGas: '0x0', parentBeaconBlockRoot: `0x${'33'.repeat(32)}`,
    requestsHash: '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };
}

/** Synthetic answers; the policy decides only the recorded outcome. */
function synthetic(method: string, params: readonly Json[]): { result?: Json; error?: { code: number; message: string }; http500?: true } {
  const address = typeof params[0] === 'string' ? params[0].toLowerCase() : '';
  if (address === HTTP_ERROR_ADDRESS) return { http500: true };
  if (address === ERROR_ADDRESS) return { error: { code: -32000, message: 'synthetic unrecorded state' } };
  switch (method) {
    case 'eth_chainId': return { result: hex(SOURCE_CHAIN_ID) };
    case 'eth_getBlockByNumber': return params[0] === N_HEX ? { result: block(params[1] === true) } : { error: { code: -32000, message: 'unknown block' } };
    case 'eth_getBlockByHash': return params[0] === H ? { result: block(params[1] === true) } : { result: null };
    case 'eth_getBalance': case 'eth_getTransactionCount': return { result: '0x0' };
    case 'eth_getCode': return { result: '0x' };
    case 'eth_getStorageAt': return { result: `0x${'00'.repeat(32)}` };
    case 'eth_gasPrice': return { result: hex(1_000_000_000) };
    case 'eth_getTransactionByHash': case 'eth_getTransactionReceipt': return { result: null };
    default: return { error: { code: -32601, message: 'method not found' } };
  }
}

const anvilEntries: UpstreamEntry[] = [];
const providerEntries: ProviderEntry[] = [];
const checks: Check[] = [];
let server: Server;
let anvil: ChildProcess;
let anvilPort = 0;

function record(id: string, failures: readonly string[], detail = ''): void {
  checks.push({ id, pass: failures.length === 0, detail: failures.length ? failures.join('; ') : detail });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('No free port');
  return address.port;
}

type RpcReply = { result?: Json; error?: { code: number; message: string } };
async function rpc(method: string, params: Json[] = []): Promise<RpcReply> {
  const response = await fetch(`http://127.0.0.1:${anvilPort}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await response.json() as RpcReply;
}
const result = async (method: string, params: Json[] = []) => {
  const reply = await rpc(method, params);
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
  return reply.result as never;
};
async function mined<T>(send: () => Promise<T>): Promise<T> {
  const before = BigInt(await result('eth_blockNumber'));
  const value = await send();
  for (let i = 0; i < 200; i++) {
    if (BigInt(await result('eth_blockNumber')) > before) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('transaction was not mined');
}

describe('G1 negative self-tests of the gate checks', () => {
  it('rejects a wrong binary digest, a wrong size and a changed version string', () => {
    const bytes = new Uint8Array(ANVIL_PIN.binarySize);
    expect(binaryFailures(bytes, ANVIL_PIN.version)).toContain('binary SHA-256 differs from the approved pin');
    expect(binaryFailures(new Uint8Array(3), ANVIL_PIN.version)[0]).toMatch(/^binary size 3/);
    expect(binaryFailures(bytes, ANVIL_PIN.version.replace('1.8.3', '1.8.4'))).toContain('anvil --version differs from the approved string');
  });
  it('rejects extra provider methods, bare hash state reads, another block and a batch', () => {
    expect(inventoryFailures([{ method: 'eth_getProof', params: [], outcome: 'forwarded' }])).toEqual(['method outside the provider allowlist: eth_getProof']);
    expect(inventoryFailures([{ method: 'eth_getBalance', params: [B, H], outcome: 'forwarded' }])).toEqual(['eth_getBalance not canonically hash-pinned']);
    expect(inventoryFailures([{ method: 'eth_getStorageAt', params: [B, '0x0', N_HEX], outcome: 'forwarded' }])).toEqual(['eth_getStorageAt not canonically hash-pinned']);
    expect(inventoryFailures([{ method: 'eth_getBlockByNumber', params: ['latest', false], outcome: 'forwarded' }])).toEqual(['eth_getBlockByNumber for a block other than N or wrong form']);
    expect(inventoryFailures([{ batch: 2 }])).toEqual(['batch request of 2']);
    expect(inventoryFailures([{ method: 'eth_getCode', params: [B, { blockHash: H, requireCanonical: true }], outcome: 'forwarded' }])).toEqual([]);
  });
  it('routes only the observed extra forms locally and fails closed on every changed form', () => {
    const route = (method: string, params: Json[]) => routeForkUpstreamRequest({ method, params }, N, H);
    expect(route('eth_gasPrice', [])).toMatchObject({ kind: 'local-error', code: -32601 });
    expect(route('eth_getAccountInfo', [B, H])).toMatchObject({ kind: 'local-error', code: -32601 });
    expect(route('eth_getBlockByHash', [UNKNOWN_HASH, true])).toEqual({ kind: 'local-null' });
    expect(route('eth_getBlockByHash', [H, true])).toEqual({ kind: 'local-source-block' });
    expect(verifiedSourceBlockReply(block(true), N, H)).toMatchObject({ number: N_HEX, hash: H });
    expect(() => verifiedSourceBlockReply({ ...block(true) as object, hash: UNKNOWN_HASH }, N, H)).toThrow('SOURCE_BLOCK_UNVERIFIED');
    expect(() => verifiedSourceBlockReply({ ...block(true) as object, number: '0x1' }, N, H)).toThrow('SOURCE_BLOCK_UNVERIFIED');
    for (const method of ['eth_getTransactionByHash', 'eth_getTransactionReceipt']) {
      expect(route(method, [UNKNOWN_HASH])).toEqual({ kind: 'local-null' });
      expect(route(method, ['latest']).kind).toBe('stop');
      expect(route(method, [UNKNOWN_HASH, true]).kind).toBe('stop');
    }
    expect(route('eth_getBalance', [B, H])).toEqual({ kind: 'forward', method: 'eth_getBalance', params: [B, { blockHash: H, requireCanonical: true }] });
    for (const [method, params] of [
      ['eth_gasPrice', ['latest']], ['eth_getAccountInfo', [B, 'latest']],
      ['eth_getBlockByHash', [UNKNOWN_HASH, false]], ['eth_getBlockByHash', ['latest', true]],
      ['eth_getBalance', [B, 'latest']], ['eth_getBalance', [B, N_HEX]],
      ['eth_getBalance', [B, { blockHash: H, requireCanonical: true }]],
      ['eth_getBalance', [B, UNKNOWN_HASH]], ['eth_getStorageAt', [B, '0x0', UNKNOWN_HASH]],
      ['eth_getBlockByNumber', ['latest', false]], ['eth_getProof', [B, H]],
    ] as [string, Json[]][]) expect(route(method, params).kind, `${method} ${JSON.stringify(params)}`).toBe('stop');
    expect(routeForkUpstreamRequest([{ method: 'eth_chainId', params: [] }], N, H).kind).toBe('stop');
  });

  it('routes the raw wire form: only eth_gasPrice may omit params, and never reaches the provider', () => {
    expect(FORK_UPSTREAM_PARAMS_OMITTED).toEqual(['eth_gasPrice']);
    const observed = { method: 'eth_gasPrice', id: 1, jsonrpc: '2.0' };
    expect(forkUpstreamCall(observed)).toEqual({ method: 'eth_gasPrice', params: [] });
    expect(routeForkUpstreamRequest(observed, N, H)).toMatchObject({ kind: 'local-error', code: -32601 });
    for (const request of [{ method: 'eth_chainId' }, { method: 'eth_getBalance' }, { method: 'eth_getBlockByNumber' },
      { method: 'eth_gasPrice', params: null }, { method: 'eth_gasPrice', params: {} }, { method: 'eth_gasPrice', params: 'latest' }]) {
      expect(forkUpstreamCall(request), JSON.stringify(request)).toBeNull();
      expect(routeForkUpstreamRequest(request, N, H).kind, JSON.stringify(request)).toBe('stop');
    }
  });
});

describe.skipIf(!process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE)('G1 pinned-account anvil compatibility (C1–C10)', () => {
  beforeAll(async () => {
    const binary = process.env.GRYLOO_ANVIL_BIN;
    if (!binary || basename(binary) !== 'anvil' || basename(dirname(binary)) !== 'foundry-v1.8.3') {
      throw new Error('GRYLOO_ANVIL_BIN must name the verified foundry-v1.8.3/anvil binary');
    }
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      request.on('end', () => {
        const parsed = JSON.parse(body) as { id: Json; method: string; params?: Json[] } | { id: Json; method: string; params?: Json[] }[];
        const answer = (call: { id: Json; method: string; params?: Json[] }) => {
          // The raw wire request is routed exactly as the recording proxy receives it.
          const route = routeForkUpstreamRequest(call, N, H);
          const params: Json[] = (forkUpstreamCall(call)?.params ?? call.params ?? []) as Json[];
          anvilEntries.push({ method: call.method, params, outcome: route.kind, ...('params' in call ? {} : { paramsOmitted: true as const }) });
          if (route.kind === 'forward') {
            providerEntries.push({ method: route.method, params: route.params as Json[] });
            return synthetic(route.method, route.params as Json[]);
          }
          if (route.kind === 'local-error') return { error: { code: route.code, message: route.message } };
          if (route.kind === 'local-null') return { result: null };
          if (route.kind === 'local-source-block') return { result: verifiedSourceBlockReply(block(params[1] === true), N, H) };
          return { error: { code: -32601, message: `STOP: ${route.reason}` } };
        };
        if (Array.isArray(parsed)) anvilEntries.push({ batch: parsed.length });
        const calls = Array.isArray(parsed) ? parsed : [parsed];
        const replies = calls.map(call => ({ call, reply: answer(call) }));
        if (replies.some(item => item.reply.http500)) { response.statusCode = 500; response.end('synthetic server error'); return; }
        const payload = replies.map(({ call, reply }) => ({ jsonrpc: '2.0', id: call.id, ...(reply.error ? { error: reply.error } : { result: reply.result ?? null }) }));
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(Array.isArray(parsed) ? payload : payload[0]));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const upstream = server.address();
    if (upstream === null || typeof upstream === 'string') throw new Error('Upstream did not bind');
    anvilPort = await freePort();
    const ownerPhrase = readOwnerForkPhrase();
    requirePinnedForkAddresses(await deriveForkPublicAddresses(ownerPhrase));
    anvil = spawn(binary, [...forkAnvilArgs({ port: anvilPort, forkUrl: `http://127.0.0.1:${upstream.port}`, forkBlockNumber: N, timeoutMs: 20_000 }), '--mnemonic', ownerPhrase, '--derivation-path', FORK_ACCOUNT_DERIVATION_PATH],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    anvil.stdout?.resume();
    anvil.stderr?.resume();
    for (let i = 0; i < 200; i++) {
      try { await rpc('eth_chainId'); return; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    throw new Error('ANVIL_START_FAILED');
  }, 60_000);

  afterAll(async () => {
    anvil?.kill('SIGKILL');
    await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
    const inventory: Record<string, number> = {};
    for (const entry of anvilEntries) {
      const key = 'batch' in entry ? 'batch' : `${entry.outcome} ${entry.method} ${JSON.stringify(entry.params.at(-1) ?? null) === JSON.stringify(H) ? '<H>' : typeof entry.params.at(-1) === 'object' ? 'object' : String(entry.params.length)}`;
      inventory[key] = (inventory[key] ?? 0) + 1;
    }
    const report = {
      format: 'gryloo.anvil-compatibility.v1',
      anvil: { version: ANVIL_PIN.version.split('\n')[0], binarySha256: ANVIL_PIN.binarySha256 },
      policy: FORK_UPSTREAM_POLICY,
      checks: [...checks].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
      anvilRequestInventory: Object.fromEntries(Object.entries(inventory).sort(([a], [b]) => a.localeCompare(b))),
      providerRequestInventory: providerEntries.map(entry => ({ method: entry.method, params: entry.params })),
      paramsOmittedMethods: [...new Set(anvilEntries.flatMap(entry => 'paramsOmitted' in entry ? [entry.method] : []))].sort(),
    };
    const out = process.env.GRYLOO_ANVIL_COMPAT_OUT ?? join(tmpdir(), 'gryloo-anvil-compatibility.json');
    const text = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(out, text);
    console.log(`G1 result ${out} sha256 ${sha256(new TextEncoder().encode(text))}`);
    for (const check of report.checks) console.log(`G1 ${check.id} ${check.pass ? 'PASS' : 'FAIL'} ${check.detail}`);
  });

  it('C1 binary identity matches the approved pins and the bootstrap script', () => {
    const binary = process.env.GRYLOO_ANVIL_BIN!;
    const failures = binaryFailures(readFileSync(binary), execFileSync(binary, ['--version'], { encoding: 'utf8' }));
    const script = readFileSync(join(REPO, 'scripts', 'bootstrap-anvil.py'), 'utf8');
    for (const [name, value] of [['SHA256', ANVIL_PIN.archiveSha256], ['ANVIL_SHA256', ANVIL_PIN.binarySha256], ['ANVIL_SIZE', String(ANVIL_PIN.binarySize)]] as const) {
      if (!new RegExp(`^${name} = "?${value}"?$`, 'm').test(script)) failures.push(`bootstrap-anvil.py ${name} differs from the profile pin`);
    }
    record('C1', failures, 'binary digest, size and version equal the pins');
    expect(failures).toEqual([]);
  });

  it('C2 starts with the exact flags, serves chain 31337 and never probes the upstream node', async () => {
    const failures: string[] = [];
    if (await result('eth_chainId') !== FORK_CHAIN_ID_HEX) failures.push('eth_chainId is not 0x7a69');
    for (const entry of anvilEntries) if ('method' in entry && /^anvil_/.test(entry.method)) failures.push(`upstream received ${entry.method}`);
    const accounts = ((await result('eth_accounts')) as string[]).map(a => a.toLowerCase());
    if (JSON.stringify(accounts) !== JSON.stringify(FORK_DEV_ACCOUNTS)) failures.push('dev accounts differ from the Amendment 6 pins');
    if (accounts.some(a => (ANVIL_DEFAULT_ACCOUNTS as readonly string[]).includes(a))) failures.push('an Anvil default account is present');
    record('C2', failures, 'eth_chainId 0x7a69; no anvil_* request upstream; exactly the ten pinned Amendment 6 accounts');
    expect(failures).toEqual([]);
  });

  it('C3 anvil_metadata reports the forked network, block number and block hash', async () => {
    const metadata = await result('anvil_metadata') as { clientVersion: string; chainId: number; forkedNetwork: { chainId: number; forkBlockNumber: number; forkBlockHash: string } | null };
    const failures: string[] = [];
    if (metadata.clientVersion !== ANVIL_PIN.clientVersion) failures.push('clientVersion differs');
    if (metadata.chainId !== 31337) failures.push('local chainId differs');
    const fork = metadata.forkedNetwork;
    if (!fork || fork.chainId !== SOURCE_CHAIN_ID || fork.forkBlockNumber !== N || fork.forkBlockHash !== H) failures.push('forkedNetwork differs from chain 8453, N and H');
    record('C3', failures, 'forkedNetwork.chainId, forkBlockNumber and forkBlockHash present and equal');
    expect(failures).toEqual([]);
  });

  it('C5 sends no retry and surfaces an upstream error or an unanswerable request to the client', async () => {
    const failures: string[] = [];
    const jsonError = await rpc('eth_getBalance', [ERROR_ADDRESS, 'latest']);
    if (!jsonError.error) failures.push('JSON-RPC upstream error did not reach the client');
    const httpError = await rpc('eth_getBalance', [HTTP_ERROR_ADDRESS, 'latest']);
    if (!httpError.error) failures.push('HTTP 500 upstream error did not reach the client');
    for (const address of [ERROR_ADDRESS, HTTP_ERROR_ADDRESS]) {
      const counts = new Map<string, number>();
      for (const entry of anvilEntries) if ('method' in entry && entry.params[0] === address) counts.set(entry.method, (counts.get(entry.method) ?? 0) + 1);
      if (counts.size === 0) failures.push(`no upstream request for ${address}`);
      for (const [method, count] of counts) if (count > 1) failures.push(`${method} for ${address} was requested ${count} times`);
    }
    record('C5', failures, 'each failing upstream request sent once; error returned to the client');
    expect(failures).toEqual([]);
  });

  let contract = '';
  it('C6 accepts hash-pinned eth_call and eth_getCode on a local block and rejects an unknown hash', async () => {
    const accounts = await result('eth_accounts') as string[];
    const deployment = await mined(() => result('eth_sendTransaction', [{ from: accounts[0]!, data: INIT }])) as string;
    const receipt = await result('eth_getTransactionReceipt', [deployment]) as { status: string; contractAddress: string };
    contract = receipt.contractAddress;
    const latest = await result('eth_getBlockByNumber', ['latest', false]) as { hash: string };
    const pin = { blockHash: latest.hash, requireCanonical: true };
    const failures: string[] = [];
    if (receipt.status !== '0x1') failures.push('deployment failed');
    if (await result('eth_getCode', [contract, pin]) !== RUNTIME) failures.push('pinned eth_getCode differs');
    if (await result('eth_call', [{ to: contract, data: WORD }, pin]) !== WORD) failures.push('pinned eth_call differs');
    const unknown = await rpc('eth_getCode', [contract, { blockHash: `0x${'99'.repeat(32)}`, requireCanonical: true }]);
    if (!unknown.error) failures.push('unknown block hash was accepted');
    record('C6', failures, 'pinned reads succeed; unknown hash rejected');
    expect(failures).toEqual([]);
  });

  it('C7 eth_simulateV1 with validation simulates dependent calls, rejects invalid ones and changes no state', async () => {
    const accounts = await result('eth_accounts') as string[];
    const from = accounts[0]!;
    const latest = await result('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
    const fee = { maxFeePerGas: hex(2n * BigInt(latest.baseFeePerGas) + 1_000_000n), maxPriorityFeePerGas: hex(1_000_000) };
    const nonce = await result('eth_getTransactionCount', [from, 'latest']) as string;
    const snapshot = async () => [await result('eth_blockNumber'), await result('eth_getBalance', [from, 'latest']), await result('eth_getBalance', [B, 'latest']), await result('eth_getTransactionCount', [from, 'latest'])];
    const before = await snapshot();
    const simulate = (calls: Json[]) => rpc('eth_simulateV1', [{ blockStateCalls: [{ calls }], validation: true, traceTransfers: false, returnFullTransactions: false }, 'latest']);
    const failures: string[] = [];
    const good = await simulate([
      { from, to: B, value: hex(10n ** 18n), nonce, gas: hex(21_000), ...fee },
      { from: B, to: contract, data: WORD, nonce: '0x0', gas: hex(100_000), ...fee },
    ]);
    const calls = (good.result as { calls: { status: string; gasUsed: string; logs: { address: string; topics: string[]; data: string }[]; returnData: string }[] }[] | undefined)?.[0]?.calls ?? [];
    if (good.error || calls.length !== 2) failures.push(`dependent simulation failed: ${good.error?.message ?? calls.length}`);
    else {
      if (calls.some(call => call.status !== '0x1' || !/^0x[0-9a-f]+$/.test(call.gasUsed))) failures.push('a dependent call did not succeed with gasUsed');
      const log = calls[1]!.logs[0];
      if (calls[1]!.returnData !== WORD || !log || log.address !== contract || log.topics[0] !== `0x${'00'.repeat(31)}01` || log.data !== WORD) failures.push('returnData or logs differ');
    }
    const wrongNonce = await simulate([{ from, to: B, value: '0x1', nonce: hex(BigInt(nonce) + 5n), gas: hex(21_000), ...fee }]);
    if (!wrongNonce.error) failures.push('wrong nonce accepted');
    const noFunds = await simulate([{ from: '0x000000000000000000000000000000000000c0c0', to: B, value: '0x1', nonce: '0x0', gas: hex(21_000), ...fee }]);
    if (!noFunds.error) failures.push('insufficient balance accepted');
    const lowFee = await simulate([{ from, to: B, value: '0x1', nonce, gas: hex(21_000), maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x0' }]);
    if (!lowFee.error) failures.push('fee cap below base fee accepted');
    if (JSON.stringify(await snapshot()) !== JSON.stringify(before)) failures.push('simulation changed chain state');
    record('C7', failures, `rejections: ${[wrongNonce, noFunds, lowFee].map(reply => reply.error?.code).join(', ')}`);
    expect(failures).toEqual([]);
  });

  it('C8 signs, submits and returns byte-identical raw transactions whose keccak equals the hash', async () => {
    const accounts = await result('eth_accounts') as string[];
    const from = accounts[0]!;
    const latest = await result('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
    const nonce = await result('eth_getTransactionCount', [from, 'latest']) as string;
    const raw = await result('eth_signTransaction', [{ from, to: B, value: '0x1', nonce, gas: hex(21_000),
      maxFeePerGas: hex(2n * BigInt(latest.baseFeePerGas) + 1_000_000n), maxPriorityFeePerGas: hex(1_000_000), chainId: FORK_CHAIN_ID_HEX, type: '0x2' }]) as string;
    const hash = await mined(() => result('eth_sendRawTransaction', [raw])) as string;
    const failures: string[] = [];
    if (!raw.startsWith('0x02')) failures.push('not an EIP-1559 raw transaction');
    if (await result('eth_getRawTransactionByHash', [hash]) !== raw) failures.push('eth_getRawTransactionByHash bytes differ');
    if (`0x${bytesToHex(keccak_256(hexToBytes(raw.slice(2))))}` !== hash) failures.push('keccak256(raw) differs from the hash');
    const transaction = await result('eth_getTransactionByHash', [hash]) as Record<string, Json>;
    const receipt = await result('eth_getTransactionReceipt', [hash]) as Record<string, Json>;
    if (transaction.hash !== hash || transaction.from !== from) failures.push('eth_getTransactionByHash fields differ');
    for (const key of ['status', 'gasUsed', 'effectiveGasPrice', 'logs']) if (!(key in receipt)) failures.push(`receipt lacks ${key}`);
    const l1 = Object.keys(receipt).filter(key => /^l1/i.test(key));
    record('C8', failures, `receipt L1-fee fields: ${l1.length ? l1.join(',') : 'none'}`);
    expect(failures).toEqual([]);
  });

  it('C9 rejects a raw transaction signed for chain ID 8453', async () => {
    const accounts = await result('eth_accounts') as string[];
    const from = accounts[0]!;
    const latest = await result('eth_getBlockByNumber', ['latest', false]) as { baseFeePerGas: string };
    const nonce = await result('eth_getTransactionCount', [from, 'latest']) as string;
    const raw = await result('eth_signTransaction', [{ from, to: B, value: '0x1', nonce, gas: hex(21_000),
      maxFeePerGas: hex(2n * BigInt(latest.baseFeePerGas) + 1_000_000n), maxPriorityFeePerGas: hex(1_000_000), chainId: hex(SOURCE_CHAIN_ID), type: '0x2' }]) as string;
    const reply = await rpc('eth_sendRawTransaction', [raw]);
    const failures = reply.error && /chain id/i.test(reply.error.message) ? [] : ['a chain 8453 transaction was not rejected for its chain ID'];
    record('C9', failures, reply.error?.message ?? '');
    expect(failures).toEqual([]);
  });

  it('C10 gives deterministic timestamps, exact snapshot restore and observable pending transactions', async () => {
    const accounts = await result('eth_accounts') as string[];
    const from = accounts[0]!;
    const failures: string[] = [];
    await result('anvil_setBlockTimestampInterval', [2]);
    await result('evm_mine');
    const first = await result('eth_getBlockByNumber', ['latest', false]) as { timestamp: string };
    await result('evm_mine');
    const second = await result('eth_getBlockByNumber', ['latest', false]) as { timestamp: string };
    if (Number(second.timestamp) - Number(first.timestamp) !== 2) failures.push('block timestamps are not 2 seconds apart');
    const state = async () => JSON.stringify([await result('eth_blockNumber'), await result('eth_getBalance', [B, 'latest']), await result('eth_getTransactionCount', [from, 'latest'])]);
    const before = await state();
    const snapshotId = await result('evm_snapshot') as string;
    await mined(() => result('eth_sendTransaction', [{ from, to: B, value: '0x5' }]));
    if (await state() === before) failures.push('snapshot test transaction had no effect');
    if (await result('evm_revert', [snapshotId]) !== true || await state() !== before) failures.push('evm_revert did not restore block number, balance and nonce');
    await result('anvil_setAutomine', [false]);
    const pending = await result('eth_sendTransaction', [{ from, to: B, value: '0x6' }]) as string;
    const pool = await result('txpool_content') as { pending: Record<string, Record<string, { hash: string }>> };
    const inPool = Object.values(pool.pending).some(byNonce => Object.values(byNonce).some(tx => tx.hash === pending));
    if (!inPool) failures.push('pending transaction absent from txpool_content');
    await result('evm_mine');
    await result('anvil_setAutomine', [true]);
    const receipt = await result('eth_getTransactionReceipt', [pending]) as { status: string } | null;
    if (receipt?.status !== '0x1') failures.push('evm_mine did not include the pending transaction');
    record('C10', failures, 'interval 2 s; snapshot restore exact; pending visible then mined');
    expect(failures).toEqual([]);
  });

  it('C4 every upstream request is allowed by the D-5 policy, pinned to the fork block and unbatched', async () => {
    // A client lookup of a transaction hash that is not in a local block, as a
    // wallet or reconciler may make; its upstream effect is part of the inventory.
    await rpc('eth_getTransactionByHash', [UNKNOWN_HASH]);
    await rpc('eth_getTransactionReceipt', [UNKNOWN_HASH]);
    const providerView: UpstreamEntry[] = providerEntries.map(entry => ({ ...entry, outcome: 'forwarded' }));
    const failures = inventoryFailures(providerView);
    if (anvilEntries.some(entry => 'batch' in entry || entry.outcome === 'stop')) failures.push('Anvil sent a batch or an unapproved method/form');
    for (const entry of anvilEntries) {
      if ('paramsOmitted' in entry && (!(FORK_UPSTREAM_PARAMS_OMITTED as readonly string[]).includes(entry.method) || entry.outcome === 'forwarded')) failures.push(`params omitted outside the approved local form: ${entry.method}`);
    }
    const expected = anvilEntries.flatMap(entry => {
      if ('batch' in entry) return [];
      const route = routeForkUpstreamRequest({ method: entry.method, params: entry.params }, N, H);
      return route.kind === 'forward' ? [{ method: route.method, params: route.params }] : [];
    });
    if (JSON.stringify(providerEntries) !== JSON.stringify(expected)) failures.push('provider-bound requests differ from routed and canonically rewritten Anvil requests');
    record('C4', failures, `${anvilEntries.length} Anvil requests, ${providerEntries.length} approved provider-bound requests; extras answered locally`);
    expect(failures).toEqual([]);
  });
});

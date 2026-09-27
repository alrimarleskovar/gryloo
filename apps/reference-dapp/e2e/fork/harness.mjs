// SPDX-License-Identifier: AGPL-3.0-only
/** Exact Anvil process boundary for the controlled BUILD-003D fork. */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { createECDH, createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ANVIL_PIN, forkAnvilArgs, FORK_ACCOUNT_DERIVATION_PATH, FORK_DEV_ACCOUNTS, ANVIL_DEFAULT_ACCOUNTS, FORK_CHAIN_ID_HEX, SOURCE_CHAIN_ID } from '../../../../packages/reference-compiler/dist/profile.js';
import { REPLAY_READY_LINE } from './replay-upstream.mjs';

/** Owner-supplied, untracked local secret; never a production input or a fallback. */
const compilerRequire = createRequire(new URL('../../../../packages/reference-compiler/package.json', import.meta.url));
const keccakModule = compilerRequire.resolve('@noble/hashes/sha3.js');
export function readOwnerForkPhrase() {
  const path = process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
  const repository = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  if (!path || !path.startsWith('/') || path === repository || path.startsWith(repository + '/')) {
    throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
  }
  let fd;
  let phrase;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(fd);
    const actualPath = realpathSync(`/proc/self/fd/${fd}`);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.uid !== process.getuid()
      || metadata.size < 1 || metadata.size > 512 || actualPath === repository || actualPath.startsWith(repository + '/')) {
      throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
    }
    const bytes = readFileSync(fd);
    try { phrase = bytes.toString('utf8').trim(); } finally { bytes.fill(0); }
  } catch {
    throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!/^[a-z]+( [a-z]+){11}$/.test(phrase)) throw new Error('FORK_ACCOUNT_SECRET_INVALID');
  return phrase;
}

/** F2 public pins are private only for review integrity; they contain no key material. */
export function forkDevAccounts() {
  const path = process.env.GRYLOO_F2_PUBLIC_PIN_FILE;
  if (!path) return FORK_DEV_ACCOUNTS;
  const repository = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  if (!path.startsWith('/') || path === repository || path.startsWith(repository + '/')) throw new Error('F2_PUBLIC_PINS_UNAVAILABLE');
  let fd;
  let document;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(fd);
    const actualPath = realpathSync(`/proc/self/fd/${fd}`);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.uid !== process.getuid()
      || metadata.size < 1 || metadata.size > 4096 || actualPath === repository || actualPath.startsWith(repository + '/')) {
      throw new Error('F2_PUBLIC_PINS_UNAVAILABLE');
    }
    document = JSON.parse(readFileSync(fd, 'utf8'));
  } catch {
    throw new Error('F2_PUBLIC_PINS_UNAVAILABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  const addresses = document?.addresses;
  if (document?.format !== 'gryloo.build-003f.f2-public-pins.v1'
    || document?.derivationPath !== FORK_ACCOUNT_DERIVATION_PATH
    || !Array.isArray(addresses) || addresses.length !== 10
    || addresses.some(address => typeof address !== 'string' || !/^0x[0-9a-f]{40}$/.test(address))
    || new Set(addresses).size !== 10
    || addresses.some(address => ANVIL_DEFAULT_ACCOUNTS.includes(address))) {
    throw new Error('F2_PUBLIC_PINS_INVALID');
  }
  return Object.freeze([...addresses]);
}

/** BIP-39/BIP-32 derivation stays inside the acceptance harness and returns public addresses only. */
export async function deriveForkPublicAddresses(phrase) {
  const { keccak_256 } = await import(keccakModule);
  const seed = pbkdf2Sync(phrase.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  const master = createHmac('sha512', 'Bitcoin seed').update(seed).digest();
  seed.fill(0);
  const order = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  const scalar = value => Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
  const indexBytes = index => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(index); return bytes; };
  const pubkey = (key, format = 'uncompressed') => {
    const ecdh = createECDH('secp256k1'); ecdh.setPrivateKey(scalar(key)); return ecdh.getPublicKey(undefined, format);
  };
  let key = BigInt('0x' + master.subarray(0, 32).toString('hex'));
  let chain = master.subarray(32);
  const child = index => {
    const data = index >= 0x80000000 ? Buffer.concat([Buffer.alloc(1), scalar(key), indexBytes(index)])
      : Buffer.concat([pubkey(key, 'compressed'), indexBytes(index)]);
    const digest = createHmac('sha512', chain).update(data).digest();
    key = (BigInt('0x' + digest.subarray(0, 32).toString('hex')) + key) % order;
    chain = digest.subarray(32);
  };
  for (const part of FORK_ACCOUNT_DERIVATION_PATH.split('/').slice(1).filter(Boolean)) {
    child(part.endsWith("'") ? Number(part.slice(0, -1)) + 0x80000000 : Number(part));
  }
  const baseKey = key, baseChain = chain;
  return Array.from({ length: 10 }, (_, index) => {
    key = baseKey; chain = baseChain; child(index);
    return '0x' + Buffer.from(keccak_256(pubkey(key).subarray(1)).subarray(12)).toString('hex');
  });
}
export function requirePinnedForkAddresses(addresses) {
  const expected = forkDevAccounts();
  if (!Array.isArray(addresses) || addresses.length !== expected.length
      || addresses.some((address, index) => address !== expected[index])) {
    throw new Error('FORK_ACCOUNT_DERIVATION_MISMATCH');
  }
}
/** Mockable public-address boundary; actual startup always uses the owner file and real derivation. */
export async function verifyOwnerForkAccountSource({ load = readOwnerForkPhrase, derive = deriveForkPublicAddresses } = {}) {
  const phrase = load();
  requirePinnedForkAddresses(await derive(phrase));
  return phrase;
}
export const ANVIL_PORT = 8545;
export const UPSTREAM_PORT = 8546;
export const UPSTREAM_URL = 'http://127.0.0.1:8546';
/**
 * Upper bounds only: readiness is Anvil's own "Listening on" line, its exit or
 * this deadline, whichever comes first. The recording bound equals the approved
 * `--timeout` because the proxy paces every genesis read 400 ms apart.
 */
export const STARTUP_DEADLINE_MS = Object.freeze({ replay: 20000, recording: 600000 });
export const RPC_TIMEOUT_MS = Object.freeze({ replay: 20000, recording: 600000 });
const ANVIL_READY_LINE = `Listening on 127.0.0.1:${ANVIL_PORT}`;
const REPLAY_SCRIPT = fileURLToPath(new URL('./replay-upstream.mjs', import.meta.url));
const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });
const TAIL_CHARS = 1000;
let rpcTimeoutMs = RPC_TIMEOUT_MS.replay;
export const forkRpcTimeoutMs = () => rpcTimeoutMs;
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

/** TCP connect only: no bytes are sent, so a recording proxy never sees a request. */
export function probePort(port, timeoutMs = 1000) {
  return new Promise(resolvePromise => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = state => { clearTimeout(timer); socket.destroy(); resolvePromise(state); };
    const timer = setTimeout(() => done('timeout'), timeoutMs);
    socket.once('connect', () => done('listening'));
    socket.once('error', error => done(error?.code === 'ECONNREFUSED' ? 'free' : `error-${error?.code ?? 'UNKNOWN'}`));
  });
}

/** Children never inherit proxy, Foundry payment or credential variables from the caller. */
function childEnvironment() {
  return { HOME: process.env.HOME ?? '/nonexistent', PATH: '/usr/bin:/bin' };
}

/** Every started child is killed if this process is interrupted or exits. */
const live = new Set();
const records = new WeakMap();
function killLiveChildren() { for (const child of live) child.kill('SIGKILL'); }
function onSignal(signal) { killLiveChildren(); process.exit(SIGNAL_EXIT_CODES[signal]); }
function track(child) {
  if (live.size === 0) {
    process.on('exit', killLiveChildren);
    for (const signal of Object.keys(SIGNAL_EXIT_CODES)) process.on(signal, onSignal);
  }
  live.add(child);
  let stderr = '';
  // Error text quotes stderr only; Anvil's stdout banner lists dev-account keys.
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-TAIL_CHARS); });
  const exited = new Promise(resolvePromise => {
    const finish = status => {
      if (live.delete(child) && live.size === 0) {
        process.off('exit', killLiveChildren);
        for (const signal of Object.keys(SIGNAL_EXIT_CODES)) process.off(signal, onSignal);
      }
      resolvePromise(status);
    };
    // 'close' follows both process exit and the end of its stdio, so the stderr tail is complete.
    child.once('close', (code, signal) => finish({ code, signal }));
    child.once('error', error => finish({ code: null, signal: null, error: error?.code ?? 'SPAWN_FAILED' }));
  });
  const record = { exited, stderrTail: () => stderr };
  records.set(child, record);
  return record;
}

/** Resolves on the exact readiness line; rejects with EXITED or START_TIMEOUT. */
function awaitReadyLine(child, record, readyLine, deadlineMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let pending = '';
    let settled = false;
    const settle = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stdout.resume(); // keep draining so a chatty child never blocks on a full pipe
      if (error) rejectPromise(error); else resolvePromise();
    };
    const onData = chunk => {
      const lines = (pending + chunk.toString('utf8')).split('\n');
      pending = (lines.pop() ?? '').slice(-TAIL_CHARS);
      if (lines.some(line => line.trim() === readyLine)) settle(null);
    };
    const timer = setTimeout(() => settle(new Error('START_TIMEOUT')), deadlineMs);
    child.stdout.on('data', onData);
    record.exited.then(() => settle(new Error('EXITED')));
  });
}

async function stopChild(child, port) {
  const record = records.get(child);
  if (!record) throw new Error('CHILD_UNKNOWN');
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await record.exited;
  for (let i = 0; i < 100; i++) {
    if (await probePort(port) === 'free') return;
    await sleep(20);
  }
  throw new Error(`FORK_PORT_NOT_RELEASED:${port}`);
}

export function validateAnvilBinary(path) {
  if (basename(path) !== 'anvil' || basename(dirname(path)) !== 'foundry-v1.8.3') throw new Error('ANVIL_PATH_INVALID');
  const bytes = readFileSync(path);
  if (bytes.length !== ANVIL_PIN.binarySize || createHash('sha256').update(bytes).digest('hex') !== ANVIL_PIN.binarySha256) throw new Error('ANVIL_PIN_MISMATCH');
}
export async function exactAnvilArgs(blockNumber, recording = false) {
  if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) throw new Error('SOURCE_BLOCK_INVALID');
  const phrase = await verifyOwnerForkAccountSource();
  return [...forkAnvilArgs({ port: ANVIL_PORT, forkUrl: UPSTREAM_URL, forkBlockNumber: blockNumber,
    timeoutMs: recording ? 600000 : 20000 }), '--mnemonic', phrase, '--derivation-path', FORK_ACCOUNT_DERIVATION_PATH];
}
export async function rpc(method, params = [], port = ANVIL_PORT) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(rpcTimeoutMs) });
  if (!response.ok) throw new Error('FORK_RPC_HTTP_ERROR');
  const value = await response.json();
  if (value?.error || !('result' in value)) throw new Error(`FORK_RPC_ERROR:${value?.error?.message ?? 'invalid response'}`);
  return value.result;
}

/**
 * Start the closed replay upstream and resolve only after it has bound
 * 127.0.0.1:8546 (its own readiness line). Replay mode starts this first.
 */
export async function startReplayUpstream(transcriptPath, { deadlineMs = STARTUP_DEADLINE_MS.replay } = {}) {
  if (await probePort(UPSTREAM_PORT) !== 'free') throw new Error(`FORK_PORT_OCCUPIED:${UPSTREAM_PORT}`);
  const child = spawn(process.execPath, [REPLAY_SCRIPT, resolve(transcriptPath)], { stdio: ['ignore', 'pipe', 'pipe'], env: childEnvironment() });
  const record = track(child);
  try { await awaitReadyLine(child, record, REPLAY_READY_LINE, deadlineMs); }
  catch (error) {
    const status = error.message === 'EXITED' ? await record.exited : null;
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await record.exited;
    throw new Error(`REPLAY_UPSTREAM_${error.message}${status ? `:code=${status.code}` : ''}:[diagnostics suppressed]`, { cause: error });
  }
  return child;
}
export const stopReplayUpstream = child => stopChild(child, UPSTREAM_PORT);

export async function startFork({ binary, blockNumber, blockHash, recording = false, startupDeadlineMs }) {
  validateAnvilBinary(binary);
  if (!/^0x[0-9a-f]{64}$/.test(blockHash)) throw new Error('SOURCE_HASH_INVALID');
  const mode = recording ? 'recording' : 'replay';
  const args = await exactAnvilArgs(blockNumber, recording);
  if (await probePort(ANVIL_PORT) !== 'free') throw new Error(`FORK_PORT_OCCUPIED:${ANVIL_PORT}`);
  // Anvil reads the fork block during startup: it never starts before its local upstream listens.
  if (await probePort(UPSTREAM_PORT) !== 'listening') throw new Error('UPSTREAM_NOT_READY');
  const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'], env: childEnvironment() });
  const record = track(child);
  try {
    try { await awaitReadyLine(child, record, ANVIL_READY_LINE, startupDeadlineMs ?? STARTUP_DEADLINE_MS[mode]); }
    catch (error) {
      const status = error.message === 'EXITED' ? await record.exited : null;
      const upstream = await probePort(UPSTREAM_PORT);
      const stderr = record.stderrTail();
      const diagnostic = /failed to create genesis/i.test(stderr) && /connection refused/i.test(stderr)
        ? 'genesis_connection_refused' : '[diagnostics suppressed]';
      throw new Error(`ANVIL_${error.message}:upstream=${upstream}${status ? `:code=${status.code}:signal=${status.signal}` : ''}:${diagnostic}`, { cause: error });
    }
    rpcTimeoutMs = RPC_TIMEOUT_MS[mode];
    if (await rpc('eth_chainId') !== FORK_CHAIN_ID_HEX) throw new Error('FORK_CHAIN_MISMATCH');
    const metadata = await rpc('anvil_metadata');
    if (Number(metadata?.forkedNetwork?.chainId) !== SOURCE_CHAIN_ID
      || Number(metadata?.forkedNetwork?.forkBlockNumber) !== blockNumber
      || metadata?.forkedNetwork?.forkBlockHash !== blockHash) throw new Error('FORK_METADATA_MISMATCH');
    return child;
  } catch (error) { await stopFork(child); throw error; }
}
export async function stopFork(child) {
  try { await stopChild(child, ANVIL_PORT); }
  finally { rpcTimeoutMs = RPC_TIMEOUT_MS.replay; }
}
export async function withFork(input, scenario) {
  const child = await startFork(input);
  try { return await scenario({ rpc }); }
  finally { await stopFork(child); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  throw new Error('HARNESS_DIRECT_RUN_DISABLED_USE_OWNER_WRAPPER');
}

/**
 * Transcript identity: the source state every artifact binds to. It is fixed before the first
 * provider request, so a recording and its replay produce byte-identical artifacts; the committed
 * transcript's own SHA-256 is verified separately.
 */
export function transcriptIdentity({ sourceBlockNumber, sourceBlockHash, accounts }) {
  if (!Number.isSafeInteger(sourceBlockNumber) || !/^0x[0-9a-f]{64}$/.test(sourceBlockHash)
    || !Array.isArray(accounts) || accounts.length !== 10) throw new Error('TRANSCRIPT_IDENTITY_INVALID');
  const identity = { format: 'gryloo.base-fork-state-transcript.v1', sourceChainId: SOURCE_CHAIN_ID, sourceBlockNumber, sourceBlockHash,
    anvilBinarySha256: ANVIL_PIN.binarySha256, forkChainId: 31337, derivationPath: FORK_ACCOUNT_DERIVATION_PATH, accounts: [...accounts] };
  return { identity, identityHash: `0x${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}` };
}

/**
 * Test-only EIP-1193 stand-in: Anvil signs for its unlocked local account. Faults are injected here,
 * after the app has built the exact request, never inside the application.
 */
export function anvilTestWallet(call, owner) {
  return async (request, fault = null) => {
    if (request?.from !== owner || request.chainId !== FORK_CHAIN_ID_HEX || request.type !== '0x2') throw new Error('TEST_WALLET_REQUEST_INVALID');
    if (fault?.reject) throw Object.assign(new Error('TEST_WALLET_USER_REJECTED'), { code: 4001 });
    let fields = { ...request };
    if (fault?.mutate === 'gas') fields = { ...fields, gas: `0x${(BigInt(fields.gas) + 1n).toString(16)}` };
    if (fault?.mutate === 'recipient') {
      const { decodeSwap, encodeSwap } = await import('../../../../packages/reference-compiler/dist/abi.js');
      const { fromHex, toHex } = await import('../../../../packages/reference-compiler/dist/payload.js');
      fields = { ...fields, data: toHex(encodeSwap({ ...decodeSwap(fromHex(fields.data)), recipient: fault.recipient })) };
    }
    const raw = await call('eth_signTransaction', [fields]);
    const hash = await call('eth_sendRawTransaction', [raw]);
    if (fault?.dropResponse) throw new Error('TEST_WALLET_RESPONSE_LOST');
    return hash;
  };
}

/** Reviewed acceptance amounts; the browser acceptance authors the same three workflows. */
export const MODE_A_SCENARIO_AMOUNTS = Object.freeze({ WETH_TO_USDC: '1', USDC_TO_WETH: '2500' });

/**
 * The single BUILD-003F Mode A scenario set. The recording, the offline replay and the dry run all
 * execute exactly this sequence through the application's own service module.
 */
/** The exact accepted outcome of every scenario; anything else is an unmet BUILD-003F acceptance criterion. */
export function modeAScenarioAcceptance(results) {
  const unmet = [];
  const final = key => results[key]?.evidence?.at(-1);
  for (const key of ['WETH_TO_USDC', 'USDC_TO_WETH', 'UNKNOWN_RESULT_RESTART', 'PENDING_THEN_MINED']) {
    if (results[key]?.failure || final(key)?.outcome !== 'RECONCILED' || final(key)?.code !== 'EXACT') unmet.push(`${key}_NOT_RECONCILED`);
  }
  const revert = results.REVERT_RESIDUAL_REVOCATION;
  if (revert?.failure || revert?.evidence?.[0]?.code !== 'TRANSACTION_REVERTED' || !final('REVERT_RESIDUAL_REVOCATION')?.revocationConfirmed) unmet.push('REVERT_REVOCATION_NOT_CONFIRMED');
  for (const key of ['WALLET_MUTATED_GAS', 'WALLET_MUTATED_RECIPIENT']) {
    if (results[key]?.failure || results[key]?.observations?.at(-1)?.outcome !== 'DIVERGENT' || results[key]?.evidence?.length) unmet.push(`${key}_NOT_DIVERGENT`);
  }
  return unmet;
}

/**
 * `tolerant` (recording and replay only): a failing scenario is recorded as a sanitized failure code and the
 * next scenario starts from the baseline snapshot, so the single recording still yields a complete transcript.
 */
export async function runModeAScenarios({ call, profile, journalRoot, setupAccount, tolerant = false }) {
  const { createModeAService } = await import('../../src/server/mode-a-service.ts');
  const { createSwapNode } = await import('../../src/domain/swap-authoring.ts');
  const { baseAssetRegistry, referenceRegistry } = await import('../../../../packages/action-registry/dist/index.js');
  const { FORK_CONTRACTS } = await import('../../../../packages/reference-compiler/dist/fork-quote.js');
  const { encodeApprove, encodeSwap, SWAP_ROUTER_02 } = await import('../../../../packages/reference-compiler/dist/abi.js');
  const { sendSetupTransaction } = await import('./fork-setup.mjs');
  const context = { registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0].id,
    actionId: referenceRegistry.actions[0].id, assets: baseAssetRegistry };
  const workflow = (direction, amount, slippage) => ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1,
    resourceEdges: [], nodes: [createSwapNode('node-001', direction, amount, slippage, context)] });
  const clock = async () => {
    const block = await call('eth_getBlockByNumber', ['latest', false]);
    return new Date(Number(BigInt(block.timestamp)) * 1000).toISOString();
  };
  const owner = profile.owner;
  const send = anvilTestWallet(call, owner);
  const service = name => createModeAService({ call, profile, journalDir: `${journalRoot}/${name}`, clock });
  const expectError = async (promise, code) => {
    const error = await promise.then(() => null, failure => failure);
    if (!String(error?.message ?? '').startsWith(code)) throw new Error(`SCENARIO_EXPECTED_${code}:${error?.message ?? 'none'}`);
  };
  async function request(api, executionId, stepId, fault = null, key = `${stepId}-key-1`) {
    const { attempt, payload } = await api.beginStep(executionId, stepId, key);
    let report;
    try { report = { kind: 'HASH', transactionHash: await send(payload.request, fault) }; }
    catch (error) { report = error?.code === 4001 ? { kind: 'REJECTED' } : { kind: 'UNKNOWN' }; }
    return api.recordSubmission(executionId, attempt.executionAttemptId, report);
  }
  async function settle(api, executionId, stepId) {
    for (let i = 0; i < 200; i++) {
      const observed = await api.observeStep(executionId, stepId);
      if (observed.attempt.state !== 'PENDING') return observed;
      await sleep(25);
    }
    throw new Error('SCENARIO_STEP_NOT_SETTLED');
  }
  const summary = async (api, executionId) => {
    const status = await api.status(executionId);
    return { executionId, hashes: status.prepared.hashes, codeHashes: status.prepared.codeHashes, payloadHashes: status.prepared.payloads.map(view => view.payloadHash),
      quotedOut: status.prepared.quotedOut, minimumOut: status.prepared.minimumOut, fee: status.prepared.fee,
      attempts: status.attempts.map(item => ({ id: item.executionAttemptId, state: item.state, transactionHash: item.transactionHash })),
      observations: status.observations.map(item => ({ stepId: item.stepId, outcome: item.outcome, code: item.code, transactionHash: item.transactionHash })),
      evidence: status.evidence.map(item => ({ version: item.version, outcome: item.outcome, code: item.code, evidenceBundleHash: item.evidenceBundleHash,
        environment: item.bundle.environment, residualAllowance: item.residualAllowance, revocationConfirmed: item.revocationConfirmed })) };
  };
  async function exactSwap(name, direction, slippage, { swapFault = null, beforeSwap = null } = {}) {
    const api = service(name);
    const prepared = await api.prepare({ workflow: workflow(direction, MODE_A_SCENARIO_AMOUNTS[direction], slippage) });
    await request(api, prepared.executionId, 'step-approve');
    const approval = await settle(api, prepared.executionId, 'step-approve');
    if (approval.attempt.state !== 'CONFIRMED') throw new Error('SCENARIO_APPROVAL_NOT_CONFIRMED');
    if (beforeSwap) await beforeSwap(prepared);
    await request(api, prepared.executionId, 'step-swap', swapFault);
    return { api, prepared };
  }
  const results = {};
  const scenario = async (key, body) => {
    try { await body(); }
    catch (error) {
      if (!tolerant) throw error;
      results[key] = { failure: String(error?.message ?? 'SCENARIO_FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 160) };
      await call('anvil_setAutomine', [true]).catch(() => undefined);
    }
  };
  let snapshot = await call('evm_snapshot');
  const fresh = async () => {
    if (await call('evm_revert', [snapshot]) !== true) throw new Error('SNAPSHOT_REVERT_FAILED');
    snapshot = await call('evm_snapshot');
  };
  for (const direction of ['WETH_TO_USDC', 'USDC_TO_WETH']) await scenario(direction, async () => {
    await fresh();
    const { api, prepared } = await exactSwap(`s-${direction}`, direction, '100');
    if ((await settle(api, prepared.executionId, 'step-swap')).attempt.state !== 'CONFIRMED') throw new Error('SCENARIO_SWAP_NOT_CONFIRMED');
    const evidence = await api.reconcile(prepared.executionId);
    if (evidence.outcome !== 'RECONCILED' || evidence.code !== 'EXACT') throw new Error(`SCENARIO_NOT_RECONCILED:${evidence.code}`);
    results[direction] = await summary(api, prepared.executionId);
  });
  // Unknown submission result: the wallet broadcast, then its response is lost; a restarted service recovers.
  await scenario('UNKNOWN_RESULT_RESTART', async () => {
    await fresh();
    const { prepared } = await exactSwap('s-unknown', 'WETH_TO_USDC', '100', { swapFault: { dropResponse: true } });
    const restarted = service('s-unknown');
    const unknown = (await restarted.status(prepared.executionId)).attempts.at(-1);
    if (unknown?.state !== 'SUBMISSION_RESULT_UNKNOWN') throw new Error('SCENARIO_UNKNOWN_NOT_RECORDED');
    await expectError(restarted.beginStep(prepared.executionId, 'step-swap', 'step-swap-key-2'), 'ATTEMPT_IN_PROGRESS');
    const recovered = await restarted.observeStep(prepared.executionId, 'step-swap');
    if (recovered.attempt.state !== 'CONFIRMED' || !recovered.observation?.code.startsWith('RECOVERED_')) throw new Error('SCENARIO_UNKNOWN_NOT_RECOVERED');
    await expectError(restarted.beginStep(prepared.executionId, 'step-swap', 'step-swap-key-3'), 'RETRY_NOT_AUTHORIZED');
    const evidence = await restarted.reconcile(prepared.executionId);
    if (evidence.outcome !== 'RECONCILED') throw new Error(`SCENARIO_UNKNOWN_NOT_RECONCILED:${evidence.code}`);
    results.UNKNOWN_RESULT_RESTART = await summary(restarted, prepared.executionId);
  });
  // Delayed mining: both requests stay PENDING (txpool) until a block is mined.
  await scenario('PENDING_THEN_MINED', async () => {
    await fresh();
    const api = service('s-pending');
    const prepared = await api.prepare({ workflow: workflow('WETH_TO_USDC', MODE_A_SCENARIO_AMOUNTS.WETH_TO_USDC, '100') });
    await call('anvil_setAutomine', [false]);
    try {
      for (const stepId of ['step-approve', 'step-swap']) {
        await request(api, prepared.executionId, stepId);
        const pending = await api.observeStep(prepared.executionId, stepId);
        const pool = await call('txpool_content');
        if (pending.attempt.state !== 'PENDING' || pending.observation !== null || !pool?.pending) throw new Error('SCENARIO_PENDING_NOT_VISIBLE');
        await call('evm_mine');
        if ((await settle(api, prepared.executionId, stepId)).attempt.state !== 'CONFIRMED') throw new Error('SCENARIO_PENDING_NOT_CONFIRMED');
      }
    } finally { await call('anvil_setAutomine', [true]); }
    const evidence = await api.reconcile(prepared.executionId);
    if (evidence.outcome !== 'RECONCILED') throw new Error(`SCENARIO_PENDING_NOT_RECONCILED:${evidence.code}`);
    results.PENDING_THEN_MINED = await summary(api, prepared.executionId);
  });
  // Price moves after the zero-slippage quote: the swap reverts, the finite allowance remains, and a
  // separate reviewed revocation clears it.
  await scenario('REVERT_RESIDUAL_REVOCATION', async () => {
    await fresh();
    const { api, prepared } = await exactSwap('s-revert', 'WETH_TO_USDC', '0', { beforeSwap: async quoted => {
      const unit = 10n ** 18n;
      const head = await call('eth_getBlockByNumber', ['latest', false]);
      const hex = bytes => `0x${Buffer.from(bytes).toString('hex')}`;
      await sendSetupTransaction(setupAccount, FORK_CONTRACTS.weth, '0xd0e30db0', unit, { call });
      await sendSetupTransaction(setupAccount, FORK_CONTRACTS.weth, hex(encodeApprove(SWAP_ROUTER_02, unit)), 0n, { call });
      await sendSetupTransaction(setupAccount, SWAP_ROUTER_02, hex(encodeSwap({ tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc,
        fee: quoted.fee, recipient: setupAccount, amountIn: unit, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
        deadline: BigInt(head.timestamp) + 180n })), 0n, { call });
    } });
    if ((await settle(api, prepared.executionId, 'step-swap')).attempt.state !== 'REVERTED') throw new Error('SCENARIO_SWAP_DID_NOT_REVERT');
    const evidence = await api.reconcile(prepared.executionId);
    if (evidence.outcome !== 'DIVERGENT' || evidence.code !== 'TRANSACTION_REVERTED' || evidence.residualAllowance !== prepared.amountIn) {
      throw new Error(`SCENARIO_REVERT_EVIDENCE_INVALID:${evidence.code}`);
    }
    await api.prepareRevocation(prepared.executionId);
    await request(api, prepared.executionId, 'step-revoke');
    if ((await settle(api, prepared.executionId, 'step-revoke')).attempt.state !== 'CONFIRMED') throw new Error('SCENARIO_REVOCATION_NOT_CONFIRMED');
    const revoked = await api.confirmRevocation(prepared.executionId);
    if (!revoked.revocationConfirmed || revoked.residualAllowance !== '0' || revoked.version !== 2) throw new Error('SCENARIO_REVOCATION_EVIDENCE_INVALID');
    results.REVERT_RESIDUAL_REVOCATION = await summary(api, prepared.executionId);
  });
  // A wallet that changes any signed field produces DIVERGENT, never RECONCILED.
  for (const [label, fault] of [['WALLET_MUTATED_GAS', { mutate: 'gas' }], ['WALLET_MUTATED_RECIPIENT', { mutate: 'recipient', recipient: setupAccount }]]) await scenario(label, async () => {
    await fresh();
    const { api, prepared } = await exactSwap(`s-${label.toLowerCase()}`, 'WETH_TO_USDC', '100', { swapFault: fault });
    const observed = await settle(api, prepared.executionId, 'step-swap');
    if (observed.attempt.state !== 'RECONCILIATION_REQUIRED' || observed.observation?.outcome !== 'DIVERGENT') throw new Error(`SCENARIO_${label}_NOT_DIVERGENT`);
    await expectError(api.reconcile(prepared.executionId), 'RECONCILIATION_NOT_READY');
    results[label] = await summary(api, prepared.executionId);
  });
  await fresh();
  return results;
}

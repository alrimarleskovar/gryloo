// SPDX-License-Identifier: AGPL-3.0-only
/** Exact Anvil process boundary for the controlled BUILD-003D fork. */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { createECDH, createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ANVIL_PIN, forkAnvilArgs, FORK_ACCOUNT_DERIVATION_PATH, FORK_DEV_ACCOUNTS, FORK_CHAIN_ID_HEX, SOURCE_CHAIN_ID } from '../../../../packages/reference-compiler/dist/profile.js';
import { REPLAY_READY_LINE } from './replay-upstream.mjs';

/** Owner-supplied, untracked local secret; never a production input or a fallback. */
const compilerRequire = createRequire(new URL('../../../../packages/reference-compiler/package.json', import.meta.url));
const keccakModule = compilerRequire.resolve('@noble/hashes/sha3.js');
export function readOwnerForkPhrase() {
  const path = process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE;
  const repository = fileURLToPath(new URL('../../../../', import.meta.url));
  if (!path || !path.startsWith('/') || path === repository || path.startsWith(repository + '/')) {
    throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
  }
  let fd;
  let phrase;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid() || metadata.size > 512) {
      throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
    }
    phrase = readFileSync(fd, 'utf8').trim();
  } catch {
    throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!/^[a-z]+( [a-z]+){11}$/.test(phrase)) throw new Error('FORK_ACCOUNT_SECRET_INVALID');
  return phrase;
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
  return Array.from({ length: FORK_DEV_ACCOUNTS.length }, (_, index) => {
    key = baseKey; chain = baseChain; child(index);
    return '0x' + Buffer.from(keccak_256(pubkey(key).subarray(1)).subarray(12)).toString('hex');
  });
}
export function requirePinnedForkAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length !== FORK_DEV_ACCOUNTS.length
      || addresses.some((address, index) => address !== FORK_DEV_ACCOUNTS[index])) {
    throw new Error('FORK_ACCOUNT_DERIVATION_MISMATCH');
  }
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
  const phrase = readOwnerForkPhrase();
  requirePinnedForkAddresses(await deriveForkPublicAddresses(phrase));
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
      throw new Error(`ANVIL_${error.message}:upstream=${upstream}${status ? `:code=${status.code}:signal=${status.signal}` : ''}:[diagnostics suppressed]`, { cause: error });
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

/** The recording driver issues the same fixed-order fork reads as §3.4. */
export async function collectForkFacts({ owner, tokenIn, tokenOut, amountIn, selectedFee = null }) {
  const { createHash } = await import('node:crypto');
  const { collectScriptedForkQuote, FORK_CONTRACTS } = await import('../../../../packages/reference-compiler/dist/fork-quote.js');
  const { SWAP_ROUTER_02 } = await import('../../../../packages/reference-compiler/dist/abi.js');
  const word = value => BigInt(value).toString(16).padStart(64, '0');
  const addressWord = value => value.slice(2).padStart(64, '0');
  const call = (to, data, at) => rpc('eth_call', [{ to, data }, at]);
  const number = value => BigInt(value);
  const decodeAddress = value => `0x${value.slice(-40)}`;
  const decodeSymbol = value => {
    const bytes = Buffer.from(value.slice(2), 'hex');
    if (bytes.length < 64) throw new Error('TOKEN_METADATA_INVALID');
    const start = Number(BigInt(`0x${bytes.subarray(0, 32).toString('hex')}`));
    if (start + 32 > bytes.length) throw new Error('TOKEN_METADATA_INVALID');
    const size = Number(BigInt(`0x${bytes.subarray(start, start + 32).toString('hex')}`));
    if (size < 1 || size > 32 || start + 32 + size > bytes.length) throw new Error('TOKEN_METADATA_INVALID');
    return bytes.subarray(start + 32, start + 32 + size).toString('utf8');
  };
  const transport = async query => {
    if (query.kind === 'CHAIN') return Number(BigInt(await rpc('eth_chainId')));
    if (query.kind === 'METADATA') {
      const data = await rpc('anvil_metadata');
      return { sourceChainId: Number(data.forkedNetwork.chainId), sourceBlockHash: data.forkedNetwork.forkBlockHash };
    }
    if (query.kind === 'LATEST') {
      const block = await rpc('eth_getBlockByNumber', ['latest', false]);
      return { number: Number(BigInt(block.number)), hash: block.hash, timestamp: number(block.timestamp) };
    }
    if (query.kind === 'TAIL') {
      const block = await rpc('eth_getBlockByNumber', [`0x${query.blockNumber.toString(16)}`, false]);
      return { hash: block.hash, timestamp: number(block.timestamp) };
    }
    const at = { blockHash: query.blockHash, requireCanonical: true };
    if (query.kind === 'CODE') {
      const code = await rpc('eth_getCode', [query.address, at]);
      return `0x${createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex')}`;
    }
    if (query.kind === 'TOKEN_METADATA') return {
      decimals: Number(BigInt(await call(query.address, '0x313ce567', at))),
      symbol: decodeSymbol(await call(query.address, '0x95d89b41', at)),
    };
    if (query.kind === 'DEPLOYMENT') return {
      factory: decodeAddress(await call(query.address, '0xc45a0155', at)),
      weth9: decodeAddress(await call(query.address, '0x4aa4a4fc', at)),
    };
    if (query.kind === 'POOL') {
      const result = await call(FORK_CONTRACTS.factory, `0x1698ee82${addressWord(query.tokenIn)}${addressWord(query.tokenOut)}${word(query.fee)}`, at);
      const pool = decodeAddress(result);
      return pool === `0x${'00'.repeat(20)}` ? null : pool;
    }
    if (query.kind === 'QUOTE') {
      let result;
      try {
        result = await call(FORK_CONTRACTS.quoter,
          `0xc6a5026a${addressWord(query.tokenIn)}${addressWord(query.tokenOut)}${word(query.amountIn)}${word(query.fee)}${word(0)}`, at);
      } catch (error) {
        if (/execution reverted|revert data/i.test(String(error)) && !String(error).includes('FORK_STATE_UNRECORDED')) return null;
        throw error;
      }
      if (!/^0x[0-9a-f]{256,}$/.test(result)) throw new Error('QUOTE_INVALID');
      return { amountOut: BigInt(`0x${result.slice(2, 66)}`), sqrtPriceX96After: BigInt(`0x${result.slice(66, 130)}`) };
    }
    if (query.kind === 'ACCOUNT') return {
      inputBalance: BigInt(await call(query.tokenIn, `0x70a08231${addressWord(query.owner)}`, at)),
      ethBalance: BigInt(await rpc('eth_getBalance', [query.owner, at])),
      allowance: BigInt(await call(query.tokenIn, `0xdd62ed3e${addressWord(query.owner)}${addressWord(SWAP_ROUTER_02)}`, at)),
      nonce: BigInt(await rpc('eth_getTransactionCount', [query.owner, at])),
      code: await rpc('eth_getCode', [query.owner, at]),
    };
    throw new Error('FORK_QUERY_INVALID');
  };
  const routerCode = await rpc('eth_getCode', [FORK_CONTRACTS.router, 'latest']);
  const reviewedRouterCodeHash = `0x${createHash('sha256').update(Buffer.from(routerCode.slice(2), 'hex')).digest('hex')}`;
  return collectScriptedForkQuote(transport, { owner, tokenIn, tokenOut, amountIn, selectedFee, reviewedRouterCodeHash });
}

/** One deterministic owner-run recording scenario; never invoked during G4 preflight. */
async function runSwapScenario({ owner, setupAccount, tokenIn, tokenOut, amountIn, disposition }) {
  const { buildModeAPair, decodeUnsignedPayload, fromHex, toHex } = await import('../../../../packages/reference-compiler/dist/payload.js');
  const { validateForkQuote, FORK_CONTRACTS } = await import('../../../../packages/reference-compiler/dist/fork-quote.js');
  const { verifySignedPayload } = await import('../../../../packages/reference-reconciler/dist/raw-transaction.js');
  const { encodeApprove, SWAP_ROUTER_02 } = await import('../../../../packages/reference-compiler/dist/abi.js');
  const bigHex = value => `0x${BigInt(value).toString(16)}`;
  const firstFacts = await collectForkFacts({ owner, tokenIn, tokenOut, amountIn });
  const best = firstFacts.tiers.filter(row => row.status === 'QUOTED')
    .sort((a, b) => a.amountOut === b.amountOut ? a.fee - b.fee : a.amountOut > b.amountOut ? -1 : 1)[0];
  if (!best) throw new Error('NO_FULL_INPUT_QUOTE');
  const facts = { ...firstFacts, selectedFee: best.fee };
  const quote = validateForkQuote(facts, facts.block.timestamp, amountIn, disposition === 'REVERT_AND_REVOKE' ? 0 : 100);
  const context = { owner, tokenIn, tokenOut, amountIn, amountOutMinimum: quote.minimumOut,
    fee: quote.fee, deadline: facts.block.timestamp + 180n, nonce: facts.ownerNonce };
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const maxFeePerGas = 2n * BigInt(head.baseFeePerGas) + 1_000_000n;
  const makePair = (approveGasLimit, swapGasLimit) => buildModeAPair({ ...context, approveGasLimit, swapGasLimit, maxFeePerGas });
  let pair = makePair(200000n, 600000n);
  const simulate = async value => {
    const calls = [value.approveBytes, value.swapBytes].map(bytes => {
      const decoded = decodeUnsignedPayload(bytes);
      return { from: owner, to: decoded.to, nonce: bigHex(decoded.nonce), gas: bigHex(decoded.gasLimit),
        maxFeePerGas: bigHex(decoded.maxFeePerGas), maxPriorityFeePerGas: bigHex(decoded.maxPriorityFeePerGas),
        value: '0x0', data: toHex(decoded.data) };
    });
    const result = await rpc('eth_simulateV1', [{ blockStateCalls: [{ calls }], validation: true,
      traceTransfers: false, returnFullTransactions: false }, { blockHash: facts.block.hash, requireCanonical: true }]);
    if (!Array.isArray(result) || result[0]?.calls?.length !== 2) throw new Error('SIMULATION_SHAPE_INVALID');
    return result[0].calls;
  };
  const first = await simulate(pair);
  if (first.some(call => call.status !== '0x1' || BigInt(call.gasUsed) <= 0n)) throw new Error('SIMULATION_REVERTED');
  pair = makePair((BigInt(first[0].gasUsed) * 5n + 3n) / 4n, (BigInt(first[1].gasUsed) * 5n + 3n) / 4n);
  const rebuilt = await simulate(pair);
  if (rebuilt.some((call, i) => call.status !== '0x1' || call.gasUsed !== first[i].gasUsed)) throw new Error('SIMULATION_UNSTABLE');
  const sign = async bytes => {
    const decoded = decodeUnsignedPayload(bytes);
    const raw = await rpc('eth_signTransaction', [{ from: owner, to: decoded.to, nonce: bigHex(decoded.nonce),
      gas: bigHex(decoded.gasLimit), maxFeePerGas: bigHex(decoded.maxFeePerGas),
      maxPriorityFeePerGas: bigHex(decoded.maxPriorityFeePerGas), value: '0x0', data: toHex(decoded.data),
      chainId: FORK_CHAIN_ID_HEX, type: '0x2' }]);
    const { keccak_256 } = await import('../../../../packages/reference-compiler/node_modules/@noble/hashes/sha3.js');
    const hash = toHex(keccak_256(fromHex(raw)));
    verifySignedPayload(fromHex(raw), hash, owner, bytes);
    return { raw, hash };
  };
  const submit = async signed => {
    const hash = await rpc('eth_sendRawTransaction', [signed.raw]);
    if (hash !== signed.hash) throw new Error('TX_HASH_MISMATCH');
    const stored = await rpc('eth_getRawTransactionByHash', [hash]);
    if (stored !== signed.raw) throw new Error('RAW_TRANSACTION_MISMATCH');
    return { hash, receipt: await rpc('eth_getTransactionReceipt', [hash]) };
  };
  if (disposition.startsWith('MUTATE_')) {
    const { encodeUnsignedPayload } = await import('../../../../packages/reference-compiler/dist/payload.js');
    const { decodeSwap, encodeSwap } = await import('../../../../packages/reference-compiler/dist/abi.js');
    const reviewed = decodeUnsignedPayload(pair.swapBytes);
    let changed;
    if (disposition === 'MUTATE_GAS') changed = encodeUnsignedPayload({ ...reviewed, gasLimit: reviewed.gasLimit + 1n });
    else {
      const decoded = decodeSwap(reviewed.data);
      const replacement = disposition === 'MUTATE_RECIPIENT'
        ? { ...decoded, recipient: setupAccount }
        : disposition === 'MUTATE_DATA'
          ? { ...decoded, amountOutMinimum: decoded.amountOutMinimum + 1n }
          : null;
      if (!replacement) throw new Error('ADVERSARIAL_CASE_INVALID');
      changed = encodeUnsignedPayload({ ...reviewed, data: encodeSwap(replacement) });
    }
    const adversarial = await sign(changed);
    let divergent = false;
    try { verifySignedPayload(fromHex(adversarial.raw), adversarial.hash, owner, pair.swapBytes); }
    catch (error) { divergent = String(error).includes('PAYLOAD_FIDELITY_FAILED'); }
    if (!divergent) throw new Error('ADVERSARIAL_PAYLOAD_ACCEPTED');
    return { disposition, outcome: 'DIVERGENT', reviewedSwapPayload: toHex(pair.swapBytes),
      signedTransactionHash: adversarial.hash, broadcast: false };
  }
  const approval = await sign(pair.approveBytes);
  const approvalResult = await submit(approval);
  if (approvalResult.receipt?.status !== '0x1') throw new Error('APPROVAL_NOT_CONFIRMED');
  let swap = await sign(pair.swapBytes);
  if (disposition === 'THROW_BEFORE_BROADCAST') {
    const before = await rpc('eth_getTransactionCount', [owner, 'latest']);
    if (BigInt(before) !== context.nonce + 1n || await rpc('eth_getTransactionByHash', [swap.hash]) !== null) throw new Error('BEFORE_BROADCAST_RECOVERY_INVALID');
    const retried = await sign(pair.swapBytes);
    if (retried.raw !== swap.raw) throw new Error('RETRY_PAYLOAD_CHANGED');
    swap = retried;
  }
  if (disposition === 'REVERT_AND_REVOKE') {
    // A same-pool setup-account swap moves price after the owner's quote.
    const setup = setupAccount;
    const { encodeSwap } = await import('../../../../packages/reference-compiler/dist/abi.js');
    const w = 10n ** 18n;
    const headNow = await rpc('eth_getBlockByNumber', ['latest', false]);
    const feeCap = bigHex(2n * BigInt(headNow.baseFeePerGas) + 1_000_000n);
    const localSend = async (to, data, value = 0n) => rpc('eth_sendTransaction', [{ from: setup, to, data,
      value: bigHex(value), gas: '0xf4240', maxFeePerGas: feeCap, maxPriorityFeePerGas: '0xf4240' }]);
    await localSend(FORK_CONTRACTS.weth, '0xd0e30db0', w);
    await localSend(FORK_CONTRACTS.weth, toHex(encodeApprove(SWAP_ROUTER_02, w)));
    await localSend(SWAP_ROUTER_02, toHex(encodeSwap({ tokenIn, tokenOut, fee: quote.fee, recipient: setup,
      amountIn: w, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
      deadline: BigInt(headNow.timestamp) + 180n })));
  }
  let result;
  if (disposition === 'PENDING') {
    await rpc('anvil_setAutomine', [false]);
    try {
      const pendingHash = await rpc('eth_sendRawTransaction', [swap.raw]);
      if (pendingHash !== swap.hash) throw new Error('PENDING_HASH_MISMATCH');
      const pool = await rpc('txpool_content');
      if (!pool?.pending) throw new Error('PENDING_NOT_VISIBLE');
      await rpc('evm_mine');
      result = { hash: pendingHash, receipt: await rpc('eth_getTransactionReceipt', [pendingHash]) };
    } finally { await rpc('anvil_setAutomine', [true]); }
  } else {
    result = await submit(swap);
  }
  if (!result.receipt || result.receipt.transactionHash !== swap.hash) throw new Error('SWAP_RECEIPT_MISSING');
  if (disposition === 'REVERT_AND_REVOKE') {
    if (result.receipt.status !== '0x0') throw new Error('ADVERSARIAL_SWAP_DID_NOT_REVERT');
    const allowanceData = `0xdd62ed3e${owner.slice(2).padStart(64, '0')}${SWAP_ROUTER_02.slice(2).padStart(64, '0')}`;
    const residual = BigInt(await rpc('eth_call', [{ to: tokenIn, data: allowanceData }, 'latest']));
    if (residual !== amountIn) throw new Error('RESIDUAL_ALLOWANCE_MISMATCH');
    const nonce = BigInt(await rpc('eth_getTransactionCount', [owner, 'latest']));
    const headAfter = await rpc('eth_getBlockByNumber', ['latest', false]);
    const zero = await sign((await import('../../../../packages/reference-compiler/dist/payload.js')).encodeUnsignedPayload({
      chainId: 31337, nonce, maxPriorityFeePerGas: 1000000n,
      maxFeePerGas: BigInt(headAfter.baseFeePerGas) * 2n + 1000000n,
      gasLimit: 100000n, to: tokenIn, value: 0n, data: encodeApprove(SWAP_ROUTER_02, 0n), accessList: [],
    }));
    const revoked = await submit(zero);
    if (revoked.receipt?.status !== '0x1') throw new Error('REVOCATION_FAILED');
    return { disposition, approvalHash: approval.hash, swapHash: swap.hash, revocationHash: zero.hash,
      swapStatus: result.receipt.status, residualBeforeRevocation: residual.toString() };
  }
  if (result.receipt.status !== '0x1') throw new Error('SWAP_NOT_CONFIRMED');
  if (disposition === 'BROADCAST_THEN_HANG') {
    const observed = await rpc('eth_getTransactionByHash', [swap.hash]);
    if (observed?.hash !== swap.hash || BigInt(await rpc('eth_getTransactionCount', [owner, 'latest'])) !== context.nonce + 2n) throw new Error('UNKNOWN_RESULT_RECOVERY_INVALID');
  }
  return { disposition, fee: quote.fee, quotedOut: quote.amountOut.toString(),
    approvalHash: approval.hash, swapHash: swap.hash, swapStatus: result.receipt.status,
    approveGasUsed: rebuilt[0].gasUsed, swapGasUsed: rebuilt[1].gasUsed };
}

export async function runRecordingScenarios(sourceBlockNumber, { recording = false } = {}) {
  const { prepareForkFixture } = await import('./fork-setup.mjs');
  const { FORK_CONTRACTS } = await import('../../../../packages/reference-compiler/dist/fork-quote.js');
  const setup = await prepareForkFixture(sourceBlockNumber, { requirePinnedIndices: !recording });
  let snapshot = await rpc('evm_snapshot');
  const scenarios = [
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'CONFIRMED' },
    { tokenIn: FORK_CONTRACTS.usdc, tokenOut: FORK_CONTRACTS.weth, amountIn: 2500n * 10n ** 6n, disposition: 'CONFIRMED' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'BROADCAST_THEN_HANG' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'THROW_BEFORE_BROADCAST' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'PENDING' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'REVERT_AND_REVOKE' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'MUTATE_RECIPIENT' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'MUTATE_DATA' },
    { tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, amountIn: 10n ** 18n, disposition: 'MUTATE_GAS' },
  ];
  const results = [];
  for (const scenario of scenarios) {
    if (await rpc('evm_revert', [snapshot]) !== true) throw new Error('SNAPSHOT_REVERT_FAILED');
    snapshot = await rpc('evm_snapshot');
    results.push(await runSwapScenario({ owner: setup.owner, setupAccount: setup.setup, ...scenario }));
  }
  return { setup, results };
}

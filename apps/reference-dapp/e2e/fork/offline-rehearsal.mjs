// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-003F F1: synthetic chain 8453 -> counted loopback proxy -> local Anvil 31337.
 * No owner phrase, provider, fixed signing key, or public-network destination is used.
 */
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import { secp256k1 } from '../../../../packages/reference-reconciler/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../../../../packages/reference-compiler/node_modules/@noble/hashes/sha3.js';
import { forkAnvilArgs, FORK_CHAIN_ID_HEX, routeForkUpstreamRequest } from '../../../../packages/reference-compiler/dist/profile.js';
import { FORK_CONTRACTS } from '../../../../packages/reference-compiler/dist/fork-quote.js';
import { encodeApprove, encodeSwap, SWAP_ROUTER_02 } from '../../../../packages/reference-compiler/dist/abi.js';
import { buildModeAPair, encodeUnsignedPayload, decodeUnsignedPayload, payloadIdentity, toHex, fromHex } from '../../../../packages/reference-compiler/dist/payload.js';
import { compilePolicy } from '../../../../packages/reference-compiler/dist/policy.js';
import { compileManifest } from '../../../../packages/reference-compiler/dist/manifest.js';
import { compileExecutionPlan } from '../../../../packages/reference-compiler/dist/execution-plan.js';
import { compileEnforcementMatrix } from '../../../../packages/reference-compiler/dist/enforcement.js';
import { reviewModeAPayloads } from '../../../../packages/reference-compiler/dist/review.js';
import { runScriptedExactSimulation } from '../../../../packages/reference-compiler/dist/simulation.js';
import { rlpDecode, rlpEncode, rlpList, rlpInteger } from '../../../../packages/reference-compiler/dist/rlp.js';
import { verifySignedPayload } from '../../../../packages/reference-reconciler/dist/raw-transaction.js';
import { reconcileModeA } from '../../../../packages/reference-reconciler/dist/reconcile.js';
import { buildEvidenceBundle } from '../../../../packages/reference-reconciler/dist/evidence.js';
import { createAttemptCoordinator, transitionAttemptState } from '../../../../packages/reference-executor/dist/attempts.js';
import { writeExtendingFile, readValidatedFile } from '../../../../packages/reference-executor/dist/file-store.js';
import { createJournal, appendJournalState } from '../../../../packages/reference-executor/dist/journal.js';
import { hashRawBytes, hashJournalBytes } from '../../../../packages/workflow-contracts/dist/index.js';
import { sendSetupTransaction } from './fork-setup.mjs';
import { validateAnvilBinary, probePort, verifyOwnerForkAccountSource } from './harness.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const asHex = value => `0x${BigInt(value).toString(16)}`;
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
const TRANSFER_TOPIC = toHex(keccak_256(new TextEncoder().encode('Transfer(address,address,uint256)')));
const APPROVAL_TOPIC = toHex(keccak_256(new TextEncoder().encode('Approval(address,address,uint256)')));
const WETH_UNIT = 10n ** 18n;
const USDC_UNIT = 10n ** 6n;
const PRICE = 2500n;
const SYNTHETIC_POOL = '0x000000000000000000000000000000000000f001';

const OPCODES = Object.freeze({ STOP: 0x00, ADD: 0x01, MUL: 0x02, SUB: 0x03, DIV: 0x04, LT: 0x10,
  GT: 0x11, EQ: 0x14, ISZERO: 0x15, SHA3: 0x20, ADDRESS: 0x30, CALLER: 0x33, CALLVALUE: 0x34,
  CALLDATALOAD: 0x35, CALLDATASIZE: 0x36, TIMESTAMP: 0x42, GAS: 0x5a,
  POP: 0x50, MLOAD: 0x51, MSTORE: 0x52, SLOAD: 0x54, SSTORE: 0x55,
  JUMP: 0x56, JUMPI: 0x57, JUMPDEST: 0x5b, RETURN: 0xf3, REVERT: 0xfd,
  CALL: 0xf1, LOG3: 0xa3, SHR: 0x1c, DUP1: 0x80, SWAP1: 0x90, AND: 0x16, OR: 0x17, STATICCALL: 0xfa });
class Assembly {
  bytes = [];
  labels = new Map();
  fixups = [];
  op(name) { this.bytes.push(OPCODES[name]); return this; }
  push(value) {
    let hex = BigInt(value).toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const parts = Buffer.from(hex, 'hex');
    if (parts.length < 1 || parts.length > 32) throw new Error('SYNTHETIC_PUSH_INVALID');
    this.bytes.push(0x5f + parts.length, ...parts);
    return this;
  }
  label(name) { if (this.labels.has(name)) throw new Error('SYNTHETIC_LABEL_DUPLICATE'); this.labels.set(name, this.bytes.length); return this.op('JUMPDEST'); }
  branch(name, conditional = true) { this.bytes.push(0x61, 0, 0); this.fixups.push({ name, at: this.bytes.length - 2 }); return this.op(conditional ? 'JUMPI' : 'JUMP'); }
  load(offset) { return this.push(offset).op('MLOAD'); }
  store(offset) { return this.push(offset).op('MSTORE'); }
  input(offset) { return this.push(offset).op('CALLDATALOAD'); }
  finish() {
    for (const { name, at } of this.fixups) {
      const value = this.labels.get(name);
      if (value === undefined || value > 65535) throw new Error('SYNTHETIC_LABEL_INVALID');
      this.bytes[at] = value >> 8; this.bytes[at + 1] = value & 255;
    }
    return `0x${Buffer.from(this.bytes).toString('hex')}`;
  }
}
function balanceKey(a, addressOffset) {
  a.load(addressOffset).store(0x100);
  a.push(0).store(0x120);
  a.push(0x40).push(0x100).op('SHA3');
}
function allowanceKey(a) {
  a.load(0).store(0x100);
  a.push(1).store(0x120);
  a.push(0x40).push(0x100).op('SHA3').store(0x120);
  a.load(0x60).store(0x100);
  a.push(0x40).push(0x100).op('SHA3');
}
function returnWord(a) { a.store(0x100).push(0x20).push(0x100).op('RETURN'); }
function emitTokenLog(a, topic) {
  a.load(0x40).store(0x100);
  a.load(0x20).load(0).push(BigInt(topic)).push(0x20).push(0x100).op('LOG3');
}
function transferBalances(a) {
  balanceKey(a, 0); a.store(0x80);
  a.load(0x80).op('SLOAD').store(0xa0);
  a.load(0xa0).load(0x40).op('GT').branch('revert');
  a.load(0x40).load(0xa0).op('SUB').load(0x80).op('SSTORE');
  balanceKey(a, 0x20); a.store(0x80);
  a.load(0x80).op('SLOAD').load(0x40).op('ADD').load(0x80).op('SSTORE');
  emitTokenLog(a, TRANSFER_TOPIC);
}
function tokenCode(metadata = null) {
  const a = new Assembly();
  a.input(0).push(224).op('SHR');
  for (const [selector, label] of [
    [0x70a08231, 'balance'], [0xdd62ed3e, 'allowance'], [0x095ea7b3, 'approve'],
    [0xa9059cbb, 'transfer'], [0x23b872dd, 'transferFrom'],
    ...(metadata === null || metadata.deposit ? [[0xd0e30db0, 'deposit']] : []),
    ...(metadata === null ? [] : [[0x95d89b41, 'symbol'], [0x313ce567, 'decimals']]),
  ]) a.op('DUP1').push(selector).op('EQ').branch(label);
  a.branch('revert', false);
  if (metadata !== null) {
    // ABI string: offset, length, left-aligned bytes.
    const bytes = Buffer.from(metadata.symbol, 'utf8');
    a.label('symbol').op('POP'); a.push(0x20).store(0x100); a.push(bytes.length).store(0x120);
    a.push(BigInt(`0x${bytes.toString('hex').padEnd(64, '0')}`)).store(0x140);
    a.push(0x60).push(0x100).op('RETURN');
    a.label('decimals').op('POP'); a.push(metadata.decimals); returnWord(a);
  }
  a.label('balance').op('POP'); a.input(4).store(0); balanceKey(a, 0); a.op('SLOAD'); returnWord(a);
  a.label('allowance').op('POP'); a.input(4).store(0); a.input(36).store(0x60);
  allowanceKey(a); a.op('SLOAD'); returnWord(a);
  a.label('approve').op('POP'); a.op('CALLER').store(0); a.input(4).store(0x60).load(0x60).store(0x20);
  a.input(36).store(0x40); allowanceKey(a); a.load(0x40).op('SWAP1').op('SSTORE');
  emitTokenLog(a, APPROVAL_TOPIC); a.push(1); returnWord(a);
  a.label('transfer').op('POP'); a.op('CALLER').store(0); a.input(4).store(0x20); a.input(36).store(0x40);
  transferBalances(a); a.push(1); returnWord(a);
  a.label('transferFrom').op('POP'); a.input(4).store(0); a.input(36).store(0x20); a.input(68).store(0x40);
  a.op('CALLER').store(0x60); allowanceKey(a); a.store(0x80);
  a.load(0x80).op('SLOAD').store(0xa0);
  a.load(0xa0).load(0x40).op('GT').branch('revert');
  a.load(0x40).load(0xa0).op('SUB').load(0x80).op('SSTORE');
  transferBalances(a); a.push(1); returnWord(a);
  if (metadata === null || metadata.deposit) {
    a.label('deposit').op('POP'); a.op('CALLER').store(0); a.op('CALLVALUE').store(0x40);
    balanceKey(a, 0); a.store(0x80);
    a.load(0x80).op('SLOAD').load(0x40).op('ADD').load(0x80).op('SSTORE');
    a.push(0).push(0).op('RETURN');
  }
  a.label('revert').push(0).push(0).op('REVERT');
  return a.finish();
}
function callToken(a, tokenOffset, size) {
  a.push(0).push(0).push(size).push(0x100).push(0).load(tokenOffset).op('GAS').op('CALL');
  a.op('ISZERO').branch('revert');
}
function routerCode() {
  const a = new Assembly();
  a.input(0).push(224).op('SHR').push(0x5ae401dc).op('EQ').branch('swap');
  a.branch('revert', false);
  a.label('swap');
  a.input(4).op('TIMESTAMP').op('GT').branch('revert');
  a.input(164).push(224).op('SHR').push(0x04e45aaf).op('EQ').op('ISZERO').branch('revert');
  a.input(168).store(0); a.input(200).store(0x20); a.input(264).store(0x60);
  a.input(296).store(0x40); a.input(328).store(0x80); a.op('CALLER').store(0xa0);
  a.load(0).push(BigInt(FORK_CONTRACTS.weth)).op('EQ').branch('wethIn');
  a.load(0).push(BigInt(FORK_CONTRACTS.usdc)).op('EQ').op('ISZERO').branch('revert');
  a.load(0x40).push(WETH_UNIT).op('MUL').push(PRICE * USDC_UNIT).op('SWAP1').op('DIV').store(0xc0);
  a.branch('transfer', false);
  a.label('wethIn');
  a.load(0x40).push(PRICE * USDC_UNIT).op('MUL').push(WETH_UNIT).op('SWAP1').op('DIV').store(0xc0);
  a.label('transfer');
  a.load(0x80).load(0xc0).op('LT').branch('revert');
  a.push(BigInt('0x23b872dd') << 224n).store(0x100);
  a.load(0xa0).store(0x104); a.push(BigInt(SYNTHETIC_POOL)).store(0x124); a.load(0x40).store(0x144);
  callToken(a, 0, 100);
  a.push(BigInt('0x23b872dd') << 224n).store(0x100);
  a.push(BigInt(SYNTHETIC_POOL)).store(0x104); a.load(0x60).store(0x124); a.load(0xc0).store(0x144);
  callToken(a, 0x20, 100);
  a.load(0xc0); returnWord(a);
  a.label('revert').push(0).push(0).op('REVERT');
  return a.finish();
}


/**
 * BUILD-003F Base-like synthetic set (MOCKED): Uniswap-shaped factory, quoter and a constant-product
 * SwapRouter02 at the real Base addresses, so the unmodified quote, setup and Mode A paths run against
 * them. Output is reserveOut * amountIn / (reserveIn + amountIn) from the pool's token balances; quoter
 * and router use the identical formula, and a prior swap moves the price.
 */
const SYNTHETIC_FEE = 3000;
function poolBalance(a, tokenOffset, destination) {
  a.push(BigInt('0x70a08231') << 224n).store(0x100);
  a.push(BigInt(SYNTHETIC_POOL)).store(0x104);
  a.push(0x20).push(0x180).push(0x24).push(0x100).load(tokenOffset).op('GAS').op('STATICCALL');
  a.op('ISZERO').branch('revert');
  a.load(0x180).store(destination);
}
function constantProductOut(a) {
  // 0x00 tokenIn, 0x20 tokenOut, 0x40 amountIn -> 0xc0 amountOut.
  poolBalance(a, 0, 0xe0); poolBalance(a, 0x20, 0x1e0);
  a.load(0xe0).load(0x40).op('ADD');
  a.load(0x1e0).load(0x40).op('MUL').op('DIV').store(0xc0);
}
function requireSyntheticPair(a) {
  const pair = (first, second) => {
    a.load(0).push(BigInt(first)).op('EQ').load(0x20).push(BigInt(second)).op('EQ').op('AND');
  };
  pair(FORK_CONTRACTS.weth, FORK_CONTRACTS.usdc); pair(FORK_CONTRACTS.usdc, FORK_CONTRACTS.weth); a.op('OR');
}
function deploymentBranches(a) {
  a.op('DUP1').push(0xc45a0155).op('EQ').branch('factory');
  a.op('DUP1').push(0x4aa4a4fc).op('EQ').branch('weth9');
}
function deploymentLabels(a) {
  a.label('factory').op('POP'); a.push(BigInt(FORK_CONTRACTS.factory)); returnWord(a);
  a.label('weth9').op('POP'); a.push(BigInt(FORK_CONTRACTS.weth)); returnWord(a);
}
function factoryCode() {
  const a = new Assembly();
  a.input(0).push(224).op('SHR').push(0x1698ee82).op('EQ').branch('getPool');
  a.branch('revert', false);
  a.label('getPool'); a.input(4).store(0); a.input(36).store(0x20);
  requireSyntheticPair(a); a.input(68).push(SYNTHETIC_FEE).op('EQ').op('AND').branch('pool');
  a.push(0); returnWord(a);
  a.label('pool'); a.push(BigInt(SYNTHETIC_POOL)); returnWord(a);
  a.label('revert').push(0).push(0).op('REVERT');
  return a.finish();
}
function quoterCode() {
  const a = new Assembly();
  a.input(0).push(224).op('SHR');
  deploymentBranches(a);
  a.op('DUP1').push(0xc6a5026a).op('EQ').branch('quote');
  a.branch('revert', false);
  deploymentLabels(a);
  a.label('quote').op('POP'); a.input(4).store(0); a.input(36).store(0x20); a.input(68).store(0x40);
  requireSyntheticPair(a); a.input(100).push(SYNTHETIC_FEE).op('EQ').op('AND').op('ISZERO').branch('revert');
  constantProductOut(a);
  a.load(0xc0).store(0x200); a.push(1n << 96n).store(0x220); a.push(0).store(0x240); a.push(100_000).store(0x260);
  a.push(0x80).push(0x200).op('RETURN');
  a.label('revert').push(0).push(0).op('REVERT');
  return a.finish();
}
function constantProductRouterCode() {
  const a = new Assembly();
  a.input(0).push(224).op('SHR');
  deploymentBranches(a);
  a.op('DUP1').push(0x5ae401dc).op('EQ').branch('swap');
  a.branch('revert', false);
  deploymentLabels(a);
  a.label('swap').op('POP');
  a.input(4).op('TIMESTAMP').op('GT').branch('revert');
  a.input(164).push(224).op('SHR').push(0x04e45aaf).op('EQ').op('ISZERO').branch('revert');
  a.input(168).store(0); a.input(200).store(0x20); a.input(264).store(0x60);
  a.input(296).store(0x40); a.input(328).store(0x80); a.op('CALLER').store(0xa0);
  requireSyntheticPair(a); a.input(232).push(SYNTHETIC_FEE).op('EQ').op('AND').op('ISZERO').branch('revert');
  constantProductOut(a);
  a.load(0x80).load(0xc0).op('LT').branch('revert');
  a.push(BigInt('0x23b872dd') << 224n).store(0x100);
  a.load(0xa0).store(0x104); a.push(BigInt(SYNTHETIC_POOL)).store(0x124); a.load(0x40).store(0x144);
  callToken(a, 0, 100);
  a.push(BigInt('0x23b872dd') << 224n).store(0x100);
  a.push(BigInt(SYNTHETIC_POOL)).store(0x104); a.load(0x60).store(0x124); a.load(0xc0).store(0x144);
  callToken(a, 0x20, 100);
  // multicall returns bytes[] holding the one exactInputSingle result.
  a.push(0x20).store(0x200); a.push(1).store(0x220); a.push(0x20).store(0x240); a.push(0x20).store(0x260);
  a.load(0xc0).store(0x280); a.push(0xa0).push(0x200).op('RETURN');
  a.label('revert').push(0).push(0).op('REVERT');
  return a.finish();
}
export const SYNTHETIC_RESERVES = Object.freeze({ usdc: 5_000_000n * USDC_UNIT, weth: 2_000n * WETH_UNIT });
/**
 * Base-like OP-stack L1 fee inputs in the L1Block predeploy (Ecotone layout): L1 base fee 1 gwei (slot 1),
 * packed base-fee scalar 2269 and blob-base-fee scalar 1055931 (slot 3), blob base fee 1 wei (slot 7) and the
 * operator fee parameters (slot 8).
 * Anvil forking chain 8453 reads these while mining, so receipts carry a nonzero L1 fee as on Base.
 */
const L1_BLOCK = '0x4200000000000000000000000000000000000015';
const L1_FEE_SLOTS = Object.freeze([['0x1', 1_000_000_000n], ['0x3', (2269n << 96n) | (1_055_931n << 64n) | 1n], ['0x7', 1n],
  // Operator fee parameters (scalar 1e9, constant 1e9 wei), deliberately nonzero so the full fee path is exercised.
  ['0x8', (1_000_000_000n << 64n) | 1_000_000_000n]]);
/** Installs the Base-like set on any local chain and returns its reviewed code digests. */
export async function installSyntheticBase(call, { opStackFees = true } = {}) {
  if (opStackFees) for (const [slot, value] of L1_FEE_SLOTS) await call('anvil_setStorageAt', [L1_BLOCK, `0x${word(BigInt(slot))}`, `0x${word(value)}`]);
  const codes = {
    usdc: tokenCode({ symbol: 'USDC', decimals: 6, deposit: false }),
    weth: tokenCode({ symbol: 'WETH', decimals: 18, deposit: true }),
    factory: factoryCode(), quoter: quoterCode(), router: constantProductRouterCode(),
  };
  for (const [name, code] of Object.entries(codes)) await call('anvil_setCode', [FORK_CONTRACTS[name], code]);
  await call('anvil_setStorageAt', [FORK_CONTRACTS.usdc, balanceStorageKey(SYNTHETIC_POOL), `0x${word(SYNTHETIC_RESERVES.usdc)}`]);
  await call('anvil_setStorageAt', [FORK_CONTRACTS.weth, balanceStorageKey(SYNTHETIC_POOL), `0x${word(SYNTHETIC_RESERVES.weth)}`]);
  for (const tokenAddress of [FORK_CONTRACTS.weth, FORK_CONTRACTS.usdc]) {
    await call('anvil_setStorageAt', [tokenAddress, allowanceStorageKey(SYNTHETIC_POOL, SWAP_ROUTER_02), `0x${word(2n ** 255n)}`]);
  }
  const digest = code => sha(Buffer.from(code.slice(2), 'hex'));
  return Object.freeze({ usdc: digest(codes.usdc), weth: digest(codes.weth), factory: digest(codes.factory), quoter: digest(codes.quoter) });
}

function balanceStorageKey(account) {
  return toHex(keccak_256(fromHex(`0x${addressWord(account)}${word(0)}`)));
}
function allowanceStorageKey(owner, spender) {
  const first = keccak_256(fromHex(`0x${addressWord(owner)}${word(1)}`));
  return toHex(keccak_256(fromHex(`0x${addressWord(spender)}${Buffer.from(first).toString('hex')}`)));
}
async function localRpc(port, method, params = [], timeoutMs = 10_000) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`LOCAL_RPC_HTTP_${response.status}`);
  const body = await response.json();
  if (body.error || !Object.hasOwn(body, 'result')) throw new Error(`LOCAL_RPC_${method}:${body.error?.message ?? 'invalid'}`);
  return body.result;
}
function localCaller(port) { return (method, params = []) => localRpc(port, method, params); }
async function awaitPort(port, state = 'listening', ms = 10_000) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (await probePort(port) === state) return;
    await pause(25);
  }
  throw new Error(`LOCAL_PORT_${state.toUpperCase()}_TIMEOUT`);
}
function spawnAnvil(binary, args, runtime) {
  const child = spawn(binary, args, { cwd: runtime, stdio: ['ignore', 'pipe', 'pipe'],
    env: { HOME: runtime, PATH: '/usr/bin:/bin' } });
  child.stdout.resume(); child.stderr.resume();
  return child;
}
async function stopProcess(child, port) {
  if (child.exitCode === null && child.signalCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill('SIGKILL');
    await closed;
  }
  await awaitPort(port, 'free');
}
async function startProxy(port, targetPort, sourceBlock) {
  const counters = { providerEquivalent: 0, localReplies: 0, methods: {} };
  let stopped = false;
  const server = createServer(async (request, response) => {
    const fail = () => { stopped = true; response.writeHead(503).end(); };
    if (stopped || request.method !== 'POST' || request.url !== '/' || request.headers.host !== `127.0.0.1:${port}`) { fail(); return; }
    try {
      const parts = []; let size = 0;
      for await (const part of request) { size += part.length; if (size > 1_048_576) throw new Error('PROXY_BODY_TOO_LARGE'); parts.push(part); }
      const input = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (input?.jsonrpc !== '2.0' || !Number.isSafeInteger(input.id)) throw new Error('PROXY_REQUEST_INVALID');
      const route = routeForkUpstreamRequest(input, Number(BigInt(sourceBlock.number)), sourceBlock.hash);
      if (route.kind === 'stop') throw new Error('PROXY_UNAPPROVED_CALL');
      let body;
      if (route.kind === 'local-source-block') { counters.localReplies++; body = { result: sourceBlock }; }
      else if (route.kind === 'local-null') { counters.localReplies++; body = { result: null }; }
      else if (route.kind === 'local-error') { counters.localReplies++; body = { error: { code: route.code, message: route.message } }; }
      else {
        counters.providerEquivalent++;
        counters.methods[route.method] = (counters.methods[route.method] ?? 0) + 1;
        if (counters.providerEquivalent > 1_000) throw new Error('F1_REQUEST_ESTIMATE_CAP');
        const forwarded = await localRpc(targetPort, route.method, route.params);
        body = { result: forwarded };
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, ...body }));
    } catch { fail(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, counters, stopped: () => stopped };
}
function ephemeralAccount() {
  for (;;) {
    const key = randomBytes(32);
    try {
      const publicKey = secp256k1.getPublicKey(key, false);
      return { key, address: toHex(keccak_256(publicKey.subarray(1)).subarray(12)) };
    } catch { key.fill(0); }
  }
}
function signUnsigned(bytes, account) {
  const digest = keccak_256(bytes);
  const signature = secp256k1.sign(digest, account.key, { prehash: false, format: 'recovered' });
  if (signature[0] > 1) throw new Error('EPHEMERAL_SIGNATURE_INVALID');
  const fields = rlpList(rlpDecode(bytes.subarray(1)));
  const raw = Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(BigInt(signature[0])),
    rlpInteger(BigInt(toHex(signature.subarray(1, 33)))),
    rlpInteger(BigInt(toHex(signature.subarray(33, 65))))]));
  const hash = toHex(keccak_256(raw));
  verifySignedPayload(raw, hash, account.address, bytes);
  return { raw, hash };
}
const sha = value => `0x${createHash('sha256').update(value).digest('hex')}`;
export function validateSnapshots(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  if (!text.endsWith('\n')) throw new Error('F1_JOURNAL_CORRUPT');
  let previous = null, expected = 0;
  for (const line of text.trimEnd().split('\n')) {
    const item = JSON.parse(line);
    if (item.sequence !== expected++ || item.previous !== previous || !Array.isArray(item.attempts)
      || item.digest !== sha(JSON.stringify({ sequence: item.sequence, previous: item.previous, attempts: item.attempts }))) {
      throw new Error('F1_JOURNAL_CORRUPT');
    }
    previous = item.digest;
  }
}
export function attemptStore(path, mustExist = false) {
  const bytes = new TextEncoder();
  const raw = async () => {
    try { return await readValidatedFile(path, validateSnapshots); }
    catch (error) {
      try { await readFile(path); } catch (cause) {
        if (cause?.code === 'ENOENT' && !mustExist) return new Uint8Array();
      }
      throw error;
    }
  };
  return {
    read: async () => {
      const prior = await raw();
      if (prior.length === 0) return [];
      return JSON.parse(Buffer.from(prior).toString('utf8').trimEnd().split('\n').at(-1)).attempts;
    },
    write: async attempts => {
      const prior = await raw();
      const lines = prior.length ? Buffer.from(prior).toString('utf8').trimEnd().split('\n') : [];
      const previous = lines.length ? JSON.parse(lines.at(-1)).digest : null;
      const sequence = lines.length;
      const item = { sequence, previous, attempts };
      const digest = sha(JSON.stringify(item));
      const next = bytes.encode(`${Buffer.from(prior).toString('utf8')}${JSON.stringify({ ...item, digest })}\n`);
      await writeExtendingFile(path, next, validateSnapshots);
    },
    path,
  };
}
async function recoverInNewProcess(path, attemptId, runtime) {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--recover', path, attemptId],
    { cwd: runtime, stdio: ['ignore', 'pipe', 'pipe'],
      env: { HOME: runtime, PATH: '/usr/bin:/bin' } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  child.stderr.resume();
  const code = await new Promise(resolve => child.once('close', resolve));
  if (code !== 0) throw new Error('F1_RECOVERY_PROCESS_FAILED');
  const report = JSON.parse(output);
  if (report.pid === process.pid || report.state !== 'SUBMISSION_RESULT_UNKNOWN') {
    throw new Error('F1_RECOVERY_PROCESS_STATE_INVALID');
  }
  return report;
}
async function persistTransition(store, attemptId, state, hash = undefined) {
  const all = await store.read();
  const prior = all.find(item => item.executionAttemptId === attemptId);
  if (!prior) throw new Error('F1_ATTEMPT_MISSING');
  const next = transitionAttemptState(prior, state, hash === undefined ? prior.transactionHash : hash);
  await store.write(all.map(item => item.executionAttemptId === attemptId ? next : item));
  return next;
}
function makeJournalFromSnapshots(path, executionId, executionPlanHash, manifestHash) {
  const bytes = requireRead(path);
  let journal = createJournal({ journalId: `journal-${executionId}`, workflowId: `workflow-${executionId}`,
    executionPlanHash, manifestHash });
  const parent = (level, entityId, toState, segmentId = null, stepId = null) => {
    journal = appendJournalState(journal, { level, entityId, segmentId, stepId,
      executionAttemptId: null, toState, recordedAt: new Date().toISOString() }).journal;
  };
  parent('workflow', journal.workflowId, 'DRAFT');
  parent('segment', 'segment-swap', 'PLANNED', 'segment-swap');
  for (const step of ['step-approve', 'step-swap']) parent('step', step, 'PLANNED', 'segment-swap', step);
  for (const state of ['REVIEWED', 'SIMULATED', 'AUTHORIZED', 'EXECUTING']) parent('workflow', journal.workflowId, state);
  for (const state of ['READY', 'EXECUTING']) parent('segment', 'segment-swap', state, 'segment-swap');
  for (const step of ['step-approve', 'step-swap']) for (const state of ['READY', 'EXECUTING']) {
    parent('step', step, state, 'segment-swap', step);
  }
  const last = new Map();
  for (const line of bytes.trimEnd().split('\n')) {
    const snapshot = JSON.parse(line);
    for (const attempt of snapshot.attempts) {
      if (last.get(attempt.executionAttemptId) === attempt.state) continue;
      journal = appendJournalState(journal, { level: 'attempt', entityId: attempt.executionAttemptId,
        segmentId: 'segment-swap', stepId: attempt.stepId, executionAttemptId: attempt.executionAttemptId,
        toState: attempt.state, recordedAt: new Date().toISOString() }).journal;
      last.set(attempt.executionAttemptId, attempt.state);
    }
  }
  for (const step of ['step-approve', 'step-swap']) for (const state of ['RECONCILING', 'COMPLETED']) {
    parent('step', step, state, 'segment-swap', step);
  }
  for (const state of ['RECONCILING', 'COMPLETED']) parent('segment', 'segment-swap', state, 'segment-swap');
  for (const state of ['RECONCILING', 'COMPLETED']) parent('workflow', journal.workflowId, state);
  return journal;
}
function requireRead(path) { return Buffer.from(requireReadBytes(path)).toString('utf8'); }
function requireReadBytes(path) { return readFileSync(path); }
async function waitForReceipt(call, hash, expectedStatus, deadlineMs = 10_000) {
  const deadline = performance.now() + deadlineMs;
  for (;;) {
    const receipt = await call('eth_getTransactionReceipt', [hash]);
    if (receipt) {
      if (receipt.transactionHash !== hash || receipt.status !== expectedStatus
        || !/^0x[0-9a-f]{64}$/.test(receipt.blockHash)) throw new Error('F1_RECEIPT_MISMATCH');
      const block = await call('eth_getBlockByHash', [receipt.blockHash, true]);
      if (block?.hash !== receipt.blockHash || !block.transactions?.some(tx => tx.hash === hash)) throw new Error('F1_BLOCK_MISMATCH');
      return receipt;
    }
    if (performance.now() >= deadline) throw new Error('F1_RECEIPT_TIMEOUT');
    await pause(25);
  }
}
async function readAccountState(call, tokenIn, tokenOut, owner, blockHash) {
  const tag = { blockHash, requireCanonical: true };
  const balance = async (token, account) => BigInt(await call('eth_call',
    [{ to: token, data: `0x70a08231${addressWord(account)}` }, tag]));
  const allowance = BigInt(await call('eth_call', [{ to: tokenIn,
    data: `0xdd62ed3e${addressWord(owner)}${addressWord(SWAP_ROUTER_02)}` }, tag]));
  return { input: await balance(tokenIn, owner), output: await balance(tokenOut, owner),
    eth: BigInt(await call('eth_getBalance', [owner, tag])), allowance,
    nonce: BigInt(await call('eth_getTransactionCount', [owner, tag])),
    routerInputResidue: await balance(tokenIn, SWAP_ROUTER_02),
    routerOutputResidue: await balance(tokenOut, SWAP_ROUTER_02) };
}
function receiptForReconciler(receipt) {
  return { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash,
    status: Number(BigInt(receipt.status)), gasUsed: BigInt(receipt.gasUsed),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
    l1Fee: receipt.l1Fee == null ? null : BigInt(receipt.l1Fee),
    logs: receipt.logs.map(log => ({ address: log.address.toLowerCase(), topics: log.topics.map(topic => topic.toLowerCase()), data: log.data.toLowerCase() })) };
}
async function independentReconciliation(call, input, blocks) {
  try {
    if (Number(BigInt(await call('eth_chainId'))) !== 31337) throw new Error('F1_RECONCILE_CHAIN');
    const approvalRaw = await call('eth_getRawTransactionByHash', [input.approveHash]);
    const swapRaw = await call('eth_getRawTransactionByHash', [input.swapHash]);
    const approvalReceipt = await call('eth_getTransactionReceipt', [input.approveHash]);
    const swapReceipt = await call('eth_getTransactionReceipt', [input.swapHash]);
    const before = await readAccountState(call, input.tokenIn, input.tokenOut, input.owner, blocks.before);
    const afterApproval = await readAccountState(call, input.tokenIn, input.tokenOut, input.owner, blocks.afterApproval);
    const after = await readAccountState(call, input.tokenIn, input.tokenOut, input.owner, blocks.after);
    const consistency = await call('eth_getBlockByHash', [blocks.after, false]);
    if (!approvalRaw || !swapRaw || !approvalReceipt || !swapReceipt || consistency?.hash !== blocks.after) {
      throw new Error('F1_RECONCILE_DATA_MISSING');
    }
    return reconcileModeA({ ...input, approveRaw: fromHex(approvalRaw), swapRaw: fromHex(swapRaw),
      approveReceipt: receiptForReconciler(approvalReceipt), swapReceipt: receiptForReconciler(swapReceipt),
      before, afterApproval: { allowance: afterApproval.allowance, nonce: afterApproval.nonce }, after,
      lastReadBlockHash: blocks.after, consistencyReadBlockHash: consistency.hash });
  } catch (error) { throw new Error(`F1_RECONCILE_QUERY:${error?.message ?? 'UNKNOWN'}`, { cause: error }); }
}
async function failClosedProxyProbe(port, targetPort, sourceBlock) {
  if (await probePort(port) !== 'free' || await probePort(targetPort) !== 'free') throw new Error('F1_PROBE_PORT_OCCUPIED');
  const proxy = await startProxy(port, targetPort, sourceBlock);
  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${port}`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    if (response.status !== 503 || !proxy.stopped() || proxy.counters.providerEquivalent !== 1) {
      throw new Error('F1_PROXY_FAILURE_NOT_CLOSED');
    }
    return true;
  } finally {
    proxy.server.closeAllConnections();
    await new Promise(resolve => proxy.server.close(resolve));
    await awaitPort(port, 'free');
  }
}
async function mockSecretBoundary() {
  const missing = await verifyOwnerForkAccountSource({ load: () => { throw new Error('FORK_ACCOUNT_SECRET_UNAVAILABLE'); },
    derive: async () => { throw new Error('F1_DERIVATION_AFTER_MISSING'); } }).then(() => null, error => error?.message);
  const mismatch = await verifyOwnerForkAccountSource({ load: () => Object.freeze({ marker: 'non-secret-input' }),
    derive: async () => [] }).then(() => null, error => error?.message);
  if (missing !== 'FORK_ACCOUNT_SECRET_UNAVAILABLE' || mismatch !== 'FORK_ACCOUNT_DERIVATION_MISMATCH') {
    throw new Error('F1_SECRET_BOUNDARY_WEAK');
  }
  return true;
}
async function runPass(index, runtime, binary) {
  if (process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE || process.env.GRYLOO_ALCHEMY_API_KEY) throw new Error('F1_SECRET_ENV_REFUSED');
  validateAnvilBinary(binary);
  const ports = { upstream: 19000 + index * 10, proxy: 19001 + index * 10, fork: 19002 + index * 10 };
  for (const port of Object.values(ports)) if (await probePort(port) !== 'free') throw new Error('F1_PORT_OCCUPIED');
  const children = [];
  let proxy;
  const owner = ephemeralAccount();
  const setup = ephemeralAccount();
  try {
    const upstream = spawnAnvil(binary, ['--host', '127.0.0.1', '--port', String(ports.upstream), '--chain-id', '8453',
      '--accounts', '0', '--disable-default-create2-deployer'], runtime);
    children.push({ child: upstream, port: ports.upstream });
    await awaitPort(ports.upstream);
    const upstreamCall = localCaller(ports.upstream);
    await upstreamCall('evm_mine');
    const sourceBlock = await upstreamCall('eth_getBlockByNumber', ['latest', false]);
    if (!sourceBlock || !/^0x[0-9a-f]{64}$/.test(sourceBlock.hash)) throw new Error('F1_SOURCE_BLOCK_INVALID');
    proxy = await startProxy(ports.proxy, ports.upstream, sourceBlock);
    const args = [...forkAnvilArgs({ port: ports.fork, forkUrl: `http://127.0.0.1:${ports.proxy}`,
      forkBlockNumber: Number(BigInt(sourceBlock.number)), timeoutMs: 20_000 })];
    args[args.indexOf('--accounts') + 1] = '0';
    args.push('--disable-default-create2-deployer');
    const fork = spawnAnvil(binary, args, runtime);
    children.push({ child: fork, port: ports.fork });
    await awaitPort(ports.fork);
    const call = localCaller(ports.fork);
    if (await call('eth_chainId') !== FORK_CHAIN_ID_HEX) throw new Error('F1_CHAIN_INVALID');
    const metadata = await call('anvil_metadata');
    if (Number(metadata?.forkedNetwork?.chainId) !== 8453 || metadata?.forkedNetwork?.forkBlockHash !== sourceBlock.hash) {
      throw new Error('F1_SOURCE_MISMATCH');
    }
    if ((await call('eth_accounts')).length !== 0) throw new Error('F1_ACCOUNT_FALLBACK');
    for (const account of [owner, setup]) {
      if (await call('eth_getCode', [account.address, 'latest']) !== '0x') throw new Error('F1_ACCOUNT_NOT_CLEAN');
      await call('anvil_setBalance', [account.address, asHex(100n * WETH_UNIT)]);
    }
    await call('anvil_impersonateAccount', [setup.address]);
    const token = tokenCode(), router = routerCode();
    for (const address of [FORK_CONTRACTS.weth, FORK_CONTRACTS.usdc]) await call('anvil_setCode', [address, token]);
    await call('anvil_setCode', [SWAP_ROUTER_02, router]);
    await call('anvil_setStorageAt', [FORK_CONTRACTS.usdc, balanceStorageKey(SYNTHETIC_POOL), `0x${word(1_000_000n * USDC_UNIT)}`]);
    await call('anvil_setStorageAt', [FORK_CONTRACTS.weth, balanceStorageKey(SYNTHETIC_POOL), `0x${word(1_000n * WETH_UNIT)}`]);
    for (const tokenAddress of [FORK_CONTRACTS.weth, FORK_CONTRACTS.usdc]) {
      await call('anvil_setStorageAt', [tokenAddress, allowanceStorageKey(SYNTHETIC_POOL, SWAP_ROUTER_02), `0x${word(2n ** 255n)}`]);
    }
    const result = await exerciseFixture({ call, owner, setup, sourceBlock, runtime });
    const providerFailureFailClosed = await failClosedProxyProbe(ports.proxy + 2, ports.proxy + 3, sourceBlock);
    const secretBoundaryFailClosed = await mockSecretBoundary();
    if (proxy.stopped()) throw new Error('F1_PROXY_STOPPED');
    return { pass: index, pid: process.pid, runtime, sourceBlock: sourceBlock.number, providerEquivalentRequests: proxy.counters.providerEquivalent,
      localReplies: proxy.counters.localReplies, methods: proxy.counters.methods,
      providerFailureFailClosed, secretBoundaryFailClosed, ...result };
  } finally {
    owner.key.fill(0); setup.key.fill(0);
    for (const { child, port } of children.reverse()) await stopProcess(child, port);
    if (proxy) { proxy.server.closeAllConnections(); await new Promise(resolve => proxy.server.close(resolve)); }
    for (const port of Object.values(ports)) await awaitPort(port, 'free');
  }
}
async function executeDirection({ call, owner, sourceBlock, runtime, label, tokenIn, tokenOut,
  amountIn, quotedOut, unknownResult = false }) {
  const beforeBlock = await call('eth_getBlockByNumber', ['latest', false]);
  const nonce = BigInt(await call('eth_getTransactionCount', [owner.address, 'latest']));
  const deadline = BigInt(beforeBlock.timestamp) + 180n;
  const minimumOut = quotedOut * 99n / 100n;
  const feeCap = 2n * BigInt(beforeBlock.baseFeePerGas) + 1_000_000n;
  const pair = buildModeAPair({ owner: owner.address, tokenIn, tokenOut, amountIn,
    amountOutMinimum: minimumOut, fee: 3000, deadline, nonce, approveGasLimit: 200_000n,
    swapGasLimit: 600_000n, maxFeePerGas: feeCap });
  const publicHash = suffix => sha(`${sourceBlock.hash}:f1-${label}:${suffix}`);
  const mockTransport = async request => {
    const approval = decodeUnsignedPayload(request.calls[0]);
    const swap = decodeUnsignedPayload(request.calls[1]);
    return { approval: { status: 'SUCCESS', gasUsed: 160_000n, gasLimit: approval.gasLimit, revertReason: null },
      swap: { status: 'SUCCESS', gasUsed: 480_000n, gasLimit: swap.gasLimit, revertReason: null },
      decodedAmountOut: quotedOut, ownerTransferAmountOut: quotedOut, inputDebited: amountIn,
      allowanceAfterSwap: 0n, residualAllowanceIfSwapFails: amountIn,
      stateOverrides: [], validation: request.validation };
  };
  const scripted = await runScriptedExactSimulation(mockTransport, pair.approveBytes, pair.swapBytes,
    { owner: owner.address, tokenIn, tokenOut, amountIn, amountOutMinimum: minimumOut,
      fee: 3000, deadline, nonce }, quotedOut);
  if (scripted.result.amountOut !== quotedOut || scripted.result.approveGasLimit !== 200_000n
    || scripted.result.swapGasLimit !== 600_000n
    || payloadIdentity(scripted.approveBytes).payloadHash !== payloadIdentity(pair.approveBytes).payloadHash
    || payloadIdentity(scripted.swapBytes).payloadHash !== payloadIdentity(pair.swapBytes).payloadHash) {
    throw new Error('F1_SCRIPTED_SIMULATION_INVALID');
  }
  const context = { nodeId: `swap-${label}`, revision: 1, forkBlock: Number(BigInt(beforeBlock.number)),
    semanticWorkflowHash: publicHash('workflow'), artifactSetHash: publicHash('artifact-set'),
    simulationHash: publicHash('scripted-simulation'), owner: owner.address, tokenIn, tokenOut,
    tokenInDecimals: tokenIn === FORK_CONTRACTS.weth ? 18 : 6,
    tokenOutDecimals: tokenOut === FORK_CONTRACTS.weth ? 18 : 6,
    amountIn, quotedOut, minimumOut, slippageBps: 100, fee: 3000, nonce, deadline,
    approveGasLimit: 200_000n, swapGasLimit: 600_000n, maxFeePerGas: feeCap };
  const { policy, policyHash } = compilePolicy(context);
  const { manifest, manifestHash, executionId } = compileManifest(context, policy, policyHash);
  const { plan, executionPlanHash } = compileExecutionPlan(context, manifestHash, pair.approveBytes, pair.swapBytes);
  const { matrix, enforcementMatrixHash } = compileEnforcementMatrix(context,
    { sourceBlock: { height: Number(BigInt(sourceBlock.number)), hash: sourceBlock.hash },
      stateSourceHash: publicHash('synthetic-state'), simulationRawHash: publicHash('scripted-simulation-raw') },
    { policyHash, manifestHash, executionPlanHash }, pair.approveBytes, pair.swapBytes);
  const findings = reviewModeAPayloads({ context, approveBytes: pair.approveBytes, swapBytes: pair.swapBytes,
    approvePayloadHash: payloadIdentity(pair.approveBytes).payloadHash,
    swapPayloadHash: payloadIdentity(pair.swapBytes).payloadHash, currentForkQuote: true,
    lintBlocks: [], warnings: [], acknowledgedWarnings: [] });
  if (findings.length || manifest.policyHash !== policyHash || plan.manifestHash !== manifestHash
    || matrix.executionPlanHash !== executionPlanHash || matrix.payloads.length !== 2) {
    throw new Error('F1_COMPILED_REVIEW_INVALID');
  }
  const store = attemptStore(join(runtime, `${label}-attempts.jsonl`));
  let coordinator = createAttemptCoordinator(store);
  const receipts = [];
  async function runStep(stepId, bytes, priorStepConfirmed, unknown) {
    const signed = signUnsigned(bytes, owner);
    const preparation = await coordinator.prepare({ executionId, stepId,
      idempotencyKey: `${executionId}-${stepId}-request`, payloadHash: payloadIdentity(bytes).payloadHash,
      preparedAtBlock: Number(BigInt((await call('eth_getBlockByNumber', ['latest', false])).number)),
      priorStepConfirmed });
    if (preparation.kind !== 'PREPARED') throw new Error('F1_ATTEMPT_NOT_NEW');
    const send = async () => {
      const durable = await store.read();
      if (!durable.some(item => item.executionAttemptId === preparation.attempt.executionAttemptId && item.state === 'SUBMITTING')) {
        throw new Error('F1_PRE_REQUEST_JOURNAL_MISSING');
      }
      const broadcastHash = await call('eth_sendRawTransaction', [toHex(signed.raw)]);
      if (broadcastHash !== signed.hash) throw new Error('F1_BROADCAST_HASH_MISMATCH');
      if (unknown) throw new Error('F1_SIMULATED_RESPONSE_LOSS');
      return broadcastHash;
    };
    if (unknown) {
      const response = await coordinator.request(preparation.attempt.executionAttemptId, send)
        .then(() => null, error => error);
      if (response?.message !== 'SUBMISSION_RESULT_UNKNOWN') throw new Error('F1_UNKNOWN_RESULT_NOT_RECORDED');
      await recoverInNewProcess(store.path, preparation.attempt.executionAttemptId, runtime);
      const recoveredStore = attemptStore(store.path, true);
      const recovered = await recoveredStore.read();
      if (recovered.find(item => item.executionAttemptId === preparation.attempt.executionAttemptId)?.state !== 'SUBMISSION_RESULT_UNKNOWN') {
        throw new Error('F1_RESTART_RECOVERY_FAILED');
      }
      coordinator = createAttemptCoordinator(recoveredStore);
      const duplicate = await coordinator.prepare({ executionId, stepId,
        idempotencyKey: `${executionId}-${stepId}-duplicate`, payloadHash: payloadIdentity(bytes).payloadHash,
        preparedAtBlock: Number(BigInt(beforeBlock.number)), priorStepConfirmed }).then(() => null, error => error);
      if (duplicate?.message !== 'ATTEMPT_IN_PROGRESS') throw new Error('F1_DUPLICATE_NOT_BLOCKED');
    } else {
      const pending = await coordinator.request(preparation.attempt.executionAttemptId, send);
      if (pending.state !== 'PENDING' || pending.transactionHash !== signed.hash) throw new Error('F1_PENDING_JOURNAL_INVALID');
    }
    if (await call('eth_getTransactionReceipt', [signed.hash]) !== null) throw new Error('F1_PENDING_RECEIPT_UNEXPECTED');
    const pool = await call('txpool_content');
    if (!pool?.pending) throw new Error('F1_PENDING_TXPOOL_MISSING');
    await pause(220);
    await call('evm_mine');
    const receipt = await waitForReceipt(call, signed.hash, '0x1');
    if (unknown) {
      const mined = await call('eth_getBlockByHash', [receipt.blockHash, true]);
      const exact = mined.transactions.filter(tx => tx.from.toLowerCase() === owner.address && BigInt(tx.nonce) === decodeUnsignedPayload(bytes).nonce);
      if (exact.length !== 1 || exact[0].hash !== signed.hash) throw new Error('F1_UNKNOWN_SCAN_DIVERGENT');
      const { classifyUnknownResult } = await import('../../../../packages/reference-executor/dist/recovery.js');
      const decision = classifyUnknownResult({ payloadNonce: decodeUnsignedPayload(bytes).nonce,
        latestNonce: BigInt(await call('eth_getTransactionCount', [owner.address, 'latest'])),
        scannedBlocks: 1, scanComplete: true, matchingNonceTransactions: [{ hash: signed.hash, exactPayload: true, confirmed: true }],
        txpoolChecked: true, txpoolContainsNonce: false, waitedMs: 220, observedBlocks: 1,
        receiptLookup: { status: 1 }, transactionLookup: { hash: signed.hash }, deadlineNear: false });
      if (decision.outcome !== 'CONFIRMED' || decision.retryAllowed) throw new Error('F1_UNKNOWN_RECOVERY_INVALID');
    }
    await persistTransition(store, preparation.attempt.executionAttemptId, 'CONFIRMED', signed.hash);
    receipts.push(receipt);
    return { signed, receipt };
  }
  const approval = await runStep('step-approve', pair.approveBytes, false, false);
  const swap = await runStep('step-swap', pair.swapBytes, true, unknownResult);
  const afterBlock = await call('eth_getBlockByHash', [swap.receipt.blockHash, false]);
  if (!afterBlock || afterBlock.hash !== swap.receipt.blockHash) throw new Error('F1_AFTER_BLOCK_INVALID');
  const reconciliation = await independentReconciliation(call, {
    owner: owner.address, tokenIn, tokenOut, amountIn, minimumOut, quotedOut, fee: 3000, deadline, nonce,
    reviewedApprove: pair.approveBytes, reviewedSwap: pair.swapBytes,
    approveHash: approval.signed.hash, swapHash: swap.signed.hash,
  }, { before: beforeBlock.hash, afterApproval: approval.receipt.blockHash, after: swap.receipt.blockHash });
  if (reconciliation.outcome !== 'RECONCILED' || reconciliation.code !== 'EXACT') {
    throw new Error(`F1_RECONCILIATION_${reconciliation.outcome}:${reconciliation.code}`);
  }
  const journal = makeJournalFromSnapshots(store.path, executionId, executionPlanHash, manifestHash);
  const journalHeadHash = hashJournalBytes(new TextEncoder().encode(JSON.stringify(journal))).at(-1);
  if (!journalHeadHash || journal.entries.length < 6) throw new Error('F1_JOURNAL_ARTIFACT_INVALID');
  const evidence = buildEvidenceBundle({ evidenceBundleId: `evidence-${executionId}`, version: 1, supersedes: null,
    semanticWorkflowHash: context.semanticWorkflowHash, artifactSetHash: context.artifactSetHash,
    simulationHash: context.simulationHash, policyHash, manifestHash, executionPlanHash,
    journalHeadHash, observedAt: new Date().toISOString(), outcome: 'RECONCILED',
    receipts: [approval.receipt, swap.receipt].map(receipt => ({ transactionHash: receipt.transactionHash,
      exactRawResponse: new TextEncoder().encode(JSON.stringify(receipt)) })),
    matrixHash: enforcementMatrixHash,
    signedRawDigests: [approval.signed.raw, swap.signed.raw].map(raw => hashRawBytes('raw-response', raw)),
    reconciliationTranscript: new TextEncoder().encode(JSON.stringify({ outcome: reconciliation.outcome,
      code: reconciliation.code, observedOut: String(reconciliation.observedOut) })),
    forkTranscriptHash: publicHash('synthetic-source'), differences: [],
    reconciliation: { balances: [], allowances: [], debt: [], positions: [], fees: [], residualAssets: [],
      ownership: [{ chainId: 'eip155:31337', address: owner.address }],
      limitations: ['FORK_REPRODUCED_NOT_MAINNET'] },
  });
  if (evidence.bundle.environment !== 'FORK_REPRODUCED' || !evidence.evidenceBundleHash) throw new Error('F1_EVIDENCE_SCHEMA_INVALID');
  // The builder's frozen schema uses FORK_REPRODUCED. This synthetic exercise is MOCKED and the bundle is not delivered as fork evidence.
  return { direction: label, unknownResult, approvalHash: approval.signed.hash, swapHash: swap.signed.hash,
    reconciliation: reconciliation.outcome, journalEntries: journal.entries.length,
    compiledArtifactsValidatedMocked: true, scriptedSimulationValidatedMocked: true,
    evidenceSchemaValidatedMocked: true };
}

async function exerciseRevertAndRevocation({ call, owner, runtime }) {
  const head = await call('eth_getBlockByNumber', ['latest', false]);
  const context = { owner: owner.address, tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc,
    amountIn: WETH_UNIT, amountOutMinimum: PRICE * USDC_UNIT + 1n, fee: 3000,
    deadline: BigInt(head.timestamp) + 180n, nonce: BigInt(await call('eth_getTransactionCount', [owner.address, 'latest'])),
    maxFeePerGas: 2n * BigInt(head.baseFeePerGas) + 1_000_000n, swapGasLimit: 600_000n };
  const readAllowance = async () => BigInt(await call('eth_call', [{ to: FORK_CONTRACTS.weth,
    data: `0xdd62ed3e${addressWord(owner.address)}${addressWord(SWAP_ROUTER_02)}` }, 'latest']));
  async function sendCase({ bytes, executionId, stepId, priorStepConfirmed, status }) {
    const store = attemptStore(join(runtime, `${executionId}-${stepId}.jsonl`));
    const coordinator = createAttemptCoordinator(store);
    const signed = signUnsigned(bytes, owner);
    const prepared = await coordinator.prepare({ executionId, stepId, idempotencyKey: `${executionId}-${stepId}-once`,
      payloadHash: payloadIdentity(bytes).payloadHash,
      preparedAtBlock: Number(BigInt((await call('eth_getBlockByNumber', ['latest', false])).number)),
      priorStepConfirmed });
    const pending = await coordinator.request(prepared.attempt.executionAttemptId, async () => {
      const durable = await store.read();
      if (durable.find(item => item.executionAttemptId === prepared.attempt.executionAttemptId)?.state !== 'SUBMITTING') {
        throw new Error('F1_NEGATIVE_PRE_REQUEST_JOURNAL_MISSING');
      }
      return call('eth_sendRawTransaction', [toHex(signed.raw)]);
    });
    if (pending.state !== 'PENDING' || pending.transactionHash !== signed.hash
      || await call('eth_getTransactionReceipt', [signed.hash]) !== null) throw new Error('F1_NEGATIVE_PENDING_INVALID');
    await pause(100);
    await call('evm_mine');
    const receipt = await waitForReceipt(call, signed.hash, status);
    await persistTransition(store, prepared.attempt.executionAttemptId, status === '0x1' ? 'CONFIRMED' : 'REVERTED', signed.hash);
    return { signed, receipt };
  }
  const failedApprovalPair = buildModeAPair({ ...context, amountOutMinimum: PRICE * USDC_UNIT * 99n / 100n,
    approveGasLimit: 25_000n });
  const failedApproval = await sendCase({ bytes: failedApprovalPair.approveBytes,
    executionId: 'f1-reverted-approval', stepId: 'step-approve', priorStepConfirmed: false, status: '0x0' });
  if (await readAllowance() !== 0n) throw new Error('F1_REVERTED_APPROVAL_CHANGED_ALLOWANCE');
  const before = await call('eth_getBlockByHash', [failedApproval.receipt.blockHash, true]);
  if (before.transactions.some(tx => tx.to?.toLowerCase() === SWAP_ROUTER_02)) throw new Error('F1_SWAP_AFTER_REVERTED_APPROVAL');
  const afterFailure = await call('evm_snapshot');
  if (await call('evm_revert', [afterFailure]) !== true) throw new Error('F1_REVERTED_APPROVAL_RESET_FAILED');
  // A separate authorization uses the next nonce after the reverted approval.
  const current = await call('eth_getBlockByNumber', ['latest', false]);
  const pair = buildModeAPair({ ...context, nonce: BigInt(await call('eth_getTransactionCount', [owner.address, 'latest'])),
    deadline: BigInt(current.timestamp) + 180n, maxFeePerGas: 2n * BigInt(current.baseFeePerGas) + 1_000_000n,
    approveGasLimit: 200_000n });
  const approval = await sendCase({ bytes: pair.approveBytes, executionId: 'f1-reverted-swap',
    stepId: 'step-approve', priorStepConfirmed: false, status: '0x1' });
  if (await readAllowance() !== WETH_UNIT) throw new Error('F1_PARTIAL_STATE_NOT_VISIBLE');
  const failedSwap = await sendCase({ bytes: pair.swapBytes, executionId: 'f1-reverted-swap',
    stepId: 'step-swap', priorStepConfirmed: true, status: '0x0' });
  if (await readAllowance() !== WETH_UNIT) throw new Error('F1_RESIDUAL_ALLOWANCE_MISSING');
  const outcome = await independentReconciliation(call, {
    owner: owner.address, tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc,
    amountIn: WETH_UNIT, minimumOut: context.amountOutMinimum, quotedOut: PRICE * USDC_UNIT,
    fee: 3000, deadline: BigInt(current.timestamp) + 180n,
    nonce: decodeUnsignedPayload(pair.approveBytes).nonce,
    reviewedApprove: pair.approveBytes, reviewedSwap: pair.swapBytes,
    approveHash: approval.signed.hash, swapHash: failedSwap.signed.hash,
  }, { before: failedApproval.receipt.blockHash, afterApproval: approval.receipt.blockHash, after: failedSwap.receipt.blockHash });
  if (outcome.outcome !== 'DIVERGENT' || outcome.code !== 'TRANSACTION_REVERTED') {
    throw new Error(`F1_REVERT_RECONCILIATION_INVALID:${outcome.code}`);
  }
  const revokeHead = await call('eth_getBlockByNumber', ['latest', false]);
  const revokeBytes = encodeUnsignedPayload({ chainId: 31337,
    nonce: BigInt(await call('eth_getTransactionCount', [owner.address, 'latest'])),
    maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: 2n * BigInt(revokeHead.baseFeePerGas) + 1_000_000n,
    gasLimit: 200_000n, to: FORK_CONTRACTS.weth, value: 0n,
    data: encodeApprove(SWAP_ROUTER_02, 0n), accessList: [] });
  const revocation = await sendCase({ bytes: revokeBytes, executionId: 'f1-separate-revocation',
    stepId: 'step-revoke', priorStepConfirmed: false, status: '0x1' });
  if (await readAllowance() !== 0n || revocation.receipt.blockHash === failedSwap.receipt.blockHash) {
    throw new Error('F1_REVOCATION_NOT_SEPARATE');
  }
  const expiredHead = await call('eth_getBlockByNumber', ['latest', false]);
  const expiredSwap = encodeSwap({ tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc,
    fee: 3000, recipient: owner.address, amountIn: WETH_UNIT, amountOutMinimum: PRICE * USDC_UNIT * 99n / 100n,
    sqrtPriceLimitX96: 0n, deadline: BigInt(expiredHead.timestamp) - 1n });
  const expiredError = await call('eth_call', [{ from: owner.address, to: SWAP_ROUTER_02,
    data: toHex(expiredSwap) }, 'latest']).then(() => null, error => error);
  if (!expiredError) throw new Error('F1_EXPIRED_DEADLINE_ACCEPTED');
  return { revertedApproval: failedApproval.receipt.status, revertedSwap: failedSwap.receipt.status,
    residualAllowanceDetected: true, separateRevocation: revocation.receipt.status,
    revertedReconciliation: outcome.code, expiredDeadlineRejected: true };
}

async function exerciseFixture({ call, owner, setup, sourceBlock, runtime }) {
  const count = { nullReceipts: 0, setupTransactions: 0 };
  const counted = async (method, params = []) => {
    const result = await call(method, params);
    if (method === 'eth_getTransactionReceipt' && result === null) count.nullReceipts++;
    return result;
  };
  await call('anvil_setAutomine', [false]);
  await call('anvil_setBlockTimestampInterval', [2]);
  const delayed = () => { setTimeout(() => { void call('evm_mine').catch(() => undefined); }, 220); };
  const send = async (purpose, from, to, data, value = 0n) => {
    const result = await sendSetupTransaction(from, to, data, value, { call: counted, onSubmitted: delayed });
    count.setupTransactions++;
    return { purpose, ...result };
  };
  const setupTransactions = [];
  setupTransactions.push(await send('WETH_DEPOSIT', setup.address, FORK_CONTRACTS.weth, '0xd0e30db0', 6n * WETH_UNIT));
  setupTransactions.push(await send('WETH_OWNER_TRANSFER', setup.address, FORK_CONTRACTS.weth,
    `0xa9059cbb${addressWord(owner.address)}${word(WETH_UNIT)}`));
  setupTransactions.push(await send('WETH_SETUP_APPROVAL', setup.address, FORK_CONTRACTS.weth,
    toHex(encodeApprove(SWAP_ROUTER_02, 5n * WETH_UNIT))));
  const head = await call('eth_getBlockByNumber', ['latest', false]);
  setupTransactions.push(await send('USDC_SETUP_SWAP', setup.address, SWAP_ROUTER_02,
    toHex(encodeSwap({ tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, fee: 3000,
      recipient: setup.address, amountIn: 5n * WETH_UNIT, amountOutMinimum: 12_375n * USDC_UNIT,
      sqrtPriceLimitX96: 0n, deadline: BigInt(head.timestamp) + 180n }))));
  setupTransactions.push(await send('USDC_OWNER_TRANSFER', setup.address, FORK_CONTRACTS.usdc,
    `0xa9059cbb${addressWord(owner.address)}${word(2500n * USDC_UNIT)}`));
  if (count.nullReceipts < 5) throw new Error('F1_DELAYED_RECEIPT_NOT_EXERCISED');
  for (let i = 1; i < setupTransactions.length; i++) {
    if (BigInt(setupTransactions[i].nonce) !== BigInt(setupTransactions[i - 1].nonce) + 1n
      || BigInt(setupTransactions[i].blockNumber) <= BigInt(setupTransactions[i - 1].blockNumber)) {
      throw new Error('F1_SETUP_ORDER_MISMATCH');
    }
  }
  const readBalance = async (token, account, block = 'latest') => BigInt(await call('eth_call',
    [{ to: token, data: `0x70a08231${addressWord(account)}` }, block]));
  const readAllowance = async (token, account, spender, block = 'latest') => BigInt(await call('eth_call',
    [{ to: token, data: `0xdd62ed3e${addressWord(account)}${addressWord(spender)}` }, block]));
  if (await readBalance(FORK_CONTRACTS.weth, owner.address) !== WETH_UNIT
    || await readBalance(FORK_CONTRACTS.usdc, owner.address) !== 2500n * USDC_UNIT
    || await readAllowance(FORK_CONTRACTS.weth, setup.address, SWAP_ROUTER_02) !== 0n
    || await readAllowance(FORK_CONTRACTS.weth, owner.address, SWAP_ROUTER_02) !== 0n) {
    throw new Error('F1_SETUP_STATE_INVALID');
  }
  for (let i = 0; i < 20; i++) await call('evm_mine');
  const baseline = await call('evm_snapshot');
  const wethToUsdc = await executeDirection({ call, owner, sourceBlock, runtime,
    label: 'weth-to-usdc', tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc,
    amountIn: WETH_UNIT, quotedOut: PRICE * USDC_UNIT });
  if (await call('evm_revert', [baseline]) !== true) throw new Error('F1_SNAPSHOT_RESTORE_FAILED');
  const restored = await call('evm_snapshot');
  const usdcToWeth = await executeDirection({ call, owner, sourceBlock, runtime,
    label: 'usdc-to-weth', tokenIn: FORK_CONTRACTS.usdc, tokenOut: FORK_CONTRACTS.weth,
    amountIn: PRICE * USDC_UNIT, quotedOut: WETH_UNIT, unknownResult: true });
  if (await call('evm_revert', [restored]) !== true) throw new Error('F1_SNAPSHOT_RESTORE_FAILED');
  const reverted = await exerciseRevertAndRevocation({ call, owner, runtime });
  return { sourceHash: sourceBlock.hash, setupTransactions: count.setupTransactions,
    delayedNullReceipts: count.nullReceipts, setupLastBlock: setupTransactions.at(-1).blockNumber,
    directions: [wethToUsdc, usdcToWeth], reverted };
}

/**
 * CI browser environment (MOCKED): a deterministic synthetic chain-8453 source with the Base-like set,
 * a chain-31337 fork using Anvil's own default accounts (no key or phrase literal exists here), the
 * standard inclusion-aware funding, a baseline snapshot and a MOCKED profile. Loopback only.
 */
export const E2E_PORTS = Object.freeze({ fork: 8545, source: 8546, health: 8547 });
export async function serveSyntheticFork(runtime, binary, ports = E2E_PORTS) {
  const { rmSync, mkdirSync: makeDir } = await import('node:fs');
  const { transcriptIdentity } = await import('./harness.mjs');
  validateAnvilBinary(binary);
  for (const port of [ports.fork, ports.source]) if (await probePort(port) !== 'free') throw new Error(`E2E_PORT_OCCUPIED:${port}`);
  rmSync(runtime, { recursive: true, force: true });
  makeDir(join(runtime, 'journal'), { recursive: true, mode: 0o700 });
  const children = [];
  const stop = async () => { for (const { child, port } of children.reverse()) await stopProcess(child, port).catch(() => undefined); };
  try {
    const source = spawnAnvil(binary, ['--host', '127.0.0.1', '--port', String(ports.source), '--chain-id', '8453', '--accounts', '0',
      '--timestamp', '1790000000', '--disable-default-create2-deployer'], runtime);
    children.push({ child: source, port: ports.source });
    await awaitPort(ports.source);
    const sourceCall = localCaller(ports.source);
    await sourceCall('anvil_setBlockTimestampInterval', [12]);
    const syntheticCodePins = await installSyntheticBase(sourceCall);
    for (let i = 0; i < 3; i++) await sourceCall('evm_mine');
    const sourceBlock = await sourceCall('eth_getBlockByNumber', ['latest', false]);
    const fork = spawnAnvil(binary, [...forkAnvilArgs({ port: ports.fork, forkUrl: `http://127.0.0.1:${ports.source}`,
      forkBlockNumber: Number(BigInt(sourceBlock.number)), timeoutMs: 20_000 })], runtime);
    children.push({ child: fork, port: ports.fork });
    await awaitPort(ports.fork);
    const call = localCaller(ports.fork);
    if (await call('eth_chainId') !== FORK_CHAIN_ID_HEX) throw new Error('E2E_FORK_CHAIN_INVALID');
    const accounts = (await call('eth_accounts')).map(account => account.toLowerCase());
    const [owner, setup] = accounts;
    await call('anvil_setBlockTimestampInterval', [2]);
    const send = (to, data, value = 0n) => sendSetupTransaction(setup, to, data, value, { call });
    await send(FORK_CONTRACTS.weth, '0xd0e30db0', 6n * WETH_UNIT);
    await send(FORK_CONTRACTS.weth, `0xa9059cbb${addressWord(owner)}${word(WETH_UNIT)}`);
    await send(FORK_CONTRACTS.weth, toHex(encodeApprove(SWAP_ROUTER_02, 5n * WETH_UNIT)));
    const head = await call('eth_getBlockByNumber', ['latest', false]);
    await send(SWAP_ROUTER_02, toHex(encodeSwap({ tokenIn: FORK_CONTRACTS.weth, tokenOut: FORK_CONTRACTS.usdc, fee: SYNTHETIC_FEE,
      recipient: setup, amountIn: 5n * WETH_UNIT, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n, deadline: BigInt(head.timestamp) + 180n })));
    await send(FORK_CONTRACTS.usdc, `0xa9059cbb${addressWord(owner)}${word(2500n * USDC_UNIT)}`);
    for (let i = 0; i < 20; i++) await call('evm_mine');
    const baseline = await call('evm_snapshot');
    const sourceBlockNumber = Number(BigInt(sourceBlock.number));
    const { identityHash } = transcriptIdentity({ sourceBlockNumber, sourceBlockHash: sourceBlock.hash, accounts });
    const profile = { format: 'gryloo.mode-a-fork-profile.v1', environment: 'MOCKED', rpcUrl: `http://127.0.0.1:${ports.fork}`,
      sourceChainId: 8453, sourceBlockNumber, sourceBlockHash: sourceBlock.hash, stateSourceHash: identityHash, owner, syntheticCodePins };
    writeFileSync(join(runtime, 'profile.json'), `${JSON.stringify(profile)}\n`, { mode: 0o600 });
    writeFileSync(join(runtime, 'fixture.json'), `${JSON.stringify({ format: 'gryloo.mode-a-e2e-fixture.v1', environment: 'MOCKED',
      rpcUrl: profile.rpcUrl, owner, setup, baseline, journal: join(runtime, 'journal') })}\n`, { mode: 0o600 });
    return { children, stop };
  } catch (error) { await stop(); throw error; }
}
/** Loopback readiness endpoint for the browser test runner; it carries no chain data. */
export async function serveHealth(port = E2E_PORTS.health) {
  const server = createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/plain' }); response.end('ready'); });
  await new Promise((resolvePromise, rejectPromise) => { server.once('error', rejectPromise); server.listen(port, '127.0.0.1', resolvePromise); });
  return server;
}
export function holdUntilSignal(stop) {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { void stop().finally(() => process.exit(0)); });
}

async function main() {
  if (process.argv[2] === '--serve-synthetic') {
    const runtime = process.env.GRYLOO_MODE_A_RUNTIME;
    if (!runtime || !runtime.startsWith('/') || process.argv.length !== 3) throw new Error('E2E_RUNTIME_REQUIRED');
    const binary = process.env.GRYLOO_ANVIL_BIN ?? (() => { throw new Error('F1_PINNED_ANVIL_REQUIRED'); })();
    const served = await serveSyntheticFork(runtime, binary);
    const health = await serveHealth();
    holdUntilSignal(async () => { health.close(); await served.stop(); });
    process.stdout.write('MODE_A_SYNTHETIC_FORK_READY\n');
    return;
  }
  if (process.argv[2] === '--recover') {
    if (process.argv.length !== 5) throw new Error('F1_RECOVERY_ARGUMENT_INVALID');
    const attempts = await attemptStore(process.argv[3], true).read();
    const state = attempts.find(item => item.executionAttemptId === process.argv[4])?.state ?? null;
    process.stdout.write(`${JSON.stringify({ pid: process.pid, state })}\n`);
    return;
  }
  const binary = process.env.GRYLOO_ANVIL_BIN;
  if (!binary) throw new Error('F1_PINNED_ANVIL_REQUIRED');
  if (process.argv[2] === '--pass') {
    const index = Number(process.argv[3]);
    if (!Number.isSafeInteger(index) || index < 1 || index > 5 || !process.argv[4]) throw new Error('F1_PASS_ARGUMENT_INVALID');
    const result = await runPass(index, process.argv[4], binary);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (process.argv.length !== 2) throw new Error('F1_ARGUMENT_INVALID');
  const root = mkdtempSync(join(tmpdir(), 'gryloo-build003f-f1-'));
  const results = [];
  for (let pass = 1; pass <= 5; pass++) {
    const runtime = join(root, `pass-${pass}`);
    mkdirSync(runtime, { mode: 0o700 });
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--pass', String(pass), runtime],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { HOME: runtime, PATH: '/usr/bin:/bin', GRYLOO_ANVIL_BIN: binary } });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-2000); });
    const code = await new Promise(resolve => child.once('close', resolve));
    if (code !== 0) throw new Error(`F1_PASS_${pass}_FAILED:${stderr.replace(/[^A-Z0-9:_\-\n]/gi, '')}`);
    const result = JSON.parse(stdout.trim());
    results.push(result);
    writeFileSync(join(runtime, 'result.json'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', root, passes: results })}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error?.message ?? 'F1_FAILED'}\n`); process.exitCode = 1; });
}

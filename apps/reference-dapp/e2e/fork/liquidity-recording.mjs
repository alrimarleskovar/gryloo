// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-006 owner recording: preflight, one owner-run read-only Base session, closed replay. */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, openSync, closeSync, fsyncSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, buildTranscript, RECORDING_POLICY, validateBilling } from './recording-proxy.mjs';
import { discoverLiquidityPins, runLiquidityLifecycle } from './liquidity-harness.mjs';
import { deriveForkPublicAddresses, forkDevAccounts, probePort, rpc, startFork, startReplayUpstream, stopFork, stopReplayUpstream,
  transcriptIdentity, verifyOwnerForkAccountSource, validateAnvilBinary } from './harness.mjs';
import { FORK_ACCOUNT_DERIVATION_PATH } from '../../../../packages/reference-compiler/dist/profile.js';
import { encodeLiquidityCall, toHex, LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '../../../../packages/reference-compiler/dist/index.js';
import { prepareForkFixture } from './fork-setup.mjs';
import { verifyLiquidityTranscript } from './liquidity-replay-upstream.mjs';
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const ROOT = '/home/asus/.gryloo/build-006';
const ACCOUNTS = join(ROOT, 'accounts');
const TRANSCRIPT = join(REPO, 'apps/reference-dapp/e2e/fork/liquidity-transcript.json');
const PROXY = fileURLToPath(new URL('./recording-proxy.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const compilerRequire = createRequire(new URL('../../../../packages/reference-compiler/package.json', import.meta.url));
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
function removeCredential(path) {
  try {
    const size = statSync(path).size;
    const fd = openSync(path, 'r+');
    try { writeFileSync(fd, Buffer.alloc(size)); fsyncSync(fd); } finally { closeSync(fd); }
    unlinkSync(path);
  } catch (cause) { if (cause?.code !== 'ENOENT') throw cause; }
}
function writePrivate(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
function useAccounts() {
  process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = join(ACCOUNTS, 'disposable-phrase');
  process.env.GRYLOO_F2_PUBLIC_PIN_FILE = join(ACCOUNTS, 'public-pins.json');
}
function listDist() {
  const result = [];
  for (const name of ['reference-compiler', 'reference-executor', 'reference-reconciler', 'workflow-contracts', 'action-registry', 'reference-linter']) {
    const dir = join(REPO, 'packages', name, 'dist');
    for (const file of readdirSync(dir).filter(item => item.endsWith('.js')).sort()) result.push(`packages/${name}/dist/${file}`);
  }
  return result;
}
const PINNED = [
  'apps/reference-dapp/e2e/fork/liquidity-recording.mjs', 'apps/reference-dapp/e2e/fork/liquidity-harness.mjs',
  'apps/reference-dapp/e2e/fork/liquidity-replay-upstream.mjs', 'apps/reference-dapp/e2e/fork/recording-proxy.mjs',
  'apps/reference-dapp/e2e/fork/replay-upstream.mjs', 'apps/reference-dapp/e2e/fork/harness.mjs',
  'apps/reference-dapp/e2e/fork/fork-setup.mjs', 'apps/reference-dapp/src/server/liquidity-service.ts',
  'apps/reference-dapp/src/domain/liquidity-authoring.ts', 'packages/reference-compiler/src/liquidity.ts',
  'packages/reference-reconciler/src/liquidity.ts', 'packages/reference-executor/src/liquidity.ts', 'pnpm-lock.yaml',
];
function git(...args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; });
    child.once('close', code => code === 0 ? resolvePromise(output.trim()) : rejectPromise(new Error('GIT_FAILED')));
  });
}
async function manifestBody(notBeforeMs) {
  const binary = process.env.GRYLOO_ANVIL_BIN ?? fail('ANVIL_REQUIRED');
  validateAnvilBinary(binary);
  const files = Object.fromEntries([...PINNED, ...listDist()].map(path => [path, hash(readFileSync(join(REPO, path)))]));
  return { format: 'gryloo.build-006-owner-recording-manifest.v1', head: await git('rev-parse', 'HEAD'),
    branch: await git('rev-parse', '--abbrev-ref', 'HEAD'), files, node: { path: process.execPath, sha256: hash(readFileSync(process.execPath)) },
    anvil: { path: binary, sha256: hash(readFileSync(binary)) }, accounts: { publicPins: join(ACCOUNTS, 'public-pins.json'),
      publicPinsSha256: hash(readFileSync(join(ACCOUNTS, 'public-pins.json'))) }, policy: RECORDING_POLICY,
    billingPath: join(ROOT, 'billing.json'), transcriptPath: TRANSCRIPT, notBeforeMs };
}
/** Generate new disposable account material locally. The phrase never enters output or Git. */
async function prepareAccounts() {
  if (existsSync(ACCOUNTS) || existsSync(join(ROOT, 'session')) || existsSync(TRANSCRIPT)) fail('ACCOUNTS_ALREADY_PREPARED');
  const binary = process.env.GRYLOO_ANVIL_BIN ?? fail('ANVIL_REQUIRED');
  validateAnvilBinary(binary);
  if ((await probePort(18601)) !== 'free') fail('ACCOUNT_GENERATOR_PORT_OCCUPIED');
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  mkdirSync(ACCOUNTS, { mode: 0o700 });
  const scratch = mkdtempSync(join(tmpdir(), 'gryloo-build-006-accounts-'));
  let child = null;
  try {
    const phrase = await new Promise((resolvePromise, rejectPromise) => {
      child = spawn(binary, ['--host', '127.0.0.1', '--port', '18601', '--chain-id', '31337', '--accounts', '10',
        '--mnemonic-random', '12', '--color', 'never'], { stdio: ['ignore', 'pipe', 'pipe'], env: { HOME: scratch, PATH: '/usr/bin:/bin' } });
      let output = '', settled = false;
      const reject = code => { if (!settled) { settled = true; rejectPromise(new Error(code)); } };
      const timer = setTimeout(() => reject('ACCOUNT_GENERATOR_TIMEOUT'), 20_000);
      const collect = chunk => {
        if (settled) return;
        output += chunk.toString('utf8');
        if (output.length > 65536) { clearTimeout(timer); reject('ACCOUNT_GENERATOR_OUTPUT_INVALID'); return; }
        const found = /^Mnemonic:[ \t]+([a-z]+(?: [a-z]+){11})[ \t]*\r?$/m.exec(output);
        if (found && output.includes('Listening on')) {
          settled = true; clearTimeout(timer); resolvePromise(found[1]);
        }
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('close', () => { clearTimeout(timer); reject('ACCOUNT_GENERATOR_EXITED'); });
    });
    const addresses = await deriveForkPublicAddresses(phrase);
    writePrivate(join(ACCOUNTS, 'disposable-phrase'), `${phrase}\n`);
    writePrivate(join(ACCOUNTS, 'public-pins.json'), `${canonical({ format: 'gryloo.build-003f.f2-public-pins.v1',
      derivationPath: FORK_ACCOUNT_DERIVATION_PATH, addresses })}\n`);
    useAccounts(); await verifyOwnerForkAccountSource();
    process.stdout.write(`${JSON.stringify({ status: 'ACCOUNTS_PREPARED', publicPinsSha256: hash(readFileSync(join(ACCOUNTS, 'public-pins.json'))),
      count: addresses.length, privateDirectory: ACCOUNTS })}\n`);
  } catch (cause) {
    rmSync(ACCOUNTS, { recursive: true, force: true });
    throw cause;
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    rmSync(scratch, { recursive: true, force: true });
  }
}
function runChild(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GRYLOO_ALCHEMY_KEY_FILE: '', GRYLOO_ANVIL_BIN: process.env.GRYLOO_ANVIL_BIN } });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-4000); });
    child.stderr.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-4000); });
    child.once('close', code => code === 0 ? resolvePromise() : rejectPromise(new Error(`DRY_RUN_CHILD_FAILED:${code}`)));
  });
}
/**
 * Offline dry-run inputs: the published Uniswap v3 npm artifacts, unpacked by the operator outside Git
 * (`<dir>/v3-core` = @uniswap/v3-core 1.0.1, `<dir>/v3-periphery` = @uniswap/v3-periphery 1.4.4). They are
 * used only on a synthetic loopback chain-8453 source; the digests pin the reviewed creation bytecode.
 */
const UNISWAP_V3_ARTIFACTS = Object.freeze({
  factory: ['v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json', '62013628a11b8fa975d023551100c633363a6380a820476e86f6ceb1aeb08b1e'],
  manager: ['v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json', 'f803985e92b60a4a49c6cf0628a10ef8105bc812ff98cf13aa5af4a133a72052'],
});
const SYNTHETIC_LIQUIDITY_PROVIDER = '0x00000000000000000000000000000000000b0006';
function isqrt(value) {
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) { const y = (x + value / x) >> 1n; if (y >= x) return x; x = y; }
}
/** MOCKED source only: real v3 factory, pool and position manager code at the pinned Base addresses. */
async function installSyntheticUniswap(call, packages) {
  const { keccak_256 } = await import(compilerRequire.resolve('@noble/hashes/sha3.js'));
  const creation = ([path, digest]) => {
    const bytecode = JSON.parse(readFileSync(join(packages, path), 'utf8')).bytecode;
    if (typeof bytecode !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(bytecode) || hash(Buffer.from(bytecode.slice(2), 'hex')) !== digest)
      fail('UNISWAP_ARTIFACT_PIN_MISMATCH');
    return bytecode;
  };
  const provider = SYNTHETIC_LIQUIDITY_PROVIDER;
  const send = async (to, data, value = 0n) => {
    const transaction = await call('eth_sendTransaction', [{ from: provider, ...(to ? { to } : {}), data, value: `0x${value.toString(16)}`, gas: '0x1c9c380' }]);
    let receipt = null;
    for (let i = 0; i < 200 && receipt === null; i++) {
      receipt = await call('eth_getTransactionReceipt', [transaction]);
      if (receipt === null) await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    }
    if (receipt?.status !== '0x1') fail(`SYNTHETIC_UNISWAP_SETUP_FAILED:${to ? data.slice(0, 10) : 'create'}`);
    return receipt;
  };
  const relocate = async (deployed, target, patchSelf) => {
    const code = await call('eth_getCode', [deployed, 'latest']);
    const self = deployed.slice(2);
    if (patchSelf !== code.includes(self)) fail('SYNTHETIC_UNISWAP_RELOCATION_INVALID');
    await call('anvil_setCode', [target, patchSelf ? code.split(self).join(target.slice(2)) : code]);
    for (let slot = 0; slot < 32; slot++) {
      const value = await call('eth_getStorageAt', [deployed, `0x${slot.toString(16)}`, 'latest']);
      if (BigInt(value) !== 0n) await call('anvil_setStorageAt', [target, `0x${word(slot)}`, `0x${word(value)}`]);
    }
  };
  await call('anvil_impersonateAccount', [provider]);
  await call('anvil_setBalance', [provider, `0x${(10n ** 24n).toString(16)}`]);
  // NoDelegateCall binds the factory's own address as an immutable, so relocation patches exactly that value.
  const factory = (await send(null, creation(UNISWAP_V3_ARTIFACTS.factory))).contractAddress.toLowerCase();
  await relocate(factory, LIQUIDITY_FACTORY, true);
  // Constructor fee tiers live in a mapping the fixed-slot copy does not reach; the copied owner re-enables 500/10.
  await send(LIQUIDITY_FACTORY, `0x8a7c195f${word(500)}${word(10)}`);
  const tier = await call('eth_call', [{ to: LIQUIDITY_FACTORY, data: `0x22afcccb${word(500)}` }, 'latest']);
  if (BigInt(tier) !== 10n) fail('SYNTHETIC_UNISWAP_FEE_TIER_MISSING');
  await send(LIQUIDITY_FACTORY, `0xa1671295${addressWord(LIQUIDITY_WETH)}${addressWord(LIQUIDITY_USDC)}${word(500)}`);
  const pool = `0x${(await call('eth_call', [{ to: LIQUIDITY_FACTORY,
    data: `0x1698ee82${addressWord(LIQUIDITY_WETH)}${addressWord(LIQUIDITY_USDC)}${word(500)}` }, 'latest'])).slice(-40)}`;
  // 2,500 USDC per WETH, matching the synthetic setup router reserves.
  await send(pool, `0xf637731d${word(isqrt(2500n * 10n ** 6n * (1n << 192n) / 10n ** 18n))}`);
  const manager = (await send(null, `${creation(UNISWAP_V3_ARTIFACTS.manager)}${addressWord(LIQUIDITY_FACTORY)}${addressWord(LIQUIDITY_WETH)}${addressWord(provider)}`))
    .contractAddress.toLowerCase();
  await relocate(manager, POSITION_MANAGER, false);
  // A separate full-range provider makes the pool active before the recorded lifecycle begins.
  await send(LIQUIDITY_WETH, '0xd0e30db0', 200n * 10n ** 18n);
  const usdcBalanceSlot = `0x${Buffer.from(keccak_256(Buffer.from(`${addressWord(provider)}${word(0)}`, 'hex'))).toString('hex')}`;
  await call('anvil_setStorageAt', [LIQUIDITY_USDC, usdcBalanceSlot, `0x${word(10n ** 12n)}`]);
  for (const token of [LIQUIDITY_WETH, LIQUIDITY_USDC]) await send(token, `0x095ea7b3${addressWord(POSITION_MANAGER)}${word((1n << 255n))}`);
  const seed = encodeLiquidityCall({ kind: 'MINT', token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500, tickLower: -887270, tickUpper: 887270,
    amount0Desired: 100n * 10n ** 18n, amount1Desired: 250_000n * 10n ** 6n, amount0Min: 0n, amount1Min: 0n, recipient: provider, deadline: 4_000_000_000n });
  await send(seed.to, toHex(seed.data));
  await call('anvil_stopImpersonatingAccount', [provider]);
  return { pool };
}
function syntheticBilling(path, note) {
  writePrivate(path, `${canonical({ format: 'gryloo.build-003f-provider-billing.v1', provider: 'Alchemy', plan: 'Free',
    network: 'Base Mainnet', paymentMethod: false, paidAddOn: false, overage: false, autoUpgrade: false,
    credentialRotated: true, previousCredentialDeleted: true, rotatedOn: new Date().toISOString().slice(0, 10),
    reportedOn: new Date().toISOString().slice(0, 10), remainingMonthlyCu: RECORDING_POLICY.maxReservedCu, note })}\n`);
}
/**
 * MOCKED engineering rehearsal of the exact owner path: synthetic chain-8453 source, the real recording proxy with its
 * loopback provider, the complete lifecycle, transcript validation and a closed byte-identical replay. No provider request.
 */
async function rehearse(packages) {
  const sourcePort = 18600;
  for (const port of [sourcePort, 8545, 8546]) if ((await probePort(port)) !== 'free') fail('DRY_RUN_PORT_OCCUPIED');
  const scratch = mkdtempSync(join(tmpdir(), 'gryloo-build-006-dry-run-'));
  const source = spawn(process.env.GRYLOO_ANVIL_BIN, ['--host', '127.0.0.1', '--port', String(sourcePort), '--chain-id', '8453',
    '--accounts', '0', '--timestamp', '1790000000', '--disable-default-create2-deployer'],
    { stdio: ['ignore', 'ignore', 'ignore'], env: { HOME: scratch, PATH: '/usr/bin:/bin' } });
  try {
    for (let i = 0; i < 200 && await probePort(sourcePort) !== 'listening'; i++)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    if ((await probePort(sourcePort)) !== 'listening') fail('DRY_RUN_SOURCE_FAILED');
    const sourceCall = (method, params = []) => rpc(method, params, sourcePort);
    const { installSyntheticBase } = await import('./offline-rehearsal.mjs');
    const syntheticCodePins = await installSyntheticBase(sourceCall);
    writePrivate(join(scratch, 'synthetic-code-pins.json'), `${JSON.stringify(syntheticCodePins)}\n`);
    const { pool } = await installSyntheticUniswap(sourceCall, packages);
    for (let i = 0; i < 100; i++) await sourceCall('evm_mine');
    const billingPath = join(scratch, 'billing.json');
    syntheticBilling(billingPath, 'BUILD-006 synthetic dry-run only');
    const transcriptPath = join(scratch, 'transcript.json');
    mkdirSync(join(scratch, 'session'), { mode: 0o700 }); mkdirSync(join(scratch, 'replay'), { mode: 0o700 });
    const recorded = await runSession({ sessionDir: join(scratch, 'session'), environment: 'MOCKED', transcriptPath,
      proxyTail: ['--dry-run-provider', String(sourcePort)], billingPath, syntheticCodePins });
    source.kill('SIGKILL');
    const verified = verifyLiquidityTranscript(JSON.parse(readFileSync(transcriptPath, 'utf8')), [...forkDevAccounts()]);
    if (verified.pool.pool !== pool) fail('DRY_RUN_POOL_MISMATCH');
    const replayed = await runSession({ sessionDir: join(scratch, 'replay'), environment: 'MOCKED', replay: true, transcriptPath, syntheticCodePins });
    if (recorded.status !== 'COMPLETE' || replayed.status !== 'REPLAY_BYTE_IDENTICAL') fail('DRY_RUN_REHEARSAL_FAILED');
    return { recorded, replayed: replayed.status, scratch };
  } finally { source.kill('SIGKILL'); }
}
async function dryRun() {
  if (existsSync(join(ROOT, 'session')) || existsSync(TRANSCRIPT)) fail('SESSION_ALREADY_USED');
  useAccounts(); await verifyOwnerForkAccountSource();
  const packages = process.env.GRYLOO_UNISWAP_V3_PACKAGES;
  if (!packages || !packages.startsWith('/') || packages === REPO || packages.startsWith(REPO + '/')) fail('UNISWAP_V3_PACKAGES_REQUIRED');
  const rehearsal = await rehearse(packages);
  await runChild('pnpm', ['exec', 'vitest', 'run',
    'packages/reference-compiler/test/liquidity.test.ts', 'packages/reference-executor/test/liquidity.test.ts',
    'packages/reference-reconciler/test/liquidity.test.ts', 'apps/reference-dapp/src/server/liquidity-service.test.ts']);
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const input = await manifestBody(0);
  const result = { format: 'gryloo.build-006-offline-dry-run.v1', status: 'PASS',
    scope: ['MOCKED_SYNTHETIC_SOURCE_WITH_PUBLISHED_UNISWAP_V3_CODE', 'REAL_RECORDING_PROXY_LOOPBACK_PROVIDER', 'CLOSED_REPLAY', 'MOCKED_UNIT_TESTS'],
    inputSha256: hash(canonical(input)), providerRequests: 0, publicTransactions: 0,
    syntheticProxyRequests: rehearsal.recorded.providerRequests, syntheticReservedCu: rehearsal.recorded.reservedCu,
    lifecycle: rehearsal.recorded.lifecycle, steps: rehearsal.recorded.steps, replay: rehearsal.replayed,
    scenarioResultsSha256: rehearsal.recorded.scenarioResultsSha256 };
  const path = join(ROOT, 'dry-run.json');
  if (existsSync(path)) unlinkSync(path);
  writePrivate(path, `${canonical(result)}\n`);
  process.stdout.write(`${JSON.stringify({ status: 'DRY_RUN_PASS', scope: result.scope, inputSha256: result.inputSha256,
    syntheticProxyRequests: result.syntheticProxyRequests, steps: result.steps, replay: result.replay, scratch: rehearsal.scratch })}\n`);
}
async function preflight() {
  if (existsSync(join(ROOT, 'session')) || existsSync(TRANSCRIPT)) fail('SESSION_ALREADY_USED');
  for (const name of ['disposable-phrase', 'public-pins.json'])
    if ((statSync(join(ACCOUNTS, name)).mode & 0o777) !== 0o600) fail('ACCOUNT_MATERIAL_MODE_INVALID');
  useAccounts(); await verifyOwnerForkAccountSource();
  const dry = JSON.parse(readFileSync(join(ROOT, 'dry-run.json'), 'utf8'));
  if (dry?.status !== 'PASS' || dry.inputSha256 !== hash(canonical(await manifestBody(0)))) fail('DRY_RUN_MISSING_OR_STALE');
  if ((await probePort(8545)) !== 'free' || (await probePort(8546)) !== 'free') fail('PORT_OCCUPIED');
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const body = await manifestBody(Date.now());
  const bytes = `${canonical(body)}\n`;
  const path = join(ROOT, 'manifest.json');
  if (existsSync(path)) unlinkSync(path);
  writePrivate(path, bytes);
  process.stdout.write(`${JSON.stringify({ status: 'PREFLIGHT_PASS', manifest: path, digest: hash(bytes), pinnedFiles: Object.keys(body.files).length })}\n`);
}
async function checkManifest(digest) {
  const bytes = readFileSync(join(ROOT, 'manifest.json'));
  if (hash(bytes) !== digest) fail('MANIFEST_DIGEST_MISMATCH');
  const saved = JSON.parse(bytes);
  const current = await manifestBody(saved.notBeforeMs);
  if (canonical(saved) !== canonical(current)) fail('MANIFEST_INPUTS_CHANGED');
  return saved;
}
function startProxy(sessionDir, billingPath, tail) {
  const child = spawn(process.execPath, [PROXY, 'serve', sessionDir, billingPath, ...tail],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { HOME: ROOT, PATH: '/usr/bin:/bin' } });
  return new Promise((resolvePromise, rejectPromise) => {
    let output = ''; const timer = setTimeout(() => rejectPromise(new Error('PROXY_START_TIMEOUT')), 20_000);
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('RECORDING_PROXY_READY')) { clearTimeout(timer); resolvePromise(child); } });
    child.stderr.resume();
    child.once('close', code => { clearTimeout(timer); rejectPromise(new Error(`PROXY_EXITED:${code}`)); });
  });
}
function stopProxy(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child?.exitCode ?? null);
  return new Promise(resolvePromise => { child.once('close', code => resolvePromise(code)); child.kill(signal); });
}
async function upstream(method, params = []) {
  const response = await globalThis.fetch('http://127.0.0.1:8546', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(35_000) });
  const body = await response.json();
  if (!response.ok || body.error || !('result' in body)) fail('UPSTREAM_REFUSED');
  return body.result;
}
async function runSession({ sessionDir, environment, replay = false, transcriptPath = TRANSCRIPT, proxyTail = null, billingPath = null,
  syntheticCodePins = null }) {
  useAccounts();
  let proxy = null, upstreamChild = null, fork = null, complete = false;
  try {
    if (replay) {
      upstreamChild = await startReplayUpstream(transcriptPath);
    } else if (proxyTail) {
      proxy = await startProxy(sessionDir, billingPath, proxyTail);
    } else {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
      const credential = process.env.GRYLOO_ALCHEMY_KEY_FILE ?? fail('CREDENTIAL_FILE_REQUIRED');
      proxy = await startProxy(sessionDir, manifest.billingPath, [resolve(credential), String(manifest.notBeforeMs)]);
    }
    const transcript = replay ? JSON.parse(readFileSync(transcriptPath, 'utf8')) : null;
    const finalized = replay ? { number: `0x${transcript.sourceBlockNumber.toString(16)}`, hash: transcript.sourceBlockHash }
      : await upstream('eth_getBlockByNumber', ['finalized', false]);
    if (!replay && await upstream('eth_chainId') !== '0x2105') fail('SOURCE_CHAIN_MISMATCH');
    const sourceBlockNumber = Number.parseInt(finalized.number, 16), sourceBlockHash = finalized.hash;
    const accounts = [...forkDevAccounts()];
    const { identity, identityHash } = transcriptIdentity({ sourceBlockNumber, sourceBlockHash, accounts });
    if (transcript && (transcript.identityHash !== identityHash || transcript.sourceBlockHash !== sourceBlockHash)) fail('TRANSCRIPT_IDENTITY_MISMATCH');
    fork = await startFork({ binary: process.env.GRYLOO_ANVIL_BIN, blockNumber: sourceBlockNumber, blockHash: sourceBlockHash, recording: !replay });
    const discovered = await discoverLiquidityPins(rpc);
    const setup = await prepareForkFixture(sourceBlockNumber);
    const { parseLiquidityProfile } = await import('../../src/server/liquidity-service.ts');
    const profile = parseLiquidityProfile({ format: 'gryloo.mode-a-fork-profile.v1', environment,
      rpcUrl: 'http://127.0.0.1:8545', sourceChainId: 8453, sourceBlockNumber, sourceBlockHash,
      stateSourceHash: identityHash, owner: setup.owner, syntheticCodePins, liquidity: discovered.liquidity });
    const lifecycle = await runLiquidityLifecycle({ call: rpc, profile, journalRoot: join(sessionDir, 'journals'), tolerant: true });
    const document = { format: 'gryloo.build-003f-scenario-results.v1', build: 'BUILD-006', environment,
      sourceBlockNumber, sourceBlockHash, identityHash, setup, pool: discovered.liquidity,
      lifecycle };
    const text = `${canonical(document)}\n`;
    writePrivate(join(sessionDir, 'scenario-results.json'), text);
    if (lifecycle.status !== 'COMPLETE') fail(lifecycle.failure ?? 'LIQUIDITY_LIFECYCLE_INCOMPLETE');
    await stopFork(fork); fork = null;
    if (!replay) {
      const code = await stopProxy(proxy, 'SIGTERM'); proxy = null;
      if (code !== 0) fail('COMPLETION_REFUSED');
      const journal = JSON.parse(readFileSync(join(sessionDir, 'journal.json'), 'utf8'));
      const newTranscript = buildTranscript({ logPath: join(sessionDir, 'requests.jsonl'), journal,
        identity, identityHash, scenarioResultsSha256: hash(text), codeFingerprints: { pool: discovered.liquidity } });
      writePrivate(transcriptPath, `${JSON.stringify(newTranscript, null, 1)}\n`);
      complete = true;
      return { status: 'COMPLETE', sourceBlockNumber, sourceBlockHash, transcriptSha256: hash(readFileSync(transcriptPath)),
        scenarioResultsSha256: hash(text), providerRequests: journal.requests, reservedCu: journal.reservedCu,
        lifecycle: lifecycle.status, steps: lifecycle.steps.length };
    }
    complete = true;
    return { status: hash(text) === transcript.scenarioResultsSha256 ? 'REPLAY_BYTE_IDENTICAL' : 'REPLAY_DIFFERS',
      scenarioResultsSha256: hash(text), expected: transcript.scenarioResultsSha256, lifecycle: lifecycle.status,
      steps: lifecycle.steps.length };
  } finally {
    if (fork) await stopFork(fork).catch(() => undefined);
    if (proxy && !complete) await stopProxy(proxy, 'SIGUSR2');
    if (upstreamChild) await stopReplayUpstream(upstreamChild);
  }
}
async function record() {
  const digest = process.argv[3];
  if (!/^[0-9a-f]{64}$/.test(digest ?? '') || process.argv.length !== 4) fail('EXACT_MANIFEST_DIGEST_REQUIRED');
  for (const name of Object.keys(process.env)) if (/ALCHEMY_(?:API_)?KEY$|BEARER/i.test(name)) fail('CREDENTIAL_IN_ENVIRONMENT_REFUSED');
  const manifest = await checkManifest(digest);
  const billing = validateBilling(JSON.parse(readFileSync(manifest.billingPath, 'utf8')));
  if (billing.reportedOn !== new Date().toISOString().slice(0, 10)) fail('BILLING_REPORT_NOT_CURRENT');
  if (existsSync(TRANSCRIPT)) fail('TRANSCRIPT_ALREADY_EXISTS');
  const sessionDir = join(ROOT, 'session');
  mkdirSync(sessionDir, { mode: 0o700 });
  let result;
  try { result = await runSession({ sessionDir, environment: 'FORK_REPRODUCED' }); }
  catch (cause) { result = { status: 'STOPPED', failure: String(cause?.message ?? 'RECORDING_FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 160) }; }
  const credentialPath = process.env.GRYLOO_ALCHEMY_KEY_FILE;
  if (credentialPath) removeCredential(resolve(credentialPath));
  const journal = existsSync(join(sessionDir, 'journal.json')) ? JSON.parse(readFileSync(join(sessionDir, 'journal.json'), 'utf8')) : null;
  result = { ...result, journalStatus: journal?.status ?? 'UNAVAILABLE', stopReason: journal?.stopReason ?? null,
    providerRequests: journal?.requests ?? 0, reservedCu: journal?.reservedCu ?? 0,
    credentialFileRemoved: credentialPath ? !existsSync(resolve(credentialPath)) : false };
  writePrivate(join(sessionDir, 'summary.json'), `${canonical(result)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
  if (result.status !== 'COMPLETE') process.exitCode = 1;
}
async function replayVerify() {
  const transcript = JSON.parse(readFileSync(TRANSCRIPT, 'utf8'));
  useAccounts();
  verifyLiquidityTranscript(transcript, [...forkDevAccounts()]);
  const runtime = resolve(process.env.GRYLOO_LIQUIDITY_REPLAY_RUNTIME ?? '/tmp/gryloo-build-006-replay');
  if (existsSync(runtime)) fail('REPLAY_RUNTIME_ALREADY_EXISTS');
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const result = await runSession({ sessionDir: runtime, environment: 'FORK_REPRODUCED', replay: true });
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
  if (result.status !== 'REPLAY_BYTE_IDENTICAL') process.exitCode = 1;
}
const modes = { 'prepare-accounts': prepareAccounts, 'dry-run': dryRun, preflight, record, 'replay-verify': replayVerify };
const mode = modes[process.argv[2]];
if (!mode) { process.stderr.write('USAGE: liquidity-recording.mjs prepare-accounts | dry-run | preflight | record <manifest-digest> | replay-verify\n'); process.exit(2); }
mode().catch(cause => { process.stderr.write(`${String(cause?.message ?? 'FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 160)}\n`); process.exitCode = 1; });

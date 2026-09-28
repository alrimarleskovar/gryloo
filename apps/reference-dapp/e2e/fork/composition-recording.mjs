// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-007 bounded local source recording. The real mode is disabled until the synthetic rehearsal and manifest preflight pass. */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, buildTranscript, RECORDING_POLICY, validateBilling } from './recording-proxy.mjs';
import { verifyCompositionTranscript } from './composition-replay-upstream.mjs';
import { installSyntheticBase } from './offline-rehearsal.mjs';
import { LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, encodeLiquidityCall, toHex, fromHex } from '../../../../packages/reference-compiler/dist/index.js';
import { signModeBLocalTransaction } from '../../../../packages/reference-executor/dist/index.js';
import { ANVIL_PIN, FORK_UPSTREAM_POLICY } from '../../../../packages/reference-compiler/dist/profile.js';
import { validateAnvilBinary } from './harness.mjs';
const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
// The spent first attempt's stop evidence stays untouched in /home/asus/.gryloo/build-007; each new attempt has its own root.
const ROOT = '/home/asus/.gryloo/build-007-attempt-2';
// Live sessions pace every cold upstream read at >= 400 ms, so one simulation can exceed the 20 s fork RPC default.
const LIVE_FORK_RPC_TIMEOUT_MS = 120_000;
const TRANSCRIPT = join(REPO, 'apps/reference-dapp/e2e/fork/composition-transcript.json');
const PROXY = fileURLToPath(new URL('./recording-proxy.mjs', import.meta.url));
const HARNESS = fileURLToPath(new URL('./composition-harness.mjs', import.meta.url));
const compilerRequire = createRequire(new URL('../../../../packages/reference-compiler/package.json', import.meta.url));
const PINNED_PATHS = Object.freeze([
  'apps/reference-dapp/e2e/fork/composition-recording.mjs', 'apps/reference-dapp/e2e/fork/composition-harness.mjs',
  'apps/reference-dapp/e2e/fork/composition-replay-upstream.mjs', 'apps/reference-dapp/e2e/fork/recording-proxy.mjs',
  'apps/reference-dapp/e2e/fork/offline-rehearsal.mjs', 'apps/reference-dapp/e2e/fork/replay-upstream.mjs',
  'apps/reference-dapp/src/server/composition-service.ts', 'packages/reference-compiler/src/composition.ts',
  'packages/reference-compiler/src/profile.ts', 'packages/reference-executor/src/composition.ts',
  'packages/reference-reconciler/src/composition.ts', 'pnpm-lock.yaml',
]);
const APPROVED_FORWARD = ['eth_chainId','eth_getBlockByNumber','eth_getBalance','eth_getTransactionCount','eth_getCode','eth_getStorageAt'];
/** Credential-free owner report. Rotation and deletion attestations are checked only after preflight. */
function billingState(value) {
  const current = new Date().toISOString().slice(0, 10);
  if (!value || (value.format !== undefined && value.format !== 'gryloo.build-003f-provider-billing.v1') ||
      value.provider !== 'Alchemy' || value.plan !== 'Free' || value.network !== 'Base Mainnet' ||
      value.paymentMethod !== false || value.paidAddOn !== false || value.payAsYouGo !== false ||
      value.overage !== false || value.autoUpgrade !== false || value.reportedOn !== current ||
      !Number.isSafeInteger(value.usedMonthlyCu) || value.usedMonthlyCu < 0 ||
      !Number.isSafeInteger(value.monthlyAllowanceCu) || value.monthlyAllowanceCu !== 30_000_000 ||
      !Number.isSafeInteger(value.remainingMonthlyCu) || value.remainingMonthlyCu < RECORDING_POLICY.maxReservedCu ||
      value.usedMonthlyCu + value.remainingMonthlyCu !== value.monthlyAllowanceCu)
    fail('BILLING_STATE_NOT_CONFIRMED');
  return { provider: value.provider, plan: value.plan, network: value.network, paymentMethod: false,
    paidAddOn: false, payAsYouGo: false, overage: false, autoUpgrade: false, reportedOn: value.reportedOn,
    usedMonthlyCu: value.usedMonthlyCu, monthlyAllowanceCu: value.monthlyAllowanceCu,
    remainingMonthlyCu: value.remainingMonthlyCu };
}
function pinnedInputs() {
  validateAnvilBinary(process.env.GRYLOO_ANVIL_BIN);
  if (hash(readFileSync(process.env.GRYLOO_ANVIL_BIN)) !== ANVIL_PIN.binarySha256 ||
      canonical(FORK_UPSTREAM_POLICY.forward) !== canonical(APPROVED_FORWARD)) fail('PINNED_TOOL_OR_METHOD_ALLOWLIST_CHANGED');
  return { files: Object.fromEntries(PINNED_PATHS.map(path => [path, hash(readFileSync(join(REPO, path)))])),
    anvilSha256: ANVIL_PIN.binarySha256, nodeSha256: hash(readFileSync(process.execPath)),
    localKeysSha256: hash(readFileSync(join(ROOT, 'local-keys.json'))), policy: RECORDING_POLICY,
    forwardMethods: APPROVED_FORWARD };
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
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
      if (receipt === null) await new Promise(resolvePromise => globalThis.setTimeout(resolvePromise, 25));
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
function privateWrite(path, content) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
}
function removeCredential(path) {
  try {
    const size = statSync(path).size, fd = openSync(path, 'r+');
    try { writeFileSync(fd, Buffer.alloc(size)); fsyncSync(fd); } finally { closeSync(fd); }
    unlinkSync(path);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
const sleep = ms => new Promise(done => globalThis.setTimeout(done, ms));
async function waitPort(port, state = 'listening') {
  const { probePort } = await import('./harness.mjs');
  for (let i = 0; i < (port === 18545 ? 1200 : 200); i++) { if (await probePort(port) === state) return; await sleep(50); }
  fail(`COMPOSITION_PORT_${state.toUpperCase()}_${port}`);
}
async function rpc(port, method, params = []) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(35_000) });
  const body = await response.json();
  if (!response.ok || body.error || !('result' in body)) fail(`COMPOSITION_RPC_${method}:${String(body.error?.message ?? response.status).slice(0, 80)}`);
  return body.result;
}
function child(command, args, env) {
  const process = spawn(command, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env });
  let output = '';
  for (const stream of [process.stdout, process.stderr]) stream.on('data', chunk => { output = (output + chunk.toString()).slice(-4096); });
  return { process, output: () => output };
}
async function stop(childProcess, signal = 'SIGTERM') {
  if (!childProcess || childProcess.exitCode !== null) return childProcess?.exitCode ?? null;
  return new Promise(done => { childProcess.once('close', code => done(code)); childProcess.kill(signal); });
}
function identity(number, blockHash) {
  const value = { format: 'gryloo.base-fork-state-transcript.v1', sourceChainId: 8453,
    sourceBlockNumber: number, sourceBlockHash: blockHash, forkChainId: 31337,
    localAccountsSource: 'LOCAL_SETUP_NOT_BASE_OBSERVED', accounts: [] };
  return { identity: value, identityHash: '0x' + hash(JSON.stringify(value)) };
}
async function sourceSetup(port, packages) {
  const call = (method, params = []) => rpc(port, method, params);
  const syntheticCodePins = { ...await installSyntheticBase(call) };
  const { FORK_CONTRACTS } = await import('../../../../packages/reference-compiler/dist/index.js');
  for (const name of ['quoter', 'router']) {
    const code = await call('eth_getCode', [FORK_CONTRACTS[name], 'latest']);
    const occurrences = code.split('610bb8').length - 1;
    if (occurrences !== 1) fail(`SYNTHETIC_FEE_PATCH_INVALID_${name}`);
    const changed = code.replace('610bb8', '6101f4');
    await call('anvil_setCode', [FORK_CONTRACTS[name], changed]);
    if (name === 'quoter') syntheticCodePins.quoter = '0x' + hash(Buffer.from(changed.slice(2), 'hex'));
  }
  const { pool } = await installSyntheticUniswap(call, packages);
  syntheticCodePins.factory = '0x' + hash(Buffer.from((await call('eth_getCode', [LIQUIDITY_FACTORY, 'latest'])).slice(2), 'hex'));
  for (let i = 0; i < 100; i++) await call('evm_mine');
  return { pool, syntheticCodePins };
}
async function lifecycle(profilePath, keyPath, sessionDir, live) {
  const { createServer } = await import('vite');
  const { baseAssetRegistry, referenceRegistry } = await import('../../../../packages/action-registry/dist/index.js');
  const { createReviewContext } = await import('../../../../packages/reference-linter/dist/index.js');
  const vite = await createServer({ root: REPO, configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { createCompositionWorkflow } = await vite.ssrLoadModule('/apps/reference-dapp/src/domain/composition-authoring.ts');
    const { createCompositionService } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/composition-service.ts');
    const { createForkRpc } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/fork-rpc.ts');
    const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    const service = createCompositionService(profile,
      createForkRpc({ url: profile.rpcUrl, ...(live ? { timeoutMs: LIVE_FORK_RPC_TIMEOUT_MS } : {}) }));
    const context = createReviewContext({ registryId: referenceRegistry.registryId,
      capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
    const pool = await service.poolState(await service.atHead());
    const center = Math.floor(pool.tick / 10) * 10;
    const workflow = createCompositionWorkflow('build-007-recording', 1, profile.safe,
      { swapUSDC: '400', slippageBps: '100', mint: { weth: '0.1', usdc: '200', minimumWeth: '0.000001', minimumUsdc: '0.001',
        tickLower: String(center - 100), tickUpper: String(center + 100), recipient: profile.safe } }, context);
    const prepared = await service.prepare(workflow);
    const privateKeys = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (!privateKeys.owner) fail('OWNER_LOCAL_KEY_REQUIRED');
    const ownerKey = fromHex(privateKeys.owner);
    const call = (method, params = []) => rpc(18545, method, params);
    const signOwner = async tx => {
      const nonce = BigInt(await call('eth_getTransactionCount', [profile.owner, 'pending']));
      const head = await call('eth_getBlockByNumber', ['latest', false]);
      const signed = signModeBLocalTransaction({ expectedExecutor: profile.owner, to: tx.to, data: tx.data,
        nonce, gasLimit: 5_000_000n, maxFeePerGas: BigInt(head.baseFeePerGas) * 2n + 1_000_000n }, ownerKey);
      const received = await call('eth_sendRawTransaction', [signed.raw]);
      if (received !== signed.hash) fail('OWNER_SIGNED_HASH_CHANGED');
      return received;
    };
    const ownerTransactions = [];
    try {
      for (let index = 0; index < prepared.compiled.installation.length; index++) {
        const step = await service.installationStep(prepared.executionId, index);
        const txHash = await signOwner(step);
        let receipt = null;
        for (let attempt = 0; attempt < 100 && !receipt; attempt++) {
          receipt = await call('eth_getTransactionReceipt', [txHash]);
          if (!receipt) await sleep(50);
        }
        if (receipt?.status !== '0x1') fail(`OWNER_INSTALLATION_${index}_UNCONFIRMED`);
        await service.confirm(prepared.executionId, 'installation', index, txHash);
        ownerTransactions.push(txHash);
      }
    } finally { ownerKey.fill(0); }
    const workerStates = [];
    for (let i = 0; i < 12; i++) {
      const event = await service.worker(prepared.executionId, keyPath);
      workerStates.push({ step: event.step, state: event.state, transactionHash: event.transactionHash, tokenId: event.tokenId ?? null });
      if (event.step === 'MINT' && event.state === 'RECONCILED') break;
      if (['INCONCLUSIVE', 'REVERTED'].includes(event.state)) fail(`COMPOSITION_WORKER_${event.step}_${event.state}:${event.reason}`);
      await sleep(50);
    }
    const final = workerStates.at(-1);
    if (final?.step !== 'MINT' || final.state !== 'RECONCILED') fail('COMPOSITION_MINT_NOT_RECONCILED');
    const events = (await service.status(prepared.executionId)).events;
    const result = { format: 'gryloo.build-003f-scenario-results.v1', build: 'BUILD-007', environment: profile.environment,
      sourceBlockNumber: profile.sourceBlockNumber, sourceBlockHash: profile.sourceBlockHash,
      executionId: prepared.executionId, workflowHash: prepared.workflowHash, artifactHashes: prepared.artifacts.hashes,
      permissionHash: prepared.compiled.permissionHash, ownerTransactions,
      workerStates, journalLevels: [...new Set(events.map(event => event.level))].sort(),
      tokenId: final.tokenId, pool: profile.liquidity, labels: profile.provenance.localSetup.map(entry => entry.label) };
    privateWrite(join(sessionDir, 'scenario-results.json'), `${canonical(result)}\n`);
    return { result, profile };
  } finally { await vite.close(); }
}
async function runSession({ mode, scratch, transcriptPath, packages }) {
  // The harness and worker hold the disposable executor key only under /tmp/, whatever the session scratch is.
  const sessionDir = join(scratch, 'session'), runtime = mkdtempSync('/tmp/gryloo-b007-runtime-');
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  let source = null, proxy = null, harness = null;
  const live = mode !== 'replay';
  try {
    for (const port of [8546, 18545, 18546, 18547]) await waitPort(port, 'free');
    let sourcePins = null;
    if (mode === 'synthetic') {
      await waitPort(18600, 'free');
      source = child(process.env.GRYLOO_ANVIL_BIN, ['--host', '127.0.0.1', '--port', '18600', '--chain-id', '8453',
        '--accounts', '0', '--timestamp', '1790000000', '--disable-default-create2-deployer'],
      { HOME: scratch, PATH: '/usr/bin:/bin' });
      await waitPort(18600);
      sourcePins = await sourceSetup(18600, packages);
    }
    if (live) {
      const billingPath = mode === 'synthetic' ? join(scratch, 'billing.json') : join(ROOT, 'alchemy-billing.json');
      if (mode === 'synthetic') privateWrite(billingPath, `${canonical({ format: 'gryloo.build-003f-provider-billing.v1',
        provider: 'Alchemy', plan: 'Free', network: 'Base Mainnet', paymentMethod: false, paidAddOn: false, overage: false,
        autoUpgrade: false, credentialRotated: true, previousCredentialDeleted: true, rotatedOn: new Date().toISOString().slice(0, 10),
        reportedOn: new Date().toISOString().slice(0, 10), remainingMonthlyCu: 39000 })}\n`);
      const tail = mode === 'synthetic' ? ['--dry-run-provider', '18600'] : [join(ROOT, 'alchemy-key'), String(JSON.parse(readFileSync(join(ROOT, 'manifest.json'))).notBeforeMs)];
      proxy = child(process.execPath, [PROXY, 'serve', sessionDir, billingPath, ...tail], { HOME: scratch, PATH: '/usr/bin:/bin' });
      await waitPort(8546);
    } else {
      const { createReplayServer } = await import('./replay-upstream.mjs');
      const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
      verifyCompositionTranscript(transcript, []);
      const upstream = createReplayServer(transcript);
      await new Promise((done, reject) => { upstream.once('error', reject); upstream.listen(8546, '127.0.0.1', done); });
      proxy = { server: upstream };
    }
    const sourceBlock = live ? await rpc(8546, 'eth_getBlockByNumber', ['finalized', false])
      : { number: '0x' + JSON.parse(readFileSync(transcriptPath)).sourceBlockNumber.toString(16),
        hash: JSON.parse(readFileSync(transcriptPath)).sourceBlockHash };
    if (live && await rpc(8546, 'eth_chainId') !== '0x2105') fail('SOURCE_CHAIN_MISMATCH');
    const number = Number(BigInt(sourceBlock.number));
    const inputKeys = join(ROOT, 'local-keys.json');
    const transcriptDocument = !live ? JSON.parse(readFileSync(transcriptPath, 'utf8')) : null;
    const syntheticCodePins = sourcePins?.syntheticCodePins ?? transcriptDocument?.codeFingerprints?.composition?.syntheticCodePins;
    const syntheticPinsPath = join(runtime, 'synthetic-pins.json');
    if (syntheticCodePins) privateWrite(syntheticPinsPath, `${JSON.stringify(syntheticCodePins)}\n`);
    const env = { ...process.env, GRYLOO_MODE_B_RUNTIME: runtime, GRYLOO_MODE_B_SAFE_PACKAGE: '/tmp/gryloo-safe-package/package',
      GRYLOO_MODE_B_ROLES_MASTERCOPIES: '/tmp/gryloo-roles-mastercopies.json',
      GRYLOO_MODE_B_EIP2470_INITCODE: '/tmp/gryloo-build004-inputs/erc2470-initcode.bin',
      GRYLOO_COMPOSITION_KEYS_INPUT: inputKeys,
      GRYLOO_COMPOSITION_ENVIRONMENT: syntheticCodePins ? 'MOCKED' : 'FORK_REPRODUCED',
      ...(syntheticCodePins ? { GRYLOO_COMPOSITION_SYNTHETIC_PINS_FILE: syntheticPinsPath } : {}),
      ...(live ? { GRYLOO_COMPOSITION_RECORDING_PROXY_PORT: '8546',
        GRYLOO_COMPOSITION_SOURCE_BLOCK_NUMBER: String(number), GRYLOO_COMPOSITION_SOURCE_BLOCK_HASH: sourceBlock.hash }
        : { GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_PATH: transcriptPath,
          GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_SHA256: hash(readFileSync(transcriptPath)) }) };
    harness = child(process.execPath, [HARNESS, 'serve'], env);
    await waitPort(18545);
    const profilePath = join(runtime, 'profile.json'), keyPath = join(runtime, 'mode-b-keys.json');
    for (let i = 0; i < 600 && (!existsSync(profilePath) || !existsSync(keyPath)); i++) {
      if (harness.process.exitCode !== null) fail(`HARNESS_EXITED:${harness.output()}`);
      await sleep(50);
    }
    if (!existsSync(profilePath) || !existsSync(keyPath)) fail(`HARNESS_NOT_READY:${harness.output()}`);
    const { result, profile } = await lifecycle(profilePath, keyPath, sessionDir, live);
    await stop(harness.process); harness = null;
    if (live) {
      const code = await stop(proxy.process, 'SIGTERM'); proxy = null;
      if (code !== 0) fail('RECORDING_PROXY_COMPLETION_REFUSED');
      const journal = JSON.parse(readFileSync(join(sessionDir, 'journal.json')));
      const ids = identity(number, sourceBlock.hash);
      const transcript = buildTranscript({ logPath: join(sessionDir, 'requests.jsonl'), journal,
        ...ids, scenarioResultsSha256: hash(readFileSync(join(sessionDir, 'scenario-results.json'))),
        codeFingerprints: { composition: { ...profile.liquidity, ...(sourcePins ? { syntheticCodePins: sourcePins.syntheticCodePins } : {}) } } });;
      privateWrite(transcriptPath, JSON.stringify(transcript, null, 1) + '\n');
      return { status: 'COMPLETE', sourceBlockNumber: number, sourceBlockHash: sourceBlock.hash,
        transcriptSha256: hash(readFileSync(transcriptPath)), scenarioResultsSha256: transcript.scenarioResultsSha256,
        providerRequests: journal.requests, reservedCu: journal.reservedCu, result };
    }
    const transcript = JSON.parse(readFileSync(transcriptPath));
    return { status: hash(readFileSync(join(sessionDir, 'scenario-results.json'))) === transcript.scenarioResultsSha256
      ? 'REPLAY_BYTE_IDENTICAL' : 'REPLAY_DIFFERS', result };
  } catch (error) {
    throw new Error(`${error.message}:HARNESS:${harness?.output() ?? ''}:PROXY:${proxy?.output?.() ?? ''}`, { cause: error });
  } finally {
    if (harness) await stop(harness.process, 'SIGTERM');
    if (proxy?.process) await stop(proxy.process, 'SIGUSR2');
    if (proxy?.server) await new Promise(done => proxy.server.close(done));
    if (source) await stop(source.process, 'SIGKILL');
  }
}
async function main() {
  const mode = process.argv[2];
  if (!['dry-run', 'preflight', 'record', 'replay-verify'].includes(mode)) fail('BUILD_007_RECORDING_MODE_INVALID');
  if (!process.env.GRYLOO_ANVIL_BIN || !existsSync(process.env.GRYLOO_ANVIL_BIN)) fail('PINNED_ANVIL_REQUIRED');
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const keys = join(ROOT, 'local-keys.json');
  if (!existsSync(keys)) fail('BUILD_007_LOCAL_KEYS_REQUIRED');
  if ((statSync(keys).mode & 0o777) !== 0o600) fail('BUILD_007_LOCAL_KEYS_MODE_INVALID');
  if (mode === 'dry-run') {
    const packages = process.env.GRYLOO_UNISWAP_V3_PACKAGES;
    if (!packages?.startsWith('/tmp/') || !existsSync(join(packages, 'v3-core'))) fail('PINNED_UNISWAP_PACKAGES_REQUIRED');
    const scratch = mkdtempSync(join(tmpdir(), 'gryloo-b007-dry-'));
    const result = await runSession({ mode: 'synthetic', scratch, transcriptPath: join(scratch, 'transcript.json'), packages });
    if (result.status !== 'COMPLETE') fail('SYNTHETIC_RECORDING_FAILED');
    const replay = await runSession({ mode: 'replay', scratch: join(scratch, 'replay'), transcriptPath: join(scratch, 'transcript.json') });
    if (replay.status !== 'REPLAY_BYTE_IDENTICAL') fail('SYNTHETIC_REPLAY_DIFFERS');
    privateWrite(join(ROOT, 'dry-run.json'), `${canonical({ status: 'PASS', inputSha256: hash(canonical(pinnedInputs())),
      transcriptSha256: result.transcriptSha256,
      providerRequests: result.providerRequests, reservedCu: result.reservedCu, replay: replay.status })}\n`);
    process.stdout.write(`${JSON.stringify({ status: 'SYNTHETIC_DRY_RUN_PASS', scratch, providerRequests: result.providerRequests,
      reservedCu: result.reservedCu, replay: replay.status })}\n`);
    return;
  }
  if (mode === 'preflight') {
    const dry = existsSync(join(ROOT, 'dry-run.json')) ? JSON.parse(readFileSync(join(ROOT, 'dry-run.json'))) : null;
    if (dry?.status !== 'PASS' || dry.inputSha256 !== hash(canonical(pinnedInputs()))) fail('DRY_RUN_MISSING_OR_STALE');
    if (existsSync(join(ROOT, 'session')) || existsSync(TRANSCRIPT)) fail('RECORDING_ALREADY_USED');
    const billingPath = join(ROOT, 'alchemy-billing.json');
    if (!existsSync(billingPath) || (statSync(billingPath).mode & 0o777) !== 0o600) fail('BILLING_FILE_INVALID');
    const state = billingState(JSON.parse(readFileSync(billingPath)));
    const manifest = { format: 'gryloo.build-007-owner-recording-manifest.v1', notBeforeMs: Date.now(),
      ...pinnedInputs(), billingStateSha256: hash(canonical(state)) };
    privateWrite(join(ROOT, 'manifest.json'), `${canonical(manifest)}\n`);
    process.stdout.write(`${JSON.stringify({ status: 'PREFLIGHT_PASS', manifestSha256: hash(readFileSync(join(ROOT, 'manifest.json'))) })}\n`);
    return;
  }
  if (mode === 'record') {
    const digest = process.argv[3];
    if (!/^[0-9a-f]{64}$/.test(digest ?? '') || !existsSync(join(ROOT, 'manifest.json')) ||
        hash(readFileSync(join(ROOT, 'manifest.json'))) !== digest) fail('MANIFEST_DIGEST_MISMATCH');
    if (existsSync(join(ROOT, 'session')) || existsSync(TRANSCRIPT)) fail('RECORDING_ALREADY_USED');
    const keyFile = join(ROOT, 'alchemy-key');
    if (!existsSync(keyFile)) fail('FRESH_CREDENTIAL_REQUIRED');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json')));
    const { notBeforeMs, billingStateSha256, ...savedInputs } = manifest;
    if (canonical(savedInputs) !== canonical({ format: 'gryloo.build-007-owner-recording-manifest.v1', ...pinnedInputs() }) ||
        billingStateSha256 !== hash(canonical(billingState(JSON.parse(readFileSync(join(ROOT, 'alchemy-billing.json')))))))
      fail('MANIFEST_INPUTS_CHANGED');
    const billing = validateBilling(JSON.parse(readFileSync(join(ROOT, 'alchemy-billing.json'))));
    if (billing.reportedOn !== new Date().toISOString().slice(0, 10)) fail('BILLING_REPORT_NOT_CURRENT');
    if (statSync(keyFile).mtimeMs <= notBeforeMs) fail('CREDENTIAL_NOT_FRESH');
    const scratch = ROOT;
    let result;
    try { result = await runSession({ mode: 'real', scratch, transcriptPath: TRANSCRIPT }); }
    catch (error) { result = { status: 'STOPPED', reason: String(error.message).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 160) }; }
    finally { removeCredential(keyFile); }
    const journal = existsSync(join(ROOT, 'session/journal.json')) ? JSON.parse(readFileSync(join(ROOT, 'session/journal.json'))) : null;
    privateWrite(join(ROOT, 'summary.json'), `${canonical({ ...result, providerRequests: journal?.requests ?? 0,
      reservedCu: journal?.reservedCu ?? 0, journalStatus: journal?.status ?? 'UNAVAILABLE', credentialRemoved: !existsSync(keyFile) })}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'COMPLETE') process.exitCode = 1;
    return;
  }
  if (!existsSync(TRANSCRIPT)) fail('COMPOSITION_TRANSCRIPT_REQUIRED');
  const result = await runSession({ mode: 'replay', scratch: mkdtempSync(join(tmpdir(), 'gryloo-b007-replay-')), transcriptPath: TRANSCRIPT });
  process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
  if (result.status !== 'REPLAY_BYTE_IDENTICAL') process.exitCode = 1;
}
main().catch(error => { process.stderr.write(`${String(error.message).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 1000)}\n`); process.exitCode = 1; });

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F F3/F4 owner wrapper. Modes:
 *   preflight            zero provider requests; pins the reviewed inputs and prints the manifest digest
 *   record <digest>      the single owner-run recording session (provider credential from a private file)
 *   dry-run              the identical path against a loopback synthetic chain-8453 source (MOCKED, no credential)
 *   replay-verify        F4: closed replay of the committed transcript; results must equal the recorded digest
 * The command line never carries a secret. Only credential-free counts and statuses are printed.
 */
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, buildTranscript, RECORDING_POLICY, validateBilling } from './recording-proxy.mjs';

const REPO = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const HOME_ROOT = '/home/asus/.gryloo/build-003f';
const ACCOUNTS = join(HOME_ROOT, 'accounts');
const F3_ROOT = join(HOME_ROOT, 'f3');
const TRANSCRIPT_PATH = join(REPO, 'apps/reference-dapp/e2e/fork/base-fork-transcript.json');
const PROXY = fileURLToPath(new URL('./recording-proxy.mjs', import.meta.url));
const NODE = process.execPath;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

function writePrivate(path, text) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}
function fail(code) { throw new Error(code); }
/** Paths whose exact bytes the recording depends on; the manifest pins every one. */
const PINNED_PATHS = [
  'apps/reference-dapp/e2e/fork/owner-recording.mjs', 'apps/reference-dapp/e2e/fork/recording-proxy.mjs',
  'apps/reference-dapp/e2e/fork/harness.mjs', 'apps/reference-dapp/e2e/fork/fork-setup.mjs',
  'apps/reference-dapp/e2e/fork/replay-upstream.mjs', 'apps/reference-dapp/src/server/mode-a-service.ts',
  'apps/reference-dapp/src/domain/swap-authoring.ts', 'packages/reference-compiler/src/profile.ts',
  'packages/reference-compiler/src/fork-quote.ts', 'packages/reference-compiler/src/simulation.ts',
  'packages/reference-compiler/src/payload.ts', 'packages/reference-reconciler/src/reconcile.ts',
  'packages/reference-executor/src/attempts.ts', 'pnpm-lock.yaml',
];
function distFiles() {
  const out = [];
  for (const name of ['reference-compiler', 'reference-executor', 'reference-reconciler', 'workflow-contracts', 'action-registry', 'reference-linter']) {
    const dir = join(REPO, 'packages', name, 'dist');
    for (const file of readdirSync(dir).filter(item => item.endsWith('.js')).sort()) out.push(`packages/${name}/dist/${file}`);
  }
  return out;
}
function git(...args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = ''; child.stdout.on('data', chunk => { out += chunk; });
    child.once('close', code => code === 0 ? resolvePromise(out.trim()) : rejectPromise(new Error('GIT_FAILED')));
  });
}
async function manifestBody({ billingPath, notBeforeMs }) {
  const anvil = process.env.GRYLOO_ANVIL_BIN ?? fail('GRYLOO_ANVIL_BIN_REQUIRED');
  const files = Object.fromEntries([...PINNED_PATHS, ...distFiles()].map(path => [path, sha256(readFileSync(join(REPO, path)))]));
  return { format: 'gryloo.build-003f-owner-recording-manifest.v1', head: await git('rev-parse', 'HEAD'),
    branch: await git('rev-parse', '--abbrev-ref', 'HEAD'), files, node: { path: NODE, sha256: sha256(readFileSync(NODE)) },
    anvil: { path: anvil, sha256: sha256(readFileSync(anvil)) }, accounts: { publicPins: join(ACCOUNTS, 'public-pins.json'),
      publicPinsSha256: sha256(readFileSync(join(ACCOUNTS, 'public-pins.json'))) },
    billing: billingPath, notBeforeMs, policy: RECORDING_POLICY, transcriptPath: TRANSCRIPT_PATH };
}
async function checkManifest(manifestPath, digest) {
  const bytes = readFileSync(manifestPath);
  if (sha256(bytes) !== digest) fail('MANIFEST_DIGEST_MISMATCH');
  const manifest = JSON.parse(bytes);
  const current = await manifestBody({ billingPath: manifest.billing, notBeforeMs: manifest.notBeforeMs });
  if (canonical(current) !== canonical(manifest)) fail('MANIFEST_INPUTS_CHANGED');
  return manifest;
}
function probe(port) {
  return import('./harness.mjs').then(({ probePort }) => probePort(port));
}
async function rpcAt(port, method, params = []) {
  const response = await globalThis.fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(RECORDING_POLICY.requestTimeoutMs + 5000) });
  const body = await response.json();
  if (body.error || !('result' in body)) throw new Error(`SESSION_START_FAILED:${String(body.error?.message ?? 'invalid').slice(0, 120)}`);
  return body.result;
}
function startProxy(args) {
  const child = spawn(NODE, [PROXY, 'serve', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { HOME: HOME_ROOT, PATH: '/usr/bin:/bin' } });
  return new Promise((resolvePromise, rejectPromise) => {
    let out = '';
    const timer = setTimeout(() => rejectPromise(new Error('PROXY_START_TIMEOUT')), 20_000);
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('RECORDING_PROXY_READY')) { clearTimeout(timer); resolvePromise(child); } });
    child.stderr.resume();
    child.once('close', code => { clearTimeout(timer); rejectPromise(new Error(`PROXY_EXITED:${code}`)); });
  });
}
function stopProxy(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child?.exitCode ?? null);
  return new Promise(resolvePromise => { child.once('close', code => resolvePromise(code)); child.kill(signal); });
}
function shred(path) {
  try {
    const size = statSync(path).size;
    const fd = openSync(path, 'r+');
    try { writeFileSync(fd, Buffer.alloc(size)); fsyncSync(fd); } finally { closeSync(fd); }
    unlinkSync(path);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
function useAccounts() {
  process.env.GRYLOO_FORK_ACCOUNT_PHRASE_FILE = join(ACCOUNTS, 'disposable-phrase');
  process.env.GRYLOO_F2_PUBLIC_PIN_FILE = join(ACCOUNTS, 'public-pins.json');
}

/** Shared recording body: session start, fork, setup, scenarios, completion and transcript. */
async function recordSession({ sessionDir, proxyArgs, environment, syntheticCodePins = null, transcriptPath }) {
  const harness = await import('./harness.mjs');
  const { prepareForkFixture } = await import('./fork-setup.mjs');
  const { parseModeAProfile } = await import('../../src/server/mode-a-service.ts');
  for (const port of [8545, 8546]) if (await probe(port) !== 'free') fail(`PORT_OCCUPIED:${port}`);
  useAccounts();
  let proxy = null, fork = null, completed = false;
  const summary = { status: 'STOPPED', environment };
  try {
    proxy = await startProxy(proxyArgs);
    const finalized = await rpcAt(8546, 'eth_getBlockByNumber', ['finalized', false]);
    if (await rpcAt(8546, 'eth_chainId') !== '0x2105') fail('SOURCE_CHAIN_MISMATCH');
    const sourceBlockNumber = Number.parseInt(finalized.number, 16), sourceBlockHash = finalized.hash;
    const accounts = harness.forkDevAccounts();
    const { identity, identityHash } = harness.transcriptIdentity({ sourceBlockNumber, sourceBlockHash, accounts: [...accounts] });
    fork = await harness.startFork({ binary: process.env.GRYLOO_ANVIL_BIN, blockNumber: sourceBlockNumber, blockHash: sourceBlockHash, recording: true });
    const setup = await prepareForkFixture(sourceBlockNumber);
    const profile = parseModeAProfile({ format: 'gryloo.mode-a-fork-profile.v1', environment, rpcUrl: 'http://127.0.0.1:8545',
      sourceChainId: 8453, sourceBlockNumber, sourceBlockHash, stateSourceHash: identityHash, owner: setup.owner, syntheticCodePins });
    const results = await harness.runModeAScenarios({ call: harness.rpc, profile, journalRoot: join(sessionDir, 'journals'), setupAccount: setup.setup, tolerant: true });
    const document = { format: 'gryloo.build-003f-scenario-results.v1', environment, sourceBlockNumber, sourceBlockHash, identityHash, setup, results };
    const resultsText = `${canonical(document)}\n`;
    writePrivate(join(sessionDir, 'scenario-results.json'), resultsText);
    await harness.stopFork(fork); fork = null;
    const code = await stopProxy(proxy, 'SIGTERM'); proxy = null;
    if (code !== 0) fail('COMPLETION_REFUSED');
    completed = true;
    const journal = JSON.parse(readFileSync(join(sessionDir, 'journal.json'), 'utf8'));
    const fingerprints = Object.values(results).find(value => value.codeHashes)?.codeHashes ?? null;
    const transcript = buildTranscript({ logPath: join(sessionDir, 'requests.jsonl'), journal, identity, identityHash,
      scenarioResultsSha256: sha256(resultsText), codeFingerprints: { note: 'SHA-256 of eth_getCode at the quote block', codeHashes: fingerprints } });
    const transcriptText = `${JSON.stringify(transcript, null, 1)}\n`;
    writePrivate(transcriptPath, transcriptText);
    Object.assign(summary, { status: 'COMPLETE', sourceBlockNumber, sourceBlockHash, identityHash, providerRequests: journal.requests,
      reservedCu: journal.reservedCu, localReplies: journal.localReplies, transcriptSha256: sha256(transcriptText),
      scenarioResultsSha256: sha256(resultsText), acceptanceUnmet: harness.modeAScenarioAcceptance(results),
      scenarios: Object.fromEntries(Object.entries(results).map(([key, value]) =>
        [key, value.failure ?? value.evidence.at(-1)?.outcome ?? value.observations.at(-1)?.outcome ?? 'NONE'])) });
    return summary;
  } catch (error) {
    summary.failure = String(error?.message ?? 'RECORDING_FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 160);
    throw Object.assign(new Error(summary.failure), { summary });
  } finally {
    if (fork) await harness.stopFork(fork).catch(() => undefined);
    if (proxy && !completed) await stopProxy(proxy, 'SIGUSR2');
    try {
      const journal = JSON.parse(readFileSync(join(sessionDir, 'journal.json'), 'utf8'));
      Object.assign(summary, { journalStatus: journal.status, stopReason: journal.stopReason, providerRequests: journal.requests, reservedCu: journal.reservedCu });
    } catch { summary.journalStatus = 'UNAVAILABLE'; }
  }
}

/** Agent-run: pins every reviewed input; the owner's billing report is validated at record time, before any request. */
async function preflight() {
  const billingPath = join(F3_ROOT, 'billing.json');
  if (existsSync(join(F3_ROOT, 'session'))) fail('SESSION_ALREADY_USED');
  for (const path of [join(ACCOUNTS, 'disposable-phrase'), join(ACCOUNTS, 'public-pins.json')]) {
    if ((statSync(path).mode & 0o777) !== 0o600) fail('ACCOUNT_MATERIAL_MODE_INVALID');
  }
  useAccounts();
  const { verifyOwnerForkAccountSource } = await import('./harness.mjs');
  await verifyOwnerForkAccountSource();
  mkdirSync(F3_ROOT, { recursive: true, mode: 0o700 });
  const manifest = await manifestBody({ billingPath, notBeforeMs: Date.now() });
  const text = `${canonical(manifest)}\n`;
  const path = join(F3_ROOT, 'manifest.json');
  if (existsSync(path)) unlinkSync(path);
  writePrivate(path, text);
  process.stdout.write(`${JSON.stringify({ status: 'PREFLIGHT_PASS', manifest: path, digest: sha256(text), pinnedFiles: Object.keys(manifest.files).length })}\n`);
}

async function record() {
  const digest = process.argv[3];
  if (!/^[0-9a-f]{64}$/.test(digest ?? '') || process.argv.length !== 4) fail('EXACT_MANIFEST_DIGEST_REQUIRED');
  const keyFile = process.env.GRYLOO_ALCHEMY_KEY_FILE ?? fail('GRYLOO_ALCHEMY_KEY_FILE_REQUIRED');
  for (const name of Object.keys(process.env)) if (/ALCHEMY_(?:API_)?KEY$|BEARER/i.test(name)) fail('CREDENTIAL_IN_ENVIRONMENT_REFUSED');
  const manifest = await checkManifest(join(F3_ROOT, 'manifest.json'), digest);
  validateBilling(JSON.parse(readFileSync(manifest.billing, 'utf8')));
  if (existsSync(TRANSCRIPT_PATH)) fail('TRANSCRIPT_ALREADY_EXISTS');
  const sessionDir = join(F3_ROOT, 'session');
  mkdirSync(sessionDir, { mode: 0o700 });
  let summary;
  try {
    summary = await recordSession({ sessionDir, environment: 'FORK_REPRODUCED', transcriptPath: TRANSCRIPT_PATH,
      proxyArgs: [sessionDir, manifest.billing, resolve(keyFile), String(manifest.notBeforeMs)] });
  } catch (error) { summary = error.summary ?? { status: 'STOPPED', failure: 'RECORDING_FAILED' }; }
  finally { shred(resolve(keyFile)); summary = { ...summary, credentialFileRemoved: !existsSync(resolve(keyFile)) }; }
  writePrivate(join(sessionDir, 'summary.json'), `${canonical(summary)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  if (summary.status !== 'COMPLETE') process.exitCode = 1;
}

async function dryRun() {
  const { installSyntheticBase } = await import('./offline-rehearsal.mjs');
  const anvil = process.env.GRYLOO_ANVIL_BIN ?? fail('GRYLOO_ANVIL_BIN_REQUIRED');
  const root = mkdtempSync(join(tmpdir(), 'gryloo-build003f-dry-run-'));
  const sourcePort = 18600;
  const source = spawn(anvil, ['--host', '127.0.0.1', '--port', String(sourcePort), '--chain-id', '8453', '--accounts', '0',
    '--timestamp', '1790000000', '--disable-default-create2-deployer'], { stdio: ['ignore', 'ignore', 'ignore'], env: { HOME: root, PATH: '/usr/bin:/bin' } });
  try {
    for (let i = 0; i < 200 && await probe(sourcePort) !== 'listening'; i++) await sleep(25);
    const call = (method, params = []) => rpcAt(sourcePort, method, params);
    const syntheticCodePins = await installSyntheticBase(call);
    writePrivate(join(root, 'synthetic-code-pins.json'), `${JSON.stringify(syntheticCodePins)}\n`);
    for (let i = 0; i < 100; i++) await call('evm_mine');
    const billing = join(root, 'billing.json');
    writePrivate(billing, JSON.stringify({ format: 'gryloo.build-003f-provider-billing.v1', provider: 'Alchemy', plan: 'Free', network: 'Base Mainnet',
      paymentMethod: false, paidAddOn: false, overage: false, autoUpgrade: false, credentialRotated: true, previousCredentialDeleted: true,
      rotatedOn: '2026-09-25', reportedOn: '2026-09-25', remainingMonthlyCu: RECORDING_POLICY.maxReservedCu, note: 'DRY RUN synthetic values' }));
    const sessionDir = join(root, 'session');
    mkdirSync(sessionDir, { mode: 0o700 });
    const summary = await recordSession({ sessionDir, environment: 'MOCKED', syntheticCodePins, transcriptPath: join(root, 'dry-run-transcript.json'),
      proxyArgs: [sessionDir, billing, '--dry-run-provider', String(sourcePort)] });
    process.stdout.write(`${JSON.stringify({ ...summary, dryRunRoot: root }, null, 1)}\n`);
  } finally {
    source.kill('SIGKILL');
  }
}

/** F4: closed, network-isolated replay; the results must hash to the digest the transcript binds. */
async function replayVerify() {
  const transcriptPath = resolve(process.argv[3] ?? TRANSCRIPT_PATH);
  const syntheticPins = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], 'utf8')) : null;
  const harness = await import('./harness.mjs');
  const { verifyTranscriptDocument } = await import('./replay-upstream.mjs');
  const { prepareForkFixture } = await import('./fork-setup.mjs');
  const { parseModeAProfile } = await import('../../src/server/mode-a-service.ts');
  useAccounts();
  const bytes = readFileSync(transcriptPath);
  const transcript = JSON.parse(bytes);
  const accounts = [...harness.forkDevAccounts()];
  verifyTranscriptDocument(transcript, { accounts });
  const { identityHash } = harness.transcriptIdentity({ sourceBlockNumber: transcript.sourceBlockNumber, sourceBlockHash: transcript.sourceBlockHash, accounts });
  if (identityHash !== transcript.identityHash) fail('TRANSCRIPT_IDENTITY_MISMATCH');
  const environment = syntheticPins ? 'MOCKED' : 'FORK_REPRODUCED';
  const upstream = await harness.startReplayUpstream(transcriptPath);
  let fork = null;
  const journalRoot = mkdtempSync(join(tmpdir(), 'gryloo-build003f-replay-'));
  try {
    fork = await harness.startFork({ binary: process.env.GRYLOO_ANVIL_BIN, blockNumber: transcript.sourceBlockNumber, blockHash: transcript.sourceBlockHash });
    const setup = await prepareForkFixture(transcript.sourceBlockNumber);
    const profile = parseModeAProfile({ format: 'gryloo.mode-a-fork-profile.v1', environment, rpcUrl: 'http://127.0.0.1:8545', sourceChainId: 8453,
      sourceBlockNumber: transcript.sourceBlockNumber, sourceBlockHash: transcript.sourceBlockHash, stateSourceHash: identityHash,
      owner: setup.owner, syntheticCodePins: syntheticPins });
    const results = await harness.runModeAScenarios({ call: harness.rpc, profile, journalRoot, setupAccount: setup.setup, tolerant: true });
    const text = `${canonical({ format: 'gryloo.build-003f-scenario-results.v1', environment, sourceBlockNumber: transcript.sourceBlockNumber,
      sourceBlockHash: transcript.sourceBlockHash, identityHash, setup, results })}\n`;
    const replayed = sha256(text);
    const summary = { status: replayed === transcript.scenarioResultsSha256 ? 'REPLAY_BYTE_IDENTICAL' : 'REPLAY_DIFFERS', environment,
      transcriptSha256: sha256(bytes), scenarioResultsSha256: replayed, expected: transcript.scenarioResultsSha256,
      exchanges: transcript.exchanges.length, providerRequests: transcript.counts.providerRequests, acceptanceUnmet: harness.modeAScenarioAcceptance(results),
      scenarios: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.failure ?? value.evidence.at(-1)?.outcome ?? value.observations.at(-1)?.outcome ?? 'NONE'])),
      evidenceBundles: Object.fromEntries(Object.entries(results).flatMap(([key, value]) => (value.evidence ?? []).map(item => [`${key}.v${item.version}`, item.evidenceBundleHash]))) };
    writeFileSync(join(journalRoot, 'replay-results.json'), text, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify({ ...summary, replayRoot: journalRoot }, null, 1)}\n`);
    if (summary.status !== 'REPLAY_BYTE_IDENTICAL' || summary.acceptanceUnmet.length) process.exitCode = 1;
  } finally {
    if (fork) await harness.stopFork(fork);
    await harness.stopReplayUpstream(upstream);
  }
}

/**
 * F5/G7 environment: the committed transcript served by the closed replay upstream, the pinned-account
 * fork and the identical fixture setup, published as a FORK_REPRODUCED profile for the local app.
 */
async function serveReplay() {
  const runtime = process.env.GRYLOO_MODE_A_RUNTIME;
  if (!runtime || !runtime.startsWith('/')) fail('E2E_RUNTIME_REQUIRED');
  // Dry-run rehearsal only: a private synthetic transcript and its reviewed pins may replace the committed transcript.
  const transcriptPath = resolve(process.argv[2] === 'serve-replay' && process.argv[3] ? process.argv[3] : process.env.GRYLOO_MODE_A_TRANSCRIPT ?? TRANSCRIPT_PATH);
  const pinsPath = process.argv[2] === 'serve-replay' && process.argv[4] ? process.argv[4] : process.env.GRYLOO_MODE_A_SYNTHETIC_PINS;
  const syntheticPins = pinsPath ? JSON.parse(readFileSync(pinsPath, 'utf8')) : null;
  const harness = await import('./harness.mjs');
  const { verifyTranscriptDocument } = await import('./replay-upstream.mjs');
  const { prepareForkFixture } = await import('./fork-setup.mjs');
  const { serveHealth } = await import('./offline-rehearsal.mjs');
  const { holdUntilSignal } = await import('./offline-rehearsal.mjs');
  const { rmSync } = await import('node:fs');
  useAccounts();
  const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
  const accounts = [...harness.forkDevAccounts()];
  verifyTranscriptDocument(transcript, { accounts });
  const { identityHash } = harness.transcriptIdentity({ sourceBlockNumber: transcript.sourceBlockNumber, sourceBlockHash: transcript.sourceBlockHash, accounts });
  if (identityHash !== transcript.identityHash) fail('TRANSCRIPT_IDENTITY_MISMATCH');
  rmSync(runtime, { recursive: true, force: true });
  mkdirSync(join(runtime, 'journal'), { recursive: true, mode: 0o700 });
  const upstream = await harness.startReplayUpstream(transcriptPath);
  const fork = await harness.startFork({ binary: process.env.GRYLOO_ANVIL_BIN, blockNumber: transcript.sourceBlockNumber, blockHash: transcript.sourceBlockHash });
  const setup = await prepareForkFixture(transcript.sourceBlockNumber);
  const baseline = await harness.rpc('evm_snapshot');
  const environment = syntheticPins ? 'MOCKED' : 'FORK_REPRODUCED';
  const profile = { format: 'gryloo.mode-a-fork-profile.v1', environment, rpcUrl: 'http://127.0.0.1:8545', sourceChainId: 8453,
    sourceBlockNumber: transcript.sourceBlockNumber, sourceBlockHash: transcript.sourceBlockHash, stateSourceHash: identityHash,
    owner: setup.owner, syntheticCodePins: syntheticPins };
  writeFileSync(join(runtime, 'profile.json'), `${JSON.stringify(profile)}\n`, { mode: 0o600 });
  writeFileSync(join(runtime, 'fixture.json'), `${JSON.stringify({ format: 'gryloo.mode-a-e2e-fixture.v1', environment, rpcUrl: profile.rpcUrl,
    owner: setup.owner, setup: setup.setup, baseline, journal: join(runtime, 'journal'), transcriptSha256: sha256(readFileSync(transcriptPath)) })}\n`, { mode: 0o600 });
  const health = await serveHealth();
  const stop = async () => { health.close(); await harness.stopFork(fork); await harness.stopReplayUpstream(upstream); };
  if (process.argv[2] === 'serve-replay') holdUntilSignal(stop);
  process.stdout.write(`MODE_A_REPLAY_FORK_READY ${environment}\n`);
  return { stop, profile };
}

/** G7: the replayed fork plus the production app with the explicit local-fork opt-in, both on loopback. */
async function g7Session() {
  const runtime = process.env.GRYLOO_MODE_A_RUNTIME ?? join(HOME_ROOT, 'g7-runtime');
  process.env.GRYLOO_MODE_A_RUNTIME = runtime;
  const { holdUntilSignal } = await import('./offline-rehearsal.mjs');
  const served = await serveReplay();
  const app = join(REPO, 'apps/reference-dapp');
  const next = spawn(NODE, [join(app, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3000'], { cwd: app,
    stdio: ['ignore', 'ignore', 'inherit'], env: { HOME: HOME_ROOT, PATH: '/usr/bin:/bin', NEXT_TELEMETRY_DISABLED: '1', GRYLOO_BASE_OBSERVATION: 'off',
      GRYLOO_MODE_A: 'fork', GRYLOO_MODE_A_PROFILE: join(runtime, 'profile.json'), GRYLOO_MODE_A_JOURNAL: join(runtime, 'journal') } });
  holdUntilSignal(async () => { next.kill('SIGTERM'); await served.stop(); });
  process.stdout.write(`${JSON.stringify({ status: 'G7_SESSION_READY', app: 'http://127.0.0.1:3000', walletNetwork: { name: 'Gryloo local fork',
    rpcUrl: 'http://127.0.0.1:8545', chainId: 31337, currencySymbol: 'ETH' }, owner: served.profile.owner, environment: served.profile.environment,
    runtime, stop: 'Ctrl-C' }, null, 1)}\n`);
}

const modes = { preflight, record, 'dry-run': dryRun, 'replay-verify': replayVerify, 'serve-replay': serveReplay, 'g7-session': g7Session };
const mode = modes[process.argv[2]];
if (!mode) { process.stderr.write('USAGE: owner-recording.mjs preflight | record <manifest-digest> | dry-run | replay-verify [transcript] [synthetic-pins] | serve-replay [transcript] [synthetic-pins] | g7-session\n'); process.exit(2); }
mode().catch(error => {
  process.stderr.write(`${String(error?.message ?? 'FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 200)}\n`);
  if (error?.summary) process.stdout.write(`${JSON.stringify(error.summary, null, 1)}\n`);
  process.exitCode = 1;
});

// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Local-only Mode B harness on chain 31337.
 *
 * `serve`: the certified closed BUILD-003F replay (unmodified handler, alternate loopback port) behind an Anvil fork,
 * local-only accounts declared explicitly, pinned Safe 1.4.1 and Roles 2.1.0 deployed by real transactions, and exactly
 * the three owner-approved LOCAL_SETUP token slots keyed by the new Safe. No upstream answer is ever synthesized: a read
 * the transcript lacks fails. Writes a profile and a mode-0600 disposable key file, and stays up until signalled.
 *
 * Default / `--once`: the browser-independent worker for an existing profile and key file.
 */
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';
import { FORK_CONTRACTS, SWAP_ROUTER_02, forkAnvilArgs } from '../../../../packages/reference-compiler/dist/index.js';
import { probePort, validateAnvilBinary } from './harness.mjs';
import { createReplayServer } from './replay-upstream.mjs';

const executorRequire = createRequire(new URL('../../../../packages/reference-executor/package.json', import.meta.url));
const { secp256k1 } = await import(executorRequire.resolve('@noble/curves/secp256k1.js'));
const { keccak_256 } = await import(executorRequire.resolve('@noble/hashes/sha3.js'));

/** Digest pins for the certified transcript and the official artifacts supplied outside Git as test-time inputs. */
export const MODE_B_PINS = Object.freeze({
  transcriptSha256: 'c9a02102422df5a333d67bdf869a4f1b75ae2ec314d1e834872d92c86ea95805',
  safeL2ArtifactSha256: 'a57d54c0d757ca7fb86693480797de69c880878690b67061f6f9624e11def8bd',
  safeProxyArtifactSha256: 'b05eaeaf7278097e52a9e9b38410de2a812c23fa3622373473e73eaa19646ecd',
  rolesMastercopiesSha256: 'a80d737a2b5394897fad0aa290b129bc446fdb1736efc3e1ad06edcd2d8ea224',
  // The 340-byte init code published in ERC-2470 (byte-identical to the specification's deployment data).
  eip2470InitCodeSha256: 'dae33ba7a8745a325d78fd9dbf4585b47524070f5c8b73c84bf373e91a24fff6',
  // Roles 2.1.0 creation bytecode embeds these official addresses; each is re-linked to a local deployment.
  rolesLinkedIntegrity: '6a6af4b16458bc39817e4019fb02bd3b26d41049',
  rolesLinkedPacker: '61c5b1be435391fdd7bc6703f3740c0d11728a8c',
  rolesLinkedSingletonFactory: 'ce0042b868300000d44a59004da54a005ffdcf9f',
});
/** Mode A's synthetic E2E servers own 8545-8547, so the Mode B fork runs beside them. */
export const MODE_B_PORTS = Object.freeze({ fork: 18545, replay: 18546, anvil: 18547 });
const SCOPE_FUNCTION_SELECTOR = '7508dd98'; // scopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)
const PACKER_PACK_SELECTOR = '806362d2'; // library selector pack(ConditionFlat[])
export const MODE_B_READY_LINE = 'MODE_B_FORK_READY';
/** Owner decision 2026-09-27: WETH funding backed by equal ETH on WETH, zero Router02 allowance, zero USDC. */
export const MODE_B_SAFE_WETH_FUNDING = 0n;
const WETH_BALANCE_INDEX = 3n;
const WETH_ALLOWANCE_INDEX = 4n;
const USDC_BALANCE_INDEX = 9n;
const USDC_ALLOWANCE_INDEX = 10n;

const hex = bytes => '0x' + Buffer.from(bytes).toString('hex');
const unhex = value => Uint8Array.from(Buffer.from(value.replace(/^0x/, ''), 'hex'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const keccak = value => hex(keccak_256(typeof value === 'string' ? unhex(value) : value));
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const addressOf = secret => hex(keccak_256(secp256k1.getPublicKey(secret, false).subarray(1)).subarray(12));
/** CREATE address for a local deployer with a single-byte-or-zero RLP nonce (the harness uses nonces 0-5). */
export function createAddress(deployer, nonce) {
  if (!Number.isInteger(nonce) || nonce < 0 || nonce > 0x7f) throw new Error('MODE_B_NONCE_UNSUPPORTED');
  const encodedNonce = nonce === 0 ? '80' : nonce.toString(16).padStart(2, '0');
  return '0x' + keccak('0xd694' + deployer.slice(2) + encodedNonce).slice(-40);
}
export const mappingSlot = (key, index) => keccak('0x' + addressWord(key) + word(index));
export const nestedMappingSlot = (outer, inner, index) => keccak('0x' + addressWord(inner) + mappingSlot(outer, index).slice(2));
export const MODE_B_LOCAL_DEPLOYER = '0x' + keccak(new TextEncoder().encode('gryloo/build-004/local-deployer')).slice(-40);

function requireFile(path, pin, code) {
  if (!path || !isAbsolute(path)) throw new Error(code);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== pin) throw new Error(code);
  return bytes;
}
function artifacts() {
  const safePackage = process.env.GRYLOO_MODE_B_SAFE_PACKAGE;
  if (!safePackage || !isAbsolute(safePackage)) throw new Error('MODE_B_SAFE_PACKAGE_REQUIRED');
  const safeL2 = JSON.parse(requireFile(join(safePackage, 'build/artifacts/contracts/SafeL2.sol/SafeL2.json'),
    MODE_B_PINS.safeL2ArtifactSha256, 'MODE_B_SAFE_ARTIFACT_PIN_MISMATCH'));
  const safeProxy = JSON.parse(requireFile(join(safePackage, 'build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json'),
    MODE_B_PINS.safeProxyArtifactSha256, 'MODE_B_SAFE_ARTIFACT_PIN_MISMATCH'));
  const mastercopies = JSON.parse(requireFile(process.env.GRYLOO_MODE_B_ROLES_MASTERCOPIES,
    MODE_B_PINS.rolesMastercopiesSha256, 'MODE_B_ROLES_ARTIFACT_PIN_MISMATCH'));
  const pick = name => mastercopies[name]?.['2.1.0']?.bytecode ?? (() => { throw new Error('MODE_B_ROLES_ARTIFACT_INVALID'); })();
  const eip2470 = requireFile(process.env.GRYLOO_MODE_B_EIP2470_INITCODE, MODE_B_PINS.eip2470InitCodeSha256, 'MODE_B_EIP2470_PIN_MISMATCH');
  return { safeL2: safeL2.bytecode, safeProxy: safeProxy.bytecode, integrity: pick('Integrity'), packer: pick('Packer'), roles: pick('Roles'),
    singletonFactory: hex(eip2470) };
}
/** Replace the pinned official addresses by local deployments, checking each expected occurrence count, as a linker would. */
export function relinkRoles(bytecode, { integrity, packer, singletonFactory }) {
  let code = bytecode.toLowerCase();
  for (const [from, to, count] of [[MODE_B_PINS.rolesLinkedIntegrity, integrity, 1], [MODE_B_PINS.rolesLinkedPacker, packer, 1],
    [MODE_B_PINS.rolesLinkedSingletonFactory, singletonFactory, 2]]) {
    if (code.split(from).length !== count + 1) throw new Error('MODE_B_ROLES_LINK_INVALID');
    code = code.split(from).join(to.toLowerCase().slice(2));
  }
  return code;
}
/** Roles WriteOnce pointer for a packed condition buffer: CREATE2(factory, salt 0, creationBytecodeFor(buffer)). */
export function writeOncePointer(factory, buffer) {
  const data = buffer.replace(/^0x/, '');
  const creation = '0x63' + (data.length / 2 + 1).toString(16).padStart(8, '0') + '80600e6000396000f3' + '00' + data;
  return '0x' + keccak('0xff' + factory.slice(2) + '0'.repeat(64) + keccak(creation).slice(2)).slice(-40);
}
/** Every `scopeFunction` payload embedded in a request, as Packer.pack calldata over its exact condition array. */
export function scopeFunctionPackCalls(value) {
  const found = [];
  const visit = item => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
    else if (typeof item === 'string' && /^0x[0-9a-fA-F]+$/.test(item)) {
      const text = item.slice(2).toLowerCase();
      for (let at = text.indexOf(SCOPE_FUNCTION_SELECTOR); at >= 0; at = text.indexOf(SCOPE_FUNCTION_SELECTOR, at + 2)) {
        if (at % 2) continue;
        const args = text.slice(at + 8);
        if (args.length < 320) continue;
        const offset = BigInt('0x' + args.slice(192, 256));
        if (offset > BigInt(args.length / 2)) continue;
        found.push('0x' + PACKER_PACK_SELECTOR + word(32) + args.slice(Number(offset) * 2));
      }
    }
  };
  visit(value);
  return found;
}

async function serve() {
  const anvilBinary = process.env.GRYLOO_ANVIL_BIN;
  const runtime = process.env.GRYLOO_MODE_B_RUNTIME;
  if (!anvilBinary || !runtime || !isAbsolute(runtime) || !runtime.startsWith('/tmp/')) throw new Error('MODE_B_SERVE_CONFIGURATION_INVALID');
  validateAnvilBinary(anvilBinary);
  const code = artifacts();
  const livePort = process.env.GRYLOO_COMPOSITION_RECORDING_PROXY_PORT;
  const live = livePort !== undefined;
  if (live && (!/^[1-9][0-9]{0,4}$/.test(livePort) || Number(livePort) > 65535))
    throw new Error('COMPOSITION_PROXY_PORT_INVALID');
  const sourceBlockNumber = live ? Number(process.env.GRYLOO_COMPOSITION_SOURCE_BLOCK_NUMBER) : 0;
  const sourceBlockHash = live ? process.env.GRYLOO_COMPOSITION_SOURCE_BLOCK_HASH : null;
  if (live && (!Number.isSafeInteger(sourceBlockNumber) || sourceBlockNumber < 1 ||
      !/^0x[0-9a-f]{64}$/.test(sourceBlockHash))) throw new Error('COMPOSITION_SOURCE_BLOCK_INVALID');
  let transcript = null, transcriptSha256 = null;
  if (!live) {
    const path = process.env.GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_PATH ??
      fileURLToPath(new URL('./composition-transcript.json', import.meta.url));
    const expected = process.env.GRYLOO_COMPOSITION_INTERIM_TRANSCRIPT_SHA256 ?? MODE_B_PINS.transcriptSha256;
    const transcriptBytes = readFileSync(path);
    if (sha256(transcriptBytes) !== expected) throw new Error('COMPOSITION_TRANSCRIPT_PIN_MISMATCH');
    transcriptSha256 = expected;
    transcript = JSON.parse(transcriptBytes);
  }
  for (const port of Object.values(MODE_B_PORTS)) if (await probePort(port) !== 'free') throw new Error(`MODE_B_PORT_OCCUPIED:${port}`);

  const front = live ? createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const upstream = await globalThis.fetch(`http://127.0.0.1:${livePort}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: Buffer.concat(chunks),
      signal: globalThis.AbortSignal.timeout(35_000) }).catch(() => null);
    if (!upstream) { response.writeHead(502); response.end(); return; }
    response.writeHead(upstream.status, { 'content-type': 'application/json' });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  }) : (() => {
    const replay = createReplayServer(transcript);
    return createHttpServer((request, response) => { request.headers.host = '127.0.0.1:8546'; replay.emit('request', request, response); });
  })();
  await new Promise((done, fail) => { front.once('error', fail); front.listen(MODE_B_PORTS.replay, '127.0.0.1', done); });

  // Pinned fork arguments; `--accounts 0` because Anvil's default dev accounts are unrecorded Base addresses.
  const args = [...forkAnvilArgs({ port: MODE_B_PORTS.anvil, forkUrl: `http://127.0.0.1:${MODE_B_PORTS.replay}`,
    forkBlockNumber: live ? sourceBlockNumber : transcript.sourceBlockNumber, timeoutMs: 20_000 })];
  args[args.indexOf('--accounts') + 1] = '0';
  const anvil = spawn(anvilBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let anvilOutput = '';
  anvil.stdout.on('data', chunk => { anvilOutput = (anvilOutput + chunk).slice(-4096); });
  anvil.stderr.on('data', chunk => { anvilOutput = (anvilOutput + chunk).slice(-4096); });
  const keyPath = join(runtime, 'mode-b-keys.json');
  let lineageFront = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    anvil.kill('SIGKILL'); front.close(); lineageFront?.close(); rmSync(keyPath, { force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(0); });
  try {
    for (let i = 0; i < 150 && !anvilOutput.includes('Listening on'); i++) {
      if (anvil.exitCode !== null) break;
      await sleep(100);
    }
    if (!anvilOutput.includes('Listening on')) throw new Error('MODE_B_ANVIL_START_FAILED');
    let id = 0;
    const rpc = async (method, params = []) => {
      const response = await globalThis.fetch(`http://127.0.0.1:${MODE_B_PORTS.anvil}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: globalThis.AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (!response.ok || body.error || !('result' in body)) throw new Error(`MODE_B_SETUP_RPC_${method}:${String(body.error?.message ?? response.status).slice(0, 200)}`);
      return body.result;
    };
    if (await rpc('eth_chainId') !== '0x7a69') throw new Error('MODE_B_CHAIN_INVALID');
    const metadata = await rpc('anvil_metadata');
    if (metadata?.forkedNetwork?.forkBlockHash !== (live ? sourceBlockHash : transcript.sourceBlockHash)) throw new Error('MODE_B_FORK_METADATA_INVALID');
    // Local blocks advance by one fixed second across recording and replay, independent of host wall time.
    await rpc('anvil_setBlockTimestampInterval', [1]);

    // Local-only accounts: disposable owner and executor keys, an impersonated deployer, and its CREATE targets.
    // Owner acceptance: GRYLOO_MODE_B_OWNER_ADDRESS names a disposable account held only in the owner's injected wallet,
    // so no owner key exists here. Otherwise a disposable test key is generated for the automated specs.
    const walletOwner = process.env.GRYLOO_MODE_B_OWNER_ADDRESS;
    if (walletOwner !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(walletOwner)) throw new Error('MODE_B_OWNER_ADDRESS_INVALID');
    const inputKeys = process.env.GRYLOO_COMPOSITION_KEYS_INPUT;
    let supplied = null;
    if (inputKeys) {
      if (!isAbsolute(inputKeys) || (statSync(inputKeys).mode & 0o077) !== 0) throw new Error('COMPOSITION_KEYS_FILE_INVALID');
      supplied = JSON.parse(readFileSync(inputKeys, 'utf8'));
      if (!/^0x[0-9a-fA-F]{64}$/.test(supplied?.owner) || !/^0x[0-9a-fA-F]{64}$/.test(supplied?.executor))
        throw new Error('COMPOSITION_KEYS_FILE_INVALID');
    }
    const ownerKey = walletOwner ? null : supplied ? unhex(supplied.owner) : secp256k1.utils.randomSecretKey();
    const executorKey = supplied ? unhex(supplied.executor) : secp256k1.utils.randomSecretKey();
    const owner = walletOwner ? walletOwner.toLowerCase() : addressOf(ownerKey);
    const executor = addressOf(executorKey);
    const deployer = MODE_B_LOCAL_DEPLOYER;
    const targets = { safeSingleton: createAddress(deployer, 0), safe: createAddress(deployer, 1), singletonFactory: createAddress(deployer, 2),
      integrity: createAddress(deployer, 3), packer: createAddress(deployer, 4), roles: createAddress(deployer, 5) };
    const empty = { nonce: 0, balance: '0x0', code: '0x', storage: {} };
    const localAccounts = {
      [deployer]: { ...empty, balance: '0x56bc75e2d63100000' },
      [owner]: { ...empty, balance: '0x56bc75e2d63100000' },
      [executor]: { ...empty, balance: '0x8ac7230489e80000' },
      ...Object.fromEntries(Object.values(targets).map(address => [address, empty])),
    };
    await rpc('anvil_loadState', [hex(new TextEncoder().encode(JSON.stringify({ block: null, accounts: localAccounts,
      best_block_number: null, blocks: [], transactions: [] })))]);

    await rpc('anvil_impersonateAccount', [deployer]);
    const send = async (label, tx, expectedContract) => {
      const hash = await rpc('eth_sendTransaction', [{ from: deployer, gas: '0xe4e1c0', value: '0x0', ...tx }]);
      for (let attempt = 0; attempt < 50; attempt++) {
        const receipt = await rpc('eth_getTransactionReceipt', [hash]);
        if (receipt) {
          if (receipt.status !== '0x1') throw new Error(`MODE_B_SETUP_REVERTED:${label}`);
          if (expectedContract && receipt.contractAddress?.toLowerCase() !== expectedContract) throw new Error(`MODE_B_SETUP_ADDRESS:${label}`);
          return receipt;
        }
        await sleep(100);
      }
      throw new Error(`MODE_B_SETUP_UNCONFIRMED:${label}`);
    };
    await send('SAFE_SINGLETON', { data: code.safeL2 }, targets.safeSingleton);
    await send('SAFE_PROXY', { data: code.safeProxy + addressWord(targets.safeSingleton) }, targets.safe);
    await send('ERC2470_SINGLETON_FACTORY', { data: code.singletonFactory }, targets.singletonFactory);
    await send('ROLES_INTEGRITY', { data: code.integrity }, targets.integrity);
    await send('ROLES_PACKER', { data: code.packer }, targets.packer);
    await send('ROLES', { data: relinkRoles(code.roles, targets)
      + addressWord(targets.safe) + addressWord(targets.safe) + addressWord(targets.safe) }, targets.roles);
    // Safe.setup([owner], 1, 0x0, 0x, 0x0, 0x0, 0, 0x0)
    await send('SAFE_SETUP', { to: targets.safe, data: '0xb63e800d' + word(0x100) + word(1) + word(0) + word(0x140) + word(0) + word(0)
      + word(0) + word(0) + word(1) + addressWord(owner) + word(0) });
    await rpc('anvil_stopImpersonatingAccount', [deployer]);

    const call = async (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
    const owners = await call(targets.safe, '0xa0e67e2b');
    if (BigInt(await call(targets.safe, '0xe75235b8')) !== 1n || BigInt('0x' + owners.slice(66, 130)) !== 1n
      || '0x' + owners.slice(-40) !== owner) throw new Error('MODE_B_SAFE_SETUP_INVALID');
    for (const selector of ['0x8da5cb5b', '0x5aef7de6', '0xd4b83992']) {
      if ('0x' + (await call(targets.roles, selector)).slice(-40) !== targets.safe) throw new Error('MODE_B_ROLES_SETUP_INVALID');
    }

    // LOCAL_SETUP: the only Base-contract storage written by this harness, keyed by the new local Safe.
    const synthetic = process.env.GRYLOO_COMPOSITION_ENVIRONMENT === 'MOCKED';
    const wethBalanceIndex = synthetic ? 0n : WETH_BALANCE_INDEX;
    const wethAllowanceIndex = synthetic ? 1n : WETH_ALLOWANCE_INDEX;
    const usdcBalanceIndex = synthetic ? 0n : USDC_BALANCE_INDEX;
    const usdcAllowanceIndex = synthetic ? 1n : USDC_ALLOWANCE_INDEX;
    const localSetup = [
      { purpose: 'SAFE_WETH_FUNDING', contract: FORK_CONTRACTS.weth, slot: mappingSlot(targets.safe, wethBalanceIndex), value: MODE_B_SAFE_WETH_FUNDING },
      { purpose: 'SAFE_WETH_ROUTER_ALLOWANCE_ZERO', contract: FORK_CONTRACTS.weth,
        slot: nestedMappingSlot(targets.safe, SWAP_ROUTER_02, wethAllowanceIndex), value: 0n },
      { purpose: 'SAFE_USDC_FUNDING', contract: FORK_CONTRACTS.usdc, slot: mappingSlot(targets.safe, usdcBalanceIndex), value: 1_000_000_000n },
      { purpose: 'SAFE_USDC_ROUTER_ALLOWANCE_ZERO', contract: FORK_CONTRACTS.usdc, slot: nestedMappingSlot(targets.safe, SWAP_ROUTER_02, usdcAllowanceIndex), value: 0n },
      { purpose: 'SAFE_USDC_MANAGER_ALLOWANCE_ZERO', contract: FORK_CONTRACTS.usdc, slot: nestedMappingSlot(targets.safe, '0x03a520b32c04bf3beef7beb72e919cf822ed34f1', usdcAllowanceIndex), value: 0n },
      { purpose: 'SAFE_WETH_MANAGER_ALLOWANCE_ZERO', contract: FORK_CONTRACTS.weth, slot: nestedMappingSlot(targets.safe, '0x03a520b32c04bf3beef7beb72e919cf822ed34f1', wethAllowanceIndex), value: 0n },
    ];
    for (const write of localSetup) await rpc('anvil_setStorageAt', [write.contract, write.slot, '0x' + word(write.value)]);
    const wethEth = BigInt(await rpc('eth_getBalance', [FORK_CONTRACTS.weth, 'latest']));
    await rpc('anvil_setBalance', [FORK_CONTRACTS.weth, '0x' + (wethEth + MODE_B_SAFE_WETH_FUNDING).toString(16)]);
    // Each read succeeds only if exactly the written slot is consulted: any other slot is unrecorded and fails closed.
    if (BigInt(await call(FORK_CONTRACTS.weth, '0x70a08231' + addressWord(targets.safe))) !== MODE_B_SAFE_WETH_FUNDING
      || BigInt(await call(FORK_CONTRACTS.weth, '0xdd62ed3e' + addressWord(targets.safe) + addressWord(SWAP_ROUTER_02))) !== 0n
      || BigInt(await call(FORK_CONTRACTS.usdc, '0x70a08231' + addressWord(targets.safe))) !== 1_000_000_000n) throw new Error('MODE_B_LOCAL_SETUP_INVALID');

    // The front forwards every request and response verbatim. Before forwarding, it declares a Roles WriteOnce pointer as a
    // local-only empty account only when the pointer is derived exactly from a scopeFunction payload through the local Packer
    // and the local ERC-2470 factory: such a CREATE2 descendant of a local-only factory cannot have Base state.
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const lineageLog = join(runtime, 'lineage-declarations.jsonl');
    writeFileSync(lineageLog, '', { mode: 0o600 });
    let lineageLock = Promise.resolve();
    const declareLineage = async body => {
      for (const packCall of scopeFunctionPackCalls(body.params ?? [])) {
        let buffer;
        try { buffer = await rpc('eth_call', [{ to: targets.packer, data: packCall }, 'latest']); } catch { continue; }
        const length = Number(BigInt('0x' + buffer.slice(66, 130)));
        const pointer = writeOncePointer(targets.singletonFactory, '0x' + buffer.slice(130, 130 + length * 2));
        try { await rpc('eth_getCode', [pointer, 'latest']); continue; } catch (error) {
          if (!/failed to get account/.test(error.message)) throw error;
        }
        await rpc('anvil_loadState', [hex(new TextEncoder().encode(JSON.stringify({ block: null, accounts: { [pointer]: empty },
          best_block_number: null, blocks: [], transactions: [] })))]);
        writeFileSync(lineageLog, JSON.stringify({ pointer, factory: targets.singletonFactory, packedLength: length,
          method: body.method, label: 'LOCAL_LINEAGE_CREATE2_DERIVED' }) + '\n', { flag: 'a' });
      }
    };
    lineageFront = createHttpServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      try {
        const parsed = JSON.parse(raw.toString('utf8'));
        const run = lineageLock.then(() => Promise.all((Array.isArray(parsed) ? parsed : [parsed]).map(declareLineage)));
        lineageLock = run.catch(() => undefined);
        await run;
      } catch { /* malformed or undeclarable input is forwarded unchanged and fails at Anvil */ }
      const upstream = await globalThis.fetch(`http://127.0.0.1:${MODE_B_PORTS.anvil}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: raw }).catch(() => null);
      if (!upstream) { response.writeHead(502); response.end(); return; }
      response.writeHead(upstream.status, { 'content-type': 'application/json' });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    });
    await new Promise((done, fail) => { lineageFront.once('error', fail); lineageFront.listen(MODE_B_PORTS.fork, '127.0.0.1', done); });

    const codeHash = async address => keccak(await rpc('eth_getCode', [address, 'latest']));
    const journalDir = join(runtime, 'journal');
    rmSync(journalDir, { recursive: true, force: true });
    mkdirSync(journalDir, { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, JSON.stringify(ownerKey ? { owner: hex(ownerKey), executor: hex(executorKey) } : { executor: hex(executorKey) }),
      { mode: 0o600, flag: 'w' });
    chmodSync(keyPath, 0o600);
    ownerKey?.fill(0); executorKey.fill(0);
    const poolRaw = await call('0x33128a8fc17869897dce68ed026d694621f6fdfd',
      '0x1698ee82' + addressWord(FORK_CONTRACTS.weth) + addressWord(FORK_CONTRACTS.usdc) + word(500n));
    const pool = '0x' + poolRaw.slice(-40);
    const shaCode = async address => '0x' + sha256(unhex(await rpc('eth_getCode', [address, 'latest'])));
    const liquidity = { pool, fee: 500, poolCodeHash: await shaCode(pool),
      managerCodeHash: await shaCode('0x03a520b32c04bf3beef7beb72e919cf822ed34f1'),
      factoryCodeHash: await shaCode('0x33128a8fc17869897dce68ed026d694621f6fdfd'),
      usdcCodeHash: await shaCode(FORK_CONTRACTS.usdc), wethCodeHash: await shaCode(FORK_CONTRACTS.weth),
      routerCodeHash: await shaCode(FORK_CONTRACTS.router), quoterCodeHash: await shaCode(FORK_CONTRACTS.quoter) };
    const syntheticPinsPath = process.env.GRYLOO_COMPOSITION_SYNTHETIC_PINS_FILE;
    const syntheticCodePins = syntheticPinsPath ? JSON.parse(readFileSync(syntheticPinsPath, 'utf8')) : undefined;
    const profile = {
      format: 'gryloo.mode-b-fork-profile.v1', environment: process.env.GRYLOO_COMPOSITION_ENVIRONMENT === 'MOCKED' ? 'MOCKED' : 'FORK_REPRODUCED', rpcUrl: `http://127.0.0.1:${MODE_B_PORTS.fork}`,
      sourceChainId: 8453, sourceBlockNumber: live ? sourceBlockNumber : transcript.sourceBlockNumber,
      sourceBlockHash: live ? sourceBlockHash : transcript.sourceBlockHash, chainId: 31337,
      safe: targets.safe, roles: targets.roles, owner, executor, liquidity, syntheticCodePins,
      safeCodeHash: await codeHash(targets.safe), rolesCodeHash: await codeHash(targets.roles), journalDir,
      provenance: {
        upstream: live ? (process.env.GRYLOO_COMPOSITION_ENVIRONMENT === 'MOCKED' ? 'SYNTHETIC_RECORDING_PROXY' : 'BOUNDED_BASE_RECORDING_PROXY') : 'CLOSED_REPLAY_ONLY',
        transcriptSha256,
        localOnlyAccounts: Object.keys(localAccounts), deployer, contracts: targets, lineageDeclarations: lineageLog,
        rolesRelinked: { integrity: targets.integrity, packer: targets.packer, singletonFactory: targets.singletonFactory },
        safeSingletonCodeHash: await codeHash(targets.safeSingleton),
        ownerSigner: ownerKey ? 'DISPOSABLE_TEST_KEY' : 'OWNER_INJECTED_WALLET',
        localSetup: localSetup.map(write => ({ ...write, value: write.value.toString(), label: 'LOCAL_SETUP_NOT_BASE_OBSERVED' })),
        wethBackingAdded: MODE_B_SAFE_WETH_FUNDING.toString(),
      },
    };
    const profilePath = join(runtime, 'profile.json');
    writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(`${MODE_B_READY_LINE} ${profilePath} ${keyPath}\n`);
    await new Promise(done => anvil.once('exit', done));
    throw new Error('MODE_B_ANVIL_EXITED');
  } catch (error) {
    stop();
    throw error;
  }
}

async function worker() {
  const { createServer } = await import('vite');
  const profilePath = process.env.GRYLOO_MODE_B_PROFILE;
  const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
  if (!profilePath || !keyPath || !isAbsolute(profilePath) || !isAbsolute(keyPath) || !keyPath.startsWith('/tmp/'))
    throw new Error('MODE_B_WORKER_CONFIGURATION_INVALID');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  if (profile.chainId !== 31337 || profile.environment !== 'FORK_REPRODUCED' ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.rpcUrl)) throw new Error('MODE_B_WORKER_PROFILE_INVALID');
  const repo = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const vite = await createServer({ root: repo, configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { createModeBService } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/mode-b-service.ts');
    const { createForkRpc } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/fork-rpc.ts');
    const service = createModeBService(profile, createForkRpc({ url: profile.rpcUrl }));
    await service.boundary();
    const tick = async () => {
      for (const { executionId } of await service.list()) {
        const state = await service.status(executionId);
        const prepared = state.prepared;
        if (prepared.reconciliation || prepared.revocation.length ||
          prepared.installation.length !== prepared.compiled.installation.length - prepared.installationStart) continue;
        const event = await service.worker(executionId, keyPath);
        if (event.state === 'CONFIRMED') {
          const evidence = await service.reconcile(executionId);
          process.stdout.write(`${executionId} ${evidence.outcome}\n`);
        } else if (event.state === 'INCONCLUSIVE' || event.state === 'REVERTED') {
          process.stdout.write(`${executionId} ${event.state}\n`);
        }
      }
    };
    if (process.argv.includes('--once')) await tick();
    else {
      process.stdout.write(`MODE_B_WORKER_READY ${profile.rpcUrl}\n`);
      while (true) {
        try { await tick(); } catch (error) {
          const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : 'MODE_B_WORKER_ERROR';
          process.stderr.write(`${code}\n`);
        }
        await sleep(1000);
      }
    }
  } finally { await vite.close(); }
}

/** Fresh-process fixed composition worker. Each invocation observes a durable journal; no browser is needed. */
async function compositionWorkerOnce() {
  const { createServer } = await import('vite');
  const profilePath = process.env.GRYLOO_COMPOSITION_PROFILE;
  const keyPath = process.env.GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE;
  if (!profilePath || !keyPath || !isAbsolute(profilePath) || !isAbsolute(keyPath) || !keyPath.startsWith('/tmp/'))
    throw new Error('COMPOSITION_WORKER_CONFIGURATION_INVALID');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  if (profile.chainId !== 31337 || !['MOCKED', 'FORK_REPRODUCED'].includes(profile.environment) ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.rpcUrl)) throw new Error('COMPOSITION_WORKER_PROFILE_INVALID');
  const repo = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const vite = await createServer({ root: repo, configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { createCompositionService } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/composition-service.ts');
    const { createForkRpc } = await vite.ssrLoadModule('/apps/reference-dapp/src/server/fork-rpc.ts');
    const service = createCompositionService(profile, createForkRpc({ url: profile.rpcUrl }));
    for (const { executionId } of await service.list()) {
      const status = await service.status(executionId);
      if (status.prepared.revocation.length || status.prepared.installation.length !== status.prepared.compiled.installation.length)
        continue;
      const event = await service.worker(executionId, keyPath);
      process.stdout.write(`${executionId} ${event.step} ${event.state}\n`);
    }
  } finally { await vite.close(); }
}

/**
 * Owner-session verifier. It reads no key. It re-reads every recorded owner and executor transaction from the fork and
 * requires the exact signer, target and calldata, one executor send, RECONCILED and confirmed revocation.
 *   node mode-b-harness.mjs verify --wallet "<name version>" --browser "<name version>"
 */
async function verify() {
  const { decodeModeBSignedTransaction } = await import('../../../../packages/reference-reconciler/dist/index.js');
  const label = name => {
    const at = process.argv.indexOf(name);
    const value = at > 0 ? process.argv[at + 1] : undefined;
    return typeof value === 'string' && /^[A-Za-z0-9 ._()/+-]{2,80}$/.test(value) ? value : null;
  };
  const profilePath = process.env.GRYLOO_MODE_B_PROFILE;
  if (!profilePath || !isAbsolute(profilePath)) throw new Error('MODE_B_VERIFY_CONFIGURATION_INVALID');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  let id = 0;
  const rpc = async (method, params = []) => {
    const response = await globalThis.fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: globalThis.AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (body.error || !('result' in body)) throw new Error(`MODE_B_VERIFY_RPC_${method}`);
    return body.result;
  };
  const executions = readdirSync(profile.journalDir).filter(name => /^exec-[0-9a-f]{24}$/.test(name));
  const findings = [];
  const check = (ok, text) => { if (!ok) findings.push(text); };
  check(executions.length === 1, `expected exactly one execution, found ${executions.length}`);
  const executionId = executions[0];
  const prepared = JSON.parse(readFileSync(join(profile.journalDir, executionId, 'prepared.json'), 'utf8'));
  const events = readFileSync(join(profile.journalDir, executionId, 'worker.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const transactions = [];
  const inspect = async (role, hash, signer, expected) => {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    const raw = await rpc('eth_getRawTransactionByHash', [hash]);
    const decoded = decodeModeBSignedTransaction(unhex(raw), hash);
    const exact = receipt?.status === '0x1' && decoded.signer.toLowerCase() === signer
      && decoded.to.toLowerCase() === expected.to.toLowerCase() && decoded.data.toLowerCase() === expected.data.toLowerCase();
    check(exact, `${role} ${hash} is not the exact reviewed transaction by ${signer}`);
    transactions.push({ role, label: expected.label ?? 'executor call', hash, signer: decoded.signer.toLowerCase(), nonce: decoded.nonce.toString(),
      maxPriorityFeePerGas: decoded.maxPriorityFeePerGas.toString(), exact });
  };
  check(prepared.installation.length === prepared.compiled.installation.length - prepared.installationStart, 'installation incomplete');
  for (const step of prepared.installation) await inspect('installation', step.hash, profile.owner, prepared.compiled.installation[step.index]);
  const sent = [...new Set(events.map(event => event.transactionHash).filter(Boolean))];
  check(sent.length === 1, `expected one executor transaction, found ${sent.length}`);
  check(events[0]?.state === 'RESERVED' && events.at(-1)?.state === 'CONFIRMED', 'worker journal is not RESERVED to CONFIRMED');
  if (sent[0]) await inspect('execution', sent[0], profile.executor, prepared.compiled.executorCall);
  check(prepared.reconciliation?.outcome === 'RECONCILED', `reconciliation is ${prepared.reconciliation?.outcome ?? 'missing'}`);
  check(prepared.revocation.length === prepared.compiled.revocation.length, 'revocation incomplete');
  for (const step of prepared.revocation) await inspect('revocation', step.hash, profile.owner, prepared.compiled.revocation[step.index]);
  const call = async (to, data) => BigInt(await rpc('eth_call', [{ to, data }, 'latest']));
  const moduleEnabled = await call(profile.safe, '0x2d9ad53d' + addressWord(profile.roles));
  const executorEnabled = await call(profile.roles, '0x2d9ad53d' + addressWord(profile.executor));
  const residual = await call(prepared.tokenIn, '0xdd62ed3e' + addressWord(profile.safe) + addressWord(SWAP_ROUTER_02));
  check(moduleEnabled === 0n && executorEnabled === 0n && residual === 0n, 'revocation not confirmed by chain readback');
  const result = { format: 'gryloo.mode-b-owner-session.v1', status: findings.length ? 'LIMITED' : 'PASS', environment: 'FORK_REPRODUCED',
    chainId: 31337, wallet: label('--wallet'), browser: label('--browser'), executionId, owner: profile.owner, executor: profile.executor,
    safe: profile.safe, roles: profile.roles, permissionHash: prepared.compiled.permissionHash, amountIn: prepared.amountIn,
    minimumOut: prepared.minimumOut, reconciliation: prepared.reconciliation, workerStates: events.map(event => event.state),
    transactions, chainReadback: { moduleEnabled: moduleEnabled === 1n, executorEnabled: executorEnabled === 1n, residualAllowance: residual.toString() },
    ownerSigner: profile.provenance?.ownerSigner ?? null, findings };
  writeFileSync(join(dirname(profilePath), 'owner-session-result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (findings.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'serve') await serve();
  else if (process.argv[2] === 'composition-worker-once') await compositionWorkerOnce();
  else if (process.argv[2] === 'verify') await verify();
  else await worker();
}

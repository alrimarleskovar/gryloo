// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F F3 recording proxy: the only process that ever holds the provider credential.
 *
 * Anvil talks to this loopback listener; approved state reads are rewritten to the canonical
 * hash-pinned form and forwarded one at a time, at least 400 ms apart, after a durable fsynced
 * reservation. The first failure of any kind permanently stops the session: no retry, fallback,
 * changed block or alternate route. The request log and transcript are credential-free.
 */
import { Buffer } from 'node:buffer';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, chmodSync, fstatSync, realpathSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import https from 'node:https';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import { forkUpstreamCall, routeForkUpstreamRequest, verifiedSourceBlockReply, SOURCE_CHAIN_ID } from '../../../../packages/reference-compiler/dist/profile.js';

export const RECORDING_POLICY = Object.freeze({
  maxRequests: 1500, cuPerRequest: 26, maxReservedCu: 39000, spacingMs: 400,
  requestTimeoutMs: 30_000, sessionTimeoutMs: 30 * 60_000, maxResponseBytes: 1_048_576,
  providerHost: 'base-mainnet.g.alchemy.com', providerPath: '/v2',
});
export const JOURNAL_FORMAT = 'gryloo.build-003f-recording-journal.v1';
export const LOG_FORMAT = 'gryloo.build-003f-recording-log.v1';
const SAFE_STOP = /^(?:REQUEST_CAP_REACHED|CU_CAP_REACHED|SESSION_TIMEOUT|OWNER_STOP_FILE|PROVIDER_HTTP_\d{3}|PROVIDER_RPC_ERROR|PROVIDER_INVALID_JSON|PROVIDER_RESPONSE_TOO_LARGE|PROVIDER_TIMEOUT|PROVIDER_TRANSPORT_FAILED|SENSITIVE_RESPONSE_REJECTED|SOURCE_CHAIN_MISMATCH|SOURCE_BLOCK_INVALID|SOURCE_BLOCK_CHANGED|FINALIZED_READ_REPEATED|FINALIZED_FIRST_REQUIRED|INVALID_OR_BATCH_REQUEST|UNAPPROVED_UPSTREAM|SESSION_STOPPED|SOURCE_BLOCK_UNVERIFIED|DISCONNECT_AFTER_RESERVATION|JOURNAL_WRITE_FAILED|INTERRUPTED|HARNESS_FAILED|COMPLETION_REFUSED)$/;

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('NON_JSON_VALUE');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
function durableJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, `${canonical(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  chmodSync(path, 0o600);
}
function appendDurable(path, line) {
  const fd = openSync(path, 'a', 0o600);
  try { writeFileSync(fd, `${line}\n`); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Non-secret owner report of the provider account. Any unmet condition refuses the session. */
export function validateBilling(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!value || value.format !== 'gryloo.build-003f-provider-billing.v1' || value.provider !== 'Alchemy'
    || value.plan !== 'Free' || value.network !== 'Base Mainnet' || value.paymentMethod !== false
    || value.paidAddOn !== false || value.overage !== false || value.autoUpgrade !== false
    || value.credentialRotated !== true || value.previousCredentialDeleted !== true
    || !date.test(value.rotatedOn ?? '') || !date.test(value.reportedOn ?? '')
    || !Number.isSafeInteger(value.remainingMonthlyCu) || value.remainingMonthlyCu < RECORDING_POLICY.maxReservedCu) {
    throw new Error('BILLING_CONFIRMATION_INCOMPLETE');
  }
  return value;
}

/**
 * The rotated credential comes only from an owner-created, mode-0600, owner-owned regular file outside
 * the repository whose modification time is after the preparation time; an earlier file cannot be the
 * rotated credential. Its value is never printed, hashed, logged or passed to any child.
 */
export function readRotatedCredential(path, { notBeforeMs, repository }) {
  if (typeof path !== 'string' || !path.startsWith('/') || path === repository || path.startsWith(`${repository}/`)) throw new Error('CREDENTIAL_FILE_INVALID');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    const actual = realpathSync(`/proc/self/fd/${fd}`);
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid() || info.size < 16 || info.size > 256
      || actual === repository || actual.startsWith(`${repository}/`)) throw new Error('CREDENTIAL_FILE_INVALID');
    if (!(info.mtimeMs > notBeforeMs)) throw new Error('CREDENTIAL_NOT_ROTATED');
    const bytes = readFileSync(fd);
    const value = bytes.toString('utf8').trim();
    bytes.fill(0);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new Error('CREDENTIAL_FILE_INVALID');
    return value;
  } catch (error) {
    throw new Error(['CREDENTIAL_NOT_ROTATED', 'CREDENTIAL_FILE_INVALID'].includes(error?.message) ? error.message : 'CREDENTIAL_FILE_INVALID', { cause: error });
  } finally { if (fd !== undefined) closeSync(fd); }
}

function assertRpcResponse(body, requestId) {
  let value;
  try { value = JSON.parse(body); } catch { throw new Error('PROVIDER_INVALID_JSON'); }
  if (!value || Array.isArray(value) || value.jsonrpc !== '2.0' || value.id !== requestId || 'error' in value || !('result' in value)) throw new Error('PROVIDER_RPC_ERROR');
  return value.result;
}
/** Fixed Base Mainnet endpoint class; the credential travels only in the Authorization header. */
export function alchemyProvider(credential) {
  return body => new Promise((resolvePromise, rejectPromise) => {
    const request = https.request({ hostname: RECORDING_POLICY.providerHost, port: 443, path: RECORDING_POLICY.providerPath, method: 'POST',
      timeout: RECORDING_POLICY.requestTimeoutMs, agent: false,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}`, 'content-length': Buffer.byteLength(body) } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > RECORDING_POLICY.maxResponseBytes) { request.destroy(new Error('PROVIDER_RESPONSE_TOO_LARGE')); return; } chunks.push(chunk); });
      response.on('end', () => resolvePromise({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('PROVIDER_TIMEOUT')));
    request.on('error', error => rejectPromise(new Error(['PROVIDER_TIMEOUT', 'PROVIDER_RESPONSE_TOO_LARGE'].includes(error?.message) ? error.message : 'PROVIDER_TRANSPORT_FAILED')));
    request.end(body);
  });
}
/** Dry run only: a loopback synthetic chain-8453 source stands in for the provider; no credential exists. */
export function loopbackProvider(port) {
  return body => new Promise((resolvePromise, rejectPromise) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/', method: 'POST', timeout: RECORDING_POLICY.requestTimeoutMs, agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolvePromise({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('PROVIDER_TIMEOUT')));
    request.on('error', () => rejectPromise(new Error('PROVIDER_TRANSPORT_FAILED')));
    request.end(body);
  });
}

export class RecordingSession {
  constructor({ journalPath, logPath, stopFile, provider, credential = null, billing, clock = () => performance.now(), sleep = ms => sleepTimer(ms) }) {
    if (existsSync(journalPath) || existsSync(logPath)) throw new Error('SESSION_ALREADY_USED');
    this.journalPath = journalPath; this.logPath = logPath; this.stopFile = stopFile;
    this.provider = provider; this.credential = credential; this.clock = clock; this.sleep = sleep;
    this.state = { format: JOURNAL_FORMAT, status: 'READY', policy: RECORDING_POLICY, billing: validateBilling(billing),
      requests: 0, reservedCu: 0, localReplies: 0, source: null, stopReason: null, stopDetail: null };
    durableJson(journalPath, this.state);
    this.startedAt = null; this.lastSend = null; this.sourceBlock = null; this.sequence = 0;
    this.queue = Promise.resolve(); this.pending = 0;
  }
  activate() {
    if (this.state.status !== 'READY') throw new Error('SESSION_ALREADY_USED');
    this.state.status = 'ACTIVE'; durableJson(this.journalPath, this.state); this.startedAt = this.clock();
  }
  stop(reason, detail = null) {
    if (this.state.status !== 'ACTIVE' && this.state.status !== 'READY') return;
    this.state.status = 'STOPPED'; this.state.stopReason = SAFE_STOP.test(reason) ? reason : 'PROVIDER_OR_RUNTIME_FAILURE';
    this.state.stopDetail = detail;
    durableJson(this.journalPath, this.state);
  }
  log(entry) {
    appendDurable(this.logPath, canonical({ format: LOG_FORMAT, sequence: this.sequence++, ...entry }));
  }
  enqueue(request, clientGone = () => false) {
    this.pending++;
    const result = this.queue.then(() => this.handle(request, clientGone)).finally(() => { this.pending--; });
    this.queue = result.catch(() => {});
    return result;
  }
  checkSession() {
    if (this.state.status !== 'ACTIVE') throw new Error('SESSION_STOPPED');
    if (this.clock() - this.startedAt > RECORDING_POLICY.sessionTimeoutMs) throw new Error('SESSION_TIMEOUT');
    if (existsSync(this.stopFile)) throw new Error('OWNER_STOP_FILE');
  }
  async forward(request, call, providerRequest, clientGone) {
    const caps = () => {
      if (this.state.requests >= RECORDING_POLICY.maxRequests) throw new Error('REQUEST_CAP_REACHED');
      if (this.state.reservedCu + RECORDING_POLICY.cuPerRequest > RECORDING_POLICY.maxReservedCu) throw new Error('CU_CAP_REACHED');
    };
    caps();
    if (this.lastSend !== null) await this.sleep(Math.max(0, RECORDING_POLICY.spacingMs - (this.clock() - this.lastSend)));
    this.checkSession();
    if (clientGone()) throw new Error('CLIENT_GONE');
    caps();
    this.state.requests++; this.state.reservedCu += RECORDING_POLICY.cuPerRequest;
    try { durableJson(this.journalPath, this.state); } catch { throw new Error('JOURNAL_WRITE_FAILED'); }
    this.lastSend = this.clock();
    const body = JSON.stringify({ jsonrpc: '2.0', id: request.id, method: providerRequest.method, params: providerRequest.params });
    const response = await this.provider(body);
    if (response.status !== 200) throw new Error(`PROVIDER_HTTP_${response.status}`);
    if (Buffer.byteLength(response.body) > RECORDING_POLICY.maxResponseBytes) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
    if ((this.credential && response.body.includes(this.credential)) || /authorization\s*[:=]|bearer\s+[a-z0-9_-]{16,}/i.test(response.body)) {
      throw new Error('SENSITIVE_RESPONSE_REJECTED');
    }
    const result = assertRpcResponse(response.body, request.id);
    if (call.method === 'eth_chainId' && result !== `0x${SOURCE_CHAIN_ID.toString(16)}`) throw new Error('SOURCE_CHAIN_MISMATCH');
    if (call.method === 'eth_getBlockByNumber') {
      if (!result || typeof result !== 'object' || !/^0x[0-9a-f]{64}$/.test(result.hash) || !/^0x[0-9a-f]+$/.test(result.number)) throw new Error('SOURCE_BLOCK_INVALID');
      if (call.params[0] === 'finalized') {
        if (this.sourceBlock !== null) throw new Error('FINALIZED_READ_REPEATED');
        const number = Number.parseInt(result.number, 16);
        if (!Number.isSafeInteger(number) || number <= 0) throw new Error('SOURCE_BLOCK_INVALID');
        this.sourceBlock = result;
        this.state.source = { blockNumber: number, blockHash: result.hash };
        durableJson(this.journalPath, this.state);
      } else if (result.hash !== this.state.source.blockHash || Number.parseInt(result.number, 16) !== this.state.source.blockNumber) {
        throw new Error('SOURCE_BLOCK_CHANGED');
      }
    }
    if (clientGone()) throw new Error('DISCONNECT_AFTER_RESERVATION');
    this.log({ kind: 'provider', anvilRequest: canonical(call), providerRequest: canonical(providerRequest),
      providerResponse: response.body, responseSha256: sha256(response.body) });
    return response.body;
  }
  async handle(request, clientGone = () => false) {
    let detail = null;
    try {
      this.checkSession();
      if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || !Number.isSafeInteger(request.id)) throw new Error('INVALID_OR_BATCH_REQUEST');
      const call = forkUpstreamCall(request);
      if (call === null) throw new Error('UNAPPROVED_UPSTREAM');
      detail = { method: typeof call.method === 'string' ? call.method.slice(0, 64) : null, arity: call.params.length };
      if (this.sourceBlock === null) {
        if (call.method !== 'eth_getBlockByNumber' || canonical(call.params) !== canonical(['finalized', false])) throw new Error('FINALIZED_FIRST_REQUIRED');
        return await this.forward(request, call, call, clientGone);
      }
      const route = routeForkUpstreamRequest(request, this.state.source.blockNumber, this.state.source.blockHash);
      if (route.kind === 'stop') throw new Error('UNAPPROVED_UPSTREAM');
      if (route.kind !== 'forward') {
        const reply = route.kind === 'local-error' ? { jsonrpc: '2.0', id: request.id, error: { code: route.code, message: route.message } }
          : route.kind === 'local-null' ? { jsonrpc: '2.0', id: request.id, result: null }
            : { jsonrpc: '2.0', id: request.id, result: verifiedSourceBlockReply(this.sourceBlock, this.state.source.blockNumber, this.state.source.blockHash) };
        const body = JSON.stringify(reply);
        this.state.localReplies++;
        this.log({ kind: 'local', anvilRequest: canonical(call), classification: route.kind, localResponse: body, responseSha256: sha256(body) });
        return body;
      }
      return await this.forward(request, call, { method: route.method, params: route.params }, clientGone);
    } catch (error) {
      const message = String(error?.message ?? error);
      if (message === 'CLIENT_GONE') throw error;
      const safe = SAFE_STOP.test(message) ? message : 'PROVIDER_OR_RUNTIME_FAILURE';
      if (safe !== 'SESSION_STOPPED') this.stop(safe, detail);
      throw new Error(safe, { cause: error });
    }
  }
  /** Completion requires the scenario proof bound to this session's source block; the log is scanned first. */
  complete(proof) {
    if (this.state.status !== 'ACTIVE' || this.sourceBlock === null || this.pending !== 0) throw new Error('COMPLETION_REFUSED');
    if (proof?.format !== 'gryloo.build-003f-scenario-results.v1' || proof.sourceBlockHash !== this.state.source.blockHash
      || proof.sourceBlockNumber !== this.state.source.blockNumber) throw new Error('COMPLETION_REFUSED');
    const log = readFileSync(this.logPath, 'utf8');
    if ((this.credential && log.includes(this.credential)) || /authorization\s*[:=]|bearer\s+[a-z0-9_-]{16,}/i.test(log)) throw new Error('COMPLETION_REFUSED');
    this.state.status = 'COMPLETE';
    durableJson(this.journalPath, this.state);
  }
}

/** After a stop the listener stays open and answers JSON-RPC errors; nothing more is forwarded. */
export function serve(session, port = 8546) {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/' || request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(400); response.end(); return; }
    const chunks = []; let size = 0; let gone = false;
    response.on('close', () => { if (!response.writableEnded) gone = true; });
    request.on('data', chunk => { size += chunk.length; if (size > RECORDING_POLICY.maxResponseBytes) request.destroy(); else chunks.push(chunk); });
    request.on('end', async () => {
      let id = null;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed && !Array.isArray(parsed) && Number.isSafeInteger(parsed.id)) id = parsed.id;
        const body = await session.enqueue(parsed, () => gone);
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(body);
      } catch (error) {
        const reason = SAFE_STOP.test(String(error?.message)) ? error.message : 'PROVIDER_OR_RUNTIME_FAILURE';
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: `FORK_STATE_UNRECORDED: ${reason}` } }));
      }
    });
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(port, '127.0.0.1', () => { session.activate(); resolvePromise(server); });
  });
}

/** Credential-free, canonical transcript built from a COMPLETE session's log. */
export function buildTranscript({ logPath, journal, identity, identityHash, scenarioResultsSha256, codeFingerprints }) {
  if (journal.status !== 'COMPLETE' || !journal.source) throw new Error('TRANSCRIPT_SESSION_INCOMPLETE');
  const logBytes = readFileSync(logPath);
  const entries = logBytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const exchanges = [];
  let sessionStart = null;
  entries.forEach((entry, index) => {
    if (entry.format !== LOG_FORMAT || entry.sequence !== index || sha256(entry.providerResponse ?? entry.localResponse) !== entry.responseSha256) throw new Error('TRANSCRIPT_LOG_CORRUPT');
    const request = JSON.parse(entry.anvilRequest);
    if (index === 0) {
      if (request.method !== 'eth_getBlockByNumber' || canonical(request.params) !== canonical(['finalized', false])) throw new Error('TRANSCRIPT_LOG_CORRUPT');
      sessionStart = { anvilRequest: entry.anvilRequest, providerResponse: entry.providerResponse, responseSha256: entry.responseSha256 };
      return;
    }
    exchanges.push(entry.kind === 'provider'
      ? { sequence: index, anvilRequest: entry.anvilRequest, providerRequest: entry.providerRequest, providerResponse: entry.providerResponse, responseSha256: entry.responseSha256 }
      : { sequence: index, anvilRequest: entry.anvilRequest, classification: entry.classification, localResponse: entry.localResponse, responseSha256: entry.responseSha256 });
  });
  if (entries.filter(entry => entry.kind === 'provider').length !== journal.requests) throw new Error('TRANSCRIPT_COUNT_MISMATCH');
  return { format: 'gryloo.base-fork-state-transcript.v1', sourceChainId: SOURCE_CHAIN_ID,
    sourceBlockNumber: journal.source.blockNumber, sourceBlockHash: journal.source.blockHash,
    identity, identityHash, providerEndpointClass: `https://${RECORDING_POLICY.providerHost}${RECORDING_POLICY.providerPath}`,
    policy: RECORDING_POLICY, counts: { providerRequests: journal.requests, reservedCu: journal.reservedCu, localReplies: journal.localReplies, entries: entries.length },
    requestLogSha256: sha256(logBytes), scenarioResultsSha256, codeFingerprints, sessionStart, exchanges };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Child mode, started only by owner-recording.mjs: serve <session-dir> <billing-json> (<credential-file> <not-before-ms> | --dry-run-provider <port>)
  const [mode, sessionDir, billingPath, ...rest] = process.argv.slice(2);
  if (mode !== 'serve' || !sessionDir || !billingPath) { process.stderr.write('RECORDING_PROXY_ARGUMENTS_INVALID\n'); process.exit(2); }
  const repository = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  let provider, credential = null;
  if (rest[0] === '--dry-run-provider' && /^[1-9][0-9]{3,4}$/.test(rest[1] ?? '') && rest.length === 2) provider = loopbackProvider(Number(rest[1]));
  else if (rest.length === 2 && /^[0-9]{13}$/.test(rest[1])) {
    credential = readRotatedCredential(rest[0], { notBeforeMs: Number(rest[1]), repository });
    provider = alchemyProvider(credential);
  } else { process.stderr.write('RECORDING_PROXY_ARGUMENTS_INVALID\n'); process.exit(2); }
  const session = new RecordingSession({ journalPath: `${sessionDir}/journal.json`, logPath: `${sessionDir}/requests.jsonl`,
    stopFile: `${sessionDir}/STOP`, provider, credential, billing: JSON.parse(readFileSync(billingPath, 'utf8')) });
  const finish = code => { credential = null; process.exit(code); };
  process.on('SIGINT', () => { session.stop('INTERRUPTED'); finish(1); });
  process.on('SIGUSR2', () => { session.stop('HARNESS_FAILED'); finish(1); });
  process.on('SIGTERM', () => {
    try { session.complete(JSON.parse(readFileSync(`${sessionDir}/scenario-results.json`, 'utf8'))); finish(0); }
    catch { session.stop('COMPLETION_REFUSED'); finish(1); }
  });
  await serve(session);
  process.stdout.write('RECORDING_PROXY_READY 127.0.0.1:8546\n');
}
